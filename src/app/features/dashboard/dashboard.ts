import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ClipboardStashService } from '../../core/clipboard-stash.service';
import type { ClipboardStashSlot } from '../../core/clipboard-stash.service';
import type { NoteExportFile } from '../../core/desktop-bridge';
import { NotesService } from '../../core/notes.service';
import type { NoteFileExtension, QuickNote } from '../../core/notes.service';
import { SoundService } from '../../core/sound.service';
import { Reminders } from '../reminders/reminders';
import { Settings } from '../settings/settings';
import { TaskList } from '../task-list/task-list';
import { Timer } from '../timer/timer';
import { HealthSettings } from '../health/health-settings';
import { CalendarView } from './calendar-view';
import { isDesktopRuntime } from '../../core/desktop-bridge';

type DashboardTab =
  | 'tasks'
  | 'timers'
  | 'reminders'
  | 'calendar'
  | 'health'
  | 'notes'
  | 'stash'
  | 'settings';

@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TaskList, Timer, Reminders, CalendarView, HealthSettings, Settings],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css'
})
export class Dashboard {
  activeTab = signal<DashboardTab>('tasks');

  readonly notesService = inject(NotesService);

  readonly clipboardStash = inject(ClipboardStashService);

  private readonly sound = inject(SoundService);

  readonly desktopAvailable = isDesktopRuntime();

  noteFormat = signal<NoteFileExtension>('txt');

  noteError = signal('');

  noteStatus = signal('');

  stashError = signal('');

  stashStatus = signal('');

  selectTab(tab: DashboardTab): void {
    this.activeTab.set(tab);
    if (tab === 'notes') void this.notesService.refreshExportFiles();
  }

  createNote(): void {
    this.notesService.createNote();
    this.noteError.set(this.notesService.storageError());
    this.noteStatus.set('');
    this.sound.play('noteCreate');
  }

  selectNote(id: string): void {
    this.notesService.selectNote(id);
    this.noteError.set(this.notesService.storageError());
    this.noteStatus.set('');
  }

  updateNoteTitle(id: string, title: string): void {
    this.notesService.updateTitle(id, title);
    this.updateNoteStatus();
  }

  updateNoteContent(id: string, content: string): void {
    this.notesService.updateContent(id, content);
    this.updateNoteStatus();
  }

  deleteActiveNote(): void {
    const note = this.notesService.activeNote();
    if (!note) return;
    this.notesService.deleteNote(note.id);
    this.noteError.set(this.notesService.storageError());
    this.noteStatus.set('Note deleted.');
  }

  setNoteFormat(format: string): void {
    if (format === 'txt' || format === 'md') this.noteFormat.set(format);
  }

  async exportActiveNote(): Promise<void> {
    const note = this.notesService.activeNote();
    if (!note) return;
    this.noteError.set('');
    this.noteStatus.set('');
    try {
      const filePath = await this.notesService.exportTextFile(note);
      this.sound.play('noteSaved');
      this.noteStatus.set(`Saved ${this.getFileLabel(filePath)}.`);
    } catch (error) {
      console.error('Could not export the dashboard note:', error);
      this.noteError.set('Could not save the note file. Please try again.');
    }
  }

  async saveActiveNoteAs(): Promise<void> {
    const note = this.notesService.activeNote();
    if (!note) return;
    this.noteError.set('');
    this.noteStatus.set('');
    try {
      const filePath = await this.notesService.saveAsFile(note, this.noteFormat());
      if (!filePath) return;
      this.sound.play('noteSaved');
      this.noteStatus.set(`Saved ${this.getFileLabel(filePath)}.`);
    } catch (error) {
      console.error('Could not save the dashboard note:', error);
      this.noteError.set('Could not save the note file. Please try again.');
    }
  }

  async changeNoteExportDirectory(): Promise<void> {
    this.noteError.set('');
    this.noteStatus.set('');
    try {
      const directory = await this.notesService.chooseExportDirectory();
      if (directory) this.noteStatus.set('Notes export folder updated.');
    } catch {
      this.noteError.set(this.notesService.exportDirectoryError());
    }
  }

  async resetNoteExportDirectory(): Promise<void> {
    this.noteError.set('');
    this.noteStatus.set('');
    try {
      await this.notesService.resetExportDirectory();
      this.noteStatus.set('Notes export folder reset to the default.');
    } catch {
      this.noteError.set(this.notesService.exportDirectoryError());
    }
  }

  async refreshNoteExportFiles(): Promise<void> {
    await this.notesService.refreshExportFiles();
  }

  async openNoteExportFile(fileName: string): Promise<void> {
    this.noteError.set('');
    try {
      await this.notesService.openExportFile(fileName);
    } catch (error) {
      console.error('Could not open a Notes export file:', error);
      this.noteError.set('Could not open that file. Check that it still exists.');
    }
  }

  async grabClipboard(): Promise<void> {
    this.stashError.set('');
    this.stashStatus.set('');
    try {
      await this.clipboardStash.grabCurrentClipboard();
      this.sound.play('clipboardGrab');
      this.stashStatus.set('Saved to stash.');
    } catch (error) {
      console.error('Could not grab the current clipboard:', error);
      this.stashError.set(
        error instanceof Error ? error.message : 'Could not read the clipboard.'
      );
    }
  }

  async copyClipboardSlot(slot: ClipboardStashSlot): Promise<void> {
    this.stashError.set('');
    this.stashStatus.set('');
    try {
      await this.clipboardStash.copyToClipboard(slot.id);
      this.sound.play('clipboardCopy');
      this.stashStatus.set('Copied to clipboard.');
    } catch (error) {
      console.error('Could not copy the clipboard stash item:', error);
      this.stashError.set(
        error instanceof Error ? error.message : 'Could not copy to the clipboard.'
      );
    }
  }

  toggleClipboardPin(id: string): void {
    this.stashError.set('');
    this.stashStatus.set('');
    try {
      this.clipboardStash.togglePin(id);
    } catch (error) {
      console.error('Could not change the clipboard stash pin:', error);
      this.stashError.set(
        error instanceof Error ? error.message : 'Could not update the clipboard item.'
      );
    }
  }

  removeClipboardSlot(id: string): void {
    this.stashError.set('');
    this.stashStatus.set('');
    try {
      this.clipboardStash.removeSlot(id);
    } catch (error) {
      console.error('Could not remove the clipboard stash item:', error);
      this.stashError.set(
        error instanceof Error ? error.message : 'Could not remove the clipboard item.'
      );
    }
  }

  clearClipboardStash(): void {
    this.stashError.set('');
    this.stashStatus.set('');
    try {
      this.clipboardStash.clearAll();
      this.stashStatus.set('Stash cleared.');
    } catch (error) {
      console.error('Could not clear the clipboard stash:', error);
      this.stashError.set(
        error instanceof Error ? error.message : 'Could not clear the clipboard stash.'
      );
    }
  }

  formatClipboardSavedAt(slot: ClipboardStashSlot): string {
    if (slot.pinned) return 'Pinned';
    const ageMinutes = Math.floor(Math.max(0, Date.now() - slot.savedAt) / 60_000);
    if (ageMinutes < 1) return 'Just now';
    if (ageMinutes < 60) return `${ageMinutes}m ago`;
    const ageHours = Math.floor(ageMinutes / 60);
    if (ageHours < 24) return `${ageHours}h ago`;
    return `${Math.floor(ageHours / 24)}d ago`;
  }

  formatNoteUpdatedAt(note: QuickNote): string {
    const updatedAt = Date.parse(note.updatedAt);
    if (!Number.isFinite(updatedAt)) return '';
    const ageMinutes = Math.floor(Math.max(0, Date.now() - updatedAt) / 60_000);
    if (ageMinutes < 1) return 'Just now';
    if (ageMinutes < 60) return `${ageMinutes}m ago`;
    const ageHours = Math.floor(ageMinutes / 60);
    if (ageHours < 24) return `${ageHours}h ago`;
    return `${Math.floor(ageHours / 24)}d ago`;
  }

  formatExportFileInfo(file: NoteExportFile): string {
    const updatedAt = Date.parse(file.modifiedAt);
    const modified = Number.isFinite(updatedAt) ? new Date(updatedAt).toLocaleString() : '';
    const size = file.size < 1024
      ? `${file.size} B`
      : `${(file.size / 1024).toFixed(1)} KB`;
    return modified ? `${size} · ${modified}` : size;
  }

  private updateNoteStatus(): void {
    const error = this.notesService.storageError();
    this.noteError.set(error);
    this.noteStatus.set(error ? '' : 'Saved');
  }

  private getFileLabel(filePath: string): string {
    return filePath.split(/[\\/]/).pop() || filePath;
  }
}