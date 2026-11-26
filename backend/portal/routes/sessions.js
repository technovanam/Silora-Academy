// ============================================================================
// ACADEMIC SESSIONS – one per student + subject + teacher (the client's sheet:
// Faculty, Student, Student ID, Subject, Session no., Starting / Ending date,
// Total classes taken).
//  • Admins (permission "sessions") create them per student: tick the student's
//    subjects, set the dates and classes planned → one session per subject.
//  • The session number goes up per student + subject (Session 8, 9…).
//  • Classes count automatically (services/sessions.js) – nobody types them.
//  • When a session is ACTIVE the student must submit fee proof for that
//    subject (services/fees.js); the teacher's payment record follows it too.
// Data: sessions/{id}
// ============================================================================
import { Router } from "express";
import { db, C } from "../firebase.js";
import { ah, fail, nowIso, str, listData, getMany } from "../util.js";
import { requireRole, requirePerm } from "../middleware.js";
import { audit, hasPerm, getUser, canonicalSubject, assignmentProblem, subjectTeachersOf, sameSubject } from "../services/core.js";
import { ensurePayments, clearFeeCache, payId, needsProof } from "../services/fees.js";
import { recomputeSession } from "../services/teacherPayments.js";
import { SESSION_STATUSES, sessionTitle, meetingsOfSession, progressOf, overlapping, nextNumber, isHeld } from "../services/sessions.js";

export { SESSION_STATUSES };
const router = Router();
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function loadSession(id) {
  const snap = await db.collection(C.sessions).doc(String(id || "")).get();
  if (!snap.exists) fail(404, "Session not found");
  return { id: snap.id, ...snap.data() };
}

const sessionsAdmin = [requireRole("admin"), requirePerm("sessions")];
const feeOf = (p, s) => (s.status === "draft" ? null : p ? { submission: p.submission, verification: p.verification, needsProof: needsProof(p) } : { submission: "not_submitted", verification: "unverified", needsProof: true });

// Shared checks for one session's fields
async function cleanFields(b, before) {
  const startDate = str(b.startDate ?? before?.startDate, 10);
  const endDate = str(b.endDate ?? before?.endDate, 10);
  if (!DATE.test(startDate) || !DATE.test(endDate)) fail(400, "Choose the starting and ending dates");
  if (endDate < startDate) fail(400, "The ending date is before the starting date");
  const plannedClasses = Math.round(Number(b.classes ?? b.plannedClasses ?? before?.plannedClasses));
  if (!(plannedClasses >= 1 && plannedClasses <= 500)) fail(400, "Enter the number of classes planned (1–500)");
  const status = b.status === undefined ? before?.status || "draft" : b.status;
  if (!SESSION_STATUSES.includes(status)) fail(400, "Invalid status");
  return { startDate, endDate, plannedClasses, status, paymentInstructions: str(b.paymentInstructions ?? before?.paymentInstructions, 2000) };
}

async function checkTeacher(student, teacherId, subject) {
  const t = await getUser(teacherId);
  if (!t || t.role !== "teacher" || t.deletedAt) fail(400, `Choose the teacher for ${subject}`);
  const problem = assignmentProblem(student, teacherId, subject, t.name);
  if (problem) fail(400, `${problem}. Change the student's subjects & teachers first.`);
  return t;
}

// Fields every session document carries (some kept for older code: studentIds, teacherIds, subjects)
function docFields({ student, teacher, subject, number, fields }) {
  return {
    studentId: student.id,
    studentIds: [student.id],
    studentName: student.name,
    studentCode: student.studentCode || "",
    subject,
    teacherId: teacher.id,
    teacherIds: [teacher.id],
    teacherName: teacher.name,
    number,
    name: sessionTitle({ subject, number }),
    ...fields,
    totalClasses: fields.plannedClasses,
    subjects: [{ subject, teacherId: teacher.id, classes: fields.plannedClasses }],
  };
}

function shape(s, meetings, pay) {
  return {
    id: s.id,
    name: s.name,
    number: s.number,
    subject: s.subject,
    studentId: s.studentId,
    studentName: s.studentName,
    studentCode: s.studentCode || "",
    teacherId: s.teacherId,
    teacherName: s.teacherName,
    startDate: s.startDate,
    endDate: s.endDate,
    plannedClasses: s.plannedClasses,
    status: s.status,
    paymentInstructions: s.paymentInstructions || "",
    progress: progressOf(s, meetings),
    fee: pay === undefined ? undefined : feeOf(pay, s),
    createdAt: s.createdAt,
  };
}

// ---- List (filters: student, subject, teacher, status) --------------------------------
router.get(
  "/admin/sessions",
  ...sessionsAdmin,
  ah(async (req, res) => {
    let list = listData(await db.collection(C.sessions).get()).filter((s) => s.studentId); // older batch sessions are left out
    if (req.query.status) list = list.filter((s) => s.status === req.query.status);
    else if (!req.query.all) list = list.filter((s) => s.status !== "archived");
    if (req.query.studentId) list = list.filter((s) => s.studentId === req.query.studentId);
    if (req.query.teacherId) list = list.filter((s) => s.teacherId === req.query.teacherId);
    if (req.query.subject) list = list.filter((s) => sameSubject(s.subject, req.query.subject));
    const teacherIds = [...new Set(list.map((s) => s.teacherId))];
    const meetings = [];
    for (const t of teacherIds) meetings.push(...listData(await db.collection(C.meetings).where("teacherId", "==", t).get()));
    const seeFees = hasPerm(req.user, "fees");
    const pays = seeFees && list.length ? await db.getAll(...list.map((s) => db.collection(C.feePayments).doc(payId(s.id, s.studentId)))) : [];
    const payBy = Object.fromEntries(pays.filter((p) => p.exists).map((p) => [p.id, p.data()]));
    list.sort((a, b) => (a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : (a.studentName || "").localeCompare(b.studentName || "") || (a.subject || "").localeCompare(b.subject || "")));
    res.json({ sessions: list.map((s) => shape(s, meetings, seeFees ? payBy[payId(s.id, s.studentId)] || null : undefined)) });
  })
);

router.get(
  "/admin/sessions/:id",
  ...sessionsAdmin,
  ah(async (req, res) => {
    const s = await loadSession(req.params.id);
    const meetings = await meetingsOfSession(s);
    const seeFees = hasPerm(req.user, "fees");
    const pay = seeFees ? (await db.collection(C.feePayments).doc(payId(s.id, s.studentId)).get()).data() || null : undefined;
    res.json({
      session: { ...shape(s, meetings, pay), history: s.history || [] },
      classes: meetings.map((m) => ({ id: m.id, title: m.title, startAt: m.startAt, durationMin: m.durationMin, status: m.status, held: isHeld(m), cancelledReason: m.cancelledReason || "" })),
    });
  })
);

// ---- What the create form offers for a student: their subjects, teachers and next numbers
router.get(
  "/admin/sessions-setup/:studentId",
  ...sessionsAdmin,
  ah(async (req, res) => {
    const st = await getUser(req.params.studentId);
    if (!st || st.role !== "student" || st.deletedAt) fail(404, "Student not found");
    const rows = subjectTeachersOf(st).filter((r) => r.subject);
    const teachers = await getMany(db, C.users, rows.map((r) => r.teacherId).filter(Boolean));
    const out = [];
    for (const r of rows) out.push({ subject: r.subject, teacherId: r.teacherId || null, teacherName: r.teacherId ? teachers[r.teacherId]?.name || "" : null, nextNumber: await nextNumber(st.id, r.subject) });
    res.json({ student: { id: st.id, name: st.name, studentCode: st.studentCode || "", grade: st.grade || "" }, subjects: out });
  })
);

// ---- Create: one session per ticked subject -------------------------------------------
// Body: { studentId, startDate, endDate, status, paymentInstructions,
//         rows: [{ subject, teacherId?, classes, number? }] }
router.post(
  "/admin/sessions",
  ...sessionsAdmin,
  ah(async (req, res) => {
    const b = req.body || {};
    const student = await getUser(str(b.studentId, 60));
    if (!student || student.role !== "student" || student.deletedAt) fail(400, "Choose the student");
    const rows = Array.isArray(b.rows) ? b.rows.slice(0, 20) : [];
    if (!rows.length) fail(400, "Tick at least one subject");
    const prepared = [];
    for (const r of rows) {
      const subject = await canonicalSubject(r.subject);
      if (prepared.some((x) => sameSubject(x.subject, subject))) fail(400, `${subject} is listed twice`);
      const teacherId = str(r.teacherId, 60) || subjectTeachersOf(student).find((x) => sameSubject(x.subject, subject))?.teacherId;
      if (!teacherId) fail(400, `${student.name} has no teacher for ${subject} yet`);
      const teacher = await checkTeacher(student, teacherId, subject);
      const fields = await cleanFields({ ...b, classes: r.classes });
      const clash = await overlapping({ studentId: student.id, subject, ...fields });
      if (clash) fail(409, `${student.name} already has ${clash.name} (${clash.startDate} – ${clash.endDate})`);
      const number = r.number ? Math.round(Number(r.number)) : await nextNumber(student.id, subject);
      if (!(number >= 1 && number <= 999)) fail(400, `Enter a valid session number for ${subject}`);
      prepared.push({ subject, teacher, fields, number });
    }
    const at = nowIso();
    const created = [];
    let notified = 0;
    for (const p of prepared) {
      const ref = db.collection(C.sessions).doc();
      const doc = { ...docFields({ student, ...p }), createdAt: at, createdBy: req.user.id, updatedAt: at, history: [{ at, by: req.user.id, byName: req.user.name, action: "created", status: p.fields.status }] };
      await ref.set(doc);
      notified += await ensurePayments({ id: ref.id, ...doc }, [student.id]);
      await recomputeSession(ref.id);
      await audit(req, "session.create", { targetType: "session", targetId: ref.id, summary: `Created ${doc.name} for ${student.name} with ${p.teacher.name} (${doc.startDate} – ${doc.endDate}, ${doc.plannedClasses} classes)` });
      created.push({ id: ref.id, name: doc.name });
    }
    clearFeeCache(student.id);
    res.status(201).json({ created, notified });
  })
);

// ---- Edit: dates, classes planned, number, status, teacher, payment instructions --------
router.patch(
  "/admin/sessions/:id",
  ...sessionsAdmin,
  ah(async (req, res) => {
    const before = await loadSession(req.params.id);
    if (!before.studentId) fail(400, "This is an older batch session – create new sessions per student instead");
    const b = req.body || {};
    const student = await getUser(before.studentId);
    if (!student) fail(400, "The student of this session no longer exists");
    const fields = await cleanFields(b, before);
    const teacherId = str(b.teacherId, 60) || before.teacherId;
    const teacher = teacherId !== before.teacherId ? await checkTeacher(student, teacherId, before.subject) : (await getUser(before.teacherId)) || { id: before.teacherId, name: before.teacherName };
    const number = b.number !== undefined ? Math.round(Number(b.number)) : before.number;
    if (!(number >= 1 && number <= 999)) fail(400, "Enter a valid session number");
    const clash = await overlapping({ studentId: student.id, subject: before.subject, ...fields }, before.id);
    if (clash) fail(409, `${student.name} already has ${clash.name} (${clash.startDate} – ${clash.endDate})`);
    const at = nowIso();
    const data = docFields({ student, teacher, subject: before.subject, number, fields });
    const changes = ["startDate", "endDate", "plannedClasses", "status", "teacherId", "number"].filter((k) => data[k] !== before[k]);
    await db.collection(C.sessions).doc(before.id).update({
      ...data,
      updatedAt: at,
      history: [...(before.history || []), { at, by: req.user.id, byName: req.user.name, action: "updated", changes, ...(data.status !== before.status ? { status: data.status } : {}) }].slice(-100),
    });
    const session = { id: before.id, ...before, ...data };
    const notified = data.status === "active" && before.status !== "active" ? await ensurePayments(session, [student.id]) : 0;
    if (data.name !== before.name) {
      const ref = db.collection(C.feePayments).doc(payId(before.id, student.id));
      if ((await ref.get()).exists) await ref.update({ sessionName: data.name, sessionNumber: number });
    }
    clearFeeCache(student.id);
    await recomputeSession(before.id);
    await audit(req, "session.update", { targetType: "session", targetId: before.id, summary: `Updated ${data.name} for ${student.name}${changes.length ? ` (${changes.join(", ")})` : ""}`, meta: { changes } });
    res.json({ ok: true, notified });
  })
);

// ---- Teacher: their sessions (for the register) ----------------------------------------
router.get(
  "/teacher/sessions",
  requireRole("teacher"),
  ah(async (req, res) => {
    const list = listData(await db.collection(C.sessions).where("teacherId", "==", req.user.id).get()).filter((s) => s.studentId && ["active", "completed"].includes(s.status));
    const meetings = listData(await db.collection(C.meetings).where("teacherId", "==", req.user.id).get());
    list.sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
    res.json({ sessions: list.map((s) => shape(s, meetings)) });
  })
);

// ---- Student: my sessions and their progress -------------------------------------------
router.get(
  "/sessions/me",
  requireRole("student"),
  ah(async (req, res) => {
    const list = listData(await db.collection(C.sessions).where("studentIds", "array-contains", req.user.id).get()).filter((s) => s.studentId && ["active", "completed"].includes(s.status));
    const meetings = listData(await db.collection(C.meetings).where("studentIds", "array-contains", req.user.id).get());
    list.sort((a, b) => (a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : (a.subject || "").localeCompare(b.subject || "")));
    res.json({ sessions: list.map((s) => shape(s, meetings)) });
  })
);

export default router;
