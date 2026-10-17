import { vi } from 'vitest';
import { SpeechService } from './speech.service';

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn()
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: tauriMocks.invoke
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: tauriMocks.listen
}));

describe('SpeechService', () => {
  let service: SpeechService;
  let dispatchSpeechEvent:
    | ((event: { payload: { status: string; request_id?: number } }) => void)
    | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    dispatchSpeechEvent = undefined;
    tauriMocks.listen.mockImplementation(
      async (
        _eventName: string,
        handler: (event: { payload: { status: string; request_id?: number } }) => void
      ) => {
        dispatchSpeechEvent = handler;
        return () => {};
      }
    );
    service = new SpeechService();
  });

  it('waits for first audio before reporting playback start', async () => {
    let resolveSpeak!: (requestId: number) => void;
    tauriMocks.invoke.mockReturnValue(
      new Promise<number>(resolve => {
        resolveSpeak = resolve;
      })
    );
    const onPlaybackStart = vi.fn();
    const onPlaybackEnd = vi.fn();
    const speakPromise = service.speakAndWait('Hello Milly', {
      onPlaybackStart,
      onPlaybackEnd
    });

    await new Promise(resolve => setTimeout(resolve, 0));
    dispatchSpeechEvent?.({ payload: { status: 'first_audio', request_id: 7 } });
    resolveSpeak(7);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(onPlaybackStart).toHaveBeenCalledOnce();
    expect(onPlaybackEnd).not.toHaveBeenCalled();

    dispatchSpeechEvent?.({ payload: { status: 'finished', request_id: 7 } });
    await speakPromise;
    expect(onPlaybackEnd).toHaveBeenCalledOnce();
  });

  it('reports cancellation without marking playback as unavailable', async () => {
    tauriMocks.invoke.mockResolvedValue(11);
    const onPlaybackUnavailable = vi.fn();
    const onPlaybackCancelled = vi.fn();
    const speakPromise = service.speakAndWait('Cancel me', {
      onPlaybackUnavailable,
      onPlaybackCancelled
    });

    await new Promise(resolve => setTimeout(resolve, 0));
    dispatchSpeechEvent?.({ payload: { status: 'stopped', request_id: 11 } });
    await speakPromise;

    expect(onPlaybackCancelled).toHaveBeenCalledOnce();
    expect(onPlaybackUnavailable).not.toHaveBeenCalled();
  });
});
