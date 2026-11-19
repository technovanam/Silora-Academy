import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, ClipboardCheck, Download, Pencil, Star, Clock } from "lucide-react";
import { api } from "../../lib/api.js";
import { fmtDateTime, fmtWeek, fromNow } from "../../lib/format.js";
import { Badge, Button, Card, Dialog, Empty, ErrorBox, Field, IconButton, Input, Loading, PageHeader, SearchInput, Segmented, Select, StatCard, Table, Textarea, useAsync, useUi } from "../../ui/index.jsx";
import { MaterialsManager } from "../../components/materials.jsx";

// ---- Materials ---------------------------------------------------------------------
export function AdminMaterials() {
  const dir = useAsync(() => api.get("/admin/directory"), []);
  return (
    <>
      <PageHeader title="Materials" subtitle="Every teacher's materials, with “opened” tracking for each student." />
      {dir.loading ? <Loading /> : <MaterialsManager mode="admin" students={dir.data?.students || []} teachers={dir.data?.teachers || []} />}
    </>
  );
}

// ---- Attendance -----------------------------------------------------------------------
const STATUS = {
  submitted: ["green", "Submitted"],
  late: ["amber", "Late"],
  corrected: ["blue", "Corrected"],
  open: ["gold", "Not yet"],
  missing: ["red", "Missing"],
};
const WEEKEND = { yes: "Yes", partial: "Partly", no: "No" };
const shift = (w, n) => {
  const d = new Date(`${w}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n * 7);
  return d.toISOString().slice(0, 10);
};

function CorrectionDialog({ row, onClose, onSaved }) {
  const ui = useUi();
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (row) {
      const e = row.entry || {};
      setF({ weekendAttendance: e.weekendAttendance || "yes", classesAttended: e.classesAttended ?? 0, lessonsCovered: e.lessonsCovered || "", rating: e.rating || 0, review: e.review || "", remarks: e.remarks || "", reason: "" });
    }
  }, [row]);
  if (!row) return null;
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v?.target ? v.target.value : v }));
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.put(`/admin/attendance/${row.studentId}/${row.weekStart}`, { ...f, classesAttended: Number(f.classesAttended) });
      ui.toast("Saved – the change is recorded in the audit log");
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
      title={row.entry ? "Correct attendance" : "Fill in attendance"}
      subtitle={`${row.studentName} · ${fmtWeek(row.weekStart)}`}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="att-fix" loading={busy}>Save correction</Button>
        </>
      }
    >
      <form id="att-fix" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <Field label="Weekend attendance">
          <Select value={f.weekendAttendance} onChange={set("weekendAttendance")} options={Object.entries(WEEKEND).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="Classes attended">
          <Input type="number" min={0} max={50} value={f.classesAttended} onChange={set("classesAttended")} />
        </Field>
        <Field label="Lessons covered" required className="sm:col-span-2">
          <Textarea rows={2} value={f.lessonsCovered} onChange={set("lessonsCovered")} required />
        </Field>
        <Field label="Rating">
          <Select value={f.rating} onChange={set("rating")} options={[0, 1, 2, 3, 4, 5].map((n) => ({ value: n, label: n ? "★".repeat(n) : "No rating" }))} />
        </Field>
        <div />
        <Field label="Review" className="sm:col-span-2">
          <Textarea rows={2} value={f.review} onChange={set("review")} />
        </Field>
        <Field label="Remarks" className="sm:col-span-2">
          <Textarea rows={2} value={f.remarks} onChange={set("remarks")} />
        </Field>
        <Field label="Reason for the correction" required className="sm:col-span-2" hint="Saved in the audit log. The student sees that the academy reviewed this week.">
          <Input value={f.reason} onChange={set("reason")} required maxLength={500} placeholder="e.g. Parent confirmed 2 classes by phone" />
        </Field>
      </form>
    </Dialog>
  );
}

export function AdminAttendance() {
  const ui = useUi();
  const [params] = useSearchParams();
  const [week, setWeek] = useState(params.get("week") || null);
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");
  const [view, setView] = useState(null);
  const [fix, setFix] = useState(null);
  const { data, loading, error, reload } = useAsync(() => api.get("/admin/attendance", { weekStart: week }), [week]);
  const w = data?.weekStart;
  const rows = (data?.rows || []).filter((r) => (status === "all" ? true : status === "pending" ? ["open", "missing"].includes(r.status) : ["submitted", "late", "corrected"].includes(r.status)) && (!q || `${r.studentName} ${r.teacherName}`.toLowerCase().includes(q.toLowerCase())));
  const st = data?.stats;
  const exportCsv = () => api.download("/admin/attendance", { weekStart: w, format: "csv" }).catch(ui.error);

  return (
    <>
      <PageHeader title="Weekly attendance" subtitle="Forms submitted by students. Teachers don't have access to attendance." actions={<Button variant="outline" icon={Download} onClick={exportCsv} disabled={!w}>Export CSV</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-2xl border border-line bg-white px-1 py-1">
          <IconButton icon={ChevronLeft} label="Previous week" onClick={() => setWeek(shift(w, -1))} />
          <span className="min-w-[190px] text-center text-sm font-semibold text-navy">{w ? fmtWeek(w) : "…"}</span>
          <IconButton icon={ChevronRight} label="Next week" onClick={() => setWeek(shift(w, 1))} disabled={!w || w >= data?.currentWeek} />
        </div>
        {w !== data?.currentWeek && (
          <Button size="sm" variant="ghost" onClick={() => setWeek(null)}>
            This week
          </Button>
        )}
        <div className="flex-1" />
        <SearchInput value={q} onChange={setQ} className="w-full sm:w-64" placeholder="Search student or teacher…" />
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {st && (
        <div className="mb-4 grid gap-4 sm:grid-cols-3">
          <StatCard icon={ClipboardCheck} label="Submitted" value={`${st.submitted}/${st.total}`} tone="green" hint={st.total ? `${Math.round((st.submitted / st.total) * 100)}%` : ""} />
          <StatCard icon={Clock} label="Waiting" value={st.pending} tone="red" />
          <StatCard icon={Star} label="Submitted late" value={st.late} tone="violet" />
        </div>
      )}
      <Segmented
        className="mb-4"
        value={status}
        onChange={setStatus}
        options={[
          { value: "all", label: "All" },
          { value: "done", label: "Submitted" },
          { value: "pending", label: "Not submitted" },
        ]}
      />
      <Card flush>
        {loading ? (
          <Loading />
        ) : (
          <Table
            rows={rows}
            onRowClick={(r) => (r.entry ? setView(r) : setFix(r))}
            empty={<Empty icon={ClipboardCheck} title="No students match" />}
            columns={[
              { key: "studentName", label: "Student", render: (r) => <span className="font-semibold text-navy">{r.studentName}</span> },
              { key: "teacherName", label: "Teacher", render: (r) => r.teacherName || "—" },
              { key: "status", label: "Status", render: (r) => <Badge tone={STATUS[r.status][0]}>{STATUS[r.status][1]}</Badge> },
              { key: "weekend", label: "Weekend", render: (r) => WEEKEND[r.entry?.weekendAttendance] || "—" },
              { key: "classes", label: "Classes", render: (r) => r.entry?.classesAttended ?? "—" },
              { key: "lessons", label: "Lessons covered", className: "max-w-[260px]", render: (r) => <span className="line-clamp-1">{r.entry?.lessonsCovered || "—"}</span> },
              { key: "rating", label: "Rating", render: (r) => (r.entry?.rating ? <span className="text-brand">{"★".repeat(r.entry.rating)}</span> : "—") },
              { key: "submittedAt", label: "Submitted", render: (r) => (r.entry ? fromNow(r.entry.submittedAt) : "—") },
            ]}
          />
        )}
      </Card>

      <Dialog
        open={!!view}
        onClose={() => setView(null)}
        title={view?.studentName}
        subtitle={view && fmtWeek(view.weekStart)}
        footer={
          <Button
            variant="outline"
            icon={Pencil}
            onClick={() => {
              setFix(view);
              setView(null);
            }}
          >
            Correct entry
          </Button>
        }
      >
        {view?.entry && (
          <dl className="grid gap-4 sm:grid-cols-2">
            <D label="Status" value={<Badge tone={STATUS[view.status][0]}>{STATUS[view.status][1]}</Badge>} />
            <D label="Submitted" value={fmtDateTime(view.entry.submittedAt)} />
            <D label="Weekend attendance" value={WEEKEND[view.entry.weekendAttendance]} />
            <D label="Classes attended" value={view.entry.classesAttended} />
            <D label="Lessons covered" value={view.entry.lessonsCovered} wide />
            <D label="Rating" value={view.entry.rating ? "★".repeat(view.entry.rating) : "—"} />
            <D label="Review" value={view.entry.review} wide />
            <D label="Remarks" value={view.entry.remarks} wide />
            {view.entry.correctedAt && <D label="Correction" value={`${view.entry.correctedByName}, ${fmtDateTime(view.entry.correctedAt)}: ${view.entry.correctionReason}`} wide />}
            {view.entry.history?.length > 0 && (
              <D
                label="History"
                wide
                value={
                  <ul className="space-y-1 text-sm">
                    {view.entry.history.map((h, i) => (
                      <li key={i} className="text-muted">
                        {fmtDateTime(h.at)} – {h.action.replace(/_/g, " ")}
                        {h.reason ? ` (${h.reason})` : ""}
                      </li>
                    ))}
                  </ul>
                }
              />
            )}
          </dl>
        )}
      </Dialog>
      <CorrectionDialog row={fix} onClose={() => setFix(null)} onSaved={() => reload(true)} />
    </>
  );
}

function D({ label, value, wide }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-line text-[15px] text-ink">{value || value === 0 ? value : "—"}</dd>
    </div>
  );
}

// "[02:14] Name (Teacher): text" lines -> time (click to jump), speaker, text
const LINE = /^\[(\d+(?::\d{2}){1,2})\]\s+([^:]{1,80}):\s?(.*)$/;
