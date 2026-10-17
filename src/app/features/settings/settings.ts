import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal
} from '@angular/core';
import { emit } from '@tauri-apps/api/event';
import { load } from '@tauri-apps/plugin-store';
import { SpeechService } from '../../core/speech.service';
import {
  disable,
  enable,
  isEnabled
} from '@tauri-apps/plugin-autostart';

type PetSize = 'small' | 'medium' | 'large';

@Component({
  selector: 'app-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings.html',
  styleUrl: './settings.css'
})
export class Settings implements OnInit {
  readonly speech = inject(SpeechService);

  autostartEnabled = signal(false);
  alwaysOnTop = signal(true);
  soundsEnabled = signal(false);
  currentSize = signal<PetSize>('medium');

  async ngOnInit(): Promise<void> {
    void this.speech.initialize().catch(error => {
      console.error('Failed to initialize local speech controls:', error);
    });

    try {
      this.autostartEnabled.set(await isEnabled());

      const store = await load('settings.json', { autoSave: false });
      const savedAlwaysOnTop = await store.get<boolean>('alwaysOnTop');
      this.alwaysOnTop.set(savedAlwaysOnTop ?? true);

      const savedSoundsEnabled = await store.get<boolean>('soundsEnabled');
      this.soundsEnabled.set(savedSoundsEnabled ?? false);

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

  async toggleSounds(): Promise<void> {
    const nextValue = !this.soundsEnabled();

    try {
      const store = await load('settings.json', { autoSave: false });
      await store.set('soundsEnabled', nextValue);
      await store.save();
      this.soundsEnabled.set(nextValue);
    } catch (error) {
      console.error('Failed to save sound setting:', error);
      return;
    }

    try {
      await emit('sounds-toggled', nextValue);
    } catch (error) {
      console.error('Failed to sync sound setting:', error);
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

  async testVoice(): Promise<void> {
    try {
      await this.speech.speak("Hey! I'm Milly. Let's make today productive!");
    } catch (error) {
      console.error('Failed to start the local speech engine:', error);
    }
  }

  async stopVoice(): Promise<void> {
    try {
      await this.speech.stop();
    } catch (error) {
      console.error('Failed to stop local speech:', error);
    }
  }

  speechStatus(): string {
    switch (this.speech.status()) {
      case 'loading':
        return 'Starting local voice engine…';
      case 'downloading':
        return 'Downloading the Kokoro voice files…';
      case 'synthesizing':
        return 'Generating speech…';
      case 'playing':
        return 'Milly is speaking';
      case 'error':
        return 'Local voice is unavailable';
      default:
        return '';
    }
  }
}