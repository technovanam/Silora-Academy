import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, BellRing, CalendarClock, CalendarDays, CalendarPlus, ClipboardCheck, FileX, GraduationCap, Siren, UserPlus, UserX, Users } from "lucide-react";
import { api } from "../../lib/api.js";
import { useAuth, can } from "../../lib/auth.jsx";
import { plural } from "../../lib/format.js";
import { Badge, Button, Card, CardTitle, Empty, ErrorBox, Loading, PageHeader, StatCard, cx, useAsync } from "../../ui/index.jsx";
import { BarList, ColumnChart, Legend, LineChart, Meter, SERIES } from "../../components/charts.jsx";
import { ClassRow, JoinButton } from "../../components/classes.jsx";

const SEV = { high: ["red", "High"], medium: ["amber", "Medium"], low: ["blue", "Low"] };
const ALERT_ICON = { student_inactive: UserX, teacher_inactive: UserX, material_unopened: FileX, attendance_missing: ClipboardCheck };
const ALERT_LINK = (a) => (a.userId ? `/portal/admin/users/${a.userId}` : a.type === "material_unopened" ? "/portal/admin/materials" : a.type === "attendance_missing" ? `/portal/admin/attendance?week=${a.weekStart}` : "/portal/admin/alerts");

export function AlertList({ alerts, compact }) {
  const navigate = useNavigate();
  if (!alerts.length) return <Empty icon={Siren} title="No alerts" text="Everyone is active and up to date." className={compact ? "py-8" : ""} />;
  return (
    <ul className="space-y-2">
      {alerts.map((a) => {
        const Icon = ALERT_ICON[a.type] || AlertTriangle;
        return (
          <li key={a.id}>
            <button onClick={() => navigate(ALERT_LINK(a))} className="flex w-full items-start gap-3 rounded-xl border border-slate-200/80 p-3 text-left transition hover:bg-slate-50">
              <span className={cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", a.severity === "high" ? "bg-rose-50 text-rose-600" : a.severity === "medium" ? "bg-amber-50 text-amber-600" : "bg-sky-50 text-sky-600")}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-navy">{a.title}</span>
                <span className="block truncate text-xs text-muted">
                  {a.detail}
                  {a.teacherName ? ` · Teacher: ${a.teacherName}` : ""}
                </span>
              </span>
              <Badge tone={SEV[a.severity][0]}>{SEV[a.severity][1]}</Badge>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function AdminDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useAsync(() => api.get("/dashboard"), []);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const s = data.stats;
  const ch = data.charts || {};
  const canClasses = can(user, "classes");
  const canUsers = can(user, "users");
  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
  const heldTotal = (ch.weekly || []).reduce((a, w) => a + w.held, 0);
  const cancelledTotal = (ch.weekly || []).reduce((a, w) => a + w.cancelled, 0);
  const signinTotal = (ch.signins || []).reduce((a, d) => a + d.success, 0);
  const todayStr = localIso(new Date());

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[13px] font-medium text-slate-500">{today}</p>
          <h1 className="mt-0.5 text-xl font-bold tracking-tight text-navy sm:text-2xl">Good {greeting()}, {(user.name || "").split(" ")[0]}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {canUsers && (
            <Button variant="outline" icon={UserPlus} onClick={() => navigate("/portal/admin/students")}>
              Add student
            </Button>
          )}
          {canClasses && (
            <Button icon={CalendarPlus} onClick={() => navigate("/portal/admin/classes")}>
              Schedule class
            </Button>
          )}
        </div>
      </div>

      {/* KPI tiles */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={GraduationCap} label="Active students" value={s.activeStudents} hint={`${s.students} total${s.unassignedStudents ? ` · ${s.unassignedStudents} need a teacher` : ""}`} onClick={canUsers ? () => navigate("/portal/admin/students") : undefined} />
        <StatCard icon={Users} label="Active teachers" value={s.activeTeachers} hint={`${s.teachers} total`} tone="blue" onClick={canUsers ? () => navigate("/portal/admin/teachers") : undefined} />
        <StatCard icon={CalendarDays} label="Classes today" value={s.classesToday} hint={`${s.upcomingClasses} upcoming in total`} tone="green" onClick={canClasses ? () => navigate("/portal/admin/classes") : undefined} />
        <StatCard icon={CalendarClock} label="Pending requests" value={s.pendingRequests} hint="Reschedule / cancel" tone={s.pendingRequests ? "red" : "violet"} onClick={canClasses ? () => navigate("/portal/admin/requests") : undefined} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Classes per week */}
        {ch.weekly && (
          <Card className="xl:col-span-2">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-semibold text-navy">Classes per week</h2>
                <p className="text-[13px] text-slate-500">
                  Last 8 weeks · <span className="font-semibold text-navy">{heldTotal}</span> held, <span className="font-semibold text-navy">{cancelledTotal}</span> cancelled
                </p>
              </div>
              <Legend series={WEEKLY_SERIES} />
            </div>
            <ColumnChart data={ch.weekly} series={WEEKLY_SERIES} xLabel={(w) => shortDate(w.week)} tipTitle={(w) => `Week of ${shortDate(w.week)}`} height={240} highlight={(w) => w === ch.weekly[ch.weekly.length - 1]} />
          </Card>
        )}

        {/* Engagement */}
        <Card className={cx(!ch.weekly && "xl:col-span-3")}>
          <h2 className="text-[15px] font-semibold text-navy">Engagement</h2>
          <p className="mb-5 text-[13px] text-slate-500">This week</p>
          <div className="space-y-6">
            {s.attendancePending !== null && (
              <Link to="/portal/admin/attendance?tab=pending" className="grid grid-cols-2 gap-3 rounded-xl border border-slate-100 p-3 transition hover:border-slate-200">
                <div>
                  <p className="text-[13px] font-medium text-slate-500">Attendance forms waiting</p>
                  <p className={cx("mt-1 text-2xl font-bold tracking-tight", s.attendanceOverdue ? "text-rose-600" : "text-navy")}>{s.attendancePending}</p>
                  {s.attendanceOverdue > 0 && <p className="text-xs text-rose-600">{s.attendanceOverdue} overdue</p>}
                </div>
                <div>
                  <p className="text-[13px] font-medium text-slate-500">Leave requests</p>
                  <p className={cx("mt-1 text-2xl font-bold tracking-tight", s.pendingLeave ? "text-amber-600" : "text-navy")}>{s.pendingLeave}</p>
                </div>
              </Link>
            )}
            {(s.teacherPaymentsDue !== null || s.feeProofsToVerify !== null) && (
              <div className="grid grid-cols-2 gap-3">
                {s.feeProofsToVerify !== null && (
                  <Link to="/portal/admin/fees" className="rounded-xl border border-slate-100 p-3 transition hover:border-slate-200">
                    <p className="text-[13px] font-medium text-slate-500">Fee proofs to verify</p>
                    <p className={cx("mt-1 text-2xl font-bold tracking-tight", s.feeProofsToVerify ? "text-sky-600" : "text-navy")}>{s.feeProofsToVerify}</p>
                  </Link>
                )}
                {s.teacherPaymentsDue !== null && (
                  <Link to="/portal/admin/teacher-payments" className="rounded-xl border border-slate-100 p-3 transition hover:border-slate-200">
                    <p className="text-[13px] font-medium text-slate-500">Teacher payments due</p>
                    <p className={cx("mt-1 text-2xl font-bold tracking-tight", s.teacherPaymentsDue ? "text-amber-600" : "text-navy")}>{s.teacherPaymentsDue}</p>
                  </Link>
                )}
              </div>
            )}
            <Meter label="Materials opened by students" value={ch.materials?.opened || 0} total={ch.materials?.assigned || 0} hint={`${plural(s.materials, "material")} in the library`} />
            <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-5">
              <div>
                <p className="text-[13px] font-medium text-slate-500">Sign-ins (24h)</p>
                <p className="mt-1 text-2xl font-bold tracking-tight text-navy">{s.loginsToday}</p>
              </div>
              <div>
                <p className="text-[13px] font-medium text-slate-500">Failed sign-ins</p>
                <p className={cx("mt-1 flex items-center gap-1.5 text-2xl font-bold tracking-tight", s.failedLoginsToday ? "text-rose-600" : "text-navy")}>
                  {s.failedLoginsToday ? <AlertTriangle className="h-4 w-4" /> : null}
                  {s.failedLoginsToday}
                </p>
              </div>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            {s.attendancePending !== null && (
              <Link to="/portal/admin/attendance">
                <Button variant="outline" size="sm">Attendance</Button>
              </Link>
            )}
            <Link to="/portal/admin/materials">
              <Button variant="outline" size="sm">Materials</Button>
            </Link>
          </div>
        </Card>

        {/* Sign-ins trend */}
        {ch.signins && (
          <Card className="xl:col-span-2">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-semibold text-navy">Portal sign-ins</h2>
                <p className="text-[13px] text-slate-500">
                  Last 14 days · <span className="font-semibold text-navy">{signinTotal}</span> successful
                </p>
              </div>
              <Legend series={SIGNIN_SERIES} />
            </div>
            <LineChart data={ch.signins} series={SIGNIN_SERIES} xLabel={(d) => shortDate(d.date)} tipTitle={(d) => new Date(`${d.date}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })} height={220} labelEvery={2} />
          </Card>
        )}

        {/* Students by board */}
        <Card className={cx(!ch.signins && "xl:col-span-1")}>
          <CardTitle title="Students by board" subtitle={`${s.activeStudents} active students`} />
          <BarList items={(ch.boards || []).map((b) => ({ label: b.board, count: b.count }))} series={[{ key: "count", label: "Students", color: SERIES.blue }]} />
        </Card>

        {/* Upcoming classes */}
        {canClasses && (
          <Card className="xl:col-span-2">
            <CardTitle title="Next 7 days" subtitle={`${plural(data.perDay.reduce((a, d) => a + d.count, 0), "class", "classes")} scheduled`} action={<Link to="/portal/admin/classes" className="text-sm font-semibold text-slate-600 hover:text-navy">View calendar</Link>} />
            <ColumnChart data={data.perDay} series={[{ key: "count", label: "Classes", color: SERIES.blue }]} xLabel={(d) => (d.date === todayStr ? "Today" : new Date(`${d.date}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short" }))} tipTitle={(d) => new Date(`${d.date}T00:00:00`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" })} height={150} highlight={(d) => d.date === todayStr} />
            <div className="mt-5 space-y-3">
              {data.upcoming.length ? (
                data.upcoming.slice(0, 4).map((m) => <ClassRow key={m.id} m={{ ...m, students: m.students.map((n) => ({ id: n, name: n })) }} showTeacher actions={<JoinButton m={m} size="sm" allowEarly />} />)
              ) : (
                <Empty icon={CalendarDays} title="No upcoming classes" className="py-8" />
              )}
            </div>
          </Card>
        )}

        <div className="space-y-6">
          {/* Teacher workload */}
          {ch.workload && (
            <Card>
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-[15px] font-semibold text-navy">Teacher workload</h2>
                  <p className="text-[13px] text-slate-500">Classes, last 30 days + next 7</p>
                </div>
              </div>
              <Legend series={WORKLOAD_SERIES} className="mb-4" />
              <BarList items={ch.workload.map((t) => ({ id: t.id, label: t.name, past: t.past, upcoming: t.upcoming, suffix: "classes" }))} series={WORKLOAD_SERIES} onClick={canUsers ? (t) => navigate(`/portal/admin/users/${t.id}`) : undefined} empty="No active teachers" />
            </Card>
          )}

          {/* Alerts */}
          <Card>
            <CardTitle title="Alerts" subtitle={`${data.alertCount} ${data.alertCount === 1 ? "needs" : "need"} attention`} action={<Link to="/portal/admin/alerts" className="text-sm font-semibold text-slate-600 hover:text-navy">View all</Link>} />
            <AlertList alerts={data.alerts.slice(0, 4)} compact />
          </Card>
          {can(user, "notifications") && (
            <Link to="/portal/admin/notifications" className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-navy">
              <BellRing className="h-4 w-4" /> Notification delivery log
            </Link>
          )}
        </div>
      </div>
    </>
  );
}

const WEEKLY_SERIES = [
  { key: "held", label: "Held", color: SERIES.blue },
  { key: "cancelled", label: "Cancelled", color: SERIES.orange },
];
const SIGNIN_SERIES = [
  { key: "success", label: "Successful", color: SERIES.blue },
  { key: "failed", label: "Failed", color: SERIES.orange },
];
const WORKLOAD_SERIES = [
  { key: "past", label: "Last 30 days", color: SERIES.blue },
  { key: "upcoming", label: "Next 7 days", color: SERIES.orange },
];

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
};
const localIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const shortDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export function AdminAlerts() {
  const { data, loading, error, reload } = useAsync(() => api.get("/admin/alerts"), []);
  return (
    <>
      <PageHeader
        title="Alerts"
        subtitle={data ? `Inactive after ${plural(data.settings.inactivityDays, "day")} without sign-in · materials unopened after ${plural(data.settings.unopenedMaterialDays, "day")} · missing weekly attendance. Admins get a daily summary at 9 AM.` : ""}
        actions={<Button variant="outline" onClick={() => reload()}>Refresh</Button>}
      />
      <ErrorBox error={error} onRetry={reload} />
      <Card>{loading ? <Loading /> : <AlertList alerts={data.alerts} />}</Card>
    </>
  );
}
