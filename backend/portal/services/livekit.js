// ============================================================================
// LIVEKIT (open-source WebRTC SFU, self-hosted)
// Join tokens, moderation (mute / remove / end), recording via Egress.
// ============================================================================
import path from "path";
import { AccessToken, RoomServiceClient, EgressClient, EncodedFileOutput, EncodedFileType, WebhookReceiver } from "livekit-server-sdk";
import config from "../config.js";

const lk = config.livekit;
export const roomService = new RoomServiceClient(lk.apiUrl, lk.apiKey, lk.apiSecret);
export const egressClient = new EgressClient(lk.apiUrl, lk.apiKey, lk.apiSecret);
export const webhookReceiver = new WebhookReceiver(lk.apiKey, lk.apiSecret);

// Short-lived join token. Teachers/admins are hosts (room admin: mute, remove, end);
// students can publish camera, mic and screen, chat and raise their hand.
// Only admins get the record grant – recording is server-side and admin-only.
export async function joinToken({ roomName, identity, name, role, ttlSec, host }) {
  const isHost = host ?? role !== "student";
  const at = new AccessToken(lk.apiKey, lk.apiSecret, {
    identity,
    name,
    ttl: ttlSec,
    metadata: JSON.stringify({ role, host: isHost }),
    attributes: { role, host: String(isHost) },
  });
  at.addGrant({
    room: roomName,
    roomJoin: true,
    roomAdmin: isHost,
    roomRecord: role === "admin",
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    canUpdateOwnMetadata: true,
  });
  return at.toJwt();
}

// Recording state is NOT written to room metadata (everyone can read that) –
// it lives on the meeting document, which only admins can see.
export async function startRecording(roomName) {
  const file = new EncodedFileOutput({
    fileType: EncodedFileType.MP4,
    filepath: `${lk.egressOutputDir}/${roomName}-{time}.mp4`,
  });
  // "speaker" layout: a shared screen or the whiteboard fills the frame, cameras alongside
  const info = await egressClient.startRoomCompositeEgress(roomName, { file }, { layout: "speaker" });
  return info.egressId;
}

export async function stopRecording(roomName, egressId) {
  if (egressId) await egressClient.stopEgress(egressId).catch(() => {});
}

/** Active recording for a room, if any (egressId) */
export async function activeRecording(roomName) {
  const list = await egressClient.listEgress({ roomName, active: true });
  // Only the class video – the per-microphone transcript captures are Track Egresses
  return list.find((e) => e.roomName === roomName && e.request?.case === "roomComposite")?.egressId || null;
}

// Start recording a room unless one is already running. Several "joined" events
// can arrive at once, so concurrent calls for the same room share one attempt.
const starting = new Map();
export function ensureRecording(roomName) {
  if (!lk.egressEnabled || !lk.autoRecord) return Promise.resolve(null);
  if (starting.has(roomName)) return starting.get(roomName);
  const p = (async () => {
    const existing = await activeRecording(roomName).catch(() => null);
    if (existing) return { egressId: existing, started: false };
    return { egressId: await startRecording(roomName), started: true };
  })().finally(() => setTimeout(() => starting.delete(roomName), 5000));
  starting.set(roomName, p);
  return p;
}

// ---- Start recording BEFORE the host is in the room ---------------------------------
// The recorder is a headless Chrome that needs ~15 s to boot. Starting it only when
// the teacher has connected loses the first part of the class, so it's started when
// a host opens the "Ready to join?" screen. If no host connects soon after, the
// recording is stopped and thrown away.
const PREWARM_GRACE_MS = 3 * 60 * 1000;
const discarded = new Set(); // egress ids whose file must not be kept
export const isDiscarded = (egressId) => discarded.has(egressId);

const isRecorderP = (p) => String(p?.identity || "").startsWith("EG_") || p?.kind === 2;
const roleOfP = (p) => p?.attributes?.role || (() => { try { return JSON.parse(p?.metadata || "{}").role; } catch { return null; } })();
export const realPeople = async (roomName) => (await roomService.listParticipants(roomName).catch(() => [])).filter((p) => !isRecorderP(p));

export async function prewarmRecording(roomName) {
  if (!lk.egressEnabled || !lk.autoRecord) return null;
  // The room has to exist before a recorder can join it
  await roomService.createRoom({ name: roomName, emptyTimeout: 600, departureTimeout: 60 }).catch(() => {});
  const r = await ensureRecording(roomName);
  if (r?.started) {
    setTimeout(async () => {
      const people = await realPeople(roomName);
      if (people.some((p) => ["teacher", "admin"].includes(roleOfP(p)))) return;
      if (people.length) return; // someone is in class – keep it
      discarded.add(r.egressId);
      await stopRecording(roomName, r.egressId);
    }, PREWARM_GRACE_MS).unref?.();
  }
  return r;
}

// When the last person leaves, stop recording after a short grace period (a dropped
// connection usually comes back within seconds) so the video doesn't end in silence.
const emptyTimers = new Map();
export function stopWhenEmpty(roomName, graceMs = 45000) {
  clearTimeout(emptyTimers.get(roomName));
  emptyTimers.set(
    roomName,
    setTimeout(async () => {
      emptyTimers.delete(roomName);
      if ((await realPeople(roomName)).length) return;
      const id = await activeRecording(roomName).catch(() => null);
      if (id) await stopRecording(roomName, id);
    }, graceMs)
  );
}
export const cancelStopWhenEmpty = (roomName) => clearTimeout(emptyTimers.get(roomName));

// Where the backend can read a file egress wrote (egress path -> local path)
export function localRecordingPath(egressFilename) {
  if (!lk.recordingsDir || !egressFilename) return null;
  const rel = egressFilename.startsWith(lk.egressOutputDir) ? egressFilename.slice(lk.egressOutputDir.length) : path.basename(egressFilename);
  return path.join(lk.recordingsDir, rel.replace(/^[/\\]+/, ""));
}

export const isLiveKitUp = async () => {
  try {
    await roomService.listRooms();
    return true;
  } catch {
    return false;
  }
};
