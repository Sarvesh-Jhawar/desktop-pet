import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { Pet } from './pet';
import { Task } from '../../shared/task.model';
import { MotivationalQuoteService } from '../../core/motivational-quote.service';
import { TaskStoreService } from '../../core/task-store.service';
import type { MotivationalQuote } from '../../core/motivational-quote.service';

describe('Pet', () => {
  let component: Pet;
  let fixture: ComponentFixture<Pet>;
  const motivationalQuotes = {
    next: vi.fn<() => Promise<MotivationalQuote | null>>()
  };

  beforeEach(async () => {
    motivationalQuotes.next.mockReset();
    motivationalQuotes.next.mockResolvedValue({
      id: 'test_001',
      text: 'A little progress is still progress. Keep going!',
      category: 'small_wins'
    });
    await TestBed.configureTestingModule({
      imports: [Pet],
      providers: [
        { provide: MotivationalQuoteService, useValue: motivationalQuotes }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(Pet);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('includes every pending task in utterances within the engine text limit', () => {
    const tasks: Task[] = Array.from({ length: 30 }, (_, index) => ({
      id: `${index}`,
      title: `Task ${index + 1} ${'x'.repeat(120)}`,
      completed: false,
      priority: 'medium',
      createdAt: new Date(0).toISOString()
    }));

    const messages = component['createStartupGreeting'](tasks);
    const completeGreeting = messages.join(' ');

    for (const task of tasks) {
      expect(completeGreeting).toContain(task.title);
    }
    expect(messages.every(message => message.length <= 4000)).toBe(true);
  });

  it('opens the quick-action wheel on right-click and closes it with Escape', async () => {
    const canvas = fixture.nativeElement.querySelector('canvas') as HTMLCanvasElement;
    const contextMenu = new MouseEvent('contextmenu', {
      button: 2,
      clientX: 125,
      clientY: 125,
      bubbles: true,
      cancelable: true
    });

    canvas.dispatchEvent(contextMenu);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(contextMenu.defaultPrevented).toBe(true);
    expect(component.quickActionsVisible()).toBe(true);
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeTruthy();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();

    expect(component.quickActionsVisible()).toBe(false);
  });

  it('shows separate add and complete task screens with back navigation', async () => {
    const taskStore = TestBed.inject(TaskStoreService);
    const task: Task = {
      id: 'task-1',
      title: 'Prepare the dashboard',
      completed: false,
      priority: 'medium',
      createdAt: new Date(0).toISOString()
    };
    const addedTask: Task = {
      ...task,
      id: 'task-2',
      title: 'Review the dashboard'
    };
    vi.spyOn(taskStore, 'getAllTasks')
      .mockResolvedValueOnce([task])
      .mockResolvedValue([task, addedTask]);
    vi.spyOn(taskStore, 'createTask').mockResolvedValue(addedTask);
    vi.spyOn(taskStore, 'toggleComplete').mockResolvedValue({
      ...task,
      completed: true
    });

    await component.beginQuickTask();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Add Task');
    expect(fixture.nativeElement.textContent).toContain('Complete Task');

    component.openQuickAddTask();
    fixture.detectChanges();
    component.quickTaskTitle = 'Review the dashboard';
    await component.addQuickTask(new Event('submit'));
    fixture.detectChanges();

    expect(component.quickTaskMode()).toBe(true);
    expect(component.quickTaskAddMode()).toBe(true);
    expect(component.quickTasks().some(candidate => candidate.id === addedTask.id)).toBe(true);

    component.backToQuickTaskMenu();
    await component.openQuickCompleteTasks();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Review the dashboard');

    await component.toggleQuickTask(task);
    fixture.detectChanges();

    const checkbox = fixture.nativeElement.querySelector(
      '[aria-label="Reopen Prepare the dashboard"]'
    ) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(component.quickTaskMode()).toBe(true);
    expect(component.quickTaskCompleteMode()).toBe(true);
  });

  it('shows a quote from the motivational quote library', async () => {
    await component.motivate();

    expect(motivationalQuotes.next).toHaveBeenCalledOnce();
    expect(component.bubbleVisible()).toBe(true);
    expect(component.bubbleMessage()).toBe(
      'A little progress is still progress. Keep going!'
    );
  });
});
