// ============================================================
// ATTENDANCE – class-wise, submitted by the teacher
//  • Student: own records, per-subject counts, leave requests
//  • Teacher: forms for conducted classes (pre-filled from real join/leave
//    intervals), review + remarks + submit, records of their classes
//  • Admin: reports (student / teacher / subject / date), pending forms,
//    leave approvals, rules, legacy weekly forms
// ============================================================
import React, { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, BookOpenCheck, CalendarOff, CalendarSync, CheckCircle2, ClipboardCheck, ClipboardList, Clock, Download, FilePenLine, History, LayoutList, ListChecks, Lock, MessageSquareText, NotebookPen, Pencil, Plus, Settings2, Table2, Timer, UserX, Wifi, XCircle } from "lucide-react";
import { api } from "../lib/api.js";
import { fmtDate, fmtDateTime, fmtDay, fmtTime, fmtWeek, fromNow, plural } from "../lib/format.js";
import { Badge, Button, Card, CardTitle, Dialog, Empty, ErrorBox, Field, Input, Loading, Notice, PageHeader, Pager, Progress, SearchInput, Segmented, Select, StatCard, Table, Textarea, cx, useAsync, usePaged, useUi } from "../ui/index.jsx";

// ---- Shared ------------------------------------------------------------------------
export const ATT_STATUS = {
  present: { tone: "green", label: "Present" },
  late: { tone: "amber", label: "Late" },
  absent: { tone: "red", label: "Absent" },
  leave: { tone: "blue", label: "Leave" },
  uninformed: { tone: "violet", label: "Uninformed absence" },
};
const STATUS_OPTIONS = Object.entries(ATT_STATUS).map(([value, s]) => ({ value, label: s.label }));
const LEAVE_STATUS = { pending: ["amber", "Waiting"], approved: ["green", "Approved"], rejected: ["red", "Rejected"], cancelled: ["gray", "Cancelled"] };

export const StatusBadge = ({ status }) => <Badge tone={ATT_STATUS[status]?.tone || "gray"}>{ATT_STATUS[status]?.label || status}</Badge>;
const mins = (n) => (n >= 60 ? `${Math.floor(n / 60)} h ${n % 60 ? `${n % 60} min` : ""}`.trim() : `${n || 0} min`);

function summarize(rows) {
  const n = (st) => rows.filter((r) => r.status === st).length;
  const attended = n("present") + n("late");
  return { conducted: rows.length, attended, present: n("present"), late: n("late"), absent: n("absent"), leave: n("leave"), uninformed: n("uninformed"), minutes: rows.reduce((a, r) => a + (r.attendedMin || 0), 0), percent: rows.length ? Math.round((attended / rows.length) * 100) : null };
}

function SummaryCards({ s, leaveCounts }) {
  return (
    <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <StatCard icon={ClipboardCheck} label="Classes conducted" value={s.conducted} tone="navy" />
      <StatCard icon={CheckCircle2} label="Attended" value={s.attended} hint={s.percent === null ? "" : `${s.percent}% · ${s.late} late`} tone="green" />
      <StatCard icon={XCircle} label="Absent" value={s.absent} tone="red" />
      <StatCard icon={CalendarOff} label="On leave" value={s.leave} hint={leaveCounts ? `${leaveCounts.approved} approved · ${leaveCounts.rejected} rejected` : ""} tone="blue" />
      <StatCard icon={UserX} label="Uninformed absence" value={s.uninformed} tone="violet" />
      <StatCard icon={Timer} label="Time attended" value={mins(s.minutes)} tone="gold" />
    </div>
  );
}

/** Join/leave intervals: "10:00–10:25 · 10:30–11:00" with the gaps called out. */
export function Intervals({ intervals, compact }) {
  if (!intervals?.length) return <span className="text-sm text-muted">Didn't join</span>;
  return (
    <span className={cx("flex flex-wrap items-center gap-1.5", compact ? "text-xs" : "text-sm")}>
      {intervals.map((i, k) => (
        <React.Fragment key={k}>
          {k > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-amber-700" title="Disconnected, then rejoined">
              <Wifi className="h-3 w-3" /> {Math.round((new Date(i.from) - new Date(intervals[k - 1].to)) / 60000)} min gap
            </span>
          )}
          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700">
            {fmtTime(i.from)}–{i.open ? "now" : fmtTime(i.to)}
          </span>
        </React.Fragment>
      ))}
    </span>
  );
}

/** A bar across the class time showing when the student was in. */
function TimelineBar({ intervals, startAt, endAt }) {
  const s = new Date(startAt).getTime();
  const last = intervals?.length ? new Date(intervals[intervals.length - 1].to).getTime() : 0;
  const e = Math.max(new Date(endAt).getTime(), last);
  const first = intervals?.length ? Math.min(s, new Date(intervals[0].from).getTime()) : s;
  const span = Math.max(1, e - first);
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div className="absolute inset-y-0 border-x border-slate-300 bg-slate-200/60" style={{ left: `${((s - first) / span) * 100}%`, width: `${((new Date(endAt).getTime() - s) / span) * 100}%` }} />
      {(intervals || []).map((i, k) => (
        <div key={k} className="absolute inset-y-0 rounded-full bg-emerald-500" style={{ left: `${((new Date(i.from).getTime() - first) / span) * 100}%`, width: `${Math.max(0.8, ((new Date(i.to).getTime() - new Date(i.from).getTime()) / span) * 100)}%` }} />
      ))}
    </div>
  );
}

/** One labelled block of a class report (lesson, homework, quiz…). */
function ReportItem({ icon: Icon, label, children, empty = "Not recorded", wide }) {
  const has = Array.isArray(children) ? children.some(Boolean) : !!children;
  return (
    <div className={cx("rounded-lg border border-line bg-slate-50/60 p-3", wide && "sm:col-span-2")}>
      <dt className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {label}
      </dt>
      <dd className={cx("whitespace-pre-line text-sm", has ? "text-slate-800" : "italic text-muted")}>{has ? children : empty}</dd>
    </div>
  );
}

const scoreOf = (topic, result) =>
  topic || result ? (
    <>
      {topic || "—"}
      {result && <span className="ml-2 inline-block rounded-md bg-navy/10 px-1.5 py-0.5 text-xs font-semibold text-navy">Score: {result}</span>}
    </>
  ) : null;

/**
 * What happened in one class, written for students and parents: lesson taught,
 * homework, quiz / test and the teacher's remarks, plus attendance.
 * Admins also see the student's name and the teacher's note to the academy.
 */
export function ClassReport({ r, admin, onOpen }) {
  return (
    <li className="rounded-xl border border-line bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-navy">
            {admin && <>{r.studentName} · </>}
            {r.subject || r.title}
            <span className="ml-2 text-xs font-normal text-muted">Class #{r.classNo}</span>
          </p>
          <p className="text-sm text-muted">
            {r.day}, {fmtDate(r.startAt)} · {fmtTime(r.startAt)} · {r.teacherName}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusBadge status={r.status} />
          <span className="text-xs text-muted">{mins(r.attendedMin)} of {mins(r.scheduledMin)}</span>
          {admin && r.corrected && <span className="text-[11px] text-sky-700">corrected</span>}
        </div>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2">
        <ReportItem icon={BookOpenCheck} label="Lesson taught">{r.lessonTaken}</ReportItem>
        <ReportItem icon={NotebookPen} label="Homework" empty="No homework recorded">{r.homework}</ReportItem>
        {(r.quizTopic || r.quizResult) && <ReportItem icon={ListChecks} label="Quiz">{scoreOf(r.quizTopic, r.quizResult)}</ReportItem>}
        {(r.testTopic || r.testResult) && <ReportItem icon={FilePenLine} label="Test">{scoreOf(r.testTopic, r.testResult)}</ReportItem>}
        <ReportItem icon={MessageSquareText} label="Teacher's remarks" empty="No remarks" wide={!(r.quizTopic || r.quizResult) === !(r.testTopic || r.testResult)}>{r.remarks}</ReportItem>
        {r.compensationFor && <ReportItem icon={CalendarSync} label="Make-up class for">{r.compensationFor}</ReportItem>}
        {admin && r.formRemarks && <ReportItem icon={ClipboardList} label="Teacher's note to the academy" wide>{r.formRemarks}</ReportItem>}
      </dl>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span className="flex flex-wrap items-center gap-2">Joined: <Intervals intervals={r.intervals} compact /></span>
        {onOpen && <Button size="xs" variant="ghost" icon={Pencil} onClick={() => onOpen(r.meetingId)}>Open form</Button>}
      </div>
    </li>
  );
}

/** Class reports, 10 per page. */
function ClassReports({ rows, admin, onOpen, empty }) {
  const pg = usePaged(rows, 10, [10, 25, 50]);
  if (!rows.length) return empty;
  return (
    <>
      <ul className="space-y-4">
        {pg.rows.map((r) => <ClassReport key={r.id} r={r} admin={admin} onOpen={onOpen} />)}
      </ul>
      {pg.show && <Card className="mt-4" padded={false}><Pager {...pg.pager} /></Card>}
    </>
  );
}

function groupBy(rows, key, label) {
  const m = new Map();
  for (const r of rows) {
    const k = r[key] || "—";
    if (!m.has(k)) m.set(k, { id: k, name: (label ? r[label] : k) || "—", rows: [] });
    m.get(k).rows.push(r);
  }
  return [...m.values()].map((g) => ({ ...g, ...summarize(g.rows) })).sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

const groupColumns = (label) => [
  { key: "name", label, render: (r) => <span className="font-semibold text-navy">{r.name}</span> },
  { key: "conducted", label: "Classes" },
  { key: "attended", label: "Attended" },
  { key: "late", label: "Late" },
  { key: "absent", label: "Absent" },
  { key: "leave", label: "Leave" },
  { key: "uninformed", label: "Uninformed" },
  { key: "minutes", label: "Time", render: (r) => mins(r.minutes) },
  { key: "percent", label: "Attendance", render: (r) => (r.percent === null ? "—" : <span className="flex min-w-[110px] items-center gap-2"><Progress value={r.percent} tone={r.percent >= 75 ? "green" : r.percent >= 50 ? "brand" : "red"} className="flex-1" /> {r.percent}%</span>) },
];

// ============================================================================
// STUDENT
// ============================================================================
function LeaveDialog({ open, onClose, onSaved }) {
  const ui = useUi();
  const classes = useAsync(() => (open ? api.get("/meetings", { from: new Date().toISOString() }) : Promise.resolve(null)), [open]);
  const [f, setF] = useState({ meetingId: null, reason: "", remarks: "" });
  const [busy, setBusy] = useState(false);
  const upcoming = (classes.data?.meetings || []).filter((m) => m.status === "scheduled" && new Date(m.startAt) > new Date());
  const pick = upcoming.find((m) => m.id === f.meetingId);
  const save = async (e) => {
    e.preventDefault();
    if (!f.meetingId) return ui.error(new Error("Choose the class you'll miss"));
    setBusy(true);
    try {
      await api.post("/leave-requests", f);
      ui.toast("Leave request sent to the academy");
      setF({ meetingId: null, reason: "", remarks: "" });
      onSaved();
      onClose();
    } catch (err) {
      ui.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Request leave"
      subtitle="Ask before the class starts. The academy will approve or reject it."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="leave-form" loading={busy}>Submit request</Button>
        </>
      }
    >
      <form id="leave-form" onSubmit={save} className="grid gap-4">
        <Field label="Class you'll miss" required>
          {classes.loading ? (
            <Loading />
          ) : upcoming.length ? (
            <Select value={f.meetingId} onChange={(v) => setF({ ...f, meetingId: v })} searchable options={upcoming.map((m) => ({ value: m.id, label: `${fmtDateTime(m.startAt)} · ${m.subject || m.title}`, hint: m.title }))} placeholder="Choose a class" />
          ) : (
            <p className="text-sm text-muted">You have no upcoming classes.</p>
          )}
        </Field>
        {pick && (
          <div className="grid grid-cols-2 gap-3 rounded-xl bg-surface p-3 text-sm">
            <span><span className="text-muted">Date:</span> {fmtDate(pick.startAt)}</span>
            <span><span className="text-muted">Subject:</span> {pick.subject || "—"}</span>
            <span className="col-span-2"><span className="text-muted">Class:</span> {pick.title} with {pick.teacherName}</span>
          </div>
        )}
        <Field label="Reason" required>
          <Textarea rows={3} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} required maxLength={1000} placeholder="e.g. Family function, unwell, school exam" />
        </Field>
        <Field label="Remarks (optional)">
          <Textarea rows={2} value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} maxLength={1000} />
        </Field>
      </form>
    </Dialog>
  );
}

function LeaveList({ leaves, onChanged, admin }) {
  const ui = useUi();
  const cancel = (l) =>
    ui.confirm({
      title: "Cancel this leave request?",
      message: `"${l.classTitle}" on ${fmtDateTime(l.classStartAt)}`,
      confirmLabel: "Cancel request",
      danger: true,
      onConfirm: async () => {
        await api.post(`/leave-requests/${l.id}/cancel`);
        ui.toast("Request cancelled");
        onChanged();
      },
    });
  if (!leaves.length) return <Empty icon={CalendarOff} title="No leave requests" text="If you can't attend a class, request leave before it starts." />;
  return (
    <ul className="divide-y divide-line">
      {leaves.map((l) => (
        <li key={l.id} className="flex flex-wrap items-start gap-3 py-3">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-navy">{l.subject || l.classTitle} · {fmtDateTime(l.classStartAt)}</p>
            <p className="text-sm text-slate-600">{l.reason}</p>
            {l.remarks && <p className="text-xs text-muted">{l.remarks}</p>}
            {l.decisionNote && <p className="mt-1 text-xs text-slate-600">Academy: {l.decisionNote}</p>}
            <p className="mt-0.5 text-xs text-muted">Requested {fromNow(l.createdAt)}</p>
          </div>
          <Badge tone={LEAVE_STATUS[l.status]?.[0]}>{LEAVE_STATUS[l.status]?.[1]}</Badge>
          {!admin && l.status === "pending" && (
            <Button size="xs" variant="ghost" onClick={() => cancel(l)}>Cancel</Button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function StudentAttendance() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "records";
  const [subject, setSubject] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [leaveOpen, setLeaveOpen] = useState(false);
  const { data, loading, error, reload } = useAsync(() => api.get("/attendance/me", { subject, sessionId, from, to }), [subject, sessionId, from, to]);
  return (
    <>
      <PageHeader title="Attendance" subtitle="Your attendance for every class, filled in by your teacher from the class's join and leave times." actions={<Button icon={Plus} onClick={() => setLeaveOpen(true)}>Request leave</Button>} />
      <Segmented
        className="mb-5"
        value={tab}
        onChange={(v) => setParams(v === "records" ? {} : { tab: v })}
        options={[
          { value: "records", label: "My attendance", icon: ClipboardCheck },
          { value: "leave", label: "Leave requests", icon: CalendarOff, count: data?.leaveCounts?.pending || undefined },
        ]}
      />
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? (
        <Loading />
      ) : !data ? null : tab === "leave" ? (
        <Card>
          <CardTitle icon={CalendarOff} title="Leave requests" subtitle={`${data.leaveCounts.total} total · ${data.leaveCounts.approved} approved · ${data.leaveCounts.rejected} rejected`} action={<Button size="sm" icon={Plus} onClick={() => setLeaveOpen(true)}>New request</Button>} />
          <LeaveList leaves={data.leaves} onChanged={reload} />
        </Card>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-end gap-3">
            {data.sessions?.length > 0 && <Select className="w-full sm:w-56" value={sessionId} onChange={setSessionId} options={data.sessions.map((x) => ({ value: x.id, label: x.name }))} placeholder="All sessions" clearable />}
            {data.subjects.length > 0 && <Select className="w-full sm:w-52" value={subject} onChange={setSubject} options={data.subjects.map((s) => ({ value: s, label: s }))} placeholder="All subjects" clearable />}
            <Field label="From" className="w-full sm:w-44"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="To" className="w-full sm:w-44"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
            {(subject || sessionId || from || to) && <Button variant="ghost" size="sm" onClick={() => { setSubject(null); setSessionId(null); setFrom(""); setTo(""); }}>Clear filters</Button>}
          </div>
          <SummaryCards s={data.summary} leaveCounts={data.leaveCounts} />
          {data.bySubject.length > 0 && (
            <Card className="mb-6" padded={false}>
              <div className="p-5 pb-0 sm:p-6 sm:pb-0"><CardTitle title="By subject" subtitle="A separate class count for each subject" /></div>
              <Table rows={data.bySubject.map((s) => ({ ...s, id: s.subject, name: s.subject }))} columns={groupColumns("Subject")} />
            </Card>
          )}
          <div className="mb-3">
            <CardTitle icon={History} title="Class reports" subtitle="For every class: what was taught, the homework given, quiz and test results and your teacher's remarks – newest first." />
          </div>
          <ClassReports rows={data.rows} empty={<Card><Empty icon={ClipboardCheck} title="No class reports yet" text="Your teacher fills in a report after each class." /></Card>} />
        </>
      )}
      <LeaveDialog open={leaveOpen} onClose={() => setLeaveOpen(false)} onSaved={() => { reload(true); setParams({ tab: "leave" }); }} />
    </>
  );
}

// ============================================================================
// THE FORM (teacher submits; admin corrects)
// ============================================================================
function AttendanceFormDialog({ meetingId, admin, onClose, onSaved }) {
  const ui = useUi();
  const path = admin ? `/admin/attendance/forms/${meetingId}` : `/teacher/attendance/${meetingId}`;
  const { data, loading, error, reload } = useAsync(() => (meetingId ? api.get(path) : Promise.resolve(null)), [meetingId]);
  const [edits, setEdits] = useState({});
  const [cls, setCls] = useState({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  if (!meetingId) return null;
  const form = data?.form;
  const rows = (form?.rows || []).map((r) => ({ ...r, ...edits[r.studentId] }));
  const set = (sid, patch) => setEdits((e) => ({ ...e, [sid]: { ...(e[sid] || {}), ...patch } }));
  const readOnly = form && !form.editable;
  const statusLocked = !admin; // date, time, minutes and status come from the classroom – teachers can't change them
  const c = (k) => cls[k] ?? form?.[k] ?? "";
  const submit = async () => {
    setBusy(true);
    try {
      await api.put(path, {
        rows: rows.map((r) => ({ studentId: r.studentId, ...(admin ? { status: r.status } : {}), remarks: r.remarks, quizTopic: r.quizTopic, quizResult: r.quizResult, testTopic: r.testTopic, testResult: r.testResult })),
        lessonTaken: c("lessonTaken"),
        homework: c("homework"),
        compensationFor: c("compensationFor"),
        remarks: c("remarks"),
        reason,
      });
      ui.toast(admin ? "Saved – the change is in the audit log" : form.status === "submitted" ? "Attendance updated" : "Attendance submitted");
      onSaved?.();
      onClose();
    } catch (e) {
      ui.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title={form ? `${form.subject || form.title} · ${form.day}, ${fmtDate(form.startAt)}` : "Attendance"}
      subtitle={form ? `${form.title} · ${fmtTime(form.startAt)}–${fmtTime(form.endAt)} (${mins(form.scheduledMin)}) · ${form.teacherName}` : ""}
      footer={
        form && !readOnly ? (
          <>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={submit} loading={busy} disabled={!admin && !form.due} icon={CheckCircle2}>
              {admin ? "Save correction" : form.status === "submitted" ? "Update attendance" : "Submit attendance"}
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={onClose}>Close</Button>
        )
      }
    >
      {error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : loading || !form ? (
        <Loading />
      ) : (
        <div className="space-y-4">
          <Notice>
            The times come from the classroom: each join and leave is shown separately, so a network drop and rejoin is just a gap, not an absence. <b>Present</b> needs at least {form.rules.minPercent}% of the class; joining more than {form.rules.graceMin} min after the start is <b>Late</b>
            {form.classStartedAt && form.classStartedAt > form.startAt ? ` (counted from ${fmtTime(form.classStartRef)}, when the class was opened)` : ""}.{" "}
            {statusLocked ? <>Date, time, minutes and status are filled in automatically and <b>can't be changed</b> – fill in the lesson, homework, quiz/test and remarks. If a status looks wrong, tell the academy.</> : "Change a status only with a remark."}
          </Notice>
          {form.status === "submitted" && (
            <p className="text-sm text-muted">
              Submitted {fmtDateTime(form.submittedAt)}{form.submittedByName ? ` by ${form.submittedByName}` : ""}
              {form.correctedAt ? ` · corrected by the academy ${fromNow(form.correctedAt)}` : ""}
              {readOnly && !admin ? " · can no longer be changed" : ""}
            </p>
          )}
          {!admin && !form.due && <Notice tone="warn">The class hasn't finished yet – you can submit once it's over.</Notice>}
          <div className="divide-y divide-line rounded-2xl border border-line">
            {rows.map((r) => (
              <div key={r.studentId} className="grid gap-3 p-4 lg:grid-cols-[1.2fr_1.6fr_auto]">
                <div className="min-w-0">
                  <p className="font-semibold text-navy">{r.name}</p>
                  <p className="text-sm text-slate-600">
                    {mins(r.attendedMin)} of {mins(form.scheduledMin)} · {r.percent}%
                    {r.interruptions > 0 && <span className="ml-1.5 inline-flex items-center gap-1 text-xs text-amber-700"><Wifi className="h-3 w-3" />{plural(r.interruptions, "reconnect")}</span>}
                  </p>
                  {r.leave && <p className="text-xs text-sky-700">Leave request: {LEAVE_STATUS[r.leave.status]?.[1]}{r.leave.reason ? ` – ${r.leave.reason}` : ""}</p>}
                </div>
                <div className="min-w-0 space-y-2">
                  <TimelineBar intervals={r.intervals} startAt={form.startAt} endAt={form.endAt} />
                  <Intervals intervals={r.intervals} compact />
                </div>
                <div className="flex flex-col gap-1.5 lg:w-56">
                  {readOnly || statusLocked ? (
                    <span className="flex items-center gap-1.5"><StatusBadge status={r.status} />{statusLocked && !readOnly && <Lock className="h-3.5 w-3.5 text-slate-400" aria-label="Automatic" />}</span>
                  ) : (
                    <Select size="sm" value={r.status} onChange={(v) => set(r.studentId, { status: v })} options={STATUS_OPTIONS} />
                  )}
                  {r.status !== r.suggested && <span className="text-xs text-amber-700">Suggested: {ATT_STATUS[r.suggested]?.label}</span>}
                </div>
                <div className="lg:col-span-3">
                  {readOnly ? (
                    <dl className="grid gap-x-4 gap-y-1 text-sm text-slate-600 sm:grid-cols-3">
                      {[["Quiz", [r.quizTopic, r.quizResult]], ["Test", [r.testTopic, r.testResult]], ["Remark", [r.remarks]]].map(([k, v]) => v.some(Boolean) && <div key={k}><dt className="inline text-muted">{k}: </dt><dd className="inline">{v.filter(Boolean).join(" – ")}</dd></div>)}
                    </dl>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1.3fr_0.7fr_1.3fr_0.7fr]">
                      <Input value={r.quizTopic || ""} onChange={(e) => set(r.studentId, { quizTopic: e.target.value })} maxLength={200} placeholder="Quiz topic" aria-label="Quiz topic" />
                      <Input value={r.quizResult || ""} onChange={(e) => set(r.studentId, { quizResult: e.target.value })} maxLength={60} placeholder="Quiz result, e.g. 8/10" aria-label="Quiz result" />
                      <Input value={r.testTopic || ""} onChange={(e) => set(r.studentId, { testTopic: e.target.value })} maxLength={200} placeholder="Test topic" aria-label="Test topic" />
                      <Input value={r.testResult || ""} onChange={(e) => set(r.studentId, { testResult: e.target.value })} maxLength={60} placeholder="Test result" aria-label="Test result" />
                      <Input value={r.remarks || ""} onChange={(e) => set(r.studentId, { remarks: e.target.value })} maxLength={500} placeholder={r.status !== r.suggested ? "Remark required – why was the status changed?" : r.interruptions ? "e.g. Network dropped at 10:25, rejoined" : "Remark (optional)"} className={cx("sm:col-span-2 lg:col-span-4", r.status !== r.suggested && !r.remarks && "border-amber-400")} />
                    </div>
                  )}
                </div>
              </div>
            ))}
            {!rows.length && <p className="p-4 text-sm text-muted">No students in this class.</p>}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              ["lessonTaken", "Lesson taken", "e.g. Fractions – adding unlike denominators", 500],
              ["homework", "Homework", "e.g. Exercise 3.2, Q1–10", 500],
              ["compensationFor", "Compensation class", "If this class makes up for a missed one, which (e.g. 14 Nov)", 120],
              ["remarks", "Class remarks", "Network problems, anything the academy should know", 2000],
            ].map(([k, label, ph, max]) => (
              <Field key={k} label={label}>
                {readOnly ? <p className="whitespace-pre-line text-sm text-slate-600">{form[k] || "—"}</p> : <Textarea rows={2} value={c(k)} onChange={(e) => setCls((p) => ({ ...p, [k]: e.target.value }))} maxLength={max} placeholder={ph} />}
              </Field>
            ))}
          </div>
          {admin && (
            <Field label="Reason for the correction" required hint="Saved in the audit log.">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Teacher confirmed the student joined by phone" />
            </Field>
          )}
          {admin && form.history?.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer font-semibold text-navy">History ({form.history.length})</summary>
              <ul className="mt-2 space-y-1 text-muted">
                {form.history.map((h, i) => (
                  <li key={i}>{fmtDateTime(h.at)} – {h.byName}: {h.action.replace(/_/g, " ")}{h.reason ? ` (${h.reason})` : ""}{h.changes?.length ? ` · ${plural(h.changes.length, "status change")}` : ""}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </Dialog>
  );
}

// ============================================================================
// TEACHER
// ============================================================================
export function TeacherAttendance() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState("forms");
  const open = params.get("class");
  const { data, loading, error, reload } = useAsync(() => api.get("/teacher/attendance"), []);
  const [student, setStudent] = useState(null);
  const [subject, setSubject] = useState(null);
  const records = useAsync(() => (tab === "records" ? api.get("/teacher/attendance-records", { studentId: student, subject }) : Promise.resolve(null)), [tab, student, subject]);
  const students = useMemo(() => {
    const m = new Map((records.data?.rows || []).map((r) => [r.studentId, r.studentName]));
    return [...m].map(([value, label]) => ({ value, label }));
  }, [records.data]);
  const setOpen = (id) => setParams(id ? { class: id } : {});
  return (
    <>
      <PageHeader title="Attendance" subtitle={data ? `Fill in attendance after every class. Present = at least ${data.rules.minPercent}% of the class; late = joined more than ${data.rules.graceMin} min after the start.` : ""} />
      <Segmented
        className="mb-5"
        value={tab}
        onChange={setTab}
        options={[
          { value: "forms", label: "Forms", icon: ClipboardCheck, count: data?.pending.length || undefined },
          { value: "records", label: "Student records", icon: History },
        ]}
      />
      <ErrorBox error={error} onRetry={reload} />
      {loading ? (
        <Loading />
      ) : !data ? null : tab === "forms" ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardTitle icon={Clock} title="Waiting for you" subtitle="Classes that finished and need attendance" />
            {data.pending.length ? (
              <ul className="divide-y divide-line">
                {data.pending.map((m) => (
                  <li key={m.meetingId} className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-navy">{m.subject || m.title}</p>
                      <p className="text-sm text-muted">{fmtDateTime(m.startAt)} · {plural(m.studentCount, "student")}</p>
                    </div>
                    {m.overdue && <Badge tone="red">Overdue</Badge>}
                    <Button size="sm" onClick={() => setOpen(m.meetingId)}>Fill in</Button>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty icon={CheckCircle2} title="All caught up" text="Every finished class has its attendance." />
            )}
          </Card>
          <SubmittedForms list={data.submitted} onOpen={setOpen} />
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-3">
            <Select className="w-full sm:w-56" value={student} onChange={setStudent} options={students} placeholder="All students" clearable searchable />
            {(records.data?.subjects || []).length > 1 && <Select className="w-full sm:w-48" value={subject} onChange={setSubject} options={records.data.subjects.map((s) => ({ value: s, label: s }))} placeholder="All subjects" clearable />}
          </div>
          {records.loading ? <Loading /> : records.data && (
            <>
              <SummaryCards s={records.data.summary} />
              <Card flush>
                <Table pageSize={25} rows={records.data.rows} columns={recordColumns({ showStudent: true })} empty={<Empty icon={ClipboardCheck} title="No records yet" />} />
              </Card>
            </>
          )}
        </>
      )}
      <AttendanceFormDialog meetingId={open} onClose={() => setOpen(null)} onSaved={() => reload(true)} />
    </>
  );
}

// Submitted forms, 10 at a time (or 15) with a page bar
function SubmittedForms({ list, onOpen }) {
  const pg = usePaged(list, 10, [10, 15]);
  return (
    <Card className="flex flex-col">
      <CardTitle icon={History} title="Submitted" subtitle={list.length ? `${plural(list.length, "form")} – newest first` : undefined} />
      {list.length ? (
        <>
          <ul className="divide-y divide-line">
            {pg.rows.map((f) => (
              <li key={f.meetingId} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-navy">{f.subject || f.title}</p>
                  <p className="text-sm text-muted">{fmtDateTime(f.startAt)} · {f.attended}/{f.conducted} attended</p>
                </div>
                <Button size="sm" variant="outline" icon={f.editable ? Pencil : undefined} onClick={() => onOpen(f.meetingId)}>{f.editable ? "Edit" : "View"}</Button>
              </li>
            ))}
          </ul>
          {pg.show && <div className="-mx-5 -mb-5 mt-auto sm:-mx-6 sm:-mb-6"><Pager {...pg.pager} /></div>}
        </>
      ) : (
        <Empty title="Nothing submitted yet" />
      )}
    </Card>
  );
}

const recordColumns = ({ showStudent, showTeacher, onOpen }) => [
  { key: "date", label: "Date", render: (r) => <span className="whitespace-nowrap"><b className="text-navy">{fmtDate(r.startAt)}</b><span className="block text-xs text-muted">{r.day}, {fmtTime(r.startAt)}</span></span> },
  ...(showStudent ? [{ key: "studentName", label: "Student", render: (r) => <span className="font-semibold text-navy">{r.studentName}</span> }] : []),
  { key: "subject", label: "Subject", render: (r) => <span>{r.subject || "—"}<span className="block text-xs text-muted">Class #{r.classNo}{showTeacher ? ` · ${r.teacherName}` : ""}</span></span> },
  { key: "status", label: "Status", render: (r) => <span className="flex flex-col items-start gap-0.5"><StatusBadge status={r.status} />{r.overridden && <span className="text-[11px] text-amber-700">changed by teacher</span>}{r.corrected && <span className="text-[11px] text-sky-700">corrected</span>}</span> },
  { key: "time", label: "Attended", render: (r) => <span className="whitespace-nowrap">{mins(r.attendedMin)} <span className="text-xs text-muted">/ {mins(r.scheduledMin)}</span></span> },
  { key: "intervals", label: "Join / leave", render: (r) => <Intervals intervals={r.intervals} compact /> },
  { key: "lessonTaken", label: "Lesson taught", className: "max-w-[220px]", render: (r) => <span className="line-clamp-2 text-sm text-slate-700" title={r.lessonTaken}>{r.lessonTaken || "—"}</span> },
  { key: "homework", label: "Homework", className: "max-w-[200px]", render: (r) => <span className="line-clamp-2 text-sm text-slate-700" title={r.homework}>{r.homework || "—"}</span> },
  { key: "quizTest", label: "Quiz / test", className: "max-w-[200px]", render: (r) => (r.quizTopic || r.quizResult || r.testTopic || r.testResult ? <span className="text-sm text-slate-700">{(r.quizTopic || r.quizResult) && <span className="block">Quiz: {[r.quizTopic, r.quizResult].filter(Boolean).join(" – ")}</span>}{(r.testTopic || r.testResult) && <span className="block">Test: {[r.testTopic, r.testResult].filter(Boolean).join(" – ")}</span>}</span> : "—") },
  { key: "remarks", label: "Remarks", className: "max-w-[200px]", render: (r) => <span className="line-clamp-2 text-sm text-slate-600" title={r.remarks}>{r.remarks || "—"}</span> },
  ...(onOpen ? [{ key: "open", label: "", render: (r) => <Button size="xs" variant="ghost" icon={Pencil} onClick={(e) => { e.stopPropagation(); onOpen(r.meetingId); }}>Form</Button> }] : []),
];

// ============================================================================
// ADMIN
// ============================================================================
const TABS = [
  { value: "overview", label: "Records" },
  { value: "students", label: "By student" },
  { value: "teachers", label: "By teacher" },
  { value: "subjects", label: "By subject" },
  { value: "sessions", label: "By session" },
  { value: "dates", label: "By date" },
  { value: "pending", label: "Pending forms" },
  { value: "leave", label: "Leave requests" },
  { value: "rules", label: "Rules" },
  { value: "legacy", label: "Legacy weekly forms" },
];

export function AdminAttendance() {
  const ui = useUi();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "overview";
  const setTab = (v) => setParams(v === "overview" ? {} : { tab: v });
  const [filters, setFilters] = useState({ studentId: null, teacherId: null, subject: null, sessionId: null, status: null, from: "", to: "" });
  const [open, setOpen] = useState(null);
  const [view, setView] = useState("reports");
  const reportTab = ["overview", "students", "teachers", "subjects", "sessions", "dates"].includes(tab);
  const data = useAsync(() => (reportTab ? api.get("/admin/attendance/records", filters) : Promise.resolve(null)), [reportTab, JSON.stringify(filters)]);
  const pending = useAsync(() => api.get("/admin/attendance/pending"), [tab === "pending"]);
  const leaves = useAsync(() => api.get("/admin/leave-requests"), [tab === "leave"]);
  const pendingLeave = (leaves.data?.requests || []).filter((l) => l.status === "pending").length;
  const f = (k) => (v) => setFilters((p) => ({ ...p, [k]: v?.target ? v.target.value : v }));
  const d = data.data;
  const exportCsv = () => api.download("/admin/attendance/records", { ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), format: "csv" }).catch(ui.error);

  return (
    <>
      <PageHeader title="Attendance" subtitle="Class-wise attendance submitted by teachers, from each student's real join and leave times." actions={reportTab && <Button variant="outline" icon={Download} onClick={exportCsv}>Export CSV</Button>} />
      <Segmented className="mb-5" value={tab} onChange={setTab} options={TABS.map((t) => ({ ...t, count: t.value === "pending" ? pending.data?.pending.length || undefined : t.value === "leave" ? pendingLeave || undefined : undefined }))} />

      {reportTab && (
        <>
          <div className="mb-5 flex flex-wrap items-end gap-3">
            <Select className="w-full sm:w-52" value={filters.studentId} onChange={f("studentId")} options={(d?.students || []).map((s) => ({ value: s.id, label: s.name }))} placeholder="All students" clearable searchable />
            <Select className="w-full sm:w-52" value={filters.teacherId} onChange={f("teacherId")} options={(d?.teachers || []).map((s) => ({ value: s.id, label: s.name }))} placeholder="All teachers" clearable searchable />
            <Select className="w-full sm:w-52" value={filters.sessionId} onChange={f("sessionId")} options={(d?.sessions || []).map((s) => ({ value: s.id, label: s.name }))} placeholder="All sessions" clearable />
            <Select className="w-full sm:w-44" value={filters.subject} onChange={f("subject")} options={(d?.subjects || []).map((s) => ({ value: s, label: s }))} placeholder="All subjects" clearable />
            <Select className="w-full sm:w-48" value={filters.status} onChange={f("status")} options={STATUS_OPTIONS} placeholder="Any status" clearable />
            <Field label="From" className="w-full sm:w-40"><Input type="date" value={filters.from} onChange={f("from")} /></Field>
            <Field label="To" className="w-full sm:w-40"><Input type="date" value={filters.to} onChange={f("to")} /></Field>
          </div>
          <ErrorBox error={data.error} onRetry={data.reload} />
          {data.loading && !d ? (
            <Loading />
          ) : d && (
            <>
              <SummaryCards s={d.summary} leaveCounts={d.leaveCounts} />
              {tab === "overview" && (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted">{view === "reports" ? "Each class with the lesson taught, homework, quiz/test results and remarks." : "Click a row to open the full form."}</p>
                  <Segmented value={view} onChange={setView} options={[{ value: "reports", label: "Class reports", icon: LayoutList }, { value: "table", label: "Table", icon: Table2 }]} />
                </div>
              )}
              {tab === "overview" && view === "reports" ? (
                <ClassReports rows={d.rows} admin onOpen={setOpen} empty={<Card><Empty icon={ClipboardCheck} title="No attendance records match" /></Card>} />
              ) : (
              <Card flush>
                {tab === "overview" && <Table pageSize={25} rows={d.rows} onRowClick={(r) => setOpen(r.meetingId)} columns={recordColumns({ showStudent: true, showTeacher: true })} empty={<Empty icon={ClipboardCheck} title="No attendance records match" />} />}
                {tab === "students" && <Table pageSize={25} rows={groupBy(d.rows, "studentId", "studentName")} columns={groupColumns("Student")} onRowClick={(g) => { setFilters((p) => ({ ...p, studentId: g.id })); setTab("overview"); }} />}
                {tab === "teachers" && <Table pageSize={25} rows={groupBy(d.rows, "teacherId", "teacherName")} columns={groupColumns("Teacher")} onRowClick={(g) => { setFilters((p) => ({ ...p, teacherId: g.id })); setTab("overview"); }} />}
                {tab === "subjects" && <Table pageSize={25} rows={groupBy(d.rows, "subject")} columns={groupColumns("Subject")} onRowClick={(g) => { setFilters((p) => ({ ...p, subject: g.id })); setTab("overview"); }} />}
                {tab === "sessions" && <Table pageSize={25} rows={groupBy(d.rows.map((r) => ({ ...r, sessionId: r.sessionId || "none", sessionName: (d.sessions || []).find((x) => x.id === r.sessionId)?.name || "No session" })), "sessionId", "sessionName")} columns={groupColumns("Session")} onRowClick={(g) => { if (g.id !== "none") { setFilters((p) => ({ ...p, sessionId: g.id })); setTab("overview"); } }} />}
                {tab === "dates" && <Table pageSize={25} rows={groupBy(d.rows, "date").sort((a, b) => (a.id < b.id ? 1 : -1)).map((g) => ({ ...g, name: fmtDay(`${g.id}T12:00:00`) }))} columns={groupColumns("Date")} onRowClick={(g) => { setFilters((p) => ({ ...p, from: g.id, to: g.id })); setTab("overview"); }} />}
              </Card>
              )}
            </>
          )}
        </>
      )}

      {tab === "pending" && <PendingForms state={pending} onOpen={setOpen} />}
      {tab === "leave" && <AdminLeave state={leaves} />}
      {tab === "rules" && <RulesCard />}
      {tab === "legacy" && <LegacyWeekly />}

      <AttendanceFormDialog meetingId={open} admin onClose={() => setOpen(null)} onSaved={() => { data.reload(true); pending.reload(true); }} />
    </>
  );
}

function PendingForms({ state, onOpen }) {
  if (state.loading) return <Loading />;
  if (state.error) return <ErrorBox error={state.error} onRetry={state.reload} />;
  const { pending, notConducted, rules } = state.data;
  return (
    <div className="grid gap-6">
      <Card padded={false}>
        <div className="p-5 pb-0 sm:p-6 sm:pb-0"><CardTitle icon={Clock} title="Forms not submitted by teachers" subtitle={`Teachers are reminded ${rules.reminderHours} h after the class ends`} /></div>
        <Table
          rows={pending}
          rowKey="meetingId"
          onRowClick={(r) => onOpen(r.meetingId)}
          empty={<Empty icon={CheckCircle2} title="Every conducted class has its attendance" />}
          columns={[
            { key: "startAt", label: "Class", render: (r) => <span><b className="text-navy">{r.subject || r.title}</b><span className="block text-xs text-muted">{fmtDateTime(r.startAt)}</span></span> },
            { key: "teacherName", label: "Teacher" },
            { key: "studentCount", label: "Students" },
            { key: "since", label: "Waiting", render: (r) => <span className="flex items-center gap-2">{r.hoursSinceEnd < 48 ? `${r.hoursSinceEnd} h` : `${Math.round(r.hoursSinceEnd / 24)} days`}{r.overdue && <Badge tone="red">Overdue</Badge>}</span> },
          ]}
        />
      </Card>
      <Card padded={false}>
        <div className="p-5 pb-0 sm:p-6 sm:pb-0"><CardTitle icon={AlertTriangle} title="Not conducted" subtitle="Scheduled classes that were never started in the classroom. Open one to fill in attendance by hand if it took place." /></div>
        <Table
          rows={notConducted}
          rowKey="meetingId"
          pageSize={10}
          onRowClick={(r) => onOpen(r.meetingId)}
          empty={<Empty title="None" />}
          columns={[
            { key: "startAt", label: "Class", render: (r) => <span><b className="text-navy">{r.subject || r.title}</b><span className="block text-xs text-muted">{fmtDateTime(r.startAt)}</span></span> },
            { key: "teacherName", label: "Teacher" },
            { key: "studentCount", label: "Students" },
          ]}
        />
      </Card>
    </div>
  );
}

function AdminLeave({ state }) {
  const ui = useUi();
  const [status, setStatus] = useState("pending");
  const [q, setQ] = useState("");
  const [deciding, setDeciding] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  if (state.loading) return <Loading />;
  if (state.error) return <ErrorBox error={state.error} onRetry={state.reload} />;
  const all = state.data.requests;
  const rows = all.filter((l) => (status === "all" || l.status === status) && (!q || `${l.studentName} ${l.subject} ${l.classTitle}`.toLowerCase().includes(q.toLowerCase())));
  const decide = async () => {
    setBusy(true);
    try {
      await api.post(`/admin/leave-requests/${deciding.l.id}/decide`, { decision: deciding.decision, note });
      ui.toast(deciding.decision === "approve" ? "Leave approved – the student was notified" : "Leave rejected – the student was notified");
      setDeciding(null);
      setNote("");
      state.reload(true);
    } catch (e) {
      ui.error(e);
    } finally {
      setBusy(false);
    }
  };
  const count = (s) => all.filter((l) => l.status === s).length;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented value={status} onChange={setStatus} options={[{ value: "pending", label: "Waiting", count: count("pending") }, { value: "approved", label: "Approved", count: count("approved") }, { value: "rejected", label: "Rejected", count: count("rejected") }, { value: "all", label: "All" }]} />
        <div className="flex-1" />
        <SearchInput value={q} onChange={setQ} className="w-full sm:w-64" placeholder="Search student or subject…" />
      </div>
      <Card flush>
        <Table
          pageSize={25}
          rows={rows}
          empty={<Empty icon={CalendarOff} title="No leave requests here" />}
          columns={[
            { key: "studentName", label: "Student", render: (l) => <span className="font-semibold text-navy">{l.studentName}</span> },
            { key: "class", label: "Class", render: (l) => <span>{l.subject || l.classTitle}<span className="block text-xs text-muted">{fmtDateTime(l.classStartAt)} · {l.teacherName}</span></span> },
            { key: "reason", label: "Reason", className: "max-w-[260px]", render: (l) => <span className="text-sm">{l.reason}{l.remarks && <span className="block text-xs text-muted">{l.remarks}</span>}</span> },
            { key: "createdAt", label: "Requested", render: (l) => <span className="whitespace-nowrap text-sm">{fromNow(l.createdAt)}</span> },
            { key: "status", label: "Status", render: (l) => <span className="flex flex-col items-start gap-0.5"><Badge tone={LEAVE_STATUS[l.status]?.[0]}>{LEAVE_STATUS[l.status]?.[1]}</Badge>{l.decidedByName && <span className="text-[11px] text-muted">by {l.decidedByName}</span>}</span> },
            {
              key: "actions",
              label: "",
              render: (l) =>
                l.status === "pending" ? (
                  <span className="flex gap-1.5">
                    <Button size="xs" onClick={() => setDeciding({ l, decision: "approve" })}>Approve</Button>
                    <Button size="xs" variant="outline" onClick={() => setDeciding({ l, decision: "reject" })}>Reject</Button>
                  </span>
                ) : l.status === "approved" ? (
                  <Button size="xs" variant="ghost" onClick={() => setDeciding({ l, decision: "reject" })}>Reject</Button>
                ) : l.status === "rejected" ? (
                  <Button size="xs" variant="ghost" onClick={() => setDeciding({ l, decision: "approve" })}>Approve</Button>
                ) : null,
            },
          ]}
        />
      </Card>
      <Dialog
        open={!!deciding}
        onClose={() => setDeciding(null)}
        size="sm"
        title={deciding?.decision === "approve" ? "Approve leave" : "Reject leave"}
        subtitle={deciding ? `${deciding.l.studentName} · ${deciding.l.subject || deciding.l.classTitle} · ${fmtDateTime(deciding.l.classStartAt)}` : ""}
        footer={
          <>
            <Button variant="outline" onClick={() => setDeciding(null)}>Cancel</Button>
            <Button variant={deciding?.decision === "reject" ? "danger" : "primary"} onClick={decide} loading={busy}>{deciding?.decision === "approve" ? "Approve" : "Reject"}</Button>
          </>
        }
      >
        <Field label={deciding?.decision === "reject" ? "Reason (sent to the student)" : "Note to the student (optional)"} required={deciding?.decision === "reject"}>
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        </Field>
      </Dialog>
    </>
  );
}

function RulesCard() {
  const ui = useUi();
  const { data, loading, error, reload } = useAsync(() => api.get("/admin/attendance/rules"), []);
  const [r, setR] = useState(null);
  const [busy, setBusy] = useState(false);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const v = r || data.rules;
  const set = (k) => (e) => setR({ ...v, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const out = await api.put("/admin/attendance/rules", v);
      setR(out.rules);
      ui.toast("Attendance rules saved");
    } catch (err) {
      ui.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="max-w-3xl">
      <CardTitle icon={Settings2} title="Attendance rules" subtitle="Used to set each student's status automatically. Teachers can't change it; an admin can correct it with a reason. Saved forms keep the status they were submitted with." />
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <Field label="Minimum attendance for Present (%)" hint={`Of the scheduled class time. Default ${data.defaults.minPercent}%.`}>
          <Input type="number" min={1} max={100} value={v.minPercent} onChange={set("minPercent")} required />
        </Field>
        <Field label="Late after (minutes from the start)" hint={`Default ${data.defaults.graceMin} min. Counted from when the teacher opened the class if that was later.`}>
          <Input type="number" min={0} max={120} value={v.graceMin} onChange={set("graceMin")} required />
        </Field>
        <Field label="Remind teachers after (hours)" hint="If a class's form isn't submitted by then.">
          <Input type="number" min={1} max={168} value={v.reminderHours} onChange={set("reminderHours")} required />
        </Field>
        <Field label="Forms needed for classes from" hint="Older classes were before class-wise attendance.">
          <Input type="date" value={v.formsFrom} onChange={set("formsFrom")} required />
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" loading={busy}>Save rules</Button>
        </div>
      </form>
    </Card>
  );
}

// ---- Legacy weekly student forms (read-only) --------------------------------------------
const WEEKEND = { yes: "Yes", partial: "Partly", no: "No" };
function LegacyWeekly() {
  const [week, setWeek] = useState(null);
  const { data, loading, error, reload } = useAsync(() => api.get("/admin/attendance-legacy", { weekStart: week }), [week]);
  const [view, setView] = useState(null);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <>
      <Notice className="mb-4">The weekly forms students used to fill in. They're kept for reference and can't be changed; attendance is now submitted by teachers for each class.</Notice>
      <div className="mb-4">
        <Select className="w-full sm:w-72" value={data.weekStart} onChange={setWeek} options={data.weeks.map((w) => ({ value: w, label: `Week of ${fmtWeek(w)}` }))} placeholder="Choose a week" />
      </div>
      <Card flush>
        <Table
          rows={data.rows}
          onRowClick={setView}
          empty={<Empty icon={ClipboardCheck} title="No weekly forms" />}
          columns={[
            { key: "studentName", label: "Student", render: (r) => <span className="font-semibold text-navy">{r.studentName}</span> },
            { key: "teacherName", label: "Teacher", render: (r) => r.teacherName || "—" },
            { key: "weekend", label: "Weekend", render: (r) => WEEKEND[r.entry?.weekendAttendance] || "—" },
            { key: "classes", label: "Classes", render: (r) => r.entry?.classesAttended ?? "—" },
            { key: "lessons", label: "Lessons covered", className: "max-w-[260px]", render: (r) => <span className="line-clamp-1">{r.entry?.lessonsCovered || "—"}</span> },
            { key: "submittedAt", label: "Submitted", render: (r) => fmtDateTime(r.entry?.submittedAt) },
          ]}
        />
      </Card>
      <Dialog open={!!view} onClose={() => setView(null)} title={view?.studentName} subtitle={view && fmtWeek(view.weekStart)}>
        {view?.entry && (
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-muted">Weekend attendance</dt><dd>{WEEKEND[view.entry.weekendAttendance]}</dd></div>
            <div><dt className="text-xs text-muted">Classes attended</dt><dd>{view.entry.classesAttended}</dd></div>
            <div className="sm:col-span-2"><dt className="text-xs text-muted">Lessons covered</dt><dd className="whitespace-pre-line">{view.entry.lessonsCovered}</dd></div>
            <div className="sm:col-span-2"><dt className="text-xs text-muted">Review</dt><dd className="whitespace-pre-line">{view.entry.review || "—"}</dd></div>
            <div className="sm:col-span-2"><dt className="text-xs text-muted">Remarks</dt><dd className="whitespace-pre-line">{view.entry.remarks || "—"}</dd></div>
            {view.entry.correctedAt && <div className="sm:col-span-2"><dt className="text-xs text-muted">Correction</dt><dd>{view.entry.correctedByName}: {view.entry.correctionReason}</dd></div>}
          </dl>
        )}
      </Dialog>
    </>
  );
}
