import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild
} from '@angular/core';

import { Rive } from '@rive-app/webgl2';

@Component({
  selector: 'app-pet',
  standalone: true,
  templateUrl: './pet.html',
  styleUrl: './pet.css',
})
export class Pet implements OnInit, OnDestroy {

  @ViewChild('petCanvas', { static: true })
  canvasRef!: ElementRef<HTMLCanvasElement>;

  private rive?: Rive;

  ngOnInit(): void {
    this.rive = new Rive({
      src: 'assets/pet.riv',
      canvas: this.canvasRef.nativeElement,
      artboard: 'main',
      stateMachines: 'State Machine 1',
      autoplay: true,
      autoBind: true,
      onLoad: () => {
        console.log('Milly Rive loaded');

        this.rive?.resizeDrawingSurfaceToCanvas();

        const inputs =
          this.rive?.stateMachineInputs('State Machine 1');

        console.log(
          'Milly state machine inputs:',
          inputs
        );
      },

      onLoadError: (error) => {
        console.error(
          'Milly Rive failed to load:',
          error
        );
      }
    });
  }

  ngOnDestroy(): void {
    this.rive?.cleanup();
  }
}