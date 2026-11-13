import { Injectable } from '@angular/core';
import { v4 as uuidv4 } from 'uuid';
import { load, Store } from './desktop-bridge';
import { CalendarEvent } from '../shared/calendar-event.model';

const CALENDAR_EVENTS_KEY = 'calendarEvents';

@Injectable({ providedIn: 'root' })
export class CalendarStoreService {
  private store?: Store;

  private async getStore(): Promise<Store> {
    if (!this.store) {
      this.store = await load('settings.json', { autoSave: false });
    }
    return this.store;
  }

  async getAll(): Promise<CalendarEvent[]> {
    const store = await this.getStore();
    return (await store.get<CalendarEvent[]>(CALENDAR_EVENTS_KEY)) ?? [];
  }

  async create(event: Omit<CalendarEvent, 'id'>): Promise<CalendarEvent> {
    const events = await this.getAll();
    const calendarEvent: CalendarEvent = { ...event, id: uuidv4() };
    events.push(calendarEvent);
    await this.saveAll(events);
    return calendarEvent;
  }

  async update(
    id: string,
    changes: Partial<Omit<CalendarEvent, 'id'>>
  ): Promise<CalendarEvent | null> {
    const events = await this.getAll();
    const index = events.findIndex(event => event.id === id);
    if (index === -1) return null;

    const scheduleChanged = ['date', 'time', 'reminderMinutesBefore'].some(
      key => key in changes
    );
    events[index] = {
      ...events[index],
      ...changes,
      ...(scheduleChanged
        ? {
            reminderTriggered: false,
            reminderSnoozedUntil: undefined,
            reminderDismissed: false
          }
        : {})
    };
    await this.saveAll(events);
    return events[index];
  }

  async markReminderTriggered(id: string): Promise<CalendarEvent | null> {
    return this.update(id, {
      reminderTriggered: true,
      reminderSnoozedUntil: undefined
    });
  }

  async snoozeReminder(id: string, minutes = 10): Promise<void> {
    if (!Number.isFinite(minutes) || minutes < 1) {
      throw new Error('Snooze duration must be at least one minute.');
    }
    const updated = await this.update(id, {
      reminderTriggered: false,
      reminderDismissed: false,
      reminderSnoozedUntil: new Date(Date.now() + minutes * 60_000).toISOString()
    });
    if (!updated) throw new Error(`Calendar event "${id}" no longer exists.`);
  }

  async dismissReminder(id: string): Promise<void> {
    const updated = await this.update(id, {
      reminderTriggered: true,
      reminderDismissed: true,
      reminderSnoozedUntil: undefined
    });
    if (!updated) throw new Error(`Calendar event "${id}" no longer exists.`);
  }

  async delete(id: string): Promise<void> {
    const events = await this.getAll();
    await this.saveAll(events.filter(event => event.id !== id));
  }

  private async saveAll(events: CalendarEvent[]): Promise<void> {
    const store = await this.getStore();
    await store.set(CALENDAR_EVENTS_KEY, events);
    await store.save();
  }
}
