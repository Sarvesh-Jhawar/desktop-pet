import { Injectable, signal } from '@angular/core';

export interface ClipboardStashSlot {
  id: string;
  text: string;
  savedAt: number;
  pinned: boolean;
}

const STORAGE_KEY = 'milly.clipboard-stash.v1';
const MAX_SLOTS = 6;
const MAX_PINNED_SLOTS = 2;
const MAX_TEXT_LENGTH = 4000;

function isClipboardStashSlot(value: unknown): value is ClipboardStashSlot {
  if (typeof value !== 'object' || value === null) return false;
  const slot = value as Record<string, unknown>;
  return typeof slot['id'] === 'string' &&
    typeof slot['text'] === 'string' &&
    slot['text'].length <= MAX_TEXT_LENGTH &&
    typeof slot['savedAt'] === 'number' &&
    Number.isFinite(slot['savedAt']) &&
    typeof slot['pinned'] === 'boolean';
}

@Injectable({ providedIn: 'root' })
export class ClipboardStashService {
  readonly slots = signal<ClipboardStashSlot[]>([]);
  readonly loadError = signal('');

  constructor() {
    this.loadSlots();
    globalThis.addEventListener('storage', this.onStorageChange);
  }

  async grabCurrentClipboard(): Promise<ClipboardStashSlot> {
    const clipboard = globalThis.navigator?.clipboard;
    if (!clipboard?.readText) {
      throw new Error('Clipboard access is unavailable in this window.');
    }

    let text: string;
    try {
      text = await clipboard.readText();
    } catch (error) {
      console.error('Could not read the system clipboard:', error);
      throw new Error('Clipboard access was denied. Check permissions and try again.');
    }

    if (!text.trim()) throw new Error('The clipboard is empty.');
    if (text.length > MAX_TEXT_LENGTH) {
      throw new Error(`Clipboard text must be ${MAX_TEXT_LENGTH} characters or fewer.`);
    }

    const slot: ClipboardStashSlot = {
      id: globalThis.crypto.randomUUID(),
      text,
      savedAt: Date.now(),
      pinned: false
    };
    const currentSlots = this.slots();
    let nextSlots = [slot, ...currentSlots];

    if (nextSlots.length > MAX_SLOTS) {
      let oldestUnpinnedIndex = -1;
      for (let index = 0; index < currentSlots.length; index += 1) {
        const candidate = currentSlots[index];
        if (
          !candidate.pinned &&
          (oldestUnpinnedIndex === -1 ||
            candidate.savedAt <= currentSlots[oldestUnpinnedIndex].savedAt)
        ) {
          oldestUnpinnedIndex = index;
        }
      }

      if (oldestUnpinnedIndex === -1) {
        throw new Error('All clipboard slots are pinned. Unpin one before saving.');
      }
      nextSlots = [slot, ...currentSlots.filter((_, index) => index !== oldestUnpinnedIndex)];
    }

    this.persist(nextSlots);
    return slot;
  }

  async copyToClipboard(id: string): Promise<void> {
    const slot = this.slots().find(candidate => candidate.id === id);
    if (!slot) throw new Error('That clipboard slot is no longer available.');

    const clipboard = globalThis.navigator?.clipboard;
    if (!clipboard?.writeText) {
      throw new Error('Clipboard access is unavailable in this window.');
    }

    try {
      await clipboard.writeText(slot.text);
    } catch (error) {
      console.error('Could not write to the system clipboard:', error);
      throw new Error('Could not copy to the clipboard. Check permissions and try again.');
    }
  }

  togglePin(id: string): void {
    const slot = this.slots().find(candidate => candidate.id === id);
    if (!slot) throw new Error('That clipboard slot is no longer available.');

    if (!slot.pinned && this.slots().filter(candidate => candidate.pinned).length >= MAX_PINNED_SLOTS) {
      throw new Error(`You can pin up to ${MAX_PINNED_SLOTS} clipboard items.`);
    }

    this.persist(this.slots().map(candidate =>
      candidate.id === id ? { ...candidate, pinned: !candidate.pinned } : candidate
    ));
  }

  removeSlot(id: string): void {
    if (!this.slots().some(slot => slot.id === id)) return;
    this.persist(this.slots().filter(slot => slot.id !== id));
  }

  clearAll(): void {
    this.persist([]);
  }

  private loadSlots(): void {
    try {
      const saved = globalThis.localStorage.getItem(STORAGE_KEY);
      if (!saved) return;

      const parsed: unknown = JSON.parse(saved);
      if (!Array.isArray(parsed)) throw new Error('Saved clipboard stash is not a list.');

      const validSlots = parsed.filter(isClipboardStashSlot).slice(0, MAX_SLOTS);
      let pinnedCount = 0;
      const normalized = validSlots.map(slot => {
        if (!slot.pinned) return slot;
        pinnedCount += 1;
        return pinnedCount <= MAX_PINNED_SLOTS ? slot : { ...slot, pinned: false };
      });
      this.slots.set(normalized);
    } catch (error) {
      console.error('Could not load the saved clipboard stash:', error);
      this.loadError.set('Saved clipboard items could not be loaded.');
    }
  }

  private readonly onStorageChange = (event: StorageEvent): void => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    if (event.storageArea && event.storageArea !== globalThis.localStorage) return;
    try {
      const saved = event.key === null ? null : event.newValue;
      const parsed: unknown = saved ? JSON.parse(saved) : [];
      if (!Array.isArray(parsed)) throw new Error('Saved clipboard stash is not a list.');

      const validSlots = parsed.filter(isClipboardStashSlot).slice(0, MAX_SLOTS);
      let pinnedCount = 0;
      const normalized = validSlots.map(slot => {
        if (!slot.pinned) return slot;
        pinnedCount += 1;
        return pinnedCount <= MAX_PINNED_SLOTS ? slot : { ...slot, pinned: false };
      });
      this.slots.set(normalized);
      this.loadError.set('');
    } catch (error) {
      console.error('Could not sync the saved clipboard stash:', error);
      this.loadError.set('Saved clipboard items could not be synchronized.');
    }
  };

  private persist(slots: ClipboardStashSlot[]): void {
    try {
      globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(slots));
    } catch (error) {
      console.error('Could not save the clipboard stash:', error);
      throw new Error('Could not save the clipboard stash. Check browser storage and try again.');
    }
    this.loadError.set('');
    this.slots.set(slots);
  }
}
