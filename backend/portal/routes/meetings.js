// ============================================================================
// CLASSES (SCHEDULE), SCHEDULE CHANGE REQUESTS
// Classes are visible only to the assigned teacher, the class's students and
// admins with the "classes" permission. Live classes are in routes/live.js.
// ============================================================================
import crypto from "crypto";
import { Router } from "express";
import config from "../config.js";
import { db, C } from "../firebase.js";
import { ah, fail, nowIso, str, toIso, addMinutes, addDays, listData, getMany } from "../util.js";
import { requireRole } from "../middleware.js";
import { hasPerm, getUser, logActivity, audit, assignmentProblem, canonicalSubject, sameSubject } from "../services/core.js";
import { notify, notifyAdmins } from "../services/notify.js";
import { closeLeavesForMeeting } from "../services/lifecycle.js";
import { recomputeForMeeting } from "../services/teacherPayments.js";

const router = Router();
export const MAX_GROUP = config.maxClassSize;

const fmt = (iso) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: config.timezone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

function effectiveStatus(m) {
  if (m.status === "scheduled" && m.endAt < nowIso()) return "completed";
  return m.status;
}

export function canSeeAll(user) {
  return hasPerm(user, "classes");
}
export function canAccess(user, m) {
  if (user.role === "admin") return canSeeAll(user);
  if (user.role === "teacher") return m.teacherId === user.id;
  if (user.role === "student") return (m.studentIds || []).includes(user.id);
  if (user.role === "guest") return !!m.isDemo && m.id === user.meetingId; // demo guest link
  return false;
}

// Shape a meeting for the viewer (students never see other students)
function shape(m, viewer, names) {
  const base = {
    id: m.id,
    title: m.title,
    subject: m.subject || "",
    isDemo: !!m.isDemo,
    demoInfo: m.isDemo ? m.demoInfo || null : undefined,
    teacherId: m.teacherId,
    teacherName: names[m.teacherId] || m.teacherName || "Teacher",
    startAt: m.startAt,
    endAt: m.endAt,
    durationMin: m.durationMin,
    status: effectiveStatus(m),
    notes: m.notes || "",
    seriesId: m.seriesId || null,
    sessionId: m.sessionId || null,
    isGroup: (m.studentIds || []).length > 1,
    studentCount: (m.studentIds || []).length,
    cancelledReason: m.cancelledReason || null,
    previousStartAt: m.previousStartAt || null,
  };
  if (viewer.role !== "student") {
    base.studentIds = m.studentIds || [];
    base.students = (m.studentIds || []).map((id) => ({ id, name: names[id] || "Student" }));
    base.pendingRequest = m.pendingRequest || null;
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

// A class can belong to an academic session (not archived; a teacher only to their own sessions)

async function validateStudents(teacherId, studentIds, subject = "") {
  const ids = [...new Set((studentIds || []).map((s) => str(s, 60)).filter(Boolean))];
  if (!ids.length) fail(400, "Choose at least one student");
  if (ids.length > MAX_GROUP) fail(400, `A class can have at most ${MAX_GROUP} students`);
  const users = await getMany(db, C.users, ids);
  for (const id of ids) {
    const s = users[id];
    if (!s || s.role !== "student" || s.deletedAt) fail(400, "One of the selected students was not found");
    const problem = assignmentProblem(s, teacherId, subject);
    if (problem) fail(400, problem);
    if (!s.active) fail(400, `${s.name}'s account is deactivated`);
  }
  return ids;
}

// No two scheduled classes at the same time for the teacher, or for any of the students
export async function assertNoClash(teacherId, startAt, endAt, ignoreId, studentIds = []) {
  const live = (m) => m.id !== ignoreId && m.status === "scheduled" && m.startAt < endAt && m.endAt > startAt;
  const qs = await db.collection(C.meetings).where("teacherId", "==", teacherId).get();
  const clash = listData(qs).find(live);
  if (clash) fail(409, `The teacher already has "${clash.title}" at ${fmt(clash.startAt)}`);
  const ids = [...new Set(studentIds)].filter(Boolean);
  for (let i = 0; i < ids.length; i += 30) {
    const ss = await db.collection(C.meetings).where("studentIds", "array-contains-any", ids.slice(i, i + 30)).get();
    const hit = listData(ss).find(live);
    if (hit) {
      const who = (await getMany(db, C.users, hit.studentIds.filter((x) => ids.includes(x)).slice(0, 1)))[hit.studentIds.find((x) => ids.includes(x))];
      fail(409, `${who?.name || "A student"} already has "${hit.title}"${hit.subject ? ` (${hit.subject})` : ""} at ${fmt(hit.startAt)}`);
    }
  }
}

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
    if (teacher.active === false) fail(400, `${teacher.name}'s account is deactivated – choose another teacher or activate the account first`);
    // The subject comes from the academy's list; it decides which session the class counts towards
    const subject = await canonicalSubject(req.body.subject);
    const studentIds = await validateStudents(teacherId, req.body.studentIds, subject);
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
      await assertNoClash(teacherId, startAt, endAt, undefined, studentIds);
      created.push({
        title,
        subject,
        notes: str(req.body.notes, 1000),
        teacherId,
        studentIds,
        startAt,
        endAt,
        durationMin,
        status: "scheduled",
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
    if (m.isDemo) fail(400, "Demo classes are managed under Demo requests", "demo");
    if (!canAccess(req.user, m)) fail(404, "Class not found");
    if (m.status !== "scheduled") fail(400, "Only scheduled classes can be edited");

    const update = {};
    if ("title" in req.body) update.title = str(req.body.title, 120) || m.title;
    if ("subject" in req.body) update.subject = await canonicalSubject(req.body.subject, { allowInactive: sameSubject(req.body.subject, m.subject) });
    if ("notes" in req.body) update.notes = str(req.body.notes, 1000);
    const teacherId = req.user.role === "admin" && req.body.teacherId ? str(req.body.teacherId, 60) : m.teacherId;
    const subject = "subject" in update ? update.subject : m.subject || "";
    if (req.body.studentIds) update.studentIds = await validateStudents(teacherId, req.body.studentIds, subject);
    // Same time, new students or a new teacher: they must be free then too
    if ((update.studentIds || teacherId !== m.teacherId) && !(req.user.role === "admin" && (req.body.startAt || req.body.durationMin)))
      await assertNoClash(teacherId, m.startAt, m.endAt, m.id, (update.studentIds || []).filter((x) => !(m.studentIds || []).includes(x)));
    if (teacherId !== m.teacherId) {
      const nt = await getUser(teacherId);
      if (!nt || nt.role !== "teacher" || nt.deletedAt) fail(400, "Choose a teacher");
      if (nt.active === false) fail(400, `${nt.name}'s account is deactivated – choose another teacher`);
      update.teacherId = teacherId;
      if (!req.body.studentIds) await validateStudents(teacherId, m.studentIds, subject);
    } else if (!req.body.studentIds && "subject" in update && update.subject !== (m.subject || "")) await validateStudents(teacherId, m.studentIds, subject);

    let rescheduled = false;
    if (req.user.role === "admin" && (req.body.startAt || req.body.durationMin)) {
      const startAt = req.body.startAt ? toIso(req.body.startAt) : m.startAt;
      const durationMin = Math.round(Number(req.body.durationMin || m.durationMin));
      if (!(durationMin >= 15 && durationMin <= 240)) fail(400, "Duration must be between 15 and 240 minutes");
      const endAt = addMinutes(startAt, durationMin).toISOString();
      await assertNoClash(teacherId, startAt, endAt, m.id, update.studentIds || m.studentIds || []);
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
    // A new date, subject or teacher can move the class into another session: recount both
    await recomputeForMeeting(after, m);
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
  await closeLeavesForMeeting(m.id);
  await recomputeForMeeting(m);
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
    if (m.isDemo) fail(400, "Demo classes are managed under Demo requests", "demo");
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
    await closeLeavesForMeeting(snap.id, "The class was deleted");
    await audit(req, "class.delete", { targetType: "meeting", targetId: snap.id, summary: `Deleted class "${snap.data().title}"` });
    res.json({ ok: true });
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
    const meetingId = str(req.body.meetingId, 60);
    if (!meetingId) fail(400, "Choose a class");
    const snap = await db.collection(C.meetings).doc(meetingId).get();
    if (!snap.exists) fail(404, "Class not found");
    const m = { id: snap.id, ...snap.data() };
    if (m.isDemo) fail(400, "Demo classes are managed under Demo requests", "demo");
    if (m.isDemo) fail(400, "Demo classes are managed under Demo requests", "demo");
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
  "/schedule-requests/:id/withdraw",
  requireRole("teacher"),
  ah(async (req, res) => {
    const rref = db.collection(C.scheduleRequests).doc(req.params.id);
    const r = (await rref.get()).data();
    if (!r || r.teacherId !== req.user.id) fail(404, "Request not found");
    if (r.status !== "pending") fail(400, "This request was already decided");
    await rref.update({ status: "withdrawn", decidedAt: nowIso() });
    await db.collection(C.meetings).doc(r.meetingId).update({ pendingRequest: null }).catch(() => {});
    await logActivity(req, "class.request_withdrawn", { targetType: "meeting", targetId: r.meetingId, summary: `Withdrew a ${r.type} request` });
    res.json({ ok: true });
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
        await assertNoClash(m.teacherId, startAt, endAt, m.id, m.studentIds || []);
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
