import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import {
  enable,
  disable,
  isEnabled
} from '@tauri-apps/plugin-autostart';
import { Pet } from './features/pet/pet';

@Component({
  selector: 'app-root',
  imports: [Pet
  ],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('desktop-pet');

  async toggleAutostart() {
    const enabled = await isEnabled();

    if (enabled) {
      await disable();
      console.log('Autostart disabled');
    } else {
      await enable();
      console.log('Autostart enabled');
    }
  }
}

