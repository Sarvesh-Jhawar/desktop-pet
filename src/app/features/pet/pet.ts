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
} from '@rive-app/canvas';

import {
  emit,
  getCurrentWindow,
  invoke,
  isDesktopRuntime,
  listen,
  load,
  LogicalSize,
  PhysicalPosition,
  Store
} from '../../core/desktop-bridge';

import { ReminderSchedulerService } from '../../core/reminder-scheduler.service';
import { ReminderStoreService } from '../../core/reminder-store.service';
import { Reminder } from '../../shared/reminder.model';
import { TimerService, TimerState } from '../../core/timer.service';
import { PetStateService } from '../../core/pet-state.service';
import { PetRulesService } from '../../core/pet-rules.service';
import { DialogueService } from '../../core/dialogue.service';
import { SoundService } from '../../core/sound.service';
import { SpeechService } from '../../core/speech.service';
import { MotivationalQuoteService } from '../../core/motivational-quote.service';
import { MotivationalStoryService } from '../../core/motivational-story.service';
import { TaskStoreService } from '../../core/task-store.service';
import {
  ActiveHealthHabit,
  HealthHabitService,
  HealthHabitTrigger
} from '../../core/health-habit.service';
import { Task } from '../../shared/task.model';

type PetSize = 'small' | 'medium' | 'large';
type QuickActionCommand =
  | { action: 'start-timer'; duration: number; label: string }
  | { action: 'motivate'; content: 'quote' | 'story' }
  | { action: 'read-out'; category: 'tasks' | 'timers' | 'reminders' }
  | { action: 'reminder-added'; title: string };

interface SpeechQueueItem {
  message: string;
  sentences: string[];
  sentenceIndex: number;
  fallbackDurationMs: number;
  generation: number;
  resolve: () => void;
}

function splitIntoSentences(message: string): string[] {
  const sentences = message.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g);
  return sentences?.map(sentence => sentence.trim()).filter(Boolean) ?? [message];
}

const SIZE_MAP: Record<PetSize, number> = {
  small: 150,
  medium: 250,
  large: 350
};

const QUICK_ACTION_DIAMETER = Math.round(SIZE_MAP.medium * 0.88);

const SPEECH_BUBBLE_SYNC_DELAY_MS = 180;
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

  private readonly reminderStore = inject(ReminderStoreService);

  private readonly petState = inject(PetStateService);

  private readonly petRules = inject(PetRulesService);

  private readonly dialogue = inject(DialogueService);

  private readonly sound = inject(SoundService);

  private readonly speech = inject(SpeechService);

  private readonly motivationalQuotes = inject(MotivationalQuoteService);

  private readonly motivationalStories = inject(MotivationalStoryService);

  private readonly taskStore = inject(TaskStoreService);

  readonly health = inject(HealthHabitService);

  private readonly isDesktopShell =
    isDesktopRuntime();

  readonly quickActionsOverlay =
    this.isDesktopShell &&
    globalThis.location.hash.replace(/^#\/?/, '').split('?')[0] === 'quick-actions';

  readonly transparencyTestMode =
    new URLSearchParams(globalThis.location.search).get('transparencyTest') === '1';

  private windowDragging = false;

  private mouseEventsIgnored = false;

  private readonly speechQueue: SpeechQueueItem[] = [];

  private activeSpeechItem?: SpeechQueueItem;

  private processingSpeechQueue = false;

  private speechQueueGeneration = 0;

  private lastClickSpeechAt = 0;

  private startupGreeting?: Promise<void>;

  private petFocused = false;

  private riveLoaded = false;
  private backgroundRemovalFrame?: number;
  private unlistenGlobalCursor?: () => void;

  @ViewChild('petCanvas', { static: true })
  canvasRef!: ElementRef<HTMLCanvasElement>;

  @ViewChild('petDisplayCanvas', { static: true })
  displayCanvasRef!: ElementRef<HTMLCanvasElement>;

  @ViewChild('quickActionWheel')
  quickActionWheelRef?: ElementRef<HTMLDivElement>;

  quickActionsVisible = signal(false);

  quickTimerMode = signal(false);

  quickReminderMode = signal(false);

  quickReadOutMode = signal(false);

  quickMotivationMode = signal(false);

  quickTimerLabelMode = signal(false);

  quickCustomTimerMode = signal(false);

  quickTaskMode = signal(false);

  quickTaskAddMode = signal(false);

  quickTaskCompleteMode = signal(false);

  quickTimerMinutes = 25;

  quickTimerLabel = '';

  quickTimerError = signal('');

  quickReminderTitle = '';

  quickReminderDateTime = '';

  quickReminderError = signal('');

  quickTaskTitle = '';

  quickTasks = signal<Task[]>([]);

  quickTaskError = signal('');

  quickActionError = signal('');

  readonly quickActionDiameter = QUICK_ACTION_DIAMETER;

  quickActionPosition = signal({ x: 50, y: 50 });


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

  private unlistenQuickActionCommand?: () => void;


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

  speechBubbleMinimized = signal(true);

  speechSentences = signal<string[]>([]);

  currentSpeechSentence = signal('');

  activeSpeechSentenceIndex = signal(-1);

  speechPlaybackActive = signal(false);

  private bubbleTimeout?: ReturnType<typeof setTimeout>;

  /*
   * =========================================================
   * INIT
   * =========================================================
   */

  async ngOnInit(): Promise<void> {

    if (this.quickActionsOverlay) {
      this.quickActionsVisible.set(true);
      window.addEventListener('pointerdown', this.onGlobalPointerDown);
      window.addEventListener('keydown', this.onQuickActionsKeyDown);
      setTimeout(() => {
        this.quickActionWheelRef?.nativeElement.querySelector('button')?.focus();
      });
      return;
    }

    if (this.isDesktopShell) {
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
        seconds?: number;
      }>(
        'timer-command',
        event => {
          const { action, id, label, duration, seconds } = event.payload;
          if (action === 'add' && duration) this.timerService.add(label ?? '', duration);
          if (action === 'quick-start' && duration) {
            this.timerService.quickStart(duration, label ?? 'Focus timer');
          }
          if (action === 'remove' && id) this.timerService.remove(id);
          if (action === 'start' && id) this.timerService.start(id);
          if (action === 'pause' && id) this.timerService.pause(id);
          if (action === 'resume' && id) this.timerService.resume(id);
          if (action === 'adjust' && id && seconds) this.timerService.adjust(id, seconds);
          if (action === 'reset' && id) this.timerService.reset(id);
        }
      );

      this.unlistenTimerRequestState = await listen('timer-request-state', () => {
        void emit('timer-tick', this.timerService.getState());
      });
      this.unlistenQuickActionCommand = await listen<QuickActionCommand>(
        'quick-action-command',
        event => {
          void this.handleQuickActionCommand(event.payload).catch(error => {
            console.error('Failed to handle a Quick Actions command:', error);
          });
        }
      );
    }

    /*
     * ---------------------------------------------------------
     * Rive
     * ---------------------------------------------------------
     */

    if (!this.transparencyTestMode) {
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

        this.backgroundRemovalFrame = requestAnimationFrame(
          this.renderPetWithTransparentBackground
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

        if (this.isDesktopShell) {
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
    } else {
      console.info('Transparency test mode is active; Rive rendering is disabled.');
    }


    /*
     * ---------------------------------------------------------
     * Mouse / dragging
     * ---------------------------------------------------------
     */

    const canvas =
      this.canvasRef.nativeElement;

    this.unlistenGlobalCursor =
      getCurrentWindow().onGlobalCursorMove(({ x, y }) => {
        const bounds = canvas.getBoundingClientRect();
        if (x < 0 || y < 0 || x >= bounds.width || y >= bounds.height) {
          this.setMouseEventsIgnored(true);
        }
        const localX = Math.max(1, Math.min(bounds.width - 1, x));
        const localY = Math.max(1, Math.min(bounds.height - 1, y));
        canvas.dispatchEvent(
          new MouseEvent('mousemove', {
            clientX: bounds.left + localX,
            clientY: bounds.top + localY,
            bubbles: false
          })
        );
      });

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

    if (this.isDesktopShell) {
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
    const generation = this.speechQueueGeneration;
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
      if (generation !== this.speechQueueGeneration) return;
      await this.enqueueSpeech(message, 4000, false, generation);
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
    throttleClick = false,
    generation = this.speechQueueGeneration
  ): Promise<void> {
    if (generation !== this.speechQueueGeneration) {
      return Promise.resolve();
    }

    if (!this.isDesktopShell) {
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
      if (generation !== this.speechQueueGeneration) {
        resolve();
        return;
      }
      this.speechQueue.push({
        message,
        sentences: splitIntoSentences(message),
        sentenceIndex: 0,
        fallbackDurationMs,
        generation,
        resolve
      });
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
        if (item.generation !== this.speechQueueGeneration) {
          item.resolve();
          continue;
        }
        this.activeSpeechItem = item;
        this.speechSentences.set(item.sentences);
        this.activeSpeechSentenceIndex.set(-1);
        this.currentSpeechSentence.set('');
        this.speechPlaybackActive.set(false);
        this.speechBubbleMinimized.set(true);

        let bubbleShown = false;
        let fallbackShown = false;
        let bubbleShowTimeout: ReturnType<typeof setTimeout> | undefined;
        try {
          while (item.sentenceIndex < item.sentences.length) {
            if (item.generation !== this.speechQueueGeneration) break;

            const sentenceIndex = item.sentenceIndex;
            const sentence = item.sentences[sentenceIndex];
            this.activeSpeechSentenceIndex.set(sentenceIndex);
            this.currentSpeechSentence.set(sentence);

            let cancelled = false;
            let playbackUnavailable = false;
            let playbackEnded = false;
            try {
              while (await this.speech.isSpeaking()) {
                await new Promise(resolve => setTimeout(resolve, 250));
              }
              if (item.generation !== this.speechQueueGeneration) break;

              await this.speech.speakAndWait(sentence, {
                onPlaybackStart: () => {
                  bubbleShown = true;
                  this.speechPlaybackActive.set(true);
                  bubbleShowTimeout = setTimeout(() => {
                    bubbleShowTimeout = undefined;
                    if (!cancelled && !playbackEnded) {
                      this.showBubble(item.message, null);
                    }
                  }, SPEECH_BUBBLE_SYNC_DELAY_MS);
                },
                onPlaybackEnd: () => {
                  playbackEnded = true;
                  this.speechPlaybackActive.set(false);
                  if (bubbleShowTimeout) {
                    clearTimeout(bubbleShowTimeout);
                    bubbleShowTimeout = undefined;
                  }
                },
                onPlaybackUnavailable: () => {
                  playbackUnavailable = true;
                  bubbleShown = true;
                  this.speechPlaybackActive.set(false);
                  this.showBubble(item.message, item.fallbackDurationMs);
                },
                onPlaybackCancelled: () => {
                  cancelled = true;
                  this.speechPlaybackActive.set(false);
                  if (bubbleShowTimeout) {
                    clearTimeout(bubbleShowTimeout);
                    bubbleShowTimeout = undefined;
                  }
                  if (item.sentenceIndex === sentenceIndex) {
                    this.hideBubble(item.message);
                  }
                }
              });
            } catch (error) {
              console.error('Failed to speak a pet interaction:', error);
              this.speechPlaybackActive.set(false);
              this.showBubble(item.message, item.fallbackDurationMs);
              fallbackShown = true;
              break;
            } finally {
              if (bubbleShowTimeout) {
                clearTimeout(bubbleShowTimeout);
                bubbleShowTimeout = undefined;
              }
            }

            if (item.generation !== this.speechQueueGeneration) break;
            if (playbackUnavailable) {
              fallbackShown = true;
              break;
            }
            if (cancelled) {
              if (item.sentenceIndex !== sentenceIndex) continue;
              const remaining = this.speechQueue.splice(0);
              for (const queuedItem of remaining) {
                queuedItem.resolve();
              }
              break;
            }
            if (item.sentenceIndex === sentenceIndex) {
              item.sentenceIndex += 1;
            }
          }
        } finally {
          if (bubbleShowTimeout) {
            clearTimeout(bubbleShowTimeout);
          }
          if (
            item.generation === this.speechQueueGeneration &&
            bubbleShown &&
            !fallbackShown
          ) {
            this.hideBubble(item.message);
          }
          if (this.activeSpeechItem === item) {
            this.activeSpeechItem = undefined;
            this.speechPlaybackActive.set(false);
            this.speechSentences.set([]);
            this.currentSpeechSentence.set('');
            this.activeSpeechSentenceIndex.set(-1);
          }
          item.resolve();
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


    const canvases = [
      this.canvasRef.nativeElement,
      this.displayCanvasRef.nativeElement
    ];

    for (const canvas of canvases) {
      canvas.style.width = `${px}px`;
      canvas.style.height = `${px}px`;
      canvas.width = px;
      canvas.height = px;
    }

    if (this.isDesktopShell) {
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
      if (this.windowDragging) {
        this.windowDragging = false;
        void getCurrentWindow().stopDragging().catch(error => {
          console.error('Failed to stop window dragging:', error);
        });
      }
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

  private openQuickActionsAt(
    clientX: number,
    clientY: number,
    centerOnPet = false
  ): void {
    if (this.isDesktopShell && !this.quickActionsOverlay) {
      void invoke('quick-actions:open', { centerOnPet }).catch(error => {
        console.error('Failed to open Quick Actions:', error);
        this.showBubble('I could not open Quick Actions. Please try again.', 3000);
      });
      return;
    }

    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width || canvas.clientWidth || canvas.width;
    const height = rect.height || canvas.clientHeight || canvas.height;
    const x = width > 0 ? ((clientX - rect.left) / width) * 100 : 50;
    const y = height > 0 ? ((clientY - rect.top) / height) * 100 : 50;

    this.quickTaskMode.set(false);
    this.quickTaskAddMode.set(false);
    this.quickTaskCompleteMode.set(false);
    this.quickTimerMode.set(false);
    this.quickReminderMode.set(false);
    this.quickReadOutMode.set(false);
    this.quickMotivationMode.set(false);
    this.quickTimerLabelMode.set(false);
    this.quickCustomTimerMode.set(false);
    this.quickTaskTitle = '';
    this.quickTimerError.set('');
    this.quickReminderTitle = '';
    this.quickReminderError.set('');
    this.quickActionError.set('');
    this.quickActionPosition.set({ x, y });
    this.quickActionsVisible.set(true);
    setTimeout(() => {
      this.quickActionWheelRef?.nativeElement.querySelector('button')?.focus();
    });
  }

  closeQuickActions(): void {
    const closeOverlay = this.quickActionsOverlay && this.quickActionsVisible();
    this.quickActionsVisible.set(false);
    this.quickTimerMode.set(false);
    this.quickReminderMode.set(false);
    this.quickReadOutMode.set(false);
    this.quickMotivationMode.set(false);
    this.quickTimerLabelMode.set(false);
    this.quickCustomTimerMode.set(false);
    this.quickTaskMode.set(false);
    this.quickTaskAddMode.set(false);
    this.quickTaskCompleteMode.set(false);
    this.quickTaskTitle = '';
    this.quickTaskError.set('');
    this.quickTimerError.set('');
    this.quickReminderTitle = '';
    this.quickReminderError.set('');
    this.quickActionError.set('');
    if (closeOverlay) {
      void invoke('quick-actions:close').catch(error => {
        console.error('Failed to close Quick Actions:', error);
      });
    }
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
      const canvas = this.canvasRef.nativeElement;
      const rect = canvas.getBoundingClientRect();
      const width = rect.width || canvas.clientWidth || canvas.width;
      const height = rect.height || canvas.clientHeight || canvas.height;
      this.openQuickActionsAt(rect.left + width / 2, rect.top + height / 2, true);
      return;
    }

    if (event.key === 'Escape' && this.quickActionsVisible()) {
      this.closeQuickActions();
    }
  };

  openQuickTimerOptions(): void {
    this.quickTimerMode.set(true);
    this.quickTimerLabelMode.set(false);
    this.quickCustomTimerMode.set(false);
    this.quickTimerMinutes = 25;
    this.quickTimerError.set('');
  }

  openQuickReminderForm(): void {
    const suggestedTime = new Date(Date.now() + 31 * 60_000);
    suggestedTime.setSeconds(0, 0);
    this.quickTimerMode.set(false);
    this.quickTaskMode.set(false);
    this.quickReminderTitle = '';
    this.quickReminderDateTime = this.toLocalDateTimeInput(suggestedTime);
    this.quickReminderError.set('');
    this.quickReminderMode.set(true);
    setTimeout(() => {
      this.quickActionWheelRef?.nativeElement
        .querySelector<HTMLInputElement>('#quick-reminder-title')
        ?.focus();
    });
  }

  openQuickMotivationMenu(): void {
    this.quickTimerMode.set(false);
    this.quickReminderMode.set(false);
    this.quickTaskMode.set(false);
    this.quickReadOutMode.set(false);
    this.quickMotivationMode.set(true);
  }

  async selectMotivationalQuote(): Promise<void> {
    if (this.quickActionsOverlay) {
      await this.dispatchQuickAction({ action: 'motivate', content: 'quote' });
      return;
    }
    await this.speakMotivationalContent('quote');
  }

  async selectInterestingStory(): Promise<void> {
    if (this.quickActionsOverlay) {
      await this.dispatchQuickAction({ action: 'motivate', content: 'story' });
      return;
    }
    await this.speakMotivationalContent('story');
  }

  async addQuickReminder(event: Event): Promise<void> {
    event.preventDefault();
    const title = this.quickReminderTitle.trim();
    const scheduledAt = new Date(this.quickReminderDateTime);
    this.quickReminderError.set('');

    if (!title) {
      this.quickReminderError.set('Enter what you want to be reminded about.');
      return;
    }
    if (!this.quickReminderDateTime || Number.isNaN(scheduledAt.getTime())) {
      this.quickReminderError.set('Choose a valid date and time.');
      return;
    }
    if (scheduledAt.getTime() <= Date.now()) {
      this.quickReminderError.set('Choose a time in the future.');
      return;
    }

    try {
      await this.reminderStore.create(title, scheduledAt.toISOString());
      try {
        await emit('reminders-updated');
      } catch (error) {
        console.error('Reminder was saved, but other windows were not notified:', error);
      }
      if (this.quickActionsOverlay) {
        await this.dispatchQuickAction({ action: 'reminder-added', title });
        return;
      }
      this.closeQuickActions();
      this.showBubble(`I’ll remind you: ${title}`, 3000);
    } catch (error) {
      console.error('Failed to add quick reminder:', error);
      this.quickReminderError.set('Could not save the reminder. Please try again.');
    }
  }

  private toLocalDateTimeInput(date: Date): string {
    const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return localDate.toISOString().slice(0, 16);
  }

  openQuickReadOutMenu(): void {
    this.quickTimerMode.set(false);
    this.quickReminderMode.set(false);
    this.quickTaskMode.set(false);
    this.quickReadOutMode.set(true);
  }

  async readOutTasks(): Promise<void> {
    if (this.quickActionsOverlay) {
      await this.dispatchQuickAction({ action: 'read-out', category: 'tasks' });
      return;
    }
    this.closeQuickActions();
    const generation = await this.replaceSpeechQueue();
    try {
      const tasks = (await this.taskStore.getAllTasks()).filter(task => !task.completed);
      if (tasks.length === 0) {
        await this.enqueueSpeech('You have no open tasks right now.', 3000, false, generation);
        return;
      }

      const entries = tasks.map((task, index) => {
        const dueDate = task.dueDate
          ? `, due ${new Date(task.dueDate).toLocaleString()}`
          : '';
        return `Task ${index + 1}: ${task.title}${dueDate}.`;
      });
      await this.speakOutList(`You have ${tasks.length} open tasks.`, entries, generation);
    } catch (error) {
      console.error('Failed to read tasks aloud:', error);
      if (generation === this.speechQueueGeneration) {
        this.showBubble('I could not read your tasks right now.', 3000);
      }
    }
  }

  async readOutTimers(): Promise<void> {
    if (this.quickActionsOverlay) {
      await this.dispatchQuickAction({ action: 'read-out', category: 'timers' });
      return;
    }
    this.closeQuickActions();
    const generation = await this.replaceSpeechQueue();
    const timers = this.timerService.getState();
    if (timers.length === 0) {
      await this.enqueueSpeech('You do not have any timers.', 3000, false, generation);
      return;
    }

    const entries = timers.map((timer, index) =>
      `Timer ${index + 1}: ${timer.label}, ${this.describeDuration(timer.remaining)} remaining, currently ${timer.status}.`
    );
    await this.speakOutList(`You have ${timers.length} timers.`, entries, generation);
  }

  async readOutReminders(): Promise<void> {
    if (this.quickActionsOverlay) {
      await this.dispatchQuickAction({ action: 'read-out', category: 'reminders' });
      return;
    }
    this.closeQuickActions();
    const generation = await this.replaceSpeechQueue();
    try {
      const reminders = (await this.reminderStore.getAll())
        .filter(reminder => !reminder.completed)
        .sort((left, right) =>
          new Date(left.snoozedUntil ?? left.scheduledAt).getTime() -
          new Date(right.snoozedUntil ?? right.scheduledAt).getTime()
        );
      if (reminders.length === 0) {
        await this.enqueueSpeech('You have no upcoming reminders.', 3000, false, generation);
        return;
      }

      const entries = reminders.map((reminder, index) => {
        const scheduledAt = reminder.snoozedUntil ?? reminder.scheduledAt;
        const time = reminder.triggered
          ? 'is due now'
          : `is scheduled for ${new Date(scheduledAt).toLocaleString()}`;
        return `Reminder ${index + 1}: ${reminder.title}, ${time}.`;
      });
      await this.speakOutList(`You have ${reminders.length} reminders.`, entries, generation);
    } catch (error) {
      console.error('Failed to read reminders aloud:', error);
      if (generation === this.speechQueueGeneration) {
        this.showBubble('I could not read your reminders right now.', 3000);
      }
    }
  }

  private async speakOutList(
    intro: string,
    entries: string[],
    generation: number
  ): Promise<void> {
    let message = intro;
    for (const entry of entries) {
      if (message.length + entry.length > 3000) {
        await this.enqueueSpeech(message, 4000, false, generation);
        if (generation !== this.speechQueueGeneration) return;
        message = '';
      }
      message += `${message ? ' ' : ''}${entry}`;
    }
    if (message) {
      await this.enqueueSpeech(message, 4000, false, generation);
    }
  }

  async stopSpeech(): Promise<void> {
    this.speechQueueGeneration += 1;
    this.speechPlaybackActive.set(false);
    for (const queuedItem of this.speechQueue.splice(0)) {
      queuedItem.resolve();
    }

    this.hideBubble();
    if (!this.isDesktopShell) return;
    try {
      await this.speech.stop();
    } catch (error) {
      console.error('Failed to stop Milly’s speech:', error);
      this.showBubble('I could not stop speaking. Please try again.', 3000);
    }
  }

  async previousSpeechSentence(): Promise<void> {
    await this.navigateSpeechSentence(-1);
  }

  async nextSpeechSentence(): Promise<void> {
    await this.navigateSpeechSentence(1);
  }

  private async navigateSpeechSentence(direction: -1 | 1): Promise<void> {
    const item = this.activeSpeechItem;
    if (!item || !this.speechPlaybackActive()) return;

    const previousIndex = item.sentenceIndex;
    const nextIndex = previousIndex + direction;
    if (nextIndex < 0 || nextIndex >= item.sentences.length) return;

    item.sentenceIndex = nextIndex;
    this.activeSpeechSentenceIndex.set(nextIndex);
    this.currentSpeechSentence.set(item.sentences[nextIndex]);
    try {
      await this.speech.stop();
    } catch (error) {
      console.error('Failed to move through Milly’s speech:', error);
      if (this.activeSpeechItem === item) {
        item.sentenceIndex = previousIndex;
        this.activeSpeechSentenceIndex.set(previousIndex);
        this.currentSpeechSentence.set(item.sentences[previousIndex]);
      }
      this.showBubble('I could not move through the speech. Please try again.', 3000);
    }
  }

  private async replaceSpeechQueue(): Promise<number> {
    this.speechQueueGeneration += 1;
    this.speechPlaybackActive.set(false);
    const generation = this.speechQueueGeneration;
    for (const queuedItem of this.speechQueue.splice(0)) {
      queuedItem.resolve();
    }

    if (this.isDesktopShell) {
      try {
        await this.speech.stop();
      } catch (error) {
        console.error('Failed to stop the previous speech before reading a new list:', error);
      }
    }
    return generation;
  }

  private describeDuration(totalSeconds: number): string {
    const seconds = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    const parts: string[] = [];

    if (hours) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
    if (minutes) parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`);
    if (remainder || parts.length === 0) {
      parts.push(`${remainder} ${remainder === 1 ? 'second' : 'seconds'}`);
    }

    return parts.join(' and ');
  }

  selectQuickTimer(minutes: number): void {
    this.quickTimerMinutes = minutes;
    this.quickTimerLabel = minutes === 25 ? 'Focus session' : 'Short break';
    this.quickTimerLabelMode.set(true);
    this.quickTimerError.set('');
    setTimeout(() => {
      this.quickActionWheelRef?.nativeElement
        .querySelector<HTMLInputElement>('#quick-timer-label')
        ?.select();
    });
  }

  beginCustomQuickTimer(): void {
    this.quickCustomTimerMode.set(true);
    this.quickTimerError.set('');
    setTimeout(() => {
      this.quickActionWheelRef?.nativeElement
        .querySelector<HTMLInputElement>('#quick-timer-minutes')
        ?.focus();
    });
  }

  startCustomQuickTimer(event: Event): void {
    event.preventDefault();
    const minutes = Number(this.quickTimerMinutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 5940) {
      this.quickTimerError.set('Enter a whole number from 1 to 5940 minutes.');
      return;
    }

    this.quickTimerMinutes = minutes;
    this.quickTimerLabel = this.quickTimerName(minutes);
    this.quickCustomTimerMode.set(false);
    this.quickTimerLabelMode.set(true);
    this.quickTimerError.set('');
    setTimeout(() => {
      this.quickActionWheelRef?.nativeElement
        .querySelector<HTMLInputElement>('#quick-timer-label')
        ?.select();
    });
  }

  private quickTimerName(minutes: number): string {
    if (minutes === 5) return 'Short break';
    if (minutes === 15) return 'Quick focus';
    if (minutes === 25) return 'Focus session';
    if (minutes === 45) return 'Deep work';
    return `${minutes}-minute timer`;
  }

  async startLabeledQuickTimer(event: Event): Promise<void> {
    event.preventDefault();
    const label = this.quickTimerLabel.trim();
    if (!label) return;

    const minutes = this.quickTimerMinutes;
    const duration = minutes * 60;
    if (this.quickActionsOverlay) {
      await this.dispatchQuickAction({ action: 'start-timer', duration, label });
      return;
    }
    try {
      this.timerService.startWithLabel(duration, label);
    } catch (error) {
      console.error(`Could not start the ${minutes}-minute timer:`, error);
      this.showBubble('I could not start that timer. Please try again.', 3000);
      this.closeQuickActions();
      return;
    }

    this.closeQuickActions();
    void this.enqueueSpeech(`Your ${label} timer has started.`, 3000);
  }

  async beginQuickTask(): Promise<void> {
    this.quickActionError.set('');
    try {
      this.quickTasks.set(await this.taskStore.getAllTasks());
      this.quickTaskError.set('');
      this.quickTaskAddMode.set(false);
      this.quickTaskCompleteMode.set(false);
      this.quickTaskMode.set(true);
    } catch (error) {
      console.error('Failed to load tasks for the Tasks menu:', error);
      if (this.quickActionsOverlay) {
        this.quickActionError.set('Could not load tasks. Please try again.');
        return;
      }
      this.showBubble('I could not load your tasks. Please try again.', 3000);
    }
    this.quickTaskTitle = '';
  }

  openQuickAddTask(): void {
    this.quickTaskError.set('');
    this.quickTaskTitle = '';
    this.quickTaskAddMode.set(true);
    this.quickTaskCompleteMode.set(false);
  }

  async openQuickCompleteTasks(): Promise<void> {
    this.quickTaskError.set('');
    this.quickTaskAddMode.set(false);
    this.quickTaskCompleteMode.set(true);
    try {
      this.quickTasks.set(await this.taskStore.getAllTasks());
    } catch (error) {
      console.error('Failed to load tasks to complete:', error);
      this.quickTaskError.set('Could not load tasks. Please try again.');
    }
  }

  backToQuickTaskMenu(): void {
    this.quickTaskAddMode.set(false);
    this.quickTaskCompleteMode.set(false);
    this.quickTaskError.set('');
  }

  async addQuickTask(event: Event): Promise<void> {
    event.preventDefault();
    const title = this.quickTaskTitle.trim();
    if (!title) return;

    this.quickTaskError.set('');
    let createdTask: Task;
    try {
      createdTask = await this.taskStore.createTask({ title, priority: 'medium' });
    } catch (error) {
      console.error('Failed to add quick task:', error);
      this.quickTaskError.set('Could not add that task. Please try again.');
      return;
    }

    this.quickTasks.update(tasks => [...tasks, createdTask]);
    this.quickTaskTitle = '';
    try {
      await emit('tasks-updated');
    } catch (error) {
      console.error('Task was saved, but other windows were not notified:', error);
    }
  }

  async toggleQuickTask(task: Task): Promise<void> {
    this.quickTaskError.set('');
    let updated: Task | null;
    try {
      updated = await this.taskStore.toggleComplete(task.id);
    } catch (error) {
      console.error('Failed to update a task from the Tasks menu:', error);
      this.quickTaskError.set('Could not update that task. Please try again.');
      return;
    }
    if (!updated) {
      this.quickTaskError.set('That task could not be updated. Please try again.');
      return;
    }

    const updatedTask = updated;
    this.quickTasks.update(tasks =>
      tasks.map(current => current.id === updatedTask.id ? updatedTask : current)
    );
    try {
      await emit('tasks-updated');
    } catch (error) {
      console.error('Task was updated, but other windows were not notified:', error);
    }
    if (updatedTask.completed) {
      try {
        await emit('task-completed', { title: updatedTask.title });
      } catch (error) {
        console.error('Task was completed, but the pet was not notified:', error);
      }
    }
  }

  private async dispatchQuickAction(command: QuickActionCommand): Promise<void> {
    this.quickActionError.set('');
    try {
      await emit('quick-action-command', command);
      this.closeQuickActions();
    } catch (error) {
      console.error('Failed to send a Quick Actions command:', error);
      this.quickActionError.set('Could not complete that action. Please try again.');
    }
  }

  private async handleQuickActionCommand(command: QuickActionCommand): Promise<void> {
    switch (command.action) {
      case 'start-timer':
        try {
          this.timerService.startWithLabel(command.duration, command.label);
        } catch (error) {
          console.error('Could not start the quick timer:', error);
          this.showBubble('I could not start that timer. Please try again.', 3000);
          return;
        }
        void this.enqueueSpeech(`Your ${command.label} timer has started.`, 3000);
        return;
      case 'motivate':
        await this.speakMotivationalContent(command.content);
        return;
      case 'read-out':
        if (command.category === 'tasks') await this.readOutTasks();
        else if (command.category === 'timers') await this.readOutTimers();
        else await this.readOutReminders();
        return;
      case 'reminder-added':
        this.showBubble(`I’ll remind you: ${command.title}`, 3000);
        return;
    }
  }

  async openDashboardFromWheel(): Promise<void> {
    if (this.quickActionsOverlay) {
      try {
        await invoke('open_dashboard');
      } catch (error) {
        console.error('Failed to open the Dashboard:', error);
        this.quickActionError.set('Could not open the Dashboard. Please try again.');
      }
      return;
    }

    try {
      await invoke('open_dashboard');
      this.closeQuickActions();
    } catch (error) {
      console.error('Failed to open the Dashboard:', error);
      this.showBubble('I could not open the Dashboard. Please try again.', 3000);
      this.closeQuickActions();
    }
  }

  private async speakMotivationalContent(content: 'quote' | 'story'): Promise<void> {
    this.closeQuickActions();
    try {
      if (content === 'story') {
        const story = await this.motivationalStories.next();
        if (!story) {
          this.showBubble('I could not find an interesting story right now.', 4000);
          return;
        }
        const speech = `${story.title}. ${story.story} The takeaway: ${story.takeaway}`;
        await this.enqueueSpeech(speech, 120000);
        return;
      }

      const quote = await this.motivationalQuotes.next();
      if (!quote) {
        this.showBubble('I could not find a motivational quote right now.', 4000);
        return;
      }
      await this.enqueueSpeech(quote.text, 4000);
    } catch (error) {
      console.error('Failed to load motivational content:', error);
      const contentLabel = content === 'story' ? 'story' : 'quote';
      this.showBubble(`I could not load a motivational ${contentLabel} right now.`, 4000);
    }
  }


  /*
   * =========================================================
   * MOUSE MOVE
   * =========================================================
   */

  private onMouseMove = (
    event: MouseEvent
  ): void => {

    this.updateMousePassThrough(event);

    if (this.windowDragging) {
      this.petState.updateDragX(event.screenX);
      void getCurrentWindow().moveDragging(event.screenX, event.screenY).catch(error => {
        console.error('Failed to move the pet window:', error);
      });
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
      return;
    }


    this.mouseDownPos = null;

    if (!this.isDesktopShell) return;

    this.windowDragging = true;
    getCurrentWindow().startDragging().catch(error => {
      this.windowDragging = false;

      console.error('Failed to start window dragging:', error);
    });
  };

  private updateMousePassThrough(event: MouseEvent): void {
    if (!this.isDesktopShell) return;

    const target = event.target;
    const onInteractiveOverlay =
      target instanceof Element &&
      Boolean(target.closest('.quick-action-wheel, .speech-bubble, .health-banner'));
    const canvas = this.displayCanvasRef.nativeElement;
    const bounds = canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - bounds.left) * canvas.width / bounds.width);
    const y = Math.floor((event.clientY - bounds.top) * canvas.height / bounds.height);
    const insideCanvas = x >= 0 && y >= 0 && x < canvas.width && y < canvas.height;
    const alpha = insideCanvas
      ? canvas.getContext('2d')?.getImageData(x, y, 1, 1).data[3] ?? 0
      : 0;

    this.setMouseEventsIgnored(!onInteractiveOverlay && alpha <= 16);
  }

  private setMouseEventsIgnored(ignore: boolean): void {
    if (!this.isDesktopShell || this.mouseEventsIgnored === ignore) return;
    this.mouseEventsIgnored = ignore;
    void getCurrentWindow().setIgnoreMouseEvents(ignore).catch(error => {
      this.mouseEventsIgnored = !ignore;
      console.error('Failed to update pet mouse pass-through:', error);
    });
  }


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

    if (this.windowDragging) {
      this.windowDragging = false;
      void getCurrentWindow().stopDragging().catch(error => {
        console.error('Failed to stop window dragging:', error);
      });
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
    void win.show()
      .then(() => console.log('Pet window shown without taking focus'))
      .catch(error => console.error('Failed to show pet window:', error));

    console.log(
      'dizzyTrigger before fire:',
      this.dizzyTrigger === undefined ? 'undefined' : this.dizzyTrigger
    );

    this.petRules.setTemporaryOverride(true);
    this.petState.setState('celebrating', true);
    this.sound.play('taskComplete');

    const generation = await this.replaceSpeechQueue();
    const completionMessage =
      `Task ${taskTitle} complete! ${this.dialogue.getMessage('taskCompleted')}`;
    void this.enqueueSpeech(completionMessage, 3000, false, generation);
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
          void win.show()
            .catch(error => console.error('Failed to show pet after timer completion:', error));
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

    this.petRules.setTemporaryOverride(true);
    this.petState.setState('celebrating', true);
    this.sound.play('timerComplete');

    const completionMessage =
      `Focus timer "${timer.label}" complete! ${this.dialogue.getMessage('timerCompleted')}`;
    const generation = await this.replaceSpeechQueue();
    void this.enqueueSpeech(completionMessage, 3500, false, generation);
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

  private renderPetWithTransparentBackground = (): void => {
    const source = this.canvasRef.nativeElement;
    const display = this.displayCanvasRef.nativeElement;
    const context = display.getContext('2d');

    if (!context || source.width === 0 || source.height === 0) {
      this.backgroundRemovalFrame = requestAnimationFrame(
        this.renderPetWithTransparentBackground
      );
      return;
    }

    if (display.width !== source.width || display.height !== source.height) {
      display.width = source.width;
      display.height = source.height;
    }

    context.clearRect(0, 0, display.width, display.height);
    context.drawImage(source, 0, 0);

    const frame = context.getImageData(0, 0, display.width, display.height);
    const pixels = frame.data;
    const background = [
      [0, 0],
      [display.width - 1, 0],
      [0, display.height - 1],
      [display.width - 1, display.height - 1]
    ].map(([x, y]) => {
      const offset = (y * display.width + x) * 4;
      return [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
    }).find(([red, green, blue]) => red !== undefined && green !== undefined && blue !== undefined);

    if (background) {
      const [red, green, blue] = background;
      const pixelCount = display.width * display.height;
      const queue = new Int32Array(pixelCount);
      let head = 0;
      let tail = 0;

      const enqueue = (index: number): void => {
        const offset = index * 4;
        if (pixels[offset + 3] === 0) return;
        if (
          Math.abs(pixels[offset] - red) > 24 ||
          Math.abs(pixels[offset + 1] - green) > 24 ||
          Math.abs(pixels[offset + 2] - blue) > 24
        ) return;
        pixels[offset + 3] = 0;
        queue[tail++] = index;
      };

      for (let x = 0; x < display.width; x++) {
        enqueue(x);
        enqueue((display.height - 1) * display.width + x);
      }
      for (let y = 1; y < display.height - 1; y++) {
        enqueue(y * display.width);
        enqueue(y * display.width + display.width - 1);
      }

      while (head < tail) {
        const index = queue[head++];
        const x = index % display.width;
        if (x > 0) enqueue(index - 1);
        if (x + 1 < display.width) enqueue(index + 1);
        if (index >= display.width) enqueue(index - display.width);
        if (index + display.width < pixelCount) enqueue(index + display.width);
      }

      context.putImageData(frame, 0, 0);
    }

    this.backgroundRemovalFrame = requestAnimationFrame(
      this.renderPetWithTransparentBackground
    );
  };

  /*
   * =========================================================
   * CLEANUP
   * =========================================================
   */

  ngOnDestroy(): void {
    if (this.backgroundRemovalFrame !== undefined) {
      cancelAnimationFrame(this.backgroundRemovalFrame);
      this.backgroundRemovalFrame = undefined;
    }

    if (this.mouseEventsIgnored) {
      this.setMouseEventsIgnored(false);
    }

    if (this.windowDragging && this.isDesktopShell) {
      void getCurrentWindow().stopDragging();
    }

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
    this.unlistenQuickActionCommand?.();
    this.unlistenSoundsToggled?.();
    this.unlistenPetFocus?.();
    this.unlistenGlobalCursor?.();
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