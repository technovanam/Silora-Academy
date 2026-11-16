// ============================================================================
// CLASS TRANSCRIPTS – who said what, for admins only.
//
// 1. When anyone in a class turns their mic on (LiveKit "track_published"), we
//    start a Track Egress that saves just that person's audio (.ogg) to disk.
// 2. When it ends ("egress_ended"), the file is queued for Whisper (whisper.cpp
//    server, self-hosted and open source). One file at a time – it's CPU heavy.
// 3. Each person's timestamped segments are stored in `transcriptParts`, then
//    merged in time order into the recording's transcript:
//        [02:14] Priya Raman (Teacher): Let's look at question three.
//        [02:19] Aarav Sharma: Is it x equals two?
// 4. The audio files are deleted as soon as they're transcribed.
// Nothing here is visible to teachers or students.
// ============================================================================
import fs from "fs";
import path from "path";
import { DirectFileOutput, TrackSource, TrackType } from "livekit-server-sdk";
import config from "../config.js";
import { db, C } from "../firebase.js";
import { nowIso } from "../util.js";
import { egressClient, localRecordingPath } from "./livekit.js";

const lk = config.livekit;
const wh = config.whisper;
export const transcriptionEnabled = () => !!(wh.url && lk.egressEnabled && lk.autoRecord);

const nsToMs = (v) => (v ? Number(BigInt(v) / 1000000n) : null);
const roleLabel = { teacher: "Teacher", admin: "Admin" };

// ---- 1. Capture each microphone ---------------------------------------------------------
export async function captureMicrophone({ roomName, track, participant, meeting, role: givenRole }) {
  let role = givenRole;
  if (!transcriptionEnabled() || !track || !participant) return null;
  if (track.type !== TrackType.AUDIO || track.source !== TrackSource.MICROPHONE) return null;
  const dupe = await db.collection(C.transcriptParts).where("trackSid", "==", track.sid).limit(1).get();
  if (!dupe.empty) return null;
  const info = await egressClient.startTrackEgress(
    roomName,
    new DirectFileOutput({ filepath: `${lk.egressOutputDir}/audio/${roomName}/{publisher_identity}-{track_id}-{time}.ogg` }),
    track.sid
  );
  // Name and role come from the portal's own user record (identity = user id);
  // LiveKit's track webhooks only carry a minimal participant record.
  const user = await db.collection(C.users).doc(participant.identity).get().catch(() => null);
  const name = (user?.exists && user.data().name) || String(participant.name || "Participant").replace(/\s*\((Teacher|Admin)\)$/, "");
  role = (user?.exists && user.data().role) || role;
  await db.collection(C.transcriptParts).doc(info.egressId).set({
    meetingId: meeting?.id || null,
    roomName,
    identity: participant.identity,
    name,
    role: role || "student",
    trackSid: track.sid,
    egressId: info.egressId,
    status: "recording",
    createdAt: nowIso(),
  });
  if (meeting?.id) await db.collection(C.meetings).doc(meeting.id).update({ transcriptPending: true }).catch(() => {});
  return info.egressId;
}

/** egress_ended for a microphone capture? Returns true when handled here. */
export async function handleCaptureEnded(info) {
  const ref = db.collection(C.transcriptParts).doc(info.egressId);
  const snap = await ref.get();
  if (!snap.exists) return false;
  const fr = (info.fileResults || [])[0] || info.file;
  const local = localRecordingPath(fr?.filename || fr?.location);
  // Egress writes <egressId>.json beside the audio file – not needed
  for (const m of [local && path.join(path.dirname(local), `${info.egressId}.json`), localRecordingPath(`${lk.egressOutputDir}/${info.egressId}.json`)]) {
    if (m) fs.promises.unlink(m).catch(() => {});
  }
  if (!local || !fs.existsSync(local) || !(fr?.size > 0 || fs.statSync(local).size > 0)) {
    await ref.update({ status: "empty", endedAt: nowIso(), localPath: null });
    if (local) fs.promises.unlink(local).catch(() => {});
    await refreshMeeting(snap.data().meetingId);
    return true;
  }
  await ref.update({
    status: "queued",
    localPath: local,
    audioStartedAt: nsToMs(fr?.startedAt || info.startedAt),
    audioEndedAt: nsToMs(fr?.endedAt || info.endedAt),
    endedAt: nowIso(),
  });
  enqueue(info.egressId);
  return true;
}

// ---- 2. Whisper queue (one file at a time) -------------------------------------------------
let chain = Promise.resolve();
const queued = new Set();
function enqueue(partId) {
  if (queued.has(partId)) return;
  queued.add(partId);
  chain = chain.then(() => transcribePart(partId).catch((e) => console.error("Transcription failed", partId, e.message))).finally(() => queued.delete(partId));
}

/** Resume work left over from a restart. */
export async function resumeTranscriptions() {
  if (!wh.url) return;
  const qs = await db.collection(C.transcriptParts).where("status", "in", ["queued", "transcribing"]).get();
  qs.docs.forEach((d) => enqueue(d.id));
  if (qs.size) console.log(`📝 Resuming ${qs.size} transcription(s)`);
}

async function whisper(file) {
  const buf = await fs.promises.readFile(file);
  const form = new FormData();
  form.append("file", new Blob([buf], { type: "audio/ogg" }), path.basename(file));
  form.append("response_format", "verbose_json");
  form.append("temperature", "0");
  if (wh.language && wh.language !== "auto") form.append("language", wh.language);
  const res = await fetch(`${wh.url}/inference`, { method: "POST", body: form, signal: AbortSignal.timeout(wh.timeoutMin * 60000) });
  if (!res.ok) throw new Error(`Whisper server replied ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// Whisper sometimes "hears" these in silence or noise
const PHANTOM = /^(thank you\.?|thanks for watching!?|you|bye\.?|\[.*\]|\(.*\)|♪+|\.+)$/i;

async function transcribePart(partId) {
  const ref = db.collection(C.transcriptParts).doc(partId);
  const snap = await ref.get();
  if (!snap.exists) return;
  const part = snap.data();
  if (!part.localPath || !fs.existsSync(part.localPath)) {
    await ref.update({ status: "failed", error: "Audio file missing" });
    return refreshMeeting(part.meetingId);
  }
  await ref.update({ status: "transcribing" });
  const started = Date.now();
  try {
    const out = await whisper(part.localPath);
    const base = part.audioStartedAt || Date.parse(part.createdAt);
    const segments = (out.segments || [])
      .filter((s) => !(s.no_speech_prob > 0.6))
      .map((s) => ({ t: Math.round(base + s.start * 1000), e: Math.round(base + s.end * 1000), text: String(s.text || "").trim() }))
      .filter((s) => s.text && !PHANTOM.test(s.text));
    await ref.update({ status: "done", segments, language: out.language || null, transcribedAt: nowIso(), tookSec: Math.round((Date.now() - started) / 1000), localPath: null });
    await fs.promises.unlink(part.localPath).catch(() => {});
    await fs.promises.rmdir(path.dirname(part.localPath)).catch(() => {}); // the class's audio folder, once empty
  } catch (e) {
    await ref.update({ status: "failed", error: String(e.message).slice(0, 300) });
    console.error("Whisper error for", part.name, "-", e.message);
  }
  await refreshMeeting(part.meetingId);
}

// ---- 3. Merge into the recording's transcript --------------------------------------------
const clock = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

export function buildTranscript(parts, startMs, endMs) {
  const lines = [];
  const segs = parts
    .flatMap((p) => (p.segments || []).map((s) => ({ ...s, who: roleLabel[p.role] ? `${p.name} (${roleLabel[p.role]})` : p.name })))
    .filter((s) => (startMs ? s.e >= startMs - 2000 : true) && (endMs ? s.t <= endMs + 2000 : true))
    .sort((a, b) => a.t - b.t);
  const origin = startMs || segs[0]?.t || 0;
  let last = null;
  for (const s of segs) {
    // Join consecutive sentences from the same person said close together,
    // but start a new timestamped line about every 30 seconds
    if (last && last.who === s.who && s.t - last.e < 4000 && s.e - last.t < 30000) {
      last.text += ` ${s.text}`;
      last.e = s.e;
    } else {
      last = { who: s.who, t: s.t, e: s.e, text: s.text };
      lines.push(last);
    }
  }
  return lines.map((l) => `[${clock(l.t - origin)}] ${l.who}: ${l.text}`).join("\n");
}

/** Recompute the transcript status of a meeting and every recording linked to it. */
export async function refreshMeeting(meetingId) {
  if (!meetingId) return;
  const parts = (await db.collection(C.transcriptParts).where("meetingId", "==", meetingId).get()).docs.map((d) => d.data());
  const pending = parts.some((p) => ["recording", "queued", "transcribing"].includes(p.status));
  const failed = parts.filter((p) => p.status === "failed").length;
  const recs = await db.collection(C.recordings).where("meetingId", "==", meetingId).get();
  for (const d of recs.docs) {
    const r = d.data();
    if (r.transcriptEditedAt || r.source !== "livekit") continue; // keep an admin's own edits / uploaded transcripts
    const text = buildTranscript(parts.filter((p) => p.status === "done"), r.mediaStartedAt, r.mediaEndedAt);
    await d.ref.update({
      transcript: text,
      hasTranscript: !!text,
      transcriptAuto: true,
      transcriptStatus: pending ? "processing" : failed ? "partial" : parts.length ? "done" : "none",
      transcriptUpdatedAt: nowIso(),
    });
  }
  await db.collection(C.meetings).doc(meetingId).update({ transcriptPending: pending }).catch(() => {});
}

/** Delete transcript parts for a meeting (when its recordings are deleted). */
export async function deleteParts(meetingId) {
  if (!meetingId) return;
  const qs = await db.collection(C.transcriptParts).where("meetingId", "==", meetingId).get();
  for (const d of qs.docs) {
    if (d.data().localPath) await fs.promises.unlink(d.data().localPath).catch(() => {});
    await d.ref.delete();
  }
}

/** Is the Whisper server reachable? */
export async function whisperStatus() {
  if (!wh.url) return "not_configured";
  try {
    const res = await fetch(wh.url, { signal: AbortSignal.timeout(3000) });
    return res.ok || res.status < 500 ? "ok" : `error ${res.status}`;
  } catch (e) {
    return `unreachable (${wh.url})`;
  }
}
