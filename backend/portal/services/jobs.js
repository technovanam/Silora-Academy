// ============================================================================
// SCHEDULED JOBS (node-cron, in the academy timezone)
//  • every minute  – class reminders, scheduled materials & announcements
//  • every 5 min   – retry failed notification deliveries
//  • hourly        – delete message files past their retention period, close
//                    live classes left open long after their end time
//  • daily 02:00   – backup + data-retention clean-up
//  • daily 09:00   – inactivity alert summary to admins
//  • Sat 10:00 / Sun 18:00 – weekly attendance reminders to students
// ============================================================================
import cron from "node-cron";
import config from "../config.js";
import { db, C } from "../firebase.js";
import { nowIso, addMinutes, listData, chunk, weekStartOf } from "../util.js";
import { getSettings, usersByRole } from "./core.js";
import { notify, notifyAdmins, retryNotification, MAX_ATTEMPTS } from "./notify.js";
import { createBackup } from "./backup.js";
import { computeAlerts } from "./alerts.js";
import { publishMaterial } from "../routes/materials.js";
import { deliverAnnouncement } from "../routes/notifications.js";
import { cleanupMessageFiles } from "../routes/messages.js";
import { closeForgottenRooms } from "../routes/live.js";
import { purgeUser } from "../routes/adminUsers.js";

const fmtTime = (iso) => new Intl.DateTimeFormat("en-IN", { timeZone: config.timezone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));

const running = new Set();
function guarded(name, fn) {
  return async () => {
    if (running.has(name)) return;
    running.add(name);
    try {
      await fn();
    } catch (e) {
      console.error(`[jobs] ${name} failed:`, e.message);
    } finally {
      running.delete(name);
    }
  };
}

export async function sendClassReminders() {
  const { classReminderMinutes } = await getSettings();
  const now = new Date();
  const horizon = addMinutes(now, classReminderMinutes).toISOString();
  const qs = await db.collection(C.meetings).where("startAt", ">=", now.toISOString()).get();
  const due = listData(qs).filter((m) => m.status === "scheduled" && m.startAt <= horizon && !m.reminderSentAt);
  for (const m of due) {
    await db.collection(C.meetings).doc(m.id).update({ reminderSentAt: nowIso() });
    const mins = Math.max(1, Math.round((new Date(m.startAt) - now) / 60000));
    await notify(m.studentIds || [], { type: "class_reminder", title: `Class starts in ${mins} min: ${m.title}`, body: `Starts at ${fmtTime(m.startAt)}. Tap to join the class.`, link: `/portal/class/${m.id}`, refId: m.id });
    await notify([m.teacherId], { type: "class_reminder", title: `Your class starts in ${mins} min: ${m.title}`, body: `Starts at ${fmtTime(m.startAt)} with ${(m.studentIds || []).length} student(s).`, link: `/portal/class/${m.id}`, refId: m.id });
  }
  return due.length;
}

export async function publishScheduled() {
  const now = nowIso();
  const mats = listData(await db.collection(C.materials).where("status", "==", "scheduled").get()).filter((m) => !m.deletedAt && m.publishAt && m.publishAt <= now);
  for (const m of mats) await publishMaterial(m);
  const anns = listData(await db.collection(C.announcements).get()).filter((a) => a.status !== "draft" && !a.notifiedAt && (!a.publishAt || a.publishAt <= now) && (!a.expiresAt || a.expiresAt > now));
  for (const a of anns) await deliverAnnouncement(a);
  return mats.length + anns.length;
}

export async function retryFailed() {
  const now = nowIso();
  const qs = await db.collection(C.notifications).where("nextRetryAt", "<=", now).get();
  const due = listData(qs).filter((n) => (n.attempts || 1) < MAX_ATTEMPTS && n.nextRetryAt);
  for (const n of due) await retryNotification(n.id);
  // Give up on exhausted ones so they stop showing as "will retry"
  const exhausted = listData(qs).filter((n) => (n.attempts || 1) >= MAX_ATTEMPTS);
  for (const n of exhausted) await db.collection(C.notifications).doc(n.id).update({ nextRetryAt: null });
  return due.length;
}

async function deleteWhere(collection, field, before) {
  const qs = await db.collection(collection).where(field, "<", before).get();
  for (const group of chunk(qs.docs, 400)) {
    const b = db.batch();
    group.forEach((d) => b.delete(d.ref));
    await b.commit();
  }
  return qs.size;
}

export async function retentionCleanup() {
  const { retention } = await getSettings();
  const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();
  const out = {
    loginEvents: await deleteWhere(C.loginEvents, "at", ago(retention.loginEventsDays)),
    activity: await deleteWhere(C.activity, "at", ago(retention.activityDays)),
    notifications: await deleteWhere(C.notifications, "createdAt", ago(retention.notificationsDays)),
    purgedUsers: 0,
  };
  const users = listData(await db.collection(C.users).where("purgeAfter", "<=", nowIso()).get()).filter((u) => u.deletedAt && !u.purged);
  for (const u of users) {
    await purgeUser(u.id);
    out.purgedUsers++;
  }
  if (Object.values(out).some(Boolean))
    await db.collection(C.audit).add({ at: nowIso(), actorId: null, actorName: "System", action: "retention.cleanup", targetType: "system", targetId: null, summary: `Retention clean-up: ${JSON.stringify(out)}` });
  return out;
}

export async function sendInactivityAlerts() {
  const alerts = await computeAlerts();
  const inactive = alerts.filter((a) => a.type.endsWith("_inactive"));
  if (!alerts.length) return 0;
  const parts = [];
  if (inactive.length) parts.push(`${inactive.length} inactive account${inactive.length > 1 ? "s" : ""}`);
  const unopened = alerts.filter((a) => a.type === "material_unopened").length;
  if (unopened) parts.push(`${unopened} material${unopened > 1 ? "s" : ""} not opened`);
  const att = alerts.find((a) => a.type === "attendance_missing");
  if (att) parts.push(att.title.toLowerCase());
  await notifyAdmins({ type: "inactivity_alert", title: "Daily alerts", body: parts.join(" · "), link: "/portal/admin/alerts" }, "users");
  return alerts.length;
}

export async function sendAttendanceReminders() {
  const settings = await getSettings();
  if (!settings.attendanceReminder?.enabled) return 0;
  const weekStart = weekStartOf(new Date());
  const [students, qs] = await Promise.all([usersByRole("student", { activeOnly: true }), db.collection(C.attendance).where("weekStart", "==", weekStart).get()]);
  const done = new Set(qs.docs.map((d) => d.data().studentId));
  const ids = students.filter((s) => !s.deletedAt && !done.has(s.id)).map((s) => s.id);
  await notify(ids, { type: "attendance_reminder", title: "Weekly attendance form", body: "Please fill in this week's attendance form – it only takes a minute.", link: "/portal/student/attendance" });
  return ids.length;
}

// Hour / minute / weekday in the academy timezone
function localParts(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: config.timezone, hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value]));
  return { hour: Number(p.hour), minute: Number(p.minute), weekday: p.weekday };
}

const hourlyCleanup = async () => {
  await cleanupMessageFiles();
  await closeForgottenRooms();
};

// For Cloud Scheduler (functions in scripts/build-api.mjs). Only two scheduler jobs, so
// the project stays inside the free 3 jobs: "minute" runs every minute, "hourly" every
// hour on the hour and picks the daily / weekly work by the local time.
export const JOBS = {
  minute: async () => {
    const { minute } = localParts();
    await guarded("minute", async () => { await sendClassReminders(); await publishScheduled(); })();
    if (minute % 5 === 0) await guarded("retry", retryFailed)();
  },
  hourly: async () => {
    const { hour, weekday } = localParts();
    await guarded("hourly", hourlyCleanup)();
    if (hour === 2) await guarded("nightly", async () => { await createBackup("Automatic daily backup"); await retentionCleanup(); })();
    if (hour === 9) await guarded("alerts", sendInactivityAlerts)();
    if ((weekday === "Sat" && hour === 10) || (weekday === "Sun" && hour === 18)) await guarded("attendance", sendAttendanceReminders)();
  },
};

export function startJobs() {
  if (!config.enableJobs) {
    console.log("⏸  Portal jobs disabled (ENABLE_JOBS=false)");
    return;
  }
  const tz = { timezone: config.timezone };
  cron.schedule("* * * * *", guarded("minute", async () => { await sendClassReminders(); await publishScheduled(); }), tz);
  cron.schedule("*/5 * * * *", guarded("retry", retryFailed), tz);
  cron.schedule("23 * * * *", guarded("message-files", cleanupMessageFiles), tz);
  cron.schedule("*/10 * * * *", guarded("live-rooms", closeForgottenRooms), tz);
  cron.schedule("0 2 * * *", guarded("nightly", async () => { await createBackup("Automatic daily backup"); await retentionCleanup(); }), tz);
  cron.schedule("0 9 * * *", guarded("alerts", sendInactivityAlerts), tz);
  cron.schedule("0 10 * * 6", guarded("attendance-sat", sendAttendanceReminders), tz);
  cron.schedule("0 18 * * 0", guarded("attendance-sun", sendAttendanceReminders), tz);
  console.log(`⏱  Portal jobs scheduled (${config.timezone})`);
}


