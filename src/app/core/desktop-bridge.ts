export type UnlistenFn = () => void;

export interface DesktopEvent<T> {
  payload: T;
}

interface ElectronBridge {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  emit<T>(event: string, payload?: T): Promise<void>;
  listen<T>(
    event: string,
    callback: (event: DesktopEvent<T>) => void
  ): Promise<UnlistenFn>;
  onWindowFocus(callback: (focused: boolean) => void): UnlistenFn;
  onWindowMoved(callback: (position: { x: number; y: number }) => void): UnlistenFn;
  onCloseRequested(callback: () => void): UnlistenFn;
  moveDragging(x: number, y: number): Promise<void>;
}

declare global {
  interface Window {
    desktopPet?: ElectronBridge;
  }
}

export function isDesktopRuntime(): boolean {
  return Boolean(window.desktopPet);
}

export function invoke<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  if (!window.desktopPet) {
    return Promise.reject(new Error(`Desktop command "${command}" is unavailable in browser preview.`));
  }
  return window.desktopPet.invoke<T>(command, args);
}

export function emit<T>(event: string, payload?: T): Promise<void> {
  if (window.desktopPet) {
    return window.desktopPet.emit(event, payload);
  }
  window.dispatchEvent(new CustomEvent(`desktop-pet:${event}`, { detail: payload }));
  return Promise.resolve();
}

export function listen<T>(
  event: string,
  callback: (event: DesktopEvent<T>) => void
): Promise<UnlistenFn> {
  if (window.desktopPet) {
    return window.desktopPet.listen(event, callback);
  }
  const eventName = `desktop-pet:${event}`;
  const handler = (message: Event) => {
    callback({ payload: (message as CustomEvent<T>).detail });
  };
  window.addEventListener(eventName, handler);
  return Promise.resolve(() => window.removeEventListener(eventName, handler));
}

export interface Store {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  save(): Promise<void>;
}

export async function load(
  name: string,
  _options?: { autoSave?: boolean }
): Promise<Store> {
  const values = new Map<string, unknown>();
  const storedValues = window.desktopPet
    ? await invoke<Record<string, unknown>>('store:load', { name })
    : JSON.parse(localStorage.getItem(`desktop-pet:${name}`) ?? '{}') as Record<string, unknown>;

  for (const [key, value] of Object.entries(storedValues)) {
    values.set(key, value);
  }

  return {
    get: async <T>(key: string) => values.get(key) as T | undefined,
    set: async <T>(key: string, value: T) => {
      values.set(key, value);
    },
    delete: async (key: string) => values.delete(key),
    save: async () => {
      const serialized = Object.fromEntries(values.entries());
      if (window.desktopPet) {
        await invoke<void>('store:save', { name, values: serialized });
      } else {
        localStorage.setItem(`desktop-pet:${name}`, JSON.stringify(serialized));
      }
    }
  };
}

export class LogicalSize {
  constructor(
    readonly width: number,
    readonly height: number
  ) {}
}

export class PhysicalPosition {
  constructor(
    readonly x: number,
    readonly y: number
  ) {}
}

export function getCurrentWindow() {
  return {
    show: () => invoke<void>('window:show'),
    setFocus: () => invoke<void>('window:focus'),
    setSize: (size: LogicalSize) =>
      invoke<void>('window:set-size', { width: size.width, height: size.height }),
    setPosition: (position: PhysicalPosition) =>
      invoke<void>('window:set-position', { x: position.x, y: position.y }),
    setAlwaysOnTop: (enabled: boolean) =>
      invoke<void>('window:set-always-on-top', { enabled }),
    startDragging: () => invoke<void>('window:start-dragging'),
    moveDragging: (x: number, y: number) =>
      window.desktopPet
        ? window.desktopPet.moveDragging(x, y)
        : Promise.reject(new Error('Window dragging is unavailable in browser preview.')),
    stopDragging: () => invoke<void>('window:stop-dragging'),
    onFocusChanged: (
      callback: (event: { payload: boolean }) => void
    ): Promise<UnlistenFn> => {
      if (!window.desktopPet) return Promise.resolve(() => {});
      return Promise.resolve(
        window.desktopPet.onWindowFocus(focused => callback({ payload: focused }))
      );
    },
    onMoved: (
      callback: (event: { payload: { x: number; y: number } }) => void
    ): Promise<UnlistenFn> => {
      if (!window.desktopPet) return Promise.resolve(() => {});
      return Promise.resolve(
        window.desktopPet.onWindowMoved(position => callback({ payload: position }))
      );
    },
    onCloseRequested: (callback: () => void): Promise<UnlistenFn> => {
      if (!window.desktopPet) return Promise.resolve(() => {});
      return Promise.resolve(window.desktopPet.onCloseRequested(callback));
    }
  };
}

export function isEnabled(): Promise<boolean> {
  return invoke<boolean>('autostart:is-enabled');
}

export function enable(): Promise<void> {
  return invoke<void>('autostart:enable');
}

export function disable(): Promise<void> {
  return invoke<void>('autostart:disable');
}

export function isPermissionGranted(): Promise<boolean> {
  return invoke<boolean>('notification:is-permission-granted');
}

export function requestPermission(): Promise<string> {
  return invoke<string>('notification:request-permission');
}

export function sendNotification(notification: {
  title: string;
  body: string;
}): Promise<void> {
  return invoke<void>('notification:send', notification);
}
