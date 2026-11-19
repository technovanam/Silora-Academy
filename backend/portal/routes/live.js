// ============================================================================
// LIVE CLASSES – our own meeting, no third-party video service.
// Video and sound go straight between browsers (WebRTC). This API decides who
// may be in a class and keeps attendance; the browsers exchange their
// connection details through Firestore (liveRooms/*, see firestore.rules).
//
// liveRooms/{meetingId}                 status idle | live | ended, hostId, sessionId…
//   people/{uid}                        waiting | in | left | denied | removed, attendance
//   signals/{uid}                       connection offer (host) / answer (participant)
//   chat/{id}                           messages during the class
//
// The host is the class's teacher (or an admin with the classes permission
// when the teacher isn't there). Students wait until the host lets them in.
// ============================================================================
import { Router } from "express";
import { db, C } from "../firebase.js";
import { ah, fail, nowIso, newId, str, listData, getMany } from "../util.js";
import { canAccess, canSeeAll } from "./meetings.js";
import { logActivity } from "../services/core.js";

const router = Router();
export const OPEN_EARLY_MIN = 15; // the class can be opened this long before the start
const OPEN_LATE_MIN = 60; // …and until this long after the end
export const PING_SEC = 120; // browsers in a class check in this often
const STALE_MS = 6 * 60 * 1000; // no check-in for this long → treated as gone

const roomRef = (id) => db.collection(C.liveRooms).doc(id);
const peopleOf = (id) => roomRef(id).collection("people");
const sec = (a, b) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000));
const displayName = (u) => (u.role === "teacher" ? `${u.name} (Teacher)` : u.role === "admin" ? `${u.name} (Admin)` : u.name);

async function loadMeeting(req) {
  const snap = await db.collection(C.meetings).doc(req.params.id).get();
  if (!snap.exists) fail(404, "Class not found");
  const m = { id: snap.id, ...snap.data() };
  if (!canAccess(req.user, m)) fail(404, "Class not found");
  return m;
}

// Who runs the class: its teacher, or an admin with the classes permission
const mayHost = (user, m) => (user.role === "teacher" && m.teacherId === user.id) || (user.role === "admin" && canSeeAll(user));

function checkWindow(user, m) {
  if (m.status === "cancelled") fail(400, "This class was cancelled", "cancelled");
  if (user.role === "admin") return; // admins can open a class at any time
  const now = Date.now();
  const opens = new Date(m.startAt).getTime() - OPEN_EARLY_MIN * 60000;
  const closes = new Date(m.endAt).getTime() + OPEN_LATE_MIN * 60000;
  if (now < opens) fail(400, `The class opens ${OPEN_EARLY_MIN} minutes before it starts`, "too_early");
  if (now > closes) fail(400, "This class has finished", "finished");
}

const meetingInfo = (m, teacherName) => ({ id: m.id, title: m.title, subject: m.subject || "", teacherName, startAt: m.startAt, endAt: m.endAt });

// Close an open stretch of time in the class (leave, removal, end, gone quiet)
function closeFields(p, at) {
  if (!p.openSince) return {};
  const end = at < p.openSince ? p.openSince : at;
  return { openSince: null, lastLeftAt: end, totalSec: (p.totalSec || 0) + sec(p.openSince, end) };
}
function openFields(p, now, sessionId) {
  return {
    status: "in",
    openSince: p.openSince || now,
    firstJoinedAt: p.firstJoinedAt || now,
    joins: (p.joins || 0) + (p.openSince ? 0 : 1),
    admittedSession: sessionId,
    lastSeenAt: now,
    hand: false,
  };
}

async function refreshCount(meetingId) {
  const agg = await peopleOf(meetingId).where("status", "==", "in").count().get();
  await roomRef(meetingId).update({ inClass: agg.data().count }).catch(() => {});
}

// People whose browser stopped checking in: close their time at the last check-in
async function sweepStale(meetingId) {
  const cutoff = new Date(Date.now() - STALE_MS).toISOString();
  const list = listData(await peopleOf(meetingId).where("status", "==", "in").get()).filter((p) => (p.lastSeenAt || "") < cutoff);
  for (const p of list) await peopleOf(meetingId).doc(p.id).update({ status: "left", ...closeFields(p, p.lastSeenAt || nowIso()) });
  if (list.length) await refreshCount(meetingId);
}

// ---- Class info before joining ----------------------------------------------------
router.get(
  "/meetings/:id/live",
  ah(async (req, res) => {
    const m = await loadMeeting(req);
    const room = (await roomRef(m.id).get()).data() || null;
    const teacher = (await db.collection(C.users).doc(m.teacherId).get()).data();
    const hostHere = room?.status === "live";
    // An admin only hosts when the teacher hasn't opened the class
    const asHost = mayHost(req.user, m) && (req.user.role === "teacher" || !hostHere || room.hostId === req.user.id);
    let windowError = null;
    try {
      checkWindow(req.user, m);
    } catch (e) {
      windowError = { message: e.message, code: e.code };
    }
    res.json({ meeting: meetingInfo(m, teacher?.name || "Teacher"), role: asHost ? "host" : "participant", live: hostHere, windowError, pingSec: PING_SEC });
  })
);

// ---- Enter: the host opens the class; everyone else asks to join -------------------
router.post(
  "/meetings/:id/live/enter",
  ah(async (req, res) => {
    const m = await loadMeeting(req);
    checkWindow(req.user, m);
    const now = nowIso();
    const ref = roomRef(m.id);
    const room = (await ref.get()).data() || null;
    const live = room?.status === "live";
    const host = mayHost(req.user, m) && (req.user.role === "teacher" || !live || room.hostId === req.user.id);
    const meRef = peopleOf(m.id).doc(req.user.id);
    const me = (await meRef.get()).data() || {};
    const base = { uid: req.user.id, name: displayName(req.user), role: req.user.role };

    if (host) {
      let sessionId = room?.sessionId;
      if (!live) {
        // New session: anyone still marked "in" from an earlier session is closed off
        sessionId = newId();
        const stale = listData(await peopleOf(m.id).where("status", "==", "in").get());
        for (const p of stale) await peopleOf(m.id).doc(p.id).update({ status: "left", ...closeFields(p, p.lastSeenAt || now) });
      }
      await ref.set(
        {
          meetingId: m.id,
          title: m.title,
          status: "live",
          sessionId,
          hostId: req.user.id,
          hostName: displayName(req.user),
          startedAt: live ? room.startedAt : now,
          endedAt: null,
          speakers: live && room.hostId === req.user.id ? room.speakers || [null, null] : [null, null],
          screen: false,
          hostCam: false,
          hostMic: false,
        },
        { merge: true }
      );
      await meRef.set({ ...base, ...openFields(me, now, sessionId), isHost: true, canSpeak: true, canVideo: true }, { merge: true });
      await refreshCount(m.id);
      if (!live) await logActivity(req, "class.live_start", { targetType: "meeting", targetId: m.id, summary: `Started the live class "${m.title}"` });
      return res.json({ role: "host", sessionId });
    }

    // Participant
    if (!room) await ref.set({ meetingId: m.id, title: m.title, status: "idle", hostId: null, sessionId: null, inClass: 0 }, { merge: true });
    if (live && me.status === "removed" && me.removedSession === room.sessionId) fail(403, "The teacher removed you from this class", "removed");
    const staff = req.user.role !== "student";
    const rejoin = live && me.admittedSession === room.sessionId; // was let in earlier this session
    if (live && (staff || rejoin)) {
      await meRef.set({ ...base, ...openFields(me, now, room.sessionId), isHost: false, canSpeak: staff, canVideo: staff }, { merge: true });
      await refreshCount(m.id);
      return res.json({ role: "participant", status: "in" });
    }
    await meRef.set({ ...base, status: "waiting", requestedAt: now, isHost: false, canSpeak: false, canVideo: false, hand: false, openSince: me.openSince || null, totalSec: me.totalSec || 0 }, { merge: true });
    res.json({ role: "participant", status: "waiting" });
  })
);

async function loadAsHost(req) {
  const m = await loadMeeting(req);
  const room = (await roomRef(m.id).get()).data();
  if (room?.status !== "live" || room.hostId !== req.user.id) fail(403, "Only the person running this class can do this", "not_host");
  return { m, room };
}

// ---- Host: let in / turn away (one person or everyone waiting) ---------------------
router.post(
  "/meetings/:id/live/admit",
  ah(async (req, res) => {
    const { m, room } = await loadAsHost(req);
    const now = nowIso();
    const allow = req.body.allow !== false;
    const ids = req.body.all ? listData(await peopleOf(m.id).where("status", "==", "waiting").get()).map((p) => p.id) : [str(req.body.userId, 60)];
    let n = 0;
    for (const uid of ids) {
      const ref = peopleOf(m.id).doc(uid);
      const p = (await ref.get()).data();
      if (!p || p.status !== "waiting") continue;
      await ref.update(allow ? openFields(p, now, room.sessionId) : { status: "denied", deniedAt: now });
      n++;
    }
    await refreshCount(m.id);
    res.json({ ok: true, count: n });
  })
);

// ---- Host: remove someone from the class -------------------------------------------
router.post(
  "/meetings/:id/live/remove",
  ah(async (req, res) => {
    const { m, room } = await loadAsHost(req);
    const uid = str(req.body.userId, 60);
    if (uid === req.user.id) fail(400, "You can't remove yourself");
    const ref = peopleOf(m.id).doc(uid);
    const p = (await ref.get()).data();
    if (!p) fail(404, "Not in this class");
    await ref.update({ status: "removed", removedSession: room.sessionId, canSpeak: false, canVideo: false, hand: false, ...closeFields(p, nowIso()) });
    await roomRef(m.id).collection("signals").doc(uid).delete().catch(() => {});
    await refreshCount(m.id);
    await logActivity(req, "class.live_remove", { targetType: "meeting", targetId: m.id, summary: `Removed ${p.name} from "${m.title}"` });
    res.json({ ok: true });
  })
);

// ---- Leave (also sent by the browser when the tab closes) ---------------------------
router.post(
  "/meetings/:id/live/leave",
  ah(async (req, res) => {
    const m = await loadMeeting(req);
    const ref = peopleOf(m.id).doc(req.user.id);
    const p = (await ref.get()).data();
    if (p && (p.status === "in" || p.status === "waiting")) {
      await ref.update({ status: "left", hand: false, ...closeFields(p, nowIso()) });
      await roomRef(m.id).collection("signals").doc(req.user.id).delete().catch(() => {});
      await refreshCount(m.id);
    }
    res.json({ ok: true });
  })
);

// ---- Check-in every PING_SEC while the class page is open --------------------------
router.post(
  "/meetings/:id/live/ping",
  ah(async (req, res) => {
    const m = await loadMeeting(req);
    const room = (await roomRef(m.id).get()).data();
    const ref = peopleOf(m.id).doc(req.user.id);
    const p = (await ref.get()).data();
    if (p?.status === "in") await ref.update({ lastSeenAt: nowIso() });
    if (room?.status === "live" && room.hostId === req.user.id) await sweepStale(m.id);
    res.json({ status: room?.status || "idle", me: p?.status || null });
  })
);

// ---- Host: end the class for everyone ------------------------------------------------
export async function endRoom(meetingId, at = nowIso()) {
  const ref = roomRef(meetingId);
  const people = listData(await peopleOf(meetingId).get());
  for (const p of people) {
    // Someone whose browser went quiet is counted until their last check-in
    const gone = p.lastSeenAt && Date.now() - new Date(p.lastSeenAt).getTime() > STALE_MS;
    if (p.status === "in") await peopleOf(meetingId).doc(p.id).update({ status: "left", hand: false, ...closeFields(p, gone ? p.lastSeenAt : at) });
    else if (p.status === "waiting") await peopleOf(meetingId).doc(p.id).update({ status: "left" });
  }
  const signals = await ref.collection("signals").get();
  for (const d of signals.docs) await d.ref.delete();
  await ref.update({ status: "ended", endedAt: at, inClass: 0, speakers: [null, null], screen: false });
}

router.post(
  "/meetings/:id/live/end",
  ah(async (req, res) => {
    const { m } = await loadAsHost(req);
    await endRoom(m.id);
    await db.collection(C.meetings).doc(m.id).update({ liveEndedAt: nowIso(), hadLiveClass: true }).catch(() => {});
    await logActivity(req, "class.live_end", { targetType: "meeting", targetId: m.id, summary: `Ended the live class "${m.title}"` });
    res.json({ ok: true });
  })
);

// ---- Attendance (teacher of the class and admins) -----------------------------------
router.get(
  "/meetings/:id/live/attendance",
  ah(async (req, res) => {
    const m = await loadMeeting(req);
    if (req.user.role === "student") fail(403, "Only teachers and admins can see class attendance");
    const room = (await roomRef(m.id).get()).data() || null;
    const people = listData(await peopleOf(m.id).get());
    const byId = Object.fromEntries(people.map((p) => [p.id, p]));
    const students = await getMany(db, C.users, m.studentIds || []);
    const now = nowIso();
    const minutes = (p) => Math.round(((p?.totalSec || 0) + (p?.openSince ? sec(p.openSince, now) : 0)) / 60);
    const rows = (m.studentIds || []).map((id) => {
      const p = byId[id];
      return { userId: id, name: students[id]?.name || p?.name || "Student", joined: !!p?.firstJoinedAt, firstJoinedAt: p?.firstJoinedAt || null, lastLeftAt: p?.lastLeftAt || null, minutes: minutes(p), inClassNow: p?.status === "in" && room?.status === "live" };
    });
    const others = people.filter((p) => !(m.studentIds || []).includes(p.id) && p.firstJoinedAt).map((p) => ({ userId: p.id, name: p.name, role: p.role, minutes: minutes(p) }));
    res.json({ started: !!room?.startedAt, live: room?.status === "live", startedAt: room?.startedAt || null, endedAt: room?.endedAt || null, students: rows, others });
  })
);

// ---- Scheduled clean-up: end classes left open long after their end time -----------
export async function closeForgottenRooms() {
  const live = listData(await db.collection(C.liveRooms).where("status", "==", "live").get());
  let n = 0;
  for (const r of live) {
    const m = (await db.collection(C.meetings).doc(r.id).get()).data();
    const endBy = m ? new Date(m.endAt).getTime() + 2 * 3600000 : 0;
    if (Date.now() > endBy) {
      await endRoom(r.id);
      n++;
    } else await sweepStale(r.id);
  }
  return n;
}

export default router;
