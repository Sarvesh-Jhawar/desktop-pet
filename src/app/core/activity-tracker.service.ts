import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ActivityTrackerService {
  private lastActivityAt = Date.now();

  constructor() {
    const markActive = () => {
      this.lastActivityAt = Date.now();
    };

    window.addEventListener('mousemove', markActive);
    window.addEventListener('mousedown', markActive);
    window.addEventListener('keydown', markActive);
  }

  getIdleMinutes(): number {
    return (Date.now() - this.lastActivityAt) / 60_000;
  }
}