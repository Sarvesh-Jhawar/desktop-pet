import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  computed,
  signal
} from '@angular/core';
import { disable, emit, enable, isEnabled, load } from '../../core/desktop-bridge';
import { SpeechService } from '../../core/speech.service';
import {
  isCustomPetBodyColor,
  isPetBodyColor,
  isPetDesignSelection,
  PET_BODY_COLORS,
  PET_DESIGNS
} from '../../core/pet-state.service';
import type {
  PetBodyColor,
  PetDesignId
} from '../../core/pet-state.service';

type PetSize = 'small' | 'medium' | 'large';

@Component({
  selector: 'app-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings.html',
  styleUrl: './settings.css'
})
export class Settings implements OnInit {
  readonly speech = inject(SpeechService);
  readonly bodyColors = PET_BODY_COLORS;
  readonly bodyDesigns = PET_DESIGNS;

  autostartEnabled = signal(false);
  alwaysOnTop = signal(true);
  soundsEnabled = signal(false);
  eyesFollowCursor = signal(true);
  currentSize = signal<PetSize>('medium');
  currentBodyColor = signal<PetBodyColor>('original');
  customColor = signal('#D5B896');
  colorError = signal<string | null>(null);
  spectrumHue = signal(30);
  spectrumSaturation = signal(25);
  lightness = signal(71);
  lightnessOverlay = computed(() => {
    const opacity = Math.abs(this.lightness() - 50) / 50;
    return this.lightness() < 50
      ? `rgba(0, 0, 0, ${opacity})`
      : `rgba(255, 255, 255, ${opacity})`;
  });
  selectedDesigns = signal<PetDesignId[]>([]);

  async ngOnInit(): Promise<void> {
    this.syncSpectrumFromHex(this.customColor());
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

      const savedEyesFollowCursor = await store.get<boolean>('eyesFollowCursor');
      this.eyesFollowCursor.set(savedEyesFollowCursor ?? true);

      const savedSize = await store.get<PetSize>('petSize');
      this.currentSize.set(savedSize ?? 'medium');

      const savedBodyColor = await store.get<unknown>('millyBodyColor');
      if (isPetBodyColor(savedBodyColor)) {
        this.currentBodyColor.set(savedBodyColor);
        this.customColor.set(
          isCustomPetBodyColor(savedBodyColor)
            ? savedBodyColor.toUpperCase()
            : PET_BODY_COLORS.find(color => color.id === savedBodyColor)?.hex ?? '#D5B896'
        );
        this.syncSpectrumFromHex(this.customColor());
      }

      const savedDesigns = await store.get<unknown>('millyBodyDesigns');
      if (isPetDesignSelection(savedDesigns)) {
        this.selectedDesigns.set([...new Set(savedDesigns)]);
      }
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

  async toggleEyesFollowCursor(): Promise<void> {
    const nextValue = !this.eyesFollowCursor();

    try {
      const store = await load('settings.json', { autoSave: false });
      await store.set('eyesFollowCursor', nextValue);
      await store.save();
      this.eyesFollowCursor.set(nextValue);
    } catch (error) {
      console.error('Failed to save eye cursor tracking setting:', error);
      return;
    }

    try {
      await emit('eyes-follow-cursor-toggled', nextValue);
    } catch (error) {
      console.error('Failed to sync eye cursor tracking setting:', error);
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

  updateCustomColorDraft(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.customColor.set(input.value);
    this.colorError.set(null);
    if (isCustomPetBodyColor(input.value)) {
      this.syncSpectrumFromHex(input.value);
    }
  }

  onSpectrumPointerDown(event: PointerEvent): void {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.updateSpectrumFromPointer(event);
  }

  onSpectrumPointerMove(event: PointerEvent): void {
    if (event.buttons === 1) this.updateSpectrumFromPointer(event);
  }

  onSpectrumKeydown(event: KeyboardEvent): void {
    const step = event.shiftKey ? 15 : 5;
    switch (event.key) {
      case 'ArrowLeft':
        this.setSpectrumValue(this.spectrumHue() - step, this.spectrumSaturation());
        break;
      case 'ArrowRight':
        this.setSpectrumValue(this.spectrumHue() + step, this.spectrumSaturation());
        break;
      case 'ArrowUp':
        this.setSpectrumValue(this.spectrumHue(), this.spectrumSaturation() + step);
        break;
      case 'ArrowDown':
        this.setSpectrumValue(this.spectrumHue(), this.spectrumSaturation() - step);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  updateLightness(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.lightness.set(Number(input.value));
    this.updateSpectrumColor();
  }

  spectrumHueValue(): number {
    return Math.round(this.spectrumHue());
  }

  spectrumValueText(): string {
    return `${this.spectrumHueValue()} degrees hue, ${Math.round(this.spectrumSaturation())}% saturation, ${this.lightness()}% shade`;
  }

  private updateSpectrumFromPointer(event: PointerEvent): void {
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const hue = clamp((event.clientX - bounds.left) / bounds.width, 0, 1) * 360;
    const saturation =
      (1 - clamp((event.clientY - bounds.top) / bounds.height, 0, 1)) * 100;
    this.setSpectrumValue(hue, saturation);
  }

  private setSpectrumValue(hue: number, saturation: number): void {
    this.spectrumHue.set((hue + 360) % 360);
    this.spectrumSaturation.set(clamp(saturation, 0, 100));
    this.colorError.set(null);
    this.updateSpectrumColor();
  }

  private updateSpectrumColor(): void {
    this.customColor.set(
      hslToHex(this.spectrumHue(), this.spectrumSaturation(), this.lightness())
    );
  }

  private syncSpectrumFromHex(hex: string): void {
    const color = hexToHsl(hex);
    if (!color) return;
    this.spectrumHue.set(color.hue);
    this.spectrumSaturation.set(color.saturation);
    this.lightness.set(color.lightness);
  }

  async applyCustomColor(): Promise<void> {
    const color = this.customColor().trim().toUpperCase();
    if (!isCustomPetBodyColor(color)) {
      this.colorError.set('Enter a 6-digit hex color, such as #A1B2C3.');
      return;
    }
    await this.setPetBodyColor(color);
  }

  async setPetBodyColor(color: PetBodyColor): Promise<void> {
    this.colorError.set(null);
    try {
      const store = await load('settings.json', { autoSave: false });
      await store.set('millyBodyColor', color);
      await store.save();
      this.currentBodyColor.set(color);
      this.customColor.set(
        isCustomPetBodyColor(color)
          ? color.toUpperCase()
          : PET_BODY_COLORS.find(option => option.id === color)?.hex ?? '#D5B896'
      );
      this.syncSpectrumFromHex(this.customColor());
    } catch (error) {
      console.error('Failed to save Milly’s body color:', error);
      this.colorError.set('Could not save Milly’s color. Please try again.');
      return;
    }

    try {
      await emit('pet-body-color-changed', color);
    } catch (error) {
      console.error('Failed to apply Milly’s body color:', error);
    }
  }

  async togglePetDesign(design: PetDesignId): Promise<void> {
    const previous = this.selectedDesigns();
    const next = previous.includes(design)
      ? previous.filter(item => item !== design)
      : [...previous, design];

    try {
      const store = await load('settings.json', { autoSave: false });
      await store.set('millyBodyDesigns', next);
      await store.save();
      this.selectedDesigns.set(next);
    } catch (error) {
      console.error('Failed to save Milly’s designs:', error);
      return;
    }

    try {
      await emit('pet-body-designs-changed', next);
    } catch (error) {
      console.error('Failed to apply Milly’s designs:', error);
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const h = ((hue % 360) + 360) % 360;
  const s = clamp(saturation, 0, 100) / 100;
  const l = clamp(lightness, 0, 100) / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs((h / 60) % 2 - 1));
  const match = l - chroma / 2;
  const [red, green, blue] =
    h < 60 ? [chroma, x, 0] :
    h < 120 ? [x, chroma, 0] :
    h < 180 ? [0, chroma, x] :
    h < 240 ? [0, x, chroma] :
    h < 300 ? [x, 0, chroma] :
    [chroma, 0, x];
  return `#${[red, green, blue]
    .map(channel => Math.round((channel + match) * 255).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

function hexToHsl(hex: string): { hue: number; saturation: number; lightness: number } | null {
  if (!isCustomPetBodyColor(hex)) return null;
  const red = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const green = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const lightness = (max + min) / 2;

  let hue = 0;
  let saturation = 0;
  if (delta !== 0) {
    saturation = delta / (1 - Math.abs(2 * lightness - 1));
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }

  return {
    hue: (hue + 360) % 360,
    saturation: saturation * 100,
    lightness: lightness * 100
  };
}