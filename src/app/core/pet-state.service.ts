import { Injectable } from '@angular/core';
import {
  Rive,
  StateMachineInput,
  ViewModelInstanceNumber
} from '@rive-app/canvas';

export const PET_BODY_COLORS = [
  { id: 'original', label: 'Original', hex: '#D5B896', value: null },
  { id: 'rose', label: 'Rose', hex: '#F48FB1', value: 0xfff48fb1 },
  { id: 'sky', label: 'Sky blue', hex: '#81D4FA', value: 0xff81d4fa },
  { id: 'mint', label: 'Mint', hex: '#80CBC4', value: 0xff80cbc4 },
  { id: 'lavender', label: 'Lavender', hex: '#B39DDB', value: 0xffb39ddb },
  { id: 'sunshine', label: 'Sunshine', hex: '#FFD54F', value: 0xffffd54f },
  { id: 'red', label: 'Red', hex: '#F44336', value: 0xfff44336 },
  { id: 'orange', label: 'Orange', hex: '#FF9800', value: 0xffff9800 },
  { id: 'yellow', label: 'Yellow', hex: '#FFEB3B', value: 0xffffeb3b },
  { id: 'green', label: 'Green', hex: '#4CAF50', value: 0xff4caf50 },
  { id: 'teal', label: 'Teal', hex: '#009688', value: 0xff009688 },
  { id: 'blue', label: 'Blue', hex: '#2196F3', value: 0xff2196f3 },
  { id: 'purple', label: 'Purple', hex: '#9C27B0', value: 0xff9c27b0 },
  { id: 'pink', label: 'Pink', hex: '#E91E63', value: 0xffe91e63 },
  { id: 'brown', label: 'Brown', hex: '#795548', value: 0xff795548 },
  { id: 'gray', label: 'Gray', hex: '#9E9E9E', value: 0xff9e9e9e },
  { id: 'black', label: 'Black', hex: '#212121', value: 0xff212121 },
  { id: 'white', label: 'White', hex: '#FAFAFA', value: 0xfffafafa }
] as const;

export type PetBodyColorId = (typeof PET_BODY_COLORS)[number]['id'];
export type CustomPetBodyColor = `#${string}`;
export type PetBodyColor = PetBodyColorId | CustomPetBodyColor;

export function isPetBodyColorId(value: unknown): value is PetBodyColorId {
  return PET_BODY_COLORS.some(option => option.id === value);
}

export function isCustomPetBodyColor(value: unknown): value is CustomPetBodyColor {
  return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
}

export function isPetBodyColor(value: unknown): value is PetBodyColor {
  return isPetBodyColorId(value) || isCustomPetBodyColor(value);
}

export const PET_DESIGNS = [
  { id: 'blush', label: 'Blush cheeks' },
  { id: 'freckles', label: 'Freckles' },
  { id: 'stars', label: 'Stars and sparkles' },
  { id: 'spots', label: 'Shell spots' },
  { id: 'accessory', label: 'Bow accessory' }
] as const;

export type PetDesignId = (typeof PET_DESIGNS)[number]['id'];

export function isPetDesignId(value: unknown): value is PetDesignId {
  return PET_DESIGNS.some(design => design.id === value);
}

export function isPetDesignSelection(value: unknown): value is PetDesignId[] {
  return Array.isArray(value) && value.every(isPetDesignId);
}

// The Rive file exposes four agentState values; other product states reuse them
// or use shell color and bubble text as visual fallbacks.
export type PetState =
  | 'idle'
  | 'talking'
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

const AGENT_STATE_MAP: Record<PetState, string> = {
  idle: 'idle',
  // Reuse the available typing motion until the Rive asset has a talking animation.
  talking: 'typing',
  working: 'thinking',
  waiting: 'typing',
  sad: 'error',
  happy: 'idle',
  excited: 'idle',
  celebrating: 'idle',
  sleeping: 'idle',
  'eye-rest': 'idle',
  hydration: 'idle',
  posture: 'idle'
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
  private bodyColor: PetBodyColor = 'original';
  private dizzyTrigger?: StateMachineInput;
  private dragX?: ViewModelInstanceNumber | null;
  private readonly healthTriggers = new Map<string, StateMachineInput>();

  attach(rive: Rive): void {
    this.rive = rive;
    this.defaultShellColor = rive.viewModelInstance?.color('shellColor')?.value;
    this.dragX = rive.viewModelInstance?.number('dragX');
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
    this.applyState();
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
    this.applyState();

    if (fireDizzy) {
      this.dizzyTrigger?.fire();
    }
  }

  setBodyColor(color: PetBodyColor): void {
    this.bodyColor = color;
    this.applyState();
  }

  private applyState(): void {
    const instance = this.rive?.viewModelInstance;
    if (!instance) return;

    const agentState = instance.enum('agentState');
    if (agentState) {
      const desiredState = AGENT_STATE_MAP[this.currentState];
      const matchingState = agentState.values.find(
        value => value.toLowerCase() === desiredState.toLowerCase()
      );
      if (matchingState) {
        agentState.value = matchingState;
      } else {
        console.warn('Rive agentState value is unavailable', {
          desiredState,
          availableValues: agentState.values
        });
      }
    }

    const presetColor = PET_BODY_COLORS.find(option => option.id === this.bodyColor)?.value;
    const selectedColor = presetColor ??
      (isCustomPetBodyColor(this.bodyColor)
        ? 0xff000000 + Number.parseInt(this.bodyColor.slice(1), 16)
        : undefined);
    const shellColor =
      selectedColor ??
      SHELL_COLOR_MAP[this.currentState] ??
      this.defaultShellColor;
    const color = instance.color('shellColor');
    if (color && shellColor !== undefined) {
      color.value = shellColor;
      console.log('[PetState] applied', this.currentState, shellColor);
    } else {
      console.warn(
        '[PetState] shellColor was not available',
        this.currentState
      );
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

  updateDragX(x: number): void {
    if (Number.isFinite(x) && this.dragX) {
      this.dragX.value = x;
    }
  }

  resetToIdle(): void {
    this.setState('idle');
  }
}