import { Injectable } from '@angular/core';
import { load, Store } from '@tauri-apps/plugin-store';
import { v4 as uuidv4 } from 'uuid';
import { Task } from '../shared/task.model';

const TASKS_KEY = 'tasks';
const LEGACY_TEST_TASK_TITLE = 'Test task from Phase 2 Step 1';

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
    const savedTasks = tasks ?? [];
    const cleanedTasks = savedTasks.filter(
      task => task.title !== LEGACY_TEST_TASK_TITLE
    );

    if (cleanedTasks.length !== savedTasks.length) {
      await this.saveAllTasks(cleanedTasks);
    }

    return cleanedTasks;
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
  async updateTask(id: string, changes: Partial<Omit<Task, 'id'>>): Promise<Task | null> {
  const tasks = await this.getAllTasks();
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) return null;

  tasks[index] = { ...tasks[index], ...changes };
  await this.saveAllTasks(tasks);
  return tasks[index];
}

async deleteTask(id: string): Promise<void> {
  const tasks = await this.getAllTasks();
  const filtered = tasks.filter((t) => t.id !== id);
  await this.saveAllTasks(filtered);
}

async toggleComplete(id: string): Promise<Task | null> {
  const tasks = await this.getAllTasks();
  const task = tasks.find((t) => t.id === id);
  if (!task) return null;

  return this.updateTask(id, { completed: !task.completed });
}
}