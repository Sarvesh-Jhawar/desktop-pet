import { Routes } from '@angular/router';
import { Pet } from './features/pet/pet';
import { Settings } from './features/settings/settings';
import { TaskList } from './features/task-list/task-list';
import { Timer } from './features/timer/timer';
import { Reminders } from './features/reminders/reminders';
import { Dashboard } from './features/dashboard/dashboard';

export const routes: Routes = [
	{ path: '', component: Pet },
	{ path: 'dashboard', component: Dashboard },
	{ path: 'settings', component: Settings },
	{ path: 'tasks', component: TaskList },
	{ path: 'timer', component: Timer },
	{ path: 'reminders', component: Reminders }
];
