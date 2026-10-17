import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ActivityTrackerService } from './activity-tracker.service';
import { HealthHabitService } from './health-habit.service';

const mockStore = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  save: vi.fn()
}));

vi.mock('@tauri-apps/plugin-store', () => ({
  load: vi.fn(async () => mockStore)
}));

describe('HealthHabitService', () => {
  let service: HealthHabitService;
  let idleMinutes: number;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-17T08:00:00'));
    idleMinutes = 0;
    mockStore.get.mockReset();
    mockStore.set.mockReset().mockResolvedValue(undefined);
    mockStore.save.mockReset().mockResolvedValue(undefined);
    mockStore.get.mockResolvedValue({
      settings: {
        eyeRestEnabled: true,
        hydrationEnabled: false,
        postureEnabled: false,
        microBreaksEnabled: true
      },
      daily: {
        date: '2026-10-17',
        hydration: 2,
        eyeRests: 0,
        postures: 0,
        stretches: 0
      }
    });

    TestBed.configureTestingModule({
      providers: [
        HealthHabitService,
        {
          provide: ActivityTrackerService,
          useValue: { getIdleMinutes: () => idleMinutes }
        }
      ]
    });
    service = TestBed.inject(HealthHabitService);
  });

  afterEach(() => {
    service.stop();
    vi.restoreAllMocks();
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('schedules an eye rest after 20 active minutes and records it after the 20-second rest', async () => {
    await service.start();
    await vi.advanceTimersByTimeAsync(20 * 60 * 1000);

    expect(service.activeHabit()?.kind).toBe('eye-rest');
    expect(service.activeHabit()?.message).toBe('Rest your eyes! Look 20 feet away.');

    await vi.advanceTimersByTimeAsync(20 * 1000);
    expect(service.activeHabit()).toBeNull();
    expect(service.dailyCounts().eyeRests).toBe(1);
    expect(service.streakDays()).toBe(1);
    expect(mockStore.save).toHaveBeenCalled();
  });

  it('does not accrue reminder time while the desk is idle', async () => {
    idleMinutes = 6;
    await service.start();
    await vi.advanceTimersByTimeAsync(25 * 60 * 1000);
    expect(service.activeHabit()).toBeNull();

    idleMinutes = 0;
    await vi.advanceTimersByTimeAsync(20 * 60 * 1000);
    expect(service.activeHabit()?.kind).toBe('eye-rest');
  });

  it('records hydration when the user completes the reminder', async () => {
    await service.updateSettings({
      eyeRestEnabled: false,
      hydrationEnabled: true,
      hydrationIntervalMinutes: 30
    });
    await service.start();
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);

    expect(service.activeHabit()?.kind).toBe('hydration');
    service.completeActiveHabit();
    await vi.advanceTimersByTimeAsync(0);

    expect(service.activeHabit()).toBeNull();
    expect(service.dailyCounts().hydration).toBe(3);
  });

  it('dismisses an ignored hydration reminder after three minutes without counting it', async () => {
    await service.updateSettings({
      eyeRestEnabled: false,
      hydrationEnabled: true,
      hydrationIntervalMinutes: 30
    });
    await service.start();
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(service.activeHabit()?.kind).toBe('hydration');

    await vi.advanceTimersByTimeAsync(3 * 60 * 1000);

    expect(service.activeHabit()).toBeNull();
    expect(service.dailyCounts().hydration).toBe(2);
  });

  it('dismisses an active reminder when that reminder is switched off', async () => {
    await service.updateSettings({
      eyeRestEnabled: false,
      hydrationEnabled: true,
      hydrationIntervalMinutes: 30
    });
    await service.start();
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);

    await service.updateSettings({ hydrationEnabled: false });

    expect(service.activeHabit()).toBeNull();
    expect(service.dailyCounts().hydration).toBe(2);
  });

  it('offers a random short-break exercise and counts it after its duration', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const onFinished = vi.fn();
    service.onMicroBreakFinished = onFinished;
    await service.start();
    const exercise = service.startMicroBreak();

    expect(exercise?.name).toBe('Shoulder rolls');
    expect(service.activeHabit()?.kind).toBe('stretch');
    await vi.advanceTimersByTimeAsync(30 * 1000);

    expect(service.activeHabit()).toBeNull();
    expect(service.dailyCounts().stretches).toBe(1);
    expect(service.microBreakRemainingSeconds()).toBe(270);

    service.finishMicroBreak();
    expect(service.microBreakActive()).toBe(false);
    expect(onFinished).toHaveBeenCalledWith(exercise, true);
  });

  it('records the water-refill exercise as hydration rather than a stretch', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    await service.start();
    const exercise = service.startMicroBreak();

    expect(exercise?.name).toBe('Water refill');
    await vi.advanceTimersByTimeAsync(60 * 1000);

    expect(service.dailyCounts().hydration).toBe(3);
    expect(service.dailyCounts().stretches).toBe(0);
  });
});
