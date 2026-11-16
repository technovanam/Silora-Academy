// ============================================================================
// CLASSES (MEETINGS), LIVEKIT JOIN + HOST CONTROLS, SCHEDULE CHANGE REQUESTS
// Meeting links are only given to the assigned teacher, the class's students
// and admins with the "classes" permission (Mandatory rule 4).
// ============================================================================
import crypto from "crypto";
import { Router } from "express";
import config from "../config.js";
import { db, C } from "../firebase.js";
import { ah, fail, nowIso, str, toIso, addMinutes, addDays, listData, getMany } from "../util.js";
import { TrackType } from "livekit-server-sdk";
import { joinToken, roomService, startRecording, stopRecording, activeRecording, prewarmRecording, realPeople } from "../services/livekit.js";
import * as lobby from "../services/lobby.js";
import { requireRole } from "../middleware.js";
import { hasPerm, getUser, logActivity, audit } from "../services/core.js";
import { notify, notifyAdmins } from "../services/notify.js";

const router = Router();
export const MAX_GROUP = 5;
const JOIN_EARLY_MIN = 15;
const JOIN_LATE_MIN = 30;

const fmt = (iso) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: config.timezone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

function effectiveStatus(m) {
  if (m.status === "scheduled" && m.endAt < nowIso()) return "completed";
  return m.status;
}

function canSeeAll(user) {
  return hasPerm(user, "classes");
}
function canAccess(user, m) {
  if (user.role === "admin") return canSeeAll(user);
  if (user.role === "teacher") return m.teacherId === user.id;
  if (user.role === "student") return (m.studentIds || []).includes(user.id);
  return false;
}

// ---- Shareable class links (Google Meet style: /portal/join/abc-defg-hij) ---------
const CODE_CHARS = "abcdefghijkmnopqrstuvwxyz";
export function newJoinCode() {
  const pick = (n) => Array.from(crypto.randomBytes(n), (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
  return `${pick(3)}-${pick(4)}-${pick(3)}`;
}
const joinUrl = (code) => (code ? `${config.portalUrl}/portal/join/${code}` : null);
const validCode = (c) => /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(String(c || ""));

// Older classes were created before links existed – give them one
async function ensureCodes(meetings) {
  const missing = meetings.filter((m) => !m.joinCode);
  for (const m of missing) {
    m.joinCode = newJoinCode();
    await db.collection(C.meetings).doc(m.id).update({ joinCode: m.joinCode }).catch(() => {});
  }
}

// Shape a meeting for the viewer (students never see other students)
function shape(m, viewer, names) {
  const base = {
    id: m.id,
    title: m.title,
    subject: m.subject || "",
    teacherId: m.teacherId,
    teacherName: names[m.teacherId] || m.teacherName || "Teacher",
    startAt: m.startAt,
    endAt: m.endAt,
    durationMin: m.durationMin,
    status: effectiveStatus(m),
    notes: m.notes || "",
    seriesId: m.seriesId || null,
    isGroup: (m.studentIds || []).length > 1,
    studentCount: (m.studentIds || []).length,
    cancelledReason: m.cancelledReason || null,
    previousStartAt: m.previousStartAt || null,
    hasRecording: viewer.role === "admin" && !!m.hasRecording, // recordings are admin-only
  };
  if (viewer.role !== "student") {
    base.studentIds = m.studentIds || [];
    base.students = (m.studentIds || []).map((id) => ({ id, name: names[id] || "Student" }));
    base.pendingRequest = m.pendingRequest || null;
    // Teachers and admins can share the class link (students still ask to join)
    base.joinCode = m.joinCode || null;
    base.joinUrl = joinUrl(m.joinCode);
    base.autoAdmit = !!m.autoAdmit;
  }
  return base;
}

async function loadScoped(user) {
  let qs;
  if (user.role === "admin") {
    if (!canSeeAll(user)) fail(403, "Your admin account doesn't have the classes permission");
    qs = await db.collection(C.meetings).get();
  } else if (user.role === "teacher") qs = await db.collection(C.meetings).where("teacherId", "==", user.id).get();
  else qs = await db.collection(C.meetings).where("studentIds", "array-contains", user.id).get();
  return listData(qs);
}

async function namesFor(meetings) {
  const ids = meetings.flatMap((m) => [m.teacherId, ...(m.studentIds || [])]);
  const users = await getMany(db, C.users, ids);
  return Object.fromEntries(Object.values(users).map((u) => [u.id, u.name]));
}

async function validateStudents(teacherId, studentIds) {
  const ids = [...new Set((studentIds || []).map((s) => str(s, 60)).filter(Boolean))];
  if (!ids.length) fail(400, "Choose at least one student");
  if (ids.length > MAX_GROUP) fail(400, `A class can have at most ${MAX_GROUP} students`);
  const users = await getMany(db, C.users, ids);
  for (const id of ids) {
    const s = users[id];
    if (!s || s.role !== "student" || s.deletedAt) fail(400, "One of the selected students was not found");
    if (s.teacherId !== teacherId) fail(400, `${s.name} is not assigned to this teacher`);
    if (!s.active) fail(400, `${s.name}'s account is deactivated`);
  }
  return ids;
}

async function assertNoClash(teacherId, startAt, endAt, ignoreId) {
  const qs = await db.collection(C.meetings).where("teacherId", "==", teacherId).get();
  const clash = listData(qs).find((m) => m.id !== ignoreId && m.status === "scheduled" && m.startAt < endAt && m.endAt > startAt);
  if (clash) fail(409, `The teacher already has "${clash.title}" at ${fmt(clash.startAt)}`);
}

const roomName = () => `${config.livekit.roomPrefix}-${crypto.randomBytes(9).toString("hex")}`;

// ---- List / calendar ------------------------------------------------------------
router.get(
  "/meetings",
  ah(async (req, res) => {
    let list = await loadScoped(req.user);
    const from = req.query.from ? toIso(req.query.from) : null;
    const to = req.query.to ? toIso(req.query.to) : null;
    if (from) list = list.filter((m) => m.endAt >= from);
    if (to) list = list.filter((m) => m.startAt <= to);
    if (req.query.teacherId && req.user.role === "admin") list = list.filter((m) => m.teacherId === req.query.teacherId);
    if (req.query.studentId && req.user.role !== "student") list = list.filter((m) => (m.studentIds || []).includes(req.query.studentId));
    if (req.user.role !== "student") await ensureCodes(list.filter((m) => m.status === "scheduled"));
    const names = await namesFor(list);
    let shaped = list.map((m) => shape(m, req.user, names));
    if (req.query.status) shaped = shaped.filter((m) => m.status === req.query.status);
    shaped.sort((a, b) => (a.startAt < b.startAt ? -1 : 1));
    res.json({ meetings: shaped });
  })
);

router.get(
  "/meetings/:id",
  ah(async (req, res) => {
    const snap = await db.collection(C.meetings).doc(req.params.id).get();
    if (!snap.exists) fail(404, "Class not found");
    const m = { id: snap.id, ...snap.data() };
    if (!canAccess(req.user, m)) fail(404, "Class not found");
    if (req.user.role !== "student") await ensureCodes([m]);
    const names = await namesFor([m]);
    res.json({ meeting: shape(m, req.user, names) });
  })
);

// ---- Create (teacher for own students, admin for any teacher) -----------------
router.post(
  "/meetings",
  requireRole("teacher", "admin"),
  ah(async (req, res) => {
    if (req.user.role === "admin" && !canSeeAll(req.user)) fail(403, "Your admin account doesn't have the classes permission");
    const teacherId = req.user.role === "teacher" ? req.user.id : str(req.body.teacherId, 60);
    const teacher = await getUser(teacherId);
    if (!teacher || teacher.role !== "teacher" || teacher.deletedAt) fail(400, "Choose a teacher");
    const studentIds = await validateStudents(teacherId, req.body.studentIds);
    const title = str(req.body.title, 120);
    if (!title) fail(400, "Give the class a title");
    const durationMin = Math.round(Number(req.body.durationMin || 60));
    if (!(durationMin >= 15 && durationMin <= 240)) fail(400, "Duration must be between 15 and 240 minutes");
    const firstStart = toIso(req.body.startAt);
    if (!firstStart) fail(400, "Choose a date and time");
    if (firstStart < addMinutes(new Date(), -5).toISOString()) fail(400, "The class time is in the past");
    const repeatWeeks = Math.min(Math.max(Math.round(Number(req.body.repeatWeeks || 1)), 1), 12);
    const seriesId = repeatWeeks > 1 ? crypto.randomUUID() : null;

    const created = [];
    for (let i = 0; i < repeatWeeks; i++) {
      const startAt = addDays(firstStart, i * 7).toISOString();
      const endAt = addMinutes(startAt, durationMin).toISOString();
      await assertNoClash(teacherId, startAt, endAt);
      created.push({
        title,
        subject: str(req.body.subject, 80),
        notes: str(req.body.notes, 1000),
        teacherId,
        studentIds,
        startAt,
        endAt,
        durationMin,
        status: "scheduled",
        roomName: roomName(),
        joinCode: newJoinCode(),
        seriesId,
        createdBy: req.user.id,
        createdByRole: req.user.role,
        createdAt: nowIso(),
      });
    }
    const batch = db.batch();
    const ids = created.map((m) => {
      const ref = db.collection(C.meetings).doc();
      batch.set(ref, m);
      return ref.id;
    });
    await batch.commit();

    const when = repeatWeeks > 1 ? `${fmt(firstStart)} (weekly × ${repeatWeeks})` : fmt(firstStart);
    await notify(studentIds, { type: "class_scheduled", title: `New class: ${title}`, body: `With ${teacher.name} on ${when}.`, link: "/portal/student/classes", refId: ids[0] });
    if (req.user.role === "admin") await notify([teacherId], { type: "class_scheduled", title: `New class: ${title}`, body: `Scheduled on ${when}.`, link: "/portal/teacher/calendar", refId: ids[0] });
    else await notifyAdmins({ type: "class_scheduled_admin", title: `${teacher.name} scheduled a class`, body: `"${title}" on ${when} with ${studentIds.length} student${studentIds.length > 1 ? "s" : ""}.`, link: "/portal/admin/classes", refId: ids[0] }, "classes");
    await logActivity(req, "class.create", { targetType: "meeting", targetId: ids[0], summary: `Scheduled "${title}" on ${when}` });
    res.status(201).json({ ids });
  })
);

// ---- Update ---------------------------------------------------------------------
router.patch(
  "/meetings/:id",
  requireRole("teacher", "admin"),
  ah(async (req, res) => {
    const ref = db.collection(C.meetings).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) fail(404, "Class not found");
    const m = { id: snap.id, ...snap.data() };
    if (!canAccess(req.user, m)) fail(404, "Class not found");
    if (m.status !== "scheduled") fail(400, "Only scheduled classes can be edited");

    const update = {};
    if ("title" in req.body) update.title = str(req.body.title, 120) || m.title;
    if ("subject" in req.body) update.subject = str(req.body.subject, 80);
    if ("notes" in req.body) update.notes = str(req.body.notes, 1000);
    const teacherId = req.user.role === "admin" && req.body.teacherId ? str(req.body.teacherId, 60) : m.teacherId;
    if (req.body.studentIds) update.studentIds = await validateStudents(teacherId, req.body.studentIds);
    if (teacherId !== m.teacherId) {
      update.teacherId = teacherId;
      if (!req.body.studentIds) await validateStudents(teacherId, m.studentIds);
    }

    let rescheduled = false;
    if (req.user.role === "admin" && (req.body.startAt || req.body.durationMin)) {
      const startAt = req.body.startAt ? toIso(req.body.startAt) : m.startAt;
      const durationMin = Math.round(Number(req.body.durationMin || m.durationMin));
      if (!(durationMin >= 15 && durationMin <= 240)) fail(400, "Duration must be between 15 and 240 minutes");
      const endAt = addMinutes(startAt, durationMin).toISOString();
      await assertNoClash(teacherId, startAt, endAt, m.id);
      if (startAt !== m.startAt) {
        rescheduled = true;
        update.previousStartAt = m.startAt;
        update.reminderSentAt = null;
      }
      Object.assign(update, { startAt, endAt, durationMin });
    } else if (req.user.role === "teacher" && (req.body.startAt || req.body.durationMin)) {
      fail(403, "To change the time, send a reschedule request to the admin");
    }
    update.updatedAt = nowIso();
    await ref.update(update);

    const after = { ...m, ...update };
    if (rescheduled) {
      await notify([...after.studentIds, after.teacherId], {
        type: "class_rescheduled",
        title: `Class rescheduled: ${after.title}`,
        body: `Moved from ${fmt(m.startAt)} to ${fmt(after.startAt)}.`,
        link: "/portal",
        refId: m.id,
      });
    }
    await logActivity(req, "class.update", { targetType: "meeting", targetId: m.id, summary: `Updated "${after.title}"` });
    res.json({ ok: true });
  })
);

async function cancelMeeting(req, m, reason) {
  await db.collection(C.meetings).doc(m.id).update({ status: "cancelled", cancelledReason: reason || "", cancelledAt: nowIso(), cancelledBy: req.user.id, pendingRequest: null });
  await notify([...(m.studentIds || []), m.teacherId], {
    type: "class_cancelled",
    title: `Class cancelled: ${m.title}`,
    body: `${fmt(m.startAt)}${reason ? ` – ${reason}` : ""}`,
    link: "/portal",
    refId: m.id,
  });
}

router.post(
  "/meetings/:id/cancel",
  requireRole("admin"),
  ah(async (req, res) => {
    if (!canSeeAll(req.user)) fail(403, "Your admin account doesn't have the classes permission");
    const snap = await db.collection(C.meetings).doc(req.params.id).get();
    if (!snap.exists) fail(404, "Class not found");
    const m = { id: snap.id, ...snap.data() };
    if (m.status !== "scheduled") fail(400, "This class is not scheduled");
    await cancelMeeting(req, m, str(req.body.reason, 300));
    await audit(req, "class.cancel", { targetType: "meeting", targetId: m.id, summary: `Cancelled "${m.title}" (${fmt(m.startAt)})` });
    res.json({ ok: true });
  })
);

router.delete(
  "/meetings/:id",
  requireRole("admin"),
  ah(async (req, res) => {
    if (!canSeeAll(req.user)) fail(403, "Your admin account doesn't have the classes permission");
    const snap = await db.collection(C.meetings).doc(req.params.id).get();
    if (!snap.exists) fail(404, "Class not found");
    await snap.ref.delete();
    await audit(req, "class.delete", { targetType: "meeting", targetId: snap.id, summary: `Deleted class "${snap.data().title}"` });
    res.json({ ok: true });
  })
);

// ---- Join (LiveKit) ---------------------------------------------------------------
// Hosts (the class's teacher, admins with the classes permission) go straight in.
// Everyone else – the class's students, or anyone who opened the shared link – asks
// to join and waits in the lobby until a host lets them in.
async function loadForRoom(req) {
  const snap = await db.collection(C.meetings).doc(req.params.id).get();
  if (!snap.exists) fail(404, "Class not found");
  const m = { id: snap.id, ...snap.data() };
  if (!canAccess(req.user, m)) fail(404, "Class not found");
  return m;
}
const isHost = (user, m) => (user.role === "admin" && canSeeAll(user)) || (user.role === "teacher" && m.teacherId === user.id);

// Like loadForRoom, but a valid class link also lets other portal users ask to join
async function loadForJoin(req) {
  const snap = await db.collection(C.meetings).doc(req.params.id).get();
  if (!snap.exists) fail(404, "Class not found");
  const m = { id: snap.id, ...snap.data() };
  const code = String(req.query.code || req.body?.code || "");
  const viaLink = validCode(code) && m.joinCode === code;
  if (!canAccess(req.user, m) && !viaLink) fail(404, "Class not found");
  const host = isHost(req.user, m);
  const enrolled = req.user.role === "student" && (m.studentIds || []).includes(req.user.id);
  return { m, host, enrolled };
}

function checkWindow(req, m, host) {
  if (m.status === "cancelled") fail(400, "This class was cancelled");
  const now = Date.now();
  const opens = new Date(m.startAt).getTime() - JOIN_EARLY_MIN * 60000;
  const closes = new Date(m.endAt).getTime() + JOIN_LATE_MIN * 60000;
  const anyTime = req.user.role === "admin" && host;
  if (!anyTime && now < opens) fail(400, `You can join from ${JOIN_EARLY_MIN} minutes before the class starts`, "too_early");
  if (!anyTime && now > closes) fail(400, "This class has ended", "ended");
  return { now, opens, closes };
}

const displayNameOf = (user) => (user.role === "teacher" ? `${user.name} (Teacher)` : user.role === "admin" ? `${user.name} (Admin)` : user.name);

async function joinPayload(req, m, host, { closes, now }) {
  const displayName = displayNameOf(req.user);
  // Hosts get a token for the whole class. Others get a short one – LiveKit keeps
  // renewing it while they're connected, and someone who was removed can't reuse it.
  const ttlSec = host ? Math.max(3600, Math.floor((closes - now) / 1000) + 3600) : 15 * 60;
  const token = await joinToken({ roomName: m.roomName, identity: req.user.id, name: displayName, role: req.user.role, ttlSec, host });
  return {
    url: config.livekit.url,
    token,
    roomName: m.roomName,
    displayName,
    isHost: host,
    // Recording is automatic and visible to admins only
    isAdmin: req.user.role === "admin",
    canRecord: req.user.role === "admin" && host && config.livekit.egressEnabled,
    ...(req.user.role === "admin" ? { recordingEnabled: config.livekit.egressEnabled && config.livekit.autoRecord } : {}),
    ...(host ? { joinUrl: joinUrl(m.joinCode), joinCode: m.joinCode || null } : {}),
    meeting: { id: m.id, title: m.title, subject: m.subject, startAt: m.startAt, endAt: m.endAt },
  };
}

// Start the recorder while the host is still on the "Ready to join?" screen, so the
// recording is already running when they walk in (the recorder needs ~15 s to start).
function prewarm(m) {
  prewarmRecording(m.roomName)
    .then(async (r) => {
      if (!r?.started) return;
      await db.collection(C.meetings).doc(m.id).update({ egressId: r.egressId, recordingStartedAt: nowIso() });
      await logActivity(null, "class.record_start", { actor: { id: null, name: "Auto-record", role: "system" }, targetType: "meeting", targetId: m.id, summary: `Recording started for "${m.title}"` });
    })
    .catch((e) => console.error("Couldn't start recording early for", m.roomName, "-", e.message));
}

// Is a host in the room right now? (cached briefly – the lobby polls this)
const hostCache = new Map();
async function hostPresent(roomName) {
  const c = hostCache.get(roomName);
  if (c && Date.now() - c.at < 3000) return c.v;
  const v = (await realPeople(roomName)).some((p) => p.attributes?.host === "true");
  hostCache.set(roomName, { v, at: Date.now() });
  return v;
}

// Find a class from its shared link
router.get(
  "/meetings/code/:code",
  ah(async (req, res) => {
    const code = String(req.params.code || "").toLowerCase();
    if (!validCode(code)) fail(404, "This class link isn't valid");
    const qs = await db.collection(C.meetings).where("joinCode", "==", code).limit(1).get();
    if (qs.empty) fail(404, "This class link isn't valid. Check it with your teacher.");
    const m = { id: qs.docs[0].id, ...qs.docs[0].data() };
    if (m.status === "cancelled") fail(400, "This class was cancelled");
    res.json({ id: m.id, code });
  })
);

router.get(
  "/meetings/:id/join",
  ah(async (req, res) => {
    const { m, host, enrolled } = await loadForJoin(req);
    const win = checkWindow(req, m, host);
    if (host) {
      if (win.now >= win.opens && win.now <= win.closes) prewarm(m);
      await logActivity(req, "class.join", { targetType: "meeting", targetId: m.id, summary: `Joined "${m.title}"` });
      return res.json(await joinPayload(req, m, host, win));
    }
    // Already let in once (e.g. the connection dropped): straight back in
    const entry = lobby.entryFor(m.id, req.user.id);
    if (entry?.status === "admitted") return res.json({ ...(await joinPayload(req, m, false, win)), admitted: true });
    res.json({
      needsAdmission: true,
      enrolled,
      displayName: displayNameOf(req.user),
      isHost: false,
      hostPresent: await hostPresent(m.roomName),
      meeting: { id: m.id, title: m.title, subject: m.subject, startAt: m.startAt, endAt: m.endAt },
    });
  })
);

// Ask to join / check the answer / stop asking
router.post(
  "/meetings/:id/knock",
  ah(async (req, res) => {
    const { m, host, enrolled } = await loadForJoin(req);
    checkWindow(req, m, host);
    if (host) return res.json({ status: "admitted" });
    const prev = lobby.entryFor(m.id, req.user.id);
    if (prev?.status === "denied" && prev.denials >= 3 && Date.now() - prev.decidedAt < 10 * 60000) fail(429, "Your request was declined several times. Contact your teacher.", "blocked");
    const e = m.autoAdmit && enrolled ? lobby.admit(m.id, req.user, { enrolled }) : lobby.requestEntry(m.id, req.user, { enrolled });
    if (e.status === "waiting" && prev?.status !== "waiting") await logActivity(req, "class.knock", { targetType: "meeting", targetId: m.id, summary: `Asked to join "${m.title}"` });
    res.json({ status: e.status });
  })
);

router.get(
  "/meetings/:id/knock",
  ah(async (req, res) => {
    const { m, host } = await loadForJoin(req);
    const win = checkWindow(req, m, host);
    const e = lobby.touch(m.id, req.user.id);
    if (!e) return res.json({ status: "none" });
    if (e.status === "admitted") return res.json({ status: "admitted", join: await joinPayload(req, m, false, win) });
    res.json({ status: e.status, hostPresent: await hostPresent(m.roomName) });
  })
);

router.delete(
  "/meetings/:id/knock",
  ah(async (req, res) => {
    const { m } = await loadForJoin(req);
    lobby.cancelEntry(m.id, req.user.id);
    res.json({ ok: true });
  })
);

// Host: who is waiting, admit / deny, and "let this class's students in without asking"
router.get(
  "/meetings/:id/lobby",
  requireRole("teacher", "admin"),
  ah(async (req, res) => {
    const m = await loadForRoom(req);
    if (!isHost(req.user, m)) fail(403, "Only the class's teacher can see who's waiting");
    res.json({
      waiting: lobby.waiting(m.id).map((e) => ({ userId: e.userId, name: e.name, role: e.role, enrolled: e.enrolled, requestedAt: new Date(e.requestedAt).toISOString() })),
      autoAdmit: !!m.autoAdmit,
    });
  })
);

router.post(
  "/meetings/:id/lobby",
  requireRole("teacher", "admin"),
  ah(async (req, res) => {
    const m = await loadForRoom(req);
    if (!isHost(req.user, m)) fail(403, "Only the class's teacher can let people in");
    const { action, userId } = req.body || {};
    if (action === "admit" || action === "deny") {
      const e = lobby.decide(m.id, str(userId, 60), action === "admit");
      if (!e) fail(404, "That person is no longer waiting");
      await logActivity(req, `class.${action}`, { targetType: "meeting", targetId: m.id, summary: `${action === "admit" ? "Let" : "Turned away"} ${e.name} ${action === "admit" ? "into" : "from"} "${m.title}"` });
    } else if (action === "admitAll") {
      const list = lobby.waiting(m.id);
      list.forEach((e) => lobby.decide(m.id, e.userId, true));
      if (list.length) await logActivity(req, "class.admit", { targetType: "meeting", targetId: m.id, summary: `Let ${list.length} people into "${m.title}"` });
    } else if (action === "autoAdmit") {
      await db.collection(C.meetings).doc(m.id).update({ autoAdmit: !!req.body.value });
    } else fail(400, "Unknown action");
    res.json({ ok: true });
  })
);

// ---- Host controls (teacher of the class, or admin) -------------------------------
router.post(
  "/meetings/:id/moderate",
  requireRole("teacher", "admin"),
  ah(async (req, res) => {
    const m = await loadForRoom(req);
    const { action, identity, trackSid } = req.body || {};
    const room = m.roomName;
    try {
      if (action === "mute") {
        if (!identity || !trackSid) fail(400, "Missing participant or track");
        await roomService.mutePublishedTrack(room, identity, trackSid, true);
      } else if (action === "muteAll") {
        const people = await roomService.listParticipants(room);
        await Promise.all(
          people
            .filter((p) => p.identity !== req.user.id && !String(p.metadata || "").includes('"host":true'))
            .flatMap((p) => p.tracks.filter((t) => t.type === TrackType.AUDIO && !t.muted).map((t) => roomService.mutePublishedTrack(room, p.identity, t.sid, true).catch(() => {})))
        );
      } else if (action === "lowerHand") {
        if (!identity) fail(400, "Missing participant");
        await roomService.updateParticipant(room, identity, { attributes: { hand: "" } });
      } else if (action === "remove") {
        if (!identity) fail(400, "Missing participant");
        if (identity === req.user.id) fail(400, "You can't remove yourself");
        await roomService.removeParticipant(room, identity);
        lobby.forget(m.id, identity); // must ask again to come back
        await audit(req, "class.remove_participant", { targetType: "meeting", targetId: m.id, summary: `Removed a participant from "${m.title}"` });
      } else if (action === "end") {
        if (m.egressId) await stopRecording(room, m.egressId);
        await roomService.deleteRoom(room);
        lobby.clearLobby(m.id);
        await db.collection(C.meetings).doc(m.id).update({ egressId: null });
        await logActivity(req, "class.end", { targetType: "meeting", targetId: m.id, summary: `Ended "${m.title}" for everyone` });
      } else fail(400, "Unknown action");
    } catch (e) {
      if (e.status) throw e;
      fail(502, "The video server didn't accept that action. Is LiveKit running?");
    }
    res.json({ ok: true });
  })
);

// Manual start/stop – admins only (classes are recorded automatically)
router.post(
  "/meetings/:id/recording",
  requireRole("admin"),
  ah(async (req, res) => {
    if (!config.livekit.egressEnabled) fail(400, "Recording isn't set up on this server yet (LiveKit Egress)");
    const m = await loadForRoom(req);
    const start = req.body?.action !== "stop";
    try {
      if (start) {
        const running = await activeRecording(m.roomName).catch(() => null);
        if (running) return res.json({ recording: true });
        const egressId = await startRecording(m.roomName);
        await db.collection(C.meetings).doc(m.id).update({ egressId, recordingStartedAt: nowIso() });
        await logActivity(req, "class.record_start", { targetType: "meeting", targetId: m.id, summary: `Started recording "${m.title}"` });
      } else {
        await stopRecording(m.roomName, m.egressId || (await activeRecording(m.roomName).catch(() => null)));
        await db.collection(C.meetings).doc(m.id).update({ egressId: null });
        await logActivity(req, "class.record_stop", { targetType: "meeting", targetId: m.id, summary: `Stopped recording "${m.title}"` });
      }
    } catch (e) {
      if (e.status) throw e;
      fail(502, "Couldn't reach the recording service (LiveKit Egress)");
    }
    res.json({ recording: start });
  })
);

// Is this class being recorded right now? (admins only)
router.get(
  "/meetings/:id/recording",
  requireRole("admin"),
  ah(async (req, res) => {
    const m = await loadForRoom(req);
    if (!config.livekit.egressEnabled) return res.json({ enabled: false, recording: false });
    const egressId = await activeRecording(m.roomName).catch(() => null);
    res.json({ enabled: true, autoRecord: config.livekit.autoRecord, recording: !!egressId });
  })
);

// ---- Schedule change requests -----------------------------------------------------
router.get(
  "/schedule-requests",
  requireRole("teacher", "admin"),
  ah(async (req, res) => {
    let qs;
    if (req.user.role === "admin") {
      if (!canSeeAll(req.user)) fail(403, "Your admin account doesn't have the classes permission");
      qs = await db.collection(C.scheduleRequests).get();
    } else qs = await db.collection(C.scheduleRequests).where("teacherId", "==", req.user.id).get();
    let list = listData(qs);
    if (req.query.status) list = list.filter((r) => r.status === req.query.status);
    const meetings = await getMany(db, C.meetings, list.map((r) => r.meetingId));
    const names = await namesFor(Object.values(meetings).concat(list.map((r) => ({ teacherId: r.teacherId, studentIds: [] }))));
    res.json({
      requests: list
        .map((r) => ({ ...r, teacherName: names[r.teacherId], meeting: meetings[r.meetingId] ? shape(meetings[r.meetingId], req.user, names) : null }))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    });
  })
);

router.post(
  "/schedule-requests",
  requireRole("teacher"),
  ah(async (req, res) => {
    const snap = await db.collection(C.meetings).doc(str(req.body.meetingId, 60)).get();
    if (!snap.exists) fail(404, "Class not found");
    const m = { id: snap.id, ...snap.data() };
    if (m.teacherId !== req.user.id) fail(404, "Class not found");
    if (m.status !== "scheduled" || m.endAt < nowIso()) fail(400, "Only upcoming classes can be changed");
    if (m.pendingRequest) fail(409, "There's already a pending request for this class");
    const type = req.body.type === "cancel" ? "cancel" : req.body.type === "reschedule" ? "reschedule" : null;
    if (!type) fail(400, "Choose cancel or reschedule");
    const reason = str(req.body.reason, 500);
    if (!reason) fail(400, "Please add a reason");
    const doc = { meetingId: m.id, teacherId: req.user.id, type, reason, status: "pending", createdAt: nowIso() };
    if (type === "reschedule") {
      doc.proposedStartAt = toIso(req.body.proposedStartAt);
      if (!doc.proposedStartAt || doc.proposedStartAt < nowIso()) fail(400, "Choose a new date and time in the future");
      doc.proposedDurationMin = Math.round(Number(req.body.proposedDurationMin || m.durationMin));
    }
    const ref = await db.collection(C.scheduleRequests).add(doc);
    await snap.ref.update({ pendingRequest: { id: ref.id, type } });
    await notifyAdmins(
      {
        type: "schedule_request",
        title: `${type === "cancel" ? "Cancellation" : "Reschedule"} request`,
        body: `${req.user.name} asked to ${type} "${m.title}" (${fmt(m.startAt)}). Reason: ${reason}`,
        link: "/portal/admin/schedule-requests",
        refId: ref.id,
      },
      "classes"
    );
    await logActivity(req, "class.request", { targetType: "meeting", targetId: m.id, summary: `Requested to ${type} "${m.title}"` });
    res.status(201).json({ id: ref.id });
  })
);

router.post(
  "/schedule-requests/:id/decide",
  requireRole("admin"),
  ah(async (req, res) => {
    if (!canSeeAll(req.user)) fail(403, "Your admin account doesn't have the classes permission");
    const rref = db.collection(C.scheduleRequests).doc(req.params.id);
    const rs = await rref.get();
    if (!rs.exists) fail(404, "Request not found");
    const r = { id: rs.id, ...rs.data() };
    if (r.status !== "pending") fail(400, "This request was already decided");
    const ms = await db.collection(C.meetings).doc(r.meetingId).get();
    const m = ms.exists ? { id: ms.id, ...ms.data() } : null;
    const approve = req.body.decision === "approve";
    const note = str(req.body.note, 500);

    if (approve && m) {
      if (r.type === "cancel") await cancelMeeting(req, m, r.reason);
      else {
        const startAt = r.proposedStartAt;
        const durationMin = r.proposedDurationMin || m.durationMin;
        const endAt = addMinutes(startAt, durationMin).toISOString();
        await assertNoClash(m.teacherId, startAt, endAt, m.id);
        await ms.ref.update({ startAt, endAt, durationMin, previousStartAt: m.startAt, reminderSentAt: null, pendingRequest: null, updatedAt: nowIso() });
        await notify([...(m.studentIds || []), m.teacherId], {
          type: "class_rescheduled",
          title: `Class rescheduled: ${m.title}`,
          body: `Moved from ${fmt(m.startAt)} to ${fmt(startAt)}.`,
          link: "/portal",
          refId: m.id,
        });
      }
    } else if (m) {
      await ms.ref.update({ pendingRequest: null });
      await notify([r.teacherId], {
        type: "schedule_decision",
        title: `Request declined: ${m.title}`,
        body: note || `Your ${r.type} request was declined.`,
        link: "/portal/teacher/classes",
        refId: r.id,
      });
    }
    await rref.update({ status: approve ? "approved" : "rejected", decidedBy: req.user.id, decidedAt: nowIso(), note });
    await audit(req, `class.request_${approve ? "approved" : "rejected"}`, { targetType: "scheduleRequest", targetId: r.id, summary: `${approve ? "Approved" : "Rejected"} ${r.type} request for "${m?.title || "class"}"` });
    res.json({ ok: true });
  })
);

export default router;
