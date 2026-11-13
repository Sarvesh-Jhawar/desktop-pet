import { Rive } from '@rive-app/canvas';
import { isPetBodyColor, PetStateService } from './pet-state.service';

describe('PetStateService', () => {
  it('uses the exact case of the Rive enum values when speaking', () => {
    const agentState = {
      value: 'Idle',
      values: ['Idle', 'Typing', 'Thinking', 'error']
    };
    const color = { value: 0 };
    const rive = {
      viewModelInstance: {
        color: () => color,
        number: () => null,
        enum: () => agentState
      },
      stateMachineInputs: () => []
    } as unknown as Rive;
    const service = new PetStateService();

    service.attach(rive);
    service.setState('talking');

    expect(agentState.value).toBe('Typing');
  });

  it('reapplies its current state when the Rive asset attaches', () => {
    const service = new PetStateService();
    service.setState('talking');

    const agentState = {
      value: 'Idle',
      values: ['Idle', 'Typing', 'Thinking', 'error']
    };
    const rive = {
      viewModelInstance: {
        color: () => ({ value: 0 }),
        number: () => null,
        enum: () => agentState
      },
      stateMachineInputs: () => []
    } as unknown as Rive;

    service.attach(rive);

    expect(agentState.value).toBe('Typing');
  });

  it('keeps the selected body color across pet states', () => {
    const color = { value: 0 };
    const rive = {
      viewModelInstance: {
        color: () => color,
        number: () => null,
        enum: () => ({
          value: 'Idle',
          values: ['Idle', 'Typing', 'Thinking', 'error']
        })
      },
      stateMachineInputs: () => []
    } as unknown as Rive;
    const service = new PetStateService();

    service.attach(rive);
    service.setState('celebrating');
    service.setBodyColor('mint');

    expect(color.value).toBe(0xff80cbc4);
  });

  it('applies a custom hex color to the Rive shell', () => {
    const color = { value: 0 };
    const rive = {
      viewModelInstance: {
        color: () => color,
        number: () => null,
        enum: () => ({
          value: 'Idle',
          values: ['Idle', 'Typing', 'Thinking', 'error']
        })
      },
      stateMachineInputs: () => []
    } as unknown as Rive;
    const service = new PetStateService();

    service.attach(rive);
    service.setBodyColor('#12ABEF');

    expect(color.value).toBe(0xff12abef);
  });

  it('accepts only preset IDs or six-digit hex body colors', () => {
    expect(isPetBodyColor('rose')).toBe(true);
    expect(isPetBodyColor('#12aBeF')).toBe(true);
    expect(isPetBodyColor('#12ABC')).toBe(false);
    expect(isPetBodyColor('#12ABCG')).toBe(false);
  });
});
