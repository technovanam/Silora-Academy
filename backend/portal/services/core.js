// ============================================================================
// CORE SERVICES – settings, permissions, activity/audit logging, user shaping
// ============================================================================
import { db, C } from "../firebase.js";
import { nowIso, clientIp, getMany } from "../util.js";

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
  attendance: "View and correct attendance forms",
  recordings: "View and play class recordings",
  messages: "Read teacher–student messages",
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

// Sensitive administrative actions (account changes, recordings, restores…)
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
const PUBLIC_FIELDS = ["id", "role", "name", "active", "grade", "board", "subjects", "teacherId", "createdAt", "lastLoginAt", "lastActiveAt", "deletedAt"];

// What a teacher may see about one of their students / what a student sees about a teacher
export function publicProfile(u) {
  if (!u) return null;
  const out = {};
  for (const k of PUBLIC_FIELDS) if (u[k] !== undefined) out[k] = u[k];
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

export async function studentsOfTeacher(teacherId, { activeOnly = false } = {}) {
  const qs = await db.collection(C.users).where("teacherId", "==", teacherId).get();
  return qs.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((u) => u.role === "student" && !u.purged && (!activeOnly || u.active));
}
