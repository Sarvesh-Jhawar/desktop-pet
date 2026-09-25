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

import {
  PhysicalPosition
} from '@tauri-apps/api/dpi';

import {
  load,
  Store
} from '@tauri-apps/plugin-store';

import {
  PET_HAPPY_MESSAGES,
  PET_GREETING_MESSAGES,
  PET_TASK_COMPLETE_MESSAGES,
  PET_REMINDER_MESSAGES_PREFIX,
  PET_TIMER_COMPLETE_MESSAGES,
  randomMessage
} from '../../shared/pet-messages';
import { ReminderSchedulerService } from '../../core/reminder-scheduler.service';
import { Reminder } from '../../shared/reminder.model';
import { TimerService, TimerState } from '../../core/timer.service';
import { PetStateService } from '../../core/pet-state.service';

type PetSize = 'small' | 'medium' | 'large';

const SIZE_MAP: Record<PetSize, number> = {
  small: 150,
  medium: 250,
  large: 350
};


@Component({
  selector: 'app-pet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  templateUrl: './pet.html',
  styleUrl: './pet.css'
})
export class Pet implements OnInit, OnDestroy {

  private readonly timerService = inject(TimerService);

  private readonly reminderScheduler = inject(ReminderSchedulerService);

  private readonly petState = inject(PetStateService);

  private readonly isTauriRuntime =
    Boolean((globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

  @ViewChild('petCanvas', { static: true })
  canvasRef!: ElementRef<HTMLCanvasElement>;


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

        const greeting =
          randomMessage(
            PET_GREETING_MESSAGES
          );

        console.log(
          'Milly greeting:',
          greeting
        );

        this.showBubble(
          greeting,
          3000
        );
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
    durationMs = 2500
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


    this.bubbleTimeout =
      setTimeout(() => {

        this.hideBubble();

      }, durationMs);
  }


  private hideBubble(): void {

    console.log(
      'Hiding bubble'
    );

    this.bubbleVisible.set(false);
    this.bubbleTimeout = undefined;
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

    this.mouseDownPos = {
      x: event.clientX,
      y: event.clientY
    };
  };


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

    console.log(
      'PET CLICKED'
    );


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

    const message =
      randomMessage(
        PET_HAPPY_MESSAGES
      );


    console.log(
      'Pet message:',
      message
    );


    this.showBubble(
      message,
      2500
    );
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

    this.petState.setState('celebrating', true);

    this.showBubble(
      randomMessage(PET_TASK_COMPLETE_MESSAGES),
      3000
    );
    setTimeout(() => this.petState.resetToIdle(), 3000);
  }

  private async onTimerCompleted(timer: TimerState): Promise<void> {
    const win = getCurrentWindow();
    await win.show();
    await win.setFocus();

    this.petState.setState('celebrating', true);

    this.showBubble(
      `Focus timer "${timer.label}" complete! ${randomMessage(PET_TIMER_COMPLETE_MESSAGES)}`,
      3500
    );
    setTimeout(() => this.petState.resetToIdle(), 3500);
  }

  private async onReminderDue(reminder: Reminder): Promise<void> {
    const win = getCurrentWindow();
    await win.show();
    await win.setFocus();

    this.petState.setState('waiting');

    this.showBubble(
      PET_REMINDER_MESSAGES_PREFIX + reminder.title,
      4000
    );
    setTimeout(() => this.petState.resetToIdle(), 4000);
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


    window.removeEventListener(
      'mousemove',
      this.onMouseMove
    );


    window.removeEventListener(
      'mouseup',
      this.onMouseUp
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
    this.timerService.onComplete = undefined;
    this.reminderScheduler.onReminderDue = undefined;
    this.reminderScheduler.stop();


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