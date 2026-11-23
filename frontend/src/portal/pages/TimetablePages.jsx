// ============================================================
// TIMETABLE PAGES
//   Admin: manage the weekly timetable (add, edit, delete, filter)
//   Teacher / Student: view-only weekly timetable
// ============================================================
import React, { useMemo, useState } from "react";
import { CalendarRange, LayoutGrid, List, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api.js";
import { plural } from "../lib/format.js";
import { Badge, Button, Card, Empty, ErrorBox, IconButton, Loading, Menu, PageHeader, Segmented, Select, Table, useAsync, useUi } from "../ui/index.jsx";
import { TimetableDetail, TimetableFormDialog, TimetableGrid, dayLabel, fmtLength, fmtRange, tzLabel } from "../components/timetable.jsx";

const tzNote = (tz) => (tz ? `Times are in ${tzLabel(tz)}.` : "");

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
  const studentOptions = useMemo(() => students.filter((s) => !teacherId || s.teacherId === teacherId).map((s) => ({ value: s.id, label: s.name, hint: s.active ? "" : "Deactivated" })), [students, teacherId]);
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
      <TimetableDetail entry={dialog?.type === "detail" ? dialog.e : null} timezone={tt.data?.timezone} onClose={() => setDialog(null)} canEdit onEdit={(e) => setDialog({ type: "edit", e })} onDelete={remove} />
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
