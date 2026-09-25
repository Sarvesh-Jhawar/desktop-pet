import { Injectable } from '@angular/core';
import { load, Store } from '@tauri-apps/plugin-store';
import { v4 as uuidv4 } from 'uuid';
import { Reminder } from '../shared/reminder.model';

const REMINDERS_KEY = 'reminders';

@Injectable({ providedIn: 'root' })
export class ReminderStoreService {
  private store?: Store;

  private async getStore(): Promise<Store> {
    if (!this.store) {
      this.store = await load('settings.json', { autoSave: false });
    }
    return this.store;
  }

  async getAll(): Promise<Reminder[]> {
    const store = await this.getStore();
    return (await store.get<Reminder[]>(REMINDERS_KEY)) ?? [];
  }

  async saveAll(reminders: Reminder[]): Promise<void> {
    const store = await this.getStore();
    await store.set(REMINDERS_KEY, reminders);
    await store.save();
  }

  async create(title: string, scheduledAt: string): Promise<Reminder> {
    const reminders = await this.getAll();
    const reminder: Reminder = {
      id: uuidv4(),
      title,
      scheduledAt,
      completed: false,
      triggered: false
    };
    reminders.push(reminder);
    await this.saveAll(reminders);
    return reminder;
  }

  async update(id: string, changes: Partial<Omit<Reminder, 'id'>>): Promise<void> {
    const reminders = await this.getAll();
    const index = reminders.findIndex(reminder => reminder.id === id);
    if (index === -1) return;
    reminders[index] = { ...reminders[index], ...changes };
    await this.saveAll(reminders);
  }

  async delete(id: string): Promise<void> {
    const reminders = await this.getAll();
    await this.saveAll(reminders.filter(reminder => reminder.id !== id));
  }
}