import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import {
  HealthHabitService,
  HealthHabitSettings
} from '../../core/health-habit.service';

type HealthToggleKey =
  | 'eyeRestEnabled'
  | 'hydrationEnabled'
  | 'postureEnabled'
  | 'microBreaksEnabled'
  | 'healthChimesEnabled';

@Component({
  selector: 'app-health-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './health-settings.html',
  styleUrl: './health-settings.css'
})
export class HealthSettings implements OnInit {
  readonly health = inject(HealthHabitService);
  readonly loading = signal(true);
  readonly errorMessage = signal('');

  async ngOnInit(): Promise<void> {
    try {
      await this.health.initialize();
    } catch (error) {
      console.error('Failed to load health habit settings:', error);
      this.errorMessage.set('Health settings could not be loaded.');
    } finally {
      this.loading.set(false);
    }
  }

  async setToggle(key: HealthToggleKey, event: Event): Promise<void> {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const changes: Partial<Pick<HealthHabitSettings, HealthToggleKey>> = {};
    changes[key] = target.checked;
    await this.updateSetting(changes);
  }

  async setCadence(
    key: 'hydrationIntervalMinutes' | 'postureIntervalMinutes',
    event: Event
  ): Promise<void> {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    const value = Number(target.value);
    await this.updateSetting({ [key]: value });
  }

  private async updateSetting(changes: Partial<HealthHabitSettings>): Promise<void> {
    this.errorMessage.set('');
    try {
      await this.health.updateSettings(changes);
    } catch (error) {
      console.error('Failed to save health habit settings:', error);
      this.errorMessage.set('That setting could not be saved. Please try again.');
    }
  }
}
