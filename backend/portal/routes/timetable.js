// ============================================================================
// WEEKLY TIMETABLE – a recurring Monday–Sunday plan of who teaches whom, when.
// It is a reference only: it never creates classes, meeting links or reminders
// (those still come from "Schedule class" in routes/meetings.js).
//   Admin (with the "classes" permission): create, edit, delete, see everything
//   Teacher: read-only, the entries they teach
//   Student / parent: read-only, the entries they are in
// ============================================================================
import { Router } from "express";
import config from "../config.js";
import { db, C } from "../firebase.js";
import { ah, fail, nowIso, str, listData, getMany } from "../util.js";
import { requireRole } from "../middleware.js";
import { hasPerm, getUser, audit, assignmentProblem, canonicalSubject } from "../services/core.js";

const router = Router();
const MAX_GROUP = config.maxClassSize;
export const DAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]; // 1 = Monday … 7 = Sunday
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fmt12 = (t) => {
  const m = toMin(t);
  const h = Math.floor(m / 60);
  return `${h % 12 || 12}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
};

const canManage = (user) => user.role === "admin" && hasPerm(user, "classes");
const sortEntries = (a, b) => a.day - b.day || (a.start < b.start ? -1 : a.start > b.start ? 1 : 0);

async function loadScoped(user) {
  if (user.role === "admin") {
    if (!canManage(user)) fail(403, "Your admin account doesn't have the classes permission");
    return listData(await db.collection(C.timetable).get());
  }
  if (user.role === "teacher") return listData(await db.collection(C.timetable).where("teacherId", "==", user.id).get());
  return listData(await db.collection(C.timetable).where("studentIds", "array-contains", user.id).get());
}

async function namesFor(entries) {
  const users = await getMany(db, C.users, entries.flatMap((e) => [e.teacherId, ...(e.studentIds || [])]));
  return Object.fromEntries(Object.values(users).map((u) => [u.id, u.name]));
}

// Students never see who else is in a group (same rule as classes)
function shape(e, viewer, names) {
  const base = {
    id: e.id,
    day: e.day,
    start: e.start,
    end: e.end,
    subject: e.subject || "",
    lesson: e.lesson || "",
    notes: e.notes || "",
    teacherId: e.teacherId,
    teacherName: names[e.teacherId] || e.teacherName || "Teacher",
    isGroup: (e.studentIds || []).length > 1,
    studentCount: (e.studentIds || []).length,
    updatedAt: e.updatedAt || e.createdAt,
  };
  if (viewer.role !== "student") {
    base.studentIds = e.studentIds || [];
    base.students = base.studentIds.map((id) => ({ id, name: names[id] || "Former student" }));
  }
  return base;
}

// ---- Read (every role, scoped) ----------------------------------------------------
router.get(
  "/timetable",
  ah(async (req, res) => {
    let list = await loadScoped(req.user);
    if (req.query.teacherId && req.user.role === "admin") list = list.filter((e) => e.teacherId === req.query.teacherId);
    if (req.query.studentId && req.user.role !== "student") list = list.filter((e) => (e.studentIds || []).includes(req.query.studentId));
    const names = await namesFor(list);
    res.json({ entries: list.sort(sortEntries).map((e) => shape(e, req.user, names)), timezone: config.timezone });
  })
);

// ---- Admin: create / edit / delete -------------------------------------------------
async function validate(body, ignoreId) {
  const teacherId = str(body.teacherId, 60);
  const teacher = await getUser(teacherId);
  if (!teacher || teacher.role !== "teacher" || teacher.deletedAt) fail(400, "Choose a teacher");
  if (!teacher.active) fail(400, `${teacher.name}'s account is deactivated`);

  const studentIds = [...new Set((Array.isArray(body.studentIds) ? body.studentIds : []).map((s) => str(s, 60)).filter(Boolean))];
  if (!studentIds.length) fail(400, "Choose at least one student");
  if (studentIds.length > MAX_GROUP) fail(400, `A timetable entry can have at most ${MAX_GROUP} students`);
  const users = await getMany(db, C.users, studentIds);
  for (const id of studentIds) {
    const s = users[id];
    if (!s || s.role !== "student" || s.deletedAt) fail(400, "One of the selected students was not found");
  }

  const days = [...new Set((Array.isArray(body.days) ? body.days : [body.day]).map(Number))];
  if (!days.length || days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) fail(400, "Choose the day");
  const start = str(body.start, 5);
  const end = str(body.end, 5);
  if (!TIME.test(start) || !TIME.test(end)) fail(400, "Enter the start and end time");
  if (toMin(end) <= toMin(start)) fail(400, "The end time must be after the start time");
  if (toMin(end) - toMin(start) < 15) fail(400, "A timetable slot must be at least 15 minutes");

  const subject = await canonicalSubject(body.subject, { allowInactive: !!ignoreId });
  for (const id of studentIds) {
    const problem = assignmentProblem(users[id], teacherId, subject, teacher.name);
    if (problem) fail(400, problem);
  }
  const lesson = str(body.lesson, 120);
  const notes = str(body.notes, 500);

  // No overlapping slots for the same teacher (or the same student) on the same day
  const others = listData(await db.collection(C.timetable).get()).filter((e) => e.id !== ignoreId && days.includes(e.day));
  const overlaps = (e) => toMin(e.start) < toMin(end) && toMin(e.end) > toMin(start);
  const teacherClash = others.find((e) => e.teacherId === teacherId && overlaps(e));
  if (teacherClash) fail(409, `${teacher.name} already has ${teacherClash.subject} on ${DAYS[teacherClash.day]}, ${fmt12(teacherClash.start)} – ${fmt12(teacherClash.end)}`);
  const studentClash = others.find((e) => overlaps(e) && (e.studentIds || []).some((id) => studentIds.includes(id)));
  if (studentClash) {
    const who = users[(studentClash.studentIds || []).find((id) => studentIds.includes(id))]?.name || "A selected student";
    fail(409, `${who} already has ${studentClash.subject} on ${DAYS[studentClash.day]}, ${fmt12(studentClash.start)} – ${fmt12(studentClash.end)}`);
  }

  return { teacher, data: { teacherId, teacherName: teacher.name, studentIds, start, end, subject, lesson, notes }, days };
}

const describe = (e, teacherName) => `${e.subject} · ${DAYS[e.day]} ${fmt12(e.start)} – ${fmt12(e.end)} · ${teacherName}`;

router.post(
  "/timetable",
  requireRole("admin"),
  ah(async (req, res) => {
    if (!canManage(req.user)) fail(403, "Your admin account doesn't have the classes permission");
    const { teacher, data, days } = await validate(req.body);
    const now = nowIso();
    const batch = db.batch();
    const ids = days.map((day) => {
      const ref = db.collection(C.timetable).doc();
      batch.set(ref, { ...data, day, createdAt: now, createdBy: req.user.id, updatedAt: now, updatedBy: req.user.id });
      return ref.id;
    });
    await batch.commit();
    await audit(req, "timetable.create", { targetType: "timetable", targetId: ids[0], summary: `Added to the timetable: ${days.map((day) => describe({ ...data, day }, teacher.name)).join("; ")}` });
    res.status(201).json({ ids });
  })
);

router.patch(
  "/timetable/:id",
  requireRole("admin"),
  ah(async (req, res) => {
    if (!canManage(req.user)) fail(403, "Your admin account doesn't have the classes permission");
    const ref = db.collection(C.timetable).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) fail(404, "Timetable entry not found");
    const { teacher, data, days } = await validate({ ...req.body, days: [req.body.day] }, snap.id);
    const next = { ...data, day: days[0], updatedAt: nowIso(), updatedBy: req.user.id };
    await ref.update(next);
    await audit(req, "timetable.update", { targetType: "timetable", targetId: snap.id, summary: `Changed a timetable entry: ${describe(snap.data(), snap.data().teacherName || "")} → ${describe(next, teacher.name)}` });
    res.json({ ok: true });
  })
);

router.delete(
  "/timetable/:id",
  requireRole("admin"),
  ah(async (req, res) => {
    if (!canManage(req.user)) fail(403, "Your admin account doesn't have the classes permission");
    const ref = db.collection(C.timetable).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) fail(404, "Timetable entry not found");
    await ref.delete();
    await audit(req, "timetable.delete", { targetType: "timetable", targetId: snap.id, summary: `Removed from the timetable: ${describe(snap.data(), snap.data().teacherName || "")}` });
    res.json({ ok: true });
  })
);

export default router;
