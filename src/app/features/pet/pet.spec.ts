import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { Pet } from './pet';
import { Task } from '../../shared/task.model';
import { MotivationalQuoteService } from '../../core/motivational-quote.service';
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

  it('shows a quote from the motivational quote library', async () => {
    await component.motivate();

    expect(motivationalQuotes.next).toHaveBeenCalledOnce();
    expect(component.bubbleVisible()).toBe(true);
    expect(component.bubbleMessage()).toBe(
      'A little progress is still progress. Keep going!'
    );
  });
});
