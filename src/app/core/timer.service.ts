import { Injectable } from '@angular/core';
import { emit } from '@tauri-apps/api/event';

export type TimerStatus = 'idle' | 'running' | 'paused' | 'completed';

export interface TimerState {
  id: string;
  label: string;
  duration: number;
  remaining: number;
  status: TimerStatus;
}

@Injectable({ providedIn: 'root' })
export class TimerService {
  private timers: TimerState[] = [
    this.createTimer('timer-1', 'Timer 1', 25 * 60),
    this.createTimer('timer-2', 'Timer 2', 5 * 60)
  ];
  private readonly intervalIds = new Map<string, ReturnType<typeof setInterval>>();
  private nextTimerNumber = 3;

  onComplete?: (timer: TimerState) => void;

  getState(): TimerState[] {
    return this.timers.map(timer => ({ ...timer }));
  }

  add(label: string, duration: number): void {
    if (duration <= 0 || this.timers.some(timer => timer.duration === duration)) return;

    const timerLabel = label.trim() || `Timer ${this.nextTimerNumber}`;
    this.timers.push(this.createTimer(`timer-${this.nextTimerNumber}`, timerLabel, duration));
    this.nextTimerNumber += 1;
    this.broadcast();
  }

  remove(id: string): void {
    this.clearTimer(id);
    this.timers = this.timers.filter(timer => timer.id !== id);
    this.broadcast();
  }

  start(id: string): void {
    const timer = this.find(id);
    if (!timer) return;

    this.clearTimer(id);
    timer.remaining = timer.duration;
    timer.status = 'running';
    this.broadcast();
    this.intervalIds.set(id, setInterval(() => this.tick(id), 1000));
  }

  pause(id: string): void {
    const timer = this.find(id);
    if (!timer || timer.status !== 'running') return;

    timer.status = 'paused';
    this.clearTimer(id);
    this.broadcast();
  }

  resume(id: string): void {
    const timer = this.find(id);
    if (!timer || timer.status !== 'paused') return;

    timer.status = 'running';
    this.broadcast();
    this.intervalIds.set(id, setInterval(() => this.tick(id), 1000));
  }

  reset(id: string): void {
    const timer = this.find(id);
    if (!timer) return;

    this.clearTimer(id);
    timer.remaining = timer.duration;
    timer.status = 'idle';
    this.broadcast();
  }

  private tick(id: string): void {
    const timer = this.find(id);
    if (!timer) return;

    timer.remaining -= 1;
    if (timer.remaining <= 0) {
      timer.remaining = 0;
      timer.status = 'completed';
      this.clearTimer(id);
      this.broadcast();
      void emit('timer-completed', { timer: { ...timer } });
      this.onComplete?.({ ...timer });
    } else {
      this.broadcast();
    }
  }

  private find(id: string): TimerState | undefined {
    return this.timers.find(timer => timer.id === id);
  }

  private createTimer(id: string, label: string, duration: number): TimerState {
    return { id, label, duration, remaining: duration, status: 'idle' };
  }

  private broadcast(): void {
    void emit('timer-tick', this.getState());
  }

  private clearTimer(id: string): void {
    const intervalId = this.intervalIds.get(id);
    if (intervalId) {
      clearInterval(intervalId);
      this.intervalIds.delete(id);
    }
  }
}