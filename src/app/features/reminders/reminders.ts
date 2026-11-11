import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  inject,
  signal
} from '@angular/core';
import { isDesktopRuntime, listen } from '../../core/desktop-bridge';
import { FormsModule } from '@angular/forms';
import { ReminderStoreService } from '../../core/reminder-store.service';
import { Reminder } from '../../shared/reminder.model';

@Component({
  selector: 'app-reminders',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  templateUrl: './reminders.html',
  styleUrl: './reminders.css'
})
export class Reminders implements OnInit, OnDestroy {
  private readonly store = inject(ReminderStoreService);

  reminders = signal<Reminder[]>([]);
  newTitle = '';
  newDateTime = '';
  newRepeatMinutes: number | null = null;
  private unlistenReminders?: () => void;

  async ngOnInit(): Promise<void> {
    await this.refresh();
    if (isDesktopRuntime()) {
      try {
        this.unlistenReminders = await listen('reminders-updated', () => {
          void this.refresh().catch(error => {
            console.error('Failed to refresh reminders after an update:', error);
          });
        });
      } catch (error) {
        console.error('Failed to listen for reminder updates:', error);
      }
    }
  }

  async refresh(): Promise<void> {
    this.reminders.set(
      (await this.store.getAll()).filter(reminder => !reminder.completed)
    );
  }

  async add(): Promise<void> {
    if (!this.newTitle.trim() || !this.newDateTime) return;
    const reminder = await this.store.create(
      this.newTitle.trim(),
      new Date(this.newDateTime).toISOString()
    );
    if (this.newRepeatMinutes) {
      await this.store.update(reminder.id, {
        repeatIntervalMinutes: this.newRepeatMinutes
      });
    }
    this.newTitle = '';
    this.newDateTime = '';
    this.newRepeatMinutes = null;
    await this.refresh();
  }

  async addPreset(title: string, minutes: number): Promise<void> {
    const reminder = await this.store.create(
      title,
      new Date(Date.now() + minutes * 60_000).toISOString()
    );
    await this.store.update(reminder.id, { repeatIntervalMinutes: minutes });
    await this.refresh();
  }

  async addTestReminder(): Promise<void> {
    await this.store.create(
      'Drink water (test)',
      new Date(Date.now() + 30_000).toISOString()
    );
    await this.refresh();
  }

  async dismiss(reminder: Reminder): Promise<void> {
    await this.store.update(reminder.id, { completed: true });
    await this.refresh();
  }

  async snooze(reminder: Reminder, minutes: number): Promise<void> {
    const snoozedUntil = new Date(Date.now() + minutes * 60_000).toISOString();
    await this.store.update(reminder.id, { triggered: false, snoozedUntil });
    await this.refresh();
  }

  async delete(reminder: Reminder): Promise<void> {
    await this.store.delete(reminder.id);
    await this.refresh();
  }

  ngOnDestroy(): void {
    this.unlistenReminders?.();
  }
}