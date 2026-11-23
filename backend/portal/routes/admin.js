// ============================================================================
// ADMIN: logs, reports & exports, alerts, security settings, backups
// Mounted under /api/portal/admin (authenticate + requireRole("admin") applied)
// ============================================================================
import { Router } from "express";
import { db, C, BACKUP_COLLECTIONS } from "../firebase.js";
import { ah, fail, listData, toCsv, getMany, plural } from "../util.js";
import { requirePerm, requireSuperAdmin } from "../middleware.js";
import { getSettings, saveSettings, DEFAULT_SETTINGS, usersByRole, audit } from "../services/core.js";
import { computeAlerts } from "../services/alerts.js";
import { createBackup, listBackups, restoreBackup } from "../services/backup.js";
import { deviceLabel } from "./auth.js";
import { weekRows } from "./attendance.js";
import { weekStartOf } from "../util.js";

const router = Router();

function sinceFilter(list, days, field = "at") {
  if (!days) return list;
  const since = new Date(Date.now() - Number(days) * 86400000).toISOString();
  return list.filter((r) => (r[field] || "") >= since);
}
function sendCsv(res, name, rows, columns) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(toCsv(rows, columns));
}

// ---- Logs ----------------------------------------------------------------------------
router.get(
  "/logs/activity",
  requirePerm("reports"),
  ah(async (req, res) => {
    let list = sinceFilter(listData(await db.collection(C.activity).get()), req.query.days || 30);
    if (req.query.role) list = list.filter((r) => r.actorRole === req.query.role);
    if (req.query.userId) list = list.filter((r) => r.actorId === req.query.userId);
    if (req.query.action) list = list.filter((r) => (r.action || "").startsWith(req.query.action));
    if (req.query.q) {
      const q = String(req.query.q).toLowerCase();
      list = list.filter((r) => `${r.actorName} ${r.summary} ${r.action}`.toLowerCase().includes(q));
    }
    list.sort((a, b) => (a.at < b.at ? 1 : -1));
    res.json({ logs: list.slice(0, 1000).map(({ meta, ...r }) => r), total: list.length });
  })
);

router.get(
  "/logs/audit",
  requirePerm("reports"),
  ah(async (req, res) => {
    let list = sinceFilter(listData(await db.collection(C.audit).get()), req.query.days || 90);
    if (req.query.q) {
      const q = String(req.query.q).toLowerCase();
      list = list.filter((r) => `${r.actorName} ${r.summary} ${r.action}`.toLowerCase().includes(q));
    }
    list.sort((a, b) => (a.at < b.at ? 1 : -1));
    res.json({ logs: list.slice(0, 1000), total: list.length });
  })
);

router.get(
  "/logs/logins",
  requirePerm("reports"),
  ah(async (req, res) => {
    let list = sinceFilter(listData(await db.collection(C.loginEvents).get()), req.query.days || 30);
    if (req.query.result === "failed") list = list.filter((r) => !r.success);
    if (req.query.result === "success") list = list.filter((r) => r.success);
    if (req.query.userId) list = list.filter((r) => r.uid === req.query.userId);
    if (req.query.q) {
      const q = String(req.query.q).toLowerCase();
      list = list.filter((r) => `${r.name || ""} ${r.email || ""} ${r.ip}`.toLowerCase().includes(q));
    }
    list.sort((a, b) => (a.at < b.at ? 1 : -1));
    const failed = list.filter((r) => !r.success);
    res.json({
      stats: { total: list.length, failed: failed.length, locked: failed.filter((r) => r.reason === "locked").length },
      logs: list.slice(0, 1000).map(({ userAgent, ...r }) => ({ ...r, device: deviceLabel(userAgent || "") })),
    });
  })
);

// ---- Alerts ----------------------------------------------------------------------------
router.get(
  "/alerts",
  ah(async (req, res) => {
    res.json({ alerts: await computeAlerts(), settings: await getSettings() });
  })
);

// ---- Reports & exports -----------------------------------------------------------------
const REPORTS = {
  students: {
    title: "Students",
    async rows() {
      const [students, teachers] = await Promise.all([usersByRole("student"), usersByRole("teacher")]);
      const t = Object.fromEntries(teachers.map((x) => [x.id, x.name]));
      return students.filter((s) => !s.deletedAt).map((s) => ({ name: s.name, grade: s.grade, board: s.board, subjects: s.subjects, teacher: t[s.teacherId] || "", status: s.active ? "Active" : "Inactive", createdAt: s.createdAt, lastLoginAt: s.lastLoginAt || "" }));
    },
    columns: ["name", "grade", "board", "subjects", "teacher", "status", "createdAt", "lastLoginAt"],
  },
  teachers: {
    title: "Teachers & workload",
    async rows() {
      const [teachers, students, meetings] = await Promise.all([usersByRole("teacher"), usersByRole("student"), db.collection(C.meetings).get().then(listData)]);
      const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();
      return teachers
        .filter((t) => !t.deletedAt)
        .map((t) => {
          const mine = meetings.filter((m) => m.teacherId === t.id);
          return {
            name: t.name,
            subjects: t.subjects,
            status: t.active ? "Active" : "Inactive",
            students: students.filter((s) => s.teacherId === t.id && !s.deletedAt).length,
            classesLast30Days: mine.filter((m) => m.status !== "cancelled" && m.startAt >= monthAgo && m.startAt <= new Date().toISOString()).length,
            hoursLast30Days: Math.round((mine.filter((m) => m.status !== "cancelled" && m.startAt >= monthAgo && m.startAt <= new Date().toISOString()).reduce((a, m) => a + (m.durationMin || 0), 0) / 60) * 10) / 10,
            upcomingClasses: mine.filter((m) => m.status === "scheduled" && m.startAt > new Date().toISOString()).length,
            lastLoginAt: t.lastLoginAt || "",
          };
        });
    },
    columns: ["name", "subjects", "status", "students", "classesLast30Days", "hoursLast30Days", "upcomingClasses", "lastLoginAt"],
  },
  classes: {
    title: "Classes",
    async rows(q) {
      let list = listData(await db.collection(C.meetings).get());
      if (q.from) list = list.filter((m) => m.startAt >= q.from);
      if (q.to) list = list.filter((m) => m.startAt <= q.to);
      const users = await getMany(db, C.users, list.flatMap((m) => [m.teacherId, ...(m.studentIds || [])]));
      const now = new Date().toISOString();
      return list
        .sort((a, b) => (a.startAt < b.startAt ? 1 : -1))
        .map((m) => ({ title: m.title, subject: m.subject, teacher: users[m.teacherId]?.name, students: (m.studentIds || []).map((id) => users[id]?.name || ""), startAt: m.startAt, durationMin: m.durationMin, status: m.status === "scheduled" && m.endAt < now ? "completed" : m.status }));
    },
    columns: ["title", "subject", "teacher", "students", "startAt", "durationMin", "status"],
  },
  attendance: {
    title: "Attendance (one week)",
    perm: "attendance",
    async rows(q) {
      const rows = await weekRows(q.weekStart || weekStartOf(new Date()));
      return rows.map((r) => ({ student: r.studentName, grade: r.grade, teacher: r.teacherName, week: r.weekStart, status: r.status, weekend: r.entry?.weekendAttendance || "", classesAttended: r.entry?.classesAttended ?? "", lessonsCovered: r.entry?.lessonsCovered || "", rating: r.entry?.rating ?? "", remarks: r.entry?.remarks || "" }));
    },
    columns: ["student", "grade", "teacher", "week", "status", "weekend", "classesAttended", "lessonsCovered", "rating", "remarks"],
  },
  materials: {
    title: "Materials (opened tracking)",
    async rows() {
      const [materials, opens] = await Promise.all([db.collection(C.materials).get().then(listData), db.collection(C.materialOpens).get().then(listData)]);
      const live = materials.filter((m) => !m.deletedAt);
      const users = await getMany(db, C.users, live.map((m) => m.teacherId));
      return live.map((m) => {
        const assigned = m.studentIds || [];
        const opened = opens.filter((o) => o.materialId === m.id && assigned.includes(o.studentId)).length;
        return { title: m.title, subject: m.subject, teacher: users[m.teacherId]?.name || "", type: m.file?.kind, version: m.version, status: m.status, publishedAt: m.publishedAt || "", assigned: assigned.length, opened, notOpened: assigned.length - opened };
      });
    },
    columns: ["title", "subject", "teacher", "type", "version", "status", "publishedAt", "assigned", "opened", "notOpened"],
  },
  // Activity log & login history have their own tabs (and CSV export there), so they're not in the report list
  activity: {
    title: "Activity log",
    listed: false,
    async rows(q) {
      return sinceFilter(listData(await db.collection(C.activity).get()), q.days || 30)
        .sort((a, b) => (a.at < b.at ? 1 : -1))
        .map((r) => ({ at: r.at, user: r.actorName, role: r.actorRole, action: r.action, summary: r.summary }));
    },
    columns: ["at", "user", "role", "action", "summary"],
  },
  logins: {
    title: "Login history",
    listed: false,
    async rows(q) {
      return sinceFilter(listData(await db.collection(C.loginEvents).get()), q.days || 30)
        .sort((a, b) => (a.at < b.at ? 1 : -1))
        .map((r) => ({ at: r.at, user: r.name || "", role: r.role || "", result: r.success ? "Success" : "Failed", reason: r.reason || "", ip: r.ip, device: deviceLabel(r.userAgent || "") }));
    },
    columns: ["at", "user", "role", "result", "reason", "ip", "device"],
  },
  notifications: {
    title: "Notification delivery",
    perm: "notifications",
    async rows(q) {
      return sinceFilter(listData(await db.collection(C.notifications).get()), q.days || 30, "createdAt")
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .map((n) => ({ createdAt: n.createdAt, user: n.userName, role: n.userRole, type: n.typeLabel, title: n.title, inApp: n.channels?.inApp?.status, email: n.channels?.email?.status, push: n.channels?.push?.status, read: n.read ? "Yes" : "No", attempts: n.attempts }));
    },
    columns: ["createdAt", "user", "role", "type", "title", "inApp", "email", "push", "read", "attempts"],
  },
};
const label = (k) => k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

router.get("/reports", requirePerm("reports"), (req, res) => res.json({ reports: Object.entries(REPORTS).filter(([, r]) => r.listed !== false).map(([id, r]) => ({ id, title: r.title })) }));

router.get(
  "/reports/:id",
  requirePerm("reports"),
  ah(async (req, res) => {
    const r = REPORTS[req.params.id];
    if (!r) fail(404, "Unknown report");
    if (r.perm && !(req.user.superAdmin || req.user.permissions?.[r.perm])) fail(403, `This report needs the ${r.perm} permission`);
    const rows = await r.rows(req.query);
    const columns = r.columns.map((key) => ({ key, label: label(key) }));
    await audit(req, "report.export", { targetType: "report", targetId: req.params.id, summary: `Viewed/exported report "${r.title}"${req.query.format === "csv" ? " (CSV)" : ""}` });
    if (req.query.format === "csv") return sendCsv(res, req.params.id, rows, columns);
    res.json({ title: r.title, columns, rows });
  })
);

// ---- Settings (security, retention, reminders) ------------------------------------------
router.get(
  "/settings",
  requirePerm("settings"),
  ah(async (req, res) => res.json({ settings: await getSettings(), defaults: DEFAULT_SETTINGS }))
);

router.patch(
  "/settings",
  requirePerm("settings"),
  ah(async (req, res) => {
    const b = req.body || {};
    const n = (v, min, max) => {
      const x = Math.round(Number(v));
      if (!(x >= min && x <= max)) fail(400, `Value must be between ${min} and ${max}`);
      return x;
    };
    const patch = {};
    if ("sessionTimeoutMin" in b) patch.sessionTimeoutMin = n(b.sessionTimeoutMin, 5, 480);
    if ("maxFailedLogins" in b) patch.maxFailedLogins = n(b.maxFailedLogins, 3, 20);
    if ("lockMinutes" in b) patch.lockMinutes = n(b.lockMinutes, 1, 1440);
    if ("inactivityDays" in b) patch.inactivityDays = n(b.inactivityDays, 1, 90);
    if ("unopenedMaterialDays" in b) patch.unopenedMaterialDays = n(b.unopenedMaterialDays, 1, 60);
    if ("classReminderMinutes" in b) patch.classReminderMinutes = n(b.classReminderMinutes, 1, 120);
    if (b.attendanceReminder) patch.attendanceReminder = { enabled: !!b.attendanceReminder.enabled };
    if (b.retention) {
      const r = b.retention;
      patch.retention = {};
      if ("loginEventsDays" in r) patch.retention.loginEventsDays = n(r.loginEventsDays, 30, 3650);
      if ("activityDays" in r) patch.retention.activityDays = n(r.activityDays, 30, 3650);
      if ("notificationsDays" in r) patch.retention.notificationsDays = n(r.notificationsDays, 7, 3650);
      if ("deletedAccountDays" in r) patch.retention.deletedAccountDays = n(r.deletedAccountDays, 1, 365);
      if ("backupsKeep" in r) patch.retention.backupsKeep = n(r.backupsKeep, 1, 90);
    }
    const settings = await saveSettings(patch);
    await audit(req, "settings.update", { targetType: "settings", summary: `Updated settings: ${Object.keys(patch).join(", ")}`, meta: patch });
    res.json({ settings });
  })
);

// ---- Backups & recovery -----------------------------------------------------------------
router.get(
  "/backups",
  requirePerm("backups"),
  ah(async (req, res) => res.json({ backups: await listBackups(), collections: BACKUP_COLLECTIONS }))
);

router.post(
  "/backups",
  requirePerm("backups"),
  ah(async (req, res) => {
    const b = await createBackup(req.user.name);
    await audit(req, "backup.create", { targetType: "backup", targetId: b.id, summary: `Created backup (${plural(b.docs, "record")})` });
    res.status(201).json({ backup: b });
  })
);

router.post(
  "/backups/:id/restore",
  requireSuperAdmin,
  ah(async (req, res) => {
    if (req.body?.confirm !== "RESTORE") fail(400, 'Type RESTORE to confirm');
    const collections = Array.isArray(req.body.collections) && req.body.collections.length ? req.body.collections.filter((c) => BACKUP_COLLECTIONS.includes(c)) : BACKUP_COLLECTIONS;
    // Safety copy of the current state first
    const safety = await createBackup(`${req.user.name} (before restore)`);
    let result;
    try {
      result = await restoreBackup(req.params.id, collections);
    } catch (e) {
      fail(e.status || 500, e.message);
    }
    await audit(req, "backup.restore", { targetType: "backup", targetId: req.params.id, summary: `Restored backup ${req.params.id} (${plural(collections.length, "collection")}). Safety backup: ${safety.id}`, meta: result });
    res.json({ ok: true, ...result, safetyBackup: safety.id });
  })
);

export default router;
