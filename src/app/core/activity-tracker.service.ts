import { Injectable, OnDestroy } from '@angular/core';
import { emit, listen } from '@tauri-apps/api/event';

@Injectable({ providedIn: 'root' })
export class ActivityTrackerService implements OnDestroy {
  private lastActivityAt = Date.now();
  private lastBroadcastAt = 0;
  private unlisten?: () => void;

  constructor() {
    window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    window.addEventListener('pointerdown', this.markActive, { passive: true });
    window.addEventListener('keydown', this.markActive);
    window.addEventListener('input', this.markActive);

    if (this.isTauriRuntime()) {
      void listen<number>('user-activity', event => {
        this.lastActivityAt = Math.max(this.lastActivityAt, event.payload);
      }).then(unlisten => {
        this.unlisten = unlisten;
      }).catch(error => {
        console.error('Failed to listen for activity from other Milly windows:', error);
      });
    }
  }

  getIdleMinutes(): number {
    return (Date.now() - this.lastActivityAt) / 60_000;
  }

  ngOnDestroy(): void {
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerdown', this.markActive);
    window.removeEventListener('keydown', this.markActive);
    window.removeEventListener('input', this.markActive);
    this.unlisten?.();
  }

  private markActive = (): void => {
    this.lastActivityAt = Date.now();
    const now = this.lastActivityAt;
    if (!this.isTauriRuntime() || now - this.lastBroadcastAt < 10_000) return;
    this.lastBroadcastAt = now;
    void emit('user-activity', now).catch(error => {
      console.error('Failed to share desktop activity with other Milly windows:', error);
    });
  };

  private onPointerMove = (): void => {
    const now = Date.now();
    if (now - this.lastActivityAt >= 5_000) this.markActive();
  };

  private isTauriRuntime(): boolean {
    return Boolean((globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
  }
}