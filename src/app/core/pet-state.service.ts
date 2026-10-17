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
  | 'sleeping'
  | 'eye-rest'
  | 'hydration'
  | 'posture';

const AGENT_STATE_MAP: Record<PetState, 'Idle' | 'typing' | 'Thinking' | 'error'> = {
  idle: 'Idle',
  working: 'Thinking',
  waiting: 'typing',
  sad: 'error',
  happy: 'Idle',
  excited: 'Idle',
  celebrating: 'Idle',
  sleeping: 'Idle',
  'eye-rest': 'Idle',
  hydration: 'Idle',
  posture: 'Idle'
};

const SHELL_COLOR_MAP: Partial<Record<PetState, number>> = {
  happy: 0xffffd54f,
  excited: 0xffff7043,
  celebrating: 0xff66bb6a,
  sad: 0xff90a4ae,
  sleeping: 0xff5c6bc0,
  'eye-rest': 0xff90caf9,
  hydration: 0xff4fc3f7,
  posture: 0xffffcc80
};

@Injectable({ providedIn: 'root' })
export class PetStateService {
  private rive?: Rive;
  private currentState: PetState = 'idle';
  private defaultShellColor?: number;
  private dizzyTrigger?: StateMachineInput;
  private readonly healthTriggers = new Map<string, StateMachineInput>();

  attach(rive: Rive): void {
    this.rive = rive;
    this.defaultShellColor = rive.viewModelInstance?.color('shellColor')?.value;
    this.dizzyTrigger = rive.stateMachineInputs('State Machine 1')
      ?.find(input => input.name === 'DizzyTrigger');
    for (const name of [
      'triggerEyeRest',
      'triggerHydrate',
      'triggerPosture',
      'triggerCelebrate'
    ]) {
      const trigger = rive.stateMachineInputs('State Machine 1')
        ?.find(input => input.name === name);
      if (trigger) this.healthTriggers.set(name, trigger);
    }
    console.log('[PetState] attached', {
      defaultShellColor: this.defaultShellColor,
      hasShellColor: Boolean(rive.viewModelInstance?.color('shellColor')),
      hasAgentState: Boolean(rive.viewModelInstance?.enum('agentState'))
    });
  }

  getState(): PetState {
    return this.currentState;
  }

  setState(state: PetState, fireDizzy = false): void {
    this.currentState = state;
    const instance = this.rive?.viewModelInstance;
    if (!instance) return;

    const agentState = instance.enum('agentState');
    if (agentState) {
      agentState.value = AGENT_STATE_MAP[state];
    }

    const shellColor = SHELL_COLOR_MAP[state] ?? this.defaultShellColor;
    const color = instance.color('shellColor');
    if (color && shellColor !== undefined) {
      color.value = shellColor;
      console.log('[PetState] applied', state, shellColor);
    } else {
      console.warn('[PetState] shellColor was not available', state);
    }

    if (fireDizzy) {
      this.dizzyTrigger?.fire();
    }
  }

  fireHealthTrigger(name: string): void {
    const trigger = this.healthTriggers.get(name);
    if (trigger) {
      trigger.fire();
      return;
    }

    console.info(`Rive input "${name}" is unavailable; using the health banner fallback.`);
  }

  resetToIdle(): void {
    this.setState('idle');
  }
}