from __future__ import annotations

import argparse
import asyncio
import ctypes
import hashlib
import json
import os
import re
import sys
import threading
import time
import urllib.request
from collections import deque
from collections.abc import AsyncGenerator, Callable
from pathlib import Path
from typing import Any

import numpy as np
import sounddevice as sd
from kokoro_onnx import Kokoro


MODEL_FILES: dict[str, tuple[str, int, str]] = {
    "kokoro-v1.0.onnx": (
        "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.onnx",
        325_505_369,
        "beb0d1848dee9a49da392cc3df26958d46cfa35d321edf434f52949153f0df3a",
    ),
    "voices-v1.0.bin": (
        "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/voices-v1.0.bin",
        28_214_398,
        "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
    ),
}
SAMPLE_RATE = 24_000
CHANNELS = 1
PREBUFFER_FRAMES = int(SAMPLE_RATE * 0.075)
MAX_BUFFER_FRAMES = int(SAMPLE_RATE * 3)
STOP_FADE_FRAMES = int(SAMPLE_RATE * 0.005)
MAX_TEXT_LENGTH = 4_000


class ChunkPlayer:
    """A persistent PortAudio output stream fed by Kokoro's generated chunks."""

    def __init__(self) -> None:
        self._condition = threading.Condition()
        self._chunks: deque[np.ndarray] = deque()
        self._chunk_offset = 0
        self._buffered_frames = 0
        self._generation = 0
        self._input_done = False
        self._started = False
        self._first_audio = threading.Event()
        self._drained = threading.Event()
        self.first_audio_at: float | None = None
        self._last_sample = 0.0
        self._fade_start_sample = 0.0
        self._fade_remaining = 0
        self.underflows = 0
        self._stream = sd.OutputStream(
            samplerate=SAMPLE_RATE,
            channels=CHANNELS,
            dtype="float32",
            blocksize=0,
            latency="low",
            callback=self._callback,
        )
        self._stream.start()

    def begin(self) -> int:
        with self._condition:
            self._generation += 1
            self._chunks.clear()
            self._chunk_offset = 0
            self._buffered_frames = 0
            self._input_done = False
            self._started = False
            self._first_audio.clear()
            self._drained.clear()
            self.first_audio_at = None
            self.underflows = 0
            self._condition.notify_all()
            return self._generation

    def push(self, samples: np.ndarray, generation: int) -> bool:
        audio = np.asarray(samples, dtype=np.float32).reshape(-1)
        offset = 0
        while offset < len(audio):
            with self._condition:
                while (
                    self._buffered_frames >= MAX_BUFFER_FRAMES
                    and generation == self._generation
                ):
                    self._condition.wait(timeout=0.1)
                if generation != self._generation:
                    return False
                available = max(1, MAX_BUFFER_FRAMES - self._buffered_frames)
                end = min(offset + available, len(audio))
                self._chunks.append(audio[offset:end])
                added = end - offset
                self._buffered_frames += added
                offset = end
                self._condition.notify_all()
        return True

    def finish(self, generation: int) -> None:
        with self._condition:
            if generation == self._generation:
                self._input_done = True
                self._condition.notify_all()

    def stop(self) -> None:
        with self._condition:
            self._fade_start_sample = self._last_sample
            self._fade_remaining = STOP_FADE_FRAMES
            self._generation += 1
            self._chunks.clear()
            self._chunk_offset = 0
            self._buffered_frames = 0
            self._input_done = True
            self._started = False
            self._first_audio.clear()
            self._drained.set()
            self.first_audio_at = None
            self._condition.notify_all()

    def _callback(
        self,
        outdata: np.ndarray,
        frames: int,
        _time_info: Any,
        status: Any,
    ) -> None:
        outdata.fill(0)
        written = 0
        audio_written = 0
        with self._condition:
            output_underflow = bool(getattr(status, "output_underflow", False))
            if output_underflow:
                self.underflows += 1
            if self._fade_remaining:
                count = min(frames, self._fade_remaining)
                remaining = self._fade_remaining
                outdata[:count, 0] = self._fade_start_sample * np.linspace(
                    remaining / STOP_FADE_FRAMES,
                    max(0, remaining - count) / STOP_FADE_FRAMES,
                    count,
                    dtype=np.float32,
                )
                self._fade_remaining -= count
                written = count

            if not self._chunks:
                if self._started and not self._input_done and not output_underflow:
                    self.underflows += 1
                if self._input_done:
                    self._drained.set()
                if written:
                    self._last_sample = float(outdata[written - 1, 0])
                return

            if not self._started:
                if self._buffered_frames < PREBUFFER_FRAMES and not self._input_done:
                    return
                self._started = True

            while written < frames and self._chunks:
                chunk = self._chunks[0]
                count = min(frames - written, len(chunk) - self._chunk_offset)
                outdata[written : written + count, 0] = chunk[
                    self._chunk_offset : self._chunk_offset + count
                ]
                written += count
                audio_written += count
                self._chunk_offset += count
                self._buffered_frames -= count
                if self._chunk_offset == len(chunk):
                    self._chunks.popleft()
                    self._chunk_offset = 0

            if audio_written:
                if not self._first_audio.is_set():
                    self.first_audio_at = time.perf_counter()
                self._first_audio.set()
            if written:
                self._last_sample = float(outdata[written - 1, 0])
            if not self._chunks and self._input_done:
                self._drained.set()
            self._condition.notify_all()

    def close(self) -> None:
        self.stop()
        self._stream.stop()
        self._stream.close()


class SpeechEngine:
    def __init__(
        self,
        model_dir: Path,
        model_loader: Callable[[str, str], Kokoro] = Kokoro,
        player_factory: Callable[[], ChunkPlayer] = ChunkPlayer,
    ) -> None:
        self.model_dir = model_dir
        self._model_loader = model_loader
        self._player_factory = player_factory
        self._tts: Kokoro | None = None
        self._model_task: asyncio.Task[None] | None = None
        self._initialization_ms: int | None = None
        self._player: ChunkPlayer | None = None
        self._output_lock = threading.Lock()
        self._current_task: asyncio.Task[None] | None = None

    def emit(self, status: str, **values: Any) -> None:
        event = {"status": status, **values}
        with self._output_lock:
            sys.stdout.write(json.dumps(event, separators=(",", ":")) + "\n")
            sys.stdout.flush()

    def _download_file(
        self, name: str, url: str, expected_size: int, expected_sha256: str
    ) -> None:
        destination = self.model_dir / name
        if destination.is_file() and destination.stat().st_size == expected_size:
            return

        self.model_dir.mkdir(parents=True, exist_ok=True)
        partial = destination.with_name(destination.name + ".part")
        offset = partial.stat().st_size if partial.exists() else 0
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Milly-Desktop-Pet/0.1",
                **({"Range": f"bytes={offset}-"} if offset else {}),
            },
        )
        self.emit("downloading", file=name, downloaded_bytes=offset)
        with urllib.request.urlopen(request, timeout=30) as response:
            content_range = response.headers.get("Content-Range", "")
            range_start = re.match(r"bytes (\d+)-\d+/(?:\d+|\*)", content_range)
            if offset and response.status == 206 and (
                range_start is None or int(range_start.group(1)) != offset
            ):
                raise IOError(
                    f"The model server resumed {name} at an unexpected byte offset."
                )
            append = (
                offset > 0
                and response.status == 206
                and range_start is not None
                and int(range_start.group(1)) == offset
            )
            if offset and not append:
                offset = 0
            mode = "ab" if append else "wb"
            received = offset
            response_length = response.headers.get("Content-Length")
            expected_size = (
                offset + int(response_length) if response_length is not None else None
            )
            total_range = re.match(r"bytes \d+-\d+/(\d+)", content_range)
            if total_range:
                expected_size = int(total_range.group(1))

            with partial.open(mode) as output:
                while block := response.read(1024 * 1024):
                    output.write(block)
                    received += len(block)
                    if received % (16 * 1024 * 1024) < len(block):
                        self.emit(
                            "downloading",
                            file=name,
                            downloaded_bytes=received,
                            total_bytes=expected_size,
                        )
                output.flush()
                os.fsync(output.fileno())

        if expected_size is not None and received != expected_size:
            raise IOError(
                f"Incomplete download for {name}: expected {expected_size} bytes, "
                f"received {received}; the partial file will be resumed next time"
            )
        if received == 0:
            raise IOError(f"Downloaded an empty model file: {name}")
        digest = hashlib.sha256()
        with partial.open("rb") as source:
            for block in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(block)
        if received != expected_size or digest.hexdigest() != expected_sha256:
            partial.unlink()
            raise IOError(
                f"Integrity verification failed for {name}; the incomplete download "
                "was removed and can be retried."
            )
        os.replace(partial, destination)

    def _load_model(self) -> None:
        for name, (url, expected_size, expected_sha256) in MODEL_FILES.items():
            self._download_file(name, url, expected_size, expected_sha256)
        model_path = self.model_dir / "kokoro-v1.0.onnx"
        voices_path = self.model_dir / "voices-v1.0.bin"
        started_at = time.perf_counter()
        self._tts = self._model_loader(str(model_path), str(voices_path))
        self._initialization_ms = round((time.perf_counter() - started_at) * 1000)

    async def _ensure_model(self, request_id: int, requested_at: float) -> Kokoro:
        if self._tts is None:
            if self._model_task is None:
                self.emit("loading", request_id=request_id)
                self._model_task = asyncio.create_task(
                    asyncio.to_thread(self._load_model)
                )
            model_task = self._model_task
            try:
                await asyncio.shield(model_task)
            except Exception:
                if model_task.done():
                    self._model_task = None
                raise
            if self._model_task is model_task:
                self._model_task = None
            self.emit(
                "model_ready",
                request_id=request_id,
                initialization_ms=self._initialization_ms,
                request_to_ready_ms=round(
                    (time.perf_counter() - requested_at) * 1000
                ),
            )
        assert self._tts is not None
        return self._tts

    def _get_player(self) -> ChunkPlayer:
        if self._player is None:
            self._player = self._player_factory()
        return self._player

    async def _speak(self, request_id: int, text: str) -> None:
        requested_at = time.perf_counter()
        request_cpu = time.process_time()
        player: ChunkPlayer | None = None
        generation: int | None = None
        first_chunk_at: float | None = None
        chunks_generated = 0
        generated_frames = 0
        first_audio_task: asyncio.Task[None] | None = None
        try:
            tts = await self._ensure_model(request_id, requested_at)
            player = self._get_player()
            generation = player.begin()

            async def report_first_audio() -> None:
                while not player._first_audio.is_set() and not player._drained.is_set():
                    await asyncio.sleep(0.005)
                if player._first_audio.is_set() and player.first_audio_at is not None:
                    self.emit(
                        "first_audio",
                        request_id=request_id,
                        first_audio_ms=round(
                            (player.first_audio_at - requested_at) * 1000
                        ),
                    )

            first_audio_task = asyncio.create_task(report_first_audio())
            generation_started = time.perf_counter()
            generation_cpu_started = time.process_time()
            self.emit("synthesizing", request_id=request_id)
            async for samples, sample_rate in tts.create_stream(
                text, voice="af_heart", speed=1.0, lang="en-us"
            ):
                if sample_rate != SAMPLE_RATE:
                    raise ValueError(
                        f"Kokoro returned {sample_rate} Hz; expected {SAMPLE_RATE} Hz"
                    )
                if first_chunk_at is None:
                    first_chunk_at = time.perf_counter()
                    self.emit(
                        "first_chunk",
                        request_id=request_id,
                        first_chunk_ms=round((first_chunk_at - requested_at) * 1000),
                    )
                chunks_generated += 1
                generated_frames += len(samples)
                accepted = await asyncio.to_thread(player.push, samples, generation)
                if not accepted:
                    return

            player.finish(generation)
            generation_completed_at = time.perf_counter()
            self.emit(
                "generation_complete",
                request_id=request_id,
                generation_ms=round((generation_completed_at - generation_started) * 1000),
                chunks_generated=chunks_generated,
                generated_audio_ms=round(generated_frames * 1000 / SAMPLE_RATE),
                generation_cpu_ms=round(
                    (time.process_time() - generation_cpu_started) * 1000
                ),
            )

            while not player._drained.is_set():
                await asyncio.sleep(0.01)
            await first_audio_task
            finished_at = time.perf_counter()
            self.emit(
                "finished",
                request_id=request_id,
                request_to_playback_end_ms=round((finished_at - requested_at) * 1000),
                first_audio_to_playback_end_ms=(
                    round((finished_at - player.first_audio_at) * 1000)
                    if player.first_audio_at is not None
                    else None
                ),
                generation_complete_to_playback_end_ms=round(
                    (finished_at - generation_completed_at) * 1000
                ),
                cpu_ms=round((time.process_time() - request_cpu) * 1000),
                working_set_bytes=_working_set_bytes(),
                output_underflows=player.underflows,
            )
        except asyncio.CancelledError:
            if player is not None:
                player.stop()
            self.emit("stopped", request_id=request_id)
            raise
        except Exception as error:
            if player is not None:
                player.stop()
            self.emit("error", request_id=request_id, message=str(error))
        finally:
            if first_audio_task is not None and not first_audio_task.done():
                first_audio_task.cancel()
                try:
                    await first_audio_task
                except asyncio.CancelledError:
                    pass

    async def _cancel_current(self) -> None:
        task = self._current_task
        if task is None or task.done():
            return
        if self._player is not None:
            self._player.stop()
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    async def run(self) -> None:
        commands: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
        loop = asyncio.get_running_loop()

        def read_commands() -> None:
            for line in sys.stdin:
                try:
                    command = json.loads(line)
                except json.JSONDecodeError as error:
                    message = f"Invalid command JSON: {error}"
                    loop.call_soon_threadsafe(
                        lambda message=message: self.emit("error", message=message)
                    )
                    continue
                if isinstance(command, dict):
                    loop.call_soon_threadsafe(commands.put_nowait, command)
                else:
                    loop.call_soon_threadsafe(
                        lambda: self.emit(
                            "error", message="Speech commands must be JSON objects."
                        )
                    )
            loop.call_soon_threadsafe(commands.put_nowait, None)

        threading.Thread(target=read_commands, name="milly-tts-stdin", daemon=True).start()
        self.emit("ready")

        while True:
            command = await commands.get()
            if command is None or command.get("type") == "shutdown":
                await self._cancel_current()
                break

            command_type = command.get("type")
            if command_type == "stats":
                self.emit(
                    "stats",
                    cpu_time_ms=round(time.process_time() * 1000),
                    working_set_bytes=_working_set_bytes(),
                    model_loaded=self._tts is not None,
                    speaking=(
                        self._current_task is not None
                        and not self._current_task.done()
                    ),
                )
                continue
            if command_type == "stop":
                await self._cancel_current()
                self._current_task = None
                continue
            if command_type != "speak":
                self.emit("error", message=f"Unsupported speech command: {command_type}")
                continue

            text = command.get("text")
            request_id = command.get("request_id")
            if (
                not isinstance(request_id, int)
                or isinstance(request_id, bool)
                or not isinstance(text, str)
                or not text.strip()
                or len(text) > MAX_TEXT_LENGTH
            ):
                self.emit(
                    "error",
                    request_id=request_id,
                    message=f"Speech text must contain 1 to {MAX_TEXT_LENGTH} characters.",
                )
                continue

            await self._cancel_current()
            self._current_task = asyncio.create_task(
                self._speak(request_id, text.strip())
            )

        try:
            if self._player is not None:
                await asyncio.to_thread(self._player.close)
        finally:
            self._player = None
            try:
                if self._tts is not None:
                    self._tts.voices.close()
            finally:
                self._tts = None
                self.emit("shutdown")


def _working_set_bytes() -> int | None:
    if sys.platform == "win32":
        class ProcessMemoryCounters(ctypes.Structure):
            _fields_ = [
                ("cb", ctypes.c_ulong),
                ("PageFaultCount", ctypes.c_ulong),
                ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t),
                ("PeakPagefileUsage", ctypes.c_size_t),
            ]

        counters = ProcessMemoryCounters()
        counters.cb = ctypes.sizeof(counters)
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        psapi = ctypes.WinDLL("psapi", use_last_error=True)
        get_current_process = kernel32.GetCurrentProcess
        get_current_process.argtypes = []
        get_current_process.restype = ctypes.c_void_p
        get_process_memory_info = psapi.GetProcessMemoryInfo
        get_process_memory_info.argtypes = [
            ctypes.c_void_p,
            ctypes.POINTER(ProcessMemoryCounters),
            ctypes.c_ulong,
        ]
        get_process_memory_info.restype = ctypes.c_int
        success = get_process_memory_info(
            get_current_process(), ctypes.byref(counters), counters.cb
        )
        return int(counters.WorkingSetSize) if success else None
    try:
        import resource

        return int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024)
    except ImportError:
        return None


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", required=True, type=Path)
    args = parser.parse_args()
    await SpeechEngine(args.model_dir).run()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
