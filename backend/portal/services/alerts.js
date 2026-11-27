// ============================================================================
// INACTIVITY ALERTS – students/teachers who haven't signed in, materials that
// stay unopened, and attendance forms teachers haven't submitted. Computed on demand.
// ============================================================================
import { db, C } from "../firebase.js";
import { listData, plural } from "../util.js";
import { getSettings, usersByRole, teacherIdsOf, hasPerm } from "./core.js";
import { pendingForms } from "../routes/attendance.js";

const daysSince = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null);

// Which permission an admin needs to see each kind of alert
const ALERT_PERM = { student_inactive: "users", teacher_inactive: "users", material_unopened: "materials", attendance_missing: "attendance", inactive_teacher_classes: ["users", "classes"] };
/** Alerts this admin may see (all of them without a viewer, e.g. the daily job) */
export async function alertsFor(viewer) {
  const all = await computeAlerts();
  if (!viewer) return all;
  return all.filter((a) => [].concat(ALERT_PERM[a.type] || "users").some((p) => hasPerm(viewer, p)));
}

export async function computeAlerts() {
  const settings = await getSettings();
  const [students, teachers, materials, opens, forms] = await Promise.all([
    usersByRole("student", { activeOnly: true }),
    usersByRole("teacher", { activeOnly: true }),
    db.collection(C.materials).where("status", "==", "published").get().then(listData),
    db.collection(C.materialOpens).get().then(listData),
    pendingForms(),
  ]);
  const live = (u) => !u.deletedAt;
  const tNames = Object.fromEntries(teachers.map((t) => [t.id, t.name]));
  const alerts = [];

  for (const u of [...students, ...teachers].filter(live)) {
    const ref = u.lastLoginAt || u.createdAt;
    const d = daysSince(ref);
    if (d !== null && d >= settings.inactivityDays) {
      alerts.push({
        id: `inactive_${u.id}`,
        type: u.role === "student" ? "student_inactive" : "teacher_inactive",
        severity: d >= settings.inactivityDays * 2 ? "high" : "medium",
        userId: u.id,
        title: `${u.name} hasn't signed in for ${plural(d, "day")}`,
        detail: u.lastLoginAt ? `Last sign-in ${u.lastLoginAt.slice(0, 10)}` : "Never signed in",
        teacherName: u.role === "student" ? teacherIdsOf(u).map((id) => tNames[id]).filter(Boolean).join(", ") || "Unassigned" : undefined,
        days: d,
      });
    }
  }

  const openSet = new Set(opens.map((o) => `${o.materialId}_${o.studentId}`));
  const sNames = Object.fromEntries(students.map((s) => [s.id, s.name]));
  for (const m of materials.filter((m) => !m.deletedAt)) {
    const d = daysSince(m.publishedAt);
    if (d === null || d < settings.unopenedMaterialDays) continue;
    const pending = (m.studentIds || []).filter((id) => sNames[id] && !openSet.has(`${m.id}_${id}`));
    if (pending.length)
      alerts.push({
        id: `unopened_${m.id}`,
        type: "material_unopened",
        severity: "low",
        title: `"${m.title}" not opened by ${pending.length} student${pending.length > 1 ? "s" : ""}`,
        detail: `${pending.map((id) => sNames[id]).slice(0, 5).join(", ")}${pending.length > 5 ? "…" : ""} · published ${plural(d, "day")} ago`,
        teacherName: tNames[m.teacherId] || "",
        materialId: m.id,
        days: d,
      });
  }

  // Attendance forms the teacher still hasn't submitted after the reminder time
  const overdue = forms.pending.filter((f) => f.overdue);
  if (overdue.length) {
    const byTeacher = [...new Set(overdue.map((f) => f.teacherName || "Teacher"))];
    alerts.push({
      id: `attendance_forms_${overdue.length}`,
      type: "attendance_missing",
      severity: "medium",
      title: `${plural(overdue.length, "attendance form")} not submitted by teachers`,
      detail: byTeacher.slice(0, 6).join(", ") + (byTeacher.length > 6 ? "…" : ""),
    });
  }

  // Deactivated teachers who still have classes on students' calendars
  const inactiveTeachers = (await usersByRole("teacher")).filter((t) => t.active === false && !t.deletedAt);
  if (inactiveTeachers.length) {
    const now = new Date().toISOString();
    for (const t of inactiveTeachers) {
      const n = listData(await db.collection(C.meetings).where("teacherId", "==", t.id).get()).filter((m) => m.status === "scheduled" && !m.isDemo && m.endAt > now).length;
      if (n)
        alerts.push({
          id: `inactive_teacher_classes_${t.id}`,
          type: "inactive_teacher_classes",
          severity: "high",
          userId: t.id,
          title: `${t.name} is deactivated but still has ${plural(n, "upcoming class", "upcoming classes")}`,
          detail: "Students still see these classes. Give the students another teacher, cancel the classes, or activate the account again.",
        });
    }
  }

  const rank = { high: 0, medium: 1, low: 2 };
  return alerts.sort((a, b) => rank[a.severity] - rank[b.severity] || (b.days || 0) - (a.days || 0));
}
