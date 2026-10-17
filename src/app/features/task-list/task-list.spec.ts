import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { TaskList } from './task-list';
import { TaskStoreService } from '../../core/task-store.service';

describe('TaskList', () => {
  let component: TaskList;
  let fixture: ComponentFixture<TaskList>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TaskList],
      providers: [
        {
          provide: TaskStoreService,
          useValue: { getAllTasks: vi.fn().mockResolvedValue([]) }
        }
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TaskList);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders stored tasks after the asynchronous initial load', async () => {
    const tasks = [
      {
        id: 'task-1',
        title: 'Prepare the dashboard',
        completed: false,
        priority: 'medium' as const,
        createdAt: new Date(0).toISOString()
      }
    ];
    const taskStore = TestBed.inject(TaskStoreService);
    vi.mocked(taskStore.getAllTasks).mockResolvedValue(tasks);

    await component.refresh();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Prepare the dashboard');
  });
});
