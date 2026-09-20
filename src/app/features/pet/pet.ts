
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

  ngOnInit(): void {
    this.rive = new Rive({
      src: 'assets/pet.riv',

      canvas: this.canvasRef.nativeElement,

      // Milly's Rive configuration
      artboard: 'main',
      stateMachines: 'State Machine 1',

      // Start animation automatically
      autoplay: true,

      // Automatically bind the View Model
      autoBind: true,

      onLoad: () => {
        console.log('Milly Rive loaded successfully');

        // Make the drawing surface match the canvas
        this.rive?.resizeDrawingSurfaceToCanvas();

        // Get the state machine inputs
        const inputs =
          this.rive?.stateMachineInputs('State Machine 1');

        console.log(
          'Milly state machine inputs:',
          inputs
        );

        // Find Milly's dizzy trigger
        this.dizzyTrigger = inputs?.find(
          (input) => input.name === 'DizzyTrigger'
        );

        if (this.dizzyTrigger) {
          console.log('DizzyTrigger found');
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

    // Detect clicks on Milly's canvas
    this.canvasRef.nativeElement.addEventListener(
      'click',
      this.handleCanvasClick
    );
  }

  private handleCanvasClick = (): void => {
    this.onPetClick();
  };

  private onPetClick(): void {
    if (this.dizzyTrigger) {
      console.log('Milly clicked → DizzyTrigger fired');

      this.dizzyTrigger.fire();
    } else {
      console.warn(
        'DizzyTrigger is not ready yet'
      );
    }
  }

  ngOnDestroy(): void {
    // Remove the click listener
    this.canvasRef.nativeElement.removeEventListener(
      'click',
      this.handleCanvasClick
    );

    // Clean up Rive resources
    this.rive?.cleanup();

    this.rive = undefined;
    this.dizzyTrigger = undefined;
  }
}
