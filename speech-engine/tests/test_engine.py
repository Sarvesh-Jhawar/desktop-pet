from __future__ import annotations

import asyncio
import json
import sys
import tempfile
import time
import unittest
from contextlib import redirect_stdout
from io import BytesIO, StringIO
from pathlib import Path
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import engine


class FakeOutputStream:
    def __init__(self, **options: object) -> None:
        self.options = options
        self.callback = options["callback"]

    def start(self) -> None:
        pass

    def stop(self) -> None:
        pass

    def close(self) -> None:
        pass

    def render(self, frames: int) -> np.ndarray:
        output = np.empty((frames, 1), dtype=np.float32)
        self.callback(output, frames, None, None)
        return output


class FakePlayer:
    def __init__(self) -> None:
        self._first_audio = asyncio.Event()
        self._drained = asyncio.Event()
        self.first_audio_at: float | None = None
        self.chunks: list[np.ndarray] = []
        self.underflows = 0
        self.generation = 0
        self.stopped = False

    def begin(self) -> int:
        self.generation += 1
        self.chunks.clear()
        self._first_audio.clear()
        self._drained.clear()
        self.stopped = False
        self.first_audio_at = None
        return self.generation

    def push(self, samples: np.ndarray, generation: int) -> bool:
        if generation != self.generation:
            return False
        self.chunks.append(samples)
        self.first_audio_at = time.perf_counter()
        self._first_audio.set()
        return True

    def finish(self, generation: int) -> None:
        if generation == self.generation:
            self._drained.set()

    def stop(self) -> None:
        self.generation += 1
        self.stopped = True
        self._drained.set()

    def close(self) -> None:
        self.stop()


class FakeTTS:
    def __init__(self, sample_rate: int = engine.SAMPLE_RATE) -> None:
        self.sample_rate = sample_rate
        self.voices = None
        self.calls = 0

    async def create_stream(self, *_args: object, **_kwargs: object):
        self.calls += 1
        yield np.ones(512, dtype=np.float32), self.sample_rate
        yield np.zeros(256, dtype=np.float32), self.sample_rate


class SpeechEngineTests(unittest.TestCase):
    def test_output_stream_uses_mono_24khz_float_and_preserves_chunk_order(self) -> None:
        with patch.object(
            engine.sd,
            "OutputStream",
            side_effect=lambda **options: FakeOutputStream(**options),
        ):
            player = engine.ChunkPlayer()
            stream = player._stream
            generation = player.begin()
            samples = np.linspace(-0.5, 0.5, 2_000, dtype=np.float32)
            self.assertTrue(player.push(samples, generation))

            first = stream.render(512)
            second = stream.render(512)

            self.assertEqual(stream.options["samplerate"], 24_000)
            self.assertEqual(stream.options["channels"], 1)
            self.assertEqual(stream.options["dtype"], "float32")
            np.testing.assert_array_equal(first[:, 0], samples[:512])
            np.testing.assert_array_equal(second[:, 0], samples[512:1024])
            self.assertTrue(player._first_audio.is_set())
            player.close()

    def test_stopping_invalidates_queued_samples(self) -> None:
        with patch.object(
            engine.sd,
            "OutputStream",
            side_effect=lambda **options: FakeOutputStream(**options),
        ):
            player = engine.ChunkPlayer()
            stream = player._stream
            generation = player.begin()
            player.push(np.ones(2_000, dtype=np.float32), generation)
            player.stop()

            self.assertFalse(player.push(np.ones(10, dtype=np.float32), generation))
            self.assertEqual(stream.render(128).tolist(), [[0.0]] * 128)
            player.close()

    def test_interrupted_model_download_resumes_and_promotes_completed_file(self) -> None:
        class Response(BytesIO):
            status = 206
            headers = {
                "Content-Length": "3",
                "Content-Range": "bytes 3-5/6",
            }

        with tempfile.TemporaryDirectory() as temporary_directory:
            model_dir = Path(temporary_directory)
            partial = model_dir / "kokoro-v1.0.onnx.part"
            partial.write_bytes(b"abc")
            engine_instance = engine.SpeechEngine(model_dir)

            def open_url(request: object, timeout: int) -> Response:
                self.assertEqual(request.get_header("Range"), "bytes=3-")
                self.assertEqual(timeout, 30)
                return Response(b"def")

            with patch.object(engine.urllib.request, "urlopen", side_effect=open_url):
                engine_instance._download_file(
                    "kokoro-v1.0.onnx",
                    "https://example.test/model",
                    6,
                    engine.hashlib.sha256(b"abcdef").hexdigest(),
                )

            self.assertEqual(
                (model_dir / "kokoro-v1.0.onnx").read_bytes(), b"abcdef"
            )
            self.assertFalse(partial.exists())

    def test_streamed_requests_reuse_model_and_audio_player(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            model_dir = Path(temporary_directory)
            (model_dir / "kokoro-v1.0.onnx").write_bytes(b"test")
            (model_dir / "voices-v1.0.bin").write_bytes(b"test")
            tts = FakeTTS()
            model_loads = 0
            player = FakePlayer()

            def load_model(_model: str, _voices: str) -> FakeTTS:
                nonlocal model_loads
                model_loads += 1
                return tts

            engine_instance = engine.SpeechEngine(
                model_dir,
                model_loader=load_model,
                player_factory=lambda: player,
            )
            output = StringIO()
            with patch.object(engine_instance, "_download_file"), redirect_stdout(output):
                asyncio.run(engine_instance._speak(1, "first"))
                asyncio.run(engine_instance._speak(2, "second"))

            events = [json.loads(line) for line in output.getvalue().splitlines()]
            self.assertEqual(model_loads, 1)
            self.assertEqual(tts.calls, 2)
            self.assertEqual(
                [event["chunks_generated"] for event in events if event["status"] == "generation_complete"],
                [2, 2],
            )
            self.assertEqual(
                [event["generated_audio_ms"] for event in events if event["status"] == "generation_complete"],
                [32, 32],
            )
            self.assertEqual(
                sum(event["status"] == "first_audio" for event in events), 2
            )

    def test_stream_errors_are_reported_and_stop_cancels_generation(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            model_dir = Path(temporary_directory)
            (model_dir / "kokoro-v1.0.onnx").write_bytes(b"test")
            (model_dir / "voices-v1.0.bin").write_bytes(b"test")
            tts = FakeTTS(sample_rate=16_000)
            player = FakePlayer()
            engine_instance = engine.SpeechEngine(
                model_dir,
                model_loader=lambda _model, _voices: tts,
                player_factory=lambda: player,
            )
            output = StringIO()
            with patch.object(engine_instance, "_download_file"), redirect_stdout(output):
                asyncio.run(engine_instance._speak(1, "wrong sample rate"))

            events = [json.loads(line) for line in output.getvalue().splitlines()]
            error = next(event for event in events if event["status"] == "error")
            self.assertIn("expected 24000 Hz", error["message"])

            class BlockingTTS(FakeTTS):
                async def create_stream(self, *_args: object, **_kwargs: object):
                    yield np.ones(512, dtype=np.float32), engine.SAMPLE_RATE
                    await asyncio.Event().wait()

            async def cancel_request() -> None:
                engine_instance._tts = BlockingTTS()
                task = asyncio.create_task(engine_instance._speak(2, "stop me"))
                engine_instance._current_task = task
                await asyncio.sleep(0.01)
                await engine_instance._cancel_current()

            stop_output = StringIO()
            with redirect_stdout(stop_output):
                asyncio.run(cancel_request())
            self.assertTrue(player.stopped)
            stopped_events = [
                json.loads(line)
                for line in stop_output.getvalue().splitlines()
                if json.loads(line)["status"] == "stopped"
            ]
            self.assertEqual(stopped_events, [{"status": "stopped", "request_id": 2}])

    def test_protocol_reports_invalid_commands_and_shuts_down_cleanly(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            engine_instance = engine.SpeechEngine(Path(temporary_directory))
            output = StringIO()
            input_stream = StringIO(
                'not json\n{"type":"stop"}\n{"type":"shutdown"}\n'
            )
            with patch.object(engine.sys, "stdin", input_stream), redirect_stdout(output):
                asyncio.run(engine_instance.run())

            events = [json.loads(line) for line in output.getvalue().splitlines()]
            self.assertEqual(events[0]["status"], "ready")
            self.assertEqual(events[1]["status"], "error")
            self.assertIn("Invalid command JSON", events[1]["message"])
            self.assertNotIn("stopped", [event["status"] for event in events])
            self.assertEqual(events[-1]["status"], "shutdown")

    @unittest.skipUnless(sys.platform == "win32", "Windows memory API")
    def test_windows_working_set_measurement_returns_a_value(self) -> None:
        self.assertIsInstance(engine._working_set_bytes(), int)


if __name__ == "__main__":
    unittest.main()
