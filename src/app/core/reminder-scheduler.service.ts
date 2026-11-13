import { Injectable, inject } from '@angular/core';
import { emit, isDesktopRuntime, sendNotification } from './desktop-bridge';
import { ReminderStoreService } from './reminder-store.service';
import { Reminder } from '../shared/reminder.model';
import { CalendarStoreService } from './calendar-store.service';
import { CalendarEvent } from '../shared/calendar-event.model';

const CHECK_INTERVAL_MS = 20_000;

@Injectable({ providedIn: 'root' })
export class ReminderSchedulerService {
  private readonly reminderStore = inject(ReminderStoreService);
  private readonly calendarStore = inject(CalendarStoreService);
  private intervalId?: ReturnType<typeof setInterval>;
  private checking = false;

  onReminderDue?: (reminder: Reminder) => void;

  start(): void {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => {
      void this.checkDue().catch(error => {
        console.error('Failed to check scheduled reminders:', error);
      });
    }, CHECK_INTERVAL_MS);
    void this.checkDue().catch(error => {
      console.error('Failed to check scheduled reminders:', error);
    });
  }

  async checkDue(): Promise<void> {
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

      await this.checkCalendarEvents(now);
    } finally {
      this.checking = false;
    }
  }

  private async checkCalendarEvents(now: Date): Promise<void> {
    const events = await this.calendarStore.getAll();
    for (const event of events) {
      if (
        event.completed ||
        event.reminderDismissed ||
        event.reminderMinutesBefore === undefined
      ) {
        continue;
      }

      const eventTime = getEventTime(event);
      if (!Number.isFinite(eventTime.getTime())) {
        console.error(`Skipping calendar reminder with an invalid date: ${event.id}`);
        continue;
      }
      if (now > eventTime) {
        if (event.reminderTriggered || event.reminderSnoozedUntil) {
          await this.calendarStore.dismissReminder(event.id);
        }
        continue;
      }
      if (event.reminderTriggered) continue;

      const reminderTime = event.reminderSnoozedUntil
        ? new Date(event.reminderSnoozedUntil)
        : new Date(eventTime.getTime() - event.reminderMinutesBefore * 60_000);
      if (now < reminderTime || now > eventTime) continue;

      const triggeredEvent = await this.calendarStore.markReminderTriggered(event.id);
      if (!triggeredEvent) continue;
      await emit('calendar-event-triggered', triggeredEvent);

      if (isDesktopRuntime()) {
        await sendNotification({
          title: `Upcoming: ${triggeredEvent.title}`,
          body: `Starts at ${eventTime.toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit'
          })}.`
        }).catch(error => {
          console.error('Failed to show calendar event notification:', error);
        });
      }
    }
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }
}

function getEventTime(event: CalendarEvent): Date {
  const [year, month, day] = event.date.split('-').map(Number);
  const [hours, minutes] = (event.time || '09:00').split(':').map(Number);
  return new Date(year, month - 1, day, hours, minutes);
}