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
  PhysicalPosition,
  LogicalSize
} from '@tauri-apps/api/dpi';

import {
  load,
  Store
} from '@tauri-apps/plugin-store';


/*
 * =========================================================
 * PET SIZE
 * =========================================================
 */

type PetSize = 'small' | 'medium' | 'large';

const SIZE_MAP: Record<PetSize, number> = {
  small: 150,
  medium: 250,
  large: 350
};


/*
 * =========================================================
 * PET COMPONENT
 * =========================================================
 */

@Component({
  selector: 'app-pet',
  standalone: true,
  templateUrl: './pet.html',
  styleUrl: './pet.css'
})
export class Pet implements OnInit, OnDestroy {

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
   * STORE
   * =========================================================
   */

  private store?: Store;

  private unlistenMoved?: () => void;

  private unlistenCloseRequested?: () => void;


  /*
   * =========================================================
   * PET SIZE
   * =========================================================
   */

  currentSize: PetSize = 'medium';


  /*
   * =========================================================
   * INITIALIZATION
   * =========================================================
   */

  ngOnInit(): void {

    /*
     * -------------------------------------------------------
     * Rive / Milly
     * -------------------------------------------------------
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

        /*
         * Make Rive drawing surface match canvas.
         */

        this.rive?.resizeDrawingSurfaceToCanvas();


        /*
         * Get legacy state machine inputs.
         */

        const inputs =
          this.rive?.stateMachineInputs(
            'State Machine 1'
          );

        console.log(
          'Milly state machine inputs:',
          inputs
        );


        /*
         * Find DizzyTrigger.
         */

        this.dizzyTrigger =
          inputs?.find(
            input =>
              input.name === 'DizzyTrigger'
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
     * -------------------------------------------------------
     * Mouse / Window Dragging
     * -------------------------------------------------------
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
     * -------------------------------------------------------
     * Position + Size Persistence
     * -------------------------------------------------------
     */

    this.initPersistence();
  }


  /*
   * =========================================================
   * INITIALIZE PERSISTENCE
   * =========================================================
   */

  private async initPersistence(): Promise<void> {

    try {

      console.log(
        'Starting persistence...'
      );


      /*
       * -------------------------------------------------------
       * Load one shared Store instance.
       * -------------------------------------------------------
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
       * Get current Tauri window.
       */

      const win =
        getCurrentWindow();


      /*
       * =====================================================
       * RESTORE POSITION
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
          'Restoring Milly position:',
          savedPosition
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
       * RESTORE SIZE
       * =====================================================
       */

      const savedSize =
        await this.store.get<PetSize>(
          'petSize'
        );


      console.log(
        'Saved Milly size:',
        savedSize
      );


      if (
        savedSize === 'small' ||
        savedSize === 'medium' ||
        savedSize === 'large'
      ) {

        /*
         * Apply saved size.
         *
         * persist = false because the value is already
         * stored. We don't need to save it again.
         */

        await this.setPetSize(
          savedSize,
          false
        );

      } else {

        /*
         * No saved size.
         * Use default medium size.
         */

        await this.applyPetSize(
          this.currentSize
        );
      }


      /*
       * =====================================================
       * SAVE POSITION IMMEDIATELY WHEN WINDOW MOVES
       * =====================================================
       *
       * IMPORTANT:
       *
       * There is intentionally NO debounce here.
       *
       * Every Tauri window movement event immediately
       * updates the store and saves it.
       *
       * This removes the old 300ms timer race condition.
       */

      this.unlistenMoved =
        await win.onMoved(
          async ({ payload: position }) => {

            if (!this.store) {

              console.warn(
                'Store unavailable; position not saved'
              );

              return;
            }


            try {

              await this.store.set(
                'petPosition',
                {
                  x: position.x,
                  y: position.y
                }
              );


              await this.store.save();


              console.log(
                'Milly position saved:',
                {
                  x: position.x,
                  y: position.y
                }
              );

            } catch (error) {

              console.error(
                'Failed to save Milly position:',
                error
              );
            }
          }
        );


      console.log(
        'Window position listener initialized'
      );


      /*
       * =====================================================
       * SAVE BEFORE WINDOW CLOSE
       * =====================================================
       *
       * This gives the frontend one final opportunity
       * to flush the store before the window closes.
       */

      this.unlistenCloseRequested =
        await win.onCloseRequested(
          async () => {

            if (!this.store) {

              console.warn(
                'Store unavailable during close'
              );

              return;
            }


            try {

              await this.store.save();


              console.log(
                'Milly settings saved before close'
              );

            } catch (error) {

              console.error(
                'Failed to save settings before close:',
                error
              );
            }
          }
        );


      console.log(
        'Window close listener initialized'
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
   * PET SIZE
   * =========================================================
   */

  async setPetSize(
    size: PetSize,
    persist: boolean = true
  ): Promise<void> {

    console.log(
      `Changing Milly size to: ${size}`
    );


    /*
     * Update current state.
     */

    this.currentSize = size;


    /*
     * Apply visual + native window size.
     */

    await this.applyPetSize(size);


    /*
     * Persist size if requested.
     */

    if (
      persist &&
      this.store
    ) {

      try {

        await this.store.set(
          'petSize',
          size
        );


        await this.store.save();


        console.log(
          'Milly size saved:',
          size
        );

      } catch (error) {

        console.error(
          'Failed to save Milly size:',
          error
        );
      }
    }
  }


  /*
   * =========================================================
   * APPLY PET SIZE
   * =========================================================
   */

  private async applyPetSize(
    size: PetSize
  ): Promise<void> {

    const px =
      SIZE_MAP[size];


    /*
     * -------------------------------------------------------
     * Update canvas CSS dimensions.
     * -------------------------------------------------------
     */

    const canvas =
      this.canvasRef.nativeElement;


    canvas.style.width =
      `${px}px`;


    canvas.style.height =
      `${px}px`;


    /*
     * -------------------------------------------------------
     * Update Rive drawing surface.
     * -------------------------------------------------------
     */

    this.rive?.resizeDrawingSurfaceToCanvas();


    /*
     * -------------------------------------------------------
     * Resize native Tauri window.
     * -------------------------------------------------------
     */

    try {

      await getCurrentWindow().setSize(
        new LogicalSize(
          px,
          px
        )
      );


      console.log(
        `Milly window resized to ${px}x${px}`
      );

    } catch (error) {

      console.error(
        'Failed to resize Milly window:',
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
     * Larger movement = drag.
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
     * -------------------------------------------------------
     * Remove mouse listeners.
     * -------------------------------------------------------
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
     * -------------------------------------------------------
     * Remove window movement listener.
     * -------------------------------------------------------
     */

    if (this.unlistenMoved) {

      this.unlistenMoved();

      this.unlistenMoved =
        undefined;
    }


    /*
     * -------------------------------------------------------
     * Remove close listener.
     * -------------------------------------------------------
     */

    if (this.unlistenCloseRequested) {

      this.unlistenCloseRequested();

      this.unlistenCloseRequested =
        undefined;
    }


    /*
     * -------------------------------------------------------
     * Clean up Rive.
     * -------------------------------------------------------
     */

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