const { app, BrowserWindow, Menu, Notification, Tray, dialog, ipcMain, screen, shell } = require('electron');
const { watch: watchFileSystem } = require('node:fs');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const fs = require('node:fs/promises');
const path = require('node:path');

const DEV_URL = 'http://localhost:4200';
const windows = new Set();
const stores = new Map();
const QUICK_ACTIONS_WINDOW_SIZE = 240;
let petWindow;
let dashboardWindow;
let quickActionsWindow;
let quickActionsWindowLoad;
let tray;
let devServer;
let speechProcess;
let speechRequestId = 0;
let activeSpeechId;
let speechSpeaking = false;
let dragState;
let globalCursorTimer;
let lastGlobalCursor;
let eyesFollowCursorEnabled = true;
let noteExportDirectory;
let noteExportDirectoryWatcher;
let noteExportDirectoryWatcherPath;
let noteExportWatchTimer;

function emitToWindows(event, payload) {
  for (const window of windows) {
    if (!window.isDestroyed()) {
      window.webContents.send(`desktop:event:${event}`, payload);
    }
  }
}

function currentWindow(event) {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || window.isDestroyed()) {
    throw new Error('The calling desktop window no longer exists.');
  }
  return window;
}

async function loadStore(name) {
  if (name !== 'settings.json') throw new Error('Unsupported settings store.');
  if (!stores.has(name)) {
    const file = path.join(app.getPath('userData'), name);
    try {
      stores.set(name, JSON.parse(await fs.readFile(file, 'utf8')));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      stores.set(name, {});
    }
  }
  return stores.get(name);
}

function createPreloadWindow(options) {
  const window = new BrowserWindow({
    ...options,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  windows.add(window);
  window.on('closed', () => windows.delete(window));
  window.on('focus', () => window.webContents.send('window:focus-changed', true));
  window.on('blur', () => window.webContents.send('window:focus-changed', false));
  window.on('move', () => {
    const [x, y] = window.getPosition();
    window.webContents.send('window:moved', { x, y });
  });
  return window;
}

async function loadAppRoute(window, route = '') {
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`Electron failed to load ${url}: ${description} (${code}).`);
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('Electron renderer process exited:', details);
  });
  if (app.isPackaged) {
    const file = path.join(__dirname, '..', 'dist', 'desktop-pet', 'browser', 'index.html');
    await window.loadFile(file, { hash: route });
  } else {
    await window.loadURL(`${DEV_URL}/${route ? `#/${route}` : ''}`);
  }
  console.info(`Electron loaded ${window.webContents.getURL()}.`);
}

async function createDashboard() {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.show();
    dashboardWindow.focus();
    return;
  }
  dashboardWindow = createPreloadWindow({
    title: 'Milly Dashboard',
    width: 980,
    height: 720,
    show: false,
    resizable: true,
    frame: true
  });
  dashboardWindow.on('close', event => {
    if (!app.isQuitting) {
      dashboardWindow.webContents.send('window:close-requested');
      event.preventDefault();
      dashboardWindow.hide();
    }
  });
  await loadAppRoute(dashboardWindow, 'dashboard');
  dashboardWindow.show();
}

async function createPet() {
  petWindow = createPreloadWindow({
    title: 'Desktop Pet',
    width: 250,
    height: 250,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    show: false
  });
  petWindow.on('close', event => {
    if (!app.isQuitting) {
      petWindow.webContents.send('window:close-requested');
      event.preventDefault();
      petWindow.hide();
    }
  });
  await loadAppRoute(petWindow);
  const savedSettings = await loadStore('settings.json');
  eyesFollowCursorEnabled = savedSettings.eyesFollowCursor !== false;
  petWindow.on('ready-to-show', () => {
    console.info('Electron pet window is ready to show.');
  });
  petWindow.on('show', () => {
    console.info('Electron pet window shown at', petWindow.getBounds());
  });
  globalCursorTimer = setInterval(() => {
    if (
      !eyesFollowCursorEnabled ||
      !petWindow ||
      petWindow.isDestroyed() ||
      !petWindow.isVisible()
    ) return;

    const bounds = petWindow.getBounds();
    const cursor = screen.getCursorScreenPoint();
    if (
      cursor.x >= bounds.x &&
      cursor.x <= bounds.x + bounds.width &&
      cursor.y >= bounds.y &&
      cursor.y <= bounds.y + bounds.height
    ) {
      lastGlobalCursor = undefined;
      return;
    }

    if (
      lastGlobalCursor &&
      Math.abs(cursor.x - lastGlobalCursor.x) < 2 &&
      Math.abs(cursor.y - lastGlobalCursor.y) < 2
    ) return;

    lastGlobalCursor = cursor;
    petWindow.webContents.send('cursor:global-move', {
      x: cursor.x - bounds.x,
      y: cursor.y - bounds.y
    });
  }, 33);
  petWindow.showInactive();
}

async function openQuickActions(centerOnPet = false) {
  let anchor = screen.getCursorScreenPoint();
  if (centerOnPet && petWindow && !petWindow.isDestroyed()) {
    const bounds = petWindow.getBounds();
    anchor = {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2
    };
  }
  const workArea = screen.getDisplayNearestPoint(anchor).workArea;
  const x = Math.min(
    Math.max(Math.round(anchor.x - QUICK_ACTIONS_WINDOW_SIZE / 2), workArea.x),
    workArea.x + workArea.width - QUICK_ACTIONS_WINDOW_SIZE
  );
  const y = Math.min(
    Math.max(Math.round(anchor.y - QUICK_ACTIONS_WINDOW_SIZE / 2), workArea.y),
    workArea.y + workArea.height - QUICK_ACTIONS_WINDOW_SIZE
  );
  const bounds = {
    x,
    y,
    width: QUICK_ACTIONS_WINDOW_SIZE,
    height: QUICK_ACTIONS_WINDOW_SIZE
  };

  if (quickActionsWindow && !quickActionsWindow.isDestroyed()) {
    quickActionsWindow.setBounds(bounds);
    if (quickActionsWindowLoad) await quickActionsWindowLoad;
    if (quickActionsWindow && !quickActionsWindow.isDestroyed()) {
      quickActionsWindow.show();
      quickActionsWindow.focus();
    }
    return;
  }

  const overlay = createPreloadWindow({
    title: 'Milly Quick Actions',
    ...bounds,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    show: false
  });
  quickActionsWindow = overlay;
  overlay.on('blur', () => {
    if (!overlay.isDestroyed()) overlay.close();
  });
  overlay.on('closed', () => {
    if (quickActionsWindow === overlay) {
      quickActionsWindow = undefined;
      quickActionsWindowLoad = undefined;
    }
  });

  quickActionsWindowLoad = loadAppRoute(overlay, 'quick-actions');
  try {
    await quickActionsWindowLoad;
  } catch (error) {
    if (quickActionsWindow === overlay) {
      quickActionsWindow = undefined;
      quickActionsWindowLoad = undefined;
    }
    if (!overlay.isDestroyed()) overlay.destroy();
    throw error;
  }
  if (quickActionsWindow === overlay && !overlay.isDestroyed()) {
    quickActionsWindowLoad = undefined;
    overlay.show();
    overlay.focus();
  }
}

async function ensureDevServer() {
  try {
    const response = await fetch(DEV_URL);
    if (response.ok) return;
  } catch {}

  const ngCli = path.join(__dirname, '..', 'node_modules', '@angular', 'cli', 'bin', 'ng.js');
  devServer = spawn(process.execPath, [ngCli, 'serve', '--port', '4200'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    windowsHide: true
  });
  devServer.on('error', error => console.error('Could not start Angular dev server:', error));

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (devServer.exitCode !== null) {
      throw new Error(`Angular dev server exited with code ${devServer.exitCode}.`);
    }
    try {
      const response = await fetch(DEV_URL);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Angular dev server did not start within 60 seconds.');
}

function validateNoteFileRequest(fileName, content, format) {
  if (
    typeof fileName !== 'string' ||
    path.basename(fileName) !== fileName ||
    typeof content !== 'string' ||
    !['txt', 'md'].includes(format)
  ) {
    throw new Error('Invalid note file data.');
  }
  const stem = path.parse(fileName).name;
  if (!stem || /[\u0000-\u001f<>:"/\\|?*]/.test(stem)) {
    throw new Error('Invalid note file name.');
  }
  return `${stem}.${format}`;
}

async function writeUniqueNoteFile(directory, fileName, content) {
  const { name, ext } = path.parse(fileName);
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const candidateName = suffix === 0 ? fileName : `${name} (${suffix + 1})${ext}`;
    const candidatePath = path.join(directory, candidateName);
    try {
      await fs.writeFile(candidatePath, content, { encoding: 'utf8', flag: 'wx' });
      return candidatePath;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw new Error('Could not find an unused filename for this note.');
}

function defaultNoteExportDirectory() {
  return path.join(app.getPath('documents'), 'Milly Notes');
}

async function getNoteExportDirectory() {
  if (!noteExportDirectory) {
    const settingsFile = path.join(app.getPath('userData'), 'notes-settings.json');
    try {
      const settings = JSON.parse(await fs.readFile(settingsFile, 'utf8'));
      if (
        typeof settings.exportDirectory !== 'string' ||
        !path.isAbsolute(settings.exportDirectory)
      ) {
        throw new Error('Saved Notes export directory is invalid.');
      }
      noteExportDirectory = path.normalize(settings.exportDirectory);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw new Error('Could not load the saved Notes export directory.', { cause: error });
      }
      noteExportDirectory = defaultNoteExportDirectory();
    }
  }
  return {
    directory: noteExportDirectory,
    defaultDirectory: defaultNoteExportDirectory()
  };
}

async function saveNoteExportDirectory(directory) {
  const resolvedDirectory = path.resolve(directory);
  await fs.mkdir(resolvedDirectory, { recursive: true });
  const details = await fs.stat(resolvedDirectory);
  if (!details.isDirectory()) throw new Error('The Notes export location must be a folder.');

  const settingsFile = path.join(app.getPath('userData'), 'notes-settings.json');
  await fs.mkdir(path.dirname(settingsFile), { recursive: true });
  await fs.writeFile(settingsFile, JSON.stringify({ exportDirectory: resolvedDirectory }, null, 2), 'utf8');
  noteExportDirectory = resolvedDirectory;
  watchNoteExportDirectory(resolvedDirectory);
  return getNoteExportDirectory();
}

function watchNoteExportDirectory(directory) {
  if (noteExportDirectoryWatcherPath === directory && noteExportDirectoryWatcher) return;
  noteExportDirectoryWatcher?.close();
  noteExportDirectoryWatcherPath = directory;
  try {
    const watcher = watchFileSystem(directory, { persistent: false }, () => {
      if (noteExportWatchTimer) clearTimeout(noteExportWatchTimer);
      noteExportWatchTimer = setTimeout(() => emitToWindows('notes-files-changed'), 150);
    });
    watcher.on('error', error => {
      console.error('Could not monitor the Notes export folder:', error);
      watcher.close();
      if (noteExportDirectoryWatcher === watcher) {
        noteExportDirectoryWatcher = undefined;
        noteExportDirectoryWatcherPath = undefined;
      }
    });
    noteExportDirectoryWatcher = watcher;
  } catch (error) {
    noteExportDirectoryWatcherPath = undefined;
    console.error('Could not monitor the Notes export folder:', error);
  }
}

async function listNoteExportFiles() {
  const { directory } = await getNoteExportDirectory();
  await fs.mkdir(directory, { recursive: true });
  watchNoteExportDirectory(directory);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter(entry => entry.isFile() && ['.txt', '.md'].includes(path.extname(entry.name).toLowerCase()))
      .map(async entry => {
        const details = await fs.stat(path.join(directory, entry.name));
        return {
          name: entry.name,
          size: details.size,
          modifiedAt: details.mtime.toISOString()
        };
      })
  );
  return files.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
}

function configureIpc() {
  ipcMain.handle('cursor:subscribe', () => {
    lastGlobalCursor = undefined;
  });

  ipcMain.handle('desktop:event', (_event, message) => {
    if (!message || typeof message.event !== 'string') {
      throw new Error('Invalid desktop event.');
    }
    if (message.event === 'eyes-follow-cursor-toggled') {
      if (typeof message.payload !== 'boolean') {
        throw new Error('Invalid eye cursor tracking setting.');
      }
      eyesFollowCursorEnabled = message.payload;
      lastGlobalCursor = undefined;
    }
    emitToWindows(message.event, message.payload);
  });

  ipcMain.handle('store:load', (_event, { name }) => loadStore(name));
  ipcMain.handle('store:save', async (_event, { name, values }) => {
    if (name !== 'settings.json' || !values || typeof values !== 'object') {
      throw new Error('Invalid settings store data.');
    }
    stores.set(name, values);
    const file = path.join(app.getPath('userData'), name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(values, null, 2), 'utf8');
  });

  ipcMain.handle('notes:quick-export', async (event, { fileName, content }) => {
    currentWindow(event);
    const safeFileName = validateNoteFileRequest(fileName, content, 'txt');
    const { directory: notesDirectory } = await getNoteExportDirectory();
    await fs.mkdir(notesDirectory, { recursive: true });
    const filePath = await writeUniqueNoteFile(notesDirectory, safeFileName, content);
    emitToWindows('notes-files-changed');
    return filePath;
  });
  ipcMain.handle('notes:save-as', async (event, { fileName, content, format }) => {
    const safeFileName = validateNoteFileRequest(fileName, content, format);
    const owner = currentWindow(event);
    const { directory } = await getNoteExportDirectory();
    await fs.mkdir(directory, { recursive: true });
    const result = await dialog.showSaveDialog(owner, {
      title: 'Save note as',
      defaultPath: path.join(directory, safeFileName),
      filters: [{ name: 'Text or Markdown', extensions: ['txt', 'md'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };

    let outputPath = result.filePath;
    const selectedExtension = path.extname(outputPath).toLowerCase();
    if (selectedExtension !== '.txt' && selectedExtension !== '.md') {
      const selectedPath = path.parse(outputPath);
      outputPath = path.join(selectedPath.dir, `${selectedPath.name}.${format}`);
    }
    await fs.writeFile(outputPath, content, 'utf8');
    emitToWindows('notes-files-changed');
    return { canceled: false, filePath: outputPath };
  });
  ipcMain.handle('notes:export-directory:get', async event => {
    currentWindow(event);
    return getNoteExportDirectory();
  });
  ipcMain.handle('notes:export-directory:choose', async event => {
    const owner = currentWindow(event);
    const current = await getNoteExportDirectory();
    const result = await dialog.showOpenDialog(owner, {
      title: 'Choose Notes export folder',
      defaultPath: current.directory,
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths[0]) {
      return { canceled: true, ...current };
    }
    return {
      canceled: false,
      ...(await saveNoteExportDirectory(result.filePaths[0]))
    };
  });
  ipcMain.handle('notes:export-directory:reset', async event => {
    currentWindow(event);
    return saveNoteExportDirectory(defaultNoteExportDirectory());
  });
  ipcMain.handle('notes:files:list', async event => {
    currentWindow(event);
    return listNoteExportFiles();
  });
  ipcMain.handle('notes:file:open', async (event, { fileName }) => {
    currentWindow(event);
    if (
      typeof fileName !== 'string' ||
      path.basename(fileName) !== fileName ||
      !['.txt', '.md'].includes(path.extname(fileName).toLowerCase())
    ) {
      throw new Error('Invalid Notes filename.');
    }
    const { directory } = await getNoteExportDirectory();
    const filePath = path.join(directory, fileName);
    const details = await fs.stat(filePath);
    if (!details.isFile()) throw new Error('The selected Notes item is not a file.');
    const error = await shell.openPath(filePath);
    if (error) throw new Error(`Could not open the note file: ${error}`);
  });

  ipcMain.handle('open_dashboard', () => createDashboard());
  ipcMain.handle('quick-actions:open', (event, args) => {
    if (currentWindow(event) !== petWindow) {
      throw new Error('Only the pet window can open Quick Actions.');
    }
    return openQuickActions(args?.centerOnPet === true);
  });
  ipcMain.handle('quick-actions:close', event => {
    const window = currentWindow(event);
    if (window !== quickActionsWindow) {
      throw new Error('Only the Quick Actions window can close itself.');
    }
    window.close();
  });
  ipcMain.handle('window:show', event => currentWindow(event).showInactive());
  ipcMain.handle('window:set-ignore-mouse-events', (event, { ignore }) => {
    if (typeof ignore !== 'boolean') {
      throw new Error('Invalid mouse pass-through setting.');
    }
    currentWindow(event).setIgnoreMouseEvents(ignore, { forward: true });
  });
  ipcMain.handle('window:focus', event => currentWindow(event).focus());
  ipcMain.handle('window:set-size', (event, { width, height }) =>
    currentWindow(event).setSize(Math.round(width), Math.round(height)));
  ipcMain.handle('window:set-position', (event, { x, y }) =>
    currentWindow(event).setPosition(Math.round(x), Math.round(y)));
  ipcMain.handle('window:set-always-on-top', (event, { enabled }) =>
    currentWindow(event).setAlwaysOnTop(Boolean(enabled)));
  ipcMain.handle('window:start-dragging', event => {
    const window = currentWindow(event);
    const [x, y] = window.getPosition();
    const cursor = screen.getCursorScreenPoint();
    dragState = { window, offsetX: cursor.x - x, offsetY: cursor.y - y };
  });
  ipcMain.handle('window:move-dragging', (_event, { x, y }) => {
    if (dragState && !dragState.window.isDestroyed()) {
      dragState.window.setPosition(
        Math.round(x - dragState.offsetX),
        Math.round(y - dragState.offsetY)
      );
    }
  });
  ipcMain.handle('window:stop-dragging', () => {
    dragState = undefined;
  });
  ipcMain.handle('autostart:is-enabled', () => app.getLoginItemSettings().openAtLogin);
  ipcMain.handle('autostart:enable', () => app.setLoginItemSettings({ openAtLogin: true }));
  ipcMain.handle('autostart:disable', () => app.setLoginItemSettings({ openAtLogin: false }));
  ipcMain.handle('notification:is-permission-granted', () => Notification.isSupported());
  ipcMain.handle('notification:request-permission', () =>
    Notification.isSupported() ? 'granted' : 'denied');
  ipcMain.handle('notification:send', (_event, { title, body }) => {
    if (!Notification.isSupported()) throw new Error('Desktop notifications are unavailable.');
    new Notification({ title, body }).show();
  });
  ipcMain.handle('speech_speak', (_event, { text }) => startSpeech(text));
  ipcMain.handle('speech_stop', () => stopSpeech());
  ipcMain.handle('speech_is_speaking', () => speechSpeaking);
}

function engineCommand() {
  const executableName = process.platform === 'win32' ? 'milly-tts.exe' : 'milly-tts';
  const bundledExecutable = app.isPackaged
    ? path.join(process.resourcesPath, 'milly-tts', executableName)
    : path.join(__dirname, '..', 'speech-engine', 'dist', 'milly-tts', executableName);
  if (require('node:fs').existsSync(bundledExecutable)) {
    return { command: bundledExecutable, args: [] };
  }

  if (app.isPackaged) {
    throw new Error('The bundled Milly speech engine is missing.');
  }
  const root = path.join(__dirname, '..');
  const python = path.join(root, 'test-pet-audio', '.venv', 'Scripts', 'python.exe');
  const script = path.join(root, 'speech-engine', 'engine.py');
  if (!require('node:fs').existsSync(python) || !require('node:fs').existsSync(script)) {
    throw new Error('The local speech engine is not ready. Build it with speech-engine\\build.ps1.');
  }
  return { command: python, args: [script] };
}

function startSpeech(text) {
  if (typeof text !== 'string' || !text.trim() || [...text.trim()].length > 4000) {
    throw new Error('Speech text must contain 1 to 4000 characters.');
  }
  const id = ++speechRequestId;
  activeSpeechId = id;
  speechSpeaking = true;
  if (!speechProcess) {
    const { command, args } = engineCommand();
    const modelDir = app.isPackaged
      ? path.join(app.getPath('userData'), 'models')
      : path.join(__dirname, '..', 'test-pet-audio');
    speechProcess = spawn(command, [...args, '--model-dir', modelDir], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    const lines = createInterface({ input: speechProcess.stdout });
    lines.on('line', line => {
      try {
        const event = JSON.parse(line);
        if (event.request_id === activeSpeechId) {
          if (['finished', 'stopped', 'error'].includes(event.status)) speechSpeaking = false;
          emitToWindows('speech-event', event);
        }
      } catch (error) {
        console.error('Invalid speech engine event:', error);
      }
    });
    speechProcess.stderr.on('data', data => console.info('Kokoro:', data.toString().trim()));
    speechProcess.on('error', error => {
      speechSpeaking = false;
      emitToWindows('speech-event', {
        status: 'error',
        request_id: activeSpeechId,
        message: error.message
      });
    });
    speechProcess.on('exit', () => {
      speechSpeaking = false;
      speechProcess = undefined;
    });
  }

  speechProcess.stdin.write(`${JSON.stringify({ type: 'speak', request_id: id, text: text.trim() })}\n`);
  return id;
}

function stopSpeech() {
  speechSpeaking = false;
  if (speechProcess && !speechProcess.killed) {
    speechProcess.stdin.write('{"type":"stop"}\n');
  }
}

function createTray() {
  const iconPath = path.join(__dirname, '..', 'src-tauri', 'icons', 'icon.png');
  tray = new Tray(iconPath);
  tray.setToolTip('Milly Desktop Pet');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Dashboard', click: () => void createDashboard() },
    { label: 'Show Pet', click: () => petWindow?.showInactive() },
    { label: 'Hide Pet', click: () => petWindow?.hide() },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
  ]));
}

app.whenReady().then(async () => {
  configureIpc();
  if (!app.isPackaged) await ensureDevServer();
  await createPet();
  createTray();
  app.on('activate', () => {
    if (!petWindow || petWindow.isDestroyed()) void createPet();
    else petWindow.showInactive();
  });
}).catch(error => {
  console.error('Electron startup failed:', error);
  app.quit();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (globalCursorTimer) clearInterval(globalCursorTimer);
  stopSpeech();
  if (devServer && !devServer.killed) devServer.kill();
});
