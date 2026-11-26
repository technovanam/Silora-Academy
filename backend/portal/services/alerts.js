// ============================================================================
// INACTIVITY ALERTS – students/teachers who haven't signed in, materials that
// stay unopened, and attendance forms teachers haven't submitted. Computed on demand.
// ============================================================================
import { db, C } from "../firebase.js";
import { listData, plural } from "../util.js";
import { getSettings, usersByRole, teacherIdsOf } from "./core.js";
import { pendingForms } from "../routes/attendance.js";

const daysSince = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null);

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

  const rank = { high: 0, medium: 1, low: 2 };
  return alerts.sort((a, b) => rank[a.severity] - rank[b.severity] || (b.days || 0) - (a.days || 0));
}
