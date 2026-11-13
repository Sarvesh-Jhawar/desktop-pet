import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { Pet } from './pet';
import { Task } from '../../shared/task.model';
import { MotivationalQuoteService } from '../../core/motivational-quote.service';
import { MotivationalStoryService } from '../../core/motivational-story.service';
import { PetStateService } from '../../core/pet-state.service';
import { SpeechService } from '../../core/speech.service';
import { TaskStoreService } from '../../core/task-store.service';
import type { MotivationalQuote } from '../../core/motivational-quote.service';
import type { MotivationalStory } from '../../core/motivational-story.service';

describe('Pet', () => {
  let component: Pet;
  let fixture: ComponentFixture<Pet>;
  const motivationalQuotes = {
    next: vi.fn<() => Promise<MotivationalQuote | null>>()
  };
  const motivationalStories = {
    next: vi.fn<() => Promise<MotivationalStory | null>>()
  };

  beforeEach(async () => {
    motivationalQuotes.next.mockReset();
    motivationalStories.next.mockReset();
    motivationalQuotes.next.mockResolvedValue({
      id: 'test_001',
      text: 'A little progress is still progress. Keep going!',
      category: 'small_wins'
    });
    motivationalStories.next.mockResolvedValue({
      id: 'story_001',
      title: 'A Small Beginning',
      category: 'perseverance',
      story: 'A person kept learning after a setback.',
      takeaway: 'Small steps matter.',
      readingTimeMinutes: 1,
      sources: []
    });
    await TestBed.configureTestingModule({
      imports: [Pet],
      providers: [
        { provide: MotivationalQuoteService, useValue: motivationalQuotes },
        { provide: MotivationalStoryService, useValue: motivationalStories }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(Pet);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('keeps quick actions at Medium size as the pet changes size', () => {
    const canvases = Array.from(
      fixture.nativeElement.querySelectorAll('canvas')
    ) as HTMLCanvasElement[];
    component.quickActionsVisible.set(true);
    const sizes = [
      ['small', 150],
      ['medium', 250],
      ['large', 350]
    ] as const;

    for (const [size, pixels] of sizes) {
      component['applyPetSize'](size);
      fixture.detectChanges();

      expect(component.quickActionDiameter).toBe(220);
      const quickActionWheel = fixture.nativeElement.querySelector(
        '.quick-action-wheel'
      ) as HTMLElement;
      expect(quickActionWheel.style.width).toBe('220px');
      for (const canvas of canvases) {
        expect(canvas.width).toBe(pixels);
        expect(canvas.height).toBe(pixels);
        expect(canvas.style.width).toBe(`${pixels}px`);
        expect(canvas.style.height).toBe(`${pixels}px`);
      }
    }
  });

  it('keeps the design overlay aligned with each avatar size', () => {
    const overlay = fixture.nativeElement.querySelector(
      '.pet-design-overlay'
    ) as SVGElement;

    for (const [size, pixels] of [
      ['small', 150],
      ['medium', 250],
      ['large', 350]
    ] as const) {
      component['applyPetSize'](size);
      fixture.detectChanges();

      expect(overlay.style.width).toBe(`${pixels}px`);
      expect(overlay.style.height).toBe(`${pixels}px`);
    }
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
      clientX: 100,
      clientY: 75,
      bubbles: true,
      cancelable: true
    });

    canvas.dispatchEvent(contextMenu);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(contextMenu.defaultPrevented).toBe(true);
    expect(component.quickActionsVisible()).toBe(true);
    const quickActionWheel = fixture.nativeElement.querySelector(
      '[role="dialog"]'
    ) as HTMLElement;
    expect(quickActionWheel).toBeTruthy();
    expect(quickActionWheel.style.left).toBe('40%');
    expect(quickActionWheel.style.top).toBe('30%');

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

  it('clears the task loading error when a retry succeeds', async () => {
    const taskStore = TestBed.inject(TaskStoreService);
    vi.spyOn(taskStore, 'getAllTasks').mockResolvedValue([]);
    component.quickActionError.set('Could not load tasks. Please try again.');

    await component.beginQuickTask();

    expect(component.quickActionError()).toBe('');
    expect(component.quickTaskMode()).toBe(true);
  });

  it('shows a quote from the motivational quote library', async () => {
    await component.selectMotivationalQuote();

    expect(motivationalQuotes.next).toHaveBeenCalledOnce();
    expect(motivationalStories.next).not.toHaveBeenCalled();
    expect(component.bubbleVisible()).toBe(true);
    expect(component.bubbleMessage()).toBe(
      'A little progress is still progress. Keep going!'
    );
  });

  it('speaks the selected inspirational story with its takeaway', async () => {
    await component.selectInterestingStory();

    expect(motivationalStories.next).toHaveBeenCalledOnce();
    expect(motivationalQuotes.next).not.toHaveBeenCalled();
    expect(component.bubbleMessage()).toContain('A Small Beginning.');
    expect(component.bubbleMessage()).toContain('The takeaway: Small steps matter.');
  });

  it('speaks stories without adding a takeaway when none is provided', async () => {
    motivationalStories.next.mockResolvedValue({
      id: 'story_002',
      title: 'A Curious Discovery',
      category: 'discovery',
      story: 'A researcher noticed an unexpected result.',
      takeaway: null,
      readingTimeMinutes: 1,
      sources: []
    });

    await component.selectInterestingStory();

    expect(component.bubbleMessage()).toBe(
      'A Curious Discovery. A researcher noticed an unexpected result.'
    );
  });

  it('uses the speaking animation during playback and returns to idle', async () => {
    const petState = TestBed.inject(PetStateService);
    const speech = TestBed.inject(SpeechService);
    vi.spyOn(speech, 'isSpeaking').mockResolvedValue(false);
    vi.spyOn(speech, 'speakAndWait').mockImplementation(
      async (_text, callbacks) => {
        callbacks?.onPlaybackStart?.();
        expect(petState.getState()).toBe('talking');
        callbacks?.onPlaybackEnd?.();
      }
    );

    await component['enqueueSpeech']('Hello there.', 1000);

    expect(petState.getState()).toBe('idle');
  });

  it('returns to idle when speech playback is cancelled', async () => {
    const petState = TestBed.inject(PetStateService);
    const speech = TestBed.inject(SpeechService);
    vi.spyOn(speech, 'isSpeaking').mockResolvedValue(false);
    vi.spyOn(speech, 'speakAndWait').mockImplementation(
      async (_text, callbacks) => {
        callbacks?.onPlaybackStart?.();
        callbacks?.onPlaybackCancelled?.();
      }
    );

    await component['enqueueSpeech']('Hello there.', 1000);

    expect(petState.getState()).toBe('idle');
  });

  it('keeps an active pet state while speech plays', async () => {
    const petState = TestBed.inject(PetStateService);
    const speech = TestBed.inject(SpeechService);
    petState.setState('celebrating');
    vi.spyOn(speech, 'isSpeaking').mockResolvedValue(false);
    vi.spyOn(speech, 'speakAndWait').mockImplementation(
      async (_text, callbacks) => {
        callbacks?.onPlaybackStart?.();
        expect(petState.getState()).toBe('celebrating');
        callbacks?.onPlaybackEnd?.();
      }
    );

    await component['enqueueSpeech']('Well done!', 1000);

    expect(petState.getState()).toBe('celebrating');
  });

  it('opens the Motivation menu with quote and story choices', () => {
    component.quickActionsVisible.set(true);
    fixture.detectChanges();

    fixture.nativeElement.querySelector('.motivate-action').click();
    fixture.detectChanges();

    expect(component.quickMotivationMode()).toBe(true);
    expect(fixture.nativeElement.querySelector('.motivation-quote-choice')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.motivation-story-choice')).toBeTruthy();
  });

  it('lets the dialogue expand and minimize without moving', () => {
    component.bubbleMessage.set('Hello from Milly.');
    component.bubbleVisible.set(true);
    component.speechBubbleMinimized.set(true);
    fixture.detectChanges();

    fixture.nativeElement.querySelector('[aria-label="Expand dialogue"]').click();
    fixture.detectChanges();

    expect(component.speechBubbleMinimized()).toBe(false);
    expect(fixture.nativeElement.querySelector('.speech-bubble-text').textContent)
      .toContain('Hello from Milly.');

    fixture.nativeElement.querySelector('[aria-label="Minimize dialogue"]').click();
    fixture.detectChanges();
    expect(component.speechBubbleMinimized()).toBe(true);
  });

  it('moves speech to the selected previous or next sentence', async () => {
    const speech = TestBed.inject(SpeechService);
    const stop = vi.spyOn(speech, 'stop').mockResolvedValue();
    const item = {
      message: 'First. Second.',
      sentences: ['First.', 'Second.'],
      sentenceIndex: 0,
      navigationVersion: 0,
      fallbackDurationMs: 4000,
      generation: 0,
      resolve: vi.fn()
    };
    component['activeSpeechItem'] = item;
    component.speechPlaybackActive.set(true);
    component.speechSentences.set(item.sentences);
    component.activeSpeechSentenceIndex.set(0);

    await component.nextSpeechSentence();
    expect(item.sentenceIndex).toBe(1);
    expect(component.currentSpeechSentence()).toBe('Second.');

    await component.previousSpeechSentence();
    expect(item.sentenceIndex).toBe(0);
    expect(component.currentSpeechSentence()).toBe('First.');
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it('speaks the welcome before waiting for saved tasks', async () => {
    const taskStore = TestBed.inject(TaskStoreService);
    let resolveTasks!: (tasks: Task[]) => void;
    vi.spyOn(taskStore, 'getAllTasks').mockReturnValue(
      new Promise(resolve => {
        resolveTasks = resolve;
      })
    );

    const greeting = component['loadStartupGreeting']();
    expect(component.bubbleMessage()).toContain('Hi Sarvesh! Good to see you.');

    await Promise.resolve();
    resolveTasks([]);
    await greeting;
  });

});
