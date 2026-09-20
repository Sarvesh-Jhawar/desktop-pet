import { Routes } from '@angular/router';
import { Pet } from './features/pet/pet';
import { Settings } from './features/settings/settings';

export const routes: Routes = [
	{ path: '', component: Pet },
	{ path: 'settings', component: Settings }
];
