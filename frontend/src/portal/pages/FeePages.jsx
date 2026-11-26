// ============================================================
// SESSIONS & FEE PROOF – a session is one subject of one student, so every
// fee is for one subject and the subject is named everywhere
// The portal never takes a payment: students pay the academy outside the
// portal and upload a screenshot / receipt here; admins verify it.
//  • StudentFees      /portal/student/fees
//  • FeeReminder      pop-up / banner in the layout while proof is missing
//  • AdminSessions    /portal/admin/sessions
//  • AdminFees        /portal/admin/fees
// ============================================================
import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { AlertTriangle, BookOpen, CalendarRange, CheckCircle2, Clock, Download, FileText, Image as ImageIcon, Info, LogOut, MessagesSquare, Pencil, Plus, Receipt, Settings2, Trash2, Upload, User, XCircle } from "lucide-react";
import { api } from "../lib/api.js";
import { SubjectSelect } from "../lib/subjects.jsx";
import { fmtDate, fmtDateTime, fmtSize, fromNow, plural } from "../lib/format.js";
import { Badge, Button, Card, CardTitle, Checkbox, Dialog, Empty, ErrorBox, Field, IconButton, Input, Loading, Notice, PageHeader, Progress, SearchInput, Segmented, Select, StatCard, Table, Textarea, Toggle, cx, useAsync, useUi } from "../ui/index.jsx";

export const FEE_STATUS = {
  pending: { tone: "amber", label: "Payment details needed" },
  not_submitted: { tone: "gray", label: "Not submitted" },
  submitted: { tone: "blue", label: "Submitted – awaiting verification" },
  verified: { tone: "green", label: "Received / verified" },
  rejected: { tone: "red", label: "Rejected" },
};
const FeeBadge = ({ status }) => <Badge tone={FEE_STATUS[status]?.tone || "gray"}>{FEE_STATUS[status]?.label || status}</Badge>;
const SESSION_STATUS = { draft: ["gray", "Draft"], active: ["green", "Active"], completed: ["blue", "Completed"], archived: ["gray", "Archived"] };
const range = (s) => `${fmtDate(`${s.startDate}T12:00:00`)} – ${fmtDate(`${s.endDate}T12:00:00`)}`;
const NOT_A_PAYMENT = "This doesn't make a payment. Pay the academy the usual way (GPay, bank transfer…), then send your screenshot or receipt here so the academy can confirm it.";

// ---- Fee state for the layout (students) ------------------------------------------
// Fees are per subject: only the subjects still waiting for proof are locked.
// `fullyLocked` = nothing is left to use (every subject waits, or an older batch session).
export function useFeeStatus(user) {
  const isStudent = user?.role === "student";
  const [state, setState] = useState(null);
  const { pathname } = useLocation();
  useEffect(() => {
    if (!isStudent) return;
    let alive = true;
    const load = () => api.get("/fees/me").then((r) => alive && setState(r)).catch(() => {});
    load();
    window.addEventListener("portal:fees-changed", load);
    window.addEventListener("portal:fee-pending", load);
    return () => {
      alive = false;
      window.removeEventListener("portal:fees-changed", load);
      window.removeEventListener("portal:fee-pending", load);
    };
  }, [isStudent, pathname]);
  if (!isStudent || !state) return null;
  const mine = [...new Set([...(user.subjectTeachers || []).map((r) => r.subject), ...state.sessions.map((s) => s.session.subject)].filter(Boolean))];
  const locked = state.lockedSubjects || [];
  const fullyLocked = state.restricted && (state.blocking.some((b) => !b.subject) || mine.every((x) => locked.some((l) => l.toLowerCase() === x.toLowerCase())));
  return { ...state, fullyLocked };
}

// Pages that stay open while proof is missing
const OPEN_PATHS = ["/portal/student/fees", "/portal/profile", "/portal/messages", "/portal/notifications", "/portal/announcements"];
export const isLockedPath = (pathname, fee) => {
  if (!fee?.fullyLocked || OPEN_PATHS.some((p) => pathname.startsWith(p))) return false;
  const r = fee.restrictions || {};
  if (pathname.startsWith("/portal/student/materials")) return !!r.materials;
  if (pathname.startsWith("/portal/student/recordings")) return !!r.recordings;
  if (pathname.startsWith("/portal/student/progress")) return !!r.progress;
  return pathname.startsWith("/portal/student");
};

const subjectsLine = (blocking) => {
  const names = blocking.map((b) => b.subject || b.name);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0] || "";
};

function BlockingList({ blocking }) {
  return (
    <ul className="space-y-2">
      {blocking.map((b) => (
        <li key={b.sessionId} className={cx("rounded-xl border p-3", b.rejected ? "border-rose-200 bg-rose-50/60" : "border-amber-200 bg-amber-50/60")}>
          <p className="font-semibold text-navy">{b.subject || b.name}</p>
          <p className="text-xs text-slate-600">{[b.number && `Session ${b.number}`, b.startDate && range(b), b.teacherName].filter(Boolean).join(" · ")}</p>
          {b.rejected && <p className="mt-1 text-xs text-rose-700">Not accepted{b.rejectReason ? `: ${b.rejectReason}` : ""} – please submit again.</p>}
        </li>
      ))}
    </ul>
  );
}

/**
 * Pop-up + banner while proof is missing. Only the unpaid subjects are named and
 * locked; when every subject is locked the pop-up can't be closed on academic pages.
 */
export function FeeReminder({ fee, onLogout }) {
  const { pathname } = useLocation();
  const key = fee?.restricted ? `fee-popup:${fee.blocking.map((b) => b.sessionId + (b.rejected ? "r" : "")).join(",")}` : "";
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(key) === "1");
    } catch {
      setDismissed(false);
    }
  }, [key]);
  if (!fee?.restricted || pathname.startsWith("/portal/student/fees")) return null;
  const rejected = fee.blocking.filter((b) => b.rejected);
  const what = subjectsLine(fee.blocking);
  const blocking = isLockedPath(pathname, fee);
  const dismiss = () => {
    try {
      sessionStorage.setItem(key, "1");
    } catch {
      /* private mode */
    }
    setDismissed(true);
  };
  const banner = (
    <div className="mb-6 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center">
      <p className="flex min-w-0 flex-1 items-start gap-2.5">
        <Receipt className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          {rejected.length ? "Your payment details were not accepted – please submit them again" : "Fee payment details needed"} for <b>{what}</b>.{" "}
          {fee.fullyLocked ? "Your classes open once you submit them." : `${what} classes${fee.restrictions?.materials ? ", materials" : ""}${fee.restrictions?.recordings ? " and recordings" : ""} open once you submit them – your other subjects work as usual.`}
        </span>
      </p>
      <Link to="/portal/student/fees" className="self-end whitespace-nowrap rounded-lg bg-navy px-3.5 py-1.5 font-semibold text-white hover:bg-navy-light sm:self-auto">
        Submit payment details
      </Link>
    </div>
  );
  if (!blocking && (dismissed || OPEN_PATHS.some((p) => pathname.startsWith(p)))) return banner;
  return (
    <>
      {banner}
      <Dialog open onClose={blocking ? () => {} : dismiss} dismissable={!blocking} size="sm" title={rejected.length ? "Please resubmit your payment details" : `Fee due for ${what}`} subtitle={fee.fullyLocked ? "Submit your payment details to open your classes" : "Only these subjects are locked until you submit"}>
        <div className="space-y-4 text-sm leading-relaxed text-slate-600">
          <p>A new session has started. Please pay the academy for {fee.blocking.length > 1 ? "these subjects" : "this subject"} and then submit your payment screenshot or receipt in the portal.</p>
          <BlockingList blocking={fee.blocking} />
          <p className="flex items-start gap-2 rounded-xl bg-surface p-3 text-xs"><Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" /> {NOT_A_PAYMENT}</p>
          <Link to="/portal/student/fees" className="block">
            <Button size="lg" className="w-full" icon={Receipt}>Submit payment details</Button>
          </Link>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 pt-1 text-sm">
            {!blocking && <button type="button" onClick={dismiss} className="font-medium text-slate-500 hover:underline">Later</button>}
            <Link to="/portal/profile" className="inline-flex items-center gap-1.5 font-medium text-navy hover:underline"><User className="h-4 w-4" />My profile</Link>
            <Link to="/portal/messages" className="inline-flex items-center gap-1.5 font-medium text-navy hover:underline"><MessagesSquare className="h-4 w-4" />Messages</Link>
            <button type="button" onClick={() => onLogout()} className="inline-flex items-center gap-1.5 font-medium text-rose-600 hover:underline"><LogOut className="h-4 w-4" />Sign out</button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

function ProofThumb({ s }) {
  const img = s.file.contentType?.startsWith("image/");
  return (
    <a href={s.url} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl border border-line p-2.5 transition hover:border-slate-300">
      {img ? <img src={s.url} alt="Payment proof" className="h-14 w-14 rounded-lg object-cover" /> : <span className="flex h-14 w-14 items-center justify-center rounded-lg bg-rose-50 text-rose-600"><FileText className="h-6 w-6" /></span>}
      <span className="min-w-0 text-sm">
        <span className="block truncate font-medium text-navy">{s.file.fileName}</span>
        <span className="block text-xs text-muted">{fmtDateTime(s.at)} · {fmtSize(s.file.size)}</span>
        {(s.reference || s.paidOn) && <span className="block text-xs text-muted">{[s.paidOn && `Paid ${fmtDate(`${s.paidOn}T12:00:00`)}`, s.reference && `Ref ${s.reference}`].filter(Boolean).join(" · ")}</span>}
      </span>
    </a>
  );
}

// ============================================================================
// STUDENT
// ============================================================================
function SubmitProof({ item, onDone }) {
  const ui = useUi();
  const [file, setFile] = useState(null);
  const [f, setF] = useState({ reference: "", paidOn: "", note: "" });
  const [pct, setPct] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    if (!file) return ui.error(new Error("Attach the payment screenshot or receipt"));
    const fd = new FormData();
    fd.append("file", file);
    Object.entries(f).forEach(([k, v]) => fd.append(k, v));
    setPct(0);
    try {
      await api.upload(`/fees/${item.session.id}/submit`, fd, setPct);
      ui.toast("Payment details submitted – thank you!");
      window.dispatchEvent(new CustomEvent("portal:fees-changed"));
      onDone();
    } catch (err) {
      ui.error(err);
    } finally {
      setPct(null);
    }
  };
  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <Field label="Payment screenshot or receipt" required className="sm:col-span-2" hint="Image or PDF, up to 10 MB">
        <label className={cx("flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed px-4 py-4 text-sm transition", file ? "border-emerald-300 bg-emerald-50/40" : "border-slate-200 hover:border-slate-300")}>
          {file?.type?.startsWith("image/") ? <ImageIcon className="h-5 w-5 text-emerald-600" /> : file ? <FileText className="h-5 w-5 text-emerald-600" /> : <Upload className="h-5 w-5 text-slate-400" />}
          <span className="min-w-0 flex-1 truncate">{file ? `${file.name} · ${fmtSize(file.size)}` : "Choose a file"}</span>
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </label>
      </Field>
      <Field label="Date you paid">
        <Input type="date" value={f.paidOn} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setF({ ...f, paidOn: e.target.value })} />
      </Field>
      <Field label="Transaction / UPI reference (optional)">
        <Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} maxLength={120} placeholder="e.g. 4321 8765 0912" />
      </Field>
      <Field label="Note (optional)" className="sm:col-span-2">
        <Textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={1000} placeholder="e.g. Paid by parent's account" />
      </Field>
      <div className="sm:col-span-2">
        {pct !== null && <Progress value={pct} className="mb-3" />}
        <Button type="submit" size="lg" icon={CheckCircle2} loading={pct !== null}>I have paid – submit payment details</Button>
        <p className="mt-2 text-xs text-muted">{NOT_A_PAYMENT}</p>
      </div>
    </form>
  );
}

// A session stays "current" while it's running or still needs something from the student
const isCurrentFee = (it) => it.needsProof || it.session.status === "active" || it.status !== "verified";

export function StudentFees() {
  const { data, loading, error, reload } = useAsync(() => api.get("/fees/me"), []);
  const [tab, setTab] = useState("current");
  const [subject, setSubject] = useState(null);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const due = data.sessions.filter((it) => it.needsProof);
  const current = data.sessions.filter(isCurrentFee);
  const pastFees = data.sessions.filter((it) => !isCurrentFee(it));
  const subjects = [...new Set(data.sessions.map((it) => it.session.subject).filter(Boolean))].sort();
  const shown = (tab === "current" ? current : pastFees).filter((it) => !subject || it.session.subject === subject);
  return (
    <>
      <PageHeader title="Fees" subtitle="Fees are paid per subject. Pay the academy outside the portal, then submit your payment screenshot or receipt for that subject here." />
      <Notice className="mb-6" icon={Info}>{NOT_A_PAYMENT}</Notice>
      {due.length > 0 && (
        <Notice tone="warn" className="mb-6">
          Payment details needed for <b>{subjectsLine(due.map((it) => ({ subject: it.session.subject, name: it.session.name })))}</b>. Only {due.length > 1 ? "these subjects are" : "this subject is"} locked – once you submit, it opens again and isn't asked again for this session.
        </Notice>
      )}
      {!data.sessions.length && <Empty icon={Receipt} title="No sessions yet" text="When the academy starts a session for one of your subjects, it shows up here." />}
      {data.sessions.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: "current", label: "Current", count: current.length },
              { value: "past", label: "Past sessions", count: pastFees.length },
            ]}
          />
          <div className="flex-1" />
          {subjects.length > 1 && <Select className="w-full sm:w-52" value={subject} onChange={setSubject} options={subjects.map((x) => ({ value: x, label: x }))} placeholder="All subjects" clearable />}
        </div>
      )}
      {data.sessions.length > 0 && !shown.length && (
        <Card><Empty icon={Receipt} title={tab === "current" ? "Nothing current" : "No past sessions"} text={subject ? `Nothing for ${subject} here.` : tab === "current" ? "Your finished, paid sessions are under Past sessions." : ""} /></Card>
      )}
      <div className="space-y-6">
        {shown.map((it) => {
          const s = it.session;
          const p = s.progress;
          return (
            <Card key={s.id} className={cx(it.needsProof && "ring-2 ring-amber-200")}>
              <CardTitle
                icon={BookOpen}
                title={s.subject || s.name}
                subtitle={[s.number && `Session ${s.number}`, range(s), s.teacherName && `with ${s.teacherName}`, plural(s.totalClasses, "class", "classes")].filter(Boolean).join(" · ")}
                action={<FeeBadge status={it.status} />}
              />
              {p && (
                <div className="mb-5">
                  <div className="mb-1.5 flex justify-between text-sm"><span className="text-muted">Classes taken</span><span className="font-semibold text-navy">{p.held} of {p.planned}</span></div>
                  <Progress value={p.percent} />
                </div>
              )}
              {s.paymentInstructions && (
                <div className="mb-5 rounded-xl border border-line bg-surface/60 p-4">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">How to pay the academy</p>
                  <p className="whitespace-pre-line text-sm text-ink">{s.paymentInstructions}</p>
                </div>
              )}
              {it.verification === "rejected" && <Notice tone="danger" className="mb-4">The academy couldn't accept your payment details for {s.subject || s.name}{it.rejectReason ? `: ${it.rejectReason}` : "."} Please submit them again.</Notice>}
              {it.status === "submitted" && <Notice tone="info" className="mb-4">Thank you! Your {s.subject || ""} classes are open. The academy will check your payment details and let you know.</Notice>}
              {it.status === "verified" && <Notice tone="success" className="mb-4">The academy has confirmed your payment for {s.subject || s.name}{it.verifiedAt ? ` (${fmtDate(it.verifiedAt)})` : ""}.</Notice>}
              {it.needsProof && (
                <>
                  <p className="mb-3 text-sm font-semibold text-navy">Submit payment details for {s.subject || s.name}{s.number ? ` – Session ${s.number}` : ""}</p>
                  <SubmitProof item={it} onDone={reload} />
                </>
              )}
              {it.submissions.length > 0 && (
                <div className="mt-5">
                  <p className="mb-2 text-sm font-semibold text-navy">What you submitted</p>
                  <div className="grid gap-2 sm:grid-cols-2">{it.submissions.map((x, i) => <ProofThumb key={i} s={x} />)}</div>
                </div>
              )}
              {it.history.length > 0 && (
                <details className="mt-4 text-sm">
                  <summary className="cursor-pointer font-medium text-navy">History</summary>
                  <ul className="mt-2 space-y-1 text-muted">
                    {it.history.map((h, i) => <li key={i}>{fmtDateTime(h.at)} – {{ created: "Fee notice sent", submitted: "You submitted payment details", verified: "Academy verified the payment", rejected: "Academy rejected the details" }[h.action] || h.action}{h.reason ? `: ${h.reason}` : ""}</li>)}
                  </ul>
                </details>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}

// ============================================================================
// ADMIN – SESSIONS (one per student + subject + teacher)
// ============================================================================
const studentLabel = (s) => (s.studentCode ? `${s.studentName} · ${s.studentCode}` : s.studentName);

function NewSessionsDialog({ open, presetStudent, onClose, onSaved }) {
  const ui = useUi();
  const dir = useAsync(() => (open ? api.get("/admin/directory") : Promise.resolve(null)), [open]);
  const [studentId, setStudentId] = useState(null);
  const setup = useAsync(() => (open && studentId ? api.get(`/admin/sessions-setup/${studentId}`) : Promise.resolve(null)), [open, studentId]);
  const [f, setF] = useState({ startDate: "", endDate: "", status: "active", paymentInstructions: "" });
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setStudentId(presetStudent || null);
    setF({ startDate: "", endDate: "", status: "active", paymentInstructions: "" });
  }, [open, presetStudent]);
  useEffect(() => {
    setRows((setup.data?.subjects || []).map((x) => ({ ...x, on: !!x.teacherId, classes: 12, number: x.nextNumber })));
  }, [setup.data]);
  if (!open) return null;
  const students = (dir.data?.students || []).filter((s) => s.active);
  const setRow = (i, patch) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const chosen = rows.filter((r) => r.on);
  const save = async (e) => {
    e.preventDefault();
    if (!chosen.length) return ui.error(new Error("Tick at least one subject"));
    if (f.status === "active") {
      const ok = await ui.confirm({
        title: `Start ${plural(chosen.length, "session")}?`,
        message: `${setup.data.student.name} will get a fee notice for ${chosen.map((r) => r.subject).join(", ")}. Until payment details are submitted for a subject, only that subject's classes are locked.`,
        confirmLabel: "Create and notify",
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const r = await api.post("/admin/sessions", { studentId, ...f, rows: chosen.map((x) => ({ subject: x.subject, teacherId: x.teacherId, classes: Number(x.classes), number: Number(x.number) })) });
      ui.toast(`Created ${r.created.map((x) => x.name).join(", ")}${r.notified ? " – the student was notified" : ""}`);
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
      open
      onClose={onClose}
      size="lg"
      title="New sessions"
      subtitle="One session per subject the student takes – each with its own teacher, session number and fee."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="sessions-form" loading={busy} disabled={!chosen.length}>Create {chosen.length > 1 ? `${chosen.length} sessions` : "session"}</Button>
        </>
      }
    >
      {dir.loading ? (
        <Loading />
      ) : (
        <form id="sessions-form" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <Field label="Student" required className="sm:col-span-2">
            <Select value={studentId} onChange={setStudentId} options={students.map((s) => ({ value: s.id, label: s.name, hint: [s.studentCode, s.grade, s.board].filter(Boolean).join(" · ") }))} placeholder="Choose the student" searchable />
          </Field>
          {studentId && (
            <div className="sm:col-span-2">
              <p className="mb-1.5 text-sm font-medium text-ink">Subjects <span className="text-rose-500">*</span></p>
              {setup.loading ? (
                <Loading />
              ) : setup.error ? (
                <ErrorBox error={setup.error} />
              ) : !rows.length ? (
                <Notice tone="warn">This student has no subjects yet. Add their subjects & teachers on the Students page first.</Notice>
              ) : (
                <div className="space-y-2">
                  {rows.map((r, i) => (
                    <div key={r.subject} className={cx("grid items-center gap-2 rounded-xl border p-2.5 sm:grid-cols-[1fr_110px_110px]", r.on ? "border-brand/60 bg-brand/5" : "border-line")}>
                      <div className="min-w-0">
                        <Checkbox checked={r.on} onChange={(v) => r.teacherId && setRow(i, { on: v })} label={<span><b className="text-navy">{r.subject}</b><span className="block text-xs text-muted">{r.teacherName ? `with ${r.teacherName}` : "No teacher yet – assign one on the Students page"}</span></span>} />
                      </div>
                      <Field label="Session no." className={cx(!r.on && "opacity-50")}><Input type="number" min={1} max={999} value={r.number} onChange={(e) => setRow(i, { number: e.target.value })} disabled={!r.on} /></Field>
                      <Field label="Classes" className={cx(!r.on && "opacity-50")}><Input type="number" min={1} max={500} value={r.classes} onChange={(e) => setRow(i, { classes: e.target.value })} disabled={!r.on} /></Field>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <Field label="Starting date" required><Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} required /></Field>
          <Field label="Ending date" required><Input type="date" value={f.endDate} min={f.startDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} required /></Field>
          <Field label="Status" hint="Active = the student is asked for the fee of each subject">
            <Select value={f.status} onChange={(v) => setF({ ...f, status: v })} options={Object.entries(SESSION_STATUS).filter(([k]) => k !== "archived").map(([value, [, label]]) => ({ value, label }))} />
          </Field>
          <div className="hidden sm:block" />
          <Field label="Payment instructions for the student (optional)" className="sm:col-span-2" hint="Shown on the student's fee page. The portal doesn't calculate or collect fees.">
            <Textarea rows={2} value={f.paymentInstructions} onChange={(e) => setF({ ...f, paymentInstructions: e.target.value })} maxLength={2000} placeholder="e.g. Pay by GPay or bank transfer to the academy account, then upload the screenshot here." />
          </Field>
          <Notice icon={Info} className="sm:col-span-2">Classes count towards a session automatically when the student, subject and teacher match and the class date is inside the session dates – nobody has to pick a session or type the class count.</Notice>
        </form>
      )}
    </Dialog>
  );
}

function EditSessionDialog({ session, onClose, onSaved }) {
  const ui = useUi();
  const dir = useAsync(() => (session ? api.get("/admin/directory") : Promise.resolve(null)), [session?.id]);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (session) setF({ startDate: session.startDate, endDate: session.endDate, plannedClasses: session.plannedClasses, number: session.number, status: session.status, teacherId: session.teacherId, paymentInstructions: session.paymentInstructions || "" });
  }, [session]);
  if (!session || !f) return null;
  const teachers = (dir.data?.teachers || []).filter((t) => t.active || t.id === session.teacherId);
  const save = async (e) => {
    e.preventDefault();
    if (f.status === "active" && session.status !== "active") {
      const ok = await ui.confirm({ title: "Start this session?", message: `${session.studentName} will get a fee notice for ${session.subject}. Until it's submitted, only ${session.subject} is locked.`, confirmLabel: "Save and notify" });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const r = await api.patch(`/admin/sessions/${session.id}`, { ...f, classes: Number(f.plannedClasses), number: Number(f.number) });
      ui.toast(r.notified ? "Saved – the student was notified about the fee" : "Session saved");
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
      open
      onClose={onClose}
      title={`Edit ${session.name}`}
      subtitle={studentLabel(session)}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="session-edit" loading={busy}>Save</Button>
        </>
      }
    >
      <form id="session-edit" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <Field label="Session no."><Input type="number" min={1} max={999} value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} /></Field>
        <Field label="Classes planned"><Input type="number" min={1} max={500} value={f.plannedClasses} onChange={(e) => setF({ ...f, plannedClasses: e.target.value })} /></Field>
        <Field label="Starting date" required><Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} required /></Field>
        <Field label="Ending date" required><Input type="date" value={f.endDate} min={f.startDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} required /></Field>
        <Field label="Status">
          <Select value={f.status} onChange={(v) => setF({ ...f, status: v })} options={Object.entries(SESSION_STATUS).map(([value, [, label]]) => ({ value, label }))} />
        </Field>
        <Field label="Teacher" hint={`Must be ${session.studentName}'s ${session.subject} teacher`}>
          <Select value={f.teacherId} onChange={(v) => setF({ ...f, teacherId: v })} options={teachers.map((t) => ({ value: t.id, label: t.name, hint: t.subjects?.join(", ") }))} searchable />
        </Field>
        <Field label="Payment instructions (optional)" className="sm:col-span-2">
          <Textarea rows={2} value={f.paymentInstructions} onChange={(e) => setF({ ...f, paymentInstructions: e.target.value })} maxLength={2000} />
        </Field>
      </form>
    </Dialog>
  );
}

const SESSION_FEE = (fee, status) => (!fee ? null : fee.submission !== "submitted" ? (status === "active" ? "pending" : "not_submitted") : fee.verification === "unverified" ? "submitted" : fee.verification);

function SessionDetail({ id, onClose, onEdit }) {
  const { data, loading, error, reload } = useAsync(() => (id ? api.get(`/admin/sessions/${id}`) : Promise.resolve(null)), [id]);
  if (!id) return null;
  const s = data?.session;
  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title={s ? `${s.name}` : "Session"}
      subtitle={s ? `${studentLabel(s)} · ${s.teacherName} · ${range(s)} · ${SESSION_STATUS[s.status]?.[1]}` : ""}
      footer={
        s && (
          <>
            <Link to={`/portal/sessions/${s.id}/register`}><Button variant="outline" icon={FileText}>Open register</Button></Link>
            <Button variant="outline" icon={Pencil} onClick={() => onEdit(s)}>Edit session</Button>
          </>
        )
      }
    >
      {loading ? <Loading /> : error ? <ErrorBox error={error} onRetry={reload} /> : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-4">
            <StatCard label="Planned classes" value={s.progress.planned} tone="navy" />
            <StatCard label="Taken" value={s.progress.held} hint={`${s.progress.percent}%`} tone="green" />
            <StatCard label="Still to take" value={s.progress.pending} hint={`${s.progress.upcoming} scheduled`} tone="gold" />
            <StatCard label="Not started / cancelled" value={`${s.progress.notStarted} / ${s.progress.cancelled}`} tone="red" />
          </div>
          {s.fee && <p className="flex items-center gap-2 text-sm"><span className="text-muted">Fee for {s.subject}:</span><FeeBadge status={SESSION_FEE(s.fee, s.status)} /></p>}
          <div>
            <p className="mb-2 font-semibold text-navy">Classes counted ({data.classes.length})</p>
            <Table pageSize={10} rows={data.classes} empty={<Empty title="No classes yet" text={`${s.subject} classes of ${s.studentName} with ${s.teacherName} between these dates are counted automatically.`} />} columns={[
              { key: "startAt", label: "When", render: (m) => fmtDateTime(m.startAt) },
              { key: "title", label: "Class" },
              { key: "held", label: "Status", render: (m) => (m.status === "cancelled" ? <Badge tone="gray" title={m.cancelledReason}>Cancelled</Badge> : m.held ? <Badge tone="green">Held</Badge> : new Date(m.startAt) > new Date() ? <Badge tone="blue">Scheduled</Badge> : <Badge tone="red">Not started</Badge>) },
            ]} />
          </div>
        </div>
      )}
    </Dialog>
  );
}

export function AdminSessions() {
  const [status, setStatus] = useState("current");
  const [studentId, setStudentId] = useState(null);
  const [subject, setSubject] = useState("");
  const dir = useAsync(() => api.get("/admin/directory"), []);
  const { data, loading, error, reload } = useAsync(() => api.get("/admin/sessions", { ...(status === "current" ? {} : status === "all" ? { all: 1 } : { status }), ...(studentId ? { studentId } : {}), ...(subject ? { subject } : {}) }), [status, studentId, subject]);
  const [creating, setCreating] = useState(false);
  const [edit, setEdit] = useState(null);
  const [view, setView] = useState(null);
  const students = dir.data?.students || [];
  return (
    <>
      <PageHeader title="Sessions" subtitle="One session per student and subject – e.g. Mathematics, Session 8, 1 – 30 November with Anusha. Fees and teacher payments follow each session." actions={<Button icon={Plus} onClick={() => setCreating(true)}>New sessions</Button>} />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Segmented value={status} onChange={setStatus} options={[{ value: "current", label: "Current" }, { value: "active", label: "Active" }, { value: "draft", label: "Draft" }, { value: "completed", label: "Completed" }, { value: "archived", label: "Archived" }, { value: "all", label: "All" }]} />
        <Select className="w-full sm:w-60" value={studentId} onChange={setStudentId} options={students.map((s) => ({ value: s.id, label: s.name, hint: s.studentCode }))} placeholder="All students" searchable clearable />
        <SubjectSelect className="w-full sm:w-52" value={subject} onChange={setSubject} placeholder="All subjects" clearable />
      </div>
      <ErrorBox error={error} onRetry={reload} />
      <Card flush>
        {loading ? <Loading /> : (
          <Table
            rows={data.sessions}
            onRowClick={(s) => setView(s.id)}
            empty={<Empty icon={CalendarRange} title="No sessions" text="Create sessions for a student – one per subject." />}
            columns={[
              { key: "studentName", label: "Student", render: (s) => <span><b className="text-navy">{s.studentName}</b>{s.studentCode && <span className="block text-xs text-muted">{s.studentCode}</span>}</span> },
              { key: "subject", label: "Subject / session", render: (s) => <span><b className="text-navy">{s.subject}</b><span className="block text-xs text-muted">Session {s.number}</span></span> },
              { key: "teacherName", label: "Teacher" },
              { key: "dates", label: "Dates", render: (s) => <span className="whitespace-nowrap text-sm">{range(s)}</span> },
              { key: "status", label: "Status", render: (s) => <Badge tone={SESSION_STATUS[s.status]?.[0]}>{SESSION_STATUS[s.status]?.[1]}</Badge> },
              { key: "progress", label: "Classes taken", render: (s) => <span className="flex min-w-[130px] items-center gap-2"><Progress value={s.progress.percent} className="flex-1" /><span className="whitespace-nowrap text-xs">{s.progress.held}/{s.progress.planned}</span></span> },
              ...(data.sessions.some((s) => s.fee !== undefined) ? [{ key: "fee", label: "Fee", render: (s) => (s.fee ? <FeeBadge status={SESSION_FEE(s.fee, s.status)} /> : "—") }] : []),
              { key: "edit", label: "", render: (s) => <IconButton icon={Pencil} label="Edit" onClick={(e) => { e.stopPropagation(); setEdit(s); }} /> },
            ]}
          />
        )}
      </Card>
      <NewSessionsDialog open={creating} presetStudent={studentId} onClose={() => setCreating(false)} onSaved={() => reload(true)} />
      <EditSessionDialog session={edit} onClose={() => setEdit(null)} onSaved={() => reload(true)} />
      <SessionDetail id={view} onClose={() => setView(null)} onEdit={(s) => { setView(null); setEdit(s); }} />
    </>
  );
}

// ============================================================================
// ADMIN – FEE PROOF VERIFICATION
// ============================================================================
function PaymentDialog({ row, onClose, onSaved }) {
  const ui = useUi();
  const detail = useAsync(() => (row?.submissions ? api.get(`/admin/fees/${row.id}`) : Promise.resolve(null)), [row?.id]);
  const [mode, setMode] = useState(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  if (!row) return null;
  const p = detail.data?.payment;
  const review = async (decision) => {
    setBusy(true);
    try {
      await api.post(`/admin/fees/${row.id}/review`, { decision, reason });
      ui.toast(decision === "verify" ? "Marked as received – the student was notified" : "Rejected – the student was notified and must resubmit");
      onSaved();
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
      size="lg"
      title={`${row.studentName}${row.studentCode ? ` · ${row.studentCode}` : ""}`}
      subtitle={`${row.subject ? `${row.subject} – Session ${row.sessionNumber}` : row.sessionName}${row.teacherName ? ` · ${row.teacherName}` : ""} · ${FEE_STATUS[row.status]?.label}`}
      footer={
        row.submission === "submitted" ? (
          mode === "reject" ? (
            <>
              <Button variant="outline" onClick={() => setMode(null)}>Back</Button>
              <Button variant="danger" loading={busy} onClick={() => review("reject")}>Reject payment details</Button>
            </>
          ) : (
            <>
              {row.verification !== "rejected" && <Button variant="outline" icon={XCircle} onClick={() => setMode("reject")}>Reject</Button>}
              {row.verification !== "verified" && <Button icon={CheckCircle2} loading={busy} onClick={() => review("verify")}>Mark as received / verified</Button>}
            </>
          )
        ) : (
          <Button variant="outline" onClick={onClose}>Close</Button>
        )
      }
    >
      {!row.submissions ? (
        <Empty icon={Clock} title="No payment details submitted yet" text="The student has been notified about the session fee." />
      ) : detail.loading ? (
        <Loading />
      ) : detail.error ? (
        <ErrorBox error={detail.error} onRetry={detail.reload} />
      ) : (
        <div className="space-y-5">
          {mode === "reject" && (
            <Field label="Reason (sent to the student)" required>
              <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} placeholder="e.g. The screenshot doesn't show the amount or the date" autoFocus />
            </Field>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-surface p-3 text-sm"><p className="text-xs text-muted">Proof submitted</p><p className="font-semibold text-navy">{p.submission === "submitted" ? "Yes" : "No"}</p></div>
            <div className="rounded-xl bg-surface p-3 text-sm"><p className="text-xs text-muted">Verification</p><p className="font-semibold capitalize text-navy">{p.verification}{p.verifiedByName ? ` · ${p.verifiedByName}` : ""}</p></div>
            <div className="rounded-xl bg-surface p-3 text-sm"><p className="text-xs text-muted">Notifications sent</p><p className="font-semibold text-navy">{p.notifications.length}</p></div>
          </div>
          {p.verification === "rejected" && p.rejectReason && <Notice tone="danger">Rejected: {p.rejectReason}</Notice>}
          {p.submissions.map((s, i) => (
            <div key={i} className={cx("rounded-2xl border p-4", i === 0 ? "border-line" : "border-dashed border-line opacity-80")}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{i === 0 ? "Latest submission" : `Earlier submission`} · {fmtDateTime(s.at)}</p>
              {s.file.contentType?.startsWith("image/") ? (
                <a href={s.url} target="_blank" rel="noreferrer"><img src={s.url} alt="Payment proof" className="max-h-[420px] w-full rounded-xl border border-line object-contain" /></a>
              ) : (
                <ProofThumb s={s} />
              )}
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
                {s.paidOn && <span>Paid on {fmtDate(`${s.paidOn}T12:00:00`)}</span>}
                {s.reference && <span>Ref: {s.reference}</span>}
                {s.note && <span>Note: {s.note}</span>}
                <a href={s.downloadUrl} className="inline-flex items-center gap-1 font-medium text-navy hover:underline"><Download className="h-4 w-4" />Download</a>
              </div>
            </div>
          ))}
          <details className="text-sm">
            <summary className="cursor-pointer font-semibold text-navy">History & notifications</summary>
            <ul className="mt-2 space-y-1 text-muted">
              {p.history.map((h, i) => <li key={i}>{fmtDateTime(h.at)} – {h.byName ? `${h.byName}: ` : ""}{h.action.replace(/_/g, " ")}{h.reason ? ` (${h.reason})` : ""}</li>)}
            </ul>
            <ul className="mt-3 space-y-1 text-muted">
              {p.notifications.map((n, i) => <li key={i}>{fmtDateTime(n.at)} – notice "{n.type.replace(/_/g, " ")}" to {n.to}</li>)}
            </ul>
          </details>
        </div>
      )}
    </Dialog>
  );
}

function FeeSettings() {
  const ui = useUi();
  const { data, loading, reload } = useAsync(() => api.get("/admin/fees-settings"), []);
  if (loading || !data) return null;
  const set = async (k, v) => {
    try {
      await api.put("/admin/fees-settings", { ...data.restrictions, [k]: v });
      ui.toast("Saved");
      reload(true);
    } catch (e) {
      ui.error(e);
    }
  };
  return (
    <Card className="mt-6 max-w-3xl">
      <CardTitle icon={Settings2} title="While payment details are missing for a subject" subtitle="That subject's classes, live classroom, timetable and attendance are always blocked; other subjects keep working. Profile, messages and notifications always stay open." />
      <div className="space-y-4">
        <Toggle label="Also block materials" checked={data.restrictions.materials} onChange={(v) => set("materials", v)} />
        <Toggle label="Also block recordings" checked={data.restrictions.recordings} onChange={(v) => set("recordings", v)} />
        <Toggle label="Also block progress" checked={data.restrictions.progress} onChange={(v) => set("progress", v)} />
      </div>
    </Card>
  );
}

export function AdminFees() {
  const ui = useUi();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState("submitted");
  const [subject, setSubject] = useState("");
  const [q, setQ] = useState("");
  const { data, loading, error, reload } = useAsync(() => api.get("/admin/fees", subject ? { subject } : {}), [subject]);
  const rows = useMemo(() => (data?.rows || []).filter((r) => (status === "all" || r.status === status) && (!q || `${r.studentName} ${r.studentCode}`.toLowerCase().includes(q.toLowerCase()))), [data, status, q]);
  const open = data?.rows.find((r) => r.id === params.get("pay")) || null;
  const exportCsv = () => api.download("/admin/fees", { format: "csv", ...(subject ? { subject } : {}) }).catch(ui.error);
  return (
    <>
      <PageHeader title="Session fees" subtitle="Payment proof submitted by students – one per subject and session. The portal doesn't take payments – check the proof against the academy's account, then mark it received or reject it." actions={<Button variant="outline" icon={Download} onClick={exportCsv}>Export CSV</Button>} />
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : data && (
        <>
          <div className="mb-5 grid gap-4 sm:grid-cols-4">
            <StatCard icon={Clock} label="To verify" value={data.counts.submitted} tone="blue" onClick={() => setStatus("submitted")} />
            <StatCard icon={CheckCircle2} label="Received / verified" value={data.counts.verified} tone="green" onClick={() => setStatus("verified")} />
            <StatCard icon={XCircle} label="Rejected" value={data.counts.rejected} tone="red" onClick={() => setStatus("rejected")} />
            <StatCard icon={AlertTriangle} label="Not submitted" value={data.counts.pending} tone="gold" onClick={() => setStatus("pending")} />
          </div>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Segmented value={status} onChange={setStatus} options={[{ value: "submitted", label: "To verify" }, { value: "verified", label: "Verified" }, { value: "rejected", label: "Rejected" }, { value: "pending", label: "Not submitted" }, { value: "all", label: "All" }]} />
            <SubjectSelect className="w-full sm:w-52" value={subject} onChange={setSubject} placeholder="All subjects" clearable />
            <div className="flex-1" />
            <SearchInput value={q} onChange={setQ} className="w-full sm:w-60" placeholder="Search student or ID…" />
          </div>
          <Card flush>
            <Table
              pageSize={25}
              rows={rows}
              onRowClick={(r) => setParams({ pay: r.id })}
              empty={<Empty icon={Receipt} title="Nothing here" />}
              columns={[
                { key: "studentName", label: "Student", render: (r) => <span><b className="text-navy">{r.studentName}</b><span className="block text-xs text-muted">{[r.studentCode, r.grade].filter(Boolean).join(" · ")}</span></span> },
                { key: "subject", label: "Subject / session", render: (r) => (r.subject ? <span><b className="text-navy">{r.subject}</b><span className="block text-xs text-muted">Session {r.sessionNumber} · {range(r)}{r.teacherName ? ` · ${r.teacherName}` : ""}</span></span> : r.sessionName) },
                { key: "status", label: "Status", render: (r) => <FeeBadge status={r.status} /> },
                { key: "proof", label: "Proof", render: (r) => (r.proof ? <span className="inline-flex items-center gap-1.5 text-sm">{r.proof.file.contentType?.startsWith("image/") ? <ImageIcon className="h-4 w-4 text-slate-400" /> : <FileText className="h-4 w-4 text-slate-400" />}{r.reference || r.proof.file.fileName}</span> : "—") },
                { key: "submittedAt", label: "Submitted", render: (r) => (r.submittedAt ? <span className="whitespace-nowrap text-sm">{fromNow(r.submittedAt)}</span> : "—") },
                { key: "verifiedAt", label: "Checked", render: (r) => (r.verifiedAt ? <span className="text-xs text-muted">{fmtDate(r.verifiedAt)}{r.verifiedByName ? ` · ${r.verifiedByName}` : ""}</span> : "—") },
              ]}
            />
          </Card>
          <FeeSettings />
        </>
      )}
      <PaymentDialog row={open} onClose={() => setParams({})} onSaved={() => reload(true)} />
    </>
  );
}

