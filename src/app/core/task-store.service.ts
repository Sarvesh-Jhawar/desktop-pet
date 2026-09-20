import { Injectable } from '@angular/core';
import { load, Store } from '@tauri-apps/plugin-store';
import { v4 as uuidv4 } from 'uuid';
import { Task } from '../shared/task.model';

const TASKS_KEY = 'tasks';

@Injectable({ providedIn: 'root' })
export class TaskStoreService {
  private store?: Store;

  private async getStore(): Promise<Store> {
    if (!this.store) {
      this.store = await load('settings.json', { autoSave: false });
    }
    return this.store;
  }

  async getAllTasks(): Promise<Task[]> {
    const store = await this.getStore();
    const tasks = await store.get<Task[]>(TASKS_KEY);
    return tasks ?? [];
  }

  async saveAllTasks(tasks: Task[]): Promise<void> {
    const store = await this.getStore();
    await store.set(TASKS_KEY, tasks);
    await store.save();
  }

  async createTask(input: Omit<Task, 'id' | 'completed' | 'createdAt'>): Promise<Task> {
    const tasks = await this.getAllTasks();
    const newTask: Task = {
      ...input,
      id: uuidv4(),
      completed: false,
      createdAt: new Date().toISOString(),
    };
    tasks.push(newTask);
    await this.saveAllTasks(tasks);
    return newTask;
  }
}