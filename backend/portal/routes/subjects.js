// ============================================================================
// SUBJECTS – the list of subjects the academy teaches (admin-managed).
// Every subject field in the portal (students' subjects & teachers, teacher
// subjects, sessions, classes, timetable, materials, lessons) is a dropdown
// from this list, so "Maths" and "Mathematics" can't drift apart.
// Stored in settings/app.subjects = [{ name, active, description, createdAt,
// updatedAt, archivedAt }]. Renaming a subject updates it everywhere; archiving
// hides it from the dropdowns (and new assignments) but keeps old records as
// they are. Subjects are never deleted.
// ============================================================================
import { Router } from "express";
import { db, C } from "../firebase.js";
import { ah, fail, str, listData } from "../util.js";
import { requireRole } from "../middleware.js";
import { audit, getSubjects, saveSettings, hasPerm, sameSubject, usersByRole, subjectTeachersOf } from "../services/core.js";
import { payId, needsProof } from "../services/fees.js";

const router = Router();
const canManage = (u) => hasPerm(u, "settings") || hasPerm(u, "users") || hasPerm(u, "sessions");
const gate = (req) => {
  if (!canManage(req.user)) fail(403, "Your admin account doesn't have this permission");
};
const now = () => new Date().toISOString();
const people = async () => [...(await usersByRole("teacher")), ...(await usersByRole("student"))].filter((u) => !u.deletedAt);
const takes = (s, name) => subjectTeachersOf(s).some((r) => sameSubject(r.subject, name));
const teaches = (t, name, students) => (t.subjects || []).some((x) => sameSubject(x, name)) || students.some((s) => subjectTeachersOf(s).some((r) => r.teacherId === t.id && sameSubject(r.subject, name)));

// Teachers and students of one subject
function usageOf(name, all) {
  const students = all.filter((u) => u.role === "student" && takes(u, name));
  const teachers = all.filter((u) => u.role === "teacher" && teaches(u, name, students));
  return { teachers, students };
}
function card(s, all, sessions) {
  const u = usageOf(s.name, all);
  return {
    name: s.name,
    active: s.active !== false,
    description: s.description || "",
    createdAt: s.createdAt || null,
    updatedAt: s.updatedAt || null,
    archivedAt: s.active === false ? s.archivedAt || null : null,
    teacherCount: u.teachers.length,
    studentCount: u.students.length,
    activeSessions: sessions.filter((x) => x.status === "active" && sameSubject(x.subject, s.name)).length,
    teachers: u.teachers.slice(0, 5).map((t) => ({ id: t.id, name: t.name })),
  };
}
async function findSubject(name) {
  const list = await getSubjects({ all: true });
  const i = list.findIndex((s) => sameSubject(s.name, name));
  if (i < 0) fail(404, "That subject isn't in the list");
  return { list, i, subject: list[i] };
}
const store = (list) => saveSettings({ subjects: [...list].sort((a, b) => a.name.localeCompare(b.name)) });
const studentSessions = async () => listData(await db.collection(C.sessions).get()).filter((x) => x.studentId);
const cleanName = (v) => {
  const name = str(v, 60).replace(/\s+/g, " ");
  if (!name) fail(400, "Give the subject a name");
  return name;
};

// Everyone signed in (dropdowns) – active subjects only, A–Z
router.get(
  "/subjects",
  ah(async (req, res) => res.json({ subjects: (await getSubjects()).map((s) => s.name).sort((a, b) => a.localeCompare(b)) }))
);

router.get(
  "/admin/subjects",
  requireRole("admin"),
  ah(async (req, res) => {
    gate(req);
    const list = await getSubjects({ all: true });
    const all = await people();
    const sessions = await studentSessions();
    // Subjects already typed on teachers/students but missing from the list – offered in "Add subject"
    const seen = new Map();
    for (const u of all) for (const x of [...(u.subjects || []), ...subjectTeachersOf(u).map((r) => r.subject)]) if (x && !seen.has(x.trim().toLowerCase())) seen.set(x.trim().toLowerCase(), x.trim());
    const suggestions = [...seen.values()].filter((x) => !list.some((s) => sameSubject(s.name, x))).sort();
    res.json({ subjects: list.map((s) => card(s, all, sessions)), suggestions });
  })
);

// One subject with its teachers and students
router.get(
  "/admin/subjects/:name",
  requireRole("admin"),
  ah(async (req, res) => {
    gate(req);
    const { subject } = await findSubject(req.params.name);
    const all = await people();
    const { teachers, students } = usageOf(subject.name, all);
    const byId = new Map(all.map((u) => [u.id, u]));
    const sessions = (await studentSessions()).filter((x) => sameSubject(x.subject, subject.name) && x.status !== "archived");
    // A student's current session of this subject: the active one, else the latest
    const current = (sid) => sessions.filter((x) => x.studentId === sid).sort((a, b) => (a.status === "active") - (b.status === "active") || (a.number || 0) - (b.number || 0)).pop() || null;
    const cur = new Map(students.map((s) => [s.id, current(s.id)]));
    const withSession = [...cur.entries()].filter(([, x]) => x && x.status === "active");
    const pays = withSession.length ? await db.getAll(...withSession.map(([sid, x]) => db.collection(C.feePayments).doc(payId(x.id, sid)))) : [];
    const pay = new Map(pays.filter((p) => p.exists).map((p) => [p.id, p.data()]));
    const feeOf = (sid, x) => {
      if (!x || x.status !== "active") return null;
      const p = pay.get(payId(x.id, sid));
      if (p?.verification === "rejected") return "rejected";
      if (needsProof(p)) return "pending";
      return p.verification === "verified" ? "verified" : "submitted";
    };
    res.json({
      subject: card(subject, all, sessions),
      teachers: teachers.map((t) => {
        const mine = students.filter((s) => subjectTeachersOf(s).some((r) => r.teacherId === t.id && sameSubject(r.subject, subject.name)));
        return {
          id: t.id,
          name: t.name,
          active: t.active !== false,
          subjects: t.subjects || [],
          studentCount: mine.length,
          activeSessions: sessions.filter((x) => x.teacherId === t.id && x.status === "active").length,
          lastActiveAt: t.lastActiveAt || null,
        };
      }),
      students: students.map((s) => {
        const row = subjectTeachersOf(s).find((r) => sameSubject(r.subject, subject.name));
        const x = cur.get(s.id);
        return {
          id: s.id,
          name: s.name,
          studentCode: s.studentCode || "",
          grade: s.grade || "",
          board: s.board || "",
          active: s.active !== false,
          teacherId: row?.teacherId || "",
          teacherName: byId.get(row?.teacherId)?.name || "",
          session: x ? { id: x.id, number: x.number || null, startDate: x.startDate, endDate: x.endDate, status: x.status } : null,
          fee: feeOf(s.id, x),
        };
      }),
    });
  })
);

// Add a subject
router.post(
  "/admin/subjects",
  requireRole("admin"),
  ah(async (req, res) => {
    gate(req);
    const name = cleanName(req.body.name);
    const list = await getSubjects({ all: true });
    const hit = list.find((s) => sameSubject(s.name, name));
    if (hit) fail(400, hit.active === false ? `${hit.name} is archived – restore it instead` : `${hit.name} is already in the list`);
    await store([...list, { name, active: true, description: str(req.body.description, 200), createdAt: now(), updatedAt: now(), archivedAt: null }]);
    await audit(req, "subjects.create", { targetType: "subject", targetId: name, summary: `Added the subject ${name}` });
    res.json({ ok: true, name });
  })
);

// Edit: rename (updated everywhere) and/or description
router.patch(
  "/admin/subjects/:name",
  requireRole("admin"),
  ah(async (req, res) => {
    gate(req);
    const { list, i, subject } = await findSubject(req.params.name);
    const name = req.body.name === undefined ? subject.name : cleanName(req.body.name);
    const clash = list.find((s, k) => k !== i && sameSubject(s.name, name));
    if (clash) fail(400, `${clash.name} is already in the list${clash.active === false ? " (archived)" : ""}`);
    const renamed = name !== subject.name ? await renameEverywhere(subject.name, name) : 0;
    const next = [...list];
    next[i] = { ...subject, name, description: req.body.description === undefined ? subject.description || "" : str(req.body.description, 200), updatedAt: now() };
    await store(next);
    await audit(req, "subjects.update", {
      targetType: "subject",
      targetId: name,
      summary: name !== subject.name ? `Renamed the subject ${subject.name} → ${name} (${renamed} records updated)` : `Edited the subject ${name}`,
    });
    res.json({ ok: true, name, renamed });
  })
);

// Archive / restore – subjects are never deleted, so old records keep theirs
for (const [action, active] of [["archive", false], ["restore", true]]) {
  router.post(
    `/admin/subjects/:name/${action}`,
    requireRole("admin"),
    ah(async (req, res) => {
      gate(req);
      const { list, i, subject } = await findSubject(req.params.name);
      if ((subject.active !== false) === active) fail(400, `${subject.name} is already ${active ? "active" : "archived"}`);
      const next = [...list];
      next[i] = { ...subject, active, updatedAt: now(), archivedAt: active ? null : now() };
      await store(next);
      await audit(req, `subjects.${action}`, { targetType: "subject", targetId: subject.name, summary: `${active ? "Restored" : "Archived"} the subject ${subject.name}` });
      res.json({ ok: true });
    })
  );
}

// Rename a subject in every record that uses it
async function renameEverywhere(from, to) {
  let changed = 0;
  const fix = (v) => (sameSubject(v, from) ? to : v);
  for (const u of listData(await db.collection(C.users).where("role", "in", ["teacher", "student"]).get())) {
    const patch = {};
    if ((u.subjects || []).some((x) => sameSubject(x, from))) patch.subjects = u.subjects.map(fix);
    if (Array.isArray(u.subjectTeachers) && u.subjectTeachers.some((r) => sameSubject(r.subject, from))) patch.subjectTeachers = u.subjectTeachers.map((r) => ({ ...r, subject: fix(r.subject) }));
    if (Object.keys(patch).length) {
      await db.collection(C.users).doc(u.id).update(patch);
      changed++;
    }
  }
  for (const col of [C.meetings, C.timetable, C.materials, C.lessons, C.leaveRequests, C.classAttendance, C.feePayments]) {
    for (const d of listData(await db.collection(col).get())) {
      if (!d.subject || !sameSubject(d.subject, from)) continue;
      const patch = { subject: to };
      if (col === C.feePayments && d.sessionName) patch.sessionName = d.sessionName.replace(d.subject, to);
      await db.collection(col).doc(d.id).update(patch);
      changed++;
    }
  }
  for (const s of listData(await db.collection(C.sessions).get())) {
    if (!sameSubject(s.subject, from)) continue;
    await db.collection(C.sessions).doc(s.id).update({ subject: to, name: (s.name || "").replace(s.subject, to), subjects: (s.subjects || []).map((x) => ({ ...x, subject: fix(x.subject) })) });
    changed++;
  }
  for (const p of listData(await db.collection(C.teacherPayments).get())) {
    if (!(p.subjects || []).some((x) => sameSubject(x.subject, from))) continue;
    await db.collection(C.teacherPayments).doc(p.id).update({ subjects: p.subjects.map((x) => ({ ...x, subject: fix(x.subject) })), ...(p.sessionName ? { sessionName: p.sessionName.replace(p.subjects[0]?.subject || from, to) } : {}) });
    changed++;
  }
  return changed;
}

// Older bulk save of the whole list, kept for compatibility. Subjects can't be removed here either.
// Body: { subjects: [{ name, active, from? }] } – "from" = the old name when renamed
router.put(
  "/admin/subjects",
  requireRole("admin"),
  ah(async (req, res) => {
    gate(req);
    const before = await getSubjects({ all: true });
    const rows = (Array.isArray(req.body.subjects) ? req.body.subjects : []).slice(0, 200).map((s) => ({ name: str(s?.name, 60), active: s?.active !== false, from: str(s?.from, 60) }));
    if (rows.some((r) => !r.name)) fail(400, "Every subject needs a name");
    const names = rows.map((r) => r.name.toLowerCase());
    if (new Set(names).size !== names.length) fail(400, "Each subject can only be listed once");
    const removed = before.filter((b) => !rows.some((r) => sameSubject(r.name, b.name) || sameSubject(r.from, b.name)));
    if (removed.length) fail(400, `Subjects can't be deleted – archive ${removed[0].name} instead`);
    let renamed = 0;
    for (const r of rows) if (r.from && r.from !== r.name && before.some((b) => sameSubject(b.name, r.from))) renamed += await renameEverywhere(r.from, r.name);
    await store(
      rows.map((r) => {
        const o = before.find((b) => sameSubject(b.name, r.from || r.name)) || {};
        const changed = o.name !== r.name || (o.active !== false) !== r.active;
        return { ...o, name: r.name, active: r.active, createdAt: o.createdAt || now(), updatedAt: changed ? now() : o.updatedAt || now(), archivedAt: r.active ? null : o.archivedAt || now() };
      })
    );
    await audit(req, "subjects.update", { targetType: "settings", targetId: "subjects", summary: `Updated the subject list (${rows.filter((r) => r.active).length} active)${renamed ? ` – renamed in ${renamed} records` : ""}` });
    res.json({ subjects: await getSubjects({ all: true }), renamed });
  })
);

export default router;
