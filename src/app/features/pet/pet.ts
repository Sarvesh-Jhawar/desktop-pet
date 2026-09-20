import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild
} from '@angular/core';

import {
  Rive,
  StateMachineInput
} from '@rive-app/webgl2';

import {
  getCurrentWindow
} from '@tauri-apps/api/window';

import {
  PhysicalPosition
} from '@tauri-apps/api/dpi';

import {
  load,
  Store
} from '@tauri-apps/plugin-store';

@Component({
  selector: 'app-pet',
  standalone: true,
  templateUrl: './pet.html',
  styleUrl: './pet.css'
})
export class Pet implements OnInit, OnDestroy {

  @ViewChild('petCanvas', { static: true })
  canvasRef!: ElementRef<HTMLCanvasElement>;

  private rive?: Rive;

  private dizzyTrigger?: StateMachineInput;

  private mouseDownPos: {
    x: number;
    y: number;
  } | null = null;

  private readonly DRAG_THRESHOLD = 4;

  private saveTimeout?: ReturnType<typeof setTimeout>;

  private store?: Store;

  private unlistenMoved?: () => void;

  ngOnInit(): void {

    /*
     * =========================================================
     * RIVE / MILLY
     * =========================================================
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

        const inputs =
          this.rive?.stateMachineInputs(
            'State Machine 1'
          );

        console.log(
          'Milly state machine inputs:',
          inputs
        );

        this.dizzyTrigger = inputs?.find(
          input => input.name === 'DizzyTrigger'
        );

        if (this.dizzyTrigger) {
          console.log(
            'DizzyTrigger found'
          );
        } else {
          console.warn(
            'DizzyTrigger not found'
          );
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
     * =========================================================
     * MOUSE / WINDOW DRAGGING
     * =========================================================
     */

    const canvas =
      this.canvasRef.nativeElement;

    canvas.addEventListener(
      'mousedown',
      this.onMouseDown
    );

    window.addEventListener(
      'mouseup',
      this.onMouseUp
    );

    /*
     * =========================================================
     * POSITION PERSISTENCE
     * =========================================================
     */

    this.initPositionPersistence();
  }

  /*
   * =========================================================
   * POSITION PERSISTENCE
   * =========================================================
   */

  private async initPositionPersistence(): Promise<void> {

    try {

      console.log(
        'Starting position persistence...'
      );

      /*
       * Load the Tauri Store.
       */

      this.store = await load(
        'settings.json',
        {
          autoSave: false
        }
      );

      console.log(
        'Store loaded successfully'
      );

      /*
       * Get the current Tauri window.
       */

      const win =
        getCurrentWindow();

      /*
       * =====================================================
       * RESTORE SAVED POSITION
       * =====================================================
       */

      const savedPosition =
        await this.store.get<{
          x: number;
          y: number;
        }>('petPosition');

      console.log(
        'Saved Milly position:',
        savedPosition
      );

      if (savedPosition) {

        console.log(
          'Restoring Milly position...'
        );

        await win.setPosition(
          new PhysicalPosition(
            savedPosition.x,
            savedPosition.y
          )
        );

        console.log(
          'Milly position restored'
        );
      } else {

        console.log(
          'No saved Milly position found'
        );
      }

      /*
       * =====================================================
       * LISTEN FOR WINDOW MOVEMENT
       * =====================================================
       */

      this.unlistenMoved =
        await win.onMoved(
          ({ payload: position }) => {

            /*
             * Cancel previous save timer.
             */

            if (this.saveTimeout) {

              clearTimeout(
                this.saveTimeout
              );
            }

            /*
             * Wait 300ms after movement stops.
             */

            this.saveTimeout =
              setTimeout(
                () => {
                  this.savePosition(
                    position.x,
                    position.y
                  );
                },
                300
              );
          }
        );

      console.log(
        'Window position listener initialized'
      );

    } catch (error) {

      console.error(
        'Failed to initialize position persistence:',
        error
      );
    }
  }

  /*
   * =========================================================
   * SAVE POSITION
   * =========================================================
   */

  private async savePosition(
    x: number,
    y: number
  ): Promise<void> {

    if (!this.store) {

      console.warn(
        'Store is not available; position was not saved'
      );

      return;
    }

    try {

      await this.store.set(
        'petPosition',
        {
          x,
          y
        }
      );

      await this.store.save();

      console.log(
        'Milly position saved:',
        {
          x,
          y
        }
      );

    } catch (error) {

      console.error(
        'Failed to save Milly position:',
        error
      );
    }
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

    /*
     * Start native Tauri window dragging.
     */

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

    /*
     * Small movement = click.
     *
     * Larger movement = window drag.
     */

    if (!moved) {

      this.onPetClick();
    }

    this.mouseDownPos = null;
  };

  /*
   * =========================================================
   * MILLY CLICK
   * =========================================================
   */

  private onPetClick(): void {

    if (!this.dizzyTrigger) {

      console.warn(
        'DizzyTrigger is not ready yet'
      );

      return;
    }

    console.log(
      'Milly clicked → DizzyTrigger fired'
    );

    this.dizzyTrigger.fire();
  }

  /*
   * =========================================================
   * CLEANUP
   * =========================================================
   */

  ngOnDestroy(): void {

    const canvas =
      this.canvasRef.nativeElement;

    /*
     * Remove mouse listeners.
     */

    canvas.removeEventListener(
      'mousedown',
      this.onMouseDown
    );

    window.removeEventListener(
      'mouseup',
      this.onMouseUp
    );

    /*
     * Cancel pending save.
     */

    if (this.saveTimeout) {

      clearTimeout(
        this.saveTimeout
      );
    }

    /*
     * Remove Tauri window movement listener.
     */

    if (this.unlistenMoved) {

      this.unlistenMoved();

      this.unlistenMoved = undefined;
    }

    /*
     * Clean up Rive.
     */

    this.rive?.cleanup();

    this.rive = undefined;

    this.dizzyTrigger = undefined;

    this.mouseDownPos = null;

    this.store = undefined;
  }
}