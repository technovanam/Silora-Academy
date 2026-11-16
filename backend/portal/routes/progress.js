// ============================================================================
// LESSON PROGRESS (teacher writes, student reads own) and PRIVATE STUDENT NOTES
// (only the teacher who wrote them can see them)
// ============================================================================
import { Router } from "express";
import { db, C } from "../firebase.js";
import { ah, fail, nowIso, str, listData, getMany } from "../util.js";
import { requireRole } from "../middleware.js";
import { hasPerm, getUser, logActivity } from "../services/core.js";

const router = Router();
const STATUSES = ["planned", "in_progress", "completed"];

async function ownStudent(teacher, studentId) {
  const s = await getUser(studentId);
  if (!s || s.role !== "student" || s.deletedAt || s.teacherId !== teacher.id) fail(404, "Student not found");
  return s;
}

const shapeLesson = (l) => ({
  id: l.id,
  studentId: l.studentId,
  teacherId: l.teacherId,
  subject: l.subject || "",
  topic: l.topic,
  status: l.status,
  progress: l.progress ?? 0,
  date: l.date || null,
  comment: l.comment || "",
  createdAt: l.createdAt,
  updatedAt: l.updatedAt || l.createdAt,
});

function summarize(lessons) {
  const bySubject = {};
  for (const l of lessons) {
    const k = l.subject || "General";
    bySubject[k] ||= { subject: k, total: 0, completed: 0, inProgress: 0, avg: 0 };
    const s = bySubject[k];
    s.total++;
    if (l.status === "completed") s.completed++;
    if (l.status === "in_progress") s.inProgress++;
    s.avg += l.status === "completed" ? 100 : l.progress || 0;
  }
  const subjects = Object.values(bySubject).map((s) => ({ ...s, avg: s.total ? Math.round(s.avg / s.total) : 0 }));
  const total = lessons.length;
  const completed = lessons.filter((l) => l.status === "completed").length;
  return { total, completed, overall: total ? Math.round(subjects.reduce((a, s) => a + s.avg * s.total, 0) / total) : 0, subjects };
}

// ---- Lessons ---------------------------------------------------------------------
router.get(
  "/lessons",
  ah(async (req, res) => {
    const u = req.user;
    let list;
    if (u.role === "student") list = listData(await db.collection(C.lessons).where("studentId", "==", u.id).get());
    else if (u.role === "teacher") {
      list = listData(await db.collection(C.lessons).where("teacherId", "==", u.id).get());
      if (req.query.studentId) list = list.filter((l) => l.studentId === req.query.studentId);
    } else {
      if (!hasPerm(u, "users") && !hasPerm(u, "reports")) fail(403, "Not allowed");
      list = listData(await db.collection(C.lessons).get());
      if (req.query.studentId) list = list.filter((l) => l.studentId === req.query.studentId);
      if (req.query.teacherId) list = list.filter((l) => l.teacherId === req.query.teacherId);
    }
    list.sort((a, b) => ((a.date || a.createdAt) < (b.date || b.createdAt) ? 1 : -1));
    const lessons = list.map(shapeLesson);
    if (u.role !== "student") {
      const names = Object.fromEntries(Object.values(await getMany(db, C.users, list.map((l) => l.studentId))).map((s) => [s.id, s.name]));
      lessons.forEach((l) => (l.studentName = names[l.studentId] || "Student"));
    }
    res.json({ lessons, summary: summarize(list) });
  })
);

router.post(
  "/lessons",
  requireRole("teacher"),
  ah(async (req, res) => {
    const s = await ownStudent(req.user, str(req.body.studentId, 60));
    const topic = str(req.body.topic, 200);
    if (!topic) fail(400, "Enter the lesson topic");
    const status = STATUSES.includes(req.body.status) ? req.body.status : "planned";
    const doc = {
      studentId: s.id,
      teacherId: req.user.id,
      subject: str(req.body.subject, 80),
      topic,
      status,
      progress: status === "completed" ? 100 : Math.max(0, Math.min(100, Math.round(Number(req.body.progress || 0)))),
      date: str(req.body.date, 10) || null,
      comment: str(req.body.comment, 1000),
      createdAt: nowIso(),
    };
    const ref = await db.collection(C.lessons).add(doc);
    await logActivity(req, "lesson.create", { targetType: "lesson", targetId: ref.id, summary: `Added lesson "${topic}" for ${s.name}` });
    res.status(201).json({ id: ref.id });
  })
);

router.patch(
  "/lessons/:id",
  requireRole("teacher"),
  ah(async (req, res) => {
    const ref = db.collection(C.lessons).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists || snap.data().teacherId !== req.user.id) fail(404, "Lesson not found");
    const update = { updatedAt: nowIso() };
    if ("topic" in req.body) update.topic = str(req.body.topic, 200) || snap.data().topic;
    if ("subject" in req.body) update.subject = str(req.body.subject, 80);
    if ("comment" in req.body) update.comment = str(req.body.comment, 1000);
    if ("date" in req.body) update.date = str(req.body.date, 10) || null;
    if (STATUSES.includes(req.body.status)) update.status = req.body.status;
    if ("progress" in req.body) update.progress = Math.max(0, Math.min(100, Math.round(Number(req.body.progress || 0))));
    if (update.status === "completed") update.progress = 100;
    await ref.update(update);
    await logActivity(req, "lesson.update", { targetType: "lesson", targetId: snap.id, summary: `Updated lesson "${update.topic || snap.data().topic}"` });
    res.json({ ok: true });
  })
);

router.delete(
  "/lessons/:id",
  requireRole("teacher"),
  ah(async (req, res) => {
    const ref = db.collection(C.lessons).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists || snap.data().teacherId !== req.user.id) fail(404, "Lesson not found");
    await ref.delete();
    res.json({ ok: true });
  })
);

// ---- Private notes (teacher only, never shown to students or other teachers) ----------
router.get(
  "/notes",
  requireRole("teacher"),
  ah(async (req, res) => {
    let list = listData(await db.collection(C.notes).where("teacherId", "==", req.user.id).get());
    if (req.query.studentId) list = list.filter((n) => n.studentId === req.query.studentId);
    list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    res.json({ notes: list.map(({ id, studentId, text, pinned, createdAt, updatedAt }) => ({ id, studentId, text, pinned: !!pinned, createdAt, updatedAt })) });
  })
);

router.post(
  "/notes",
  requireRole("teacher"),
  ah(async (req, res) => {
    const s = await ownStudent(req.user, str(req.body.studentId, 60));
    const text = str(req.body.text, 3000);
    if (!text) fail(400, "Write a note");
    const ref = await db.collection(C.notes).add({ teacherId: req.user.id, studentId: s.id, text, pinned: !!req.body.pinned, createdAt: nowIso() });
    res.status(201).json({ id: ref.id });
  })
);

router.patch(
  "/notes/:id",
  requireRole("teacher"),
  ah(async (req, res) => {
    const ref = db.collection(C.notes).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists || snap.data().teacherId !== req.user.id) fail(404, "Note not found");
    const update = { updatedAt: nowIso() };
    if ("text" in req.body) update.text = str(req.body.text, 3000) || snap.data().text;
    if ("pinned" in req.body) update.pinned = !!req.body.pinned;
    await ref.update(update);
    res.json({ ok: true });
  })
);

router.delete(
  "/notes/:id",
  requireRole("teacher"),
  ah(async (req, res) => {
    const ref = db.collection(C.notes).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists || snap.data().teacherId !== req.user.id) fail(404, "Note not found");
    await ref.delete();
    res.json({ ok: true });
  })
);

// ---- Teacher: my students (no contact details – Mandatory rule 2) ---------------------
router.get(
  "/my-students",
  requireRole("teacher"),
  ah(async (req, res) => {
    const qs = await db.collection(C.users).where("teacherId", "==", req.user.id).get();
    const students = listData(qs).filter((s) => s.role === "student" && !s.deletedAt && !s.purged);
    const [lessons, opens, materials] = await Promise.all([
      db.collection(C.lessons).where("teacherId", "==", req.user.id).get(),
      db.collection(C.materialOpens).where("teacherId", "==", req.user.id).get(),
      db.collection(C.materials).where("teacherId", "==", req.user.id).get(),
    ]);
    const L = listData(lessons);
    const O = listData(opens);
    const M = listData(materials).filter((m) => !m.deletedAt && m.status === "published");
    res.json({
      students: students
        .map((s) => {
          const assigned = M.filter((m) => (m.studentIds || []).includes(s.id));
          const sum = summarize(L.filter((l) => l.studentId === s.id));
          return {
            id: s.id,
            name: s.name,
            grade: s.grade || "",
            board: s.board || "",
            subjects: s.subjects || [],
            active: s.active,
            lastActiveAt: s.lastLoginAt || null,
            progress: sum.overall,
            lessonsCompleted: sum.completed,
            lessonsTotal: sum.total,
            materialsAssigned: assigned.length,
            materialsOpened: O.filter((o) => o.studentId === s.id && assigned.some((m) => m.id === o.materialId)).length,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  })
);

export default router;
