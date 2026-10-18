import soundfile as sf
from kokoro_onnx import Kokoro

tts = Kokoro("kokoro-v1.0.onnx", "voices-v1.0.bin")
try:
    audio, sample_rate = tts.create(
        "Hey! I'm Milly. Let's make today productive!", voice="af_heart",
        speed=1.0,
        lang="en-us",
    )
    sf.write("milly.wav", audio, sample_rate)
    print("Generated milly.wav")
finally:
    tts.voices.close()