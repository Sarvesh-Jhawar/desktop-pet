import { Routes } from '@angular/router';
import { Pet } from './features/pet/pet';
import { Settings } from './features/settings/settings';
import { TaskList } from './features/task-list/task-list';
import { Timer } from './features/timer/timer';

export const routes: Routes = [
	{ path: '', component: Pet },
	{ path: 'settings', component: Settings },
	{ path: 'tasks', component: TaskList },
	{ path: 'timer', component: Timer }
];
