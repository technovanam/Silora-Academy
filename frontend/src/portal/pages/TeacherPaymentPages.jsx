// ============================================================
// TEACHER PAYMENT RECORDS – the portal never pays anyone.
// The academy pays teachers outside the portal; an admin records the amount
// actually paid, uploads the proof and marks it as paid.
//  • AdminTeacherPayments  /portal/admin/teacher-payments
//  • TeacherPayments       /portal/teacher/payments
// ============================================================
import React, { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Clock, Download, FileText, Image as ImageIcon, Info, Pencil, Upload, Wallet } from "lucide-react";
import { api } from "../lib/api.js";
import { fmtDate, fmtDateTime, fmtSize, plural } from "../lib/format.js";
import { Badge, Button, Card, CardTitle, Dialog, Empty, ErrorBox, Field, Input, Loading, Notice, PageHeader, Pager, Progress, SearchInput, Segmented, Select, StatCard, Table, Textarea, cx, useAsync, usePaged, useUi } from "../ui/index.jsx";

export const TP_STATUS = {
  pending: { tone: "gray", label: "Pending" },
  due: { tone: "amber", label: "Payment due" },
  paid: { tone: "green", label: "Paid" },
};
const TpBadge = ({ status }) => <Badge tone={TP_STATUS[status]?.tone}>{TP_STATUS[status]?.label || status}</Badge>;
const money = (n) => (n === null || n === undefined ? "—" : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
const day = (d) => (d ? fmtDate(`${d}T12:00:00`) : "—");
const NOT_A_PAYMENT = "The portal doesn't send money. Pay the teacher the usual way, then record the amount and upload the proof here.";

function ClassesBar({ p }) {
  const pct = p.scheduledClasses ? Math.min(100, (p.conductedClasses / p.scheduledClasses) * 100) : 0;
  return (
    <span className="flex min-w-[140px] items-center gap-2">
      <Progress value={pct} tone={p.conductedClasses >= p.scheduledClasses ? "green" : "brand"} className="flex-1" />
      <span className="whitespace-nowrap text-xs text-slate-600">{p.conductedClasses}/{p.scheduledClasses}</span>
    </span>
  );
}

function ProofLink({ proof, compact }) {
  if (!proof) return <span className="text-sm text-muted">No proof uploaded</span>;
  const img = proof.contentType?.startsWith("image/");
  return (
    <div className="space-y-2">
      {img && (
        <a href={proof.url} target="_blank" rel="noreferrer">
          <img src={proof.url} alt="Payment proof" className={cx("w-full rounded-xl border border-line bg-surface object-contain", compact ? "max-h-48" : "max-h-[360px]")} />
        </a>
      )}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <a href={proof.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium text-navy hover:underline">
          {img ? <ImageIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
          {proof.fileName}
        </a>
        <span className="text-xs text-muted">{fmtSize(proof.size)}</span>
        <a href={proof.downloadUrl} className="inline-flex items-center gap-1 text-sm font-medium text-navy hover:underline"><Download className="h-4 w-4" />Download</a>
      </div>
    </div>
  );
}

function FilePick({ file, onChange, required }) {
  return (
    <label className={cx("flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed px-4 py-3.5 text-sm transition", file ? "border-emerald-300 bg-emerald-50/40" : "border-slate-200 hover:border-slate-300")}>
      {file ? <FileText className="h-5 w-5 text-emerald-600" /> : <Upload className="h-5 w-5 text-slate-400" />}
      <span className="min-w-0 flex-1 truncate">{file ? `${file.name} · ${fmtSize(file.size)}` : required ? "Choose the screenshot or receipt (required)" : "Replace the proof (optional)"}</span>
      <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" className="sr-only" onChange={(e) => onChange(e.target.files?.[0] || null)} />
    </label>
  );
}

// ---- Mark as paid / correct -------------------------------------------------------
function PayForm({ p, mode, onDone, onCancel }) {
  const ui = useUi();
  const correcting = mode === "correct";
  const [f, setF] = useState(correcting ? { amount: p.amount ?? "", paidOn: p.paidOn || "", reference: p.reference, note: p.note, reason: "" } : { amount: "", paidOn: new Date().toISOString().slice(0, 10), reference: "", note: "" });
  const [file, setFile] = useState(null);
  const [pct, setPct] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    if (!correcting && !file) return ui.error(new Error("Upload the payment screenshot or transaction receipt"));
    let confirmEarly = false;
    if (!correcting && p.status === "pending") {
      confirmEarly = await ui.confirm({ title: "Mark as paid before completion?", message: `Only ${p.conductedClasses} of ${p.scheduledClasses} classes have been held. The record will be flagged as paid early.`, confirmLabel: "Mark as paid" });
      if (!confirmEarly) return;
    }
    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => fd.append(k, v ?? ""));
    if (file) fd.append("file", file);
    if (confirmEarly) fd.append("confirmEarly", "1");
    setPct(0);
    try {
      await api.upload(`/admin/teacher-payments/${p.id}/${correcting ? "correct" : "pay"}`, fd, setPct);
      ui.toast(correcting ? "Payment record corrected" : `Marked as paid – ${p.teacherName} was notified`);
      onDone();
    } catch (err) {
      ui.error(err);
    } finally {
      setPct(null);
    }
  };
  return (
    <form onSubmit={submit} className="grid gap-4 rounded-2xl border border-line bg-surface/40 p-4 sm:grid-cols-2">
      <p className="flex items-start gap-2 text-xs text-muted sm:col-span-2"><Info className="mt-0.5 h-4 w-4 shrink-0" />{NOT_A_PAYMENT}</p>
      <Field label="Amount paid (₹)" required={!correcting} hint="Enter the actual amount – nothing is calculated">
        <Input inputMode="decimal" value={f.amount} onChange={set("amount")} required={!correcting} placeholder="e.g. 12000" />
      </Field>
      <Field label="Paid on">
        <Input type="date" value={f.paidOn} max={new Date().toISOString().slice(0, 10)} onChange={set("paidOn")} />
      </Field>
      <Field label="Transaction / UPI reference">
        <Input value={f.reference} onChange={set("reference")} maxLength={120} />
      </Field>
      <Field label="Note">
        <Input value={f.note} onChange={set("note")} maxLength={1000} />
      </Field>
      <Field label="Payment proof" required={!correcting} className="sm:col-span-2" hint="Image or PDF, up to 10 MB">
        <FilePick file={file} onChange={setFile} required={!correcting} />
      </Field>
      {correcting && (
        <Field label="Reason for the correction" required className="sm:col-span-2" hint="Saved in the history and the audit log">
          <Textarea rows={2} value={f.reason} onChange={set("reason")} required maxLength={500} />
        </Field>
      )}
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        {pct !== null && <Progress value={pct} className="mb-1 w-full" />}
        <Button type="submit" icon={CheckCircle2} loading={pct !== null}>{correcting ? "Save correction" : "Mark as paid"}</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function PaymentDetail({ id, onClose, onChanged }) {
  const { data, loading, error, reload } = useAsync(() => (id ? api.get(`/admin/teacher-payments/${id}`) : Promise.resolve(null)), [id]);
  const [mode, setMode] = useState(null);
  if (!id) return null;
  const p = data?.payment;
  const done = () => {
    setMode(null);
    reload(true);
    onChanged();
  };
  return (
    <Dialog open onClose={onClose} size="xl" title={p ? p.teacherName : "Teacher payment"} subtitle={p ? `${p.sessionName}${p.studentName ? ` · ${p.studentName}${p.studentCode ? ` (${p.studentCode})` : ""}` : ""} · ${day(p.sessionStartDate)} – ${day(p.sessionEndDate)}` : ""}>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-4">
            <StatCard label="Status" value={<TpBadge status={p.status} />} tone="navy" />
            <StatCard label="Classes held" value={`${p.conductedClasses}/${p.scheduledClasses}`} hint={p.dueAt ? `All held · due since ${fmtDate(p.dueAt)}` : ""} tone="green" />
            {p.studentName ? <StatCard label="Student" value={p.studentName} hint={p.studentCode} tone="blue" /> : <StatCard label="Students" value={p.studentCount} tone="blue" />}
            <StatCard label="Amount paid" value={money(p.amount)} hint={p.paidOn ? `Paid ${day(p.paidOn)}` : ""} tone="gold" />
          </div>
          {p.status === "due" && !mode && <Notice tone="warn">All scheduled classes are completed. Pay the teacher, then record the payment here.</Notice>}
          {p.paidEarly && <Notice tone="warn">Marked as paid before all scheduled classes were held.</Notice>}

          {mode ? (
            <PayForm p={p} mode={mode} onDone={done} onCancel={() => setMode(null)} />
          ) : p.status === "paid" ? (
            <Card>
              <CardTitle icon={Wallet} title="Payment recorded" subtitle={`${money(p.amount)} on ${day(p.paidOn)}${p.reference ? ` · Ref ${p.reference}` : ""}${p.paidByName ? ` · recorded by ${p.paidByName}` : ""}`} action={<Button size="sm" variant="outline" icon={Pencil} onClick={() => setMode("correct")}>Correct</Button>} />
              {p.note && <p className="mb-3 text-sm text-slate-600">{p.note}</p>}
              <ProofLink proof={p.proof} />
            </Card>
          ) : (
            <Button icon={CheckCircle2} onClick={() => setMode("pay")}>Mark as paid…</Button>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <p className="mb-2 font-semibold text-navy">Subjects</p>
              <ul className="divide-y divide-line rounded-xl border border-line text-sm">
                {p.subjects.map((s) => <li key={s.subject} className="flex justify-between px-3 py-2"><span>{s.subject}</span><span className="text-muted">{plural(s.classes, "class", "classes")} scheduled</span></li>)}
              </ul>
              <p className="mb-2 mt-5 font-semibold text-navy">Students ({data.students.length})</p>
              <p className="text-sm text-slate-600">{data.students.map((s) => s.name).join(", ") || "—"}</p>
            </div>
            <div>
              <p className="mb-2 font-semibold text-navy">Classes ({data.classes.length})</p>
              <ul className="scrollbar-thin max-h-72 divide-y divide-line overflow-y-auto rounded-xl border border-line text-sm" data-lenis-prevent>
                {data.classes.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0"><span className="block truncate">{m.subject || m.title}</span><span className="text-xs text-muted">{fmtDateTime(m.startAt)}</span></span>
                    {m.status === "cancelled" ? <Badge tone="gray">Cancelled</Badge> : m.held ? <Badge tone="green">Held</Badge> : new Date(m.startAt) > new Date() ? <Badge tone="blue">Scheduled</Badge> : <Badge tone="red">Not started</Badge>}
                  </li>
                ))}
                {!data.classes.length && <li className="px-3 py-2 text-muted">No classes linked to this session yet.</li>}
              </ul>
            </div>
          </div>

          <details className="text-sm">
            <summary className="cursor-pointer font-semibold text-navy">History & notifications</summary>
            <ul className="mt-2 space-y-1 text-muted">
              {p.history.map((h, i) => (
                <li key={i}>
                  {fmtDateTime(h.at)} – {h.byName ? `${h.byName}: ` : ""}
                  {{ created: "Record created", status_due: "All classes held – payment due", status_pending: "Back to pending", paid: `Marked as paid (${money(h.amount)})${h.early ? " early" : ""}`, corrected: `Corrected – ${h.reason}`, removed_from_session: "Teacher removed from the session" }[h.action] || h.action.replace(/_/g, " ")}
                  {h.conducted !== undefined ? ` · ${h.conducted}/${h.scheduled} held` : ""}
                </li>
              ))}
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

export function AdminTeacherPayments() {
  const ui = useUi();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState("all");
  const [sessionId, setSessionId] = useState(null);
  const [teacherId, setTeacherId] = useState(null);
  const { data, loading, error, reload } = useAsync(() => api.get("/admin/teacher-payments", { sessionId, teacherId }), [sessionId, teacherId]);
  const rows = useMemo(() => (data?.payments || []).filter((p) => status === "all" || p.status === status), [data, status]);
  const open = params.get("pay");
  const exportCsv = () => api.download("/admin/teacher-payments", { format: "csv", ...(sessionId ? { sessionId } : {}), ...(teacherId ? { teacherId } : {}) }).catch(ui.error);
  return (
    <>
      <PageHeader title="Teacher payments" subtitle="A payment becomes due when a teacher has held all their scheduled classes in a session. Record what you paid and upload the proof." actions={<Button variant="outline" icon={Download} onClick={exportCsv}>Export CSV</Button>} />
      <Notice className="mb-5" icon={Info}>{NOT_A_PAYMENT}</Notice>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : data && (
        <>
          <div className="mb-5 grid gap-4 sm:grid-cols-3">
            <StatCard icon={AlertTriangle} label="Payment due" value={data.counts.due} tone="gold" onClick={() => setStatus("due")} />
            <StatCard icon={Clock} label="Pending (classes still to hold)" value={data.counts.pending} tone="blue" onClick={() => setStatus("pending")} />
            <StatCard icon={CheckCircle2} label="Paid" value={data.counts.paid} tone="green" onClick={() => setStatus("paid")} />
          </div>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Segmented value={status} onChange={setStatus} options={[{ value: "all", label: "All" }, { value: "due", label: "Payment due", count: data.counts.due || undefined }, { value: "pending", label: "Pending" }, { value: "paid", label: "Paid" }]} />
            <Select className="w-full sm:w-56" value={sessionId} onChange={setSessionId} options={data.sessions.map((s) => ({ value: s.id, label: s.name }))} placeholder="All sessions" clearable />
            <Select className="w-full sm:w-52" value={teacherId} onChange={setTeacherId} options={data.teachers.map((t) => ({ value: t.id, label: t.name }))} placeholder="All teachers" clearable searchable />
          </div>
          <Card flush>
            <Table
              pageSize={25}
              rows={rows}
              onRowClick={(p) => setParams({ pay: p.id })}
              empty={<Empty icon={Wallet} title="No teacher payment records" text="A record appears for each active session (one student + subject) with its teacher." />}
              columns={[
                { key: "teacherName", label: "Teacher", render: (p) => <span><b className="text-navy">{p.teacherName}</b><span className="block text-xs text-muted">{p.subjects.map((s) => s.subject).join(", ")}</span></span> },
                { key: "sessionName", label: "Session", render: (p) => <span>{p.sessionName}<span className="block text-xs text-muted">{day(p.sessionStartDate)} – {day(p.sessionEndDate)}</span></span> },
                { key: "studentName", label: "Student", render: (p) => (p.studentName ? <span>{p.studentName}{p.studentCode && <span className="block text-xs text-muted">{p.studentCode}</span>}</span> : `${p.studentCount} students`) },
                { key: "classes", label: "Classes held", render: (p) => <ClassesBar p={p} /> },
                { key: "status", label: "Status", render: (p) => <span className="flex flex-col items-start gap-0.5"><TpBadge status={p.status} />{p.paidEarly && <span className="text-[11px] text-amber-700">paid early</span>}</span> },
                { key: "amount", label: "Paid", render: (p) => (p.status === "paid" ? <span className="whitespace-nowrap">{money(p.amount)}<span className="block text-xs text-muted">{day(p.paidOn)}</span></span> : "—") },
              ]}
            />
          </Card>
        </>
      )}
      <PaymentDetail id={open} onClose={() => setParams({})} onChanged={() => reload(true)} />
    </>
  );
}

// ============================================================================
// TEACHER – My payments: summary, one filter bar, a paged table (cards on phones)
// and a details pop-up with the proof. Read-only: the academy records payments.
// ============================================================================
const SORTS = [
  { value: "new", label: "Newest session first" },
  { value: "old", label: "Oldest session first" },
  { value: "amount", label: "Highest amount" },
  { value: "student", label: "Student A–Z" },
];
const STATUS_TABS = [
  { value: "all", label: "All" },
  { value: "due", label: "Payment due" },
  { value: "pending", label: "Pending" },
  { value: "paid", label: "Paid" },
];
const monthKey = (d) => (d ? d.slice(0, 7) : "");
const monthLabel = (k) => new Date(`${k}-01T12:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
const sessionLabel = (p) => (p.subject ? `${p.subject}${p.sessionNumber ? ` – Session ${p.sessionNumber}` : ""}` : p.sessionName);
const STATUS_HINT = {
  pending: "Classes still to hold",
  due: "All classes held – the academy has been notified",
  paid: "Payment recorded by the academy",
};
const Label = ({ children }) => <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{children}</p>;

function TeacherPaymentDetail({ p, onClose }) {
  if (!p) return null;
  const facts = [
    ["Student", p.studentName ? `${p.studentName}${p.studentCode ? ` · ${p.studentCode}` : ""}` : plural(p.studentCount, "student")],
    ["Session period", `${day(p.sessionStartDate)} – ${day(p.sessionEndDate)}`],
    ["Classes held", `${p.conductedClasses} of ${p.scheduledClasses}`],
    ["Paid on", p.status === "paid" ? day(p.paidOn) : "—"],
    ["Reference", p.reference || "—"],
  ];
  return (
    <Dialog open onClose={onClose} size="lg" title={sessionLabel(p)} subtitle={STATUS_HINT[p.status]}>
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3 rounded-xl bg-surface p-4">
          <div>
            <Label>Status</Label>
            <div className="mt-1"><TpBadge status={p.status} /></div>
          </div>
          <div className="text-right">
            <Label>{p.status === "paid" ? "Amount received" : "Amount"}</Label>
            <p className="mt-0.5 text-2xl font-bold tracking-tight text-navy">{p.status === "paid" ? money(p.amount) : "—"}</p>
          </div>
        </div>
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-3">
          {facts.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{k}</dt>
              <dd className="mt-1 truncate font-medium text-navy">{v}</dd>
            </div>
          ))}
        </dl>
        <div>
          <div className="mb-1.5 flex justify-between text-sm"><span className="text-muted">Classes held</span><span className="font-semibold text-navy">{p.conductedClasses} of {p.scheduledClasses}</span></div>
          <Progress value={p.scheduledClasses ? (p.conductedClasses / p.scheduledClasses) * 100 : 0} tone={p.conductedClasses >= p.scheduledClasses ? "green" : "brand"} />
        </div>
        {p.status === "due" && <Notice>All your classes for this session are done. The academy has been notified and will record the payment here.</Notice>}
        {p.status === "pending" && <Notice>The payment becomes due once all {p.scheduledClasses} scheduled classes are held.</Notice>}
        {p.paidEarly && <Notice tone="warn">Paid before all scheduled classes were held.</Notice>}
        {p.note && (
          <div>
            <Label>Note from the academy</Label>
            <p className="mt-1 text-sm text-slate-700">{p.note}</p>
          </div>
        )}
        {p.status === "paid" && (
          <div>
            <div className="mb-2"><Label>Payment proof</Label></div>
            <ProofLink proof={p.proof} compact />
          </div>
        )}
      </div>
    </Dialog>
  );
}

export function TeacherPayments() {
  const { data, loading, error, reload } = useAsync(() => api.get("/teacher/payments"), []);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [subject, setSubject] = useState(null);
  const [month, setMonth] = useState(null);
  const [sort, setSort] = useState("new");
  const [openId, setOpenId] = useState(null);
  const all = useMemo(() => data?.payments || [], [data]);
  const subjects = useMemo(() => [...new Set(all.map((p) => p.subject).filter(Boolean))].sort(), [all]);
  const months = useMemo(() => [...new Set(all.map((p) => monthKey(p.sessionStartDate)).filter(Boolean))].sort().reverse(), [all]);
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = all.filter(
      (p) =>
        (status === "all" || p.status === status) &&
        (!subject || p.subject === subject) &&
        (!month || monthKey(p.sessionStartDate) === month) &&
        (!t || `${p.studentName} ${p.studentCode} ${p.subject} ${p.sessionName} ${p.reference}`.toLowerCase().includes(t))
    );
    const by = {
      new: (a, b) => (b.sessionStartDate || "").localeCompare(a.sessionStartDate || ""),
      old: (a, b) => (a.sessionStartDate || "").localeCompare(b.sessionStartDate || ""),
      amount: (a, b) => (b.amount || 0) - (a.amount || 0),
      student: (a, b) => (a.studentName || "").localeCompare(b.studentName || ""),
    }[sort];
    return [...list].sort((a, b) => by(a, b) || (a.studentName || "").localeCompare(b.studentName || ""));
  }, [all, q, status, subject, month, sort]);
  const pg = usePaged(rows, 10, [10, 15, 25]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  const count = (st) => all.filter((p) => p.status === st).length;
  const paid = all.filter((p) => p.status === "paid");
  const total = paid.reduce((a, p) => a + (p.amount || 0), 0);
  const filtered = !!(q || status !== "all" || subject || month);
  const clear = () => {
    setQ("");
    setStatus("all");
    setSubject(null);
    setMonth(null);
  };
  const empty = all.length ? (
    <Empty icon={Wallet} title="No payments match" text="Try another search or filter." action={<Button size="sm" variant="outline" onClick={clear}>Clear filters</Button>} />
  ) : (
    <Empty icon={Wallet} title="No payment records yet" text="A record appears for each student and subject you teach in an academic session." />
  );

  return (
    <>
      <PageHeader title="My payments" subtitle="One record per student and subject session. A payment becomes due once all its scheduled classes are held; the academy pays you outside the portal and records it here." />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={Wallet} label="Received" value={money(total)} hint={`${plural(paid.length, "payment")} recorded`} tone="gold" />
        <StatCard icon={CheckCircle2} label="Paid" value={paid.length} hint="Sessions paid" tone="green" onClick={() => setStatus("paid")} />
        <StatCard icon={AlertTriangle} label="Payment due" value={count("due")} hint="All classes held" tone="red" onClick={() => setStatus("due")} />
        <StatCard icon={Clock} label="Pending" value={count("pending")} hint="Classes still to hold" tone="blue" onClick={() => setStatus("pending")} />
      </div>

      <Card flush>
        {/* Filters */}
        <div className="space-y-3 border-b border-line p-4 sm:px-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <Segmented size="sm" value={status} onChange={setStatus} options={STATUS_TABS.map((t) => ({ ...t, count: t.value === "all" ? all.length : count(t.value) }))} />
            <SearchInput value={q} onChange={setQ} className="w-full lg:w-72" placeholder="Search student, ID or reference…" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Select value={subject} onChange={setSubject} options={subjects.map((x) => ({ value: x, label: x }))} placeholder="All subjects" clearable />
            <Select value={month} onChange={setMonth} options={months.map((m) => ({ value: m, label: monthLabel(m) }))} placeholder="All periods" clearable />
            <Select value={sort} onChange={(v) => setSort(v || "new")} options={SORTS} />
          </div>
          <div className="flex items-center justify-between text-xs text-muted">
            <span>{rows.length === all.length ? plural(all.length, "record") : `${rows.length} of ${plural(all.length, "record")}`}</span>
            {filtered && <button type="button" onClick={clear} className="font-medium text-navy hover:underline">Clear filters</button>}
          </div>
        </div>

        {!rows.length ? (
          empty
        ) : (
          <>
            {/* Phones: cards */}
            <ul className="divide-y divide-line md:hidden">
              {pg.rows.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => setOpenId(p.id)} className="w-full p-4 text-left">
                    <span className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-navy">{p.studentName || plural(p.studentCount, "student")}</span>
                        <span className="block truncate text-xs text-muted">{sessionLabel(p)} · {day(p.sessionStartDate)} – {day(p.sessionEndDate)}</span>
                      </span>
                      <TpBadge status={p.status} />
                    </span>
                    <span className="mt-3 flex items-center gap-3">
                      <span className="flex-1"><ClassesBar p={p} /></span>
                      {p.status === "paid" && <span className="text-sm font-semibold text-navy">{money(p.amount)}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {/* Tablets and up: table */}
            <div className="hidden md:block">
              <Table
                rows={pg.rows}
                minWidth="min-w-[860px]"
                onRowClick={(p) => setOpenId(p.id)}
                columns={[
                  { key: "studentName", label: "Student", render: (p) => (p.studentName ? <span><b className="text-navy">{p.studentName}</b>{p.studentCode && <span className="block text-xs text-muted">{p.studentCode}</span>}</span> : plural(p.studentCount, "student")) },
                  { key: "session", label: "Subject / session", render: (p) => <span><b className="text-navy">{p.subject || p.sessionName}</b>{p.sessionNumber && <span className="block text-xs text-muted">Session {p.sessionNumber}</span>}</span> },
                  { key: "period", label: "Period", render: (p) => <span className="whitespace-nowrap text-sm text-slate-600">{day(p.sessionStartDate)} – {day(p.sessionEndDate)}</span> },
                  { key: "classes", label: "Classes held", render: (p) => <ClassesBar p={p} /> },
                  { key: "status", label: "Status", render: (p) => <span className="flex flex-col items-start gap-0.5"><TpBadge status={p.status} />{p.paidEarly && <span className="text-[11px] text-amber-700">paid early</span>}</span> },
                  { key: "amount", label: "Amount", headClass: "text-right", className: "text-right", render: (p) => (p.status === "paid" ? <span className="whitespace-nowrap"><b className="text-navy">{money(p.amount)}</b><span className="block text-xs text-muted">{day(p.paidOn)}</span></span> : <span className="text-slate-400">—</span>) },
                  { key: "open", label: <span className="sr-only">Details</span>, headClass: "w-24", render: (p) => <Button size="xs" variant="outline" onClick={(e) => { e.stopPropagation(); setOpenId(p.id); }}>View</Button> },
                ]}
              />
            </div>
            {pg.show && <Pager {...pg.pager} />}
          </>
        )}
      </Card>

      <TeacherPaymentDetail p={all.find((x) => x.id === openId)} onClose={() => setOpenId(null)} />
    </>
  );
}
