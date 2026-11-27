// ============================================================
// TIMETABLE PAGES
//   Admin: manage the weekly timetable (add, edit, delete, filter)
//   Teacher / Student: view-only weekly timetable
// ============================================================
import React, { useMemo, useState } from "react";
import { CalendarPlus, CalendarRange, LayoutGrid, List, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api.js";
import { teacherIdsOf } from "../lib/assign.js";
import { plural } from "../lib/format.js";
import { Badge, Button, Card, Dialog, Empty, ErrorBox, Field, IconButton, Input, Loading, Menu, Notice, PageHeader, Segmented, Select, Table, useAsync, useUi } from "../ui/index.jsx";
import { TimetableDetail, TimetableFormDialog, TimetableGrid, dayLabel, fmtLength, fmtRange, tzLabel } from "../components/timetable.jsx";

const tzNote = (tz) => (tz ? `Times are in ${tzLabel(tz)}.` : "");

// ---- Turn a weekly slot into real classes -------------------------------------------------
// The timetable is the weekly plan; classes are what students join. This creates the classes
// for the next weeks from a slot, so the admin doesn't type the same schedule twice.
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
/** "YYYY-MM-DD" of the next given weekday (1 = Monday) in the academy's time zone, today included if the slot hasn't started */
function nextDateFor(day, start, tz) {
  const parts = (d) => Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((p) => [p.type, p.value]));
  const wd = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  for (let i = 0; i < 8; i++) {
    const p = parts(new Date(Date.now() + i * 86400000));
    if (wd[p.weekday] !== day) continue;
    if (i === 0 && Number(p.hour) * 60 + Number(p.minute) >= toMin(start)) continue;
    return `${p.year}-${p.month}-${p.day}`;
  }
  return "";
}
/** ISO time of a date + "HH:MM" in the academy's time zone */
function zonedIso(date, time, tz) {
  const guess = new Date(`${date}T${time}:00Z`);
  const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(guess).find((p) => p.type === "timeZoneName")?.value || "GMT";
  const m = name.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  const offsetMin = m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0)) : 0;
  return new Date(guess.getTime() - offsetMin * 60000).toISOString();
}

function ScheduleFromSlotDialog({ entry, timezone, onClose }) {
  const ui = useUi();
  const tz = timezone || "Asia/Kolkata";
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  React.useEffect(() => {
    if (entry) setF({ date: nextDateFor(entry.day, entry.start, tz), weeks: 4, title: `${entry.subject}${entry.lesson ? ` – ${entry.lesson}` : ""}` });
  }, [entry, tz]);
  if (!entry || !f) return null;
  const duration = toMin(entry.end) - toMin(entry.start);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.post("/meetings", { teacherId: entry.teacherId, subject: entry.subject, studentIds: entry.studentIds, title: f.title, durationMin: duration, startAt: zonedIso(f.date, entry.start, tz), repeatWeeks: Number(f.weeks) || 1, notes: entry.notes || "" });
      ui.toast(`${plural(r.ids?.length || 0, "class", "classes")} scheduled – the teacher and students were notified`);
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
      size="sm"
      title="Schedule classes from this slot"
      subtitle={`${entry.subject} · ${dayLabel(entry.day)} ${fmtRange(entry)} · ${entry.teacherName}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button icon={CalendarPlus} onClick={save} loading={busy} disabled={!f.date || !f.title.trim()}>Schedule {plural(Number(f.weeks) || 1, "class", "classes")}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Class title" required><Input value={f.title} onChange={(e) => setF((x) => ({ ...x, title: e.target.value }))} maxLength={120} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`First class (${dayLabel(entry.day)})`} required><Input type="date" value={f.date} onChange={(e) => setF((x) => ({ ...x, date: e.target.value }))} /></Field>
          <Field label="Weeks" hint="One class a week, up to 12"><Input type="number" min={1} max={12} value={f.weeks} onChange={(e) => setF((x) => ({ ...x, weeks: Math.min(12, Math.max(1, Number(e.target.value) || 1)) }))} /></Field>
        </div>
        <Notice>Classes are created for {plural(entry.studentIds?.length || 0, "student")} at {fmtRange(entry)} ({tzLabel(tz)}). A week that clashes with another class stops the whole batch – adjust and try again.</Notice>
      </div>
    </Dialog>
  );
}

function Summary({ entries }) {
  const days = new Set(entries.map((e) => e.day)).size;
  return (
    <p className="mb-3 text-sm text-muted">
      {plural(entries.length, "class", "classes")} a week across {plural(days, "day")}
    </p>
  );
}

// ---- Admin --------------------------------------------------------------------------
export function AdminTimetable() {
  const ui = useUi();
  const [view, setView] = useState("grid");
  const [teacherId, setTeacherId] = useState(null);
  const [studentId, setStudentId] = useState(null);
  const [dialog, setDialog] = useState(null);
  const tt = useAsync(() => api.get("/timetable"), []);
  const dir = useAsync(() => api.get("/admin/directory"), []);
  const teachers = dir.data?.teachers || [];
  const students = useMemo(() => dir.data?.students || [], [dir.data]);
  const all = useMemo(() => tt.data?.entries || [], [tt.data]);
  const entries = useMemo(() => all.filter((e) => (!teacherId || e.teacherId === teacherId) && (!studentId || e.studentIds?.includes(studentId))), [all, teacherId, studentId]);
  const studentOptions = useMemo(() => students.filter((s) => !teacherId || teacherIdsOf(s).includes(teacherId)).map((s) => ({ value: s.id, label: s.name, hint: s.active ? "" : "Deactivated" })), [students, teacherId]);
  const reload = () => tt.reload(true);
  const filtered = teacherId || studentId;

  const remove = (e) =>
    ui.confirm({
      title: "Delete this timetable slot?",
      message: `${e.subject} on ${dayLabel(e.day)}, ${fmtRange(e)} with ${e.teacherName} will be removed from the teacher's and students' timetables. Scheduled classes are not affected.`,
      danger: true,
      confirmLabel: "Delete",
      onConfirm: async () => {
        await api.del(`/timetable/${e.id}`);
        ui.toast("Removed from the timetable");
        setDialog(null);
        reload();
      },
    });

  const columns = [
    { key: "day", label: "Day", className: "whitespace-nowrap font-medium text-navy", render: (e) => dayLabel(e.day) },
    { key: "time", label: "Time", className: "whitespace-nowrap", render: (e) => <span><span className="block tabular-nums">{fmtRange(e)}</span><span className="text-xs text-muted">{fmtLength(e)}</span></span> },
    { key: "subject", label: "Subject / lesson", render: (e) => <span className="block min-w-[160px]"><span className="block font-medium text-navy">{e.subject}</span>{e.lesson && <span className="line-clamp-1 text-xs text-muted">{e.lesson}</span>}</span> },
    { key: "teacher", label: "Teacher", className: "whitespace-nowrap", render: (e) => e.teacherName },
    { key: "students", label: "Students", render: (e) => <span className="block min-w-[160px]"><span className="line-clamp-2">{e.students?.map((s) => s.name).join(", ")}</span>{e.isGroup && <Badge tone="blue" className="mt-1">Group · {e.studentCount}</Badge>}</span> },
    {
      key: "x",
      label: "",
      className: "w-[1%] text-right",
      render: (e) => (
        <span onClick={(ev) => ev.stopPropagation()}>
          <Menu
            trigger={<IconButton icon={MoreHorizontal} label="More" />}
            items={[
              { label: "Edit", icon: Pencil, onClick: () => setDialog({ type: "edit", e }) },
              { label: "Schedule classes", icon: CalendarPlus, onClick: () => setDialog({ type: "schedule", e }) },
              { label: "Delete", icon: Trash2, danger: true, onClick: () => remove(e) },
            ]}
          />
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Timetable"
        subtitle={`The weekly plan for every student and teacher. It repeats each week and is shown to the teacher and student as view-only. It doesn't create classes or links. ${tzNote(tt.data?.timezone)}`}
        actions={
          <>
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: "grid", label: "Week", icon: LayoutGrid },
                { value: "list", label: "List", icon: List },
              ]}
            />
            <Button icon={Plus} onClick={() => setDialog({ type: "new" })} disabled={!dir.data}>
              Add slot
            </Button>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-1 gap-3 sm:flex sm:flex-wrap sm:items-center">
        <Select className="w-full sm:w-60" value={teacherId} onChange={(v) => { setTeacherId(v); setStudentId(null); }} options={teachers.map((t) => ({ value: t.id, label: t.name, hint: t.active ? "" : "Deactivated" }))} placeholder="All teachers" clearable searchable />
        <Select className="w-full sm:w-60" value={studentId} onChange={setStudentId} options={studentOptions} placeholder="All students" clearable searchable />
      </div>
      <ErrorBox error={tt.error || dir.error} onRetry={() => { tt.reload(); dir.reload(); }} />
      {tt.loading ? (
        <Loading />
      ) : !entries.length ? (
        <Card>
          <Empty
            icon={CalendarRange}
            title={filtered ? "No timetable for this selection" : "No timetable yet"}
            text={filtered ? "Nothing is planned for this teacher or student. Add a slot to build their week." : "Add weekly slots for each student and their teacher. They'll see their timetable in their portal."}
            action={<Button icon={Plus} onClick={() => setDialog({ type: "new" })} disabled={!dir.data}>Add slot</Button>}
          />
        </Card>
      ) : (
        <>
          <Summary entries={entries} />
          {view === "grid" ? (
            <TimetableGrid entries={entries} timezone={tt.data?.timezone} show={studentId ? "teacher" : "students"} onSelect={(e) => setDialog({ type: "detail", e })} />
          ) : (
            <Card flush>
              <Table rows={entries} columns={columns} pageSize={25} minWidth="min-w-[860px]" onRowClick={(e) => setDialog({ type: "detail", e })} />
            </Card>
          )}
        </>
      )}

      <TimetableFormDialog
        open={dialog?.type === "new" || dialog?.type === "edit"}
        entry={dialog?.type === "edit" ? dialog.e : null}
        defaults={{ teacherId, studentId }}
        onClose={() => setDialog(null)}
        onSaved={reload}
        teachers={teachers.filter((t) => t.active || t.id === dialog?.e?.teacherId)}
        students={students}
      />
      <TimetableDetail entry={dialog?.type === "detail" ? dialog.e : null} timezone={tt.data?.timezone} onClose={() => setDialog(null)} canEdit onEdit={(e) => setDialog({ type: "edit", e })} onDelete={remove} onSchedule={(e) => setDialog({ type: "schedule", e })} />
      <ScheduleFromSlotDialog entry={dialog?.type === "schedule" ? dialog.e : null} timezone={tt.data?.timezone} onClose={() => setDialog(null)} />
    </>
  );
}

// ---- Teacher (view only) --------------------------------------------------------------
export function TeacherTimetable() {
  const [studentId, setStudentId] = useState(null);
  const [open, setOpen] = useState(null);
  const tt = useAsync(() => api.get("/timetable"), []);
  const all = useMemo(() => tt.data?.entries || [], [tt.data]);
  const studentOptions = useMemo(() => {
    const m = new Map();
    all.forEach((e) => e.students?.forEach((s) => m.set(s.id, s.name)));
    return [...m].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [all]);
  const entries = studentId ? all.filter((e) => e.studentIds?.includes(studentId)) : all;
  return (
    <>
      <PageHeader title="Timetable" subtitle={`Your weekly teaching plan, set by the academy. ${tzNote(tt.data?.timezone)} Classes and joining links are still scheduled from Calendar & classes.`} />
      {studentOptions.length > 1 && (
        <div className="mb-4">
          <Select className="w-full sm:w-60" value={studentId} onChange={setStudentId} options={studentOptions} placeholder="All my students" clearable searchable />
        </div>
      )}
      <ErrorBox error={tt.error} onRetry={tt.reload} />
      {tt.loading ? (
        <Loading />
      ) : !entries.length ? (
        <Card>
          <Empty icon={CalendarRange} title="No timetable yet" text="The academy hasn't set your weekly timetable yet. It will appear here once it's ready." />
        </Card>
      ) : (
        <>
          <Summary entries={entries} />
          <TimetableGrid entries={entries} timezone={tt.data?.timezone} show="students" onSelect={setOpen} />
        </>
      )}
      <TimetableDetail entry={open} timezone={tt.data?.timezone} onClose={() => setOpen(null)} />
    </>
  );
}

// ---- Student / parent (view only) -------------------------------------------------------
export function StudentTimetable() {
  const [open, setOpen] = useState(null);
  const tt = useAsync(() => api.get("/timetable"), []);
  const entries = tt.data?.entries || [];
  return (
    <>
      <PageHeader title="Timetable" subtitle={`Your weekly class plan from the academy. ${tzNote(tt.data?.timezone)} Join each class from My classes when it's scheduled.`} />
      <ErrorBox error={tt.error} onRetry={tt.reload} />
      {tt.loading ? (
        <Loading />
      ) : !entries.length ? (
        <Card>
          <Empty icon={CalendarRange} title="No timetable yet" text="Your weekly timetable hasn't been set yet. It will appear here once the academy adds it." />
        </Card>
      ) : (
        <>
          <Summary entries={entries} />
          <TimetableGrid entries={entries} timezone={tt.data?.timezone} show="teacher" onSelect={setOpen} />
        </>
      )}
      <TimetableDetail entry={open} timezone={tt.data?.timezone} onClose={() => setOpen(null)} showStudents={false} />
    </>
  );
}
