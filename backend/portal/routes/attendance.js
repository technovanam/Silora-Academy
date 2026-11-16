// ============================================================================
// WEEKLY ATTENDANCE FORMS
// Students submit one form per week. Admins (with "attendance") see everything
// and can correct entries (audited). Teachers have NO access (requirement).
// ============================================================================
import { Router } from "express";
import config from "../config.js";
import { db, C } from "../firebase.js";
import { ah, fail, nowIso, str, listData, weekStartOf, shiftWeek, toCsv } from "../util.js";
import { requireRole, requirePerm } from "../middleware.js";
import { usersByRole, audit, logActivity } from "../services/core.js";

const router = Router();
const WEEKEND = ["yes", "partial", "no"];
const docId = (studentId, weekStart) => `${studentId}_${weekStart}`;
const validWeek = (w) => /^\d{4}-\d{2}-\d{2}$/.test(w || "") && new Date(`${w}T00:00:00Z`).getUTCDay() === 1;

function cleanForm(body) {
  const weekendAttendance = WEEKEND.includes(body.weekendAttendance) ? body.weekendAttendance : null;
  if (!weekendAttendance) fail(400, "Tell us about weekend attendance");
  const classesAttended = Math.round(Number(body.classesAttended));
  if (!(classesAttended >= 0 && classesAttended <= 50)) fail(400, "Enter how many classes were attended");
  const lessonsCovered = str(body.lessonsCovered, 2000);
  if (!lessonsCovered) fail(400, "List the lessons covered this week");
  const rating = Math.round(Number(body.rating || 0));
  return {
    weekendAttendance,
    classesAttended,
    lessonsCovered,
    rating: rating >= 1 && rating <= 5 ? rating : null,
    review: str(body.review, 2000),
    remarks: str(body.remarks, 2000),
  };
}

// Deadline: the Monday after the week (end of Sunday + 1 day grace)
const deadlineOf = (weekStart) => `${shiftWeek(weekStart, 1)}T23:59:59`;

function statusOf(entry, weekStart, currentWeek) {
  if (entry) return entry.correctedAt ? "corrected" : entry.late ? "late" : "submitted";
  if (weekStart >= currentWeek) return "open";
  return "missing";
}

// ---- Student --------------------------------------------------------------------------
router.get(
  "/attendance/me",
  requireRole("student"),
  ah(async (req, res) => {
    const list = listData(await db.collection(C.attendance).where("studentId", "==", req.user.id).get());
    const byWeek = Object.fromEntries(list.map((a) => [a.weekStart, a]));
    const currentWeek = weekStartOf(new Date());
    const since = (req.user.createdAt && weekStartOf(req.user.createdAt)) || currentWeek;
    const weeks = [];
    for (let w = currentWeek, i = 0; w >= since && i < 26; w = shiftWeek(w, -1), i++) {
      const e = byWeek[w];
      weeks.push({ weekStart: w, status: statusOf(e, w, currentWeek), entry: e ? strip(e) : null, editable: canEdit(e, w, currentWeek) });
    }
    res.json({ currentWeek, weeks, timezone: config.timezone });
  })
);

function strip(a) {
  const { studentName, ...rest } = a;
  return rest;
}
function canEdit(entry, weekStart, currentWeek) {
  if (entry?.correctedAt) return false; // locked after an admin correction
  return weekStart === currentWeek || weekStart === shiftWeek(currentWeek, -1);
}

router.put(
  "/attendance/me/:weekStart",
  requireRole("student"),
  ah(async (req, res) => {
    const weekStart = req.params.weekStart;
    if (!validWeek(weekStart)) fail(400, "Invalid week");
    const currentWeek = weekStartOf(new Date());
    const ref = db.collection(C.attendance).doc(docId(req.user.id, weekStart));
    const snap = await ref.get();
    const existing = snap.exists ? snap.data() : null;
    if (!canEdit(existing, weekStart, currentWeek)) fail(400, existing?.correctedAt ? "This week was reviewed by the academy and can't be changed" : "You can only submit for this week or last week");
    const form = cleanForm(req.body || {});
    const at = nowIso();
    const late = !existing && at.slice(0, 10) > deadlineOf(weekStart).slice(0, 10);
    await ref.set(
      {
        studentId: req.user.id,
        studentName: req.user.name,
        teacherId: req.user.teacherId || null,
        weekStart,
        ...form,
        submittedAt: existing?.submittedAt || at,
        updatedAt: at,
        late: existing ? !!existing.late : late,
        history: [...(existing?.history || []), { at, by: req.user.id, action: existing ? "edited" : "submitted" }].slice(-20),
      },
      { merge: true }
    );
    await logActivity(req, existing ? "attendance.edit" : "attendance.submit", { targetType: "attendance", targetId: docId(req.user.id, weekStart), summary: `${existing ? "Updated" : "Submitted"} attendance for week of ${weekStart}` });
    res.json({ ok: true });
  })
);

// ---- Admin ------------------------------------------------------------------------------
async function weekRows(weekStart) {
  const [students, qs] = await Promise.all([usersByRole("student"), db.collection(C.attendance).where("weekStart", "==", weekStart).get()]);
  const entries = Object.fromEntries(listData(qs).map((a) => [a.studentId, a]));
  const teachers = Object.fromEntries((await usersByRole("teacher")).map((t) => [t.id, t.name]));
  const currentWeek = weekStartOf(new Date());
  return students
    .filter((s) => !s.deletedAt && (s.active || entries[s.id]) && (!s.createdAt || weekStartOf(s.createdAt) <= weekStart))
    .map((s) => {
      const e = entries[s.id];
      return {
        id: docId(s.id, weekStart),
        studentId: s.id,
        studentName: s.name,
        grade: s.grade || "",
        teacherName: teachers[s.teacherId] || "",
        weekStart,
        status: statusOf(e, weekStart, currentWeek),
        entry: e || null,
      };
    })
    .sort((a, b) => a.studentName.localeCompare(b.studentName));
}

router.get(
  "/admin/attendance",
  requireRole("admin"),
  requirePerm("attendance"),
  ah(async (req, res) => {
    const weekStart = validWeek(req.query.weekStart) ? req.query.weekStart : weekStartOf(new Date());
    let rows = await weekRows(weekStart);
    if (req.query.status) rows = rows.filter((r) => (req.query.status === "pending" ? ["open", "missing"].includes(r.status) : r.status === req.query.status));
    if (req.query.format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="attendance-${weekStart}.csv"`);
      return res.send(
        toCsv(rows, [
          { label: "Student", key: "studentName" },
          { label: "Grade", key: "grade" },
          { label: "Teacher", key: "teacherName" },
          { label: "Week", key: "weekStart" },
          { label: "Status", key: "status" },
          { label: "Weekend attendance", value: (r) => r.entry?.weekendAttendance },
          { label: "Classes attended", value: (r) => r.entry?.classesAttended },
          { label: "Lessons covered", value: (r) => r.entry?.lessonsCovered },
          { label: "Rating", value: (r) => r.entry?.rating },
          { label: "Review", value: (r) => r.entry?.review },
          { label: "Remarks", value: (r) => r.entry?.remarks },
          { label: "Submitted at", value: (r) => r.entry?.submittedAt },
        ])
      );
    }
    const all = await weekRows(weekStart);
    const count = (st) => all.filter((r) => r.status === st).length;
    res.json({
      weekStart,
      currentWeek: weekStartOf(new Date()),
      rows,
      stats: { total: all.length, submitted: count("submitted") + count("corrected") + count("late"), late: count("late"), pending: count("open") + count("missing") },
    });
  })
);

router.get(
  "/admin/attendance/student/:studentId",
  requireRole("admin"),
  requirePerm("attendance"),
  ah(async (req, res) => {
    const list = listData(await db.collection(C.attendance).where("studentId", "==", req.params.studentId).get()).sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1));
    res.json({ entries: list });
  })
);

// Correct (or fill in) an entry on behalf of a student – audited
router.put(
  "/admin/attendance/:studentId/:weekStart",
  requireRole("admin"),
  requirePerm("attendance"),
  ah(async (req, res) => {
    const { studentId, weekStart } = req.params;
    if (!validWeek(weekStart)) fail(400, "Invalid week");
    const reason = str(req.body.reason, 500);
    if (!reason) fail(400, "Add a reason for the correction");
    const sSnap = await db.collection(C.users).doc(studentId).get();
    if (!sSnap.exists || sSnap.data().role !== "student") fail(404, "Student not found");
    const ref = db.collection(C.attendance).doc(docId(studentId, weekStart));
    const snap = await ref.get();
    const before = snap.exists ? snap.data() : null;
    const form = cleanForm(req.body || {});
    const at = nowIso();
    await ref.set(
      {
        studentId,
        studentName: sSnap.data().name,
        teacherId: sSnap.data().teacherId || null,
        weekStart,
        ...form,
        submittedAt: before?.submittedAt || at,
        updatedAt: at,
        correctedAt: at,
        correctedBy: req.user.id,
        correctedByName: req.user.name,
        correctionReason: reason,
        history: [...(before?.history || []), { at, by: req.user.id, action: before ? "corrected" : "filled_by_admin", reason }].slice(-20),
      },
      { merge: true }
    );
    await audit(req, "attendance.correct", {
      targetType: "attendance",
      targetId: docId(studentId, weekStart),
      summary: `${before ? "Corrected" : "Filled"} attendance for ${sSnap.data().name}, week of ${weekStart}`,
      meta: { reason, before: before ? cleanSafe(before) : null, after: form },
    });
    res.json({ ok: true });
  })
);

const cleanSafe = ({ weekendAttendance, classesAttended, lessonsCovered, rating, review, remarks }) => ({ weekendAttendance, classesAttended, lessonsCovered, rating, review, remarks });

export { weekRows };
export default router;
