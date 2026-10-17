import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { Reminders } from '../reminders/reminders';
import { Settings } from '../settings/settings';
import { TaskList } from '../task-list/task-list';
import { Timer } from '../timer/timer';
import { HealthSettings } from '../health/health-settings';

type DashboardTab = 'tasks' | 'timers' | 'reminders' | 'health' | 'settings';

@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TaskList, Timer, Reminders, HealthSettings, Settings],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css'
})
export class Dashboard {
  activeTab = signal<DashboardTab>('tasks');

  selectTab(tab: DashboardTab): void {
    this.activeTab.set(tab);
  }
}