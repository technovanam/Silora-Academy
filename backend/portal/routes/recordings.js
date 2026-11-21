// ============================================================================
// CLASS RECORDINGS – recorded in the teacher's browser, no outside service.
//
// The teacher's browser mixes what the class sees and hears into one video
// and uploads it in pieces straight into the project's Firebase Storage
// (a resumable upload made by this API, so the browser never gets any key).
// Everyone in the class sees a "Recording" sign while it runs.
//
// Watching: admins with the "recordings" permission. Recordings are deleted
// automatically RECORDING_RETENTION_DAYS after the class, and a new recording
// can't start once RECORDING_STORAGE_CAP_GB is used, so storage stays inside
// the free Firebase allowance.
// ============================================================================
import crypto from "crypto";
import { Router } from "express";
import config from "../config.js";
import { db, C, bucket } from "../firebase.js";
import { ah, fail, nowIso, addDays, listData, getMany, str } from "../util.js";
import { requireRole, requirePerm } from "../middleware.js";
import { audit, logActivity } from "../services/core.js";
import { canAccess } from "./meetings.js";

const router = Router();
const GB = 1024 ** 3;
const CHUNK = 4 * 1024 * 1024; // the browser uploads in 4 MiB pieces (a multiple of 256 KiB)
const MAX_HOURS = 4;
const roomRef = (id) => db.collection(C.liveRooms).doc(id);

// Origins allowed to upload (the resumable upload answers only this origin)
const allowedOrigins = () => {
  const base = new Set([config.portalUrl]);
  if (/\.web\.app$/.test(config.portalUrl)) base.add(config.portalUrl.replace(/\.web\.app$/, ".firebaseapp.com"));
  return base;
};

async function usedBytes() {
  const list = listData(await db.collection(C.recordings).get());
  return list.reduce((n, r) => n + (r.size || 0), 0);
}

// Recordings made by the old system (before 2026-11-19) keep the file under file.path
const pathOf = (r) => r.path || r.file?.path || "";
const norm = (r) => ({
  ...r,
  path: pathOf(r),
  status: r.status || (pathOf(r) ? "ready" : "failed"),
  startedAt: r.startedAt || r.createdAt || r.classStartAt || "",
  size: r.size || r.file?.size || 0,
  contentType: r.contentType || r.file?.contentType || "video/webm",
});

function playUrl(r) {
  const p = encodeURIComponent(r.path);
  const host = config.useEmulators ? `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}` : "https://firebasestorage.googleapis.com";
  return `${host}/v0/b/${bucket.name}/o/${p}?alt=media&token=${r.token}`;
}

// Ask the upload how many bytes it has (GCS resumable protocol)
async function uploadStatus(uri) {
  const r = await fetch(uri, { method: "PUT", headers: { "Content-Range": "bytes */*", "Content-Length": "0" } });
  if (r.status === 200 || r.status === 201) return { done: true };
  if (r.status === 308) {
    const m = /bytes=0-(\d+)/.exec(r.headers.get("range") || "");
    return { done: false, bytes: m ? Number(m[1]) + 1 : 0 };
  }
  return { gone: true, status: r.status };
}

/** Finish a recording: close the upload if the browser couldn't, then make it playable. */
async function finishRecording(id, { durationSec } = {}) {
  const ref = db.collection(C.recordings).doc(id);
  const r = (await ref.get()).data();
  if (!r || r.status !== "recording") return r;
  let failed = false;
  // The local Storage emulator takes each upload in one piece and can't report progress
  if (!config.useEmulators) try {
    const st = await uploadStatus(r.uploadUri);
    if (st.gone) failed = true;
    else if (!st.done) {
      if (!st.bytes) failed = true;
      else {
        const fin = await fetch(r.uploadUri, { method: "PUT", headers: { "Content-Range": `bytes */${st.bytes}`, "Content-Length": "0" } });
        if (fin.status !== 200 && fin.status !== 201) failed = true;
      }
    }
  } catch {
    failed = true;
  }
  const file = bucket.file(r.path);
  const [exists] = failed ? [false] : await file.exists();
  if (!exists) {
    await ref.update({ status: "failed", endedAt: nowIso(), uploadUri: null });
    return { ...r, status: "failed" };
  }
  const token = crypto.randomUUID();
  await file.setMetadata({ contentType: "video/webm", metadata: { firebaseStorageDownloadTokens: token } });
  const [meta] = await file.getMetadata();
  const endedAt = nowIso();
  const fields = {
    status: "ready",
    endedAt,
    durationSec: Number(durationSec) > 0 ? Math.round(Number(durationSec)) : Math.round((Date.parse(endedAt) - Date.parse(r.startedAt)) / 1000),
    size: Number(meta.size) || 0,
    token,
    uploadUri: null,
  };
  await ref.update(fields);
  await db.collection(C.meetings).doc(r.meetingId).update({ hasRecording: true }).catch(() => {});
  return { ...r, ...fields };
}

// ---- Teacher (the host of a running class) ------------------------------------------
async function loadHost(req) {
  const snap = await db.collection(C.meetings).doc(req.params.id).get();
  if (!snap.exists) fail(404, "Class not found");
  const m = { id: snap.id, ...snap.data() };
  if (!canAccess(req.user, m)) fail(404, "Class not found");
  const room = (await roomRef(m.id).get()).data();
  if (room?.status !== "live" || room.hostId !== req.user.id) fail(403, "Only the person running this class can record it", "not_host");
  return { m, room };
}

router.post(
  "/meetings/:id/live/recording/start",
  ah(async (req, res) => {
    const { m, room } = await loadHost(req);
    if (room.recording?.id) {
      // A recording that this browser lost (page reloaded): close it and start a new one
      await finishRecording(room.recording.id).catch(() => {});
    }
    const cap = config.recordingStorageCapGb * GB;
    if ((await usedBytes()) >= cap) fail(400, `Recording storage is full (${config.recordingStorageCapGb} GB). Ask an admin to delete old recordings.`, "storage_full");
    const origin = allowedOrigins().has(req.headers.origin) ? req.headers.origin : config.portalUrl;

    const ref = db.collection(C.recordings).doc();
    const day = (m.startAt || nowIso()).slice(0, 10);
    const path = `recordings/${day}/${ref.id}.webm`;
    const [uploadUri] = await bucket.file(path).createResumableUpload({ origin, metadata: { contentType: "video/webm" } });
    const teacher = (await db.collection(C.users).doc(m.teacherId).get()).data();
    const startedAt = nowIso();
    await ref.set({
      meetingId: m.id,
      title: m.title,
      subject: m.subject || "",
      teacherId: m.teacherId,
      teacherName: teacher?.name || "",
      studentIds: m.studentIds || [],
      classStartAt: m.startAt || startedAt,
      startedAt,
      startedBy: req.user.id,
      startedByName: req.user.name,
      status: "recording",
      path,
      uploadUri,
      size: 0,
      createdAt: startedAt,
      deleteAt: addDays(m.startAt || startedAt, config.recordingRetentionDays).toISOString(),
    });
    await roomRef(m.id).update({ recording: { id: ref.id, startedAt, by: req.user.name } });
    await logActivity(req, "class.recording_start", { targetType: "meeting", targetId: m.id, summary: `Started recording "${m.title}"` });
    // (the local emulator only accepts an upload in one go, so the browser keeps it all until the end)
    res.json({ id: ref.id, uploadUrl: uploadUri, chunkBytes: config.useEmulators ? 1024 * CHUNK : CHUNK, maxHours: MAX_HOURS });
  })
);

router.post(
  "/meetings/:id/live/recording/:rid/stop",
  ah(async (req, res) => {
    const snap = await db.collection(C.recordings).doc(req.params.rid).get();
    const r = snap.data();
    if (!r || r.meetingId !== req.params.id) fail(404, "Recording not found");
    if (r.startedBy !== req.user.id) fail(403, "Only the person who started the recording can stop it");
    const done = await finishRecording(snap.id, { durationSec: req.body?.durationSec });
    const room = (await roomRef(r.meetingId).get()).data();
    if (room?.recording?.id === snap.id) await roomRef(r.meetingId).update({ recording: null });
    await logActivity(req, "class.recording_stop", { targetType: "meeting", targetId: r.meetingId, summary: `Stopped recording "${r.title}"` });
    res.json({ status: done?.status || "failed" });
  })
);

/**
 * Scheduled / end of class: close recordings whose browser went away
 * (tab closed, crashed), so what was uploaded is kept.
 */
export async function finishAbandonedRecordings(meetingId) {
  let q = db.collection(C.recordings).where("status", "==", "recording");
  if (meetingId) q = q.where("meetingId", "==", meetingId);
  const list = listData(await q.get());
  let n = 0;
  for (const r of list) {
    const room = (await roomRef(r.meetingId).get()).data();
    const stillOn = room?.status === "live" && room.recording?.id === r.id;
    const tooLong = Date.now() - Date.parse(r.startedAt) > (MAX_HOURS + 1) * 3600000;
    if (stillOn && !tooLong && !meetingId) continue;
    await finishRecording(r.id).catch((e) => console.error("finish recording failed", e.message));
    if (room?.recording?.id === r.id) await roomRef(r.meetingId).update({ recording: null }).catch(() => {});
    n++;
  }
  return n;
}

/** Delete recordings past their retention period (hourly job). */
export async function cleanupRecordings() {
  const qs = await db.collection(C.recordings).where("deleteAt", "<=", nowIso()).get();
  for (const d of qs.docs) {
    const r = norm(d.data());
    if (r.status === "recording") continue;
    if (r.path) await bucket.file(r.path).delete({ ignoreNotFound: true }).catch(() => {});
    await d.ref.delete();
    await db.collection(C.audit).add({ at: nowIso(), actorId: null, actorName: "System", action: "recording.auto_delete", targetType: "recording", targetId: d.id, summary: `Auto-deleted the recording of "${d.data().title}" after ${config.recordingRetentionDays} days` });
  }
  return qs.size;
}

// ---- Admin ----------------------------------------------------------------------------
const shape = (r, n) => ({
  id: r.id,
  meetingId: r.meetingId,
  title: r.title,
  subject: r.subject,
  teacherName: r.teacherName || n[r.teacherId] || "",
  students: (r.studentIds || []).map((id) => n[id] || "Student"),
  classStartAt: r.classStartAt,
  startedAt: r.startedAt,
  endedAt: r.endedAt || null,
  durationSec: r.durationSec || 0,
  size: r.size || 0,
  status: r.status,
  startedByName: r.startedByName || "",
  deleteAt: r.deleteAt,
});

router.use("/admin/recordings", requireRole("admin"), requirePerm("recordings"));

router.get(
  "/admin/recordings",
  ah(async (req, res) => {
    let list = listData(await db.collection(C.recordings).get()).map(norm);
    if (req.query.meetingId) list = list.filter((r) => r.meetingId === req.query.meetingId);
    const n = Object.fromEntries(Object.values(await getMany(db, C.users, [...new Set(list.flatMap((r) => [r.teacherId, ...(r.studentIds || [])]))])).map((u) => [u.id, u.name]));
    const used = list.reduce((s, r) => s + (r.size || 0), 0);
    res.json({
      recordings: list.map((r) => shape(r, n)).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)),
      retentionDays: config.recordingRetentionDays,
      usedBytes: used,
      capBytes: config.recordingStorageCapGb * GB,
    });
  })
);

router.get(
  "/admin/recordings/:rid/url",
  ah(async (req, res) => {
    const snap = await db.collection(C.recordings).doc(str(req.params.rid, 60)).get();
    const r = snap.exists ? norm(snap.data()) : null;
    if (!r || r.status !== "ready" || !r.path) fail(404, "This recording isn't ready");
    if (!r.token) {
      // An older recording without a playback link yet: make one
      const file = bucket.file(r.path);
      if (!(await file.exists())[0]) fail(404, "The video file of this recording is missing");
      r.token = crypto.randomUUID();
      await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: r.token } });
      await snap.ref.update({ token: r.token });
    }
    await audit(req, "recording.view", { targetType: "recording", targetId: snap.id, summary: `Watched the recording of "${r.title}"` }).catch(() => {});
    const ext = /mp4/.test(r.contentType) || /\.mp4$/i.test(r.path) ? "mp4" : "webm";
    res.json({ url: playUrl(r), fileName: `${String(r.title || "").replace(/[^\w\- ]+/g, "").trim() || "class"} ${String(r.startedAt).slice(0, 10)}.${ext}` });
  })
);

router.delete(
  "/admin/recordings/:rid",
  ah(async (req, res) => {
    const ref = db.collection(C.recordings).doc(str(req.params.rid, 60));
    const snap = await ref.get();
    if (!snap.exists) fail(404, "Recording not found");
    const r = norm(snap.data());
    if (r.status === "recording") fail(400, "This class is still being recorded");
    if (r.path) await bucket.file(r.path).delete({ ignoreNotFound: true }).catch(() => {});
    await ref.delete();
    await audit(req, "recording.delete", { targetType: "recording", targetId: ref.id, summary: `Deleted the recording of "${r.title}"` }).catch(() => {});
    res.json({ ok: true });
  })
);

export default router;
