import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { emit, listen } from '@tauri-apps/api/event';
import { load, Store } from '@tauri-apps/plugin-store';
import { interval, Subscription } from 'rxjs';
import { ActivityTrackerService } from './activity-tracker.service';

export type HealthHabitKind = 'eye-rest' | 'hydration' | 'posture' | 'stretch';
export type HealthHabitTrigger = 'triggerEyeRest' | 'triggerHydrate' | 'triggerPosture' | 'triggerCelebrate';

export interface HealthHabitSettings {
  eyeRestEnabled: boolean;
  hydrationEnabled: boolean;
  postureEnabled: boolean;
  microBreaksEnabled: boolean;
  healthChimesEnabled: boolean;
  hydrationIntervalMinutes: 30 | 45 | 60;
  postureIntervalMinutes: 45 | 60 | 90;
}

export interface ActiveHealthHabit {
  id: number;
  kind: HealthHabitKind;
  title: string;
  message: string;
  icon: string;
  durationSeconds: number;
  remainingSeconds: number;
  countsAs?: 'hydration' | 'stretch';
}

export interface DailyHealthCounts {
  date: string;
  hydration: number;
  eyeRests: number;
  postures: number;
  stretches: number;
}

export interface MicroBreakExercise {
  name: string;
  instruction: string;
  durationSeconds: number;
  icon: string;
  countsAs: 'hydration' | 'stretch';
}

interface PersistedHealthState {
  settings?: Partial<HealthHabitSettings>;
  daily?: Partial<DailyHealthCounts>;
  streakDays?: number;
  lastHabitCompletionDate?: string;
}

const STORE_KEY = 'healthHabitState';
const TICK_MS = 1000;
const ACTIVE_IDLE_LIMIT_MINUTES = 5;
const MAX_TICK_ELAPSED_MS = 5000;
const HABIT_TIMEOUT_SECONDS = 3 * 60;
const EYE_REST_SECONDS = 20;
const EYE_REST_INTERVAL_SECONDS = 20 * 60;
const MICRO_BREAK_SECONDS = 5 * 60;

const DEFAULT_SETTINGS: HealthHabitSettings = {
  eyeRestEnabled: true,
  hydrationEnabled: true,
  postureEnabled: true,
  microBreaksEnabled: true,
  healthChimesEnabled: true,
  hydrationIntervalMinutes: 45,
  postureIntervalMinutes: 60
};

const DEFAULT_EXERCISES: MicroBreakExercise[] = [
  { name: 'Shoulder rolls', instruction: 'Roll your shoulders gently for 30 seconds.', durationSeconds: 30, icon: '🧘', countsAs: 'stretch' },
  { name: 'Neck tilts', instruction: 'Gently tilt your neck from side to side for 30 seconds.', durationSeconds: 30, icon: '🧘', countsAs: 'stretch' },
  { name: 'Wrist and finger flexes', instruction: 'Stretch and flex your wrists and fingers for 30 seconds.', durationSeconds: 30, icon: '🧘', countsAs: 'stretch' },
  { name: 'Standing stretch', instruction: 'Stand, stretch, and try a few calf raises for one minute.', durationSeconds: 60, icon: '🧘', countsAs: 'stretch' },
  { name: 'Water refill', instruction: 'Take a moment to refill your glass of water.', durationSeconds: 60, icon: '💧', countsAs: 'hydration' }
];

function todayKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

@Injectable({ providedIn: 'root' })
export class HealthHabitService implements OnDestroy {
  private readonly activity = inject(ActivityTrackerService);
  private store?: Store;
  private initializePromise?: Promise<void>;
  private tickSubscription?: Subscription;
  private lastTickAt = 0;
  private eyeRestElapsedSeconds = 0;
  private hydrationElapsedSeconds = 0;
  private postureElapsedSeconds = 0;
  private activeHabitId = 0;
  private breakElapsedSeconds = 0;
  private lastHabitCompletionDate?: string;
  private unlistenSettings?: () => void;
  private unlistenCounters?: () => void;

  readonly settings = signal<HealthHabitSettings>({ ...DEFAULT_SETTINGS });
  readonly activeHabit = signal<ActiveHealthHabit | null>(null);
  readonly dailyCounts = signal<DailyHealthCounts>({
    date: todayKey(),
    hydration: 0,
    eyeRests: 0,
    postures: 0,
    stretches: 0
  });
  readonly streakDays = signal(0);
  readonly microBreakActive = signal(false);
  readonly microBreakRemainingSeconds = signal(0);
  readonly microBreakExercise = signal<MicroBreakExercise | null>(null);

  onHabitStarted?: (habit: ActiveHealthHabit) => void;
  onHabitCompleted?: (habit: ActiveHealthHabit, completed: boolean) => void;
  onMicroBreakFinished?: (exercise: MicroBreakExercise, completed: boolean) => void;

  async initialize(): Promise<void> {
    this.initializePromise ??= this.loadState();
    return this.initializePromise;
  }

  async start(): Promise<void> {
    await this.initialize();
    if (this.tickSubscription) return;

    this.lastTickAt = Date.now();
    if (this.isTauriRuntime()) {
      try {
        this.unlistenSettings = await listen<HealthHabitSettings>(
          'health-settings-updated',
          event => this.applyRemoteSettings(event.payload)
        );
      } catch (error) {
        console.error('Health reminders will run without cross-window settings sync:', error);
      }
    }
    this.tickSubscription = interval(TICK_MS).subscribe(() => this.tick());
  }

  async updateSettings(changes: Partial<HealthHabitSettings>): Promise<void> {
    await this.initialize();
    const nextSettings = this.normalizeSettings({ ...this.settings(), ...changes });
    const previousSettings = this.settings();
    const previousElapsed = {
      eyeRest: this.eyeRestElapsedSeconds,
      hydration: this.hydrationElapsedSeconds,
      posture: this.postureElapsedSeconds
    };
    this.settings.set(nextSettings);
    if (changes.eyeRestEnabled !== undefined) this.eyeRestElapsedSeconds = 0;
    if (changes.hydrationEnabled !== undefined || changes.hydrationIntervalMinutes !== undefined) {
      this.hydrationElapsedSeconds = 0;
    }
    if (changes.postureEnabled !== undefined || changes.postureIntervalMinutes !== undefined) {
      this.postureElapsedSeconds = 0;
    }

    try {
      await this.persist();
    } catch (error) {
      this.settings.set(previousSettings);
      this.eyeRestElapsedSeconds = previousElapsed.eyeRest;
      this.hydrationElapsedSeconds = previousElapsed.hydration;
      this.postureElapsedSeconds = previousElapsed.posture;
      throw error;
    }

    this.dismissDisabledHabit(nextSettings);
    if (this.isTauriRuntime()) {
      try {
        await emit('health-settings-updated', nextSettings);
      } catch (error) {
        console.error('Health settings were saved, but the pet window was not notified:', error);
      }
    }
  }

  completeActiveHabitFromPet(): void {
    const habit = this.activeHabit();
    if (!habit) return;
    void this.finishHabit(habit, habit.kind !== 'eye-rest').catch(error => {
      console.error('Failed to record the health habit interaction:', error);
    });
  }

  completeActiveHabit(): void {
    const habit = this.activeHabit();
    if (!habit || habit.kind === 'eye-rest') return;
    void this.finishHabit(habit, true).catch(error => {
      console.error('Failed to record the completed health habit:', error);
    });
  }

  skipEyeRest(): void {
    const habit = this.activeHabit();
    if (!habit || habit.kind !== 'eye-rest') return;
    void this.finishHabit(habit, false).catch(error => {
      console.error('Failed to dismiss the eye rest:', error);
    });
  }

  startMicroBreak(): MicroBreakExercise | null {
    if (!this.settings().microBreaksEnabled || this.microBreakActive() || this.activeHabit()) {
      return null;
    }
    const index = Math.floor(Math.random() * DEFAULT_EXERCISES.length);
    const exercise = DEFAULT_EXERCISES[index];
    this.microBreakActive.set(true);
    this.microBreakRemainingSeconds.set(MICRO_BREAK_SECONDS);
    this.breakElapsedSeconds = 0;
    this.microBreakExercise.set(exercise);
    this.startHabit({
      kind: 'stretch',
      title: exercise.name,
      message: exercise.instruction,
      icon: exercise.icon,
      durationSeconds: exercise.durationSeconds,
      countsAs: exercise.countsAs
    });
    return exercise;
  }

  finishMicroBreak(completed = true): void {
    if (!this.microBreakActive()) return;
    const exercise = this.microBreakExercise();
    this.microBreakActive.set(false);
    this.microBreakRemainingSeconds.set(0);
    this.microBreakExercise.set(null);
    this.breakElapsedSeconds = 0;

    const activeHabit = this.activeHabit();
    if (activeHabit?.kind === 'stretch') {
      void this.finishHabit(activeHabit, completed && activeHabit.remainingSeconds <= 0).catch(error => {
        console.error('Failed to record the completed micro-break exercise:', error);
      });
    }
    if (exercise) this.onMicroBreakFinished?.(exercise, completed);
  }

  stop(): void {
    this.tickSubscription?.unsubscribe();
    this.tickSubscription = undefined;
    this.unlistenSettings?.();
    this.unlistenSettings = undefined;
  }

  ngOnDestroy(): void {
    this.stop();
    this.unlistenCounters?.();
    this.unlistenCounters = undefined;
  }

  private async loadState(): Promise<void> {
    this.store = await load('settings.json', { autoSave: false });
    const saved = await this.store.get<PersistedHealthState>(STORE_KEY);
    this.settings.set(this.normalizeSettings(saved?.settings ?? {}));
    this.streakDays.set(this.countValue(saved?.streakDays));
    this.lastHabitCompletionDate = saved?.lastHabitCompletionDate;

    const currentDate = todayKey();
    const savedDaily = saved?.daily;
    const daily = savedDaily?.date === currentDate
      ? {
          date: currentDate,
          hydration: this.countValue(savedDaily.hydration),
          eyeRests: this.countValue(savedDaily.eyeRests),
          postures: this.countValue(savedDaily.postures),
          stretches: this.countValue(savedDaily.stretches)
        }
      : { date: currentDate, hydration: 0, eyeRests: 0, postures: 0, stretches: 0 };
    this.dailyCounts.set(daily);

    if (savedDaily?.date !== currentDate) await this.persist();
    if (this.isTauriRuntime()) {
      try {
        this.unlistenCounters = await listen<DailyHealthCounts>(
          'health-state-updated',
          event => {
            if (event.payload.date === todayKey()) {
              this.dailyCounts.set(event.payload);
            }
          }
        );
      } catch (error) {
        console.error('Health counters will not update in other windows:', error);
      }
    }
  }

  private tick(): void {
    const now = Date.now();
    const elapsedSeconds = Math.min(
      MAX_TICK_ELAPSED_MS,
      Math.max(0, now - this.lastTickAt)
    ) / 1000;
    this.lastTickAt = now;

    this.ensureToday();
    this.tickMicroBreak(elapsedSeconds);

    const habit = this.activeHabit();
    if (habit) {
      const remainingSeconds = Math.max(0, habit.remainingSeconds - elapsedSeconds);
      this.activeHabit.set({ ...habit, remainingSeconds });
      if (remainingSeconds <= 0) {
        void this.finishHabit(habit, habit.kind === 'eye-rest' || habit.kind === 'stretch')
          .catch(error => console.error('Failed to record an automatically completed health habit:', error));
      }
      return;
    }

    if (this.microBreakActive()) return;
    if (this.activity.getIdleMinutes() >= ACTIVE_IDLE_LIMIT_MINUTES) return;

    const settings = this.settings();
    if (settings.eyeRestEnabled) this.eyeRestElapsedSeconds += elapsedSeconds;
    if (settings.hydrationEnabled) this.hydrationElapsedSeconds += elapsedSeconds;
    if (settings.postureEnabled) this.postureElapsedSeconds += elapsedSeconds;
    if (settings.eyeRestEnabled && this.eyeRestElapsedSeconds >= EYE_REST_INTERVAL_SECONDS) {
      this.eyeRestElapsedSeconds = 0;
      this.startHabit({
        kind: 'eye-rest',
        title: '20-20-20 eye rest',
        message: 'Rest your eyes! Look 20 feet away.',
        icon: '👀',
        durationSeconds: EYE_REST_SECONDS
      });
      return;
    }
    if (
      settings.hydrationEnabled &&
      this.hydrationElapsedSeconds >= settings.hydrationIntervalMinutes * 60
    ) {
      this.hydrationElapsedSeconds = 0;
      this.startHabit({
        kind: 'hydration',
        title: 'Hydration check!',
        message: 'Hydration check! Take a moment to drink some water.',
        icon: '💧',
        durationSeconds: HABIT_TIMEOUT_SECONDS
      });
      return;
    }
    if (
      settings.postureEnabled &&
      this.postureElapsedSeconds >= settings.postureIntervalMinutes * 60
    ) {
      this.postureElapsedSeconds = 0;
      this.startHabit({
        kind: 'posture',
        title: 'Posture check',
        message: 'Posture check: roll your shoulders back!',
        icon: '🧍',
        durationSeconds: HABIT_TIMEOUT_SECONDS
      });
    }
  }

  private tickMicroBreak(elapsedSeconds: number): void {
    if (!this.microBreakActive()) return;

    this.breakElapsedSeconds += elapsedSeconds;
    this.microBreakRemainingSeconds.set(
      Math.max(0, MICRO_BREAK_SECONDS - Math.floor(this.breakElapsedSeconds))
    );
  }

  private startHabit(
    habit: Omit<ActiveHealthHabit, 'id' | 'remainingSeconds'>
  ): void {
    if (this.activeHabit()) return;
    const activeHabit: ActiveHealthHabit = {
      ...habit,
      id: ++this.activeHabitId,
      remainingSeconds: habit.durationSeconds
    };
    this.activeHabit.set(activeHabit);
    this.onHabitStarted?.(activeHabit);
  }

  private applyRemoteSettings(settings: HealthHabitSettings): void {
    const nextSettings = this.normalizeSettings(settings);
    if (nextSettings.eyeRestEnabled !== this.settings().eyeRestEnabled) {
      this.eyeRestElapsedSeconds = 0;
    }
    if (
      nextSettings.hydrationEnabled !== this.settings().hydrationEnabled ||
      nextSettings.hydrationIntervalMinutes !== this.settings().hydrationIntervalMinutes
    ) {
      this.hydrationElapsedSeconds = 0;
    }
    if (
      nextSettings.postureEnabled !== this.settings().postureEnabled ||
      nextSettings.postureIntervalMinutes !== this.settings().postureIntervalMinutes
    ) {
      this.postureElapsedSeconds = 0;
    }
    this.settings.set(nextSettings);
    this.dismissDisabledHabit(nextSettings);
  }

  private dismissDisabledHabit(settings: HealthHabitSettings): void {
    const active = this.activeHabit();
    if (
      (active?.kind === 'eye-rest' && !settings.eyeRestEnabled) ||
      (active?.kind === 'hydration' && !settings.hydrationEnabled) ||
      (active?.kind === 'posture' && !settings.postureEnabled)
    ) {
      void this.finishHabit(active, false).catch(error => {
        console.error('Failed to dismiss a disabled health reminder:', error);
      });
    }
    if (this.microBreakActive() && !settings.microBreaksEnabled) {
      this.finishMicroBreak(false);
    }
  }

  private async finishHabit(habit: ActiveHealthHabit, completed: boolean): Promise<void> {
    if (this.activeHabit()?.id !== habit.id) return;
    this.activeHabit.set(null);
    if (!completed) {
      this.onHabitCompleted?.(habit, false);
      return;
    }

    const current = this.dailyCounts();
    const next: DailyHealthCounts = {
      ...current,
      hydration: current.hydration + (
        habit.kind === 'hydration' || habit.countsAs === 'hydration' ? 1 : 0
      ),
      eyeRests: current.eyeRests + (habit.kind === 'eye-rest' ? 1 : 0),
      postures: current.postures + (habit.kind === 'posture' ? 1 : 0),
      stretches: current.stretches + (
        habit.kind === 'stretch' && habit.countsAs !== 'hydration' ? 1 : 0
      )
    };
    const previousStreak = this.streakDays();
    const previousCompletionDate = this.lastHabitCompletionDate;
    if (this.lastHabitCompletionDate !== next.date) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      this.streakDays.set(
        this.lastHabitCompletionDate === todayKey(yesterday)
          ? previousStreak + 1
          : 1
      );
      this.lastHabitCompletionDate = next.date;
    }
    this.dailyCounts.set(next);
    this.onHabitCompleted?.(habit, true);
    try {
      await this.persist();
    } catch (error) {
      this.dailyCounts.set(current);
      this.streakDays.set(previousStreak);
      this.lastHabitCompletionDate = previousCompletionDate;
      throw error;
    }
    await this.broadcastState();
  }

  private ensureToday(): void {
    const date = todayKey();
    if (this.dailyCounts().date === date) return;
    this.dailyCounts.set({
      date,
      hydration: 0,
      eyeRests: 0,
      postures: 0,
      stretches: 0
    });
    void this.persist().catch(error => {
      console.error('Failed to reset daily health counters:', error);
    });
  }

  private async persist(): Promise<void> {
    if (!this.store) {
      throw new Error('Health habit settings are not initialized.');
    }
    await this.store.set(STORE_KEY, {
      settings: this.settings(),
      daily: this.dailyCounts(),
      streakDays: this.streakDays(),
      lastHabitCompletionDate: this.lastHabitCompletionDate
    } satisfies PersistedHealthState);
    await this.store.save();
  }

  private async broadcastState(): Promise<void> {
    if (!this.isTauriRuntime()) return;
    try {
      await emit('health-state-updated', this.dailyCounts());
    } catch (error) {
      console.error('Health counters were saved, but the Dashboard was not notified:', error);
    }
  }

  private normalizeSettings(settings: Partial<HealthHabitSettings>): HealthHabitSettings {
    const hydrationValue = Number(settings.hydrationIntervalMinutes);
    const postureValue = Number(settings.postureIntervalMinutes);

    return {
      eyeRestEnabled: settings.eyeRestEnabled ?? DEFAULT_SETTINGS.eyeRestEnabled,
      hydrationEnabled: settings.hydrationEnabled ?? DEFAULT_SETTINGS.hydrationEnabled,
      postureEnabled: settings.postureEnabled ?? DEFAULT_SETTINGS.postureEnabled,
      microBreaksEnabled: settings.microBreaksEnabled ?? DEFAULT_SETTINGS.microBreaksEnabled,
      healthChimesEnabled: settings.healthChimesEnabled ?? DEFAULT_SETTINGS.healthChimesEnabled,
      hydrationIntervalMinutes: hydrationValue === 30 || hydrationValue === 45 || hydrationValue === 60
        ? hydrationValue
        : DEFAULT_SETTINGS.hydrationIntervalMinutes,
      postureIntervalMinutes: postureValue === 45 || postureValue === 60 || postureValue === 90
        ? postureValue
        : DEFAULT_SETTINGS.postureIntervalMinutes
    };
  }

  private countValue(value: unknown): number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
  }

  private isTauriRuntime(): boolean {
    return Boolean((globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
  }
}
