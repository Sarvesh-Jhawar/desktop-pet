import { ClipboardStashService } from './clipboard-stash.service';

describe('ClipboardStashService', () => {
  let clipboard: {
    readText: ReturnType<typeof vi.fn<() => Promise<string>>>;
    writeText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;
  };

  beforeEach(() => {
    localStorage.clear();
    clipboard = {
      readText: vi.fn<() => Promise<string>>(),
      writeText: vi.fn<(text: string) => Promise<void>>()
    };
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: clipboard
    });
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('saves clipboard text across service instances and copies it back exactly', async () => {
    clipboard.readText.mockResolvedValue('https://example.test\ncommand --flag');
    clipboard.writeText.mockResolvedValue();

    const firstService = new ClipboardStashService();
    const savedSlot = await firstService.grabCurrentClipboard();
    const reloadedService = new ClipboardStashService();

    expect(reloadedService.slots()).toHaveLength(1);
    expect(reloadedService.slots()[0].text).toBe('https://example.test\ncommand --flag');

    await reloadedService.copyToClipboard(savedSlot.id);
    expect(clipboard.writeText).toHaveBeenCalledWith('https://example.test\ncommand --flag');
  });

  it("updates another window's stash when storage changes", () => {
    const dashboardService = new ClipboardStashService();
    const stash = [{
      id: 'external-slot',
      text: 'shared clipboard text',
      savedAt: Date.now(),
      pinned: false
    }];
    localStorage.setItem('milly.clipboard-stash.v1', JSON.stringify(stash));

    window.dispatchEvent(new StorageEvent('storage', {
      key: 'milly.clipboard-stash.v1',
      newValue: localStorage.getItem('milly.clipboard-stash.v1')
    }));

    expect(dashboardService.slots()).toEqual(stash);
  });

  it('replaces the oldest unpinned slot and limits pins to two', async () => {
    const now = vi.spyOn(Date, 'now');
    const service = new ClipboardStashService();
    for (let index = 0; index < 6; index += 1) {
      now.mockReturnValue(index + 1);
      clipboard.readText.mockResolvedValueOnce(`slot-${index}`);
      await service.grabCurrentClipboard();
    }
    const oldestId = service.slots()[5].id;
    const pinnedId = service.slots()[1].id;
    service.togglePin(service.slots()[0].id);
    service.togglePin(pinnedId);

    now.mockReturnValue(7);
    clipboard.readText.mockResolvedValue('newest');
    await service.grabCurrentClipboard();

    expect(service.slots()).toHaveLength(6);
    expect(service.slots().some(slot => slot.id === oldestId)).toBe(false);
    expect(service.slots().filter(slot => slot.pinned)).toHaveLength(2);
    expect(() => service.togglePin(service.slots()[0].id)).toThrow('pin up to 2');
  });

  it('reports an empty clipboard without adding a slot', async () => {
    clipboard.readText.mockResolvedValue(' \n ');
    const service = new ClipboardStashService();

    await expect(service.grabCurrentClipboard()).rejects.toThrow('clipboard is empty');
    expect(service.slots()).toHaveLength(0);
  });

  it('removes one slot and clears the remaining persisted items', async () => {
    const service = new ClipboardStashService();
    clipboard.readText
      .mockResolvedValueOnce('first')
      .mockResolvedValueOnce('second');
    const first = await service.grabCurrentClipboard();
    await service.grabCurrentClipboard();

    service.removeSlot(first.id);
    expect(service.slots().map(slot => slot.text)).toEqual(['second']);

    service.clearAll();
    expect(service.slots()).toEqual([]);
    expect(localStorage.getItem('milly.clipboard-stash.v1')).toBe('[]');
  });

  it('converts clipboard permission failures into a useful error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    clipboard.readText.mockRejectedValue(new Error('permission denied'));
    const service = new ClipboardStashService();

    await expect(service.grabCurrentClipboard()).rejects.toThrow(
      'Clipboard access was denied'
    );
    expect(service.slots()).toHaveLength(0);
  });
});
