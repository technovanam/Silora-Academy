import React, { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, BookOpen, CalendarClock, CalendarDays, CheckCircle2, ClipboardList, FolderOpen, GraduationCap, List, Lock, Megaphone, MoreHorizontal,
  Pencil, Pin, Plus, StickyNote, Trash2, TrendingUp, ArrowRight,
} from "lucide-react";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import { SubjectSelect } from "../lib/subjects.jsx";
import { fmtDate, fmtDateTime, fromNow, plural } from "../lib/format.js";
import {
  Avatar, Badge, Button, Card, CardTitle, Dialog, Empty, ErrorBox, Field, IconButton, Input, Loading, Menu, Notice, PageHeader, Progress, SearchInput,
  Segmented, Select, StatCard, Textarea, cx, useAsync, useUi,
} from "../ui/index.jsx";
import { ClassDetailDialog, ClassFormDialog, ClassRow, JoinButton, RequestDialog, WeekCalendar, mondayOf, useNow } from "../components/classes.jsx";
import { MaterialsManager } from "../components/materials.jsx";

// ---- Dashboard -----------------------------------------------------------------------
export function TeacherDashboard() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useAsync(() => api.get("/dashboard"), []);
  const [scheduling, setScheduling] = useState(false);
  const students = useAsync(() => api.get("/my-students"), []);
  useNow(30000);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const s = data.stats;
  return (
    <>
      <PageHeader
        title={`Welcome, ${(user.name || "").split(" ")[0]}`}
        subtitle={`${s.classesToday ? `You have ${plural(s.classesToday, "class", "classes")} today.` : "No classes today."} ${s.pendingRequests ? `${plural(s.pendingRequests, "schedule request")} waiting for the admin.` : ""}`}
        actions={
          <>
            <Link to="/portal/teacher/materials">
              <Button variant="outline" icon={FolderOpen}>Upload material</Button>
            </Link>
            <Button icon={Plus} onClick={() => setScheduling(true)}>
              Schedule class
            </Button>
          </>
        }
      />
      {data.announcements?.length > 0 && (
        <Link to="/portal/announcements" className="mb-6 flex items-center gap-3 rounded-2xl border border-brand/40 bg-brand-soft px-4 py-3">
          <Megaphone className="h-5 w-5 text-[#a77d00]" />
          <span className="min-w-0 flex-1 truncate font-semibold text-navy">{data.announcements[0].title}</span>
          <ArrowRight className="h-4 w-4" />
        </Link>
      )}
      {data.latestPayment && (
        <Link to="/portal/teacher/payments" className="mb-6 flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
          <CheckCircle2 className={cx("h-5 w-5", data.latestPayment.status === "paid" ? "text-emerald-600" : "text-slate-400")} />
          <span className="min-w-0 flex-1 truncate text-sm text-navy">
            <b>{data.latestPayment.sessionName}</b> · {data.latestPayment.held}/{data.latestPayment.scheduled} classes held ·{" "}
            {data.latestPayment.status === "paid" ? `paid${data.latestPayment.amount ? ` ₹${Number(data.latestPayment.amount).toLocaleString("en-IN")}` : ""}` : data.latestPayment.status === "due" ? "payment due" : "in progress"}
          </span>
          <ArrowRight className="h-4 w-4" />
        </Link>
      )}
      {s.pendingAttendance > 0 && (
        <Link to="/portal/teacher/attendance" className="mb-6 flex items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3">
          <CheckCircle2 className="h-5 w-5 text-amber-700" />
          <span className="min-w-0 flex-1 font-semibold text-navy">{plural(s.pendingAttendance, "class", "classes")} waiting for attendance</span>
          <span className="text-sm font-semibold text-navy">Fill in</span>
          <ArrowRight className="h-4 w-4" />
        </Link>
      )}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={GraduationCap} label="My students" value={s.students} />
        <StatCard icon={CalendarDays} label="Classes in the next 7 days" value={s.classesThisWeek} tone="blue" />
        <StatCard icon={FolderOpen} label="Materials" value={s.materials} hint={s.scheduled ? `${s.scheduled} scheduled` : ""} tone="violet" />
        <StatCard icon={CheckCircle2} label="Materials opened" value={s.openRate === null ? "—" : `${s.openRate}%`} hint="of assigned materials" tone="green" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardTitle icon={CalendarDays} title="Upcoming classes" action={<Link to="/portal/teacher/calendar" className="text-sm font-semibold text-navy hover:underline">Open calendar</Link>} />
          {data.upcoming.length ? (
            <div className="space-y-3">
              {data.upcoming.map((m) => (
                <ClassRow key={m.id} m={{ ...m, students: m.students.map((n) => ({ id: n, name: n })) }} actions={<JoinButton m={m} size="sm" />} />
              ))}
            </div>
          ) : (
            <Empty icon={CalendarDays} title="No upcoming classes" action={<Button icon={Plus} onClick={() => setScheduling(true)}>Schedule a class</Button>} />
          )}
        </Card>
        <Card>
          <CardTitle icon={GraduationCap} title="My students" action={<Link to="/portal/teacher/students" className="text-sm font-semibold text-navy hover:underline">View all</Link>} />
          {students.loading ? (
            <Loading />
          ) : (
            <ul className="space-y-1">
              {(students.data?.students || []).slice(0, 6).map((st) => (
                <li key={st.id}>
                  <Link to={`/portal/teacher/students/${st.id}`} className="flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-surface">
                    <Avatar name={st.name} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-navy">{st.name}</span>
                      <span className="block text-xs text-muted">{[st.grade, st.board].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className="w-20">
                      <Progress value={st.progress} tone="blue" />
                    </span>
                  </Link>
                </li>
              ))}
              {!students.data?.students?.length && <p className="text-sm text-muted">No students assigned yet.</p>}
            </ul>
          )}
        </Card>
      </div>
      <ClassFormDialog open={scheduling} onClose={() => setScheduling(false)} onSaved={() => reload(true)} mode="teacher" students={students.data?.students || []} />
    </>
  );
}

// ---- Calendar & classes ------------------------------------------------------------------
export function TeacherCalendar() {
  const [view, setView] = useState("week");
  const [week, setWeek] = useState(mondayOf());
  const [dialog, setDialog] = useState(null);
  const meetings = useAsync(() => api.get("/meetings"), []);
  const students = useAsync(() => api.get("/my-students"), []);
  useNow(30000);
  const all = meetings.data?.meetings || [];
  const upcoming = all.filter((m) => m.status === "scheduled" && new Date(m.endAt).getTime() + 30 * 60000 > Date.now());
  const reload = () => meetings.reload(true);

  const actionsFor = (m) => {
    const future = m.status === "scheduled" && new Date(m.startAt) > new Date();
    return (
      <>
        <JoinButton m={m} size="sm" />
        {future && (
          <Menu
            trigger={<IconButton icon={MoreHorizontal} label="More" />}
            items={[
              { label: "Edit details & students", icon: Pencil, onClick: () => setDialog({ type: "edit", m }) },
              { label: "Request reschedule / cancel", icon: CalendarClock, onClick: () => setDialog({ type: "request", m }), hidden: !!m.pendingRequest },
            ]}
          />
        )}
      </>
    );
  };

  return (
    <>
      <PageHeader
        title="Calendar & classes"
        subtitle="Schedule one-to-one or group classes (up to 5 students). Time changes go to the admin for approval."
        actions={
          <>
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: "week", label: "Week", icon: CalendarDays },
                { value: "list", label: "List", icon: List },
              ]}
            />
            <Button icon={Plus} onClick={() => setDialog({ type: "new" })}>
              Schedule class
            </Button>
          </>
        }
      />
      <ErrorBox error={meetings.error} onRetry={meetings.reload} />
      {meetings.loading ? (
        <Loading />
      ) : view === "week" ? (
        <WeekCalendar weekStart={week} onWeekChange={setWeek} meetings={all} onSelect={(m) => setDialog({ type: "detail", m })} />
      ) : upcoming.length === 0 ? (
        <Card>
          <Empty icon={CalendarDays} title="No upcoming classes" action={<Button icon={Plus} onClick={() => setDialog({ type: "new" })}>Schedule a class</Button>} />
        </Card>
      ) : (
        <div className="space-y-3">
          {upcoming.map((m) => (
            <ClassRow key={m.id} m={m} actions={actionsFor(m)} />
          ))}
        </div>
      )}

      <ClassFormDialog open={dialog?.type === "new" || dialog?.type === "edit"} meeting={dialog?.type === "edit" ? dialog.m : null} onClose={() => setDialog(null)} onSaved={reload} mode="teacher" students={students.data?.students || []} />
      <RequestDialog open={dialog?.type === "request"} meeting={dialog?.m} onClose={() => setDialog(null)} onSaved={reload} />
      <ClassDetailDialog meeting={dialog?.type === "detail" ? dialog.m : null} onClose={() => setDialog(null)} actions={dialog?.type === "detail" ? actionsFor(dialog.m) : null} />
    </>
  );
}

// ---- Students ----------------------------------------------------------------------------
export function TeacherStudents() {
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const { data, loading, error, reload } = useAsync(() => api.get("/my-students"), []);
  const list = (data?.students || []).filter((s) => !q || `${s.name} ${s.grade} ${s.board} ${s.subjects.join(" ")}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <PageHeader title="My students" subtitle="Students assigned to you by the academy. Contact details are managed by the office." actions={<SearchInput value={q} onChange={setQ} className="w-full sm:w-72" />} />
      <ErrorBox error={error} onRetry={reload} />
      {loading ? (
        <Loading />
      ) : list.length === 0 ? (
        <Card>
          <Empty icon={GraduationCap} title="No students yet" text="The admin assigns students to you." />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
          {list.map((s) => (
            <button key={s.id} onClick={() => navigate(`/portal/teacher/students/${s.id}`)} className="text-left">
              <Card className="h-full transition hover:-translate-y-0.5 hover:shadow-md">
                <div className="flex items-center gap-3">
                  <Avatar name={s.name} />
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-navy">{s.name}</p>
                    <p className="text-sm text-muted">{[s.grade, s.board].filter(Boolean).join(" · ") || "—"}</p>
                  </div>
                  {!s.active && <Badge tone="red" className="ml-auto">Inactive</Badge>}
                </div>
                {s.subjects.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {s.subjects.map((x) => (
                      <Badge key={x}>{x}</Badge>
                    ))}
                  </div>
                )}
                <div className="mt-4">
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="text-muted">Progress</span>
                    <span className="font-semibold text-navy">{s.progress}%</span>
                  </div>
                  <Progress value={s.progress} tone="blue" />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-xl bg-surface px-3 py-2">
                    <span className="block text-muted">Lessons done</span>
                    <span className="text-sm font-bold text-navy">
                      {s.lessonsCompleted}/{s.lessonsTotal}
                    </span>
                  </div>
                  <div className="rounded-xl bg-surface px-3 py-2">
                    <span className="block text-muted">Materials opened</span>
                    <span className="text-sm font-bold text-navy">
                      {s.materialsOpened}/{s.materialsAssigned}
                    </span>
                  </div>
                </div>
              </Card>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

const LESSON_STATUS = [
  { value: "planned", label: "Planned" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
];
const LS_TONE = { planned: "gray", in_progress: "blue", completed: "green" };

function LessonDialog({ open, onClose, studentId, lesson, onSaved, subjects }) {
  const ui = useUi();
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  React.useEffect(() => {
    if (open) setF(lesson ? { ...lesson } : { topic: "", subject: subjects[0] || "", status: "planned", progress: 0, date: new Date().toISOString().slice(0, 10), comment: "" });
  }, [open, lesson]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v?.target ? v.target.value : v }));
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { topic: f.topic, subject: f.subject, status: f.status, progress: Number(f.progress), date: f.date, comment: f.comment };
      if (lesson) await api.patch(`/lessons/${lesson.id}`, body);
      else await api.post("/lessons", { ...body, studentId });
      ui.toast("Lesson saved");
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
      title={lesson ? "Edit lesson" : "Add lesson"}
      subtitle="The student sees the topic, status, progress and comment."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="lesson-form" loading={busy}>Save</Button>
        </>
      }
    >
      <form id="lesson-form" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <Field label="Topic" required className="sm:col-span-2">
          <Input value={f.topic || ""} onChange={set("topic")} required maxLength={200} placeholder="e.g. Quadratic equations" />
        </Field>
        <Field label="Subject">
          <SubjectSelect value={f.subject} onChange={set("subject")} only={subjects.length ? subjects : undefined} clearable />
        </Field>
        <Field label="Date">
          <Input type="date" value={f.date || ""} onChange={set("date")} />
        </Field>
        <Field label="Status">
          <Select value={f.status} onChange={set("status")} options={LESSON_STATUS} />
        </Field>
        <Field label={`Progress: ${f.status === "completed" ? 100 : f.progress || 0}%`}>
          <input type="range" min={0} max={100} step={10} value={f.status === "completed" ? 100 : f.progress || 0} onChange={set("progress")} disabled={f.status === "completed"} className="mt-3 w-full accent-[#e8b112]" />
        </Field>
        <Field label="Comment for the student (optional)" className="sm:col-span-2">
          <Textarea rows={2} value={f.comment || ""} onChange={set("comment")} maxLength={1000} />
        </Field>
      </form>
    </Dialog>
  );
}

export function TeacherStudentDetail() {
  const { id } = useParams();
  const ui = useUi();
  const students = useAsync(() => api.get("/my-students"), []);
  const lessons = useAsync(() => api.get("/lessons", { studentId: id }), [id]);
  const notes = useAsync(() => api.get("/notes", { studentId: id }), [id]);
  const classes = useAsync(() => api.get("/meetings", { studentId: id }), [id]);
  const [lessonDlg, setLessonDlg] = useState(null);
  const [note, setNote] = useState("");
  const [editNote, setEditNote] = useState(null);
  const [tab, setTab] = useState("progress");
  const s = students.data?.students.find((x) => x.id === id);

  if (students.loading) return <Loading />;
  if (!s) return <Empty icon={GraduationCap} title="Student not found" text="This student isn't assigned to you." action={<Link to="/portal/teacher/students"><Button variant="outline">Back to students</Button></Link>} />;

  const addNote = async (e) => {
    e.preventDefault();
    if (!note.trim()) return;
    try {
      await api.post("/notes", { studentId: id, text: note });
      setNote("");
      notes.reload(true);
    } catch (err) {
      ui.error(err);
    }
  };
  const saveNote = async () => {
    await api.patch(`/notes/${editNote.id}`, { text: editNote.text });
    setEditNote(null);
    notes.reload(true);
  };
  const delNote = (n) => ui.confirm({ title: "Delete this note?", message: "This can't be undone.", danger: true, confirmLabel: "Delete", onConfirm: async () => { await api.del(`/notes/${n.id}`); notes.reload(true); } });
  const delLesson = (l) => ui.confirm({ title: "Delete lesson?", message: `"${l.topic}" will be removed from the student's progress.`, danger: true, confirmLabel: "Delete", onConfirm: async () => { await api.del(`/lessons/${l.id}`); lessons.reload(true); } });
  const pin = async (n) => {
    await api.patch(`/notes/${n.id}`, { pinned: !n.pinned });
    notes.reload(true);
  };
  const sortedNotes = [...(notes.data?.notes || [])].sort((a, b) => Number(b.pinned) - Number(a.pinned));
  const now = new Date().toISOString();

  return (
    <>
      <PageHeader
        back={
          <Link to="/portal/teacher/students" className="mb-2 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-navy">
            <ArrowLeft className="h-4 w-4" /> My students
          </Link>
        }
        title={s.name}
        subtitle={[s.grade, s.board, s.subjects.join(", ")].filter(Boolean).join(" · ")}
        actions={<Button icon={Plus} onClick={() => setLessonDlg({})}>Add lesson</Button>}
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={TrendingUp} label="Overall progress" value={`${s.progress}%`} tone="blue" />
        <StatCard icon={BookOpen} label="Lessons completed" value={`${s.lessonsCompleted}/${s.lessonsTotal}`} tone="green" />
        <StatCard icon={FolderOpen} label="Materials opened" value={`${s.materialsOpened}/${s.materialsAssigned}`} tone="violet" />
        <StatCard icon={CalendarDays} label="Upcoming classes" value={(classes.data?.meetings || []).filter((m) => m.status === "scheduled" && m.startAt > now).length} />
      </div>
      <Segmented
        className="mb-4"
        value={tab}
        onChange={setTab}
        options={[
          { value: "progress", label: "Lesson progress", icon: ClipboardList },
          { value: "notes", label: "Private notes", icon: StickyNote, count: notes.data?.notes.length },
          { value: "classes", label: "Classes", icon: CalendarDays },
        ]}
      />
      {tab === "progress" && (
        <Card padded={false}>
          {lessons.loading ? (
            <Loading />
          ) : !lessons.data?.lessons.length ? (
            <Empty icon={BookOpen} title="No lessons yet" text="Track topics as you plan and complete them." action={<Button icon={Plus} onClick={() => setLessonDlg({})}>Add lesson</Button>} />
          ) : (
            <ul className="divide-y divide-line">
              {lessons.data.lessons.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-3 px-5 py-4 sm:px-6">
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-navy">{l.topic}</span>
                    <span className="block text-sm text-muted">{[l.subject, l.date && fmtDate(l.date)].filter(Boolean).join(" · ")}</span>
                    {l.comment && <span className="block text-sm text-slate-600">{l.comment}</span>}
                  </span>
                  <span className="flex w-full items-center gap-3 sm:w-64">
                    <Progress value={l.progress} tone={l.status === "completed" ? "green" : "blue"} className="flex-1" />
                    <Badge tone={LS_TONE[l.status]}>{LESSON_STATUS.find((x) => x.value === l.status)?.label}</Badge>
                  </span>
                  <span className="flex">
                    <IconButton icon={Pencil} label="Edit" onClick={() => setLessonDlg({ lesson: l })} />
                    <IconButton icon={Trash2} label="Delete" tone="danger" onClick={() => delLesson(l)} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {tab === "notes" && (
        <Card>
          <Notice icon={Lock} className="mb-4">
            Private notes are only visible to you. Students, parents and other teachers can't see them.
          </Notice>
          <form onSubmit={addNote} className="mb-5 flex flex-col gap-2 sm:flex-row">
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Write a note about this student…" maxLength={3000} className="flex-1" />
            <Button type="submit" icon={Plus} className="sm:self-end">
              Add note
            </Button>
          </form>
          {notes.loading ? (
            <Loading />
          ) : sortedNotes.length === 0 ? (
            <Empty icon={StickyNote} title="No notes yet" className="py-8" />
          ) : (
            <ul className="space-y-3">
              {sortedNotes.map((n) => (
                <li key={n.id} className={cx("rounded-2xl border p-4", n.pinned ? "border-brand/40 bg-brand-soft/50" : "border-line")}>
                  {editNote?.id === n.id ? (
                    <div className="space-y-2">
                      <Textarea rows={3} value={editNote.text} onChange={(e) => setEditNote({ ...editNote, text: e.target.value })} />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={saveNote}>Save</Button>
                        <Button size="sm" variant="outline" onClick={() => setEditNote(null)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-3">
                      <p className="min-w-0 flex-1 whitespace-pre-line text-[15px] text-ink">{n.text}</p>
                      <div className="flex shrink-0">
                        <IconButton icon={Pin} label={n.pinned ? "Unpin" : "Pin"} onClick={() => pin(n)} className={n.pinned ? "text-[#a77d00]" : ""} />
                        <IconButton icon={Pencil} label="Edit" onClick={() => setEditNote({ id: n.id, text: n.text })} />
                        <IconButton icon={Trash2} label="Delete" tone="danger" onClick={() => delNote(n)} />
                      </div>
                    </div>
                  )}
                  <p className="mt-2 text-xs text-slate-400">
                    {fmtDateTime(n.createdAt)}
                    {n.updatedAt && ` · edited ${fromNow(n.updatedAt)}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {tab === "classes" && (
        <div className="space-y-3">
          {classes.loading ? (
            <Loading />
          ) : (classes.data?.meetings || []).length === 0 ? (
            <Card>
              <Empty icon={CalendarDays} title="No classes with this student yet" />
            </Card>
          ) : (
            [...classes.data.meetings].reverse().map((m) => <ClassRow key={m.id} m={m} actions={<JoinButton m={m} size="sm" />} />)
          )}
        </div>
      )}
      <LessonDialog open={!!lessonDlg} lesson={lessonDlg?.lesson} onClose={() => setLessonDlg(null)} studentId={id} subjects={s.subjects} onSaved={() => { lessons.reload(true); students.reload(true); }} />
    </>
  );
}

// ---- Materials -----------------------------------------------------------------------------
export function TeacherMaterials() {
  const students = useAsync(() => api.get("/my-students"), []);
  return (
    <>
      <PageHeader title="Materials" subtitle="Upload, organise and share files with your students. You'll see who opened each one." />
      {students.loading ? <Loading /> : <MaterialsManager mode="teacher" students={students.data?.students || []} />}
    </>
  );
}

// ---- Schedule requests -----------------------------------------------------------------------
const REQ_STATUS = { pending: ["amber", "Waiting for admin"], approved: ["green", "Approved"], rejected: ["red", "Declined"] };
export function ScheduleRequestsList({ admin }) {
  const ui = useUi();
  const [status, setStatus] = useState("pending");
  const [decide, setDecide] = useState(null);
  const [note, setNote] = useState("");
  const { data, loading, error, reload } = useAsync(() => api.get("/schedule-requests"), []);
  const all = useMemo(() => data?.requests || [], [data]);
  const list = useMemo(() => all.filter((r) => status === "all" || r.status === status), [all, status]);

  const submit = async (decision) => {
    try {
      await api.post(`/schedule-requests/${decide.id}/decide`, { decision, note });
      ui.toast(decision === "approve" ? "Approved – teacher and students notified" : "Request declined");
      setDecide(null);
      setNote("");
      reload(true);
    } catch (e) {
      ui.error(e);
    }
  };

  return (
    <>
      <Segmented
        className="mb-4"
        value={status}
        onChange={setStatus}
        options={[
          { value: "pending", label: "Pending", count: all.filter((r) => r.status === "pending").length },
          { value: "approved", label: "Approved" },
          { value: "rejected", label: "Declined" },
          { value: "all", label: "All" },
        ]}
      />
      <ErrorBox error={error} onRetry={reload} />
      {loading ? (
        <Loading />
      ) : list.length === 0 ? (
        <Card>
          <Empty icon={CalendarClock} title="No requests here" text={admin ? "Teachers' reschedule and cancellation requests appear here." : "Use “Request reschedule / cancel” on a class in your calendar."} />
        </Card>
      ) : (
        <div className="space-y-3">
          {list.map((r) => (
            <Card key={r.id}>
              <div className="flex flex-wrap items-start gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={r.type === "cancel" ? "red" : "violet"}>{r.type === "cancel" ? "Cancel" : "Reschedule"}</Badge>
                    <Badge tone={REQ_STATUS[r.status][0]}>{REQ_STATUS[r.status][1]}</Badge>
                    <span className="text-xs text-slate-400">{fromNow(r.createdAt)}</span>
                  </div>
                  <p className="mt-2 font-semibold text-navy">{r.meeting?.title || "Class removed"}</p>
                  <p className="text-sm text-muted">
                    {admin && `${r.teacherName} · `}
                    {r.meeting ? (r.status === "approved" && r.type === "reschedule" && r.meeting.previousStartAt ? `Was ${fmtDateTime(r.meeting.previousStartAt)}` : fmtDateTime(r.meeting.startAt)) : ""}
                    {r.type === "reschedule" && ` → ${fmtDateTime(r.proposedStartAt)}`}
                  </p>
                  {r.meeting?.students && <p className="text-xs text-slate-500">{r.meeting.students.map((s) => s.name).join(", ")}</p>}
                  <p className="mt-2 rounded-xl bg-surface px-3 py-2 text-sm text-ink">“{r.reason}”</p>
                  {r.note && <p className="mt-2 text-sm text-muted">Admin note: {r.note}</p>}
                </div>
                {admin && r.status === "pending" && (
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setDecide(r)}>
                      Review
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
      <Dialog
        open={!!decide}
        onClose={() => setDecide(null)}
        title={decide?.type === "cancel" ? "Cancel this class?" : "Move this class?"}
        subtitle={decide?.meeting?.title}
        footer={
          <>
            <Button variant="danger-outline" onClick={() => submit("reject")}>
              Decline
            </Button>
            <Button onClick={() => submit("approve")}>{decide?.type === "cancel" ? "Approve cancellation" : "Approve new time"}</Button>
          </>
        }
      >
        {decide && (
          <div className="space-y-4">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold uppercase text-slate-400">Current time</dt>
                <dd>{fmtDateTime(decide.meeting?.startAt)}</dd>
              </div>
              {decide.type === "reschedule" && (
                <div>
                  <dt className="text-xs font-semibold uppercase text-slate-400">Proposed time</dt>
                  <dd className="font-semibold text-navy">{fmtDateTime(decide.proposedStartAt)}</dd>
                </div>
              )}
              <div className="sm:col-span-2">
                <dt className="text-xs font-semibold uppercase text-slate-400">Reason from {decide.teacherName}</dt>
                <dd>{decide.reason}</dd>
              </div>
            </dl>
            <Field label="Note to the teacher (optional, shown if declined)">
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <Notice>Approving notifies the teacher and all students in the class.</Notice>
          </div>
        )}
      </Dialog>
    </>
  );
}

export function TeacherRequests() {
  return (
    <>
      <PageHeader title="Schedule requests" subtitle="Your reschedule and cancellation requests and the admin's decisions." />
      <ScheduleRequestsList />
    </>
  );
}


