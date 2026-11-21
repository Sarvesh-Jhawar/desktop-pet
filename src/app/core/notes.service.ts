import { Injectable, computed, signal } from '@angular/core';
import {
  chooseNoteExportDirectory,
  exportNoteTextFile,
  getNoteExportDirectory,
  isDesktopRuntime,
  listNoteExportFiles,
  listen,
  openNoteExportFile,
  resetNoteExportDirectory,
  saveNoteAsFile,
} from './desktop-bridge';
import type { NoteExportFile } from './desktop-bridge';

export interface QuickNote {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export type NoteFileExtension = 'txt' | 'md';

interface SaveNoteAsResult {
  canceled: boolean;
  filePath?: string;
}

const STORAGE_KEY = 'milly.quick-notes.v1';
const MAX_TITLE_LENGTH = 80;

function isQuickNote(value: unknown): value is QuickNote {
  if (typeof value !== 'object' || value === null) return false;
  const note = value as Record<string, unknown>;
  return (
    typeof note['id'] === 'string' &&
    typeof note['title'] === 'string' &&
    typeof note['content'] === 'string' &&
    typeof note['createdAt'] === 'string' &&
    typeof note['updatedAt'] === 'string'
  );
}

@Injectable({ providedIn: 'root' })
export class NotesService {
  private exportFilesRequestId = 0;

  readonly notes = signal<QuickNote[]>([]);
  readonly activeNoteId = signal<string | null>(null);
  readonly activeNote = computed(
    () => this.notes().find((note) => note.id === this.activeNoteId()) ?? null,
  );
  readonly storageError = signal('');
  readonly exportDirectory = signal('');
  readonly defaultExportDirectory = signal('');
  readonly exportDirectoryError = signal('');
  readonly exportFiles = signal<NoteExportFile[]>([]);
  readonly exportFilesLoading = signal(false);
  readonly exportFilesError = signal('');

  constructor() {
    this.loadNotes();
    if (isDesktopRuntime()) {
      void this.refreshExportDirectory();
      void listen<void>('notes-files-changed', () => {
        void this.refreshExportFiles();
      }).catch((error) => {
        console.error('Could not subscribe to Notes file updates:', error);
        this.exportFilesError.set('Could not watch for Notes file updates.');
      });
    }
    globalThis.addEventListener('storage', this.onStorageChange);
  }

  createNote(): QuickNote {
    const now = new Date().toISOString();
    const note: QuickNote = {
      id: globalThis.crypto.randomUUID(),
      title: '',
      content: '',
      createdAt: now,
      updatedAt: now,
    };
    this.commit([note, ...this.notes()]);
    this.activeNoteId.set(note.id);
    return note;
  }

  selectNote(id: string): void {
    if (this.notes().some((note) => note.id === id)) {
      this.activeNoteId.set(id);
    }
  }

  updateTitle(id: string, title: string): void {
    this.updateNote(id, (note) => ({ ...note, title: title.slice(0, MAX_TITLE_LENGTH) }));
  }

  updateContent(id: string, content: string): void {
    this.updateNote(id, (note) => ({ ...note, content }));
  }

  deleteNote(id: string): void {
    const remaining = this.notes().filter((note) => note.id !== id);
    if (remaining.length === this.notes().length) return;
    this.commit(remaining);
    if (this.activeNoteId() === id) this.activeNoteId.set(remaining[0]?.id ?? null);
  }

  getTitle(note: QuickNote): string {
    const explicitTitle = note.title.trim();
    if (explicitTitle) return explicitTitle;
    const firstLine = note.content.split(/\r?\n/, 1)[0]?.trim();
    if (!firstLine) return 'Untitled note';
    return firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine;
  }

  getFileName(note: QuickNote, extension: NoteFileExtension): string {
    const safeTitle = this.getTitle(note)
      .normalize('NFKC')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
      .replace(/\s+/g, ' ')
      .replace(/-+/g, '-')
      .replace(/[. ]+$/g, '')
      .slice(0, MAX_TITLE_LENGTH)
      .replace(/[. ]+$/g, '');
    const stem = safeTitle || 'quick-note';
    const fileStem = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem) ? `note-${stem}` : stem;
    return `${fileStem}.${extension}`;
  }

  async exportTextFile(note: QuickNote): Promise<string> {
    const fileName = this.getFileName(note, 'txt');
    if (isDesktopRuntime()) {
      const filePath = await exportNoteTextFile(fileName, note.content);
      void this.refreshExportFiles();
      return filePath;
    }
    this.download(note.content, fileName);
    return fileName;
  }

  async saveAsFile(note: QuickNote, extension: NoteFileExtension): Promise<string | null> {
    const fileName = this.getFileName(note, extension);
    if (isDesktopRuntime()) {
      const result: SaveNoteAsResult = await saveNoteAsFile(fileName, note.content, extension);
      if (!result.canceled) void this.refreshExportFiles();
      return result.canceled ? null : (result.filePath ?? fileName);
    }
    this.download(note.content, fileName);
    return fileName;
  }

  async refreshExportDirectory(): Promise<void> {
    if (!isDesktopRuntime()) return;
    try {
      this.setExportDirectoryInfo(await getNoteExportDirectory());
      await this.refreshExportFiles();
    } catch (error) {
      console.error('Could not load the Notes export folder:', error);
      this.exportDirectoryError.set('Could not load the Notes export folder.');
    }
  }

  async chooseExportDirectory(): Promise<string | null> {
    try {
      const result = await chooseNoteExportDirectory();
      if (result.canceled) return null;
      this.setExportDirectoryInfo(result);
      await this.refreshExportFiles();
      return result.directory;
    } catch (error) {
      console.error('Could not change the Notes export folder:', error);
      this.exportDirectoryError.set('Could not change the Notes export folder.');
      throw error;
    }
  }

  async resetExportDirectory(): Promise<string> {
    try {
      const result = await resetNoteExportDirectory();
      this.setExportDirectoryInfo(result);
      await this.refreshExportFiles();
      return result.directory;
    } catch (error) {
      console.error('Could not reset the Notes export folder:', error);
      this.exportDirectoryError.set('Could not reset the Notes export folder.');
      throw error;
    }
  }

  async refreshExportFiles(): Promise<void> {
    const requestId = ++this.exportFilesRequestId;
    if (!isDesktopRuntime()) {
      this.exportFiles.set([]);
      return;
    }
    this.exportFilesLoading.set(true);
    this.exportFilesError.set('');
    try {
      const files = await listNoteExportFiles();
      if (requestId === this.exportFilesRequestId) this.exportFiles.set(files);
    } catch (error) {
      if (requestId === this.exportFilesRequestId) {
        console.error('Could not list Notes files:', error);
        this.exportFilesError.set('Could not load files from the Notes export folder.');
      }
    } finally {
      if (requestId === this.exportFilesRequestId) this.exportFilesLoading.set(false);
    }
  }

  async openExportFile(fileName: string): Promise<void> {
    if (!isDesktopRuntime()) {
      throw new Error('Opening saved note files is only available in the desktop app.');
    }
    await openNoteExportFile(fileName);
  }

  private updateNote(id: string, update: (note: QuickNote) => QuickNote): void {
    const notes = this.notes();
    const index = notes.findIndex((note) => note.id === id);
    if (index < 0) return;
    const updatedNote = { ...update(notes[index]), updatedAt: new Date().toISOString() };
    const next = [...notes];
    next[index] = updatedNote;
    this.commit(next);
  }

  private loadNotes(): void {
    try {
      const saved = globalThis.localStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      const parsed: unknown = JSON.parse(saved);
      if (!Array.isArray(parsed)) throw new Error('Saved notes are not a list.');
      const notes = parsed.filter(isQuickNote);
      this.notes.set(notes);
      this.activeNoteId.set(notes[0]?.id ?? null);
    } catch (error) {
      console.error('Could not load quick notes:', error);
      this.storageError.set('Saved notes could not be loaded.');
    }
  }

  private readonly onStorageChange = (event: StorageEvent): void => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    if (event.storageArea && event.storageArea !== globalThis.localStorage) return;
    try {
      const saved = event.key === null ? null : event.newValue;
      const parsed: unknown = saved ? JSON.parse(saved) : [];
      if (!Array.isArray(parsed)) throw new Error('Saved notes are not a list.');
      const notes = parsed.filter(isQuickNote);
      const currentId = this.activeNoteId();
      this.notes.set(notes);
      if (!notes.some((note) => note.id === currentId)) {
        this.activeNoteId.set(notes[0]?.id ?? null);
      }
      this.storageError.set('');
    } catch (error) {
      console.error('Could not sync saved quick notes:', error);
      this.storageError.set('Saved notes could not be synchronized.');
    }
  };

  private commit(notes: QuickNote[]): void {
    this.notes.set(notes);
    try {
      globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
      this.storageError.set('');
    } catch (error) {
      console.error('Could not persist quick notes:', error);
      this.storageError.set('Notes are open, but browser storage could not save changes.');
    }
  }

  private setExportDirectoryInfo(info: { directory: string; defaultDirectory: string }): void {
    this.exportDirectory.set(info.directory);
    this.defaultExportDirectory.set(info.defaultDirectory);
    this.exportDirectoryError.set('');
  }

  private download(content: string, fileName: string): void {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    try {
      anchor.click();
    } finally {
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url));
    }
  }
}
