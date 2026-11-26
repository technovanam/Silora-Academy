// ============================================================
// DEMO CLASSES
//  • GuestJoin   /portal/demo/:token – a visitor types a name and joins
//                (temporary sign-in for that one class, no account)
//  • GuestDone   /portal/demo-done  – after the class: thanks + sign out
//  • AdminDemos  /portal/admin/demos – requests from the website, schedule,
//                guest link, status, notes, convert to student
//  • TeacherDemos /portal/teacher/demos – first name / grade / board only,
//                open the class, feedback
// Demo classes are never recorded and take no attendance.
// ============================================================
import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { CalendarClock, CheckCircle2, Copy, Download, ExternalLink, Info, Mail, MessageSquareText, Presentation, RefreshCw, UserPlus, Video } from "lucide-react";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import { SubjectSelect } from "../lib/subjects.jsx";
import { fmtDateTime, fromNow } from "../lib/format.js";
import { Badge, Button, Card, CardTitle, Dialog, Empty, ErrorBox, Field, Input, Loading, Notice, PageHeader, SearchInput, Segmented, Select, Table, Textarea, useAsync, useUi } from "../ui/index.jsx";
import { UserFormDialog } from "./admin/AdminUsers.jsx";

export const DEMO_STATUS = {
  new: { tone: "blue", label: "New" },
  scheduled: { tone: "amber", label: "Scheduled" },
  completed: { tone: "green", label: "Completed" },
  no_show: { tone: "red", label: "No-show" },
  cancelled: { tone: "gray", label: "Cancelled" },
  converted: { tone: "violet", label: "Converted" },
};
const DemoBadge = ({ status }) => <Badge tone={DEMO_STATUS[status]?.tone}>{DEMO_STATUS[status]?.label || status}</Badge>;
const toLocalInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

// ---- Guest: join from the link ---------------------------------------------------------
export function GuestJoin() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { user, guestLogin, logout } = useAuth();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [joinError, setJoinError] = useState(null);

  const load = () =>
    api
      .get(`/guest/${encodeURIComponent(token)}`)
      .then((r) => {
        setInfo(r.demo);
        setName((n) => n || r.demo.guestName || "");
        setError(null);
      })
      .catch(setError);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000); // the link opens 15 minutes before the class
    return () => clearInterval(t);
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const join = async (e) => {
    e.preventDefault();
    setBusy(true);
    setJoinError(null);
    try {
      const r = await api.post(`/guest/${encodeURIComponent(token)}/join`, { name });
      if (user && user.role !== "guest") await logout("switched");
      await guestLogin(r.customToken);
      navigate(`/portal/class/${r.meetingId}`, { replace: true });
    } catch (err) {
      setJoinError(err.message);
      load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-svh items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md">
        <p className="mb-5 text-center text-lg font-bold tracking-tight text-navy">Silora Academy</p>
        <Card>
          {error ? (
            <Empty icon={Presentation} title="This link can't be used" text={error.message} className="py-6" />
          ) : !info ? (
            <Loading className="py-12" />
          ) : (
            <>
              <CardTitle icon={Presentation} title={`${info.subject} demo class`} subtitle={`With ${info.teacherName} · ${fmtDateTime(info.startAt)} · ${info.durationMin} min`} />
              {info.state === "finished" ? (
                <Notice tone="info">This demo class has finished. Thank you for your interest in Silora Academy.</Notice>
              ) : (
                <form onSubmit={join} className="space-y-4">
                  {info.state === "too_early" && <Notice tone="info">The class opens at {fmtDateTime(info.opensAt)} (15 minutes before it starts). Keep this page open – it updates by itself.</Notice>}
                  {user && user.role !== "guest" && <Notice tone="warn">You're signed in to the portal as {user.name}. Joining as a guest signs you out on this browser.</Notice>}
                  <Field label="Your name" hint="Shown to the teacher. No account or app is needed.">
                    <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoFocus placeholder="e.g. Ravi" />
                  </Field>
                  {joinError && <Notice tone="danger">{joinError}</Notice>}
                  <Button type="submit" icon={Video} loading={busy} disabled={info.state !== "open" || name.trim().length < 2} className="w-full">
                    Join the demo class
                  </Button>
                  <p className="flex items-start gap-2 text-xs text-muted">
                    <Info className="mt-0.5 h-4 w-4 shrink-0" />
                    The teacher lets you in from the waiting room. Demo classes are not recorded.
                  </p>
                </form>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

export function GuestDone() {
  const { user, logout } = useAuth();
  useEffect(() => {
    if (user?.role === "guest") logout("demo_done");
  }, [user, logout]);
  return (
    <div className="flex min-h-svh items-center justify-center bg-slate-50 px-4">
      <Card className="w-full max-w-md text-center">
        <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-500" />
        <p className="text-lg font-semibold text-navy">Thank you for attending your demo class</p>
        <p className="mt-2 text-sm text-muted">Our team will contact you about the next steps. You can close this page.</p>
        <a href="/" className="mt-5 inline-block text-sm font-semibold text-navy underline">
          Visit Silora Academy
        </a>
      </Card>
    </div>
  );
}

// ---- Admin -----------------------------------------------------------------------------
export function AdminDemos() {
  const ui = useUi();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");
  const { data, loading, error, reload } = useAsync(() => api.get("/admin/demos"), []);
  const rows = useMemo(
    () => (data?.demos || []).filter((d) => (status === "all" || d.status === status) && (!q || [d.name, d.email, d.phone, d.city, d.grade, d.board].join(" ").toLowerCase().includes(q.toLowerCase()))),
    [data, status, q]
  );
  const open = params.get("d");
  return (
    <>
      <PageHeader title="Demo requests" subtitle="Requests from the website's “Book a demo” form. Schedule a teacher and send the guest link – no account is needed for a demo." actions={<Button variant="outline" icon={Download} onClick={() => api.download("/admin/demos", { format: "csv" }).catch(ui.error)}>Export CSV</Button>} />
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? (
        <Loading />
      ) : (
        data && (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <Segmented value={status} onChange={setStatus} options={[{ value: "all", label: "All" }, ...Object.entries(DEMO_STATUS).map(([value, s]) => ({ value, label: s.label, count: data.counts[value] || undefined }))]} />
              <SearchInput value={q} onChange={setQ} placeholder="Search name, phone, city…" className="w-full sm:w-64" />
            </div>
            <Card flush>
              <Table
                pageSize={25}
                rows={rows}
                onRowClick={(d) => setParams({ d: d.id })}
                empty={<Empty icon={Presentation} title="No demo requests" text="Requests from the website appear here." />}
                columns={[
                  { key: "createdAt", label: "Requested", render: (d) => <span className="whitespace-nowrap text-sm">{fromNow(d.createdAt)}{d.resubmitCount > 0 && <span className="block text-[11px] text-amber-700">asked again ×{d.resubmitCount}</span>}</span> },
                  { key: "name", label: "Student", render: (d) => <span><b className="text-navy">{d.name}</b><span className="block text-xs text-muted">{[d.grade, d.board].filter(Boolean).join(" · ")}</span></span> },
                  { key: "phone", label: "Contact", render: (d) => <span className="text-sm">{d.phone}<span className="block text-xs text-muted">{d.email}</span></span> },
                  { key: "city", label: "Location", render: (d) => [d.city, d.state].filter(Boolean).join(", ") },
                  { key: "status", label: "Status", render: (d) => <DemoBadge status={d.status} /> },
                  { key: "startAt", label: "Demo", render: (d) => (d.startAt && d.status !== "new" ? <span className="whitespace-nowrap text-sm">{fmtDateTime(d.startAt)}<span className="block text-xs text-muted">{d.teacherName} · {d.subject}</span></span> : "—") },
                ]}
              />
            </Card>
          </>
        )
      )}
      {open && <DemoDialog id={open} onClose={() => setParams({})} onChanged={() => reload(true)} />}
    </>
  );
}

function DemoDialog({ id, onClose, onChanged }) {
  const ui = useUi();
  const { data, loading, error, reload } = useAsync(() => api.get(`/admin/demos/${id}`), [id]);
  const dir = useAsync(() => api.get("/admin/directory"), []);
  const [f, setF] = useState(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(null);
  const [converting, setConverting] = useState(false);
  const d = data?.demo;

  useEffect(() => {
    if (!d) return;
    setF({ teacherId: d.teacherId, subject: d.subject || "", startAt: toLocalInput(d.startAt), durationMin: d.durationMin || 30 });
    setNotes(d.notes);
  }, [d]);

  const changed = () => {
    reload(true);
    onChanged();
  };
  const run = async (key, fn, msg) => {
    setBusy(key);
    try {
      const r = await fn();
      if (msg) ui.toast(typeof msg === "function" ? msg(r) : msg);
      changed();
      return r;
    } catch (e) {
      ui.error(e);
    } finally {
      setBusy(null);
    }
  };
  const schedule = (e) => {
    e.preventDefault();
    run("schedule", () => api.post(`/admin/demos/${id}/schedule`, { ...f, startAt: new Date(f.startAt).toISOString() }), d.status === "scheduled" ? "Demo rescheduled – the teacher was notified" : "Demo scheduled – send the guest link");
  };
  const setStatus = (status, confirm) => {
    const go = () => run(status, () => api.patch(`/admin/demos/${id}`, { status }), `Marked ${DEMO_STATUS[status].label.toLowerCase()}`);
    if (!confirm) return go();
    ui.confirm({ ...confirm, danger: true, onConfirm: () => api.patch(`/admin/demos/${id}`, { status }) }).then((ok) => ok && (ui.toast("Demo cancelled"), changed()));
  };
  const copy = (text) =>
    navigator.clipboard
      ?.writeText(text)
      .then(() => ui.toast("Link copied"))
      .catch(() => {});

  const teachers = (dir.data?.teachers || []).filter((t) => t.active);
  const open = ["new", "scheduled"].includes(d?.status);

  return (
    <Dialog open onClose={onClose} size="xl" title={d ? d.name : "Demo request"} subtitle={d ? `Requested ${fmtDateTime(d.createdAt)}` : ""}>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <DemoBadge status={d.status} />
            {d.resubmitCount > 0 && <Badge tone="amber">Asked again ×{d.resubmitCount}</Badge>}
            <span className="ml-auto flex flex-wrap gap-2">
              {d.status === "scheduled" && (
                <>
                  <Button size="sm" variant="outline" loading={busy === "completed"} onClick={() => setStatus("completed")}>Completed</Button>
                  <Button size="sm" variant="outline" loading={busy === "no_show"} onClick={() => setStatus("no_show")}>No-show</Button>
                </>
              )}
              {open && <Button size="sm" variant="ghost" onClick={() => setStatus("cancelled", { title: "Cancel this demo?", message: "The demo class is cancelled and the guest link stops working.", confirmLabel: "Cancel demo" })}>Cancel demo</Button>}
              {["completed", "no_show", "cancelled"].includes(d.status) && <Button size="sm" variant="ghost" loading={busy === "new"} onClick={() => setStatus("new")}>Reopen</Button>}
              {d.status !== "converted" && <Button size="sm" icon={UserPlus} onClick={() => setConverting(true)}>Convert to student</Button>}
            </span>
          </div>

          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            {[
              ["Phone", d.phone],
              ["Email", d.email],
              ["Grade · Board", [d.grade, d.board].filter(Boolean).join(" · ")],
              ["Location", [d.city, d.state, d.country].filter(Boolean).join(", ")],
              ["Guest joined as", d.guestName ? `${d.guestName}${d.guestJoinedAt ? ` · ${fmtDateTime(d.guestJoinedAt)}` : ""}` : "—"],
              ["Class held", d.heldAt ? fmtDateTime(d.heldAt) : "—"],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs font-medium text-muted">{k}</dt>
                <dd className="mt-0.5 break-words text-ink">{v || "—"}</dd>
              </div>
            ))}
          </dl>

          {open && f && (
            <Card>
              <CardTitle icon={CalendarClock} title={d.status === "scheduled" ? "Reschedule" : "Schedule the demo"} subtitle="The teacher sees only the first name, grade and board." />
              <form onSubmit={schedule} className="grid gap-4 sm:grid-cols-2">
                <Field label="Teacher" required>
                  <Select value={f.teacherId} onChange={(v) => setF({ ...f, teacherId: v })} searchable options={teachers.map((t) => ({ value: t.id, label: t.name, hint: t.subjects?.join(", ") }))} placeholder="Choose a teacher" />
                </Field>
                <Field label="Subject" required>
                  <SubjectSelect value={f.subject} onChange={(v) => setF({ ...f, subject: v })} />
                </Field>
                <Field label="Date and time" required>
                  <Input type="datetime-local" value={f.startAt} onChange={(e) => setF({ ...f, startAt: e.target.value })} required />
                </Field>
                <Field label="Length">
                  <Select value={f.durationMin} onChange={(v) => setF({ ...f, durationMin: v })} options={[20, 30, 45, 60].map((n) => ({ value: n, label: `${n} minutes` }))} />
                </Field>
                <div className="sm:col-span-2">
                  <Button type="submit" icon={CalendarClock} loading={busy === "schedule"} disabled={!f.teacherId || !f.subject.trim() || !f.startAt}>
                    {d.status === "scheduled" ? "Save new time" : "Schedule"}
                  </Button>
                </div>
              </form>
            </Card>
          )}

          {d.status === "scheduled" && d.link && (
            <Card>
              <CardTitle icon={Video} title="Guest link" subtitle={`${d.teacherName} · ${d.subject} · ${fmtDateTime(d.startAt)}`} />
              <div className="flex flex-wrap items-center gap-2">
                <Input readOnly value={d.link} className="min-w-0 flex-1" onFocus={(e) => e.target.select()} />
                <Button variant="outline" icon={Copy} onClick={() => copy(d.link)}>Copy</Button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" icon={Mail} loading={busy === "email"} disabled={!d.email} onClick={() => run("email", () => api.post(`/admin/demos/${id}/link`, { email: true }), (r) => (r.email?.status === "sent" ? `Link emailed to ${d.email}` : "Email isn't set up – copy the link instead"))}>
                  Email to {d.email || "parent"}
                </Button>
                <Button size="sm" variant="ghost" icon={RefreshCw} loading={busy === "renew"} onClick={() => run("renew", () => api.post(`/admin/demos/${id}/link`, { regenerate: true }), "New link made – the old one no longer works")}>
                  New link
                </Button>
                <Link to={`/portal/class/${d.meetingId}`} className="inline-flex items-center gap-1.5 px-2 text-sm font-medium text-navy hover:underline">
                  <ExternalLink className="h-4 w-4" />
                  Open the class
                </Link>
              </div>
              <p className="mt-3 text-xs text-muted">
                The link works from 15 minutes before until an hour after the class. The guest types a name and waits until the teacher lets them in. Demo classes are never recorded.
                {d.linkEmailedAt ? ` Last emailed ${fmtDateTime(d.linkEmailedAt)}.` : ""}
              </p>
            </Card>
          )}

          {d.feedback && (
            <Card>
              <CardTitle icon={MessageSquareText} title="Teacher feedback" subtitle={`${d.feedback.byName} · ${fmtDateTime(d.feedback.at)}`} />
              {d.feedback.level && <p className="mb-1 text-sm font-medium text-navy">{d.feedback.level}</p>}
              <p className="whitespace-pre-wrap text-sm text-slate-700">{d.feedback.text}</p>
            </Card>
          )}

          <Field label="Notes (admins only)">
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
          </Field>
          <Button size="sm" variant="outline" loading={busy === "notes"} disabled={notes === d.notes} onClick={() => run("notes", () => api.patch(`/admin/demos/${id}`, { notes }), "Notes saved")}>
            Save notes
          </Button>

          <details className="text-sm">
            <summary className="cursor-pointer font-semibold text-navy">History</summary>
            <ul className="mt-2 space-y-1 text-muted">
              {data.history.map((h, i) => (
                <li key={i}>
                  {fmtDateTime(h.at)} – {h.byName ? `${h.byName}: ` : ""}
                  {h.action.replace(/_/g, " ")}
                  {h.teacherName ? ` with ${h.teacherName}` : ""}
                  {h.startAt ? ` for ${fmtDateTime(h.startAt)}` : ""}
                  {h.guestName ? ` (${h.guestName})` : ""}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
      {d && (
        <UserFormDialog
          open={converting}
          onClose={() => setConverting(false)}
          role="student"
          teachers={dir.data?.teachers || []}
          prefill={{ name: d.name, email: d.email, phone: d.phone, grade: d.grade, board: d.board, address: [d.city, d.state, d.country].filter(Boolean).join(", "), rows: d.teacherId ? [{ subject: d.subject || "", teacherId: d.teacherId }] : [] }}
          onSaved={(studentId) => studentId && run("convert", () => api.post(`/admin/demos/${id}/converted`, { studentId }), "Demo request marked as converted")}
        />
      )}
    </Dialog>
  );
}

// ---- Teacher ---------------------------------------------------------------------------
export function TeacherDemos() {
  const { data, loading, error, reload } = useAsync(() => api.get("/teacher/demos"), []);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <>
      <PageHeader title="Demo classes" subtitle="Trial classes for new students. The guest waits in the waiting room – let them in. Demo classes are not recorded and need no attendance form." />
      {!data.demos.length && <Empty icon={Presentation} title="No demo classes yet" text="The academy will let you know when one is booked with you." />}
      <div className="space-y-4">
        {data.demos.map((d) => (
          <TeacherDemoCard key={d.id} d={d} onSaved={() => reload(true)} />
        ))}
      </div>
    </>
  );
}

function TeacherDemoCard({ d, onSaved }) {
  const ui = useUi();
  const navigate = useNavigate();
  const [text, setText] = useState(d.feedback?.text || "");
  const [level, setLevel] = useState(d.feedback?.level || "");
  const [busy, setBusy] = useState(false);
  const started = !!d.heldAt || new Date(d.startAt) <= new Date();
  const upcoming = d.status === "scheduled" && new Date(d.endAt).getTime() + 3600000 > Date.now();
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/teacher/demos/${d.id}/feedback`, { text, level });
      ui.toast("Feedback sent to the academy");
      onSaved();
    } catch (err) {
      ui.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardTitle
        icon={Presentation}
        title={`${d.subject} demo – ${d.firstName}`}
        subtitle={`${[d.grade, d.board].filter(Boolean).join(" · ")} · ${fmtDateTime(d.startAt)} · ${d.durationMin} min`}
        action={<DemoBadge status={d.status} />}
      />
      {upcoming && (
        <Button icon={Video} onClick={() => navigate(`/portal/class/${d.meetingId}`)} className="mb-4">
          Open the class
        </Button>
      )}
      {d.guestName && <p className="mb-3 text-sm text-muted">Guest joined as “{d.guestName}”.</p>}
      {started &&
        (d.feedback && !busy && text === d.feedback.text && level === (d.feedback.level || "") ? (
          <div className="rounded-xl bg-slate-50 p-3 text-sm">
            <p className="mb-1 text-xs font-semibold text-muted">Your feedback · {fmtDateTime(d.feedback.at)}</p>
            {d.feedback.level && <p className="font-medium text-navy">{d.feedback.level}</p>}
            <p className="whitespace-pre-wrap text-slate-700">{d.feedback.text}</p>
          </div>
        ) : (
          <form onSubmit={save} className="space-y-3">
            <Field label="Level (optional)">
              <Input value={level} onChange={(e) => setLevel(e.target.value)} maxLength={40} placeholder="e.g. Strong in algebra, needs practice in geometry" />
            </Field>
            <Field label="Feedback for the academy" required>
              <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} required />
            </Field>
            <Button type="submit" size="sm" loading={busy} disabled={!text.trim()}>
              Send feedback
            </Button>
          </form>
        ))}
    </Card>
  );
}
