# LiveKit video classes for Silora Academy (free and open source)

Live classes run on **LiveKit**, an open-source WebRTC server. The portal has its
own classroom interface: video grid, screen sharing, chat, raise hand, reactions,
a participant list, and host controls (mute, mute all, remove, end class, record).
Students and teachers never see a third-party brand.

The backend issues a short-lived LiveKit token in `GET /api/portal/meetings/:id/join`.
Only the class's teacher, its students, and admins with the **Classes** permission
get one. Teachers and admins join as **hosts**.

## Local development

1. Get the LiveKit server binary (one time). On Windows, download
   `livekit_<version>_windows_amd64.zip` from
   https://github.com/livekit/livekit/releases and put `livekit-server.exe` in
   `livekit/bin/`. On macOS run `brew install livekit`. Docker also works.
2. Start it:

   ```bash
   ./livekit/start-livekit.sh      # ws://localhost:7880, keys devkey / secret
   ```

3. `backend/.env` already points at it:

   ```ini
   LIVEKIT_URL=ws://localhost:7880
   LIVEKIT_API_KEY=devkey
   LIVEKIT_API_SECRET=secret
   ```

To test on a phone on the same Wi-Fi, set `LIVEKIT_URL=ws://<your-PC-LAN-IP>:7880`.
Browsers only allow camera access on `localhost` or HTTPS, so use a tunnel for that.

## Production (one Ubuntu VM, about 4 vCPU / 8 GB RAM with recording)

1. Point DNS at the server: `live.siloraacademy.com` (signalling) and
   `turn.siloraacademy.com` (TURN, for students behind strict firewalls).
2. Open ports: 443/TCP, 7881/TCP, 3478/UDP, 5349/TCP, and 50000–60000/UDP.
3. Edit `livekit.yaml` and `egress.yaml`: set the same long random secret in both
   files, and set your domains.
4. Put Caddy or Nginx in front for TLS: `live.siloraacademy.com` → `127.0.0.1:7880`.
5. Start the stack: `docker compose up -d`.
6. Set these in `backend/.env`:

   ```ini
   LIVEKIT_URL=wss://live.siloraacademy.com
   LIVEKIT_API_KEY=silora
   LIVEKIT_API_SECRET=<same secret>
   LIVEKIT_EGRESS_ENABLED=true
   LIVEKIT_EGRESS_OUTPUT_DIR=/out
   LIVEKIT_RECORDINGS_DIR=/path/to/livekit/recordings   # same folder, as the backend sees it
   ```

## Joining: lobby and class links

Teachers and admins go straight in. Students press **Ask to join** and wait until a
host lets them in (a "wants to join" card with Admit / Deny, plus a waiting list in
People). Every class has a link such as `/portal/join/abc-defg-hij` – hosts copy it
from the class list, the class details, or **Class link** in the room. Anyone with a
portal account who opens it can ask to join; the host sees whether they belong to
the class. In **Class link** the host can let the class's own students in without
asking. Someone removed from the class has to ask again.

## Recording

Every class is recorded automatically. Teachers and students see no recording
indicator or Record button; admins see a REC badge and can stop or start it.

0. The recorder (a headless Chrome) needs about 15 seconds to start, so it is started
   as soon as the teacher opens the "Ready to join?" screen. By the time they join,
   it is already recording. If no host connects within 3 minutes, that recording is
   stopped and discarded. When the last person leaves, recording stops after 45 s.
1. When the teacher (or an admin) joins, LiveKit calls the webhook
   `POST /api/portal/livekit/webhook` (`participant_joined`), and the backend starts
   a room-composite Egress. If that attempt fails (for example nobody was publishing
   yet), the next `track_published` event tries again.
2. The whiteboard is included: the host who opens it also publishes it as a hidden
   video track, so it fills the recording frame ("speaker" layout).
3. When the class ends, Egress writes an `.mp4` to `recordings/` (`/out` in the
   container), LiveKit calls the webhook (`egress_ended`), and the backend uploads the
   file to Storage, links it to the class and deletes the local copy.

Settings in `backend/.env`: `LIVEKIT_EGRESS_ENABLED=true`, `LIVEKIT_AUTO_RECORD=true`,
`LIVEKIT_RECORDINGS_DIR=../livekit/recordings`.

Let families know classes are recorded (enrolment terms / privacy policy) – recording
people without notice, especially children, is restricted by law in many countries.

### Recording on your own PC (Docker Desktop)

`bin/livekit-server.exe` can't record. For local recording, run LiveKit, Egress and
Redis in Docker instead (stop the .exe first – both use port 7880):

```bash
cd livekit
docker compose -f docker-compose.dev.yml up -d     # LiveKit + Egress + Redis
docker compose -f docker-compose.dev.yml down      # stop
```

Egress shares the LiveKit container's network, so it reaches LiveKit on 127.0.0.1
whatever your Wi-Fi address is (`egress.dev.yaml` enables loopback WebRTC in its
Chrome). Browsers on this PC still use `ws://localhost:7880`. Egress runs a headless
Chrome, so Docker needs about 2 GB of free RAM.

Only admins with the **Recordings** permission can see recordings. Each one is
deleted automatically `RECORDING_RETENTION_DAYS` (default 7) after the class.
If the backend runs on a different machine from Egress, either mount the
recordings folder on the backend machine, or upload files with
`POST /api/portal/recordings/ingest`, using the `x-ingest-secret` header and the
form fields `roomName` and `file`.
