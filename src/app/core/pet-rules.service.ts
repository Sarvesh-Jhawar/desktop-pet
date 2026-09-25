import { Injectable, inject } from '@angular/core';
import { ActivityTrackerService } from './activity-tracker.service';
import { PetStateService } from './pet-state.service';
import { TaskStoreService } from './task-store.service';
import { PetState } from './pet-state.service';

const CHECK_INTERVAL_MS = 30_000;
const IDLE_SLEEPY_THRESHOLD_MINUTES = 90;
const LATE_NIGHT_HOUR = 23;

@Injectable({ providedIn: 'root' })
export class PetRulesService {
  private readonly petState = inject(PetStateService);
  private readonly activity = inject(ActivityTrackerService);
  private readonly taskStore = inject(TaskStoreService);
  private intervalId?: ReturnType<typeof setInterval>;
  private isOverriddenTemporarily = false;
  private lastRuleState?: PetState;

  onStateChange?: (state: PetState) => void;

  start(): void {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => void this.evaluate(), CHECK_INTERVAL_MS);
    void this.evaluate();
  }

  setTemporaryOverride(active: boolean): void {
    this.isOverriddenTemporarily = active;
  }

  private async evaluate(): Promise<void> {
    if (this.isOverriddenTemporarily) return;

    const now = new Date();
    const idleMinutes = this.activity.getIdleMinutes();
    console.log('[PetRules] evaluating', {
      idleSeconds: Math.round(idleMinutes * 60),
      hour: now.getHours()
    });

    if (now.getHours() >= LATE_NIGHT_HOUR || now.getHours() < 6) {
      console.log('[PetRules] sleeping: late-night rule');
      this.applyRuleState('sleeping');
      return;
    }

    if (idleMinutes >= IDLE_SLEEPY_THRESHOLD_MINUTES) {
      console.log('[PetRules] sleeping: inactivity rule');
      this.applyRuleState('sleeping');
      return;
    }

    const tasks = await this.taskStore.getAllTasks();
    const completedToday = tasks.filter(task =>
      task.completed && new Date(task.createdAt).toDateString() === now.toDateString()
    ).length;

    if (completedToday >= 3 && completedToday % 3 === 0) {
      // Achievement nudges will consume this milestone in a later phase.
    }

    this.applyRuleState('idle');
  }

  private applyRuleState(state: PetState): void {
    this.petState.setState(state);
    if (this.lastRuleState !== state) {
      this.lastRuleState = state;
      this.onStateChange?.(state);
    }
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    this.onStateChange = undefined;
  }
}