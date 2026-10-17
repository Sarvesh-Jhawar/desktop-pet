import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  Rive,
  StateMachineInput
} from '@rive-app/webgl2';

import {
  getCurrentWindow
} from '@tauri-apps/api/window';

import {
  emit,
  listen
} from '@tauri-apps/api/event';

import { invoke } from '@tauri-apps/api/core';

import {
  LogicalSize,
  PhysicalPosition
} from '@tauri-apps/api/dpi';

import {
  load,
  Store
} from '@tauri-apps/plugin-store';

import { ReminderSchedulerService } from '../../core/reminder-scheduler.service';
import { Reminder } from '../../shared/reminder.model';
import { TimerService, TimerState } from '../../core/timer.service';
import { PetStateService } from '../../core/pet-state.service';
import { PetRulesService } from '../../core/pet-rules.service';
import { DialogueService } from '../../core/dialogue.service';
import { SoundService } from '../../core/sound.service';
import { SpeechService } from '../../core/speech.service';
import { TaskStoreService } from '../../core/task-store.service';
import {
  ActiveHealthHabit,
  HealthHabitService,
  HealthHabitTrigger
} from '../../core/health-habit.service';
import { Task } from '../../shared/task.model';

type PetSize = 'small' | 'medium' | 'large';

const SIZE_MAP: Record<PetSize, number> = {
  small: 150,
  medium: 250,
  large: 350
};

const SPEECH_BUBBLE_SYNC_DELAY_MS = 180;
const MOTIVATIONAL_MESSAGES = [
  'You’ve got this, Sarvesh! Every small step is progress.',
  'Believe in yourself. You are capable of more than you think.',
  'Take it one step at a time. You’re doing great!',
  'You don’t have to be perfect. Just keep moving forward.',
  'Your effort today is building something wonderful for tomorrow.',
  'A little progress is still progress. Keep going!'
];


@Component({
  selector: 'app-pet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [FormsModule],
  templateUrl: './pet.html',
  styleUrls: ['./pet.css', './health-banner.css']
})
export class Pet implements OnInit, OnDestroy {

  private readonly timerService = inject(TimerService);

  private readonly reminderScheduler = inject(ReminderSchedulerService);

  private readonly petState = inject(PetStateService);

  private readonly petRules = inject(PetRulesService);

  private readonly dialogue = inject(DialogueService);

  private readonly sound = inject(SoundService);

  private readonly speech = inject(SpeechService);

  private readonly taskStore = inject(TaskStoreService);

  readonly health = inject(HealthHabitService);

  private readonly isTauriRuntime =
    Boolean((globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

  private readonly speechQueue: Array<{
    message: string;
    fallbackDurationMs: number;
    resolve: () => void;
  }> = [];

  private processingSpeechQueue = false;

  private lastClickSpeechAt = 0;

  private startupGreeting?: Promise<void>;

  private petFocused = false;

  private riveLoaded = false;

  @ViewChild('petCanvas', { static: true })
  canvasRef!: ElementRef<HTMLCanvasElement>;

  @ViewChild('quickActionWheel')
  quickActionWheelRef?: ElementRef<HTMLDivElement>;

  quickActionsVisible = signal(false);

  quickTaskMode = signal(false);

  quickTaskTitle = '';

  quickActionPosition = signal({ x: 125, y: 125 });


  /*
   * =========================================================
   * RIVE
   * =========================================================
   */

  private rive?: Rive;

  private dizzyTrigger?: StateMachineInput;


  /*
   * =========================================================
   * DRAGGING
   * =========================================================
   */

  private mouseDownPos: {
    x: number;
    y: number;
  } | null = null;

  private readonly DRAG_THRESHOLD = 4;


  /*
   * =========================================================
   * POSITION PERSISTENCE
   * =========================================================
   */

  private store?: Store;

  private unlistenMoved?: () => void;

  private unlistenSizeChanged?: () => void;

  private unlistenTaskComplete?: () => void;

  private unlistenTimerCommand?: () => void;

  private unlistenTimerRequestState?: () => void;

  private unlistenSoundsToggled?: () => void;

  private unlistenPetFocus?: () => void;


  /*
   * =========================================================
   * PET SIZE
   * =========================================================
   */

  currentSize: PetSize = 'medium';


  /*
   * =========================================================
   * SPEECH BUBBLE
   * =========================================================
   */

  bubbleMessage = signal('');

  bubbleVisible = signal(false);

  private bubbleTimeout?: ReturnType<typeof setTimeout>;


  /*
   * =========================================================
   * INIT
   * =========================================================
   */

  async ngOnInit(): Promise<void> {

    if (this.isTauriRuntime) {
      this.health.onHabitStarted = habit => this.onHealthHabitStarted(habit);
      this.health.onHabitCompleted = (habit, completed) =>
        this.onHealthHabitCompleted(habit, completed);
      this.health.onMicroBreakFinished = (exercise, completed) => {
        if (!completed) {
          this.petState.resetToIdle();
          this.petRules.setTemporaryOverride(false);
          return;
        }
        this.petState.fireHealthTrigger('triggerCelebrate');
        this.petState.setState('celebrating');
        if (this.health.settings().healthChimesEnabled) this.sound.play('health');
        void this.enqueueSpeech(
          `Your break is over. Nice work with ${exercise.name.toLowerCase()}!`,
          3500
        );
        setTimeout(() => {
          this.petState.resetToIdle();
          this.petRules.setTemporaryOverride(false);
        }, 3500);
      };

      this.unlistenPetFocus = await getCurrentWindow().onFocusChanged(
        ({ payload: focused }) => {
          this.petFocused = focused;
          if (focused && this.riveLoaded) {
            void this.greetOnFirstShow().catch(error => {
              console.error('Failed to prepare Milly’s startup greeting:', error);
            });
          }
        }
      );

      await this.sound.init();
      try {
        await this.health.start();
      } catch (error) {
        console.error('Health reminders could not be started:', error);
      }
      this.unlistenSoundsToggled = await listen<boolean>(
        'sounds-toggled',
        event => this.sound.setEnabled(event.payload)
      );

      this.unlistenSizeChanged =
        await listen<PetSize>(
          'pet-size-changed',
          event => {
            this.setPetSize(event.payload);
          }
        );

      this.unlistenTaskComplete =
        await listen<{ title: string }>(
          'task-completed',
          event => {
            console.log('Received task-completed event payload:', event.payload);
            this.onTaskCompleted(event.payload.title).catch(error => {
              console.error('Failed to react to completed task:', error);
            });
          }
        );

      console.log('Pet task-completed listener registered');

      this.timerService.onComplete = (timer: TimerState) => {
        void this.onTimerCompleted(timer);
      };

      this.reminderScheduler.onReminderDue = (reminder: Reminder) => {
        void this.onReminderDue(reminder);
      };
      this.reminderScheduler.start();
      this.petRules.onRuleTriggered = context => {
        this.showBubble(this.dialogue.getMessage(context), 3000);
      };

      this.unlistenTimerCommand = await listen<{
        action: string;
        id?: string;
        label?: string;
        duration?: number;
      }>(
        'timer-command',
        event => {
          const { action, id, label, duration } = event.payload;
          if (action === 'add' && duration) this.timerService.add(label ?? '', duration);
          if (action === 'remove' && id) this.timerService.remove(id);
          if (action === 'start' && id) this.timerService.start(id);
          if (action === 'pause' && id) this.timerService.pause(id);
          if (action === 'resume' && id) this.timerService.resume(id);
          if (action === 'reset' && id) this.timerService.reset(id);
        }
      );

      this.unlistenTimerRequestState = await listen('timer-request-state', () => {
        void emit('timer-tick', this.timerService.getState());
      });
    }

    /*
     * ---------------------------------------------------------
     * Rive
     * ---------------------------------------------------------
     */

    this.rive = new Rive({

      src: 'assets/pet.riv',

      canvas: this.canvasRef.nativeElement,

      artboard: 'main',

      stateMachines: 'State Machine 1',

      autoplay: true,

      autoBind: true,

      onLoad: () => {

        console.log(
          'Milly Rive loaded successfully'
        );

        this.rive?.resizeDrawingSurfaceToCanvas();
        this.petState.attach(this.rive!);
        this.petRules.start();
        this.riveLoaded = true;


        const inputs =
          this.rive?.stateMachineInputs(
            'State Machine 1'
          );


        console.log(
          'Milly state machine inputs:',
          inputs
        );


        this.dizzyTrigger =
          inputs?.find(
            input =>
              input.name === 'DizzyTrigger'
          );

        const vm = this.rive?.defaultViewModel() as any;
        console.log('--- Default View Model ---', vm);

        if (vm) {
          console.log('--- View Model name ---', vm.name);
          console.log('--- Property count ---', vm.propertyCount);
          console.log('--- Properties (name + type) ---');
          vm.properties?.forEach((prop: any) => {
            console.log(`  name: "${prop.name}"  type: ${prop.type}`);
          });
        }

        const instance = this.rive?.viewModelInstance;
        if (instance && vm?.properties) {
          console.log('--- Live values on bound instance ---');
          vm.properties.forEach((prop: any) => {
            try {
              let liveValue: any;
              if (prop.type === 'boolean') liveValue = instance.boolean(prop.name)?.value;
              else if (prop.type === 'number') liveValue = instance.number(prop.name)?.value;
              else if (prop.type === 'string') liveValue = instance.string(prop.name)?.value;
              else if (prop.type === 'trigger') liveValue = '(trigger - no value)';
              else if (prop.type === 'enumType') liveValue = instance.enum(prop.name)?.value;
              console.log(`  ${prop.name} (${prop.type}) = ${liveValue}`);
            } catch (error) {
              console.log(`  ${prop.name} (${prop.type}) - couldn't read value`, error);
            }
          });
        }

console.log('--- All enums in file ---', JSON.stringify(this.rive?.enums(), null, 2));

        if (this.dizzyTrigger) {

          console.log(
            'DizzyTrigger found'
          );

        } else {

          console.warn(
            'DizzyTrigger not found'
          );
        }


        /*
         * -----------------------------------------------------
         * GREETING
         * -----------------------------------------------------
         */

        if (this.isTauriRuntime) {
          if (this.petFocused) {
            void this.greetOnFirstShow().catch(error => {
              console.error('Failed to prepare Milly’s startup greeting:', error);
            });
          }
        } else {
          this.showBubble(this.dialogue.getMessage('greeting'), 3000);
        }
      },


      onLoadError: (error) => {

        console.error(
          'Milly Rive failed to load:',
          error
        );
      }
    });


    /*
     * ---------------------------------------------------------
     * Mouse / dragging
     * ---------------------------------------------------------
     */

    const canvas =
      this.canvasRef.nativeElement;

    canvas.addEventListener(
      'contextmenu',
      this.onContextMenu
    );


    canvas.addEventListener(
      'mousedown',
      this.onMouseDown
    );


    window.addEventListener(
      'mousemove',
      this.onMouseMove
    );


    window.addEventListener(
      'mouseup',
      this.onMouseUp
    );

    window.addEventListener(
      'pointerdown',
      this.onGlobalPointerDown
    );

    window.addEventListener(
      'keydown',
      this.onQuickActionsKeyDown
    );


    /*
     * ---------------------------------------------------------
     * Persistence
     * ---------------------------------------------------------
     */

    if (this.isTauriRuntime) {
      this.initPersistence();
    } else {
      console.info('Tauri APIs are unavailable; running in browser preview mode.');
    }
  }


  /*
   * =========================================================
   * SPEECH BUBBLE
   * =========================================================
   */

  private showBubble(
    message: string,
    durationMs: number | null = 2500
  ): void {

    console.log(
      'Showing bubble:',
      message
    );


    this.bubbleMessage.set(message);
    this.bubbleVisible.set(true);


    if (this.bubbleTimeout) {

      clearTimeout(
        this.bubbleTimeout
      );
    }


    if (durationMs !== null) {
      this.bubbleTimeout =
        setTimeout(() => {

          this.hideBubble();

        }, durationMs);
    }
  }


  private hideBubble(expectedMessage?: string): void {
    if (expectedMessage && this.bubbleMessage() !== expectedMessage) {
      return;
    }

    console.log(
      'Hiding bubble'
    );

    this.bubbleVisible.set(false);
    this.bubbleTimeout = undefined;
  }

  private greetOnFirstShow(): Promise<void> {
    this.startupGreeting ??= this.loadStartupGreeting();
    return this.startupGreeting;
  }

  private async loadStartupGreeting(): Promise<void> {
    let messages: string[];
    try {
      const pendingTasks = (await this.taskStore.getAllTasks()).filter(
        task => !task.completed
      );
      messages = this.createStartupGreeting(pendingTasks);
    } catch (error) {
      console.error('Failed to load pending tasks for Milly’s greeting:', error);
      messages = ["Hi Sarvesh! Good to see you. Let's make today productive!"];
    }

    for (const message of messages) {
      await this.enqueueSpeech(message, 4000);
    }
  }

  private createStartupGreeting(pendingTasks: Task[]): string[] {
    if (pendingTasks.length === 0) {
      return [
        'Hi Sarvesh! Good to see you. You have no pending tasks right now. What shall we work on today?'
      ];
    }

    const taskCount = pendingTasks.length;
    const taskLabel = taskCount === 1 ? 'task' : 'tasks';
    let currentMessage =
      `Hi Sarvesh! Good to see you. You have ${taskCount} pending ${taskLabel}.`;
    const messages: string[] = [];

    for (const [index, task] of pendingTasks.entries()) {
      const taskText = `Task ${index + 1}: ${task.title}.`;
      if (taskText.length > 3400) {
        if (currentMessage) {
          messages.push(currentMessage);
          currentMessage = '';
        }
        const prefix = `Task ${index + 1} continued: `;
        let remainingTitle = task.title;
        let firstPart = true;
        while (remainingTitle.length > 0) {
          const partPrefix = firstPart ? `Task ${index + 1}: ` : prefix;
          const partLength = 3400 - partPrefix.length;
          messages.push(`${partPrefix}${remainingTitle.slice(0, partLength)}`);
          remainingTitle = remainingTitle.slice(partLength);
          firstPart = false;
        }
        continue;
      }
      if (!currentMessage) {
        currentMessage = 'More pending tasks.';
      }
      if (currentMessage.length + taskText.length + 1 > 3500) {
        messages.push(currentMessage);
        currentMessage = `More pending tasks. ${taskText}`;
      } else {
        currentMessage += ` ${taskText}`;
      }
    }

    if (currentMessage) {
      messages.push(currentMessage);
    }
    return messages;
  }

  private enqueueSpeech(
    message: string,
    fallbackDurationMs: number,
    throttleClick = false
  ): Promise<void> {
    if (!this.isTauriRuntime) {
      this.showBubble(message, fallbackDurationMs);
      return Promise.resolve();
    }

    const now = Date.now();
    if (throttleClick && now - this.lastClickSpeechAt < 5000) {
      return Promise.resolve();
    }
    if (throttleClick) {
      this.lastClickSpeechAt = now;
    }

    return new Promise(resolve => {
      this.speechQueue.push({ message, fallbackDurationMs, resolve });
      void this.processSpeechQueue();
    });
  }

  private async processSpeechQueue(): Promise<void> {
    if (this.processingSpeechQueue) {
      return;
    }
    this.processingSpeechQueue = true;

    try {
      while (this.speechQueue.length > 0) {
        const item = this.speechQueue.shift()!;
        let bubbleShown = false;
        let cancelled = false;
        let playbackEnded = false;
        let bubbleShowTimeout: ReturnType<typeof setTimeout> | undefined;
        try {
          while (await this.speech.isSpeaking()) {
            await new Promise(resolve => setTimeout(resolve, 250));
          }

          await this.speech.speakAndWait(item.message, {
            onPlaybackStart: () => {
              bubbleShown = true;
              bubbleShowTimeout = setTimeout(() => {
                bubbleShowTimeout = undefined;
                if (!cancelled && !playbackEnded) {
                  this.showBubble(item.message, null);
                }
              }, SPEECH_BUBBLE_SYNC_DELAY_MS);
            },
            onPlaybackEnd: () => {
              playbackEnded = true;
              if (bubbleShowTimeout) {
                clearTimeout(bubbleShowTimeout);
                bubbleShowTimeout = undefined;
              }
              this.hideBubble(item.message);
            },
            onPlaybackUnavailable: () => {
              bubbleShown = true;
              this.showBubble(item.message, item.fallbackDurationMs);
            },
            onPlaybackCancelled: () => {
              cancelled = true;
              if (bubbleShowTimeout) {
                clearTimeout(bubbleShowTimeout);
                bubbleShowTimeout = undefined;
              }
              this.hideBubble(item.message);
            }
          });
        } catch (error) {
          console.error('Failed to speak a pet interaction:', error);
          if (!bubbleShown) {
            this.showBubble(item.message, item.fallbackDurationMs);
          }
        } finally {
          if (bubbleShowTimeout) {
            clearTimeout(bubbleShowTimeout);
          }
          item.resolve();
        }
        if (cancelled) {
          for (const queuedItem of this.speechQueue.splice(0)) {
            queuedItem.resolve();
          }
        }
      }
    } finally {
      this.processingSpeechQueue = false;
    }
  }


  /*
   * =========================================================
   * POSITION + SIZE PERSISTENCE
   * =========================================================
   */

  private async initPersistence(): Promise<void> {

    try {

      console.log(
        'Starting persistence...'
      );


      this.store =
        await load(
          'settings.json',
          {
            autoSave: false
          }
        );


      console.log(
        'Store loaded successfully'
      );


      const win =
        getCurrentWindow();


      const savedAlwaysOnTop =
        await this.store.get<boolean>('alwaysOnTop');


      await win.setAlwaysOnTop(
        savedAlwaysOnTop ?? true
      );


      /*
       * -------------------------------------------------------
       * RESTORE POSITION
       * -------------------------------------------------------
       */

      const savedPosition =
        await this.store.get<{
          x: number;
          y: number;
        }>('petPosition');


      console.log(
        'Saved position:',
        savedPosition
      );


      if (savedPosition) {

        await win.setPosition(
          new PhysicalPosition(
            savedPosition.x,
            savedPosition.y
          )
        );

        console.log(
          'Position restored'
        );
      }


      /*
       * -------------------------------------------------------
       * RESTORE SIZE
       * -------------------------------------------------------
       */

      const savedSize =
        await this.store.get<PetSize>(
          'petSize'
        );


      console.log(
        'Saved size:',
        savedSize
      );


      if (savedSize) {

        /*
         * Apply without creating another
         * persistence operation.
         */

        this.applyPetSize(
          savedSize
        );
      }


      /*
       * -------------------------------------------------------
       * SAVE POSITION ON MOVE
       * -------------------------------------------------------
       */

      this.unlistenMoved =
        await win.onMoved(
          async ({ payload: position }) => {

            try {

              await this.store?.set(
                'petPosition',
                {
                  x: position.x,
                  y: position.y
                }
              );


              await this.store?.save();


              console.log(
                'Position saved:',
                position
              );

            } catch (error) {

              console.error(
                'Failed to save position:',
                error
              );
            }
          }
        );


      /*
       * -------------------------------------------------------
       * SAVE ON CLOSE
       * -------------------------------------------------------
       */

      await win.onCloseRequested(
        async () => {

          try {

            await this.store?.save();

            console.log(
              'Store saved before close'
            );

          } catch (error) {

            console.error(
              'Failed to save before close:',
              error
            );
          }
        }
      );


      console.log(
        'Persistence initialized'
      );

    } catch (error) {

      console.error(
        'Failed to initialize persistence:',
        error
      );
    }
  }


  /*
   * =========================================================
   * SET PET SIZE
   * =========================================================
   */

  async setPetSize(
    size: PetSize
  ): Promise<void> {

    console.log(
      'Changing Milly size to:',
      size
    );


    this.currentSize = size;


    this.applyPetSize(
      size
    );


    /*
     * Persist size
     */

    if (!this.store) {

      console.warn(
        'Store not available yet'
      );

      return;
    }


    try {

      await this.store.set(
        'petSize',
        size
      );


      await this.store.save();


      console.log(
        'Pet size saved:',
        size
      );

    } catch (error) {

      console.error(
        'Failed to save pet size:',
        error
      );
    }
  }


  /*
   * =========================================================
   * APPLY PET SIZE
   * =========================================================
   */

  private applyPetSize(
    size: PetSize
  ): void {

    const px =
      SIZE_MAP[size];


    this.currentSize =
      size;


    const canvas =
      this.canvasRef.nativeElement;


    canvas.style.width =
      `${px}px`;


    canvas.style.height =
      `${px}px`;


    /*
     * Update actual drawing surface.
     */

    canvas.width = px;
    canvas.height = px;

    if (this.isTauriRuntime) {
      void getCurrentWindow()
        .setSize(new LogicalSize(px, px))
        .catch(error => {
          console.error('Failed to resize pet window:', error);
        });
    }


    this.rive?.resizeDrawingSurfaceToCanvas();


    console.log(
      `Milly avatar resized to ${px}x${px}`
    );
  }


  /*
   * =========================================================
   * MOUSE DOWN
   * =========================================================
   */

  private onMouseDown = (
    event: MouseEvent
  ): void => {

    if (event.button !== 0) {
      this.mouseDownPos = null;
      return;
    }

    if (this.quickActionsVisible()) {
      this.closeQuickActions();
    }

    this.mouseDownPos = {
      x: event.clientX,
      y: event.clientY
    };
  };

  private onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    this.mouseDownPos = null;
    this.openQuickActionsAt(event.clientX, event.clientY);
  };

  private openQuickActionsAt(clientX: number, clientY: number): void {
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    const diameter = Math.min(
      240,
      Math.max(110, window.innerWidth - 8),
      Math.max(110, window.innerHeight - 8)
    );
    const radius = diameter / 2;
    const x = Math.min(
      Math.max(clientX - rect.left, radius + 4),
      rect.width - radius - 4
    );
    const y = Math.min(
      Math.max(clientY - rect.top, radius + 4),
      rect.height - radius - 4
    );

    this.quickTaskMode.set(false);
    this.quickTaskTitle = '';
    this.quickActionPosition.set({ x, y });
    this.quickActionsVisible.set(true);
    setTimeout(() => {
      this.quickActionWheelRef?.nativeElement.querySelector('button')?.focus();
    });
  }

  closeQuickActions(): void {
    this.quickActionsVisible.set(false);
    this.quickTaskMode.set(false);
    this.quickTaskTitle = '';
  }

  private onGlobalPointerDown = (event: PointerEvent): void => {
    if (!this.quickActionsVisible()) return;
    const target = event.target;
    if (target instanceof Node && this.quickActionWheelRef?.nativeElement.contains(target)) {
      return;
    }
    this.closeQuickActions();
  };

  private onQuickActionsKeyDown = (event: KeyboardEvent): void => {
    if (
      !this.quickActionsVisible() &&
      (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) &&
      event.target === this.canvasRef.nativeElement
    ) {
      event.preventDefault();
      const rect = this.canvasRef.nativeElement.getBoundingClientRect();
      this.openQuickActionsAt(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return;
    }

    if (event.key === 'Escape' && this.quickActionsVisible()) {
      this.closeQuickActions();
    }
  };

  async startQuickFocusTimer(): Promise<void> {
    const focusDuration = 25 * 60;
    let timer = this.timerService.getState().find(item => item.duration === focusDuration);
    if (!timer) {
      this.timerService.add('Focus', focusDuration);
      timer = this.timerService.getState().find(item => item.duration === focusDuration);
    }

    if (!timer) {
      const error = new Error('Could not create the 25-minute focus timer.');
      console.error(error);
      this.showBubble('I could not start the focus timer. Please try again.', 3000);
      this.closeQuickActions();
      return;
    }

    this.timerService.start(timer.id);
    this.closeQuickActions();
    const message = 'Your 25-minute focus timer has started. Let’s get started!';
    void this.enqueueSpeech(message, 3500);
  }

  beginQuickTask(): void {
    this.quickTaskMode.set(true);
    this.quickTaskTitle = '';
  }

  async addQuickTask(event: Event): Promise<void> {
    event.preventDefault();
    const title = this.quickTaskTitle.trim();
    if (!title) return;

    try {
      await this.taskStore.createTask({ title, priority: 'medium' });
      try {
        await emit('tasks-updated');
      } catch (error) {
        console.error('Task was saved, but other windows were not notified:', error);
      }
      this.closeQuickActions();
      this.showBubble(`Added task: ${title}`, 2500);
    } catch (error) {
      console.error('Failed to add quick task:', error);
      this.showBubble('I could not add that task. Please try again.', 3000);
      this.closeQuickActions();
    }
  }

  async openDashboardFromWheel(): Promise<void> {
    try {
      await invoke('open_dashboard');
      this.closeQuickActions();
    } catch (error) {
      console.error('Failed to open the Dashboard:', error);
      this.showBubble('I could not open the Dashboard. Please try again.', 3000);
      this.closeQuickActions();
    }
  }

  putPetToSleep(): void {
    this.closeQuickActions();
    this.petRules.setTemporaryOverride(true);
    this.petState.setState('sleeping');
    void this.enqueueSpeech('I’m taking a little nap. Click me when you want me back!', 3500);
  }

  feedPet(): void {
    this.closeQuickActions();
    this.onPetClick();
  }

  motivate(): void {
    const message = MOTIVATIONAL_MESSAGES[
      Math.floor(Math.random() * MOTIVATIONAL_MESSAGES.length)
    ];
    this.closeQuickActions();
    void this.enqueueSpeech(message, 4000);
  }


  /*
   * =========================================================
   * MOUSE MOVE
   * =========================================================
   */

  private onMouseMove = (
    event: MouseEvent
  ): void => {

    if (!this.mouseDownPos) {
      return;
    }


    const dx =
      Math.abs(
        event.clientX -
        this.mouseDownPos.x
      );


    const dy =
      Math.abs(
        event.clientY -
        this.mouseDownPos.y
      );


    const moved =
      dx > this.DRAG_THRESHOLD ||
      dy > this.DRAG_THRESHOLD;


    if (!moved) {
      return;
    }


    this.mouseDownPos = null;


    getCurrentWindow()
      .startDragging()
      .catch(error => {

        console.error(
          'Failed to start window dragging:',
          error
        );
      });
  };


  /*
   * =========================================================
   * MOUSE UP
   * =========================================================
   */

  private onMouseUp = (
    event: MouseEvent
  ): void => {

    if (event.button !== 0) {
      this.mouseDownPos = null;
      return;
    }

    if (!this.mouseDownPos) {
      return;
    }


    const dx =
      Math.abs(
        event.clientX -
        this.mouseDownPos.x
      );


    const dy =
      Math.abs(
        event.clientY -
        this.mouseDownPos.y
      );


    const moved =
      dx > this.DRAG_THRESHOLD ||
      dy > this.DRAG_THRESHOLD;


    if (!moved) {

      this.onPetClick();
    }


    this.mouseDownPos = null;
  };


  /*
   * =========================================================
   * PET CLICK
   * =========================================================
   */

  private onPetClick(): void {

    if (this.health.activeHabit()) {
      this.health.completeActiveHabitFromPet();
      return;
    }

    if (this.petState.getState() === 'sleeping') {
      this.petRules.setTemporaryOverride(false);
      this.petState.resetToIdle();
    }

    console.log(
      'PET CLICKED'
    );

    this.sound.play('click');


    /*
     * Animation
     */

    if (this.dizzyTrigger) {

      console.log(
        'Firing DizzyTrigger'
      );

      this.dizzyTrigger.fire();

    } else {

      console.warn(
        'DizzyTrigger is not ready yet'
      );
    }


    /*
     * Message
     */

    const message = this.dialogue.getMessage('click');


    console.log(
      'Pet message:',
      message
    );


    void this.enqueueSpeech(message, 2500, true);
  }


  private async onTaskCompleted(
    taskTitle: string
  ): Promise<void> {

    console.log('Entered onTaskCompleted:', taskTitle);
    const win = getCurrentWindow();
    console.log('Showing pet after task completion:', taskTitle);
    try {
      await win.show();
      await win.setFocus();
      console.log('Pet window shown and focused');
    } catch (error) {
      console.error('Failed to show or focus pet window:', error);
    }

    console.log(
      'dizzyTrigger before fire:',
      this.dizzyTrigger === undefined ? 'undefined' : this.dizzyTrigger
    );

    this.petRules.setTemporaryOverride(true);
    this.petState.setState('celebrating', true);
    this.sound.play('taskComplete');

    await this.greetOnFirstShow();
    const completionMessage =
      `Task ${taskTitle} complete! ${this.dialogue.getMessage('taskCompleted')}`;
    void this.enqueueSpeech(completionMessage, 3000);
    setTimeout(() => {
      this.petState.resetToIdle();
      this.petRules.setTemporaryOverride(false);
    }, 3000);
  }

  private async onTimerCompleted(timer: TimerState): Promise<void> {
    if (
      timer.duration === 25 * 60 &&
      this.health.settings().microBreaksEnabled
    ) {
      const exercise = this.health.startMicroBreak();
      if (exercise) {
        let breakTimer = this.timerService.getState().find(item => item.duration === 5 * 60);
        if (!breakTimer) {
          this.timerService.add('Short break', 5 * 60);
          breakTimer = this.timerService.getState().find(item => item.duration === 5 * 60);
        }
        if (breakTimer) {
          this.timerService.start(breakTimer.id);
          const win = getCurrentWindow();
          await win.show();
          await win.setFocus();
          return;
        }
        console.error('Could not start the five-minute micro-break timer.');
        this.health.finishMicroBreak(false);
      }
    }

    if (timer.duration === 5 * 60 && this.health.microBreakActive()) {
      this.health.finishMicroBreak();
      return;
    }

    const win = getCurrentWindow();
    await win.show();
    await win.setFocus();

    this.petRules.setTemporaryOverride(true);
    this.petState.setState('celebrating', true);
    this.sound.play('timerComplete');

    const completionMessage =
      `Focus timer "${timer.label}" complete! ${this.dialogue.getMessage('timerCompleted')}`;
    await this.greetOnFirstShow();
    void this.enqueueSpeech(completionMessage, 3500);
    setTimeout(() => {
      this.petState.resetToIdle();
      this.petRules.setTemporaryOverride(false);
    }, 3500);
  }

  private onHealthHabitStarted(habit: ActiveHealthHabit): void {
    const visualKind: 'eye-rest' | 'hydration' | 'posture' = habit.kind === 'stretch'
      ? habit.countsAs === 'hydration' ? 'hydration' : 'posture'
      : habit.kind;
    const triggerByKind: Record<'eye-rest' | 'hydration' | 'posture', HealthHabitTrigger> = {
      'eye-rest': 'triggerEyeRest',
      hydration: 'triggerHydrate',
      posture: 'triggerPosture'
    };

    this.petRules.setTemporaryOverride(true);
    this.petState.setState(visualKind);
    this.petState.fireHealthTrigger(triggerByKind[visualKind]);
    if (this.health.settings().healthChimesEnabled) this.sound.play('health');
    void getCurrentWindow().show().catch(error => {
      console.error('Failed to show Milly for a health reminder:', error);
    });
    void this.enqueueSpeech(habit.message, habit.durationSeconds * 1000);
  }

  private onHealthHabitCompleted(habit: ActiveHealthHabit, completed: boolean): void {
    if (!completed) {
      this.petState.resetToIdle();
      if (habit.kind !== 'stretch') this.petRules.setTemporaryOverride(false);
      return;
    }

    this.petState.fireHealthTrigger('triggerCelebrate');
    this.petState.setState('celebrating');
    if (this.health.settings().healthChimesEnabled) this.sound.play('health');
    const completionMessage = habit.countsAs === 'hydration'
      ? 'Wonderful! Thanks for refilling your water.'
      : habit.kind === 'eye-rest'
      ? 'Lovely! Your eyes will thank you for that little rest.'
      : habit.kind === 'hydration'
        ? 'Wonderful! Thanks for taking a moment to hydrate.'
        : habit.kind === 'posture'
          ? 'Great stretch! Your shoulders are feeling better already.'
          : `Nice work! ${habit.title} complete.`;
    void this.enqueueSpeech(completionMessage, 3500);

    if (habit.kind !== 'stretch') {
      setTimeout(() => {
        this.petState.resetToIdle();
        this.petRules.setTemporaryOverride(false);
      }, 3500);
    } else {
      setTimeout(() => this.petState.resetToIdle(), 3500);
    }
  }

  formatHealthTime(seconds: number): string {
    const wholeSeconds = Math.max(0, Math.ceil(seconds));
    const minutes = Math.floor(wholeSeconds / 60).toString().padStart(2, '0');
    const remainder = (wholeSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${remainder}`;
  }

  private async onReminderDue(reminder: Reminder): Promise<void> {
    const win = getCurrentWindow();
    await win.show();
    await win.setFocus();

    this.petRules.setTemporaryOverride(true);
    this.petState.setState('waiting');
    this.sound.play('reminder');

    this.showBubble(
      `${this.dialogue.getMessage('reminderDue')} ${reminder.title}`,
      4000
    );
    setTimeout(() => {
      this.petState.resetToIdle();
      this.petRules.setTemporaryOverride(false);
    }, 4000);
  }


  /*
   * =========================================================
   * CLEANUP
   * =========================================================
   */

  ngOnDestroy(): void {

    const canvas =
      this.canvasRef.nativeElement;


    canvas.removeEventListener(
      'mousedown',
      this.onMouseDown
    );

    canvas.removeEventListener(
      'contextmenu',
      this.onContextMenu
    );

    window.removeEventListener(
      'mousemove',
      this.onMouseMove
    );


    window.removeEventListener(
      'mouseup',
      this.onMouseUp
    );

    window.removeEventListener(
      'pointerdown',
      this.onGlobalPointerDown
    );

    window.removeEventListener(
      'keydown',
      this.onQuickActionsKeyDown
    );

    if (this.bubbleTimeout) {

      clearTimeout(
        this.bubbleTimeout
      );
    }


    if (this.unlistenMoved) {

      this.unlistenMoved();

      this.unlistenMoved =
        undefined;
    }


    if (this.unlistenSizeChanged) {

      this.unlistenSizeChanged();

      this.unlistenSizeChanged =
        undefined;
    }

    if (this.unlistenTaskComplete) {

      this.unlistenTaskComplete();

      this.unlistenTaskComplete =
        undefined;
    }

    this.unlistenTimerCommand?.();
    this.unlistenTimerRequestState?.();
    this.unlistenSoundsToggled?.();
    this.unlistenPetFocus?.();
    this.health.stop();
    this.health.onHabitStarted = undefined;
    this.health.onHabitCompleted = undefined;
    this.health.onMicroBreakFinished = undefined;
    this.timerService.onComplete = undefined;
    this.reminderScheduler.onReminderDue = undefined;
    this.reminderScheduler.stop();
    this.petRules.stop();


    this.rive?.cleanup();


    this.rive =
      undefined;


    this.dizzyTrigger =
      undefined;


    this.mouseDownPos =
      null;


    this.store =
      undefined;
  }
}