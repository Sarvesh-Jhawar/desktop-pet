import { Injectable } from '@angular/core';
import { Rive, StateMachineInput } from '@rive-app/webgl2';

// These are product states. Milly's Rive file only has four real animations;
// the remaining states are approximated with shell color and bubble text.
export type PetState =
  | 'idle'
  | 'working'
  | 'waiting'
  | 'sad'
  | 'happy'
  | 'excited'
  | 'celebrating'
  | 'sleeping';

const AGENT_STATE_MAP: Record<PetState, 'Idle' | 'typing' | 'Thinking' | 'error'> = {
  idle: 'Idle',
  working: 'Thinking',
  waiting: 'typing',
  sad: 'error',
  happy: 'Idle',
  excited: 'Idle',
  celebrating: 'Idle',
  sleeping: 'Idle'
};

const SHELL_COLOR_MAP: Partial<Record<PetState, number>> = {
  happy: 0xffffd54f,
  excited: 0xffff7043,
  celebrating: 0xff66bb6a,
  sad: 0xff90a4ae,
  sleeping: 0xff5c6bc0
};

@Injectable({ providedIn: 'root' })
export class PetStateService {
  private rive?: Rive;
  private currentState: PetState = 'idle';
  private defaultShellColor?: number;
  private dizzyTrigger?: StateMachineInput;

  attach(rive: Rive): void {
    this.rive = rive;
    this.defaultShellColor = rive.viewModelInstance?.color('shellColor')?.value;
    this.dizzyTrigger = rive.stateMachineInputs('State Machine 1')
      ?.find(input => input.name === 'DizzyTrigger');
  }

  getState(): PetState {
    return this.currentState;
  }

  setState(state: PetState, fireDizzy = false): void {
    const instance = this.rive?.viewModelInstance;
    if (!instance) return;

    this.currentState = state;

    const agentState = instance.enum('agentState');
    if (agentState) {
      agentState.value = AGENT_STATE_MAP[state];
    }

    const shellColor = SHELL_COLOR_MAP[state] ?? this.defaultShellColor;
    const color = instance.color('shellColor');
    if (color && shellColor !== undefined) {
      color.value = shellColor;
    }

    if (fireDizzy) {
      this.dizzyTrigger?.fire();
    }
  }

  resetToIdle(): void {
    this.setState('idle');
  }
}