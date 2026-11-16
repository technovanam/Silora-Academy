#!/usr/bin/env bash
# Starts a local LiveKit server for development on ws://localhost:7880 (keys devkey / secret).
# Uses ./bin/livekit-server(.exe) if present, otherwise `livekit-server` from PATH, otherwise Docker.
cd "$(dirname "$0")"
for bin in ./bin/livekit-server.exe ./bin/livekit-server; do
  [ -x "$bin" ] && exec "$bin" --config livekit.dev.yaml
done
command -v livekit-server >/dev/null && exec livekit-server --config livekit.dev.yaml
exec docker run --rm -p 7880:7880 -p 7881:7881 -p 50000-50100:50000-50100/udp \
  -v "$PWD/livekit.dev.yaml:/livekit.yaml" livekit/livekit-server:v1.13.11 --config /livekit.yaml --node-ip 127.0.0.1
