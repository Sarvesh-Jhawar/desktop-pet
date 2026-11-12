import { TestBed } from '@angular/core/testing';
import { TaskStoreService } from './task-store.service';
import { Task } from '../shared/task.model';

describe('TaskStoreService', () => {
  const storageKey = 'desktop-pet:settings.json';
  let service: TaskStoreService;

  beforeEach(() => {
    localStorage.removeItem(storageKey);
    TestBed.configureTestingModule({
      providers: [TaskStoreService]
    });
    service = TestBed.inject(TaskStoreService);
  });

  afterEach(() => {
    localStorage.removeItem(storageKey);
  });

  it('refreshes tasks saved by another window before reading them', async () => {
    localStorage.setItem(storageKey, JSON.stringify({ tasks: [] }));
    expect(await service.getAllTasks()).toEqual([]);

    const task: Task = {
      id: 'another-window-task',
      title: 'Read this task',
      completed: false,
      priority: 'medium',
      createdAt: new Date(0).toISOString()
    };
    localStorage.setItem(storageKey, JSON.stringify({ tasks: [task] }));

    expect(await service.getAllTasks()).toEqual([task]);
  });
});
