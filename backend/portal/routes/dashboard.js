// ============================================================================
// DASHBOARDS – one endpoint, shaped per role
// ============================================================================
import { Router } from "express";
import { db, C } from "../firebase.js";
import { ah, listData, getMany, weekStartOf, nowIso, localDateOf } from "../util.js";
import { hasPerm, usersByRole } from "../services/core.js";
import { computeAlerts } from "../services/alerts.js";

const router = Router();
const now = () => nowIso();
const dayAhead = () => new Date(Date.now() + 7 * 86400000).toISOString();

const slimMeeting = (m, names, forStudent) => ({
  id: m.id,
  title: m.title,
  subject: m.subject || "",
  startAt: m.startAt,
  endAt: m.endAt,
  durationMin: m.durationMin,
  status: m.status,
  teacherName: names[m.teacherId] || "",
  ...(forStudent ? {} : { students: (m.studentIds || []).map((id) => names[id] || "Student") }),
});

async function nameMap(ids) {
  return Object.fromEntries(Object.values(await getMany(db, C.users, ids)).map((u) => [u.id, u.name]));
}

async function unreadAnnouncements(user) {
  const all = listData(await db.collection(C.announcements).get());
  const t = now();
  const live = all.filter(
    (a) =>
      a.status !== "draft" &&
      (!a.publishAt || a.publishAt <= t) &&
      (!a.expiresAt || a.expiresAt > t) &&
      (a.audience === "all" || (a.audience === "students" && user.role === "student") || (a.audience === "teachers" && user.role === "teacher") || (a.audience === "selected" && (a.userIds || []).includes(user.id)))
  );
  const reads = new Set(listData(await db.collection(C.announcementReads).where("userId", "==", user.id).get()).map((r) => r.announcementId));
  return live
    .filter((a) => !reads.has(a.id))
    .sort((a, b) => ((a.publishAt || a.createdAt) < (b.publishAt || b.createdAt) ? 1 : -1))
    .slice(0, 3)
    .map((a) => ({ id: a.id, title: a.title, priority: a.priority, publishedAt: a.publishAt || a.createdAt }));
}

router.get(
  "/dashboard",
  ah(async (req, res) => {
    const u = req.user;

    if (u.role === "student") {
      const [meetings, materials, opens, attendance, lessons] = await Promise.all([
        db.collection(C.meetings).where("studentIds", "array-contains", u.id).get().then(listData),
        db.collection(C.materials).where("studentIds", "array-contains", u.id).get().then(listData),
        db.collection(C.materialOpens).where("studentId", "==", u.id).get().then(listData),
        db.collection(C.attendance).doc(`${u.id}_${weekStartOf(new Date())}`).get(),
        db.collection(C.lessons).where("studentId", "==", u.id).get().then(listData),
      ]);
      const upcoming = meetings.filter((m) => m.status === "scheduled" && m.endAt > now()).sort((a, b) => (a.startAt < b.startAt ? -1 : 1));
      const names = await nameMap(upcoming.map((m) => m.teacherId).concat(u.teacherId));
      const live = materials.filter((m) => !m.deletedAt && m.status === "published");
      const openIds = new Set(opens.map((o) => o.materialId));
      const done = lessons.filter((l) => l.status === "completed").length;
      return res.json({
        role: "student",
        teacherName: names[u.teacherId] || null,
        nextClass: upcoming[0] ? slimMeeting(upcoming[0], names, true) : null,
        upcoming: upcoming.slice(0, 5).map((m) => slimMeeting(m, names, true)),
        materials: {
          total: live.length,
          unopened: live.filter((m) => !openIds.has(m.id)).length,
          recent: live
            .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1))
            .slice(0, 4)
            .map((m) => ({ id: m.id, title: m.title, subject: m.subject, kind: m.file?.kind, publishedAt: m.publishedAt, opened: openIds.has(m.id) })),
        },
        attendance: { weekStart: weekStartOf(new Date()), submitted: attendance.exists },
        progress: { total: lessons.length, completed: done, percent: lessons.length ? Math.round(lessons.reduce((a, l) => a + (l.status === "completed" ? 100 : l.progress || 0), 0) / lessons.length) : 0 },
        announcements: await unreadAnnouncements(u),
      });
    }

    if (u.role === "teacher") {
      const [meetings, students, materials, opens, requests] = await Promise.all([
        db.collection(C.meetings).where("teacherId", "==", u.id).get().then(listData),
        db.collection(C.users).where("teacherId", "==", u.id).get().then(listData),
        db.collection(C.materials).where("teacherId", "==", u.id).get().then(listData),
        db.collection(C.materialOpens).where("teacherId", "==", u.id).get().then(listData),
        db.collection(C.scheduleRequests).where("teacherId", "==", u.id).get().then(listData),
      ]);
      const mine = students.filter((s) => s.role === "student" && !s.deletedAt && s.active);
      const upcoming = meetings.filter((m) => m.status === "scheduled" && m.endAt > now()).sort((a, b) => (a.startAt < b.startAt ? -1 : 1));
      const names = await nameMap(upcoming.slice(0, 10).flatMap((m) => m.studentIds || []));
      const live = materials.filter((m) => !m.deletedAt);
      const totalAssigned = live.filter((m) => m.status === "published").reduce((a, m) => a + (m.studentIds || []).length, 0);
      const opened = live.filter((m) => m.status === "published").reduce((a, m) => a + opens.filter((o) => o.materialId === m.id && (m.studentIds || []).includes(o.studentId)).length, 0);
      const today = localDateOf(new Date());
      return res.json({
        role: "teacher",
        stats: {
          students: mine.length,
          classesThisWeek: upcoming.filter((m) => m.startAt <= dayAhead()).length,
          classesToday: upcoming.filter((m) => localDateOf(m.startAt) === today).length,
          materials: live.length,
          scheduled: live.filter((m) => m.status === "scheduled").length,
          openRate: totalAssigned ? Math.round((opened / totalAssigned) * 100) : null,
          pendingRequests: requests.filter((r) => r.status === "pending").length,
        },
        nextClass: upcoming[0] ? slimMeeting(upcoming[0], names) : null,
        upcoming: upcoming.slice(0, 6).map((m) => slimMeeting(m, names)),
        announcements: await unreadAnnouncements(u),
      });
    }

    // Admin
    const [students, teachers, meetings, requests, materials, logins] = await Promise.all([
      usersByRole("student"),
      usersByRole("teacher"),
      hasPerm(u, "classes") ? db.collection(C.meetings).get().then(listData) : [],
      hasPerm(u, "classes") ? db.collection(C.scheduleRequests).where("status", "==", "pending").get().then(listData) : [],
      db.collection(C.materials).get().then(listData),
      hasPerm(u, "reports") ? db.collection(C.loginEvents).where("at", ">=", new Date(Date.now() - 14 * 86400000).toISOString()).get().then(listData) : [],
    ]);
    const logins14 = logins;
    const dayAgo = new Date(Date.now() - 86400000).toISOString();
    const loginsDay = logins14.filter((l) => l.at >= dayAgo);
    const liveS = students.filter((s) => !s.deletedAt);
    const liveT = teachers.filter((t) => !t.deletedAt);
    const upcoming = meetings.filter((m) => m.status === "scheduled" && m.endAt > now()).sort((a, b) => (a.startAt < b.startAt ? -1 : 1));
    const names = await nameMap(upcoming.slice(0, 8).flatMap((m) => [m.teacherId, ...(m.studentIds || [])]));
    const today = localDateOf(new Date());
    const weekStart = weekStartOf(new Date());
    const att = hasPerm(u, "attendance") ? listData(await db.collection(C.attendance).where("weekStart", "==", weekStart).get()) : null;
    const alerts = await computeAlerts();

    // classes per day for the next 7 days (chart)
    const perDay = [];
    for (let i = 0; i < 7; i++) {
      const d = localDateOf(new Date(Date.now() + i * 86400000));
      perDay.push({ date: d, count: upcoming.filter((m) => localDateOf(m.startAt) === d).length });
    }
    res.json({
      role: "admin",
      stats: {
        students: liveS.length,
        activeStudents: liveS.filter((s) => s.active).length,
        teachers: liveT.length,
        activeTeachers: liveT.filter((t) => t.active).length,
        unassignedStudents: liveS.filter((s) => s.active && !s.teacherId).length,
        classesToday: upcoming.filter((m) => localDateOf(m.startAt) === today).length,
        upcomingClasses: upcoming.length,
        pendingRequests: requests.length,
        materials: materials.filter((m) => !m.deletedAt).length,
        loginsToday: loginsDay.filter((l) => l.success).length,
        failedLoginsToday: loginsDay.filter((l) => !l.success).length,
        attendanceSubmitted: att ? att.length : null,
        attendanceExpected: att ? liveS.filter((s) => s.active).length : null,
      },
      perDay,
      charts: await adminCharts({ u, meetings, liveS, liveT, materials, logins14 }),
      upcoming: hasPerm(u, "classes") ? upcoming.slice(0, 8).map((m) => slimMeeting(m, names)) : [],
      alerts: alerts.slice(0, 6),
      alertCount: alerts.length,
    });
  })
);

// ---- Admin dashboard charts ---------------------------------------------------------
async function adminCharts({ u, meetings, liveS, liveT, materials, logins14 }) {
  const nowStr = now();
  const DAY = 86400000;
  const charts = {};

  if (hasPerm(u, "classes")) {
    // Last 8 weeks: classes held vs cancelled, by week (Monday start)
    const thisWeek = weekStartOf(new Date());
    const weeks = [];
    for (let i = 7; i >= 0; i--) {
      const start = new Date(`${thisWeek}T00:00:00`);
      start.setDate(start.getDate() - i * 7);
      weeks.push(localDateOf(start));
    }
    charts.weekly = weeks.map((w) => {
      const inWeek = meetings.filter((m) => m.startAt < nowStr && weekStartOf(new Date(m.startAt)) === w);
      return {
        week: w,
        held: inWeek.filter((m) => m.status !== "cancelled").length,
        cancelled: inWeek.filter((m) => m.status === "cancelled").length,
      };
    });

    // Teacher workload: classes in the last 30 days (held) and next 7 days (scheduled)
    const from = new Date(Date.now() - 30 * DAY).toISOString();
    const to = new Date(Date.now() + 7 * DAY).toISOString();
    charts.workload = liveT
      .filter((t) => t.active)
      .map((t) => {
        const mine = meetings.filter((m) => m.teacherId === t.id && m.status !== "cancelled");
        return {
          id: t.id,
          name: t.name,
          past: mine.filter((m) => m.startAt >= from && m.startAt < nowStr).length,
          upcoming: mine.filter((m) => m.startAt >= nowStr && m.startAt <= to).length,
          students: liveS.filter((s) => s.active && s.teacherId === t.id).length,
        };
      })
      .sort((a, b) => b.past + b.upcoming - (a.past + a.upcoming));
  }

  // Students by board
  const boards = {};
  for (const s of liveS.filter((x) => x.active)) {
    const b = s.board || "Not set";
    boards[b] = (boards[b] || 0) + 1;
  }
  charts.boards = Object.entries(boards)
    .map(([board, count]) => ({ board, count }))
    .sort((a, b) => b.count - a.count);

  // Material engagement: assigned vs opened (published materials)
  const published = materials.filter((m) => !m.deletedAt && m.status === "published");
  const assigned = published.reduce((a, m) => a + (m.studentIds || []).length, 0);
  if (assigned) {
    const opens = listData(await db.collection(C.materialOpens).get());
    const pairs = new Set(opens.map((o) => `${o.materialId}:${o.studentId}`));
    const opened = published.reduce((a, m) => a + (m.studentIds || []).filter((sid) => pairs.has(`${m.id}:${sid}`)).length, 0);
    charts.materials = { assigned, opened };
  } else charts.materials = { assigned: 0, opened: 0 };

  // Sign-ins per day, last 14 days
  if (hasPerm(u, "reports")) {
    const days = [];
    for (let i = 13; i >= 0; i--) days.push(localDateOf(new Date(Date.now() - i * DAY)));
    charts.signins = days.map((d) => {
      const ev = logins14.filter((l) => localDateOf(l.at) === d);
      return { date: d, success: ev.filter((l) => l.success).length, failed: ev.filter((l) => !l.success).length };
    });
  }
  return charts;
}

export default router;
