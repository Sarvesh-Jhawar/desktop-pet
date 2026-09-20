import { Component, OnInit, signal } from '@angular/core';
import { emit } from '@tauri-apps/api/event';
import { load } from '@tauri-apps/plugin-store';
import {
  disable,
  enable,
  isEnabled
} from '@tauri-apps/plugin-autostart';

type PetSize = 'small' | 'medium' | 'large';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.html',
  styleUrl: './settings.css'
})
export class Settings implements OnInit {
  autostartEnabled = signal(false);
  alwaysOnTop = signal(true);
  currentSize = signal<PetSize>('medium');

  async ngOnInit(): Promise<void> {
    try {
      this.autostartEnabled.set(await isEnabled());

      const store = await load('settings.json', { autoSave: false });
      const savedAlwaysOnTop = await store.get<boolean>('alwaysOnTop');
      this.alwaysOnTop.set(savedAlwaysOnTop ?? true);

      const savedSize = await store.get<PetSize>('petSize');
      this.currentSize.set(savedSize ?? 'medium');
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }

  async toggleAutostart(): Promise<void> {
    try {
      if (this.autostartEnabled()) {
        await disable();
      } else {
        await enable();
      }

      this.autostartEnabled.update(enabled => !enabled);
    } catch (error) {
      console.error('Failed to update autostart:', error);
    }
  }

  async toggleAlwaysOnTop(): Promise<void> {
    const nextValue = !this.alwaysOnTop();
    this.alwaysOnTop.set(nextValue);

    try {
      const store = await load('settings.json', { autoSave: false });
      await store.set('alwaysOnTop', nextValue);
      await store.save();
    } catch (error) {
      this.alwaysOnTop.set(!nextValue);
      console.error('Failed to save always-on-top setting:', error);
    }
  }

  async setPetSize(size: PetSize): Promise<void> {
    try {
      const store = await load('settings.json', { autoSave: false });
      await store.set('petSize', size);
      await store.save();

      this.currentSize.set(size);
      await emit('pet-size-changed', size);
    } catch (error) {
      console.error('Failed to save pet size:', error);
    }
  }
}