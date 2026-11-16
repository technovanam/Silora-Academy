# Class transcripts (whisper.cpp – free, open source, self-hosted)

Every class is transcribed automatically for admins: each person's microphone is
captured separately (LiveKit Track Egress), transcribed by a local whisper.cpp
server, and merged in time order into the recording's transcript:

    [02:14] Priya Raman (Teacher): Let's look at question three.
    [02:19] Aarav Sharma: Is it x equals two?

Teachers and students never see transcripts. Audio files are deleted once they are
transcribed; transcripts are deleted together with their recording.

## Models (one-time download into whisper/models/)

```bash
cd whisper/models
curl -LO https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin          # 466 MB
curl -LO https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin   # 0.9 MB (skips silence)
```

`ggml-small.bin` handles accents and mixed languages well on a CPU (roughly 3–6× faster
than real time with voice detection). For more speed use `ggml-base.bin`; for more
accuracy `ggml-medium.bin` (slow on CPU). Change the `-m` path in the compose file.

## Running

The `whisper` service is part of `livekit/docker-compose.dev.yml` (local) and
`livekit/docker-compose.yml` (production). `backend/.env`:

```ini
WHISPER_URL=http://127.0.0.1:8178
WHISPER_LANGUAGE=auto      # or a fixed code such as en
```

Transcription also needs `LIVEKIT_EGRESS_ENABLED=true` and `LIVEKIT_AUTO_RECORD=true`.
Admins can correct a transcript in Recordings → open a recording → Edit; an edited
transcript is never overwritten by the automatic one.
