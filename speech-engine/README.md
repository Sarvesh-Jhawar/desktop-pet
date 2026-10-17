# Local Kokoro speech engine

The engine uses `kokoro-onnx`'s `Kokoro.create_stream()` async generator and
plays its 24 kHz mono float32 chunks through one persistent PortAudio output
stream. The model is loaded once per engine process and remains loaded between
speech requests. Commands use newline-delimited JSON over the child process's
standard input; status and timing events use standard output. Angular can only
invoke the explicit `speech_speak`, `speech_stop`, and `speech_is_speaking`
Tauri commands.

The engine reports generation time, generated audio duration, first PCM
submission to the output callback, playback completion, aggregate process CPU
time, working-set memory, and output underflows. First PCM submission is a
software-side latency measurement; actual speaker latency also depends on the
Windows audio stack and output device.

## Development

The Tauri debug build uses `test-pet-audio/.venv/Scripts/python.exe` and
reuses the model and voices already in `test-pet-audio/`. Install
`speech-engine/requirements.txt` into that virtual environment first if the
audio backend is missing.

If the model files are not present, the engine downloads the official
`kokoro-v1.0.onnx` and `voices-v1.0.bin` release assets into the application
data model directory. Downloads use HTTPS, retain `.part` files for resuming,
verify official GitHub release sizes and SHA-256 digests, and reuse completed
files.

## Windows distribution

Run `./speech-engine/build.ps1` before building a Tauri installer. Pass
`-PythonPath` to reuse an existing Python 3.12 build environment, or
`-OutputDirectory` / `-WorkingDirectory` to place the large build outputs on a
different volume. It produces
an onedir `milly-tts.exe` and its self-contained Python/runtime dependencies
under `speech-engine/dist/milly-tts/`; Tauri bundles that runtime, but not the
large voice/model files. The first Test Voice request downloads those files.
End users do not need Python installed.

The engine uses `kokoro-onnx` (MIT) and Kokoro model weights (Apache-2.0).
The bundled voice file is downloaded with the model release rather than
redistributed in the installer; review the upstream asset terms before
redistributing downloaded voice assets separately.
