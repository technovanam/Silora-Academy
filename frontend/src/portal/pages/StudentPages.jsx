import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, BookOpen, CalendarDays, CheckCircle2, ClipboardCheck, Clock, Download, Eye, FolderOpen, Heart, History, Megaphone, Sparkles, Star, TrendingUp } from "lucide-react";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import { fmtDate, fmtDateTime, fmtDay, fmtSize, fmtTime, fmtWeek, fromNow, plural } from "../lib/format.js";
import { Badge, Button, Card, CardTitle, Empty, ErrorBox, Field, Loading, Notice, PageHeader, Progress, SearchInput, Segmented, Select, StatCard, Textarea, Input, cx, useAsync, useUi } from "../ui/index.jsx";
import { ClassRow, JoinButton, classState, useNow } from "../components/classes.jsx";
import { FileIcon, PreviewDialog, downloadMaterial, markMaterialOpened } from "../components/materials.jsx";

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

// ---- Dashboard ------------------------------------------------------------------
export function StudentDashboard() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useAsync(() => api.get("/dashboard"), []);
  useNow(30000);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const next = data.nextClass;
  const js = next && classState(next);
  return (
    <>
      <PageHeader title={`${greeting()}, ${user.name.split(" ")[0]}`} subtitle={data.teacherName ? `Your teacher: ${data.teacherName}` : "Your teacher will be assigned soon."} />

      {data.announcements?.length > 0 && (
        <Link to="/portal/announcements" className="mb-6 flex items-center gap-3 rounded-2xl border border-brand/40 bg-brand-soft px-4 py-3 transition hover:shadow-sm">
          <Megaphone className="h-5 w-5 shrink-0 text-[#a77d00]" />
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold uppercase tracking-wide text-[#8a6700]">{data.announcements[0].priority === "urgent" ? "Urgent announcement" : "New announcement"}</span>
            <span className="block truncate font-semibold text-navy">{data.announcements[0].title}</span>
          </span>
          <ArrowRight className="h-4 w-4 text-navy" />
        </Link>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className={cx("relative overflow-hidden rounded-3xl p-6 sm:p-8", next ? "bg-navy text-white" : "border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-sky-50 text-navy")}>
          <div className={cx("absolute -right-16 -top-16 h-56 w-56 rounded-full blur-3xl", next ? "bg-brand/25" : "bg-brand/20")} />
          <p className={cx("relative text-xs font-semibold uppercase tracking-wider", next ? "text-brand" : "text-[#8a6700]")}>{next ? (js === "live" || js === "overtime" ? "Happening now" : "Next class") : "Classes"}</p>
          {next ? (
            <div className="relative">
              <h2 className="mt-2 text-2xl font-bold text-white sm:text-3xl">{next.title}</h2>
              <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-white/75">
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays className="h-4 w-4" /> {fmtDay(next.startAt)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="h-4 w-4" /> {fmtTime(next.startAt)} – {fmtTime(next.endAt)}
                </span>
                {next.subject && <span>{next.subject}</span>}
              </p>
              <p className="mt-1 text-sm text-white/55">Starts {fromNow(next.startAt)} · with {next.teacherName}</p>
              <div className="mt-6 flex flex-wrap gap-2">
                <JoinButton m={next} size="lg" />
                <Link to="/portal/student/classes">
                  <Button size="lg" variant="outline" className="!border-white/20 !bg-white/10 !text-white hover:!bg-white/20">
                    All classes
                  </Button>
                </Link>
              </div>
              <p className="mt-4 text-xs text-white/50">The Join button opens 15 minutes before class. You'll also get a reminder 5 minutes before.</p>
            </div>
          ) : (
            <div className="relative flex items-start gap-4">
              <span className="mt-2 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-[#8a6700] shadow-sm ring-1 ring-amber-200">
                <CalendarDays className="h-6 w-6" />
              </span>
              <div className="min-w-0">
                <h2 className="mt-2 text-xl font-bold text-navy sm:text-2xl">No upcoming classes</h2>
                <p className="mt-1.5 text-slate-600">When your teacher schedules a class it will show up here.</p>
              </div>
            </div>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
          <Link to="/portal/student/attendance" className="block">
            <Card className={cx("h-full transition hover:shadow-md", !data.attendance.submitted && "border-amber-300 bg-amber-50/50")}>
              <div className="flex items-start gap-4">
                <span className={cx("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", data.attendance.submitted ? "bg-emerald-50 text-emerald-600" : "bg-amber-100 text-amber-700")}>
                  {data.attendance.submitted ? <CheckCircle2 className="h-5 w-5" /> : <ClipboardCheck className="h-5 w-5" />}
                </span>
                <div className="min-w-0">
                  <p className="font-semibold text-navy">Weekly attendance</p>
                  <p className="text-sm text-muted">{data.attendance.submitted ? "Submitted for this week – thank you!" : `Not submitted yet for ${fmtWeek(data.attendance.weekStart)}`}</p>
                  {!data.attendance.submitted && <span className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-navy">Fill in the form <ArrowRight className="h-4 w-4" /></span>}
                </div>
              </div>
            </Card>
          </Link>
          <Link to="/portal/student/progress" className="block">
            <Card className="h-full transition hover:shadow-md">
              <div className="flex items-start gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
                  <TrendingUp className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-navy">Learning progress</p>
                  <p className="text-sm text-muted">
                    {data.progress.completed} of {plural(data.progress.total, "lesson")} completed
                  </p>
                  <div className="mt-3 flex items-center gap-3">
                    <Progress value={data.progress.percent} tone="blue" className="flex-1" />
                    <span className="text-sm font-bold text-navy">{data.progress.percent}%</span>
                  </div>
                </div>
              </div>
            </Card>
          </Link>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardTitle icon={CalendarDays} title="Upcoming classes" action={<Link to="/portal/student/classes" className="text-sm font-semibold text-navy hover:underline">View all</Link>} />
          {data.upcoming.length ? (
            <div className="space-y-3">
              {data.upcoming.map((m) => (
                <ClassRow key={m.id} m={m} showStudents={false} showTeacher actions={<JoinButton m={m} size="sm" />} />
              ))}
            </div>
          ) : (
            <Empty icon={CalendarDays} title="Nothing scheduled" className="py-8" />
          )}
        </Card>
        <Card>
          <CardTitle
            icon={FolderOpen}
            title="New materials"
            subtitle={data.materials.unopened ? `${data.materials.unopened} not opened yet` : "You've opened everything"}
            action={<Link to="/portal/student/materials" className="text-sm font-semibold text-navy hover:underline">View all</Link>}
          />
          {data.materials.recent.length ? (
            <ul className="space-y-2">
              {data.materials.recent.map((m) => (
                <li key={m.id}>
                  <Link to="/portal/student/materials" className="flex items-center gap-3 rounded-2xl border border-line p-3 transition hover:bg-surface">
                    <FileIcon kind={m.kind} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-navy">{m.title}</span>
                      <span className="block text-xs text-muted">{[m.subject, fmtDate(m.publishedAt)].filter(Boolean).join(" · ")}</span>
                    </span>
                    {m.opened ? <Badge tone="green">Opened</Badge> : <Badge tone="gold">New</Badge>}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon={FolderOpen} title="No materials yet" className="py-8" />
          )}
        </Card>
      </div>
    </>
  );
}

// ---- Classes ----------------------------------------------------------------------
export function StudentClasses() {
  const [tab, setTab] = useState("upcoming");
  const { data, loading, error, reload } = useAsync(() => api.get("/meetings"), []);
  useNow(30000);
  const list = useMemo(() => {
    const all = data?.meetings || [];
    const now = new Date().toISOString();
    if (tab === "upcoming") return all.filter((m) => m.status === "scheduled" && classState(m) !== "ended");
    if (tab === "past") return all.filter((m) => m.status !== "cancelled" && (m.endAt < now || m.status === "completed")).reverse();
    return all.filter((m) => m.status === "cancelled").reverse();
  }, [data, tab]);
  return (
    <>
      <PageHeader title="My classes" subtitle="Join live classes here. The Join button opens 15 minutes before each class." />
      <Segmented
        className="mb-4"
        value={tab}
        onChange={setTab}
        options={[
          { value: "upcoming", label: "Upcoming" },
          { value: "past", label: "Past" },
          { value: "cancelled", label: "Cancelled" },
        ]}
      />
      <ErrorBox error={error} onRetry={reload} />
      {loading ? (
        <Loading />
      ) : list.length === 0 ? (
        <Card>
          <Empty icon={CalendarDays} title={tab === "upcoming" ? "No upcoming classes" : tab === "past" ? "No past classes yet" : "No cancelled classes"} />
        </Card>
      ) : (
        <div className="space-y-3">
          {list.map((m) => (
            <ClassRow key={m.id} m={m} showStudents={false} showTeacher actions={tab === "upcoming" ? <JoinButton m={m} size="sm" /> : null} />
          ))}
        </div>
      )}
    </>
  );
}

// ---- Materials ----------------------------------------------------------------------
export function StudentMaterials() {
  const ui = useUi();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("all");
  const [subject, setSubject] = useState(null);
  const [preview, setPreview] = useState(null);
  const { data, loading, error, reload, setData } = useAsync(() => api.get("/materials"), []);
  const all = data?.materials || [];
  const subjects = [...new Set(all.map((m) => m.subject).filter(Boolean))];
  const list = all.filter((m) => (tab === "new" ? !m.opened : tab === "fav" ? m.favourite : true) && (!subject || m.subject === subject) && (!q || `${m.title} ${m.subject} ${m.folder} ${m.teacherName}`.toLowerCase().includes(q.toLowerCase())));

  const [saving, setSaving] = useState({}); // material id → download progress
  // "Opened" only once the file was really shown or fully saved – not on the button click
  const markOpened = (id, how) => {
    markMaterialOpened(id, how);
    setData((d) => ({ ...d, materials: d.materials.map((m) => (m.id === id ? { ...m, opened: true, isNew: false, lastOpenedAt: new Date().toISOString(), firstOpenedAt: m.firstOpenedAt || new Date().toISOString() } : m)) }));
  };
  const open = (m) => setPreview(m);
  const download = async (m) => {
    if (saving[m.id] !== undefined) return;
    setSaving((s) => ({ ...s, [m.id]: 0 }));
    try {
      const saved = await downloadMaterial(m, { onProgress: (p) => setSaving((s) => ({ ...s, [m.id]: p })) });
      if (saved) {
        markOpened(m.id, "download");
        ui.toast("Downloaded");
      }
    } catch (e) {
      ui.error(e);
    } finally {
      setSaving(({ [m.id]: _, ...rest }) => rest);
    }
  };
  const fav = async (m) => {
    const value = !m.favourite;
    setData((d) => ({ ...d, materials: d.materials.map((x) => (x.id === m.id ? { ...x, favourite: value } : x)) }));
    try {
      await api.post(`/materials/${m.id}/favourite`, { favourite: value });
    } catch (e) {
      ui.error(e);
      reload(true);
    }
  };

  return (
    <>
      <PageHeader title="Materials" subtitle="Worksheets, notes and videos shared by your teacher." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "all", label: "All", count: all.length },
            { value: "new", label: "Not opened", count: all.filter((m) => !m.opened).length },
            { value: "fav", label: "Favourites", icon: Heart, count: all.filter((m) => m.favourite).length },
          ]}
        />
        <div className="flex-1" />
        {subjects.length > 1 && <Select className="w-full sm:w-48" value={subject} onChange={setSubject} options={subjects.map((s) => ({ value: s, label: s }))} placeholder="All subjects" clearable />}
        <SearchInput value={q} onChange={setQ} className="w-full sm:w-64" />
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading ? (
        <Loading />
      ) : list.length === 0 ? (
        <Card>
          <Empty icon={FolderOpen} title={tab === "fav" ? "No favourites yet" : tab === "new" ? "You've opened everything" : "No materials yet"} text={tab === "fav" ? "Tap the heart on a material to keep it here." : ""} />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
          {list.map((m) => (
            <Card key={m.id} className="flex flex-col">
              <div className="flex items-start gap-3">
                <FileIcon kind={m.file?.kind} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-snug text-navy">{m.title}</p>
                  <p className="mt-0.5 truncate text-xs text-muted">{[m.subject, m.folder, m.file?.kind, fmtSize(m.file?.size)].filter(Boolean).join(" · ")}</p>
                </div>
                <button onClick={() => fav(m)} className={cx("rounded-full p-2 transition", m.favourite ? "text-rose-500 hover:bg-rose-50" : "text-slate-300 hover:bg-surface hover:text-rose-400")} aria-label={m.favourite ? "Remove from favourites" : "Add to favourites"}>
                  <Heart className={cx("h-5 w-5", m.favourite && "fill-current")} />
                </button>
              </div>
              {m.description && <p className="mt-3 line-clamp-2 text-sm text-muted">{m.description}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {m.opened ? (
                  <Badge tone="green">
                    <CheckCircle2 className="h-3 w-3" /> Opened {fromNow(m.lastOpenedAt)}
                  </Badge>
                ) : (
                  <Badge tone="gold">
                    <Sparkles className="h-3 w-3" /> New
                  </Badge>
                )}
                {m.version > 1 && <Badge>Updated · v{m.version}</Badge>}
                <span className="text-xs text-slate-400">{fmtDate(m.publishedAt)}</span>
              </div>
              <div className="mt-auto flex gap-2 pt-4">
                <Button size="sm" icon={Eye} className="flex-1" onClick={() => open(m)}>
                  Open
                </Button>
                <Button size="sm" variant="outline" icon={Download} loading={saving[m.id] !== undefined} onClick={() => download(m)}>
                  {saving[m.id] ? `${saving[m.id]}%` : "Download"}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      <PreviewDialog item={preview} onClose={() => setPreview(null)} onOpened={(how) => preview && markOpened(preview.id, how)} />
    </>
  );
}

// ---- Weekly attendance -------------------------------------------------------------
const WEEKEND = [
  { value: "yes", label: "Yes, attended" },
  { value: "partial", label: "Partly" },
  { value: "no", label: "No" },
];
const STATUS = {
  submitted: ["green", "Submitted"],
  late: ["amber", "Submitted late"],
  corrected: ["blue", "Reviewed by academy"],
  open: ["gold", "Open"],
  missing: ["red", "Not submitted"],
};

function AttendanceForm({ week, onSaved }) {
  const ui = useUi();
  const e = week.entry || {};
  const [f, setF] = useState({ weekendAttendance: e.weekendAttendance || null, classesAttended: e.classesAttended ?? "", lessonsCovered: e.lessonsCovered || "", rating: e.rating || 0, review: e.review || "", remarks: e.remarks || "" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v?.target ? v.target.value : v }));
  const submit = async (ev) => {
    ev.preventDefault();
    if (!f.weekendAttendance) return ui.error(new Error("Please answer the weekend attendance question"));
    setBusy(true);
    try {
      await api.put(`/attendance/me/${week.weekStart}`, { ...f, classesAttended: Number(f.classesAttended) });
      ui.toast(week.entry ? "Attendance updated" : "Attendance submitted – thank you!");
      onSaved();
    } catch (err) {
      ui.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="grid gap-5 sm:grid-cols-2">
      <Field label="Did you attend your weekend class?" required className="sm:col-span-2">
        <div className="grid grid-cols-3 gap-2">
          {WEEKEND.map((o) => (
            <button key={o.value} type="button" onClick={() => set("weekendAttendance")(o.value)} className={cx("rounded-xl border px-3 py-2.5 text-sm font-semibold transition", f.weekendAttendance === o.value ? "border-brand bg-brand-soft text-navy ring-2 ring-brand/30" : "border-line text-slate-600 hover:border-slate-300")}>
              {o.label}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Classes attended this week" required>
        <Input type="number" min={0} max={50} inputMode="numeric" value={f.classesAttended} onChange={set("classesAttended")} required placeholder="e.g. 3" />
      </Field>
      <Field label="How were the classes?">
        <div className="flex h-11 items-center gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" onClick={() => set("rating")(f.rating === n ? 0 : n)} aria-label={`${n} star${n > 1 ? "s" : ""}`} className="rounded-lg p-1 transition hover:bg-surface">
              <Star className={cx("h-7 w-7", n <= f.rating ? "fill-brand text-brand" : "text-slate-300")} />
            </button>
          ))}
        </div>
      </Field>
      <Field label="Lessons covered" required className="sm:col-span-2">
        <Textarea rows={3} value={f.lessonsCovered} onChange={set("lessonsCovered")} required maxLength={2000} placeholder="Which topics did you learn this week?" />
      </Field>
      <Field label="Review" className="sm:col-span-2">
        <Textarea rows={2} value={f.review} onChange={set("review")} maxLength={2000} placeholder="What went well? What was difficult?" />
      </Field>
      <Field label="Remarks (optional)" className="sm:col-span-2">
        <Textarea rows={2} value={f.remarks} onChange={set("remarks")} maxLength={2000} placeholder="Anything else you'd like the academy to know" />
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" size="lg" loading={busy} icon={CheckCircle2}>
          {week.entry ? "Update attendance" : "Submit attendance"}
        </Button>
      </div>
    </form>
  );
}

export function StudentAttendance() {
  const { data, loading, error, reload } = useAsync(() => api.get("/attendance/me"), []);
  const [selected, setSelected] = useState(null);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const weeks = data.weeks;
  const current = weeks.find((w) => w.weekStart === (selected || data.currentWeek)) || weeks[0];
  const pending = weeks.filter((w) => w.editable && !w.entry);
  return (
    <>
      <PageHeader title="Weekly attendance" subtitle="Fill in one short form each week. You can edit it until the end of the following week." />
      {pending.length > 0 && <Notice tone="warn" className="mb-6">You have {pending.length} week{pending.length > 1 ? "s" : ""} waiting: {pending.map((w) => fmtWeek(w.weekStart)).join(", ")}.</Notice>}
      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardTitle
            icon={ClipboardCheck}
            title={`Week of ${fmtWeek(current.weekStart)}`}
            subtitle={current.entry ? `Submitted ${fmtDateTime(current.entry.submittedAt)}${current.entry.updatedAt !== current.entry.submittedAt ? ` · edited ${fromNow(current.entry.updatedAt)}` : ""}` : "Not submitted yet"}
            action={<Badge tone={STATUS[current.status]?.[0]}>{STATUS[current.status]?.[1]}</Badge>}
          />
          {current.editable ? (
            <AttendanceForm key={current.weekStart + (current.entry?.updatedAt || "")} week={current} onSaved={reload} />
          ) : current.entry ? (
            <>
              {current.entry.correctedAt && <Notice className="mb-4">The academy reviewed this entry{current.entry.correctionReason ? `: ${current.entry.correctionReason}` : ""}.</Notice>}
              <dl className="grid gap-4 sm:grid-cols-2">
                <Detail label="Weekend attendance" value={WEEKEND.find((w) => w.value === current.entry.weekendAttendance)?.label} />
                <Detail label="Classes attended" value={current.entry.classesAttended} />
                <Detail label="Lessons covered" value={current.entry.lessonsCovered} wide />
                <Detail label="Rating" value={current.entry.rating ? "★".repeat(current.entry.rating) : "—"} />
                <Detail label="Review" value={current.entry.review} wide />
                <Detail label="Remarks" value={current.entry.remarks} wide />
              </dl>
            </>
          ) : (
            <Empty icon={ClipboardCheck} title="This week wasn't submitted" text="Forms can only be filled in for this week and last week." />
          )}
        </Card>
        <Card>
          <CardTitle icon={History} title="History" subtitle="Tap a week to see it" />
          <ul className="space-y-1.5">
            {weeks.map((w) => (
              <li key={w.weekStart}>
                <button onClick={() => setSelected(w.weekStart)} className={cx("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition", w.weekStart === current.weekStart ? "bg-surface ring-1 ring-line" : "hover:bg-surface")}>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-navy">{fmtWeek(w.weekStart)}</span>
                    {w.weekStart === data.currentWeek && <span className="block text-xs text-muted">This week</span>}
                  </span>
                  <Badge tone={STATUS[w.status]?.[0]}>{STATUS[w.status]?.[1]}</Badge>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}

function Detail({ label, value, wide }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-line text-[15px] text-ink">{value || value === 0 ? value : "—"}</dd>
    </div>
  );
}

// ---- Progress -----------------------------------------------------------------------
const LESSON_STATUS = { completed: ["green", "Completed"], in_progress: ["blue", "In progress"], planned: ["gray", "Planned"] };
export function StudentProgress() {
  const { data, loading, error, reload } = useAsync(() => api.get("/lessons"), []);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const { lessons, summary } = data;
  return (
    <>
      <PageHeader title="Learning progress" subtitle="Lessons your teacher has planned and completed with you." />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard icon={TrendingUp} label="Overall progress" value={`${summary.overall}%`} tone="blue" />
        <StatCard icon={CheckCircle2} label="Lessons completed" value={summary.completed} hint={`of ${summary.total}`} tone="green" />
        <StatCard icon={BookOpen} label="Subjects" value={summary.subjects.length} />
      </div>
      {summary.subjects.length > 0 && (
        <Card className="mb-6">
          <CardTitle title="By subject" />
          <div className="space-y-4">
            {summary.subjects.map((s) => (
              <div key={s.subject}>
                <div className="mb-1.5 flex justify-between text-sm">
                  <span className="font-semibold text-navy">{s.subject}</span>
                  <span className="text-muted">
                    {s.completed}/{s.total} {s.total === 1 ? "lesson" : "lessons"} · {s.avg}%
                  </span>
                </div>
                <Progress value={s.avg} tone="blue" />
              </div>
            ))}
          </div>
        </Card>
      )}
      <Card padded={false}>
        <div className="border-b border-line px-5 py-4 sm:px-6">
          <h2 className="font-bold text-navy">Lessons</h2>
        </div>
        {lessons.length === 0 ? (
          <Empty icon={BookOpen} title="No lessons recorded yet" />
        ) : (
          <ul className="divide-y divide-line">
            {lessons.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-3 px-5 py-4 sm:px-6">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-navy">{l.topic}</span>
                  <span className="block text-sm text-muted">{[l.subject, l.date && fmtDate(l.date)].filter(Boolean).join(" · ")}</span>
                  {l.comment && <span className="mt-1 block text-sm text-slate-600">“{l.comment}”</span>}
                </span>
                <div className="flex w-full items-center gap-3 sm:w-56">
                  <Progress value={l.status === "completed" ? 100 : l.progress} tone={l.status === "completed" ? "green" : "blue"} className="flex-1" />
                  <Badge tone={LESSON_STATUS[l.status][0]}>{LESSON_STATUS[l.status][1]}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}


