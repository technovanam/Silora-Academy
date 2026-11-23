// ============================================================
// WEEKLY TIMETABLE – shared grid, details and the admin form.
// The timetable is a recurring Monday–Sunday plan. It is separate from
// scheduled classes: nothing here creates a class, link or reminder.
// ============================================================
import React, { useEffect, useMemo, useState } from "react";
import { BookOpen, Clock, Pencil, Trash2, User, Users } from "lucide-react";
import { api } from "../lib/api.js";
import { plural } from "../lib/format.js";
import { Badge, Button, Dialog, Field, Input, Notice, Select, Textarea, cx, useUi } from "../ui/index.jsx";

export const DAYS = [
  { value: 1, short: "Mon", label: "Monday" },
  { value: 2, short: "Tue", label: "Tuesday" },
  { value: 3, short: "Wed", label: "Wednesday" },
  { value: 4, short: "Thu", label: "Thursday" },
  { value: 5, short: "Fri", label: "Friday" },
  { value: 6, short: "Sat", label: "Saturday" },
  { value: 7, short: "Sun", label: "Sunday" },
];
export const dayLabel = (d) => DAYS[d - 1]?.label || "";

// "16:30" → "4:30 pm"
export function fmtSlot(t) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}
export const fmtRange = (e) => `${fmtSlot(e.start)} – ${fmtSlot(e.end)}`;
const minutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export function fmtLength(e) {
  const m = minutes(e.end) - minutes(e.start);
  const h = Math.floor(m / 60);
  return [h && `${h} h`, m % 60 && `${m % 60} min`].filter(Boolean).join(" ");
}

// Short name of the academy's time zone, e.g. "IST"
export function tzLabel(tz) {
  if (!tz) return "";
  try {
    return new Intl.DateTimeFormat("en-IN", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value || tz;
  } catch {
    return tz;
  }
}

// Monday = 1 … Sunday = 7, in the academy's time zone
function todayIn(tz) {
  try {
    const wd = new Intl.DateTimeFormat("en-US", { timeZone: tz || undefined, weekday: "short" }).format(new Date());
    return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(wd) + 1;
  } catch {
    return ((new Date().getDay() + 6) % 7) + 1;
  }
}

// Each teacher gets their own colour so the grid is easy to scan
const TONES = [
  "border-sky-200 bg-sky-50 text-sky-900",
  "border-violet-200 bg-violet-50 text-violet-900",
  "border-emerald-200 bg-emerald-50 text-emerald-900",
  "border-amber-200 bg-amber-50 text-amber-900",
  "border-rose-200 bg-rose-50 text-rose-900",
  "border-teal-200 bg-teal-50 text-teal-900",
  "border-indigo-200 bg-indigo-50 text-indigo-900",
  "border-orange-200 bg-orange-50 text-orange-900",
];
export function toneFor(id = "") {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length];
}

const whoLine = (e, show) => (show === "teacher" ? e.teacherName : show === "students" ? e.students?.map((s) => s.name).join(", ") : null);

function Slot({ e, onClick, show }) {
  const who = whoLine(e, show);
  return (
    <button type="button" onClick={() => onClick?.(e)} className={cx("block w-full min-w-0 rounded-xl border px-2.5 py-2 text-left text-xs transition hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand", toneFor(e.teacherId))}>
      <span className="block font-semibold tabular-nums">{fmtRange(e)}</span>
      <span className="mt-0.5 block truncate font-semibold" title={e.subject}>{e.subject}</span>
      {e.lesson && <span className="block truncate opacity-80" title={e.lesson}>{e.lesson}</span>}
      {who && (
        <span className="mt-1 flex min-w-0 items-center gap-1 opacity-75">
          {show === "teacher" ? <User className="h-3 w-3 shrink-0" /> : <Users className="h-3 w-3 shrink-0" />}
          <span className="truncate" title={who}>{who}</span>
        </span>
      )}
    </button>
  );
}

/**
 * entries: from GET /timetable. show: "teacher" | "students" – the extra line on each slot.
 */
export function TimetableGrid({ entries, onSelect, show = "teacher", timezone }) {
  const today = todayIn(timezone);
  const byDay = useMemo(() => Object.fromEntries(DAYS.map((d) => [d.value, entries.filter((e) => e.day === d.value)])), [entries]);
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-white">
      {/* Desktop: Monday–Sunday side by side */}
      <div className="hidden grid-cols-7 lg:grid">
        {DAYS.map((d) => (
          <div key={d.value} className="min-w-0 border-r border-line last:border-r-0">
            <div className={cx("border-b border-line px-2 py-2.5 text-center", d.value === today && "bg-brand-soft")}>
              <p className={cx("text-sm font-semibold", d.value === today ? "text-[#a77d00]" : "text-navy")}>{d.label}</p>
              <p className="text-xs text-muted">{byDay[d.value].length ? plural(byDay[d.value].length, "class", "classes") : "Free"}</p>
            </div>
            <div className="min-h-[280px] space-y-2 p-2">
              {byDay[d.value].map((e) => (
                <Slot key={e.id} e={e} onClick={onSelect} show={show} />
              ))}
            </div>
          </div>
        ))}
      </div>
      {/* Phone / tablet: one row per day */}
      <div className="divide-y divide-line lg:hidden">
        {DAYS.map((d) => (
          <div key={d.value} className={cx("flex gap-3 px-3 py-3 sm:gap-4 sm:px-4", d.value === today && "bg-brand-soft/40")}>
            <div className="w-11 shrink-0 pt-1 sm:w-14">
              <p className={cx("text-sm font-bold", d.value === today ? "text-[#a77d00]" : "text-navy")}>{d.short}</p>
              {d.value === today && <p className="text-[11px] font-medium text-[#a77d00]">Today</p>}
            </div>
            <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
              {byDay[d.value].length ? byDay[d.value].map((e) => <Slot key={e.id} e={e} onClick={onSelect} show={show} />) : <p className="py-1 text-sm text-slate-400">No classes</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Details (everyone) ---------------------------------------------------------------
export function TimetableDetail({ entry, onClose, timezone, canEdit, onEdit, onDelete, showStudents = true }) {
  return (
    <Dialog
      open={!!entry}
      onClose={onClose}
      title={entry?.subject}
      subtitle={entry ? `${dayLabel(entry.day)} · ${fmtRange(entry)}${timezone ? ` (${tzLabel(timezone)})` : ""}` : ""}
      footer={
        canEdit && entry ? (
          <>
            <Button variant="danger-outline" icon={Trash2} onClick={() => onDelete(entry)}>
              Delete
            </Button>
            <Button icon={Pencil} onClick={() => onEdit(entry)}>
              Edit
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      {entry && (
        <dl className="space-y-3 text-sm">
          <Row icon={Clock} label="When">
            Every {dayLabel(entry.day)}, {fmtRange(entry)} <span className="text-muted">({fmtLength(entry)})</span>
          </Row>
          {entry.lesson && (
            <Row icon={BookOpen} label="Lesson">
              {entry.lesson}
            </Row>
          )}
          <Row icon={User} label="Teacher">
            {entry.teacherName}
          </Row>
          {showStudents && entry.students ? (
            <Row icon={Users} label={entry.students.length > 1 ? "Students (group)" : "Student"}>
              <span className="flex flex-wrap gap-1.5">
                {entry.students.map((s) => (
                  <Badge key={s.id}>{s.name}</Badge>
                ))}
              </span>
            </Row>
          ) : entry.isGroup ? (
            <Row icon={Users} label="Class">
              Group class
            </Row>
          ) : null}
          {entry.notes && <p className="whitespace-pre-line rounded-2xl bg-surface p-3 text-muted">{entry.notes}</p>}
          <p className="text-xs text-slate-400">This is your weekly plan. Joining links come with each scheduled class.</p>
        </dl>
      )}
    </Dialog>
  );
}
function Row({ icon: Icon, label, children }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
      <div className="min-w-0">
        <dt className="text-xs text-muted">{label}</dt>
        <dd className="text-ink">{children}</dd>
      </div>
    </div>
  );
}

// ---- Admin: add / edit ----------------------------------------------------------------
export function TimetableFormDialog({ open, onClose, onSaved, entry, teachers = [], students = [], defaults }) {
  const ui = useUi();
  const editing = !!entry;
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setF(
      entry
        ? { teacherId: entry.teacherId, studentIds: entry.studentIds || [], days: [entry.day], start: entry.start, end: entry.end, subject: entry.subject, lesson: entry.lesson, notes: entry.notes }
        : { teacherId: defaults?.teacherId || (teachers.length === 1 ? teachers[0].id : null), studentIds: defaults?.studentId ? [defaults.studentId] : [], days: [], start: "16:00", end: "17:00", subject: "", lesson: "", notes: "" }
    );
  }, [open, entry]); // eslint-disable-line react-hooks/exhaustive-deps

  const teacher = teachers.find((t) => t.id === f.teacherId);
  const pool = useMemo(() => students.filter((s) => s.teacherId === f.teacherId && (s.active !== false || f.studentIds?.includes(s.id))), [students, f.teacherId, f.studentIds]);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v?.target ? v.target.value : v }));
  const toggleDay = (d) => setF((p) => ({ ...p, days: editing ? [d] : p.days.includes(d) ? p.days.filter((x) => x !== d) : [...p.days, d].sort() }));

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    if (!f.teacherId) return setError("Choose a teacher");
    if (!f.studentIds?.length) return setError("Choose at least one student");
    if (!f.days?.length) return setError("Choose the day");
    if (!f.start || !f.end || f.end <= f.start) return setError("The end time must be after the start time");
    setBusy(true);
    try {
      const body = { teacherId: f.teacherId, studentIds: f.studentIds, start: f.start, end: f.end, subject: f.subject, lesson: f.lesson, notes: f.notes };
      if (editing) {
        await api.patch(`/timetable/${entry.id}`, { ...body, day: f.days[0] });
        ui.toast("Timetable updated");
      } else {
        const r = await api.post("/timetable", { ...body, days: f.days });
        ui.toast(`Added ${plural(r.ids.length, "slot")} to the timetable`);
      }
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? "Edit timetable slot" : "Add to the timetable"}
      subtitle="A weekly slot that repeats every week. It doesn't schedule a class or send a link — use Schedule class for that."
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="timetable-form" loading={busy}>
            {editing ? "Save changes" : "Add to timetable"}
          </Button>
        </>
      }
    >
      <form id="timetable-form" onSubmit={save} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {error && <Notice tone="danger" className="sm:col-span-2">{error}</Notice>}
        <Field label="Teacher" required>
          <Select
            value={f.teacherId}
            onChange={(v) => setF((p) => ({ ...p, teacherId: v, studentIds: [], subject: p.subject || teachers.find((t) => t.id === v)?.subjects?.[0] || "" }))}
            options={teachers.map((t) => ({ value: t.id, label: t.name, hint: t.subjects?.join(", ") }))}
            placeholder="Choose a teacher"
            searchable
          />
        </Field>
        <Field label="Subject" required>
          <Input value={f.subject || ""} onChange={set("subject")} placeholder="e.g. Mathematics" maxLength={80} required list="tt-subjects" />
          <datalist id="tt-subjects">
            {(teacher?.subjects || []).map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>
        <Field label="Students" required className="sm:col-span-2" hint={!f.teacherId ? "Choose the teacher first" : pool.length === 0 ? "No students are assigned to this teacher yet" : f.studentIds?.length > 1 ? "Group slot" : ""}>
          <Select multiple value={f.studentIds || []} onChange={set("studentIds")} options={pool.map((s) => ({ value: s.id, label: s.name, hint: [s.grade, s.board].filter(Boolean).join(" · ") }))} placeholder="Choose students" disabled={!f.teacherId} searchable />
        </Field>
        <Field label={editing ? "Day" : "Days"} required className="sm:col-span-2" hint={editing ? "" : "Pick more than one day to add the same slot on each of them"}>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Days">
            {DAYS.map((d) => {
              const on = f.days?.includes(d.value);
              return (
                <button key={d.value} type="button" aria-pressed={on} onClick={() => toggleDay(d.value)} className={cx("h-9 min-w-[3.25rem] rounded-xl px-3 text-sm font-semibold transition", on ? "bg-navy text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:text-navy")}>
                  {d.short}
                </button>
              );
            })}
          </div>
        </Field>
        <Field label="Start time" required>
          <Input type="time" value={f.start || ""} onChange={set("start")} required step={300} />
        </Field>
        <Field label="End time" required>
          <Input type="time" value={f.end || ""} onChange={set("end")} required step={300} />
        </Field>
        <Field label="Lesson / topic (optional)" className="sm:col-span-2">
          <Input value={f.lesson || ""} onChange={set("lesson")} placeholder="e.g. Algebra – quadratic equations" maxLength={120} />
        </Field>
        <Field label="Notes (optional)" className="sm:col-span-2">
          <Textarea rows={2} value={f.notes || ""} onChange={set("notes")} placeholder="Anything the teacher or student should know" maxLength={500} />
        </Field>
      </form>
    </Dialog>
  );
}
