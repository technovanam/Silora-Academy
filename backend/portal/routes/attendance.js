// ============================================================================
// ATTENDANCE – class-wise, filled in by the TEACHER
//  • Every conducted class gets a form, pre-filled from the classroom's real
//    join/leave intervals (services/attendance.js). The teacher reviews it,
//    may change a status (with a remark), adds remarks and submits.
//  • Students see only their own records; admins (permission "attendance")
//    see everything, the teachers' pending forms, and can correct (audited).
//  • Leave: a student asks for leave for an upcoming class; an admin approves
//    or rejects it.
//  • LEGACY: the old weekly student self-report forms (collection
//    "attendance") are read-only for admins under /admin/attendance-legacy.
// ============================================================================
import { Router } from "express";
import config from "../config.js";
import { db, C } from "../firebase.js";
import { ah, fail, nowIso, str, listData, getMany, weekStartOf, shiftWeek, toCsv, localDateOf } from "../util.js";
import { requireRole, requirePerm } from "../middleware.js";
import { usersByRole, audit, logActivity, saveSettings, getSettings, teacherIdsOf, hasPerm } from "../services/core.js";
import { notify, notifyAdmins } from "../services/notify.js";
import { STATUSES, STATUS_LABEL, TEACHER_EDIT_DAYS, DEFAULT_RULES, ROW_FIELDS, CLASS_FIELDS, getRules, computeRows, formBase, isFormDue, summarize, flattenForms, submittedForms } from "../services/attendance.js";
import { sessionsForMeeting, meetingsOfSession, isHeld } from "../services/sessions.js";

const router = Router();
const formRef = (meetingId) => db.collection(C.classAttendance).doc(meetingId);
const fmt = (iso) => new Intl.DateTimeFormat("en-IN", { timeZone: config.timezone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

async function loadMeetingDoc(id) {
  const snap = await db.collection(C.meetings).doc(id).get();
  if (!snap.exists) fail(404, "Class not found");
  return { id: snap.id, ...snap.data() };
}
const inScope = (m, rules) => !m.isDemo && localDateOf(m.startAt) >= rules.formsFrom; // demo classes take no attendance

function filterRows(rows, q) {
  return rows.filter(
    (r) =>
      (!q.studentId || r.studentId === q.studentId) &&
      (!q.teacherId || r.teacherId === q.teacherId) &&
      (!q.subject || r.subject === q.subject) &&
      (!q.sessionId || r.sessionId === q.sessionId) &&
      (!q.status || r.status === q.status) &&
      (!q.from || r.date >= q.from) &&
      (!q.to || r.date <= q.to)
  );
}

function leaveCounts(list) {
  const live = list.filter((l) => l.status !== "cancelled");
  return { total: live.length, approved: live.filter((l) => l.status === "approved").length, rejected: live.filter((l) => l.status === "rejected").length, pending: live.filter((l) => l.status === "pending").length };
}

// Apply the teacher's / admin's statuses + remarks to freshly computed rows
// Teachers write only the teaching columns – the status always stays automatic.
// An admin may also correct the status (with a remark).
function applyEdits(rows, edits, { admin = false } = {}) {
  const by = Object.fromEntries((Array.isArray(edits) ? edits : []).map((e) => [str(e.studentId, 60), e]));
  return rows.map((r) => {
    const e = by[r.studentId];
    const text = Object.fromEntries(Object.entries(ROW_FIELDS).map(([k, max]) => [k, e && k in e ? str(e[k], max) : r[k] || ""]));
    const status = admin && e && STATUSES.includes(e.status) ? e.status : admin ? r.status : r.suggested;
    if (status !== r.suggested && !text.remarks) fail(400, `Add a remark for ${r.name}: the status was changed from "${STATUS_LABEL[r.suggested]}"`);
    return { ...r, ...text, status, overridden: status !== r.suggested };
  });
}

async function teacherName(id) {
  const t = (await db.collection(C.users).doc(id).get()).data();
  return t?.name || "";
}

// ============================================================================
// STUDENT
// ============================================================================
router.get(
  "/attendance/me",
  requireRole("student"),
  ah(async (req, res) => {
    const [forms, leaves] = await Promise.all([
      db.collection(C.classAttendance).where("studentIds", "array-contains", req.user.id).get().then(listData),
      db.collection(C.leaveRequests).where("studentId", "==", req.user.id).get().then(listData),
    ]);
    const all = flattenForms(forms.filter((f) => f.status === "submitted"), { studentId: req.user.id });
    const rows = filterRows(all, req.query);
    const subjects = [...new Set(all.map((r) => r.subject).filter(Boolean))].sort();
    const sessionNames = await getMany(db, C.sessions, all.map((r) => r.sessionId));
    const bySubject = subjects.map((s) => ({ subject: s, ...summarize(rows.filter((r) => r.subject === s)) }));
    res.json({
      rows: rows.map(({ suggested, overridden, formRemarks, ...r }) => r),
      summary: summarize(rows),
      bySubject,
      subjects,
      sessions: Object.values(sessionNames).map((s) => ({ id: s.id, name: s.name })),
      leaves: leaves.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map(shapeLeave),
      leaveCounts: leaveCounts(leaves),
    });
  })
);

// ---- Leave requests (student) ----------------------------------------------------------
const shapeLeave = (l) => ({
  id: l.id,
  meetingId: l.meetingId,
  classTitle: l.classTitle,
  subject: l.subject,
  classStartAt: l.classStartAt,
  date: l.date,
  reason: l.reason,
  remarks: l.remarks,
  status: l.status,
  decisionNote: l.decisionNote || "",
  decidedAt: l.decidedAt || null,
  createdAt: l.createdAt,
});

router.post(
  "/leave-requests",
  requireRole("student"),
  ah(async (req, res) => {
    const m = await loadMeetingDoc(str(req.body.meetingId, 60));
    if (!(m.studentIds || []).includes(req.user.id)) fail(404, "Class not found");
    if (m.status !== "scheduled") fail(400, "This class isn't scheduled any more");
    if (m.startAt <= nowIso()) fail(400, "Leave must be requested before the class starts. Please message your teacher or the academy.");
    const reason = str(req.body.reason, 1000);
    if (!reason) fail(400, "Tell us the reason for the leave");
    const existing = listData(await db.collection(C.leaveRequests).where("studentId", "==", req.user.id).get()).find((l) => l.meetingId === m.id && ["pending", "approved"].includes(l.status));
    if (existing) fail(409, existing.status === "approved" ? "Your leave for this class is already approved" : "You already asked for leave for this class");
    const at = nowIso();
    const doc = {
      studentId: req.user.id,
      studentName: req.user.name,
      teacherId: m.teacherId,
      meetingId: m.id,
      classTitle: m.title,
      subject: m.subject || "",
      classStartAt: m.startAt,
      sessionId: (await sessionsForMeeting(m))[req.user.id]?.id || null, // the student's session for this subject
      date: localDateOf(m.startAt),
      reason,
      remarks: str(req.body.remarks, 1000),
      status: "pending",
      createdAt: at,
      updatedAt: at,
      history: [{ at, by: req.user.id, byName: req.user.name, action: "submitted" }],
    };
    const ref = await db.collection(C.leaveRequests).add(doc);
    await logActivity(req, "leave.request", { targetType: "leaveRequest", targetId: ref.id, summary: `Asked for leave for "${m.title}" on ${fmt(m.startAt)}` });
    await notifyAdmins({ type: "leave_requested", title: `Leave request from ${req.user.name}`, body: `"${m.title}" on ${fmt(m.startAt)} – ${reason.slice(0, 120)}`, link: "/portal/admin/attendance?tab=leave", refId: ref.id }, "attendance");
    res.status(201).json({ id: ref.id });
  })
);

router.post(
  "/leave-requests/:id/cancel",
  requireRole("student"),
  ah(async (req, res) => {
    const ref = db.collection(C.leaveRequests).doc(req.params.id);
    const l = (await ref.get()).data();
    if (!l || l.studentId !== req.user.id) fail(404, "Leave request not found");
    if (l.status !== "pending") fail(400, "Only a request that's still waiting can be cancelled");
    const at = nowIso();
    await ref.update({ status: "cancelled", updatedAt: at, history: [...(l.history || []), { at, by: req.user.id, byName: req.user.name, action: "cancelled" }] });
    res.json({ ok: true });
  })
);

// ============================================================================
// TEACHER
// ============================================================================
router.get(
  "/teacher/attendance",
  requireRole("teacher"),
  ah(async (req, res) => {
    const rules = await getRules();
    const [meetings, forms] = await Promise.all([
      db.collection(C.meetings).where("teacherId", "==", req.user.id).get().then(listData),
      db.collection(C.classAttendance).where("teacherId", "==", req.user.id).get().then(listData),
    ]);
    const submitted = new Map(forms.filter((f) => f.status === "submitted").map((f) => [f.meetingId, f]));
    const rooms = await getMany(db, C.liveRooms, meetings.filter((m) => m.hadLiveClass).map((m) => m.id));
    const pending = meetings
      .filter((m) => inScope(m, rules) && !submitted.has(m.id) && isFormDue(m, rooms[m.id]))
      .sort((a, b) => (a.startAt < b.startAt ? 1 : -1))
      .map((m) => ({ meetingId: m.id, title: m.title, subject: m.subject || "", startAt: m.startAt, durationMin: m.durationMin, studentCount: (m.studentIds || []).length, overdue: Date.now() - new Date(m.endAt).getTime() > rules.reminderHours * 3600000 }));
    const done = [...submitted.values()]
      .sort((a, b) => (a.startAt < b.startAt ? 1 : -1))
      .map((f) => ({ meetingId: f.meetingId, title: f.title, subject: f.subject, startAt: f.startAt, submittedAt: f.submittedAt, editable: canTeacherEdit(f), ...summarize(f.rows || []) }));
    res.json({ pending, submitted: done, rules: { minPercent: rules.minPercent, graceMin: rules.graceMin } });
  })
);

const canTeacherEdit = (f) => !f.correctedAt && Date.now() - new Date(f.submittedAt).getTime() < TEACHER_EDIT_DAYS * 86400000;

async function loadForm(m, viewer) {
  const rules = await getRules();
  const snap = await formRef(m.id).get();
  const saved = snap.exists ? snap.data() : null;
  const { rows, room, classStartRef } = await computeRows(m, { rules, saved });
  // A submitted form keeps the statuses/remarks that were submitted, but always
  // shows the real intervals
  return {
    ...formBase(m, saved?.teacherName || (await teacherName(m.teacherId))),
    status: saved?.status || "draft",
    remarks: saved?.remarks || "",
    lessonTaken: saved?.lessonTaken || "",
    homework: saved?.homework || "",
    compensationFor: saved?.compensationFor || "",
    statusLocked: viewer !== "admin",
    submittedAt: saved?.submittedAt || null,
    submittedByName: saved?.submittedByName || null,
    correctedAt: saved?.correctedAt || null,
    correctedByName: viewer === "admin" ? saved?.correctedByName || null : undefined,
    history: viewer === "admin" ? saved?.history || [] : undefined,
    editable: viewer === "admin" ? true : !saved || canTeacherEdit(saved),
    due: isFormDue(m, room),
    classStartedAt: room?.startedAt || null,
    classStartRef,
    rules: { minPercent: rules.minPercent, graceMin: rules.graceMin },
    rows,
  };
}

router.get(
  "/teacher/attendance/:meetingId",
  requireRole("teacher"),
  ah(async (req, res) => {
    const m = await loadMeetingDoc(req.params.meetingId);
    if (m.teacherId !== req.user.id) fail(404, "Class not found");
    res.json({ form: await loadForm(m, "teacher") });
  })
);

async function saveForm(req, m, { admin }) {
  const rules = await getRules();
  const ref = formRef(m.id);
  const snap = await ref.get();
  const saved = snap.exists ? snap.data() : null;
  const { rows: fresh, room } = await computeRows(m, { rules });
  if (!admin) {
    if (!isFormDue(m, room)) fail(400, "The form can be submitted once the class has finished");
    if (saved && !canTeacherEdit(saved)) fail(400, saved.correctedAt ? "The academy reviewed this form, so it can't be changed" : `Forms can only be changed for ${TEACHER_EDIT_DAYS} days after submitting`);
  }
  // Teachers never change statuses: a re-save recomputes them from the classroom data
  // (the written columns a request leaves out stay as they were saved)
  const prev = Object.fromEntries((saved?.rows || []).map((r) => [r.studentId, r]));
  const base = fresh.map((r) => ({ ...r, ...Object.fromEntries(Object.keys(ROW_FIELDS).map((k) => [k, prev[r.studentId]?.[k] || ""])), ...(admin && prev[r.studentId] ? { status: prev[r.studentId].status } : {}) }));
  const rows = applyEdits(base, req.body.rows, { admin });
  // Which of each student's sessions this class counts towards
  const sessions = await sessionsForMeeting(m);
  for (const r of rows) r.sessionId = sessions[r.studentId]?.id || null;
  const at = nowIso();
  const reason = str(req.body.reason, 500);
  if (admin && !reason) fail(400, "Add a reason for the correction");
  const action = admin ? (saved ? "corrected" : "filled_by_admin") : saved ? "edited" : "submitted";
  const doc = {
    ...formBase(m, saved?.teacherName || (await teacherName(m.teacherId))),
    studentIds: m.studentIds || [],
    rows: rows.map(({ open, ...r }) => ({ ...r, intervals: r.intervals.map(({ from, to }) => ({ from, to })) })),
    ...Object.fromEntries(Object.entries(CLASS_FIELDS).map(([k, max]) => [k, k in req.body ? str(req.body[k], max) : saved?.[k] || ""])),
    status: "submitted",
    submittedAt: saved?.submittedAt || at,
    submittedBy: saved?.submittedBy || req.user.id,
    submittedByName: saved?.submittedByName || req.user.name,
    updatedAt: at,
    ...(admin ? { correctedAt: at, correctedBy: req.user.id, correctedByName: req.user.name, correctionReason: reason } : {}),
    history: [...(saved?.history || []), { at, by: req.user.id, byName: req.user.name, action, ...(reason ? { reason } : {}), changes: diffRows(saved?.rows, rows) }].slice(-50),
  };
  await ref.set(doc);
  return { doc, action, saved };
}

function diffRows(before, after) {
  const prev = Object.fromEntries((before || []).map((r) => [r.studentId, r.status]));
  return after.filter((r) => prev[r.studentId] !== r.status).map((r) => ({ studentId: r.studentId, from: prev[r.studentId] || null, to: r.status })).slice(0, 40);
}

router.put(
  "/teacher/attendance/:meetingId",
  requireRole("teacher"),
  ah(async (req, res) => {
    const m = await loadMeetingDoc(req.params.meetingId);
    if (m.teacherId !== req.user.id) fail(404, "Class not found");
    if (m.status === "cancelled") fail(400, "This class was cancelled");
    const { action } = await saveForm(req, m, { admin: false });
    await logActivity(req, `attendance.${action}`, { targetType: "classAttendance", targetId: m.id, summary: `${action === "submitted" ? "Submitted" : "Updated"} attendance for "${m.title}" (${fmt(m.startAt)})` });
    res.json({ ok: true });
  })
);

// Teacher: records of the classes they taught (optionally one student)
router.get(
  "/teacher/attendance-records",
  requireRole("teacher"),
  ah(async (req, res) => {
    const forms = listData(await db.collection(C.classAttendance).where("teacherId", "==", req.user.id).get()).filter((f) => f.status === "submitted");
    const all = flattenForms(forms);
    const rows = filterRows(all, req.query);
    res.json({ rows, summary: summarize(rows), subjects: [...new Set(all.map((r) => r.subject).filter(Boolean))].sort() });
  })
);

// ============================================================================
// ADMIN (permission "attendance")
// ============================================================================
const adminOnly = [requireRole("admin"), requirePerm("attendance")];

router.get(
  "/admin/attendance/records",
  ...adminOnly,
  ah(async (req, res) => {
    const [forms, leaves] = await Promise.all([submittedForms(), db.collection(C.leaveRequests).get().then(listData)]);
    const all = flattenForms(forms);
    const rows = filterRows(all, req.query);
    if (req.query.format === "csv") {
      const names = await getMany(db, C.sessions, rows.map((r) => r.sessionId));
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="attendance-${localDateOf(new Date())}.csv"`);
      const time = (iso) => new Intl.DateTimeFormat("en-IN", { timeZone: config.timezone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
      return res.send(
        toCsv(rows, [
          { label: "Date", key: "date" },
          { label: "Day", key: "day" },
          { label: "Student", key: "studentName" },
          { label: "Subject", key: "subject" },
          { label: "Class", key: "title" },
          { label: "Teacher", key: "teacherName" },
          { label: "Session", value: (r) => names[r.sessionId]?.name || "" },
          { label: "Class no. (subject)", key: "classNo" },
          { label: "Scheduled (min)", key: "scheduledMin" },
          { label: "Attended (min)", key: "attendedMin" },
          { label: "Attended %", key: "percent" },
          { label: "Status", value: (r) => STATUS_LABEL[r.status] || r.status },
          { label: "Suggested status", value: (r) => STATUS_LABEL[r.suggested] || r.suggested },
          { label: "Join/leave intervals", value: (r) => r.intervals.map((i) => `${time(i.from)}–${time(i.to)}`).join("; ") },
          { label: "Interruptions", key: "interruptions" },
          { label: "Lesson taught", key: "lessonTaken" },
          { label: "Homework", key: "homework" },
          { label: "Quiz topic", key: "quizTopic" },
          { label: "Quiz result", key: "quizResult" },
          { label: "Test topic", key: "testTopic" },
          { label: "Test result", key: "testResult" },
          { label: "Make-up class for", key: "compensationFor" },
          { label: "Remarks", key: "remarks" },
          { label: "Class remarks", key: "formRemarks" },
        ])
      );
    }
    const pick = (k) => [...new Map(all.map((r) => [r[k], r])).values()];
    res.json({
      rows,
      summary: summarize(rows),
      leaveCounts: leaveCounts(filterLeaves(leaves, req.query)),
      students: pick("studentId").map((r) => ({ id: r.studentId, name: r.studentName })).sort((a, b) => a.name.localeCompare(b.name)),
      teachers: pick("teacherId").map((r) => ({ id: r.teacherId, name: r.teacherName })).sort((a, b) => a.name.localeCompare(b.name)),
      subjects: [...new Set(all.map((r) => r.subject).filter(Boolean))].sort(),
      sessions: Object.values(await getMany(db, C.sessions, all.map((r) => r.sessionId))).map((s) => ({ id: s.id, name: s.studentName ? `${s.studentName} – ${s.name}` : s.name })),
      leaves: filterLeaves(leaves, req.query).map((l) => ({ studentId: l.studentId, subject: l.subject, sessionId: l.sessionId || null, date: l.date, status: l.status, teacherId: l.teacherId })),
    });
  })
);

const filterLeaves = (list, q) =>
  list.filter((l) => l.status !== "cancelled" && (!q.studentId || l.studentId === q.studentId) && (!q.teacherId || l.teacherId === q.teacherId) && (!q.subject || l.subject === q.subject) && (!q.sessionId || l.sessionId === q.sessionId) && (!q.from || l.date >= q.from) && (!q.to || l.date <= q.to));

// Teachers' forms not submitted yet, and classes that were never started
router.get(
  "/admin/attendance/pending",
  ...adminOnly,
  ah(async (req, res) => {
    const out = await pendingForms();
    res.json(out);
  })
);

export async function pendingForms() {
  const rules = await getRules();
  const [meetings, forms] = await Promise.all([db.collection(C.meetings).get().then(listData), db.collection(C.classAttendance).get().then(listData)]);
  const done = new Set(forms.filter((f) => f.status === "submitted").map((f) => f.meetingId));
  const scoped = meetings.filter((m) => inScope(m, rules) && m.status !== "cancelled" && !done.has(m.id));
  const rooms = await getMany(db, C.liveRooms, scoped.filter((m) => m.hadLiveClass).map((m) => m.id));
  const users = await getMany(db, C.users, scoped.map((m) => m.teacherId));
  const shape = (m) => ({ meetingId: m.id, title: m.title, subject: m.subject || "", teacherId: m.teacherId, teacherName: users[m.teacherId]?.name || "", startAt: m.startAt, endAt: m.endAt, studentCount: (m.studentIds || []).length, hoursSinceEnd: Math.max(0, Math.round((Date.now() - new Date(m.endAt).getTime()) / 3600000)) });
  const pending = scoped.filter((m) => isFormDue(m, rooms[m.id])).sort((a, b) => (a.startAt < b.startAt ? -1 : 1)).map((m) => ({ ...shape(m), overdue: Date.now() - new Date(m.endAt).getTime() > rules.reminderHours * 3600000 }));
  const notConducted = scoped.filter((m) => !m.hadLiveClass && new Date(m.endAt).getTime() < Date.now()).sort((a, b) => (a.startAt < b.startAt ? 1 : -1)).map(shape);
  return { pending, notConducted, rules };
}

router.get(
  "/admin/attendance/forms/:meetingId",
  ...adminOnly,
  ah(async (req, res) => {
    const m = await loadMeetingDoc(req.params.meetingId);
    res.json({ form: await loadForm(m, "admin") });
  })
);

router.put(
  "/admin/attendance/forms/:meetingId",
  ...adminOnly,
  ah(async (req, res) => {
    const m = await loadMeetingDoc(req.params.meetingId);
    const { action, saved, doc } = await saveForm(req, m, { admin: true });
    await audit(req, `attendance.${action}`, { targetType: "classAttendance", targetId: m.id, summary: `${saved ? "Corrected" : "Filled in"} attendance for "${m.title}" (${fmt(m.startAt)})`, meta: { reason: doc.correctionReason, changes: doc.history[doc.history.length - 1]?.changes } });
    res.json({ ok: true });
  })
);

// ============================================================================
// SESSION REGISTER – the client's per-student sheet, built from the portal:
// Faculty, Student, Student ID, Subject, Session, Starting / Ending date, Total
// classes taken; one row per class: Date, Day, Time, Lesson taken, Homework,
// Status, Minutes, Class count, Quiz topic/result, Test topic/result, Reason for
// student leave, Reason for faculty leave, Remarks, Compensation class.
// Date, time, status, minutes and class count are automatic (never typed).
// ============================================================================
const timeFmt = (iso) => new Intl.DateTimeFormat("en-IN", { timeZone: config.timezone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const dayFmt = (iso) => new Intl.DateTimeFormat("en-GB", { timeZone: config.timezone, weekday: "long" }).format(new Date(iso));

async function buildRegister(s) {
  const meetings = await meetingsOfSession(s);
  const forms = await getMany(db, C.classAttendance, meetings.map((m) => m.id));
  const leaves = listData(await db.collection(C.leaveRequests).where("studentId", "==", s.studentId).get()).filter((l) => l.status === "approved");
  const leaveBy = Object.fromEntries(leaves.map((l) => [l.meetingId, l]));
  const rules = await getRules();
  const now = nowIso();
  let count = 0;
  const rows = [];
  for (const m of meetings) {
    const f = forms[m.id];
    const held = isHeld(m);
    let r = f?.rows?.find((x) => x.studentId === s.studentId) || null;
    // Held but the form isn't in yet: show the automatic status from the classroom data
    if (!r && held) r = (await computeRows(m, { rules })).rows.find((x) => x.studentId === s.studentId) || null;
    if (held) count++;
    const state = m.status === "cancelled" ? "cancelled" : held ? (f?.status === "submitted" ? "submitted" : "form_due") : m.endAt > now ? "upcoming" : "not_held";
    const attended = r && ["present", "late"].includes(r.status);
    rows.push({
      meetingId: m.id,
      date: localDateOf(m.startAt),
      day: dayFmt(m.startAt),
      time: `${timeFmt(m.startAt)} – ${timeFmt(m.endAt)}`,
      state,
      lessonTaken: f?.lessonTaken || "",
      homework: f?.homework || "",
      status: held && r ? r.status : "",
      statusLabel: held && r ? STATUS_LABEL[r.status] : state === "cancelled" ? "Class cancelled" : state === "upcoming" ? "Upcoming" : "Not held",
      minutes: held && attended ? r.attendedMin : null,
      classCount: held ? count : null,
      quizTopic: r?.quizTopic || "",
      quizResult: r?.quizResult || "",
      testTopic: r?.testTopic || "",
      testResult: r?.testResult || "",
      studentLeaveReason: leaveBy[m.id]?.reason || "",
      facultyLeaveReason: m.status === "cancelled" ? m.cancelledReason || "Cancelled" : "",
      remarks: r?.remarks || "",
      compensationFor: f?.compensationFor || "",
    });
  }
  const users = await getMany(db, C.users, [s.studentId, s.teacherId]);
  return {
    header: {
      sessionId: s.id,
      faculty: users[s.teacherId]?.name || s.teacherName || "",
      student: users[s.studentId]?.name || s.studentName || "",
      studentCode: users[s.studentId]?.studentCode || s.studentCode || "",
      subject: s.subject,
      session: s.number,
      startDate: s.startDate,
      endDate: s.endDate,
      plannedClasses: s.plannedClasses,
      totalClassesTaken: count,
      status: s.status,
    },
    rows,
  };
}

const REGISTER_COLUMNS = [
  ["DATE", "date"], ["DAY", "day"], ["TIME", "time"], ["LESSON TAKEN", "lessonTaken"], ["HOME WORK", "homework"], ["STATUS", "statusLabel"], ["MINUTES", "minutes"], ["CLASS COUNT", "classCount"],
  ["QUIZ TOPIC", "quizTopic"], ["QUIZ RESULTS", "quizResult"], ["TEST TOPIC", "testTopic"], ["TEST RESULTS", "testResult"], ["REASONS FOR STUDENT LEAVE", "studentLeaveReason"], ["REASON FOR FACULTY LEAVE", "facultyLeaveReason"], ["REMARKS", "remarks"], ["COMPENSATION CLASS", "compensationFor"],
];

router.get(
  "/sessions/:id/register",
  requireRole("admin", "teacher"),
  ah(async (req, res) => {
    const snap = await db.collection(C.sessions).doc(req.params.id).get();
    if (!snap.exists || !snap.data().studentId) fail(404, "Session not found");
    const s = { id: snap.id, ...snap.data() };
    if (req.user.role === "teacher" ? s.teacherId !== req.user.id : !(hasPerm(req.user, "sessions") || hasPerm(req.user, "attendance"))) fail(404, "Session not found");
    const reg = await buildRegister(s);
    if (req.query.format !== "csv") return res.json(reg);
    const h = reg.header;
    const esc = (v) => {
      const t = v === null || v === undefined || v === "" ? "-----" : String(v);
      return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const top = [["FACULTY NAME", h.faculty], ["STUDENT NAME", h.student], ["STUDENT ID", h.studentCode], ["SUBJECT", h.subject], ["SESSION", h.session], ["STARTING DATE", h.startDate], ["ENDING DATE", h.endDate], ["TOTAL CLASSES TAKEN", h.totalClassesTaken]];
    const lines = [...top.map((r) => r.map(esc).join(",")), "", REGISTER_COLUMNS.map((c) => c[0]).join(","), ...reg.rows.map((r) => REGISTER_COLUMNS.map((c) => esc(r[c[1]])).join(","))];
    const file = `${h.student}-${h.subject}-session-${h.session}`.replace(/[^\w-]+/g, "_");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${file}.csv"`);
    res.send(`﻿${lines.join("\r\n")}`);
  })
);

// ---- Rules (minimum %, grace period, reminders) ------------------------------------------
router.get(
  "/admin/attendance/rules",
  ...adminOnly,
  ah(async (req, res) => res.json({ rules: await getRules(), defaults: DEFAULT_RULES }))
);

router.put(
  "/admin/attendance/rules",
  ...adminOnly,
  ah(async (req, res) => {
    const n = (v, lo, hi, label) => {
      const x = Math.round(Number(v));
      if (!(x >= lo && x <= hi)) fail(400, `${label} must be between ${lo} and ${hi}`);
      return x;
    };
    const b = req.body || {};
    const formsFrom = /^\d{4}-\d{2}-\d{2}$/.test(b.formsFrom || "") ? b.formsFrom : (await getRules()).formsFrom;
    const rules = { minPercent: n(b.minPercent, 1, 100, "Minimum attendance %"), graceMin: n(b.graceMin, 0, 120, "Grace period"), reminderHours: n(b.reminderHours, 1, 168, "Reminder hours"), formsFrom };
    const before = (await getSettings()).attendanceRules || null;
    await saveSettings({ attendanceRules: rules });
    await audit(req, "attendance.rules", { targetType: "settings", summary: `Attendance rules: ${rules.minPercent}% minimum, ${rules.graceMin} min grace`, meta: { before, after: rules } });
    res.json({ rules });
  })
);

// ---- Leave requests (admin) -----------------------------------------------------------------
router.get(
  "/admin/leave-requests",
  ...adminOnly,
  ah(async (req, res) => {
    let list = listData(await db.collection(C.leaveRequests).get()).filter((l) => l.status !== "cancelled" || req.query.status === "cancelled");
    if (req.query.status) list = list.filter((l) => l.status === req.query.status);
    if (req.query.studentId) list = list.filter((l) => l.studentId === req.query.studentId);
    const users = await getMany(db, C.users, list.map((l) => l.teacherId));
    list.sort((a, b) => (a.status === "pending") !== (b.status === "pending") ? (a.status === "pending" ? -1 : 1) : a.createdAt < b.createdAt ? 1 : -1);
    res.json({ requests: list.map((l) => ({ ...shapeLeave(l), studentId: l.studentId, studentName: l.studentName, teacherName: users[l.teacherId]?.name || "", decidedByName: l.decidedByName || null, late: l.createdAt > l.classStartAt })) });
  })
);

router.post(
  "/admin/leave-requests/:id/decide",
  ...adminOnly,
  ah(async (req, res) => {
    const ref = db.collection(C.leaveRequests).doc(req.params.id);
    const l = (await ref.get()).data();
    if (!l) fail(404, "Leave request not found");
    const decision = req.body.decision === "approve" ? "approved" : req.body.decision === "reject" ? "rejected" : null;
    if (!decision) fail(400, "Choose approve or reject");
    if (l.status === "cancelled") fail(400, "The student cancelled this request");
    if (l.status === decision) return res.json({ ok: true });
    const note = str(req.body.note, 1000);
    if (decision === "rejected" && !note) fail(400, "Add a reason for rejecting the leave");
    const at = nowIso();
    await ref.update({ status: decision, decisionNote: note, decidedAt: at, decidedBy: req.user.id, decidedByName: req.user.name, updatedAt: at, history: [...(l.history || []), { at, by: req.user.id, byName: req.user.name, action: decision, note }] });

    // A form already submitted for that class follows the decision (unless someone set the status by hand)
    const fRef = formRef(l.meetingId);
    const f = (await fRef.get()).data();
    if (f?.rows) {
      let changed = false;
      const rows = f.rows.map((r) => {
        if (r.studentId !== l.studentId || r.overridden) return r;
        if (decision === "approved" && r.status === "uninformed") return (changed = true), { ...r, status: "leave", suggested: "leave", leave: { id: req.params.id, status: decision } };
        if (decision === "rejected" && r.status === "leave") return (changed = true), { ...r, status: "uninformed", suggested: "uninformed", leave: { id: req.params.id, status: decision } };
        return r;
      });
      if (changed) await fRef.update({ rows, updatedAt: at });
    }
    await audit(req, `leave.${decision}`, { targetType: "leaveRequest", targetId: req.params.id, summary: `${decision === "approved" ? "Approved" : "Rejected"} leave for ${l.studentName} – "${l.classTitle}" on ${l.date}`, meta: { note } });
    await notify([l.studentId], {
      type: `leave_${decision}`,
      title: decision === "approved" ? "Leave approved" : "Leave not approved",
      body: `"${l.classTitle}" on ${fmt(l.classStartAt)}${note ? ` – ${note}` : ""}`,
      link: "/portal/student/attendance?tab=leave",
      refId: req.params.id,
    });
    res.json({ ok: true });
  })
);

// ============================================================================
// LEGACY weekly forms (read-only, admins)
// ============================================================================
async function weekRows(weekStart) {
  const [students, qs] = await Promise.all([usersByRole("student"), db.collection(C.attendance).where("weekStart", "==", weekStart).get()]);
  const entries = Object.fromEntries(listData(qs).map((a) => [a.studentId, a]));
  const teachers = Object.fromEntries((await usersByRole("teacher")).map((t) => [t.id, t.name]));
  return students
    .filter((s) => entries[s.id])
    .map((s) => {
      const e = entries[s.id];
      return { id: `${s.id}_${weekStart}`, studentId: s.id, studentName: s.name, grade: s.grade || "", teacherName: teacherIdsOf(s).map((id) => teachers[id]).filter(Boolean).join(", "), weekStart, status: e.correctedAt ? "corrected" : e.late ? "late" : "submitted", entry: e };
    })
    .sort((a, b) => a.studentName.localeCompare(b.studentName));
}

router.get(
  "/admin/attendance-legacy",
  ...adminOnly,
  ah(async (req, res) => {
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(req.query.weekStart || "");
    const weeks = [...new Set(listData(await db.collection(C.attendance).get()).map((a) => a.weekStart))].sort().reverse();
    const weekStart = valid ? req.query.weekStart : weeks[0] || weekStartOf(new Date());
    res.json({ weekStart, weeks, rows: await weekRows(weekStart) });
  })
);

export { weekRows, shiftWeek };
export default router;
