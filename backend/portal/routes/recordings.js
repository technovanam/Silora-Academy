// ============================================================================
// CLASS RECORDINGS – admin only (teachers and students have no access).
// Recordings arrive from LiveKit Egress (webhook when a recording finishes),
// from the ingest endpoint,
// or are uploaded manually by an admin. They are deleted automatically
// N days (default 7) after the class.
// ============================================================================
import fs from "fs";
import os from "os";
import path from "path";
import express, { Router } from "express";
import multer from "multer";
import config from "../config.js";
import { db, C, bucket } from "../firebase.js";
import { ah, fail, nowIso, str, addDays, listData, getMany } from "../util.js";
import { requireRole, requirePerm, authenticate } from "../middleware.js";
import { audit, logActivity } from "../services/core.js";
import { webhookReceiver, localRecordingPath, ensureRecording, roomService, isDiscarded, stopWhenEmpty, cancelStopWhenEmpty } from "../services/livekit.js";
import { validateFile, scanBuffer, safeFileName, fileLink, RECORDING_TYPES, deleteStored } from "../services/files.js";
import { notifyAdmins } from "../services/notify.js";
import { captureMicrophone, handleCaptureEnded, refreshMeeting, deleteParts } from "../services/transcribe.js";

const router = Router();
export const ingestRouter = Router();

const tmpDir = path.join(os.tmpdir(), "silora-recordings");
fs.mkdirSync(tmpDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({ destination: tmpDir }),
  limits: { fileSize: config.maxRecordingMb * 1024 * 1024, files: 2 },
});
const fields = upload.fields([
  { name: "file", maxCount: 1 },
  { name: "transcript", maxCount: 1 },
]);

const cleanupTmp = (req) => Object.values(req.files || {}).flat().forEach((f) => fs.promises.unlink(f.path).catch(() => {}));

async function readHead(p, n = 8192) {
  const fh = await fs.promises.open(p, "r");
  try {
    const buf = Buffer.alloc(n);
    const { bytesRead } = await fh.read(buf, 0, n, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

async function readTranscript(file) {
  if (!file) return "";
  const ext = path.extname(file.originalname).toLowerCase();
  if (![".txt", ".vtt", ".srt"].includes(ext)) fail(400, "Transcript must be .txt, .vtt or .srt");
  const text = await fs.promises.readFile(file.path, "utf8");
  if (text.includes("\0")) fail(400, "Transcript is not a text file");
  return text.slice(0, 900000);
}

async function storeRecording(meeting, file, transcriptFile, source, media = {}) {
  if (!file) fail(400, "Attach the recording file");
  const head = await readHead(file.path);
  const info = validateFile(head, file.originalname, RECORDING_TYPES, config.maxRecordingMb);
  // Scan with ClamAV when configured (small files in one go; large video files are skipped)
  let scan = { status: "skipped", detail: "Too large for inline scan" };
  if (file.size <= 200 * 1024 * 1024) scan = await scanBuffer(await fs.promises.readFile(file.path));
  if (scan.status === "infected") fail(400, "The recording was blocked by the malware scanner");
  const transcript = await readTranscript(transcriptFile);

  const ref = db.collection(C.recordings).doc();
  const storagePath = `recordings/${ref.id}/${safeFileName(file.originalname)}`;
  await bucket.upload(file.path, { destination: storagePath, resumable: false, metadata: { contentType: info.contentType } });
  const classStartAt = meeting?.startAt || nowIso();
  const doc = {
    meetingId: meeting?.id || null,
    title: meeting?.title || safeFileName(file.originalname),
    subject: meeting?.subject || "",
    teacherId: meeting?.teacherId || null,
    studentIds: meeting?.studentIds || [],
    classStartAt,
    file: { path: storagePath, fileName: safeFileName(file.originalname), contentType: info.contentType, size: file.size, kind: info.label, scan: scan.status },
    transcript,
    hasTranscript: !!transcript,
    source,
    // Time span of the video (LiveKit recordings) – lines the transcript up with it
    mediaStartedAt: media.startedAt || null,
    mediaEndedAt: media.endedAt || null,
    ...(source === "livekit" && !transcript ? { transcriptStatus: "processing" } : {}),
    createdAt: nowIso(),
    deleteAt: addDays(classStartAt, config.recordingRetentionDays).toISOString(),
  };
  await ref.set(doc);
  if (meeting?.id) await db.collection(C.meetings).doc(meeting.id).update({ hasRecording: true });
  return { id: ref.id, ...doc };
}

async function names(ids) {
  return Object.fromEntries(Object.values(await getMany(db, C.users, ids)).map((u) => [u.id, u.name]));
}

const shape = (r, n) => ({
  id: r.id,
  meetingId: r.meetingId,
  title: r.title,
  subject: r.subject,
  teacherName: n[r.teacherId] || "",
  students: (r.studentIds || []).map((id) => n[id] || "Student"),
  classStartAt: r.classStartAt,
  createdAt: r.createdAt,
  deleteAt: r.deleteAt,
  source: r.source,
  hasTranscript: !!r.hasTranscript,
  transcriptStatus: r.transcriptStatus || (r.hasTranscript ? "done" : "none"),
  transcriptAuto: !!r.transcriptAuto,
  file: { fileName: r.file?.fileName, size: r.file?.size, contentType: r.file?.contentType, kind: r.file?.kind },
});

/** Delete recordings whose retention period has ended (scheduled job). */
export async function cleanupRecordings() {
  const qs = await db.collection(C.recordings).where("deleteAt", "<=", nowIso()).get();
  for (const d of qs.docs) {
    await deleteStored([d.data().file?.path]);
    await d.ref.delete();
    await deleteParts(d.data().meetingId).catch(() => {});
    await db.collection(C.audit).add({ at: nowIso(), actorId: null, actorName: "System", action: "recording.auto_delete", targetType: "recording", targetId: d.id, summary: `Auto-deleted recording "${d.data().title}" after ${config.recordingRetentionDays} days` });
  }
  // Transcript pieces of classes that never produced a video
  const cutoff = new Date(Date.now() - config.recordingRetentionDays * 86400000).toISOString();
  const stale = await db.collection(C.transcriptParts).where("createdAt", "<=", cutoff).get();
  for (const d of stale.docs) {
    if (d.data().localPath) await fs.promises.unlink(d.data().localPath).catch(() => {});
    await d.ref.delete();
  }
  return qs.size;
}

// ---- Admin --------------------------------------------------------------------------
router.use("/admin/recordings", authenticate, requireRole("admin"), requirePerm("recordings"));

router.get(
  "/admin/recordings",
  ah(async (req, res) => {
    let list = listData(await db.collection(C.recordings).get());
    if (req.query.teacherId) list = list.filter((r) => r.teacherId === req.query.teacherId);
    if (req.query.q) {
      const q = String(req.query.q).toLowerCase();
      list = list.filter((r) => `${r.title} ${r.subject}`.toLowerCase().includes(q));
    }
    const n = await names(list.flatMap((r) => [r.teacherId, ...(r.studentIds || [])]));
    res.json({ recordings: list.map((r) => shape(r, n)).sort((a, b) => (a.classStartAt < b.classStartAt ? 1 : -1)), retentionDays: config.recordingRetentionDays });
  })
);

router.get(
  "/admin/recordings/:id",
  ah(async (req, res) => {
    const snap = await db.collection(C.recordings).doc(req.params.id).get();
    if (!snap.exists) fail(404, "Recording not found");
    const r = { id: snap.id, ...snap.data() };
    const n = await names([r.teacherId, ...(r.studentIds || [])]);
    res.json({ recording: { ...shape(r, n), transcript: r.transcript || "" } });
  })
);

router.post(
  "/admin/recordings/:id/link",
  ah(async (req, res) => {
    const snap = await db.collection(C.recordings).doc(req.params.id).get();
    if (!snap.exists) fail(404, "Recording not found");
    const r = snap.data();
    const download = !!req.body?.download;
    await audit(req, download ? "recording.download" : "recording.view", { targetType: "recording", targetId: snap.id, summary: `${download ? "Downloaded" : "Played"} recording "${r.title}"` });
    res.json({ url: fileLink({ path: r.file.path, fileName: r.file.fileName, contentType: r.file.contentType, download }) });
  })
);

router.put(
  "/admin/recordings/:id/transcript",
  ah(async (req, res) => {
    const ref = db.collection(C.recordings).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) fail(404, "Recording not found");
    const transcript = str(req.body.transcript, 900000);
    // An admin's edit is kept – automatic transcription won't overwrite it any more
    await ref.update({ transcript, hasTranscript: !!transcript, transcriptStatus: transcript ? "done" : "none", transcriptEditedAt: nowIso(), updatedAt: nowIso() });
    await audit(req, "recording.transcript", { targetType: "recording", targetId: snap.id, summary: `Edited transcript of "${snap.data().title}"` });
    res.json({ ok: true });
  })
);

router.post(
  "/admin/recordings",
  fields,
  ah(async (req, res) => {
    try {
      const meetingId = str(req.body.meetingId, 60);
      let meeting = null;
      if (meetingId) {
        const ms = await db.collection(C.meetings).doc(meetingId).get();
        if (!ms.exists) fail(404, "Class not found");
        meeting = { id: ms.id, ...ms.data() };
      }
      const r = await storeRecording(meeting, req.files?.file?.[0], req.files?.transcript?.[0], "upload");
      await audit(req, "recording.upload", { targetType: "recording", targetId: r.id, summary: `Uploaded recording for "${r.title}"` });
      res.status(201).json({ id: r.id });
    } finally {
      cleanupTmp(req);
    }
  })
);

router.delete(
  "/admin/recordings/:id",
  ah(async (req, res) => {
    const ref = db.collection(C.recordings).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) fail(404, "Recording not found");
    await deleteStored([snap.data().file?.path]);
    await ref.delete();
    // Transcript pieces go too, unless another recording of the same class still needs them
    const mid = snap.data().meetingId;
    if (mid && (await db.collection(C.recordings).where("meetingId", "==", mid).limit(1).get()).empty) await deleteParts(mid).catch(() => {});
    await audit(req, "recording.delete", { targetType: "recording", targetId: snap.id, summary: `Deleted recording "${snap.data().title}"` });
    res.json({ ok: true });
  })
);

// ---- Ingest from a script/tool (shared secret, no user login) -----------------------
ingestRouter.post(
  "/recordings/ingest",
  (req, res, next) => {
    const secret = req.headers["x-ingest-secret"];
    if (!config.recordingIngestSecret || secret !== config.recordingIngestSecret) return res.status(401).json({ error: "Invalid ingest secret" });
    next();
  },
  fields,
  ah(async (req, res) => {
    try {
      const roomName = str(req.body.roomName, 120).split("@")[0];
      const qs = await db.collection(C.meetings).where("roomName", "==", roomName).limit(1).get();
      const meeting = qs.empty ? null : { id: qs.docs[0].id, ...qs.docs[0].data() };
      if (!meeting) fail(404, `No class found for room ${roomName}`);
      const r = await storeRecording(meeting, req.files?.file?.[0], req.files?.transcript?.[0], "upload");
      await logActivity(null, "recording.ingest", { actor: { id: null, name: "Recording ingest", role: "system" }, targetType: "recording", targetId: r.id, summary: `Recording received for "${meeting.title}"` });
      res.status(201).json({ id: r.id });
    } finally {
      cleanupTmp(req);
    }
  })
);

// ---- LiveKit webhook (signed with the API secret) ------------------------------------
// Point LiveKit's webhook config at <API_PUBLIC_URL>/api/portal/livekit/webhook.
// When an egress (recording) finishes, the file is picked up from LIVEKIT_RECORDINGS_DIR.
ingestRouter.post(
  "/livekit/webhook",
  express.raw({ type: "*/*", limit: "1mb" }),
  ah(async (req, res) => {
    let event;
    try {
      event = await webhookReceiver.receive(req.body.toString("utf8"), req.get("Authorization"));
    } catch {
      return res.status(401).json({ error: "Invalid webhook signature" });
    }
    res.json({ ok: true });

    // Auto-record: start when the teacher (or an admin) joins a class room. If that
    // attempt fails (e.g. nobody was publishing yet), any later published track
    // tries again while a teacher/admin is in the room.
    const roleOf = (p) => p?.attributes?.role || (() => { try { return JSON.parse(p?.metadata || "{}").role; } catch { return null; } })();
    const isRecorder = (p) => String(p?.identity || "").startsWith("EG_") || p?.kind === 2; // the egress recorder itself
    const isClassRoom = event.room && String(event.room.name).startsWith(config.livekit.roomPrefix);
    let shouldRecord = false;
    if (isClassRoom && event.participant && !isRecorder(event.participant)) {
      if (event.event === "participant_joined") cancelStopWhenEmpty(event.room.name);
      // Last person left: finish the recording instead of filming an empty room
      if (event.event === "participant_left") stopWhenEmpty(event.room.name);
    }
    if (isClassRoom && event.event === "participant_joined" && event.participant) {
      shouldRecord = !isRecorder(event.participant) && ["teacher", "admin"].includes(roleOf(event.participant));
    } else if (isClassRoom && event.event === "track_published" && !isRecorder(event.participant) && config.livekit.egressEnabled && config.livekit.autoRecord) {
      const people = await roomService.listParticipants(event.room.name).catch(() => []);
      shouldRecord = people.some((p) => !isRecorder(p) && ["teacher", "admin"].includes(roleOf(p)));
      // Transcript: capture this person's microphone on its own
      try {
        const mq = await db.collection(C.meetings).where("roomName", "==", event.room.name).limit(1).get();
        const meeting = mq.empty ? null : { id: mq.docs[0].id, ...mq.docs[0].data() };
        await captureMicrophone({ roomName: event.room.name, track: event.track, participant: event.participant, meeting, role: roleOf(event.participant) });
      } catch (e) {
        console.error("Couldn't start transcript capture in", event.room.name, "-", e.message);
      }
    }
    if (shouldRecord) {
      try {
        const r = await ensureRecording(event.room.name);
        if (r?.started) {
          const qs = await db.collection(C.meetings).where("roomName", "==", event.room.name).limit(1).get();
          if (!qs.empty) {
            await qs.docs[0].ref.update({ egressId: r.egressId, recordingStartedAt: nowIso() });
            await logActivity(null, "class.record_start", { actor: { id: null, name: "Auto-record", role: "system" }, targetType: "meeting", targetId: qs.docs[0].id, summary: `Recording started for "${qs.docs[0].data().title}"` });
          }
        }
      } catch (e) {
        console.error("Auto-record failed for", event.room.name, "-", e.message);
      }
      return;
    }
    if (event.event !== "egress_ended" || !event.egressInfo) return;
    const info = event.egressInfo;
    // A microphone capture for the transcript, not the class video
    if (await handleCaptureEnded(info).catch((e) => (console.error("Transcript capture error", e.message), false))) return;
    const roomName = info.roomName;
    const qs = await db.collection(C.meetings).where("roomName", "==", roomName).limit(1).get();
    const meeting = qs.empty ? null : { id: qs.docs[0].id, ...qs.docs[0].data() };
    if (meeting?.egressId === info.egressId) await db.collection(C.meetings).doc(meeting.id).update({ egressId: null });
    // Started early for a host who then never came in – nothing worth keeping
    if (isDiscarded(info.egressId)) {
      for (const fr of info.fileResults || []) {
        const local = localRecordingPath(fr.filename || fr.location);
        if (local) await fs.promises.unlink(local).catch(() => {});
      }
      const manifest = localRecordingPath(`${config.livekit.egressOutputDir}/${info.egressId}.json`);
      if (manifest) fs.promises.unlink(manifest).catch(() => {});
      return;
    }
    // Egress also writes <egressId>.json next to the video – not needed once processed
    const manifest = localRecordingPath(`${config.livekit.egressOutputDir}/${info.egressId}.json`);
    if (manifest) fs.promises.unlink(manifest).catch(() => {});
    for (const fr of info.fileResults || []) {
      const local = localRecordingPath(fr.filename || fr.location);
      if (!local || !fs.existsSync(local)) {
        console.warn("LiveKit recording finished but the file isn't readable here:", fr.filename || fr.location);
        continue;
      }
      try {
        const size = (await fs.promises.stat(local)).size;
        const ns = (v) => (v ? Number(BigInt(v) / 1000000n) : null);
        const r = await storeRecording(meeting, { path: local, originalname: path.basename(local), size }, null, "livekit", { startedAt: ns(fr.startedAt || info.startedAt), endedAt: ns(fr.endedAt || info.endedAt) });
        if (meeting?.id) await refreshMeeting(meeting.id).catch((e) => console.error("Transcript merge failed", e.message));
        await notifyAdmins({ type: "recording_ready", title: `Recording ready: ${meeting?.title || "class"}`, body: "The class video is in Recordings (kept for 7 days).", link: "/portal/admin/recordings", refId: r.id }, "recordings").catch(() => {});
        await logActivity(null, "recording.ingest", { actor: { id: null, name: "LiveKit", role: "system" }, targetType: "recording", targetId: r.id, summary: `Recording received for "${meeting?.title || roomName}"` });
        await fs.promises.unlink(local).catch(() => {});
      } catch (e) {
        console.error("Failed to store LiveKit recording", local, e.message);
      }
    }
  })
);

export default router;
