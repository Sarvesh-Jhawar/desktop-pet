import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { emit, listen } from '../../core/desktop-bridge';
import { TimerState } from '../../core/timer.service';

@Component({
  selector: 'app-timer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './timer.html',
  styleUrl: './timer.css'
})
export class Timer implements OnInit, OnDestroy {
  timers = signal<TimerState[]>([]);
  newLabel = '10-minute timer';
  newHours = 0;
  newMinutes = 10;
  newSeconds = 0;
  validationMessage = signal('');

  private timerNameEdited = false;

  private unlisten?: () => void;

  async ngOnInit(): Promise<void> {
    this.unlisten = await listen<TimerState[]>('timer-tick', event => {
      this.timers.set(event.payload);
    });
    await emit('timer-request-state', {});
  }

  async addTimer(): Promise<void> {
    const duration = this.toSeconds(this.newHours, this.newMinutes, this.newSeconds);
    this.validationMessage.set('');

    const label = this.newLabel.trim();
    if (!label) {
      this.validationMessage.set('Enter a name for this timer.');
      return;
    }
    if (duration <= 0) {
      this.validationMessage.set('Set a duration greater than zero.');
      return;
    }
    if (this.timers().some(timer => timer.duration === duration)) {
      this.validationMessage.set('A timer with that duration already exists.');
      return;
    }

    await emit('timer-command', { action: 'add', label, duration });
    this.newHours = 0;
    this.newMinutes = 10;
    this.newSeconds = 0;
    this.timerNameEdited = false;
    this.newLabel = this.suggestedTimerName();
    this.validationMessage.set('');
  }

  onTimerNameInput(value: string): void {
    this.timerNameEdited = true;
    this.newLabel = value;
  }

  onTimerDurationChange(): void {
    if (!this.timerNameEdited) {
      this.newLabel = this.suggestedTimerName();
    }
    this.validationMessage.set('');
  }

  private suggestedTimerName(): string {
    const duration = this.toSeconds(this.newHours, this.newMinutes, this.newSeconds);
    const presets: Record<number, string> = {
      [5 * 60]: 'Short break',
      [15 * 60]: 'Quick focus',
      [25 * 60]: 'Focus session',
      [45 * 60]: 'Deep work'
    };
    const preset = presets[duration];
    if (preset) return preset;

    const hours = Math.floor(duration / 3600);
    const minutes = Math.floor((duration % 3600) / 60);
    const seconds = duration % 60;
    const parts: string[] = [];
    if (hours) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
    if (minutes) parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`);
    if (seconds) parts.push(`${seconds} ${seconds === 1 ? 'second' : 'seconds'}`);
    return parts.length ? `${parts.join(' ')} timer` : 'Custom timer';
  }

  async quickStart(minutes: number): Promise<void> {
    await emit('timer-command', {
      action: 'quick-start',
      label: `${minutes}-minute focus`,
      duration: minutes * 60
    });
  }

  async adjust(timer: TimerState, seconds: number): Promise<void> {
    await emit('timer-command', { action: 'adjust', id: timer.id, seconds });
  }

  adjustWithWheel(timer: TimerState, event: WheelEvent): void {
    if (timer.status === 'completed') return;
    event.preventDefault();
    void this.adjust(timer, event.deltaY < 0 ? 60 : -60);
  }

  adjustWithKeyboard(timer: TimerState, event: KeyboardEvent): void {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    void this.adjust(timer, event.key === 'ArrowUp' ? 60 : -60);
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
