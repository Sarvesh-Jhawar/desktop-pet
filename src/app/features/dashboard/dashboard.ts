import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Reminders } from '../reminders/reminders';
import { Settings } from '../settings/settings';
import { TaskList } from '../task-list/task-list';
import { Timer } from '../timer/timer';

type DashboardTab = 'tasks' | 'timers' | 'reminders' | 'settings';

@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TaskList, Timer, Reminders, Settings],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css'
})
export class Dashboard {
  activeTab: DashboardTab = 'tasks';

  selectTab(tab: DashboardTab): void {
    this.activeTab = tab;
  }
}