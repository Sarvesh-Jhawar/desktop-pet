import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { Reminders } from '../reminders/reminders';
import { Settings } from '../settings/settings';
import { TaskList } from '../task-list/task-list';
import { Timer } from '../timer/timer';
import { HealthSettings } from '../health/health-settings';
import { CalendarView } from './calendar-view';

type DashboardTab = 'tasks' | 'timers' | 'reminders' | 'calendar' | 'health' | 'settings';

@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TaskList, Timer, Reminders, CalendarView, HealthSettings, Settings],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css'
})
export class Dashboard {
  activeTab = signal<DashboardTab>('tasks');

  selectTab(tab: DashboardTab): void {
    this.activeTab.set(tab);
  }
}