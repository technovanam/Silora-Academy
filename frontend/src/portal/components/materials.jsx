// ============================================================
// MATERIALS – upload, edit, versions, assign, "opened" tracking,
// preview. Shared by teacher and admin screens.
// ============================================================
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarClock, CheckCircle2, Download, Eye, File, FileArchive, FileAudio, FileImage, FileSpreadsheet, FileText, FileVideo, FolderOpen, History,
  MoreHorizontal, Pencil, Presentation, Trash2, UploadCloud, Users, XCircle, Plus,
} from "lucide-react";
import { api } from "../lib/api.js";
import { saveFile } from "../lib/download.js";
import { fmtDate, fmtDateTime, fmtSize, fromLocalInput, fromNow, toLocalInput } from "../lib/format.js";
import { Badge, Button, Card, Dialog, Empty, ErrorBox, Field, IconButton, Input, Loading, Menu, Notice, Progress, SearchInput, Select, Table, Textarea, cx, useAsync, useUi } from "../ui/index.jsx";

export const ACCEPT = ".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv,.png,.jpg,.jpeg,.gif,.webp,.mp4,.webm,.mp3,.m4a,.zip";

const KIND = {
  PDF: [FileText, "bg-rose-50 text-rose-600"],
  Word: [FileText, "bg-sky-50 text-sky-600"],
  PowerPoint: [Presentation, "bg-orange-50 text-orange-600"],
  Excel: [FileSpreadsheet, "bg-emerald-50 text-emerald-600"],
  CSV: [FileSpreadsheet, "bg-emerald-50 text-emerald-600"],
  Text: [FileText, "bg-slate-100 text-slate-600"],
  Image: [FileImage, "bg-violet-50 text-violet-600"],
  Video: [FileVideo, "bg-indigo-50 text-indigo-600"],
  Audio: [FileAudio, "bg-pink-50 text-pink-600"],
  ZIP: [FileArchive, "bg-amber-50 text-amber-700"],
};
export function FileIcon({ kind, className }) {
  const [Icon, tone] = KIND[kind] || [File, "bg-slate-100 text-slate-500"];
  return (
    <span className={cx("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", tone, className)}>
      <Icon className="h-5 w-5" />
    </span>
  );
}

/** Get a short-lived link and open / download it. */
export async function getMaterialLink(id, { download = false, version } = {}) {
  return api.post(`/materials/${id}/link`, { download, version });
}

/** Students: tell the academy the material was really opened (shown, or fully downloaded). */
export const markMaterialOpened = (id, how) => api.post(`/materials/${id}/opened`, { how }).catch(() => {});

/**
 * Download a material and resolve true only once the file is saved
 * (false if the save dialog was cancelled). Call straight from a click.
 */
export function downloadMaterial(item, { version, onProgress } = {}) {
  return saveFile(async () => (await getMaterialLink(item.id, { download: true, version })).url, item.file?.fileName || item.title, { onProgress });
}

// ---- Preview dialog (PDF / image / video / audio inline) -----------------------------
// onOpened(how): called once the file was actually shown ("view") or saved ("download").
export function PreviewDialog({ item, onClose, onOpened }) {
  const ui = useUi();
  const [link, setLink] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(null);
  const shown = useRef(false);
  useEffect(() => {
    if (!item) return;
    setLink(null);
    setError(null);
    shown.current = false;
    getMaterialLink(item.id, { version: item.version && item.pickVersion ? item.version : undefined })
      .then(setLink)
      .catch(setError);
  }, [item]);
  if (!item) return null;
  const t = link?.contentType || "";
  const viewed = () => {
    if (shown.current) return;
    shown.current = true;
    onOpened?.("view");
  };
  const download = async () => {
    setSaving(0);
    try {
      const saved = await downloadMaterial(item, { version: item.pickVersion ? item.version : undefined, onProgress: setSaving });
      if (saved) {
        onOpened?.("download");
        ui.toast("Downloaded");
      }
    } catch (e) {
      ui.error(e);
    } finally {
      setSaving(null);
    }
  };
  return (
    <Dialog
      open={!!item}
      onClose={onClose}
      title={item.title}
      subtitle={[item.subject, item.file?.kind, fmtSize(item.file?.size)].filter(Boolean).join(" · ")}
      size="xl"
      footer={
        <>
          {link && (
            <a href={link.url} target="_blank" rel="noreferrer" onClick={viewed}>
              <Button variant="outline" icon={Eye}>
                Open in new tab
              </Button>
            </a>
          )}
          <Button icon={Download} onClick={download} loading={saving !== null}>
            {saving ? `Downloading ${saving}%` : "Download"}
          </Button>
        </>
      }
    >
      <ErrorBox error={error} />
      {!link && !error && <Loading label="Opening…" />}
      {link && (
        <div className="overflow-hidden rounded-2xl bg-surface">
          {t.includes("pdf") ? (
            <iframe title={item.title} src={link.url} onLoad={viewed} className="h-[65svh] w-full bg-white" />
          ) : t.startsWith("image/") ? (
            <img src={link.url} alt={item.title} onLoad={viewed} className="mx-auto max-h-[65svh] object-contain" />
          ) : t.startsWith("video/") ? (
            <video src={link.url} controls onLoadedData={viewed} className="max-h-[65svh] w-full bg-black" />
          ) : t.startsWith("audio/") ? (
            <div className="p-8">
              <audio src={link.url} controls onLoadedData={viewed} className="w-full" />
            </div>
          ) : t.startsWith("text/") ? (
            <iframe title={item.title} src={link.url} onLoad={viewed} className="h-[60svh] w-full bg-white" />
          ) : (
            <Empty icon={File} title="Preview not available for this file type" text="Download it to open on your device." />
          )}
        </div>
      )}
      {item.description && <p className="mt-4 whitespace-pre-line text-sm text-muted">{item.description}</p>}
    </Dialog>
  );
}

// ---- File drop zone ---------------------------------------------------------------------
function DropZone({ file, onFile }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]);
      }}
      onClick={() => input.current?.click()}
      className={cx("flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-8 text-center transition", over ? "border-brand bg-brand-soft" : "border-line hover:border-slate-300 hover:bg-surface")}
    >
      <input ref={input} type="file" accept={ACCEPT} className="hidden" onChange={(e) => e.target.files[0] && onFile(e.target.files[0])} />
      {file ? (
        <>
          <CheckCircle2 className="mb-2 h-8 w-8 text-emerald-500" />
          <p className="font-semibold text-navy">{file.name}</p>
          <p className="text-xs text-muted">{fmtSize(file.size)} · click to choose another file</p>
        </>
      ) : (
        <>
          <UploadCloud className="mb-2 h-8 w-8 text-slate-400" />
          <p className="font-semibold text-navy">Drop a file here or click to browse</p>
          <p className="mt-1 text-xs text-muted">PDF, Word, PowerPoint, Excel, images, video, audio or ZIP · up to 50 MB · files are checked for safety</p>
        </>
      )}
    </div>
  );
}

const studentOptions = (students) => students.map((s) => ({ value: s.id, label: s.name, hint: [s.grade, s.board].filter(Boolean).join(" · ") }));

// ---- Upload / edit dialog ------------------------------------------------------------------
export function MaterialDialog({ open, onClose, onSaved, item, mode, students = [], teachers = [], folders = [] }) {
  const ui = useUi();
  const editing = !!item;
  const [f, setF] = useState({});
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setProgress(null);
    setError(null);
    setF(
      item
        ? { title: item.title, subject: item.subject, folder: item.folder, description: item.description, studentIds: item.studentIds || [], when: item.status === "scheduled" ? "later" : "now", publishAt: toLocalInput(item.publishAt), teacherId: item.teacherId }
        : { title: "", subject: "", folder: "", description: "", studentIds: [], when: "now", publishAt: toLocalInput(new Date(Date.now() + 86400000)), teacherId: teachers.length === 1 ? teachers[0].id : null }
    );
  }, [open, item]); // eslint-disable-line react-hooks/exhaustive-deps

  const pool = useMemo(() => (mode === "admin" ? students.filter((s) => !f.teacherId || s.teacherId === f.teacherId) : students), [students, f.teacherId, mode]);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v?.target ? v.target.value : v }));

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const publishAt = f.when === "later" ? fromLocalInput(f.publishAt) : null;
      if (editing) {
        const body = { title: f.title, subject: f.subject, folder: f.folder, description: f.description };
        if (item.status !== "published") body.publishAt = publishAt;
        await api.patch(`/materials/${item.id}`, body);
        const before = [...(item.studentIds || [])].sort().join();
        if (before !== [...f.studentIds].sort().join()) await api.post(`/materials/${item.id}/assign`, { studentIds: f.studentIds });
        ui.toast("Material updated");
      } else {
        if (!file) throw new Error("Choose a file to upload");
        const fd = new FormData();
        fd.append("title", f.title || file.name.replace(/\.[^.]+$/, ""));
        ["subject", "folder", "description"].forEach((k) => fd.append(k, f[k] || ""));
        fd.append("studentIds", JSON.stringify(f.studentIds));
        if (mode === "admin" && f.teacherId) fd.append("teacherId", f.teacherId);
        if (publishAt) fd.append("publishAt", publishAt);
        fd.append("file", file);
        await api.upload("/materials", fd, setProgress);
        ui.toast(publishAt ? `Scheduled for ${fmtDateTime(publishAt)}` : f.studentIds.length ? `Shared with ${f.studentIds.length} student(s)` : "Uploaded");
      }
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      title={editing ? "Edit material" : "Upload material"}
      subtitle={editing ? `Version ${item.version} · ${item.file?.fileName}` : "Students are notified when it's published."}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="mat-form" loading={busy}>
            {editing ? "Save changes" : f.when === "later" ? "Schedule" : "Upload & share"}
          </Button>
        </>
      }
    >
      <form id="mat-form" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        {error && <Notice tone="danger" className="sm:col-span-2">{error}</Notice>}
        {!editing && (
          <div className="sm:col-span-2">
            <DropZone
              file={file}
              onFile={(fl) => {
                setFile(fl);
                if (!f.title) setF((p) => ({ ...p, title: fl.name.replace(/\.[^.]+$/, "") }));
              }}
            />
            {progress !== null && (
              <div className="mt-3 flex items-center gap-3">
                <Progress value={progress} className="flex-1" />
                <span className="w-10 text-right text-xs font-semibold text-muted">{progress}%</span>
              </div>
            )}
          </div>
        )}
        <Field label="Title" required className="sm:col-span-2">
          <Input value={f.title || ""} onChange={set("title")} maxLength={150} required={editing} placeholder="e.g. Chapter 4 worksheet" />
        </Field>
        <Field label="Subject">
          <Input value={f.subject || ""} onChange={set("subject")} maxLength={80} placeholder="e.g. Mathematics" />
        </Field>
        <Field label="Folder" hint={folders.length ? `Existing: ${folders.slice(0, 4).join(", ")}${folders.length > 4 ? "…" : ""}` : "Group related files, e.g. Algebra"}>
          <Input value={f.folder || ""} onChange={set("folder")} maxLength={80} placeholder="e.g. Algebra" list="mat-folders" />
          <datalist id="mat-folders">
            {folders.map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
        </Field>
        {mode === "admin" && (
          <Field label="Teacher" className="sm:col-span-2" hint="Students list is limited to this teacher's students">
            <Select value={f.teacherId} onChange={(v) => setF((p) => ({ ...p, teacherId: v, studentIds: [] }))} options={teachers.map((t) => ({ value: t.id, label: t.name }))} placeholder="Choose a teacher" disabled={editing} clearable={!editing} />
          </Field>
        )}
        <Field label="Assign to students" className="sm:col-span-2" hint="You can change this later">
          <Select multiple value={f.studentIds || []} onChange={set("studentIds")} options={studentOptions(pool)} placeholder="Choose students" searchable />
        </Field>
        <Field label="Description (optional)" className="sm:col-span-2">
          <Textarea rows={2} value={f.description || ""} onChange={set("description")} maxLength={1000} placeholder="What should students do with this?" />
        </Field>
        {(!editing || item.status !== "published") && (
          <div className="space-y-3 sm:col-span-2">
            <span className="block text-sm font-medium text-slate-700">Publish</span>
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                ["now", "Publish now", "Students see it right away"],
                ["later", "Schedule", "Publish automatically later"],
              ].map(([v, l, d]) => (
                <button key={v} type="button" onClick={() => set("when")(v)} className={cx("rounded-2xl border p-3.5 text-left transition", f.when === v ? "border-brand bg-brand-soft ring-2 ring-brand/30" : "border-line hover:border-slate-300")}>
                  <span className="block text-sm font-semibold text-navy">{l}</span>
                  <span className="block text-xs text-muted">{d}</span>
                </button>
              ))}
            </div>
            {f.when === "later" && (
              <Field label="Publish on">
                <Input type="datetime-local" value={f.publishAt || ""} onChange={set("publishAt")} required />
              </Field>
            )}
          </div>
        )}
      </form>
    </Dialog>
  );
}

// ---- Versions dialog --------------------------------------------------------------------
export function VersionsDialog({ item, onClose, onSaved }) {
  const ui = useUi();
  const detail = useAsync(() => (item ? api.get(`/materials/${item.id}`) : Promise.resolve(null)), [item?.id]);
  const [file, setFile] = useState(null);
  const [note, setNote] = useState("");
  const [progress, setProgress] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setFile(null);
    setNote("");
    setProgress(null);
  }, [item]);
  if (!item) return null;
  const upload = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("note", note);
      fd.append("file", file);
      const r = await api.upload(`/materials/${item.id}/version`, fd, setProgress);
      ui.toast(`Version ${r.version} uploaded`);
      setFile(null);
      setNote("");
      setProgress(null);
      detail.reload(true);
      onSaved?.();
    } catch (e) {
      ui.error(e);
    } finally {
      setBusy(false);
    }
  };
  const openVersion = async (v) => {
    const l = await getMaterialLink(item.id, { version: v.version, download: true });
    window.location.href = l.url;
  };
  const versions = [...(detail.data?.material?.versions || [])].reverse();
  return (
    <Dialog open={!!item} onClose={onClose} title="Version history" subtitle={item.title} size="lg">
      <div className="space-y-5">
        <div className="rounded-2xl border border-line p-4">
          <p className="mb-3 text-sm font-semibold text-navy">Upload a new version</p>
          <DropZone file={file} onFile={setFile} />
          {file && (
            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed? (optional)" maxLength={300} />
              <Button onClick={upload} loading={busy} icon={UploadCloud}>
                Upload version
              </Button>
            </div>
          )}
          {progress !== null && <Progress value={progress} className="mt-3" />}
          <p className="mt-2 text-xs text-muted">Assigned students are notified. Earlier versions stay in the history.</p>
        </div>
        {detail.loading ? (
          <Loading />
        ) : (
          <ul className="space-y-2">
            {versions.map((v, i) => (
              <li key={v.version} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line px-4 py-3">
                <Badge tone={i === 0 ? "green" : "gray"}>v{v.version}{i === 0 ? " · current" : ""}</Badge>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{v.fileName}</span>
                  <span className="block text-xs text-muted">
                    {fmtDateTime(v.uploadedAt)} · {fmtSize(v.size)}
                    {v.note ? ` · ${v.note}` : ""}
                  </span>
                </span>
                <IconButton icon={Download} label="Download this version" onClick={() => openVersion(v)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

// ---- Tracking dialog ("opened", never "read") ------------------------------------------------
export function TrackingDialog({ item, onClose }) {
  const { data, loading, error } = useAsync(() => (item ? api.get(`/materials/${item.id}/tracking`) : Promise.resolve(null)), [item?.id]);
  if (!item) return null;
  const rows = data?.rows || [];
  const opened = rows.filter((r) => r.status === "opened").length;
  return (
    <Dialog open={!!item} onClose={onClose} title="Who opened this material" subtitle={item.title} size="lg">
      <ErrorBox error={error} />
      {loading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty icon={Users} title="Not assigned to any students yet" />
      ) : (
        <>
          <div className="mb-4 flex items-center gap-3">
            <Progress value={(opened / rows.length) * 100} tone="green" className="flex-1" />
            <span className="text-sm font-semibold text-navy">
              {opened} of {rows.length} opened
            </span>
          </div>
          <Notice className="mb-4">“Opened” means the student opened or downloaded the file. It doesn't confirm they read it.</Notice>
          <Card flush>
            <Table
              rowKey="studentId"
              rows={rows}
              columns={[
                { key: "studentName", label: "Student", render: (r) => <span className="font-medium">{r.studentName}</span> },
                {
                  key: "status",
                  label: "Status",
                  render: (r) =>
                    r.status === "opened" ? (
                      <Badge tone="green">
                        <CheckCircle2 className="h-3 w-3" /> Opened
                      </Badge>
                    ) : (
                      <Badge tone="amber">
                        <XCircle className="h-3 w-3" /> Not opened
                      </Badge>
                    ),
                },
                { key: "firstOpenedAt", label: "First opened", render: (r) => (r.firstOpenedAt ? fmtDateTime(r.firstOpenedAt) : "—") },
                { key: "lastOpenedAt", label: "Last opened", render: (r) => (r.lastOpenedAt ? fromNow(r.lastOpenedAt) : "—") },
                { key: "openCount", label: "Opens / downloads", render: (r) => `${r.openCount} / ${r.downloadCount}` },
              ]}
            />
          </Card>
        </>
      )}
    </Dialog>
  );
}

// ---- Manager (list + actions) -------------------------------------------------------------
export function MaterialsManager({ mode, students = [], teachers = [] }) {
  const ui = useUi();
  const [q, setQ] = useState("");
  const [folder, setFolder] = useState(null);
  const [status, setStatus] = useState(null);
  const [teacherId, setTeacherId] = useState(null);
  const [dialog, setDialog] = useState(null); // {type, item}
  const { data, loading, error, reload } = useAsync(() => api.get("/materials", { teacherId: mode === "admin" ? teacherId : undefined }), [teacherId]);
  const list = useMemo(() => {
    let l = data?.materials || [];
    if (folder) l = l.filter((m) => m.folder === folder);
    if (status) l = l.filter((m) => m.status === status);
    if (q) l = l.filter((m) => `${m.title} ${m.subject} ${m.folder} ${m.teacherName} ${m.file?.fileName}`.toLowerCase().includes(q.toLowerCase()));
    return l;
  }, [data, folder, status, q]);

  const remove = (m) =>
    ui.confirm({
      title: "Delete this material?",
      message: `"${m.title}" and all its versions will be removed for every student. This can't be undone.`,
      danger: true,
      confirmLabel: "Delete",
      onConfirm: async () => {
        await api.del(`/materials/${m.id}`);
        ui.toast("Material deleted");
        reload(true);
      },
    });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput value={q} onChange={setQ} placeholder="Search materials…" className="w-full sm:w-72" />
        {mode === "admin" && <Select className="w-full sm:w-52" value={teacherId} onChange={setTeacherId} options={teachers.map((t) => ({ value: t.id, label: t.name }))} placeholder="All teachers" clearable />}
        <Select className="w-full sm:w-44" value={folder} onChange={setFolder} options={(data?.folders || []).map((f) => ({ value: f, label: f, icon: <FolderOpen className="h-4 w-4 text-slate-400" /> }))} placeholder="All folders" clearable emptyText="No folders yet" />
        <Select
          className="w-full sm:w-40"
          value={status}
          onChange={setStatus}
          options={[
            { value: "published", label: "Published" },
            { value: "scheduled", label: "Scheduled" },
          ]}
          placeholder="Any status"
          clearable
        />
        <div className="flex-1" />
        <Button icon={Plus} onClick={() => setDialog({ type: "edit" })}>
          Upload material
        </Button>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      <Card padded={false}>
        {loading ? (
          <Loading />
        ) : list.length === 0 ? (
          <Empty icon={FolderOpen} title={data?.materials?.length ? "No materials match" : "No materials yet"} text="Upload worksheets, notes, slides or videos and share them with your students." action={<Button icon={Plus} onClick={() => setDialog({ type: "edit" })}>Upload material</Button>} />
        ) : (
          <ul className="divide-y divide-line">
            {list.map((m) => (
              <li key={m.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:px-6">
                <button className="flex min-w-0 flex-1 items-center gap-4 text-left" onClick={() => setDialog({ type: "preview", item: m })}>
                  <FileIcon kind={m.file?.kind} />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-semibold text-navy">{m.title}</span>
                      {m.status === "scheduled" ? (
                        <Badge tone="violet">
                          <CalendarClock className="h-3 w-3" /> {fmtDateTime(m.publishAt)}
                        </Badge>
                      ) : null}
                      {m.version > 1 && <Badge>v{m.version}</Badge>}
                    </span>
                    <span className="block truncate text-sm text-muted">
                      {[m.subject, m.folder, mode === "admin" && m.teacherName, m.file?.kind, fmtSize(m.file?.size)].filter(Boolean).join(" · ")}
                    </span>
                    <span className="block text-xs text-slate-400">Updated {fmtDate(m.updatedAt)}</span>
                  </span>
                </button>
                <div className="flex items-center gap-3 sm:justify-end">
                  <button onClick={() => setDialog({ type: "tracking", item: m })} className="min-w-[120px] rounded-xl px-3 py-1.5 text-left transition hover:bg-surface" title="See who opened it">
                    <span className="block text-xs text-muted">Opened</span>
                    <span className="flex items-center gap-2">
                      <Progress value={m.assignedCount ? (m.openedCount / m.assignedCount) * 100 : 0} tone="green" className="w-14" />
                      <span className="text-sm font-semibold text-navy">
                        {m.openedCount}/{m.assignedCount}
                      </span>
                    </span>
                  </button>
                  <Menu
                    trigger={<IconButton icon={MoreHorizontal} label="Actions" />}
                    items={[
                      { label: "Preview", icon: Eye, onClick: () => setDialog({ type: "preview", item: m }) },
                      { label: "Edit & assign", icon: Pencil, onClick: () => setDialog({ type: "edit", item: m }) },
                      { label: "Versions", icon: History, onClick: () => setDialog({ type: "versions", item: m }) },
                      { label: "Who opened it", icon: Users, onClick: () => setDialog({ type: "tracking", item: m }) },
                      { label: "Delete", icon: Trash2, danger: true, onClick: () => remove(m) },
                    ]}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <MaterialDialog open={dialog?.type === "edit"} item={dialog?.item} onClose={() => setDialog(null)} onSaved={() => reload(true)} mode={mode} students={students} teachers={teachers} folders={data?.folders || []} />
      <VersionsDialog item={dialog?.type === "versions" ? dialog.item : null} onClose={() => setDialog(null)} onSaved={() => reload(true)} />
      <TrackingDialog item={dialog?.type === "tracking" ? dialog.item : null} onClose={() => setDialog(null)} />
      <PreviewDialog item={dialog?.type === "preview" ? dialog.item : null} onClose={() => setDialog(null)} />
    </>
  );
}
