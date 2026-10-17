import { Injectable } from '@angular/core';
import { load } from '@tauri-apps/plugin-store';

export type SoundEvent = 'click' | 'taskComplete' | 'timerComplete' | 'reminder' | 'greeting' | 'health';

const SOUND_FILES: Record<SoundEvent, string> = {
  click: 'assets/sounds/click.ogg',
  taskComplete: 'assets/sounds/confirm.ogg',
  timerComplete: 'assets/sounds/complete.ogg',
  reminder: 'assets/sounds/notify.ogg',
  greeting: 'assets/sounds/pop.ogg',
  health: 'assets/sounds/pop.ogg'
};

@Injectable({ providedIn: 'root' })
export class SoundService {
  private enabled = false;
  private readonly cache = new Map<SoundEvent, HTMLAudioElement>();

  async init(): Promise<void> {
    try {
      const store = await load('settings.json', { autoSave: false });
      this.enabled = (await store.get<boolean>('soundsEnabled')) ?? false;
    } catch (error) {
      this.enabled = false;
      console.error('Failed to load sound setting:', error);
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      for (const audio of this.cache.values()) {
        audio.pause();
        audio.currentTime = 0;
      }
    }
  }

  play(event: SoundEvent): void {
    if (!this.enabled) return;

    try {
      let audio = this.cache.get(event);
      if (!audio) {
        audio = new Audio(SOUND_FILES[event]);
        audio.volume = 0.4;
        this.cache.set(event, audio);
      }

      audio.currentTime = 0;
      void audio.play().catch(() => {});
    } catch {
      // Sound must not interrupt the pet interaction.
    }
  }
}