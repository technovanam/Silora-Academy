import React, { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, ClipboardCheck, Copy, Download, Loader2, FileText, FileVideo, Pencil, Play, Star, Trash2, UploadCloud, Clock } from "lucide-react";
import { api } from "../../lib/api.js";
import { fmtDate, fmtDateTime, fmtSize, fmtWeek, fromNow } from "../../lib/format.js";
import { Badge, Button, Card, Dialog, Empty, ErrorBox, Field, IconButton, Input, Loading, Notice, PageHeader, Progress, SearchInput, Segmented, Select, StatCard, Table, Textarea, cx, useAsync, useUi } from "../../ui/index.jsx";
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

// ---- Recordings -------------------------------------------------------------------------
// "[02:14] Name (Teacher): text" lines -> time (click to jump), speaker, text
const LINE = /^\[(\d+(?::\d{2}){1,2})\]\s+([^:]{1,80}):\s?(.*)$/;
const toSec = (t) => t.split(":").reduce((a, b) => a * 60 + Number(b), 0);
function TranscriptView({ text, onSeek }) {
  return (
    <div className="space-y-2.5">
      {text.split("\n").map((line, i) => {
        const m = line.match(LINE);
        if (!m) return line.trim() ? <p key={i} className="whitespace-pre-line">{line}</p> : null;
        const teacher = /\((Teacher|Admin)\)$/.test(m[2]);
        return (
          <p key={i}>
            <button type="button" onClick={() => onSeek(toSec(m[1]))} title="Play from here" className="mr-2 rounded-md bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-500 ring-1 ring-slate-200 transition hover:text-navy hover:ring-slate-300">
              {m[1]}
            </button>
            <span className={cx("font-semibold", teacher ? "text-navy" : "text-[#2a78d6]")}>{m[2]}:</span> {m[3]}
          </p>
        );
      })}
    </div>
  );
}

function RecordingPlayer({ id, onClose, onChanged }) {
  const ui = useUi();
  const { data, loading, error, reload } = useAsync(() => (id ? api.get(`/admin/recordings/${id}`) : Promise.resolve(null)), [id]);
  const [url, setUrl] = useState(null);
  const videoRef = useRef(null);
  const status = data?.recording?.transcriptStatus;
  // While the automatic transcript is being made, check back every 15 s
  useEffect(() => {
    if (status !== "processing") return undefined;
    const t = setInterval(() => reload(true), 15000);
    return () => clearInterval(t);
  }, [status, reload]);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  useEffect(() => {
    setUrl(null);
    setEditing(false);
    if (id) api.post(`/admin/recordings/${id}/link`, {}).then((r) => setUrl(r.url)).catch(ui.error);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!id) return null;
  const r = data?.recording;
  const download = async () => {
    const l = await api.post(`/admin/recordings/${id}/link`, { download: true });
    window.location.href = l.url;
  };
  const saveTranscript = async () => {
    try {
      await api.put(`/admin/recordings/${id}/transcript`, { transcript: text });
      ui.toast("Transcript saved");
      setEditing(false);
      onChanged();
      onClose();
    } catch (e) {
      ui.error(e);
    }
  };
  return (
    <Dialog open onClose={onClose} title={r?.title || "Recording"} subtitle={r && `${fmtDateTime(r.classStartAt)} · ${r.teacherName} · ${r.students.join(", ")}`} size="xl" footer={<Button variant="outline" icon={Download} onClick={download}>Download</Button>}>
      <ErrorBox error={error} />
      {loading ? (
        <Loading />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
          <div className="overflow-hidden rounded-2xl bg-black">{url ? r?.file?.contentType?.startsWith("audio") ? <audio src={url} controls className="w-full p-6" /> : <video ref={videoRef} src={url} controls className="aspect-video w-full" /> : <Loading className="text-white/70" />}</div>
          <div className="flex min-h-0 flex-col">
            <div className="mb-2 flex items-center justify-between">
              <p className="flex items-center gap-2 text-sm font-bold text-navy">
                Transcript
                {r?.transcriptAuto && !editing && <Badge tone="gray">Automatic</Badge>}
              </p>
              {!editing && (
                <div className="flex items-center gap-1">
                {r?.transcript && <Button size="xs" variant="ghost" icon={Copy} onClick={() => navigator.clipboard.writeText(r.transcript).then(() => ui.toast("Transcript copied"))}>Copy</Button>}
                {r?.transcript && (
                  <Button size="xs" variant="ghost" icon={FileText} onClick={() => {
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(new Blob([`${r.title}\n${fmtDateTime(r.classStartAt)} · ${r.teacherName} · ${r.students.join(", ")}\n\n${r.transcript}\n`], { type: "text/plain" }));
                    a.download = `${r.title.replace(/[^\w\- ]+/g, "").trim() || "transcript"} - transcript.txt`;
                    a.click();
                    URL.revokeObjectURL(a.href);
                  }}>.txt</Button>
                )}
                <Button
                  size="xs"
                  variant="ghost"
                  icon={Pencil}
                  onClick={() => {
                    setText(r?.transcript || "");
                    setEditing(true);
                  }}
                >
                  Edit
                </Button>
                </div>
              )}
            </div>
            {!editing && status === "processing" && (
              <Notice className="mb-2">
                <span className="inline-flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Transcribing what everyone said… this page updates by itself.</span>
              </Notice>
            )}
            {!editing && status === "partial" && <Notice tone="warn" className="mb-2">Part of the audio couldn't be transcribed. The rest is shown below.</Notice>}
            {editing ? (
              <>
                <Textarea rows={14} value={text} onChange={(e) => setText(e.target.value)} className="flex-1 font-mono text-xs" />
                <div className="mt-2 flex gap-2">
                  <Button size="sm" onClick={saveTranscript}>Save</Button>
                  <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
                </div>
              </>
            ) : (
              <div data-lenis-prevent className="scrollbar-thin max-h-[50svh] flex-1 overflow-y-auto rounded-2xl bg-surface p-4 text-sm leading-relaxed text-ink">
                {r?.transcript ? (
                  <TranscriptView text={r.transcript} onSeek={(sec) => videoRef.current && ((videoRef.current.currentTime = sec), videoRef.current.play().catch(() => {}))} />
                ) : (
                  <span className="text-muted">{status === "processing" ? "The transcript will appear here when it's ready." : "No transcript for this recording. Nobody spoke with their mic on, or transcription isn't set up. You can paste one with Edit."}</span>
                )}
              </div>
            )}
            <p className="mt-3 text-xs text-rose-600">Deleted automatically {fmtDateTime(r?.deleteAt)}</p>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function UploadRecording({ open, onClose, onSaved }) {
  const ui = useUi();
  const meetings = useAsync(() => (open ? api.get("/meetings", { to: new Date().toISOString() }) : Promise.resolve(null)), [open]);
  const [meetingId, setMeetingId] = useState(null);
  const [file, setFile] = useState(null);
  const [transcript, setTranscript] = useState(null);
  const [progress, setProgress] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const trRef = useRef(null);
  useEffect(() => {
    if (open) {
      setMeetingId(null);
      setFile(null);
      setTranscript(null);
      setProgress(null);
    }
  }, [open]);
  const save = async () => {
    if (!meetingId || !file) return ui.error(new Error("Choose the class and the recording file"));
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("meetingId", meetingId);
      fd.append("file", file);
      if (transcript) fd.append("transcript", transcript);
      await api.upload("/admin/recordings", fd, setProgress);
      ui.toast("Recording uploaded");
      onSaved();
      onClose();
    } catch (e) {
      ui.error(e);
    } finally {
      setBusy(false);
    }
  };
  const past = (meetings.data?.meetings || []).filter((m) => m.status !== "cancelled").reverse().slice(0, 100);
  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      title="Upload a recording"
      subtitle="For classes recorded outside the classroom (e.g. on a phone). It's deleted automatically 7 days after the class."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} loading={busy} icon={UploadCloud}>Upload</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Class" required>
          <Select value={meetingId} onChange={setMeetingId} searchable options={past.map((m) => ({ value: m.id, label: m.title, hint: `${fmtDateTime(m.startAt)} · ${m.teacherName}` }))} placeholder="Choose the class" />
        </Field>
        <Field label="Recording (mp4, webm, mp3, m4a, wav)" required>
          <input ref={fileRef} type="file" accept=".mp4,.webm,.mp3,.m4a,.wav" className="hidden" onChange={(e) => setFile(e.target.files[0])} />
          <Button variant="outline" icon={FileVideo} onClick={() => fileRef.current.click()} className="w-full justify-start">
            {file ? `${file.name} · ${fmtSize(file.size)}` : "Choose file"}
          </Button>
        </Field>
        <Field label="Transcript (optional .txt, .vtt, .srt)">
          <input ref={trRef} type="file" accept=".txt,.vtt,.srt" className="hidden" onChange={(e) => setTranscript(e.target.files[0])} />
          <Button variant="outline" icon={FileText} onClick={() => trRef.current.click()} className="w-full justify-start">
            {transcript ? transcript.name : "Choose transcript"}
          </Button>
        </Field>
        {progress !== null && <Progress value={progress} />}
      </div>
    </Dialog>
  );
}

export function AdminRecordings() {
  const ui = useUi();
  const [q, setQ] = useState("");
  const [play, setPlay] = useState(null);
  const [upload, setUpload] = useState(false);
  const { data, loading, error, reload } = useAsync(() => api.get("/admin/recordings"), []);
  const list = (data?.recordings || []).filter((r) => !q || `${r.title} ${r.teacherName} ${r.students.join(" ")}`.toLowerCase().includes(q.toLowerCase()));
  const remove = (r) =>
    ui.confirm({
      title: "Delete recording?",
      message: `The recording of "${r.title}" and its transcript will be deleted now. This can't be undone.`,
      danger: true,
      confirmLabel: "Delete",
      onConfirm: async () => {
        await api.del(`/admin/recordings/${r.id}`);
        ui.toast("Recording deleted");
        reload(true);
      },
    });
  return (
    <>
      <PageHeader title="Class recordings" subtitle={`Only admins with the recordings permission can see these. Each recording is deleted ${data?.retentionDays || 7} days after the class. Viewing is logged.`} actions={<Button icon={UploadCloud} onClick={() => setUpload(true)}>Upload recording</Button>} />
      <Notice className="mb-4">Every class is recorded automatically once the teacher joins, including the whiteboard. Teachers and students don't see a recording indicator; only admins can watch recordings here. Needs LiveKit Egress (see <code>livekit/README.md</code>).</Notice>
      <div className="mb-4">
        <SearchInput value={q} onChange={setQ} className="w-full sm:w-72" />
      </div>
      <ErrorBox error={error} onRetry={reload} />
      <Card flush>
        {loading ? (
          <Loading />
        ) : (
          <Table
            rows={list}
            onRowClick={(r) => setPlay(r.id)}
            empty={<Empty icon={FileVideo} title="No recordings" text="Recordings appear here after a class is recorded." />}
            columns={[
              {
                key: "title",
                label: "Class",
                render: (r) => (
                  <span className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                      <Play className="h-4 w-4" />
                    </span>
                    <span>
                      <span className="block font-semibold text-navy">{r.title}</span>
                      <span className="block text-xs text-muted">{r.students.join(", ")}</span>
                    </span>
                  </span>
                ),
              },
              { key: "teacherName", label: "Teacher" },
              { key: "classStartAt", label: "Class date", render: (r) => fmtDateTime(r.classStartAt) },
              { key: "size", label: "Size", render: (r) => fmtSize(r.file.size) },
              { key: "tr", label: "Transcript", render: (r) => (r.transcriptStatus === "processing" ? <Badge tone="amber">Transcribing…</Badge> : r.hasTranscript ? <Badge tone="green">Ready</Badge> : <Badge>None</Badge>) },
              { key: "deleteAt", label: "Auto-delete", render: (r) => <span className={cx("text-sm", new Date(r.deleteAt) - Date.now() < 86400000 * 2 && "font-semibold text-rose-600")}>{fmtDate(r.deleteAt)}</span> },
              { key: "x", label: "", render: (r) => <IconButton icon={Trash2} label="Delete" tone="danger" onClick={(e) => { e.stopPropagation(); remove(r); }} /> },
            ]}
          />
        )}
      </Card>
      <RecordingPlayer id={play} onClose={() => setPlay(null)} onChanged={() => reload(true)} />
      <UploadRecording open={upload} onClose={() => setUpload(false)} onSaved={() => reload(true)} />
    </>
  );
}
