import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, CalendarDays, CheckCircle2, ClipboardCheck, Copy, KeyRound, Lock, Pencil, Plus, RotateCcw, ShieldCheck, Trash2, Unlock, UserCheck, UserMinus, Users, GraduationCap,
} from "lucide-react";
import { api } from "../../lib/api.js";
import { rowsOf, teacherIdsOf } from "../../lib/assign.js";
import { SubjectSelect, useSubjects } from "../../lib/subjects.jsx";
import { useAuth, can } from "../../lib/auth.jsx";
import { fmtDate, fmtDateTime, fmtGrade, fmtLastSeen, fmtName, fmtPhone, plural } from "../../lib/format.js";
import {
  Avatar, Badge, Button, Card, CardTitle, Checkbox, Dialog, Empty, ErrorBox, Field, IconButton, Input, Loading, Notice, PageHeader, SearchInput, Segmented, Select, StatCard, Table, Toggle, useAsync, useUi,
} from "../../ui/index.jsx";

const ROLE_WORD = { student: "student", teacher: "teacher", admin: "admin" };

// ---- Subjects & teachers: one teacher per subject ----------------------------------------
const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
const cleanRows = (rows) => {
  const out = rows.map((r) => ({ subject: (r.subject || "").trim(), teacherId: r.teacherId || null })).filter((r) => r.subject || r.teacherId);
  if (out.some((r) => !r.subject)) throw new Error("Enter the subject for each teacher");
  return out;
};

export function SubjectTeachersEditor({ rows, onChange, teachers }) {
  const active = teachers.filter((t) => t.active || rows.some((r) => r.teacherId === t.id));
  const setRow = (i, patch) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  // Only teachers who teach the subject (the backend refuses others); teachers with no
  // subject list and the one already chosen stay available
  const optionsFor = (subject, current) =>
    active
      .filter((t) => !subject || !(t.subjects || []).length || (t.subjects || []).some((x) => same(x, subject)) || t.id === current)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => ({ value: t.id, label: t.name, hint: (t.subjects || []).length ? (t.subjects || []).join(", ") : "No subjects set" }));
  const dupes = new Set(rows.map((r) => r.subject.trim().toLowerCase()).filter((x, i, a) => x && a.indexOf(x) !== i));
  return (
    <div className="space-y-2">
      {rows.length === 0 && <p className="text-sm text-muted">No subjects yet. Add each subject the student takes and choose its teacher.</p>}
      {rows.map((r, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-xl border border-slate-200 p-2 sm:flex-row sm:items-center">
          <SubjectSelect value={r.subject} onChange={(v) => setRow(i, { subject: v })} className="sm:w-56" />
          <div className="min-w-0 flex-1">
            <Select value={r.teacherId} onChange={(v) => setRow(i, { teacherId: v })} options={optionsFor(r.subject, r.teacherId)} placeholder={r.subject ? "No teacher yet" : "Choose the subject first"} emptyText={`No active teacher teaches ${r.subject} yet`} clearable searchable />
          </div>
          <IconButton icon={Trash2} label="Remove subject" onClick={() => onChange(rows.filter((_, j) => j !== i))} />
        </div>
      ))}
      {dupes.size > 0 && <p className="text-xs text-red-600">Each subject can only be listed once.</p>}
      <Button type="button" variant="outline" size="sm" icon={Plus} onClick={() => onChange([...rows, { subject: "", teacherId: null }])}>
        Add subject
      </Button>
    </div>
  );
}

// Teacher subjects: several from the academy's list
function TeacherSubjects({ value, onChange }) {
  const all = useSubjects();
  const names = [...all, ...value.filter((v) => !all.some((a) => same(a, v)))];
  return <Select multiple value={value} onChange={onChange} options={names.map((n) => ({ value: n, label: n }))} placeholder="Choose subjects" searchable={names.length > 8} emptyText="No subjects yet – add them on the Subjects page" />;
}

// ---- Credentials shown once after create / reset ------------------------------------------
function EmailStatus({ email, to }) {
  if (!email || email.status === "off") return null;
  if (email.status === "sent")
    return (
      <Notice tone="success" className="mb-4">
        Login details were emailed to <strong>{to}</strong>.
      </Notice>
    );
  return (
    <Notice tone="warn" className="mb-4">
      The email couldn't be sent{email.error ? ` – ${email.error}` : ""}. Copy the details below and share them yourself.
    </Notice>
  );
}

function CredentialsDialog({ creds, onClose }) {
  const ui = useUi();
  if (!creds) return null;
  const text = `Silora Academy portal\nSign in: ${window.location.origin}/portal/login\nUser ID (email): ${creds.email}\nPassword: ${creds.password}`;
  return (
    <Dialog
      open
      onClose={onClose}
      title={creds.emailResult?.status === "sent" ? "Account ready" : "Share these sign-in details"}
      subtitle="The password is shown only once."
      size="sm"
      footer={
        <>
          <Button
            variant="outline"
            icon={Copy}
            onClick={() => {
              navigator.clipboard?.writeText(text);
              ui.toast("Copied");
            }}
          >
            Copy
          </Button>
          <Button onClick={onClose}>Done</Button>
        </>
      }
    >
      <EmailStatus email={creds.emailResult} to={creds.email} />
      <div className="space-y-3 rounded-2xl bg-surface p-4 font-mono text-sm">
        <p>
          <span className="text-slate-400">Email: </span>
          {creds.email}
        </p>
        <p>
          <span className="text-slate-400">Password: </span>
          <strong>{creds.password}</strong>
        </p>
      </div>
      <Notice className="mt-4">Ask them to change it from “My profile” after their first sign-in.</Notice>
    </Dialog>
  );
}

// ---- Create / edit -------------------------------------------------------------------------
export function UserFormDialog({ open, onClose, role, user, teachers = [], onSaved, catalog, prefill }) {
  const ui = useUi();
  const { user: me } = useAuth();
  const canContacts = can(me, "contacts");
  const editing = !!user;
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [creds, setCreds] = useState(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    const c = user?.contact || {};
    setF({
      name: user?.name || "",
      email: c.email || "",
      phone: c.phone || "",
      parentName: c.parentName || "",
      parentPhone: c.parentPhone || "",
      address: c.address || "",
      grade: user?.grade || "",
      board: user?.board || "",
      subjects: user?.subjects || [],
      studentCode: user?.studentCode || "",
      rows: rowsOf(user).map((r) => ({ subject: r.subject || "", teacherId: r.teacherId || null })),
      password: "",
      sendCredentials: true,
      superAdmin: false,
      permissions: {},
      ...(!user && prefill ? prefill : {}),
    });
  }, [open, user]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v?.target ? v.target.value : v }));

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const body = { name: f.name, grade: f.grade, board: f.board };
      if (role === "student") {
        body.studentCode = f.studentCode;
        const rows = cleanRows(f.rows || []);
        if (new Set(rows.map((r) => r.subject.toLowerCase())).size !== rows.length) throw new Error("Each subject can only be listed once");
        body.subjectTeachers = rows;
      } else body.subjects = f.subjects;
      if (!editing || canContacts) Object.assign(body, { email: f.email, phone: f.phone, parentName: f.parentName, parentPhone: f.parentPhone, address: f.address });
      if (editing) {
        await api.patch(`/admin/users/${user.id}`, body);
        ui.toast("Saved");
        onSaved?.();
        onClose();
      } else {
        const r = await api.post("/admin/users", { ...body, role, password: f.password || undefined, sendCredentials: f.sendCredentials, superAdmin: f.superAdmin, permissions: f.permissions });
        onSaved?.(r.id);
        ui.toast(`${f.name} added${r.email?.status === "sent" ? " – login details emailed" : ""}`);
        setCreds({ email: f.email, password: r.tempPassword || f.password, emailResult: r.email });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const showContacts = !editing || canContacts;
  return (
    <>
      <Dialog
        open={open && !creds}
        onClose={onClose}
        title={editing ? `Edit ${user.name}` : `Add ${ROLE_WORD[role]}`}
        subtitle={editing ? "" : "The email address is their sign-in ID."}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" form="user-form" loading={busy}>{editing ? "Save" : `Create ${ROLE_WORD[role]}`}</Button>
          </>
        }
      >
        <form id="user-form" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          {error && <Notice tone="danger" className="sm:col-span-2">{error}</Notice>}
          <Field label="Full name" required className="sm:col-span-2">
            <Input value={f.name || ""} onChange={set("name")} required maxLength={120} />
          </Field>
          {showContacts ? (
            <>
              <Field label="Email (sign-in)" required>
                <Input type="email" value={f.email || ""} onChange={set("email")} required />
              </Field>
              <Field label="Phone">
                <Input value={f.phone || ""} onChange={set("phone")} maxLength={40} placeholder="+91 …" />
              </Field>
            </>
          ) : (
            <Notice icon={Lock} className="sm:col-span-2">Contact details are hidden – your admin account doesn't have the contacts permission.</Notice>
          )}
          {role === "student" && (
            <>
              <Field label="Student ID" hint="The academy's own ID – shown on sessions, fees and registers">
                <Input value={f.studentCode || ""} onChange={(e) => set("studentCode")(e.target.value.toUpperCase().replace(/\s+/g, ""))} placeholder="e.g. SA260905" maxLength={30} />
              </Field>
              <Field label="Grade">
                <Input value={f.grade || ""} onChange={set("grade")} placeholder="e.g. Grade 9" maxLength={40} />
              </Field>
              <Field label="Board / curriculum">
                <Input value={f.board || ""} onChange={set("board")} placeholder="e.g. CBSE, IGCSE" maxLength={60} />
              </Field>
              {showContacts && (
                <>
                  <Field label="Parent / guardian name">
                    <Input value={f.parentName || ""} onChange={set("parentName")} maxLength={120} />
                  </Field>
                  <Field label="Parent phone">
                    <Input value={f.parentPhone || ""} onChange={set("parentPhone")} maxLength={40} />
                  </Field>
                </>
              )}
              <Field label="Subjects & teachers" hint="One teacher per subject – e.g. Mathematics with one teacher, Science with another" className="sm:col-span-2">
                <SubjectTeachersEditor rows={f.rows || []} onChange={set("rows")} teachers={teachers} />
              </Field>
            </>
          )}
          {role === "teacher" && (
            <Field label="Subjects" hint="From the academy's subject list (Subjects page)" className="sm:col-span-2">
              <TeacherSubjects value={f.subjects || []} onChange={set("subjects")} />
            </Field>
          )}
          {!editing && (
            <>
              <Field label="Password" hint="Leave empty to generate a temporary password" className="sm:col-span-2">
                <Input value={f.password || ""} onChange={set("password")} type="text" autoComplete="new-password" placeholder="Auto-generate" />
              </Field>
              <div className="sm:col-span-2">
                <Checkbox checked={f.sendCredentials} onChange={set("sendCredentials")} label="Email the user ID (email) and password to them" />
              </div>
            </>
          )}
          {role === "admin" && !editing && catalog && (
            <div className="space-y-3 rounded-2xl border border-line p-4 sm:col-span-2">
              <Toggle label="Super admin" description="Full access, including admin accounts and restores" checked={f.superAdmin} onChange={set("superAdmin")} />
              {!f.superAdmin && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {Object.entries(catalog).map(([k, label]) => (
                    <Checkbox key={k} checked={!!f.permissions?.[k]} onChange={(v) => setF((p) => ({ ...p, permissions: { ...p.permissions, [k]: v } }))} label={label} />
                  ))}
                </div>
              )}
            </div>
          )}
        </form>
      </Dialog>
      <CredentialsDialog
        creds={creds}
        onClose={() => {
          setCreds(null);
          onClose();
        }}
      />
    </>
  );
}

// ---- List ------------------------------------------------------------------------------
export function AdminUsersPage({ role }) {
  const navigate = useNavigate();
  const [status, setStatus] = useState("active");
  const [q, setQ] = useState("");
  const [teacherFilter, setTeacherFilter] = useState(null);
  const [adding, setAdding] = useState(false);
  const { data, loading, error, reload } = useAsync(() => api.get("/admin/users", { role, status }), [role, status]);
  const dir = useAsync(() => api.get("/admin/directory"), []);
  const teachers = dir.data?.teachers || [];
  const needsTeacher = (u) => !teacherIdsOf(u).length || (u.unassignedSubjects || []).length > 0;
  const list = (data?.users || []).filter((u) => (!teacherFilter || (teacherFilter === "none" ? needsTeacher(u) : teacherIdsOf(u).includes(teacherFilter))) && (!q || [u.name, u.studentCode, u.grade, u.board, u.teacherName, u.contact?.email, u.contact?.phone, (u.subjects || []).join(" ")].join(" ").toLowerCase().includes(q.toLowerCase())));
  const contacts = data?.canViewContacts;

  const columns = [
    {
      key: "name",
      label: "Name",
      render: (u) => (
        <span className="flex items-center gap-3">
          {role !== "teacher" && <Avatar name={u.name} size="sm" />}
          <span className="min-w-0">
            <span className="block font-semibold text-navy">{fmtName(u.name)}{u.studentCode && <span className="ml-2 rounded bg-surface px-1.5 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-line">{u.studentCode}</span>}</span>
            {contacts && <span className="block text-xs text-muted">{u.contact?.email?.toLowerCase()}</span>}
          </span>
        </span>
      ),
    },
    role === "student" && { key: "grade", label: "Grade / board", render: (u) => [fmtGrade(u.grade), u.board].filter(Boolean).join(" · ") || "—", className: "whitespace-nowrap" },
    role === "student" && {
      key: "teacherName",
      label: "Subjects & teachers",
      className: "max-w-[320px]",
      render: (u) => (
        <span className="block space-y-1">
          {rowsOf(u).filter((r) => r.teacherId).map((r, i) => (
            <span key={i} className="block text-sm">
              {r.subject && <span className="text-muted">{r.subject} · </span>}
              {fmtName(teachers.find((t) => t.id === r.teacherId)?.name || "—")}
            </span>
          ))}
          {!teacherIdsOf(u).length ? <Badge tone="amber">Unassigned</Badge> : (u.unassignedSubjects || []).length > 0 && <Badge tone="amber">No teacher: {u.unassignedSubjects.join(", ")}</Badge>}
        </span>
      ),
    },
    role === "teacher" && { key: "subjects", label: "Subjects", render: (u) => (u.subjects || []).join(", ") || "—" },
    role === "teacher" && { key: "studentCount", label: "Students", render: (u) => u.studentCount },
    contacts && { key: "phone", label: "Phone", render: (u) => fmtPhone(u.contact?.phone) || "—", className: "whitespace-nowrap tabular-nums" },
    {
      key: "lastLoginAt",
      label: "Last sign-in",
      className: "whitespace-nowrap",
      render: (u) => (u.lastLoginAt ? <span title={fmtDateTime(u.lastLoginAt)}>{fmtLastSeen(u.lastLoginAt)}</span> : <span className="text-slate-400">Never</span>),
    },
    {
      key: "status",
      label: "Status",
      render: (u) =>
        u.deletedAt ? <Badge tone="red">Deleted</Badge> : u.lockedUntil && new Date(u.lockedUntil) > new Date() ? <Badge tone="amber">Locked</Badge> : u.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>,
    },
  ].filter(Boolean);

  return (
    <>
      <PageHeader
        title={role === "student" ? "Students" : "Teachers"}
        subtitle={role === "student" ? "Create student logins (shared with parents), assign teachers and manage access." : "Teacher accounts, subjects and workload."}
        actions={<Button icon={Plus} onClick={() => setAdding(true)}>Add {role}</Button>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          value={status}
          onChange={setStatus}
          options={[
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
            { value: "deleted", label: "Deleted" },
          ]}
        />
        <div className="flex-1" />
        {role === "student" && <Select className="w-full sm:w-52" value={teacherFilter} onChange={setTeacherFilter} options={[{ value: "none", label: "Needs a teacher" }, ...teachers.map((t) => ({ value: t.id, label: t.name }))]} placeholder="All teachers" clearable />}
        <SearchInput value={q} onChange={setQ} className="w-full sm:w-72" placeholder={`Search ${role}s…`} />
      </div>
      <ErrorBox error={error} onRetry={reload} />
      <Card flush>
        {loading ? <Loading /> : <Table columns={columns} rows={list} onRowClick={(u) => navigate(`/portal/admin/users/${u.id}`)} empty={<Empty icon={role === "student" ? GraduationCap : Users} title={`No ${status} ${role}s`} />} />}
      </Card>
      <UserFormDialog open={adding} onClose={() => setAdding(false)} role={role} teachers={teachers} onSaved={() => reload(true)} />
    </>
  );
}

// ---- Detail -------------------------------------------------------------------------------
export function AdminUserDetail() {
  const { id } = useParams();
  const ui = useUi();
  const navigate = useNavigate();
  const { user: me } = useAuth();
  const { data, loading, error, reload } = useAsync(() => api.get(`/admin/users/${id}`), [id]);
  const dir = useAsync(() => api.get("/admin/directory"), []);
  const [editing, setEditing] = useState(false);
  const [creds, setCreds] = useState(null);
  const [assign, setAssign] = useState(false);
  const [rows, setRows] = useState([]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const u = data.user;
  const back = u.role === "student" ? "/portal/admin/students" : u.role === "teacher" ? "/portal/admin/teachers" : "/portal/admin/admins";
  const locked = u.lockedUntil && new Date(u.lockedUntil) > new Date();
  const self = u.id === me.id;
  const act = async (fn, msg) => {
    try {
      await fn();
      if (msg) ui.toast(msg);
      reload(true);
    } catch (e) {
      ui.error(e);
    }
  };

  const resetPw = () =>
    ui.confirm({
      title: "Reset password?",
      message: `A new temporary password will be created for ${u.name} and emailed to them. They'll be signed out everywhere.`,
      confirmLabel: "Reset password",
      onConfirm: async () => {
        const r = await api.post(`/admin/users/${u.id}/reset-password`, { sendCredentials: true });
        setCreds({ email: u.contact?.email || "(their sign-in email)", password: r.tempPassword, emailResult: r.email });
      },
    });
  const toggleActive = () =>
    ui.confirm({
      title: u.active ? `Deactivate ${u.name}?` : `Activate ${u.name}?`,
      message: u.active
        ? `They'll be signed out and won't be able to sign in until reactivated. Their data is kept.${u.role === "teacher" ? " Their upcoming classes stay on students' calendars – give the students another teacher or cancel those classes (the Alerts page lists them)." : ""}`
        : "They'll be able to sign in again.",
      danger: u.active,
      confirmLabel: u.active ? "Deactivate" : "Activate",
      onConfirm: async () => {
        const r = await api.post(`/admin/users/${u.id}/status`, { active: !u.active });
        ui.toast(u.active ? (r.upcomingClasses ? `Account deactivated – ${r.upcomingClasses} upcoming class${r.upcomingClasses === 1 ? "" : "es"} still need another teacher` : "Account deactivated") : "Account activated");
        reload(true);
      },
    });
  const remove = (purge) =>
    ui.confirm({
      title: purge ? "Permanently delete now?" : `Delete ${u.name}?`,
      message: `${purge ? "Their sign-in and personal details are removed immediately. This can't be undone." : "The account is disabled now and personal details are removed automatically after the retention period. You can restore it until then."} ${u.role === "teacher" ? "Their upcoming classes are cancelled and the students are told." : u.role === "student" ? "They're taken out of upcoming classes and the timetable, and their open sessions are archived." : ""}`,
      danger: true,
      confirmLabel: purge ? "Delete permanently" : "Delete",
      onConfirm: async () => {
        const r = await api.del(`/admin/users/${u.id}${purge ? "?purge=1" : ""}`);
        const c = r?.cleanup;
        ui.toast(c && (c.classesCancelled || c.classesUpdated || c.sessionsArchived) ? `Deleted – ${[c.classesCancelled && `${c.classesCancelled} class(es) cancelled`, c.classesUpdated && `${c.classesUpdated} class(es) updated`, c.sessionsArchived && `${c.sessionsArchived} session(s) archived`].filter(Boolean).join(", ")}` : "Deleted");
        if (purge) navigate(back);
        else reload(true);
      },
    });

  return (
    <>
      <PageHeader
        back={
          <Link to={back} className="mb-2 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-navy">
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
        }
        title={u.name}
        subtitle={u.role === "student" ? [u.studentCode && `ID ${u.studentCode}`, u.grade, u.board].filter(Boolean).join(" · ") : u.role === "teacher" ? (u.subjects || []).join(", ") : u.superAdmin ? "Super admin" : "Admin"}
        actions={
          !u.deletedAt && (
            <>
              <Button variant="outline" icon={Pencil} onClick={() => setEditing(true)}>Edit</Button>
              {u.role === "student" && (
                <Button
                  variant="outline"
                  icon={UserCheck}
                  onClick={() => {
                    setRows(rowsOf(u).map((r) => ({ subject: r.subject || "", teacherId: r.teacherId || null })));
                    setAssign(true);
                  }}
                >
                  {teacherIdsOf(u).length ? "Change teachers" : "Assign teachers"}
                </Button>
              )}
            </>
          )
        }
      />

      {u.deletedAt && (
        <Notice tone="danger" className="mb-6">
          Deleted {fmtDate(u.deletedAt)}. Personal data is removed automatically after the retention period.{" "}
          <button className="font-semibold underline" onClick={() => act(() => api.post(`/admin/users/${u.id}/restore`), "Account restored")}>
            Restore account
          </button>
        </Notice>
      )}
      {locked && (
        <Notice tone="warn" className="mb-6">
          Locked after too many failed sign-in attempts until {fmtDateTime(u.lockedUntil)}.{" "}
          <button className="font-semibold underline" onClick={() => act(() => api.post(`/admin/users/${u.id}/unlock`), "Unlocked")}>
            Unlock now
          </button>
        </Notice>
      )}

      {u.role === "student" && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon={UserCheck}
            label="Subjects & teachers"
            value={
              <span className="block space-y-0.5 text-sm font-medium">
                {(u.teachers || []).length ? (
                  u.teachers.map((t, i) => (
                    <span key={i} className="block">
                      {t.subject && <span className="text-muted">{t.subject} · </span>}
                      {t.name ? fmtName(t.name) : <span className="text-amber-700">No teacher yet</span>}
                    </span>
                  ))
                ) : (
                  <span className="text-lg">Unassigned</span>
                )}
              </span>
            }
          />
          <StatCard icon={CalendarDays} label="Upcoming classes" value={u.upcomingClasses} tone="blue" />
          <StatCard icon={CheckCircle2} label="Classes (all time)" value={u.totalClasses} tone="green" />
          <StatCard icon={ClipboardCheck} label="Attendance" value={u.attendance?.percent === null || u.attendance?.percent === undefined ? "—" : `${u.attendance.percent}%`} hint={u.attendance ? `${u.attendance.attended}/${u.attendance.conducted} classes · ${u.attendance.uninformed} uninformed` : ""} tone="violet" />
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardTitle title="Account" />
            <dl className="grid gap-4 sm:grid-cols-2">
              <Info label="Status" value={u.deletedAt ? <Badge tone="red">Deleted</Badge> : u.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>} />
              <Info label="Role" value={u.superAdmin ? "Super admin" : u.role} />
              <Info label="Created" value={fmtDate(u.createdAt)} />
              <Info label="Last sign-in" value={u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : "Never"} />
            </dl>
            {u.contact ? (
              <>
                <h3 className="mb-3 mt-6 text-sm font-bold text-navy">Contact details</h3>
                <dl className="grid gap-4 sm:grid-cols-2">
                  <Info label="Email (sign-in)" value={u.contact.email} />
                  <Info label="Phone" value={u.contact.phone} />
                  {u.role === "student" && <Info label="Parent / guardian" value={u.contact.parentName} />}
                  {u.role === "student" && <Info label="Parent phone" value={u.contact.parentPhone} />}
                </dl>
              </>
            ) : (
              <Notice icon={Lock} className="mt-6">Contact details are hidden for your admin account.</Notice>
            )}
          </Card>
          {u.role === "teacher" && (
            <Card>
              <CardTitle icon={GraduationCap} title={`Students (${u.students.length})`} />
              {u.students.length ? (
                <ul className="space-y-1">
                  {u.students.map((s) => (
                    <li key={s.id}>
                      <Link to={`/portal/admin/users/${s.id}`} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface">
                        <Avatar name={s.name} size="sm" />
                        <span className="min-w-0 flex-1 text-sm font-semibold text-navy">{s.name}</span>
                        <span className="text-xs text-muted">{[(s.subjects || []).join(", "), s.grade, s.board].filter(Boolean).join(" · ")}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">No students assigned.</p>
              )}
            </Card>
          )}
        </div>
        <div className="space-y-6">
          {!u.deletedAt && !self && (
            <Card>
              <CardTitle icon={ShieldCheck} title="Access & credentials" />
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" icon={KeyRound} onClick={resetPw}>Reset password</Button>
                {locked && <Button variant="outline" icon={Unlock} onClick={() => act(() => api.post(`/admin/users/${u.id}/unlock`), "Unlocked")}>Unlock</Button>}
                <Button variant={u.active ? "danger-outline" : "success"} icon={u.active ? UserMinus : UserCheck} onClick={toggleActive}>
                  {u.active ? "Deactivate" : "Activate"}
                </Button>
                <Button variant="danger-outline" icon={Trash2} onClick={() => remove(false)}>Delete</Button>
                {me.superAdmin && <Button variant="ghost" className="text-rose-600" icon={Trash2} onClick={() => remove(true)}>Delete permanently</Button>}
              </div>
            </Card>
          )}
          {u.deletedAt && me.superAdmin && (
            <Card>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" icon={RotateCcw} onClick={() => act(() => api.post(`/admin/users/${u.id}/restore`), "Restored")}>Restore</Button>
                <Button variant="danger-outline" icon={Trash2} onClick={() => remove(true)}>Delete permanently now</Button>
              </div>
            </Card>
          )}
          <Card>
            <CardTitle title="Sign-in history" subtitle="Last 15 attempts" />
            <Table bleed
              dense
              rows={data.logins}
              empty={<p className="text-sm text-muted">No sign-ins yet.</p>}
              columns={[
                { key: "at", label: "When", render: (l) => fmtDateTime(l.at) },
                { key: "success", label: "Result", render: (l) => (l.success ? <Badge tone="green">Success</Badge> : <Badge tone="red">{l.reason === "locked" ? "Locked" : "Failed"}</Badge>) },
                { key: "ip", label: "IP", render: (l) => <span className="font-mono text-xs">{l.ip || "—"}</span> },
              ]}
            />
          </Card>
        </div>
      </div>

      <UserFormDialog open={editing} onClose={() => setEditing(false)} role={u.role} user={u} teachers={dir.data?.teachers || []} onSaved={() => reload(true)} />
      <CredentialsDialog creds={creds} onClose={() => setCreds(null)} />
      <Dialog
        open={assign}
        onClose={() => setAssign(false)}
        title="Subjects & teachers"
        subtitle={`${u.name} – one teacher per subject`}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setAssign(false)}>Cancel</Button>
            <Button
              onClick={() =>
                act(async () => {
                  const clean = cleanRows(rows);
                  if (new Set(clean.map((r) => r.subject.toLowerCase())).size !== clean.length) throw new Error("Each subject can only be listed once");
                  const r = await api.post(`/admin/users/${u.id}/assign`, { subjectTeachers: clean });
                  setAssign(false);
                  const m = r.moved || {};
                  const parts = [m.sessionsMoved && `${m.sessionsMoved} session(s) moved to the new teacher`, m.sessionsSplit && `${m.sessionsSplit} session(s) continued with the new teacher`, (m.classesUpdated || m.classesCancelled) && `${m.classesUpdated + m.classesCancelled} upcoming class(es) with the old teacher updated`].filter(Boolean);
                  ui.toast(`Teachers updated${parts.length ? ` – ${parts.join(", ")}` : ""}. Everyone affected was notified.`);
                })
              }
            >
              Save
            </Button>
          </>
        }
      >
        <SubjectTeachersEditor rows={rows} onChange={setRows} teachers={dir.data?.teachers || []} />
        <p className="mt-3 text-xs text-muted">When a subject gets a new teacher, the student leaves the old teacher's upcoming classes for that subject, and the open session moves to the new teacher. If some of its classes were already held, the old teacher's part is closed (so they're paid for it) and a new session with the remaining classes starts with the new teacher – the fee already paid carries over. Schedule the new teacher's classes afterwards.</p>
      </Dialog>
    </>
  );
}

function Info({ label, value }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 break-words text-[15px] capitalize-first text-ink">{value || "—"}</dd>
    </div>
  );
}

// ---- Admins & permissions (super admin) -----------------------------------------------------
export function AdminAdminsPage() {
  const ui = useUi();
  const navigate = useNavigate();
  const { user: me } = useAuth();
  const { data, loading, error, reload } = useAsync(() => api.get("/admin/permissions"), []);
  const [edit, setEdit] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [adding, setAdding] = useState(false);
  const save = async () => {
    try {
      await api.patch(`/admin/users/${edit.id}/permissions`, { superAdmin: edit.superAdmin, permissions: edit.permissions });
      ui.toast("Permissions updated");
      setEdit(null);
      reload(true);
    } catch (e) {
      ui.error(e);
    }
  };
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const keys = Object.keys(data.catalog);
  const PREVIEW = 3; // the table shows a few; the full list opens on click
  const granted = (a) => keys.filter((k) => a.permissions[k]);
  const label = (k) => data.catalog[k] || k;
  return (
    <>
      <PageHeader title="Admins & access" subtitle="Give each admin only the permissions they need. Only super admins can change this." actions={<Button icon={Plus} onClick={() => setAdding(true)}>Add admin</Button>} />
      <Card flush>
        <Table
          rows={data.admins}
          onRowClick={(a) => setViewing(a)}
          columns={[
            { key: "name", label: "Admin", render: (a) => <span className="flex items-center gap-3"><Avatar name={a.name} size="sm" /><span className="whitespace-nowrap font-semibold text-navy">{fmtName(a.name)}</span>{a.id === me.id && <Badge>You</Badge>}</span> },
            { key: "role", label: "Access", className: "whitespace-nowrap", render: (a) => (a.superAdmin ? <Badge tone="gold">Super admin</Badge> : <span className="text-sm text-muted">{granted(a).length} of {plural(keys.length, "permission")}</span>) },
            {
              key: "perms",
              label: "Permissions",
              render: (a) => {
                if (a.superAdmin) return <span className="text-sm text-muted">All permissions</span>;
                const g = granted(a);
                if (!g.length) return <span className="text-sm text-slate-400">None</span>;
                return (
                  <span className="flex flex-wrap items-center gap-1">
                    {g.slice(0, PREVIEW).map((k) => <Badge key={k}>{k}</Badge>)}
                    {g.length > PREVIEW && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); setViewing(a); }} className="rounded-md px-1.5 py-0.5 text-xs font-semibold text-navy hover:bg-slate-100">
                        +{g.length - PREVIEW} more
                      </button>
                    )}
                  </span>
                );
              },
            },
            { key: "status", label: "Status", render: (a) => (a.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>) },
            { key: "edit", label: "", render: (a) => <Button size="xs" variant="outline" onClick={(e) => { e.stopPropagation(); setEdit({ ...a, permissions: { ...a.permissions } }); }}>Edit access</Button> },
          ]}
        />
      </Card>
      <Dialog
        open={!!edit}
        onClose={() => setEdit(null)}
        title="Edit access"
        subtitle={edit?.name}
        footer={
          <>
            <Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button>
            <Button onClick={save}>Save</Button>
          </>
        }
      >
        {edit && (
          <div className="space-y-4">
            <Toggle label="Super admin" description="Full access to everything" checked={edit.superAdmin} onChange={(v) => setEdit({ ...edit, superAdmin: v })} disabled={edit.id === me.id} />
            {!edit.superAdmin && (
              <div className="space-y-3 border-t border-line pt-4">
                {Object.entries(data.catalog).map(([k, label]) => (
                  <Checkbox key={k} className="flex" checked={!!edit.permissions[k]} onChange={(v) => setEdit({ ...edit, permissions: { ...edit.permissions, [k]: v } })} label={label} />
                ))}
              </div>
            )}
          </div>
        )}
      </Dialog>
      {/* Full access details (opened from a row or "+N more") */}
      <Dialog
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing ? fmtName(viewing.name) : ""}
        subtitle={viewing ? (viewing.superAdmin ? "Super admin · full access" : `${granted(viewing).length} of ${plural(keys.length, "permission")}`) : ""}
        footer={
          viewing && (
            <>
              <Button variant="outline" onClick={() => navigate(`/portal/admin/users/${viewing.id}`)}>Open profile</Button>
              <Button onClick={() => { setEdit({ ...viewing, permissions: { ...viewing.permissions } }); setViewing(null); }}>Edit access</Button>
            </>
          )
        }
      >
        {viewing && (
          <ul className="grid gap-2 sm:grid-cols-2">
            {keys.map((k) => {
              const on = viewing.superAdmin || !!viewing.permissions[k];
              return (
                <li key={k} className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm ${on ? "bg-emerald-50 text-emerald-800" : "bg-slate-50 text-slate-400"}`}>
                  {on ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <Lock className="h-4 w-4 shrink-0" />}
                  {label(k)}
                </li>
              );
            })}
          </ul>
        )}
      </Dialog>
      <UserFormDialog open={adding} onClose={() => setAdding(false)} role="admin" catalog={data.catalog} onSaved={() => reload(true)} />
    </>
  );
}
