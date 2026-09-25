import { Injectable, inject } from '@angular/core';
import { emit } from '@tauri-apps/api/event';
import { ReminderStoreService } from './reminder-store.service';
import { Reminder } from '../shared/reminder.model';

const CHECK_INTERVAL_MS = 20_000;

@Injectable({ providedIn: 'root' })
export class ReminderSchedulerService {
  private readonly reminderStore = inject(ReminderStoreService);
  private intervalId?: ReturnType<typeof setInterval>;
  private checking = false;

  onReminderDue?: (reminder: Reminder) => void;

  start(): void {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => void this.checkDue(), CHECK_INTERVAL_MS);
    void this.checkDue();
  }

  private async checkDue(): Promise<void> {
    if (this.checking) return;
    this.checking = true;

    try {
      const reminders = await this.reminderStore.getAll();
      const now = new Date();

      for (const reminder of reminders) {
        if (reminder.completed || reminder.triggered) continue;

        const effectiveTime = reminder.snoozedUntil
          ? new Date(reminder.snoozedUntil)
          : new Date(reminder.scheduledAt);

        if (effectiveTime <= now) {
          if (reminder.repeatIntervalMinutes) {
            const nextTime = new Date(
              now.getTime() + reminder.repeatIntervalMinutes * 60_000
            ).toISOString();
            await this.reminderStore.update(reminder.id, {
              scheduledAt: nextTime,
              snoozedUntil: undefined,
              triggered: false
            });
          } else {
            await this.reminderStore.update(reminder.id, {
              triggered: true,
              snoozedUntil: undefined
            });
          }

          await emit('reminder-triggered', reminder);
          this.onReminderDue?.(reminder);
        }
      }
    } finally {
      this.checking = false;
    }
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }
}