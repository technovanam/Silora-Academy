// ============================================================
// CLASS (MEETING) COMPONENTS – cards, week calendar, forms
// ============================================================
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Repeat, Users, Video } from "lucide-react";
import { api } from "../lib/api.js";
import { fmtDay, fmtTime, fromLocalInput, toLocalInput, plural } from "../lib/format.js";
import { Badge, Button, Dialog, Field, Input, Notice, Select, Textarea, cx, useUi } from "../ui/index.jsx";

export const MAX_GROUP = 30; // same as MAX_CLASS_SIZE on the backend
export const OPEN_EARLY_MIN = 15; // the class can be joined this long before it starts (OPEN_EARLY_MIN on the backend)
const OPEN_LATE_MIN = 60;

// Where a class is in time: "upcoming", "live" (between start and end), "overtime"
// (up to 30 minutes after the end) or "ended"
export function classState(m, now = Date.now()) {
  if (m.status === "cancelled") return "cancelled";
  const start = new Date(m.startAt).getTime();
  const end = new Date(m.endAt).getTime();
  if (now > end + 30 * 60000) return "ended";
  if (now < start) return "upcoming";
  return now <= end ? "live" : "overtime";
}

const STATUS = {
  scheduled: ["blue", "Scheduled"],
  completed: ["gray", "Completed"],
  cancelled: ["red", "Cancelled"],
};
export function ClassStatus({ m }) {
  const js = classState(m);
  if (m.status === "scheduled" && (js === "live" || js === "overtime"))
    return (
      <Badge tone="red" dot>
        In progress
      </Badge>
    );
  const [tone, label] = STATUS[m.status] || ["gray", m.status];
  return <Badge tone={tone}>{label}</Badge>;
}

export function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

// Opens the live class screen. Students and teachers can join from 15 minutes before
// the start; admins (allowEarly) at any time.
export function JoinButton({ m, size = "md", className, allowEarly }) {
  const navigate = useNavigate();
  const now = useNow();
  const start = new Date(m.startAt).getTime();
  const end = new Date(m.endAt).getTime();
  if (m.status === "cancelled" || now > end + OPEN_LATE_MIN * 60000) return null;
  const opens = start - OPEN_EARLY_MIN * 60000;
  const open = allowEarly || now >= opens;
  const live = now >= start && now <= end;
  const mins = Math.ceil((opens - now) / 60000);
  const wait = mins > 60 * 24 ? `Opens ${fmtDay(new Date(opens))}` : `Opens in ${mins > 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`}`;
  return (
    <Button size={size} className={className} icon={Video} variant={live ? "success" : "primary"} disabled={!open} title={open ? "" : `Opens ${OPEN_EARLY_MIN} minutes before the start`} onClick={(e) => (e.stopPropagation(), navigate(`/portal/class/${m.id}`))}>
      {open ? (live ? "Join now" : "Join class") : wait}
    </Button>
  );
}

// Who joined the live class and for how long (teachers and admins)
export function LiveAttendance({ meeting }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let dead = false;
    api
      .get(`/meetings/${meeting.id}/live/attendance`)
      .then((r) => !dead && setData(r))
      .catch((e) => !dead && setError(e));
    return () => {
      dead = true;
    };
  }, [meeting.id]);
  if (error) return <p className="text-sm text-rose-600">{error.message}</p>;
  if (!data) return <p className="text-sm text-muted">Loading attendance…</p>;
  if (!data.started) return <p className="text-sm text-muted">The live class hasn't been started yet.</p>;
  const came = data.students.filter((s) => s.joined).length;
  return (
    <div>
      <p className="text-sm text-muted">
        {came} of {data.students.length} joined{data.live ? " · class is live now" : ""}
      </p>
      <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
        {data.students.map((s) => (
          <li key={s.userId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <span className="truncate text-ink">{s.name}</span>
            {s.joined ? (
              <span className="shrink-0 text-slate-600">
                {s.inClassNow && <Badge tone="green">In class</Badge>} {s.minutes} min · joined {fmtTime(s.firstJoinedAt)}
              </span>
            ) : (
              <Badge tone="red">Absent</Badge>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ClassRow({ m, showStudents = true, showTeacher = false, actions, onClick }) {
  const d = new Date(m.startAt);
  return (
    <div className={cx("flex flex-col gap-4 rounded-2xl border border-line bg-white p-4 sm:flex-row sm:items-center", m.status === "cancelled" && "opacity-70", onClick && "cursor-pointer transition hover:border-slate-300 hover:shadow-sm")} onClick={onClick}>
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-2xl bg-navy text-white">
          <span className="text-[11px] font-semibold uppercase text-brand">{d.toLocaleDateString("en-IN", { month: "short" })}</span>
          <span className="text-xl font-bold leading-none">{d.getDate()}</span>
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className={cx("truncate font-semibold text-navy", m.status === "cancelled" && "line-through")}>{m.title}</p>
            <ClassStatus m={m} />
            {m.isGroup && (
              <Badge tone="violet">
                <Users className="h-3 w-3" /> Group
              </Badge>
            )}
            {m.pendingRequest && <Badge tone="amber">{m.pendingRequest.type === "cancel" ? "Cancel requested" : "Reschedule requested"}</Badge>}
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" /> {fmtDay(m.startAt)} · {fmtTime(m.startAt)} – {fmtTime(m.endAt)}
            </span>
            {m.subject && <span>{m.subject}</span>}
            {showTeacher && <span>with {m.teacherName}</span>}
          </p>
          {showStudents && m.students?.length > 0 && <p className="mt-0.5 truncate text-xs text-slate-500">{m.students.map((s) => s.name).join(", ")}</p>}
          {m.status === "cancelled" && m.cancelledReason && <p className="mt-0.5 text-xs text-rose-600">Reason: {m.cancelledReason}</p>}
          {m.previousStartAt && m.status === "scheduled" && <p className="mt-0.5 text-xs text-amber-700">Moved from {fmtDay(m.previousStartAt)} {fmtTime(m.previousStartAt)}</p>}
        </div>
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 sm:justify-end" onClick={(e) => e.stopPropagation()}>
          {actions}
        </div>
      )}
    </div>
  );
}

// ---- Week calendar ---------------------------------------------------------------
export function mondayOf(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d;
}

export function WeekCalendar({ weekStart, onWeekChange, meetings, onSelect, showTeacher }) {
  const days = [...Array(7)].map((_, i) => new Date(weekStart.getTime() + i * 86400000));
  const today = new Date().toDateString();
  const end = new Date(weekStart.getTime() + 7 * 86400000);
  const label = `${days[0].toLocaleDateString("en-IN", { day: "numeric", month: "short" })} – ${days[6].toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`;
  const byDay = (d) => meetings.filter((m) => new Date(m.startAt).toDateString() === d.toDateString()).sort((a, b) => (a.startAt < b.startAt ? -1 : 1));
  const inWeek = meetings.filter((m) => new Date(m.startAt) >= weekStart && new Date(m.startAt) < end);

  return (
    <div className="rounded-2xl border border-line bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2">
          <button className="rounded-full p-2 text-slate-500 hover:bg-surface hover:text-navy" onClick={() => onWeekChange(new Date(weekStart.getTime() - 7 * 86400000))} aria-label="Previous week">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <p className="min-w-[180px] text-center font-semibold text-navy">{label}</p>
          <button className="rounded-full p-2 text-slate-500 hover:bg-surface hover:text-navy" onClick={() => onWeekChange(new Date(weekStart.getTime() + 7 * 86400000))} aria-label="Next week">
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted">
            {plural(inWeek.filter((m) => m.status !== "cancelled").length, "class", "classes")}
          </span>
          <Button size="sm" variant="outline" onClick={() => onWeekChange(mondayOf())}>
            Today
          </Button>
        </div>
      </div>
      {/* Desktop: 7 columns */}
      <div className="hidden grid-cols-7 lg:grid">
        {days.map((d) => (
          <div key={d.toISOString()} className="min-h-[320px] border-r border-line last:border-r-0">
            <div className={cx("border-b border-line px-3 py-2 text-center", d.toDateString() === today && "bg-brand-soft")}>
              <p className="text-xs font-semibold uppercase text-slate-400">{d.toLocaleDateString("en-IN", { weekday: "short" })}</p>
              <p className={cx("text-lg font-bold", d.toDateString() === today ? "text-[#a77d00]" : "text-navy")}>{d.getDate()}</p>
            </div>
            <div className="space-y-2 p-2">
              {byDay(d).map((m) => (
                <EventChip key={m.id} m={m} onClick={() => onSelect(m)} showTeacher={showTeacher} />
              ))}
            </div>
          </div>
        ))}
      </div>
      {/* Mobile / tablet: agenda */}
      <div className="divide-y divide-line lg:hidden">
        {days.map((d) => {
          const list = byDay(d);
          return (
            <div key={d.toISOString()} className={cx("flex gap-4 px-4 py-3", d.toDateString() === today && "bg-brand-soft/40")}>
              <div className="w-12 shrink-0 text-center">
                <p className="text-xs font-semibold uppercase text-slate-400">{d.toLocaleDateString("en-IN", { weekday: "short" })}</p>
                <p className="text-lg font-bold text-navy">{d.getDate()}</p>
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                {list.length ? list.map((m) => <EventChip key={m.id} m={m} onClick={() => onSelect(m)} showTeacher={showTeacher} />) : <p className="py-2 text-sm text-slate-400">No classes</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EventChip({ m, onClick, showTeacher }) {
  const js = classState(m);
  const tone =
    m.status === "cancelled" ? "border-rose-200 bg-rose-50 text-rose-700" : js === "ended" || m.status === "completed" ? "border-line bg-surface text-slate-500" : js === "live" || js === "overtime" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-sky-200 bg-sky-50 text-sky-900";
  return (
    <button onClick={onClick} className={cx("block w-full rounded-xl border px-2.5 py-2 text-left text-xs transition hover:shadow-sm", tone)}>
      <span className="block font-semibold">{fmtTime(m.startAt)}</span>
      <span className={cx("block truncate font-medium", m.status === "cancelled" && "line-through")}>{m.title}</span>
      <span className="block truncate opacity-75">{showTeacher ? m.teacherName : m.students?.map((s) => s.name.split(" ")[0]).join(", ")}</span>
    </button>
  );
}

// ---- Create / edit form ------------------------------------------------------------
const DURATIONS = [
  [30, "30 minutes"],
  [45, "45 minutes"],
  [60, "1 hour"],
  [75, "1 h 15 min"],
  [90, "1 h 30 min"],
  [120, "2 hours"],
].map(([value, label]) => ({ value, label }));
const REPEATS = [1, 2, 4, 6, 8, 12].map((v) => ({ value: v, label: v === 1 ? "Doesn't repeat" : `Weekly, ${v} weeks` }));

/**
 * mode: "teacher" (students = own students) or "admin" (choose teacher first)
 * students: [{id,name,teacherId,grade}], teachers: [{id,name}]
 */
export function ClassFormDialog({ open, onClose, onSaved, mode, students = [], teachers = [], meeting, defaultStart }) {
  const ui = useUi();
  const editing = !!meeting;
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setF(
      meeting
        ? { title: meeting.title, subject: meeting.subject, teacherId: meeting.teacherId, studentIds: meeting.studentIds || [], startAt: toLocalInput(meeting.startAt), durationMin: meeting.durationMin, notes: meeting.notes || "", repeatWeeks: 1 }
        : { title: "", subject: "", teacherId: teachers.length === 1 ? teachers[0].id : null, studentIds: [], startAt: toLocalInput(defaultStart || nextSlot()), durationMin: 60, notes: "", repeatWeeks: 1 }
    );
  }, [open, meeting]); // eslint-disable-line react-hooks/exhaustive-deps

  const pool = useMemo(() => students.filter((s) => s.active !== false && (mode === "teacher" || s.teacherId === f.teacherId)), [students, f.teacherId, mode]);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v?.target ? v.target.value : v }));

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    if (!f.studentIds?.length) return setError("Choose at least one student");
    setBusy(true);
    try {
      const body = { title: f.title, subject: f.subject, studentIds: f.studentIds, notes: f.notes };
      if (mode === "admin") body.teacherId = f.teacherId;
      if (editing) {
        if (mode === "admin") Object.assign(body, { startAt: fromLocalInput(f.startAt), durationMin: f.durationMin });
        await api.patch(`/meetings/${meeting.id}`, body);
        ui.toast("Class updated");
      } else {
        const r = await api.post("/meetings", { ...body, startAt: fromLocalInput(f.startAt), durationMin: f.durationMin, repeatWeeks: f.repeatWeeks });
        ui.toast(r.ids.length > 1 ? `${r.ids.length} weekly classes scheduled` : "Class scheduled");
      }
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const timeLocked = editing && mode === "teacher";
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? "Edit class" : "Schedule a class"}
      subtitle={`One student, or a group of up to ${MAX_GROUP}. Students get a notification and a reminder ${5} minutes before.`}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="class-form" loading={busy}>
            {editing ? "Save changes" : "Schedule class"}
          </Button>
        </>
      }
    >
      <form id="class-form" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        {error && <Notice tone="danger" className="sm:col-span-2">{error}</Notice>}
        <Field label="Class title" required className="sm:col-span-2">
          <Input value={f.title || ""} onChange={set("title")} placeholder="e.g. Algebra – quadratic equations" required maxLength={120} />
        </Field>
        <Field label="Subject">
          <Input value={f.subject || ""} onChange={set("subject")} placeholder="e.g. Mathematics" maxLength={80} />
        </Field>
        {mode === "admin" ? (
          <Field label="Teacher" required>
            <Select
              value={f.teacherId}
              onChange={(v) => setF((p) => ({ ...p, teacherId: v, studentIds: [] }))}
              options={teachers.map((t) => ({ value: t.id, label: t.name, hint: t.subjects?.join(", ") }))}
              placeholder="Choose a teacher"
            />
          </Field>
        ) : (
          <div className="hidden sm:block" />
        )}
        <Field label={`Students (max ${MAX_GROUP})`} required className="sm:col-span-2" hint={mode === "admin" && !f.teacherId ? "Choose the teacher first" : pool.length === 0 ? "No active students assigned yet" : f.studentIds?.length > 1 ? "Group class" : ""}>
          <Select multiple max={MAX_GROUP} value={f.studentIds || []} onChange={set("studentIds")} options={pool.map((s) => ({ value: s.id, label: s.name, hint: [s.grade, s.board].filter(Boolean).join(" · ") }))} placeholder="Choose students" disabled={mode === "admin" && !f.teacherId} searchable />
        </Field>
        <Field label="Date & time" required hint={timeLocked ? "To change the time, send a reschedule request" : ""}>
          <Input type="datetime-local" value={f.startAt || ""} onChange={set("startAt")} required disabled={timeLocked} />
        </Field>
        <Field label="Duration">
          <Select value={f.durationMin} onChange={set("durationMin")} options={DURATIONS} disabled={timeLocked} />
        </Field>
        {!editing && (
          <Field label="Repeat" className="sm:col-span-2">
            <Select value={f.repeatWeeks} onChange={set("repeatWeeks")} options={REPEATS.map((r) => ({ ...r, icon: r.value > 1 ? <Repeat className="h-4 w-4 text-slate-400" /> : <CalendarDays className="h-4 w-4 text-slate-400" /> }))} />
          </Field>
        )}
        <Field label="Notes for the class (optional)" className="sm:col-span-2">
          <Textarea rows={3} value={f.notes || ""} onChange={set("notes")} placeholder="What will you cover? Anything to prepare?" maxLength={1000} />
        </Field>
      </form>
    </Dialog>
  );
}

function nextSlot() {
  const d = new Date(Date.now() + 60 * 60000);
  d.setMinutes(0, 0, 0);
  return d;
}

// ---- Teacher: cancel / reschedule request -------------------------------------------
export function RequestDialog({ open, onClose, meeting, onSaved }) {
  const ui = useUi();
  const [type, setType] = useState("reschedule");
  const [reason, setReason] = useState("");
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open && meeting) {
      setType("reschedule");
      setReason("");
      setWhen(toLocalInput(new Date(new Date(meeting.startAt).getTime() + 86400000)));
    }
  }, [open, meeting]);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/schedule-requests", { meetingId: meeting.id, type, reason, proposedStartAt: type === "reschedule" ? fromLocalInput(when) : undefined });
      ui.toast("Request sent to the admin");
      onSaved?.();
      onClose();
    } catch (err) {
      ui.error(err);
    } finally {
      setBusy(false);
    }
  };
  if (!meeting) return null;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Request a change"
      subtitle={`${meeting.title} · ${fmtDay(meeting.startAt)}, ${fmtTime(meeting.startAt)}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button type="submit" form="req-form" loading={busy}>
            Send request
          </Button>
        </>
      }
    >
      <form id="req-form" onSubmit={submit} className="space-y-4">
        <Notice>The admin reviews every change. Students are notified once it's approved.</Notice>
        <div className="grid grid-cols-2 gap-2">
          {[
            ["reschedule", "Reschedule", "Move to a new time"],
            ["cancel", "Cancel", "This class won't happen"],
          ].map(([v, l, d]) => (
            <button key={v} type="button" onClick={() => setType(v)} className={cx("rounded-2xl border p-4 text-left transition", type === v ? "border-brand bg-brand-soft ring-2 ring-brand/30" : "border-line hover:border-slate-300")}>
              <span className="block font-semibold text-navy">{l}</span>
              <span className="block text-xs text-muted">{d}</span>
            </button>
          ))}
        </div>
        {type === "reschedule" && (
          <Field label="Proposed new date & time" required>
            <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
          </Field>
        )}
        <Field label="Reason" required>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Let the admin know why" required maxLength={500} />
        </Field>
      </form>
    </Dialog>
  );
}

export function ClassDetailDialog({ meeting, onClose, actions }) {
  if (!meeting) return null;
  return (
    <Dialog open={!!meeting} onClose={onClose} title={meeting.title} subtitle={meeting.subject} footer={actions}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <ClassStatus m={meeting} />
          {meeting.isGroup && <Badge tone="violet">Group class</Badge>}
          {meeting.pendingRequest && <Badge tone="amber">Change requested</Badge>}
        </div>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">When</dt>
            <dd className="text-[15px] text-ink">
              {fmtDay(meeting.startAt)}, {fmtTime(meeting.startAt)} – {fmtTime(meeting.endAt)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Teacher</dt>
            <dd className="text-[15px] text-ink">{meeting.teacherName}</dd>
          </div>
          {meeting.students && (
            <div className="sm:col-span-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Students</dt>
              <dd className="mt-1 flex flex-wrap gap-1.5">
                {meeting.students.map((s) => (
                  <Badge key={s.id}>{s.name}</Badge>
                ))}
              </dd>
            </div>
          )}
          {meeting.notes && (
            <div className="sm:col-span-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Notes</dt>
              <dd className="whitespace-pre-line text-[15px] text-ink">{meeting.notes}</dd>
            </div>
          )}
          {meeting.cancelledReason && (
            <div className="sm:col-span-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Cancellation reason</dt>
              <dd className="text-[15px] text-rose-600">{meeting.cancelledReason}</dd>
            </div>
          )}
          {meeting.students && meeting.status !== "cancelled" && new Date(meeting.startAt).getTime() - OPEN_EARLY_MIN * 60000 <= Date.now() && (
            <div className="sm:col-span-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Live class attendance</dt>
              <dd className="mt-1">
                <LiveAttendance meeting={meeting} />
              </dd>
            </div>
          )}
        </dl>
      </div>
    </Dialog>
  );
}
