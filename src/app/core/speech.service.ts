import { Injectable, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

type SpeechStatus =
  | 'idle'
  | 'loading'
  | 'downloading'
  | 'synthesizing'
  | 'playing'
  | 'error';

interface SpeechEvent {
  status: string;
  request_id?: number;
  message?: string;
  file?: string;
  downloaded_bytes?: number;
  total_bytes?: number;
  initialization_ms?: number;
  first_chunk_ms?: number;
  first_audio_ms?: number;
  request_to_first_audio_ms?: number;
  generation_ms?: number;
  request_to_playback_end_ms?: number;
}

export interface SpeechPlaybackCallbacks {
  onPlaybackStart?: () => void;
  onPlaybackEnd?: () => void;
  onPlaybackUnavailable?: () => void;
  onPlaybackCancelled?: () => void;
}

@Injectable({ providedIn: 'root' })
export class SpeechService {
  readonly status = signal<SpeechStatus>('idle');
  readonly errorMessage = signal('');
  readonly activeRequest = signal(false);
  private activeRequestId?: number;
  private requestSerial = 0;
  private readonly pendingEvents = new Map<number, SpeechEvent[]>();
  private readonly playbackCallbacks = new Map<
    number,
    SpeechPlaybackCallbacks
  >();
  private readonly playbackStartedRequests = new Set<number>();
  private listener?: Promise<UnlistenFn>;

  async initialize(): Promise<void> {
    this.listener ??= listen<SpeechEvent>('speech-event', ({ payload }) => {
      if (
        payload.request_id !== undefined &&
        this.activeRequestId === undefined &&
        this.activeRequest()
      ) {
        const requestEvents = this.pendingEvents.get(payload.request_id) ?? [];
        requestEvents.push(payload);
        this.pendingEvents.set(payload.request_id, requestEvents);
        return;
      }
      if (
        payload.request_id !== undefined &&
        payload.request_id !== this.activeRequestId
      ) {
        return;
      }

      this.applyEvent(payload);
    });

    try {
      await this.listener;
    } catch (error) {
      this.listener = undefined;
      throw error;
    }
  }

  async speak(
    text: string,
    callbacks?: SpeechPlaybackCallbacks
  ): Promise<void> {
    const normalizedText = text.trim();
    if (!normalizedText) {
      throw new Error('Speech text cannot be empty.');
    }

    await this.initialize();
    const requestSerial = ++this.requestSerial;
    if (this.activeRequestId !== undefined) {
      this.playbackCallbacks
        .get(this.activeRequestId)
        ?.onPlaybackCancelled?.();
      this.clearPlaybackCallbacks(this.activeRequestId);
    }
    this.activeRequestId = undefined;
    this.pendingEvents.clear();
    this.errorMessage.set('');
    this.status.set('loading');
    this.activeRequest.set(true);
    try {
      const requestId = await invoke<number>('speech_speak', {
        text: normalizedText
      });
      if (requestSerial !== this.requestSerial) {
        callbacks?.onPlaybackCancelled?.();
        return;
      }
      this.activeRequestId = requestId;
      if (callbacks) {
        this.playbackCallbacks.set(requestId, callbacks);
      }
      const requestEvents = this.pendingEvents.get(requestId) ?? [];
      this.pendingEvents.clear();
      for (const pendingEvent of requestEvents) {
        this.applyEvent(pendingEvent);
      }
    } catch (error) {
      if (requestSerial !== this.requestSerial) {
        return;
      }
      this.status.set('error');
      this.activeRequest.set(false);
      this.errorMessage.set(String(error));
      throw error;
    }
  }

  async speakAndWait(
    text: string,
    callbacks?: SpeechPlaybackCallbacks
  ): Promise<void> {
    let resolvePlayback!: () => void;
    const playbackComplete = new Promise<void>(resolve => {
      resolvePlayback = resolve;
    });
    const wrappedCallbacks: SpeechPlaybackCallbacks = {
      onPlaybackStart: callbacks?.onPlaybackStart,
      onPlaybackEnd: () => {
        callbacks?.onPlaybackEnd?.();
        resolvePlayback();
      },
      onPlaybackUnavailable: () => {
        callbacks?.onPlaybackUnavailable?.();
        resolvePlayback();
      },
      onPlaybackCancelled: () => {
        callbacks?.onPlaybackCancelled?.();
        resolvePlayback();
      }
    };

    try {
      await this.speak(text, wrappedCallbacks);
      await playbackComplete;
    } catch (error) {
      resolvePlayback();
      throw error;
    }
  }

  async stop(): Promise<void> {
    const stoppedRequestId = this.activeRequestId;
    this.requestSerial += 1;
    this.activeRequestId = undefined;
    this.pendingEvents.clear();
    try {
      await invoke('speech_stop');
      this.status.set('idle');
      this.activeRequest.set(false);
      if (stoppedRequestId !== undefined) {
        this.playbackCallbacks
          .get(stoppedRequestId)
          ?.onPlaybackCancelled?.();
        this.clearPlaybackCallbacks(stoppedRequestId);
      }
    } catch (error) {
      this.status.set('error');
      this.activeRequest.set(false);
      this.errorMessage.set(String(error));
      throw error;
    }
  }

  isSpeaking(): Promise<boolean> {
    return invoke<boolean>('speech_is_speaking');
  }

  private applyEvent(payload: SpeechEvent): void {
    const requestId = payload.request_id;
    const callbacks =
      requestId === undefined
        ? undefined
        : this.playbackCallbacks.get(requestId);

    switch (payload.status) {
      case 'loading':
        this.status.set('loading');
        this.errorMessage.set('');
        break;
      case 'downloading':
        this.status.set('downloading');
        break;
      case 'model_ready':
      case 'synthesizing':
        this.status.set('synthesizing');
        break;
      case 'first_audio':
        if (requestId !== undefined) {
          this.playbackStartedRequests.add(requestId);
        }
        callbacks?.onPlaybackStart?.();
        this.status.set('playing');
        break;
      case 'finished':
        this.status.set('idle');
        this.activeRequest.set(false);
        if (requestId !== undefined) {
          if (this.playbackStartedRequests.has(requestId)) {
            callbacks?.onPlaybackEnd?.();
          } else {
            callbacks?.onPlaybackUnavailable?.();
          }
          this.clearPlaybackCallbacks(requestId);
        }
        break;
      case 'stopped':
        this.status.set('idle');
        this.activeRequest.set(false);
        if (requestId !== undefined) {
          callbacks?.onPlaybackCancelled?.();
          this.clearPlaybackCallbacks(requestId);
        }
        break;
      case 'error':
        this.status.set('error');
        this.activeRequest.set(false);
        this.errorMessage.set(payload.message ?? 'Speech could not be played.');
        if (requestId !== undefined) {
          if (this.playbackStartedRequests.has(requestId)) {
            callbacks?.onPlaybackEnd?.();
          } else {
            callbacks?.onPlaybackUnavailable?.();
          }
          this.clearPlaybackCallbacks(requestId);
        }
        break;
    }
  }

  private clearPlaybackCallbacks(requestId: number): void {
    this.playbackCallbacks.delete(requestId);
    this.playbackStartedRequests.delete(requestId);
  }
}
