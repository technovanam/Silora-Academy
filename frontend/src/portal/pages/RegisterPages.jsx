// ============================================================
// SESSION REGISTER – the academy's per-student sheet, built from the portal.
// Date, day, time, status, minutes and class count come from the classroom and
// can't be typed; teachers fill in the lesson, homework, quiz/test and remarks
// in each class's attendance form.
//  • SessionRegister  /portal/sessions/:id/register  (teacher of the session, admins)
//  • TeacherSessions  /portal/teacher/sessions
// ============================================================
import React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CalendarRange, Download, Lock } from "lucide-react";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import { fmtDate } from "../lib/format.js";
import { Badge, Button, Card, Empty, ErrorBox, Loading, Notice, PageHeader, Progress, Table, cx, useAsync, useUi } from "../ui/index.jsx";

const d = (x) => (x ? fmtDate(`${x}T12:00:00`) : "—");
const dash = (v) => (v === null || v === undefined || v === "" ? <span className="text-slate-300">—</span> : v);
const STATUS_TONE = { present: "green", late: "amber", absent: "red", uninformed: "red", leave: "blue" };

export function SessionRegister() {
  const { id } = useParams();
  const { user } = useAuth();
  const ui = useUi();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useAsync(() => api.get(`/sessions/${id}/register`), [id]);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const h = data.header;
  const download = () => api.download(`/sessions/${id}/register`, { format: "csv" }, `${h.student}-${h.subject}-session-${h.session}.csv`).catch(ui.error);
  const top = [
    ["Faculty", h.faculty],
    ["Student", h.student],
    ["Student ID", h.studentCode || "—"],
    ["Subject", h.subject],
    ["Session", h.session],
    ["Starting date", d(h.startDate)],
    ["Ending date", d(h.endDate)],
    ["Total classes taken", `${h.totalClassesTaken} of ${h.plannedClasses}`],
  ];
  return (
    <>
      <PageHeader
        back={
          <button type="button" onClick={() => navigate(-1)} className="inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-navy">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
        }
        title={`${h.subject} – Session ${h.session}`}
        subtitle={`${h.student}${h.studentCode ? ` · ${h.studentCode}` : ""} · ${h.faculty}`}
        actions={<Button variant="outline" icon={Download} onClick={download}>Download (Excel / CSV)</Button>}
      />
      <Card className="mb-5">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          {top.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{k}</dt>
              <dd className="font-semibold text-navy">{v}</dd>
            </div>
          ))}
        </dl>
        <Progress value={h.plannedClasses ? (h.totalClassesTaken / h.plannedClasses) * 100 : 0} className="mt-4" />
      </Card>
      <Notice icon={Lock} className="mb-5">
        Date, time, status, minutes and class count are filled in automatically from the classroom and can't be edited.
        {user.role === "teacher" ? " Fill in the lesson, homework, quiz/test and remarks in each class's attendance form (Attendance page)." : " Teachers fill in the lesson, homework, quiz/test and remarks in each class's attendance form."}
      </Notice>
      <Card flush>
        <Table
          rowKey="meetingId"
          minWidth="min-w-[1500px]"
          rows={data.rows}
          empty={<Empty icon={CalendarRange} title="No classes yet" text={`${h.subject} classes of ${h.student} with ${h.faculty} between these dates show up here automatically.`} />}
          columns={[
            { key: "date", label: "Date", render: (r) => <span className="whitespace-nowrap font-medium text-navy">{d(r.date)}</span> },
            { key: "day", label: "Day" },
            { key: "time", label: "Time", render: (r) => <span className="whitespace-nowrap text-sm">{r.time}</span> },
            { key: "lessonTaken", label: "Lesson taken", className: "max-w-[220px]", render: (r) => dash(r.lessonTaken) },
            { key: "homework", label: "Homework", className: "max-w-[180px]", render: (r) => dash(r.homework) },
            { key: "statusLabel", label: "Status", render: (r) => (r.status ? <Badge tone={STATUS_TONE[r.status]}>{r.statusLabel}</Badge> : <span className={cx("text-xs", r.state === "cancelled" ? "text-rose-600" : "text-muted")}>{r.statusLabel}{r.state === "form_due" ? " · form due" : ""}</span>) },
            { key: "minutes", label: "Minutes", render: (r) => dash(r.minutes) },
            { key: "classCount", label: "Class count", render: (r) => dash(r.classCount) },
            { key: "quiz", label: "Quiz topic / result", render: (r) => dash([r.quizTopic, r.quizResult].filter(Boolean).join(" – ")) },
            { key: "test", label: "Test topic / result", render: (r) => dash([r.testTopic, r.testResult].filter(Boolean).join(" – ")) },
            { key: "studentLeaveReason", label: "Student leave reason", className: "max-w-[180px]", render: (r) => dash(r.studentLeaveReason) },
            { key: "facultyLeaveReason", label: "Faculty leave reason", className: "max-w-[180px]", render: (r) => dash(r.facultyLeaveReason) },
            { key: "remarks", label: "Remarks", className: "max-w-[200px]", render: (r) => dash(r.remarks) },
            { key: "compensationFor", label: "Compensation class", render: (r) => dash(r.compensationFor) },
          ]}
        />
      </Card>
    </>
  );
}

export function TeacherSessions() {
  const { data, loading, error, reload } = useAsync(() => api.get("/teacher/sessions"), []);
  return (
    <>
      <PageHeader title="My sessions" subtitle="Your students' sessions, one per subject. Open one to see its register – the same sheet the academy keeps." />
      <ErrorBox error={error} onRetry={reload} />
      <Card flush>
        {loading ? <Loading /> : (
          <Table
            rows={data.sessions}
            empty={<Empty icon={CalendarRange} title="No sessions yet" text="The academy creates a session for each student and subject." />}
            columns={[
              { key: "studentName", label: "Student", render: (s) => <Link to={`/portal/sessions/${s.id}/register`} className="font-semibold text-navy hover:underline">{s.studentName}{s.studentCode && <span className="block text-xs font-normal text-muted">{s.studentCode}</span>}</Link> },
              { key: "subject", label: "Subject / session", render: (s) => <span><b className="text-navy">{s.subject}</b><span className="block text-xs text-muted">Session {s.number}</span></span> },
              { key: "dates", label: "Dates", render: (s) => <span className="whitespace-nowrap text-sm">{d(s.startDate)} – {d(s.endDate)}</span> },
              { key: "status", label: "Status", render: (s) => <Badge tone={s.status === "active" ? "green" : "blue"}>{s.status === "active" ? "Active" : "Completed"}</Badge> },
              { key: "progress", label: "Classes taken", render: (s) => <span className="flex min-w-[130px] items-center gap-2"><Progress value={s.progress.percent} className="flex-1" /><span className="whitespace-nowrap text-xs">{s.progress.held}/{s.progress.planned}</span></span> },
              { key: "open", label: "", render: (s) => <Link to={`/portal/sessions/${s.id}/register`}><Button size="sm" variant="outline">Register</Button></Link> },
            ]}
          />
        )}
      </Card>
    </>
  );
}
