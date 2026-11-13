import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { SpeechService } from '../../core/speech.service';
import { Settings } from './settings';

describe('Settings custom body color', () => {
  const storageKey = 'desktop-pet:settings.json';

  beforeEach(async () => {
    localStorage.removeItem(storageKey);
    await TestBed.configureTestingModule({
      imports: [Settings],
      providers: [
        {
          provide: SpeechService,
          useValue: { initialize: vi.fn().mockResolvedValue(undefined) }
        }
      ]
    }).compileComponents();
  });

  afterEach(() => {
    localStorage.removeItem(storageKey);
    delete window.desktopPet;
  });

  it('saves and selects a custom six-digit hex color', async () => {
    const settings = TestBed.createComponent(Settings).componentInstance;
    settings.customColor.set('#12abef');

    await settings.applyCustomColor();

    expect(settings.currentBodyColor()).toBe('#12ABEF');
    expect(JSON.parse(localStorage.getItem(storageKey) ?? '{}').millyBodyColor)
      .toBe('#12ABEF');
  });

  it('rejects invalid hex colors without saving them', async () => {
    const settings = TestBed.createComponent(Settings).componentInstance;
    settings.customColor.set('#12ABC');

    await settings.applyCustomColor();

    expect(settings.colorError()).toContain('6-digit hex color');
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it('supports keyboard adjustments in the spectrum picker', () => {
    const settings = TestBed.createComponent(Settings).componentInstance;
    settings.spectrumHue.set(0);
    settings.spectrumSaturation.set(100);
    settings.lightness.set(50);

    const event = new KeyboardEvent('keydown', { key: 'ArrowRight' });
    settings.onSpectrumKeydown(event);

    expect(settings.spectrumHue()).toBe(5);
    expect(settings.customColor()).toBe('#FF1500');
  });
});
