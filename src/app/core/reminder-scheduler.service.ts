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
          const triggeredReminder = { ...reminder, triggered: true, snoozedUntil: undefined };
          await this.reminderStore.update(reminder.id, {
            triggered: true,
            snoozedUntil: undefined
          });
          await emit('reminder-triggered', triggeredReminder);
          this.onReminderDue?.(triggeredReminder);
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