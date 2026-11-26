// ============================================================================
// CORE SERVICES – settings, permissions, activity/audit logging, user shaping
// ============================================================================
import { db, C } from "../firebase.js";
import { nowIso, clientIp, getMany, fail } from "../util.js";

// ---- Settings -----------------------------------------------------------------
export const DEFAULT_SETTINGS = {
  sessionTimeoutMin: 30, // auto logout after inactivity
  maxFailedLogins: 5, // lock account after this many failures…
  lockMinutes: 15, // …for this long
  inactivityDays: 7, // student counts as inactive after N days without login
  unopenedMaterialDays: 3, // alert when assigned material stays unopened N days
  retention: {
    loginEventsDays: 180,
    activityDays: 365,
    notificationsDays: 180,
    deletedAccountDays: 30, // soft-deleted accounts are purged after N days
    backupsKeep: 14,
  },
  attendanceReminder: { enabled: true },
  classReminderMinutes: 5,
};

let cache = { at: 0, value: null };
export async function getSettings() {
  if (cache.value && Date.now() - cache.at < 30000) return cache.value;
  const snap = await db.collection(C.settings).doc("app").get();
  const stored = snap.exists ? snap.data() : {};
  const value = { ...DEFAULT_SETTINGS, ...stored, retention: { ...DEFAULT_SETTINGS.retention, ...(stored.retention || {}) } };
  cache = { at: Date.now(), value };
  return value;
}
export async function saveSettings(patch) {
  await db.collection(C.settings).doc("app").set(patch, { merge: true });
  cache = { at: 0, value: null };
  return getSettings();
}

// ---- Admin permissions ------------------------------------------------------------
// A super admin can do everything. Other admins get individual permissions.
export const ADMIN_PERMISSIONS = {
  users: "Manage students & teachers (create, edit, activate, assign)",
  contacts: "View student & teacher contact details",
  classes: "Manage classes and schedule change requests",
  materials: "Manage all learning materials",
  attendance: "Attendance reports, corrections and leave requests",
  sessions: "Create and manage academic sessions",
  fees: "Verify student fee payment proof",
  teacherPayments: "Teacher payment records (mark as paid, upload proof)",
  messages: "Read teacher–student messages",
  demos: "Demo class requests (schedule, guest links, convert to student)",
  groups: "Group chats (create groups, members, managers; read and post)",
  recordings: "Watch and delete class recordings",
  announcements: "Create and publish announcements",
  reports: "Activity logs, reports and exports",
  notifications: "Monitor and retry notifications",
  backups: "Backups and recovery",
  settings: "Security settings and admin permissions",
};

export const hasPerm = (user, perm) => user?.role === "admin" && (user.superAdmin || !!user.permissions?.[perm]);

// ---- Logging ------------------------------------------------------------------------
export async function logActivity(req, action, { targetType, targetId, summary, meta, actor } = {}) {
  const a = actor || req?.user;
  try {
    await db.collection(C.activity).add({
      at: nowIso(),
      actorId: a?.id || null,
      actorName: a?.name || null,
      actorRole: a?.role || null,
      action,
      targetType: targetType || null,
      targetId: targetId || null,
      summary: summary || "",
      meta: meta || null,
      ip: req ? clientIp(req) : null,
    });
  } catch (e) {
    console.error("activity log failed", e.message);
  }
}

// Sensitive administrative actions (account changes, restores…)
export async function audit(req, action, { targetType, targetId, summary, meta } = {}) {
  const a = req?.user;
  try {
    await db.collection(C.audit).add({
      at: nowIso(),
      actorId: a?.id || null,
      actorName: a?.name || null,
      action,
      targetType: targetType || null,
      targetId: targetId || null,
      summary: summary || "",
      meta: meta || null,
      ip: req ? clientIp(req) : null,
    });
  } catch (e) {
    console.error("audit log failed", e.message);
  }
  await logActivity(req, action, { targetType, targetId, summary });
}

// ---- User shaping (never leak contact details) -----------------------------------
const PUBLIC_FIELDS = ["id", "role", "name", "studentCode", "active", "grade", "board", "subjects", "subjectTeachers", "teacherIds", "createdAt", "lastLoginAt", "lastActiveAt", "deletedAt"];

// What a teacher may see about one of their students / what a student sees about a teacher
export function publicProfile(u) {
  if (!u) return null;
  const out = {};
  for (const k of PUBLIC_FIELDS) if (u[k] !== undefined) out[k] = u[k];
  if (u.role === "student") {
    out.subjectTeachers = subjectTeachersOf(u);
    out.teacherIds = teacherIdsOf(u);
  }
  return out;
}

// Full admin view: profile + contacts only when the admin has the "contacts" permission
export async function adminView(users, viewer) {
  const list = Array.isArray(users) ? users : [users];
  const withContacts = hasPerm(viewer, "contacts");
  const contacts = withContacts ? await getMany(db, C.contacts, list.map((u) => u.id)) : {};
  const shaped = list.map((u) => ({
    ...publicProfile(u),
    superAdmin: u.superAdmin || false,
    permissions: u.role === "admin" ? u.permissions || {} : undefined,
    lockedUntil: u.lockedUntil || null,
    failedAttempts: u.failedAttempts || 0,
    contact: withContacts ? contacts[u.id] || {} : undefined,
  }));
  return Array.isArray(users) ? shaped : shaped[0];
}

export async function getUser(id) {
  if (!id) return null;
  const snap = await db.collection(C.users).doc(id).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

export async function usersByRole(role, { activeOnly = false } = {}) {
  const qs = await db.collection(C.users).where("role", "==", role).get();
  return qs.docs.map((d) => ({ id: d.id, ...d.data() })).filter((u) => !u.purged && (!activeOnly || u.active));
}

// ---- Student ↔ teacher: one teacher per subject ----------------------------------
// A student has rows like [{ subject: "Mathematics", teacherId: "A" }, { subject: "Science", teacherId: "B" }]
// (subjectTeachers) plus the derived teacherIds list for queries. Students saved before this
// change only have one teacherId, who then counts as the teacher for all their subjects.
export const sameSubject = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

export function subjectTeachersOf(s) {
  if (!s) return [];
  if (Array.isArray(s.subjectTeachers)) return s.subjectTeachers;
  const subjects = s.subjects || [];
  if (!s.teacherId) return subjects.map((subject) => ({ subject, teacherId: null }));
  return subjects.length ? subjects.map((subject) => ({ subject, teacherId: s.teacherId })) : [{ subject: "", teacherId: s.teacherId }];
}
export const teacherIdsOf = (s) => [...new Set(subjectTeachersOf(s).map((r) => r.teacherId).filter(Boolean))];
// The subjects this teacher teaches this student ("" = an old record with no subject list)
export const subjectsTaughtBy = (s, teacherId) => subjectTeachersOf(s).filter((r) => r.teacherId === teacherId).map((r) => r.subject);
// Does this teacher teach this student (in this subject, when one is given)?
export function teachesStudent(s, teacherId, subject) {
  const rows = subjectTeachersOf(s).filter((r) => r.teacherId === teacherId);
  if (!rows.length) return false;
  return !subject || rows.some((r) => !r.subject || sameSubject(r.subject, subject));
}
// Why this teacher may not teach this student this subject (null = fine). The teacher must teach
// the student, and a subject the student takes with someone else stays with that teacher.
export function assignmentProblem(s, teacherId, subject, teacherName = "this teacher") {
  if (!teacherIdsOf(s).includes(teacherId)) return `${s.name} is not assigned to ${teacherName}`;
  if (subject) {
    const rows = subjectTeachersOf(s).filter((r) => r.subject);
    const row = rows.find((r) => sameSubject(r.subject, subject));
    if (row && row.teacherId !== teacherId) return `${s.name} takes ${row.subject} with another teacher`;
    // A subject the student doesn't take would have no session: no register, no fee lock
    if (!row && rows.length) return `${s.name} doesn't take ${subject} – add it to their subjects first`;
  }
  return null;
}
// Student as their teacher may see them: only the subject(s) that teacher teaches
export const forTeacher = (s, teacherId) => {
  const { subjectTeachers, teacherIds, teacherId: _old, ...rest } = s; // eslint-disable-line no-unused-vars
  return { ...rest, subjects: subjectsTaughtBy(s, teacherId).filter(Boolean) };
};
// Fields to save on a student from the admin's subject rows
export function assignmentFields(rows) {
  const seen = new Set();
  const subjectTeachers = [];
  for (const r of rows) {
    const subject = String(r.subject || "").trim();
    // A teacher with no subject (older records) is kept once; otherwise each subject once
    if ((!subject && !r.teacherId) || seen.has(subject.toLowerCase())) continue;
    seen.add(subject.toLowerCase());
    subjectTeachers.push({ subject, teacherId: r.teacherId || null });
  }
  return { subjectTeachers, subjects: subjectTeachers.map((r) => r.subject).filter(Boolean), teacherIds: teacherIdsOf({ subjectTeachers }), teacherId: null };
}

export async function studentsOfTeacher(teacherId, { activeOnly = false } = {}) {
  const [now, old] = await Promise.all([
    db.collection(C.users).where("teacherIds", "array-contains", teacherId).get(),
    db.collection(C.users).where("teacherId", "==", teacherId).get(),
  ]);
  const map = new Map();
  for (const d of [...now.docs, ...old.docs]) map.set(d.id, { id: d.id, ...d.data() });
  return [...map.values()].filter((u) => u.role === "student" && !u.purged && (!activeOnly || u.active) && teacherIdsOf(u).includes(teacherId));
}

// ---- The academy's subject list (admin-managed) -----------------------------------
// settings.subjects = [{ name, active }]. Every subject field in the portal is a
// dropdown from this list. While the list is empty any subject is accepted.
export async function getSubjects({ all = false } = {}) {
  const list = (await getSettings()).subjects || [];
  return all ? list : list.filter((s) => s.active !== false);
}
// The list's spelling of a subject; fails when the academy doesn't teach it
export async function canonicalSubject(name, { required = true, allowInactive = false, label = "subject" } = {}) {
  const v = String(name || "").trim();
  if (!v) {
    if (required) fail(400, `Choose the ${label}`);
    return "";
  }
  const list = await getSubjects({ all: true });
  if (!list.length) return v;
  const hit = list.find((s) => sameSubject(s.name, v) && (allowInactive || s.active !== false));
  if (!hit) {
    const old = list.find((s) => sameSubject(s.name, v));
    fail(400, old ? `${old.name} is archived – restore it on the Subjects page to use it again` : `"${v}" isn't in the academy's subject list`);
  }
  return hit.name;
}
