// ============================================================
// SUBJECTS – the list of subjects the academy teaches.
// Every subject field in the portal is a dropdown from this list.
// Subjects are never deleted: archiving hides one from the dropdowns and new
// assignments while old records keep it; renaming updates it everywhere.
// /portal/admin/subjects (permission settings, users or sessions)
// ============================================================
import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Archive, ArchiveRestore, BookOpen, BookOpenCheck, Eye, GraduationCap, Layers, MoreHorizontal, Pencil, Plus, Users } from "lucide-react";
import { api } from "../../lib/api.js";
import { can, useAuth } from "../../lib/auth.jsx";
import { refreshSubjects } from "../../lib/subjects.jsx";
import { fmtDate, fmtGrade, fromNow, plural } from "../../lib/format.js";
import { Avatar, Badge, Button, Card, Dialog, Empty, ErrorBox, Field, IconButton, Input, Loading, Menu, Notice, PageHeader, SearchInput, Segmented, Select, StatCard, Table, Textarea, cx, useAsync, useUi } from "../../ui/index.jsx";

const enc = encodeURIComponent;
const SORTS = [
  { value: "name", label: "Name A–Z" },
  { value: "-name", label: "Name Z–A" },
  { value: "-students", label: "Most students" },
  { value: "-teachers", label: "Most teachers" },
  { value: "-updated", label: "Recently updated" },
];
const USAGE = [
  { value: "", label: "Any usage" },
  { value: "noTeacher", label: "No teacher assigned" },
  { value: "noStudent", label: "No students enrolled" },
  { value: "inUse", label: "Has teachers & students" },
];
const FEE = { pending: ["amber", "Proof due"], submitted: ["blue", "Proof submitted"], verified: ["green", "Verified"], rejected: ["red", "Proof rejected"] };

const StatusBadge = ({ active }) => (active ? <Badge tone="green" dot>Active</Badge> : <Badge tone="gray" dot>Archived</Badge>);

function TeacherStack({ teachers, count }) {
  if (!count) return <span className="text-sm text-slate-400">No teacher yet</span>;
  return (
    <span className="flex items-center gap-2">
      <span className="flex -space-x-2">
        {teachers.slice(0, 3).map((t) => (
          <Avatar key={t.id} name={t.name} size="sm" className="ring-2 ring-white" />
        ))}
      </span>
      <span className="min-w-0 text-sm">
        <span className="block truncate font-medium text-navy">{teachers[0]?.name}</span>
        {count > 1 && <span className="block text-xs text-muted">+{plural(count - 1, "more teacher")}</span>}
      </span>
    </span>
  );
}

export function AdminSubjects() {
  const ui = useUi();
  const { data, loading, error, reload } = useAsync(() => api.get("/admin/subjects"), []);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [usage, setUsage] = useState("");
  const [sort, setSort] = useState("name");
  const [form, setForm] = useState(null); // { subject? } add / edit
  const [view, setView] = useState(null); // subject name

  const subjects = useMemo(() => data?.subjects || [], [data]);
  const counts = { all: subjects.length, active: subjects.filter((s) => s.active).length, archived: subjects.filter((s) => !s.active).length };
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = subjects.filter(
      (s) =>
        (status === "all" || (status === "active") === s.active) &&
        (!t || `${s.name} ${s.description} ${s.teachers.map((x) => x.name).join(" ")}`.toLowerCase().includes(t)) &&
        (!usage || (usage === "noTeacher" ? !s.teacherCount : usage === "noStudent" ? !s.studentCount : s.teacherCount && s.studentCount))
    );
    const key = { name: (s) => s.name.toLowerCase(), students: (s) => s.studentCount, teachers: (s) => s.teacherCount, updated: (s) => s.updatedAt || "" }[sort.replace("-", "")];
    const dir = sort.startsWith("-") ? -1 : 1;
    return [...list].sort((a, b) => (key(a) < key(b) ? -dir : key(a) > key(b) ? dir : a.name.localeCompare(b.name)));
  }, [subjects, q, status, usage, sort]);

  const done = async (msg) => {
    ui.toast(msg);
    await refreshSubjects().catch(() => {});
    reload(true);
  };
  const archive = (s) =>
    ui.confirm({
      title: `Archive ${s.name}?`,
      message: `${s.name} disappears from every subject dropdown, so it can't be given to new students, teachers, sessions, classes or materials.${s.teacherCount || s.studentCount ? ` The ${[s.teacherCount && plural(s.teacherCount, "teacher"), s.studentCount && plural(s.studentCount, "student")].filter(Boolean).join(" and ")} who already have it keep it, and so do all past records.` : " Past records keep it."} You can restore it at any time.`,
      confirmLabel: "Archive subject",
      danger: true,
      onConfirm: async () => {
        await api.post(`/admin/subjects/${enc(s.name)}/archive`);
        await done(`${s.name} archived`);
      },
    });
  const restore = (s) =>
    ui.confirm({
      title: `Restore ${s.name}?`,
      message: `${s.name} comes back in the subject dropdowns and can be assigned again.`,
      confirmLabel: "Restore subject",
      onConfirm: async () => {
        await api.post(`/admin/subjects/${enc(s.name)}/restore`);
        await done(`${s.name} restored`);
      },
    });
  const menu = (s) => (
    <Menu
      trigger={<IconButton icon={MoreHorizontal} label={`Actions for ${s.name}`} />}
      items={[
        { label: "View details", icon: Eye, onClick: () => setView(s.name) },
        { label: "Edit", icon: Pencil, onClick: () => setForm({ subject: s }) },
        { label: "Archive", icon: Archive, danger: true, onClick: () => archive(s), hidden: !s.active },
        { label: "Restore", icon: ArchiveRestore, onClick: () => restore(s), hidden: s.active },
      ]}
    />
  );

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;

  const empty = subjects.length ? (
    <Empty icon={BookOpen} title="No subjects match" text="Try another search or filter." action={<Button variant="outline" size="sm" onClick={() => { setQ(""); setStatus("all"); setUsage(""); }}>Clear filters</Button>} />
  ) : (
    <Empty icon={BookOpen} title="No subjects yet" text="Add the subjects the academy teaches. Until then, subject fields accept anything." action={<Button icon={Plus} onClick={() => setForm({})}>Add subject</Button>} />
  );

  return (
    <>
      <PageHeader
        title="Subjects"
        subtitle="The subjects the academy teaches. Every subject field in the portal – students, teachers, sessions, classes, timetable and materials – is a dropdown from this list."
        actions={<Button icon={Plus} onClick={() => setForm({})}>Add Subject</Button>}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard icon={Layers} tone="navy" label="Total subjects" value={counts.all} hint="Everything in the list" onClick={() => setStatus("all")} />
        <StatCard icon={BookOpenCheck} tone="green" label="Active subjects" value={counts.active} hint="Shown in the dropdowns" onClick={() => setStatus("active")} />
        <StatCard icon={Archive} tone="gold" label="Archived subjects" value={counts.archived} hint="Hidden, history kept" onClick={() => setStatus("archived")} />
      </div>

      <Card flush>
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:px-6 lg:flex-row lg:items-center">
          <SearchInput value={q} onChange={setQ} className="w-full lg:max-w-xs" placeholder="Search subject or teacher…" />
          <Segmented
            size="sm"
            value={status}
            onChange={setStatus}
            options={[
              { value: "all", label: `All (${counts.all})` },
              { value: "active", label: `Active (${counts.active})` },
              { value: "archived", label: `Archived (${counts.archived})` },
            ]}
          />
          <div className="flex gap-2 lg:ml-auto">
            <Select className="w-full sm:w-52" value={usage} onChange={(v) => setUsage(v || "")} options={USAGE} placeholder="Any usage" />
            <Select className="w-full sm:w-48" value={sort} onChange={(v) => setSort(v || "name")} options={SORTS} />
          </div>
        </div>

        {/* Phones: stacked cards */}
        <div className="md:hidden">
          {rows.length ? (
            <ul className="divide-y divide-line">
              {rows.map((s) => (
                <li key={s.name} className="flex gap-3 p-4">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setView(s.name)}>
                    <span className="flex items-center gap-2">
                      <span className={cx("truncate font-semibold", s.active ? "text-navy" : "text-slate-500")}>{s.name}</span>
                      <StatusBadge active={s.active} />
                    </span>
                    {s.description && <span className="mt-0.5 block truncate text-xs text-muted">{s.description}</span>}
                    <span className="mt-2 flex gap-4 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1"><GraduationCap className="h-3.5 w-3.5" /> {plural(s.teacherCount, "teacher")}</span>
                      <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {plural(s.studentCount, "student")}</span>
                    </span>
                  </button>
                  {menu(s)}
                </li>
              ))}
            </ul>
          ) : (
            empty
          )}
        </div>

        {/* Tablets and up: table */}
        <div className="hidden md:block">
          <Table
            rowKey="name"
            rows={rows}
            pageSize={25}
            minWidth="min-w-[760px]"
            empty={empty}
            onRowClick={(s) => setView(s.name)}
            columns={[
              {
                key: "name",
                label: "Subject name",
                render: (s) => (
                  <span className="flex items-center gap-3">
                    <span className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", s.active ? "bg-brand-soft text-[#a77d00]" : "bg-slate-100 text-slate-400")}>
                      <BookOpen className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className={cx("block font-semibold", s.active ? "text-navy" : "text-slate-500")}>{s.name}</span>
                      <span className="block max-w-[260px] truncate text-xs text-muted">{s.description || (s.activeSessions ? plural(s.activeSessions, "active session") : "No description")}</span>
                    </span>
                  </span>
                ),
              },
              { key: "teachers", label: "Assigned teachers", render: (s) => <TeacherStack teachers={s.teachers} count={s.teacherCount} /> },
              { key: "students", label: "Students", render: (s) => <span className="font-semibold text-navy">{s.studentCount}</span> },
              { key: "status", label: "Status", render: (s) => <StatusBadge active={s.active} /> },
              { key: "updated", label: "Last updated", render: (s) => <span className="whitespace-nowrap text-sm text-slate-500" title={s.updatedAt ? fmtDate(s.updatedAt) : ""}>{s.updatedAt ? fromNow(s.updatedAt) : "—"}</span> },
              { key: "actions", label: <span className="sr-only">Actions</span>, headClass: "w-12", render: (s) => <span onClick={(e) => e.stopPropagation()}>{menu(s)}</span> },
            ]}
          />
        </div>
      </Card>

      {form && <SubjectForm subject={form.subject} subjects={subjects} suggestions={data.suggestions} onClose={() => setForm(null)} onSaved={async (msg) => { setForm(null); await done(msg); }} />}
      {view && <SubjectDetails name={view} onClose={() => setView(null)} onEdit={(s) => { setView(null); setForm({ subject: s }); }} onArchive={(s) => (s.active ? archive(s) : restore(s)).then((ok) => ok && setView(null))} />}
    </>
  );
}

// ---- Add / edit ---------------------------------------------------------------
function SubjectForm({ subject, subjects, suggestions, onClose, onSaved }) {
  const ui = useUi();
  const [name, setName] = useState(subject?.name || "");
  const [description, setDescription] = useState(subject?.description || "");
  const [busy, setBusy] = useState(false);
  const v = name.trim().replace(/\s+/g, " ");
  const clash = subjects.find((s) => s.name !== subject?.name && s.name.toLowerCase() === v.toLowerCase());
  const renaming = subject && v && v !== subject.name;
  const inUse = subject && (subject.teacherCount || subject.studentCount || subject.activeSessions);
  const save = async (e) => {
    e?.preventDefault();
    if (!v || clash) return;
    if (renaming) {
      const ok = await ui.confirm({
        title: `Rename ${subject.name} to ${v}?`,
        message: `The new name is applied everywhere – students, teachers, sessions, classes, timetable, materials, attendance and fee records that use ${subject.name}. Nothing is lost.`,
        confirmLabel: "Rename everywhere",
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      if (subject) {
        const r = await api.patch(`/admin/subjects/${enc(subject.name)}`, { name: v, description });
        onSaved(renaming ? `Renamed to ${v}${r.renamed ? ` – ${plural(r.renamed, "record")} updated` : ""}` : `${v} saved`);
      } else {
        await api.post("/admin/subjects", { name: v, description });
        onSaved(`${v} added`);
      }
    } catch (err) {
      ui.error(err);
      setBusy(false);
    }
  };
  const open = suggestions.filter((x) => !subjects.some((s) => s.name.toLowerCase() === x.toLowerCase()));
  return (
    <Dialog
      open
      onClose={onClose}
      title={subject ? `Edit ${subject.name}` : "Add subject"}
      subtitle={subject ? "Change the name or description." : "It appears in every subject dropdown straight away."}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button icon={subject ? Pencil : Plus} onClick={save} loading={busy} disabled={!v || !!clash || (subject && v === subject.name && description.trim() === (subject.description || ""))}>
            {subject ? (renaming ? "Rename & save" : "Save changes") : "Add subject"}
          </Button>
        </>
      }
    >
      <form onSubmit={save} className="space-y-4">
        <Field label="Subject name" required error={clash ? `${clash.name} is already in the list${clash.active ? "" : " (archived – restore it instead)"}` : ""}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. Mathematics" autoFocus />
        </Field>
        <Field label="Description" hint="Optional – shown in the subject list, e.g. “CBSE & ICSE, Grades 6–12”.">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} rows={2} />
        </Field>
        {renaming && inUse ? (
          <Notice>
            Renaming updates {subject.name} everywhere it's used ({[subject.teacherCount && plural(subject.teacherCount, "teacher"), subject.studentCount && plural(subject.studentCount, "student")].filter(Boolean).join(", ")} and their records).
          </Notice>
        ) : null}
        {!subject && open.length > 0 && (
          <div>
            <p className="mb-2 text-[13px] font-medium text-slate-700">Already typed on teachers or students</p>
            <div className="flex flex-wrap gap-2">
              {open.map((x) => (
                <button key={x} type="button" onClick={() => setName(x)} className={cx("rounded-lg px-2.5 py-1 text-sm ring-1 transition", v.toLowerCase() === x.toLowerCase() ? "bg-brand-soft text-navy ring-brand" : "bg-surface text-navy ring-line hover:bg-white")}>
                  + {x}
                </button>
              ))}
            </div>
          </div>
        )}
      </form>
    </Dialog>
  );
}

// ---- View details -------------------------------------------------------------
function SubjectDetails({ name, onClose, onEdit, onArchive }) {
  const { user } = useAuth();
  const canUsers = can(user, "users");
  const { data, loading, error, reload } = useAsync(() => api.get(`/admin/subjects/${enc(name)}`), [name]);
  const [tab, setTab] = useState("teachers");
  const [q, setQ] = useState("");
  const s = data?.subject;
  const t = q.trim().toLowerCase();
  const teachers = (data?.teachers || []).filter((x) => !t || x.name.toLowerCase().includes(t));
  const students = (data?.students || []).filter((x) => !t || `${x.name} ${x.studentCode} ${x.teacherName}`.toLowerCase().includes(t));
  const person = (p, sub) => {
    const inner = (
      <span className="flex min-w-0 items-center gap-3">
        <Avatar name={p.name} size="sm" />
        <span className="min-w-0">
          <span className="block truncate font-semibold text-navy">{p.name}{!p.active && <Badge tone="gray" className="ml-2">Inactive</Badge>}</span>
          {sub && <span className="block truncate text-xs text-muted">{sub}</span>}
        </span>
      </span>
    );
    return canUsers ? <Link to={`/portal/admin/users/${p.id}`} className="hover:underline" onClick={onClose}>{inner}</Link> : inner;
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title={s ? s.name : name}
      subtitle={s?.description || "Subject details"}
      footer={
        s && (
          <>
            <Button variant={s.active ? "danger-outline" : "outline"} icon={s.active ? Archive : ArchiveRestore} onClick={() => onArchive(s)}>{s.active ? "Archive" : "Restore"}</Button>
            <Button icon={Pencil} onClick={() => onEdit(s)}>Edit subject</Button>
          </>
        )
      }
    >
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : (
        <>
          <dl className="grid gap-x-6 gap-y-4 rounded-xl bg-surface p-4 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ["Status", <StatusBadge key="s" active={s.active} />],
              ["Teachers", s.teacherCount],
              ["Students", s.studentCount],
              ["Active sessions", s.activeSessions],
              ["Added", s.createdAt ? fmtDate(s.createdAt) : "—"],
              [s.active ? "Last updated" : "Archived", (s.active ? s.updatedAt : s.archivedAt) ? fmtDate(s.active ? s.updatedAt : s.archivedAt) : "—"],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{k}</dt>
                <dd className="mt-1 font-semibold text-navy">{v}</dd>
              </div>
            ))}
          </dl>
          {!s.active && <Notice className="mt-4">Archived: hidden from the dropdowns and new assignments. The teachers, students and records below keep it.</Notice>}

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { value: "teachers", label: <><GraduationCap className="h-4 w-4" /> Teachers ({data.teachers.length})</> },
                { value: "students", label: <><Users className="h-4 w-4" /> Students ({data.students.length})</> },
              ]}
            />
            <SearchInput value={q} onChange={setQ} className="w-full sm:ml-auto sm:w-64" placeholder={tab === "teachers" ? "Search teachers…" : "Search students or ID…"} />
          </div>

          <div className="mt-4 overflow-hidden rounded-xl border border-line">
            {tab === "teachers" ? (
              <Table
                rows={teachers}
                minWidth="min-w-[620px]"
                empty={<Empty icon={GraduationCap} title={t ? "No teachers match" : "No teachers yet"} text={t ? "" : `Add ${s.name} to a teacher's subjects, or assign a teacher to a student for ${s.name}.`} />}
                columns={[
                  { key: "name", label: "Teacher", render: (x) => person(x, x.lastActiveAt ? `Active ${fromNow(x.lastActiveAt)}` : "") },
                  { key: "subjects", label: "Subjects taught", render: (x) => <span className="flex flex-wrap gap-1">{x.subjects.length ? x.subjects.map((y) => <Badge key={y} tone={y.toLowerCase() === s.name.toLowerCase() ? "amber" : "gray"}>{y}</Badge>) : <span className="text-slate-400">—</span>}</span> },
                  { key: "studentCount", label: `${s.name} students`, render: (x) => <span className="font-semibold text-navy">{x.studentCount}</span> },
                  { key: "activeSessions", label: "Active sessions", render: (x) => x.activeSessions },
                ]}
              />
            ) : (
              <Table
                rows={students}
                minWidth="min-w-[760px]"
                empty={<Empty icon={Users} title={t ? "No students match" : "No students yet"} text={t ? "" : `Students appear here once ${s.name} is added to their subjects.`} />}
                columns={[
                  { key: "name", label: "Student", render: (x) => person(x, [x.studentCode, fmtGrade(x.grade), x.board].filter(Boolean).join(" · ")) },
                  { key: "teacherName", label: "Teacher", render: (x) => x.teacherName || <span className="text-amber-700">Not assigned</span> },
                  {
                    key: "session",
                    label: "Current session",
                    render: (x) =>
                      x.session ? (
                        <Link to={`/portal/sessions/${x.session.id}/register`} onClick={onClose} className="hover:underline">
                          <b className="text-navy">Session {x.session.number}</b>
                          <span className="block whitespace-nowrap text-xs text-muted">{x.session.startDate ? fmtDate(`${x.session.startDate}T12:00:00`) : "—"} – {x.session.endDate ? fmtDate(`${x.session.endDate}T12:00:00`) : "—"}{x.session.status !== "active" ? ` · ${x.session.status}` : ""}</span>
                        </Link>
                      ) : (
                        <span className="text-slate-400">No session</span>
                      ),
                  },
                  { key: "fee", label: "Fee", render: (x) => (x.fee ? <Badge tone={FEE[x.fee][0]}>{FEE[x.fee][1]}</Badge> : <span className="text-slate-400">—</span>) },
                ]}
              />
            )}
          </div>
        </>
      )}
    </Dialog>
  );
}
