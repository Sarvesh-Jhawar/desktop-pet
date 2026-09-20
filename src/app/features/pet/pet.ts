
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

import { getCurrentWindow } from '@tauri-apps/api/window';

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

  private mouseDownPos: { x: number; y: number } | null = null;

  private readonly DRAG_THRESHOLD = 4;

  ngOnInit(): void {

    this.rive = new Rive({
      src: 'assets/pet.riv',

      canvas: this.canvasRef.nativeElement,


      artboard: 'main',

      stateMachines: 'State Machine 1',


      autoplay: true,


      autoBind: true,


      onLoad: () => {

        console.log('Milly Rive loaded successfully');


        this.rive?.resizeDrawingSurfaceToCanvas();


        const inputs =
          this.rive?.stateMachineInputs('State Machine 1');

        console.log(
          'Milly state machine inputs:',
          inputs
        );

        this.dizzyTrigger = inputs?.find(
          input => input.name === 'DizzyTrigger'
        );

        if (this.dizzyTrigger) {
          console.log('DizzyTrigger found');
        } else {
          console.warn('DizzyTrigger not found');
        }
      },

      onLoadError: (error) => {

        console.error(
          'Milly Rive failed to load:',
          error
        );
      }
    });

    const canvas = this.canvasRef.nativeElement;

    canvas.addEventListener(
      'mousedown',
      this.onMouseDown
    );

    window.addEventListener(
      'mouseup',
      this.onMouseUp
    );
  }

  private onMouseDown = (event: MouseEvent): void => {

    this.mouseDownPos = {
      x: event.clientX,
      y: event.clientY
    };

    // Start native Tauri window dragging.
    getCurrentWindow()
      .startDragging()
      .catch(error => {
        console.error(
          'Failed to start window dragging:',
          error
        );
      });
  };

  private onMouseUp = (event: MouseEvent): void => {

    if (!this.mouseDownPos) {
      return;
    }

    const dx =
      Math.abs(event.clientX - this.mouseDownPos.x);

    const dy =
      Math.abs(event.clientY - this.mouseDownPos.y);

    const moved =
      dx > this.DRAG_THRESHOLD ||
      dy > this.DRAG_THRESHOLD;

    if (!moved) {
      this.onPetClick();
    }

    this.mouseDownPos = null;
  };

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

  ngOnDestroy(): void {

    const canvas =
      this.canvasRef.nativeElement;

    canvas.removeEventListener(
      'mousedown',
      this.onMouseDown
    );

    window.removeEventListener(
      'mouseup',
      this.onMouseUp
    );

    this.rive?.cleanup();

    this.rive = undefined;

    this.dizzyTrigger = undefined;

    this.mouseDownPos = null;
  }
}
