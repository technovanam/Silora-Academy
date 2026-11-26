// ---- Students: recordings of their own classes ---------------------------------------
// Watch, download or delete (from their own list only). Each student has a fixed
// amount of space; recordings that don't fit wait until older ones are deleted.
import React, { useState } from "react";
import { Clock, Download, HardDrive, Hourglass, Play, Trash2, Video } from "lucide-react";
import { api } from "../lib/api.js";
import { saveFile } from "../lib/download.js";
import { fmtDate, fmtDateTime, fmtSize, fmtTime, plural } from "../lib/format.js";
import { Badge, Button, Card, Dialog, Empty, ErrorBox, IconButton, Loading, Notice, PageHeader, Progress, SearchInput, Select, StatCard, Table, useAsync, useUi } from "../ui/index.jsx";

const dur = (s) => {
  if (!s) return "—";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h} h ${m} min` : m ? `${m} min ${sec} s` : `${sec} s`;
};

export function StudentRecordings() {
  const ui = useUi();
  const [q, setQ] = useState("");
  const [subject, setSubject] = useState(null);
  const [playing, setPlaying] = useState(null); // { rec, url }
  const [saving, setSaving] = useState({}); // id → download %
  const { data, loading, error, reload } = useAsync(() => api.get("/recordings"), []);
  const all = data?.recordings || [];
  const subjects = [...new Set(all.map((r) => r.subject).filter(Boolean))];
  const list = all.filter((r) => (!subject || r.subject === subject) && (!q || `${r.title} ${r.subject} ${r.teacherName}`.toLowerCase().includes(q.toLowerCase())));

  const watch = async (rec) => {
    try {
      const r = await api.get(`/recordings/${rec.id}/url`);
      setPlaying({ rec, url: r.url });
    } catch (e) {
      ui.error(e);
    }
  };

  const download = async (rec) => {
    if (saving[rec.id] !== undefined) return;
    setSaving((s) => ({ ...s, [rec.id]: 0 }));
    let link = null;
    try {
      const fileName = `${rec.title || "class"} ${String(rec.startedAt).slice(0, 10)}.webm`.replace(/[\\/:*?"<>|]+/g, "");
      const saved = await saveFile(
        async () => {
          link = await api.get(`/recordings/${rec.id}/url`, { download: 1 });
          return link.url;
        },
        fileName,
        { onProgress: (p) => setSaving((s) => ({ ...s, [rec.id]: p })) }
      );
      if (saved) ui.toast("Recording downloaded");
    } catch (e) {
      // The video store may not allow downloading inside the page – open it instead
      if (e instanceof TypeError && link?.url) window.open(link.url, "_blank", "noopener");
      else ui.error(e);
    } finally {
      setSaving(({ [rec.id]: _, ...rest }) => rest);
    }
  };

  const remove = (rec) =>
    ui.confirm({
      title: "Delete this recording?",
      message: `"${rec.title}" (${fmtDateTime(rec.startedAt)}) will be removed from your recordings and its space freed. You can't get it back.`,
      danger: true,
      confirmLabel: "Delete",
      onConfirm: async () => {
        await api.del(`/recordings/${rec.id}`);
        ui.toast("Recording deleted");
        if (playing?.rec.id === rec.id) setPlaying(null);
        reload(true);
      },
    });

  const used = data?.usedBytes || 0;
  const quota = data?.quotaBytes || 1;
  const pct = Math.min(100, (used / quota) * 100);
  const waiting = all.filter((r) => r.status === "no_space");
  const ready = all.filter((r) => r.status === "ready");

  return (
    <>
      <PageHeader title="Recordings" subtitle={`Recordings of your classes. Watch them again, download them, or delete the ones you don't need. Recordings are kept for ${plural(data?.retentionDays ?? 30, "day")} after the class.`} />
      <ErrorBox error={error} onRetry={reload} />
      {data && (
        <div className="mb-4 grid gap-4 sm:grid-cols-3">
          <StatCard icon={Video} label="Recordings" value={ready.length} tone="violet" />
          <StatCard icon={Clock} label="Total length" value={dur(ready.reduce((n, r) => n + (r.durationSec || 0), 0))} tone="gold" />
          <Card>
            <div className="flex items-center gap-2 text-sm font-medium text-navy">
              <HardDrive className="h-4 w-4" /> My storage
            </div>
            <p className="mt-2 text-2xl font-semibold text-navy">
              {fmtSize(used) || "0 MB"} <span className="text-sm font-normal text-muted">of {fmtSize(quota)} used</span>
            </p>
            <Progress className="mt-2" value={pct} tone={pct >= 90 ? "red" : pct >= 75 ? "amber" : "brand"} />
            <p className="mt-1 text-xs text-muted">{fmtSize(Math.max(0, quota - used)) || "0 MB"} free</p>
          </Card>
        </div>
      )}
      {waiting.length > 0 && (
        <Notice tone="warn" className="mb-4">
          Your storage is full, so {waiting.length === 1 ? "1 newer recording is" : `${waiting.length} newer recordings are`} waiting ({fmtSize(data.waitingBytes)}). Delete recordings you no longer need and {waiting.length === 1 ? "it appears" : "they appear"} here automatically.
        </Notice>
      )}
      <Card flush>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3 sm:px-6">
          <SearchInput value={q} onChange={setQ} className="w-full sm:w-72" placeholder="Search class, subject or teacher…" />
          {subjects.length > 1 && <Select className="w-full sm:w-48" value={subject} onChange={setSubject} options={subjects.map((s) => ({ value: s, label: s }))} placeholder="All subjects" clearable />}
        </div>
        {loading && !data ? (
          <Loading />
        ) : (
          <Table
            pageSize={10}
            rows={list}
            empty={<Empty icon={Video} title={q || subject ? "No matches" : "No recordings yet"} text={q || subject ? "Try another search." : "Recordings of your classes appear here after the class ends."} />}
            columns={[
              {
                key: "title",
                label: "Class",
                render: (r) => (
                  <div className="min-w-0">
                    <p className="truncate font-medium text-navy">{r.title}</p>
                    <p className="truncate text-xs text-muted">{[r.subject, r.teacherName].filter(Boolean).join(" · ")}</p>
                  </div>
                ),
              },
              {
                key: "startedAt",
                label: "Date & time",
                render: (r) => (
                  <span className="whitespace-nowrap">
                    {fmtDate(r.startedAt)}
                    <span className="block text-xs text-muted">
                      {fmtTime(r.startedAt)}
                      {r.endedAt ? ` – ${fmtTime(r.endedAt)}` : ""}
                    </span>
                  </span>
                ),
              },
              { key: "durationSec", label: "Length", render: (r) => dur(r.durationSec) },
              { key: "size", label: "Size", render: (r) => fmtSize(r.size) || "—" },
              {
                key: "deleteAt",
                label: "Available until",
                render: (r) =>
                  r.status === "no_space" ? (
                    <Badge tone="amber">
                      <Hourglass className="h-3 w-3" /> Waiting for space
                    </Badge>
                  ) : (
                    <span className="whitespace-nowrap text-muted">{fmtDate(r.deleteAt)}</span>
                  ),
              },
              {
                key: "actions",
                label: "",
                className: "text-right",
                render: (r) =>
                  r.status === "ready" ? (
                    <div className="flex justify-end gap-1">
                      <Button size="sm" icon={Play} onClick={() => watch(r)}>
                        Watch
                      </Button>
                      {saving[r.id] !== undefined ? (
                        <Button size="sm" variant="outline" loading>
                          {saving[r.id] ? `${saving[r.id]}%` : ""}
                        </Button>
                      ) : (
                        <IconButton icon={Download} label="Download" onClick={() => download(r)} />
                      )}
                      <IconButton icon={Trash2} label="Delete" tone="danger" onClick={() => remove(r)} />
                    </div>
                  ) : null,
              },
            ]}
          />
        )}
      </Card>

      <Dialog
        open={!!playing}
        onClose={() => setPlaying(null)}
        size="xl"
        title={playing?.rec.title || ""}
        subtitle={playing ? [playing.rec.subject, playing.rec.teacherName, fmtDateTime(playing.rec.startedAt), dur(playing.rec.durationSec)].filter(Boolean).join(" · ") : ""}
      >
        {playing && (
          <>
            <video src={playing.url} controls autoPlay playsInline className="aspect-video w-full rounded-xl bg-black" />
            <p className="mt-2 text-xs text-muted">If jumping ahead is slow, download the recording and play it on your device.</p>
          </>
        )}
      </Dialog>
    </>
  );
}
