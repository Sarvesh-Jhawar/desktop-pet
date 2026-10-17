import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { Pet } from './pet';
import { Task } from '../../shared/task.model';

describe('Pet', () => {
  let component: Pet;
  let fixture: ComponentFixture<Pet>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Pet],
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

  it('shows a randomly selected motivational message', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);

    component.motivate();

    expect(component.bubbleVisible()).toBe(true);
    expect(component.bubbleMessage()).toBe(
      'You’ve got this, Sarvesh! Every small step is progress.'
    );

    random.mockRestore();
  });
});
