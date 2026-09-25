import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { emit, listen } from '@tauri-apps/api/event';
import { TimerState } from '../../core/timer.service';

@Component({
  selector: 'app-timer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './timer.html',
  styleUrl: './timer.css'
})
export class Timer implements OnInit, OnDestroy {
  timers: TimerState[] = [];
  newLabel = '';
  newHours = 0;
  newMinutes = 10;
  newSeconds = 0;
  validationMessage = '';

  private readonly changeDetector = inject(ChangeDetectorRef);
  private unlisten?: () => void;

  async ngOnInit(): Promise<void> {
    this.unlisten = await listen<TimerState[]>('timer-tick', event => {
      this.timers = event.payload;
      this.changeDetector.markForCheck();
    });
    await emit('timer-request-state', {});
  }

  async addTimer(): Promise<void> {
    const duration = this.toSeconds(this.newHours, this.newMinutes, this.newSeconds);
    this.validationMessage = '';

    if (duration <= 0) {
      this.validationMessage = 'Set a duration greater than zero.';
      return;
    }
    if (this.timers.some(timer => timer.duration === duration)) {
      this.validationMessage = 'A timer with that duration already exists.';
      return;
    }

    const label = this.newLabel.trim() || `Timer ${this.timers.length + 1}`;
    await emit('timer-command', { action: 'add', label, duration });
    this.newLabel = '';
    this.newHours = 0;
    this.newMinutes = 10;
    this.newSeconds = 0;
  }

  async start(timer: TimerState): Promise<void> {
    await emit('timer-command', { action: 'start', id: timer.id });
  }

  async pause(timer: TimerState): Promise<void> {
    await emit('timer-command', { action: 'pause', id: timer.id });
  }

  async resume(timer: TimerState): Promise<void> {
    await emit('timer-command', { action: 'resume', id: timer.id });
  }

  async reset(timer: TimerState): Promise<void> {
    await emit('timer-command', { action: 'reset', id: timer.id });
  }

  async remove(timer: TimerState): Promise<void> {
    await emit('timer-command', { action: 'remove', id: timer.id });
  }

  display(seconds: number): string {
    const hours = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const remainder = (seconds % 60).toString().padStart(2, '0');
    return `${hours}:${minutes}:${remainder}`;
  }

  private toSeconds(hours: number, minutes: number, seconds: number): number {
    return Math.max(0, hours) * 3600 + Math.max(0, minutes) * 60 + Math.max(0, seconds);
  }

  ngOnDestroy(): void {
    this.unlisten?.();
  }
}
