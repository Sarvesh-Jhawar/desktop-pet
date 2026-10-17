import { ComponentFixture, TestBed } from '@angular/core/testing';

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
});
