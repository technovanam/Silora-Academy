// ---- Class recordings (admins with the "recordings" permission) ----------------------
import React, { useState } from "react";
import { Clock, Download, HardDrive, Play, Trash2, Video } from "lucide-react";
import { api } from "../../lib/api.js";
import { fmtDateTime, fmtSize, plural } from "../../lib/format.js";
import { Badge, Button, Card, Dialog, Empty, ErrorBox, IconButton, Loading, PageHeader, Progress, SearchInput, StatCard, Table, useAsync, useUi } from "../../ui/index.jsx";

const dur = (s) => {
  if (!s) return "—";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h} h ${m} min` : m ? `${m} min ${sec} s` : `${sec} s`;
};

const STATUS = {
  recording: ["amber", "Recording now"],
  ready: ["green", "Ready"],
  failed: ["red", "Failed"],
};

export function AdminRecordings() {
  const ui = useUi();
  const [q, setQ] = useState("");
  const [playing, setPlaying] = useState(null); // { rec, url }
  const { data, loading, error, reload } = useAsync(() => api.get("/admin/recordings"), []);
  const list = (data?.recordings || []).filter((r) => !q || `${r.title} ${r.subject} ${r.teacherName}`.toLowerCase().includes(q.toLowerCase()));

  const open = async (rec, download) => {
    try {
      const r = await api.get(`/admin/recordings/${rec.id}/url`);
      if (download) {
        const a = document.createElement("a");
        a.href = r.url;
        a.download = r.fileName;
        a.target = "_blank";
        a.rel = "noopener";
        a.click();
      } else setPlaying({ rec, url: r.url });
    } catch (e) {
      ui.error(e);
    }
  };
  const remove = (rec) =>
    ui.confirm({
      title: "Delete this recording?",
      message: `"${rec.title}" (${fmtDateTime(rec.startedAt)}) is deleted for good. This can't be undone.`,
      danger: true,
      confirmLabel: "Delete",
      onConfirm: async () => {
        await api.del(`/admin/recordings/${rec.id}`);
        ui.toast("Recording deleted");
        reload();
      },
    });

  const used = data?.usedBytes || 0;
  const cap = data?.capBytes || 1;
  return (
    <>
      <PageHeader title="Class recordings" subtitle={`Every live class is recorded automatically from when the teacher joins. Each recording is deleted automatically ${plural(data?.retentionDays ?? 30, "day")} after the class.`} />
      <ErrorBox error={error} onRetry={reload} />
      {data && (
        <div className="mb-4 grid gap-4 sm:grid-cols-3">
          <StatCard icon={Video} label="Recordings" value={data.recordings.filter((r) => r.status === "ready").length} tone="violet" />
          <StatCard icon={Clock} label="Total length" value={dur(data.recordings.reduce((n, r) => n + (r.durationSec || 0), 0))} tone="gold" />
          <Card>
            <div className="flex items-center gap-2 text-sm font-medium text-navy">
              <HardDrive className="h-4 w-4" /> Storage used
            </div>
            <p className="mt-2 text-2xl font-semibold text-navy">
              {fmtSize(used) || "0 MB"} <span className="text-sm font-normal text-muted">of {fmtSize(cap)}</span>
            </p>
            <Progress className="mt-2" value={Math.min(100, (used / cap) * 100)} />
            <p className="mt-1 text-xs text-muted">New recordings stop being allowed when this is full. Delete old ones to make room.</p>
          </Card>
        </div>
      )}
      <Card flush>
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3 sm:px-6">
          <SearchInput value={q} onChange={setQ} className="w-full sm:w-72" placeholder="Search class or teacher…" />
        </div>
        {loading && !data ? (
          <Loading />
        ) : (
          <Table
            rows={list}
            empty={<Empty icon={Video} title="No recordings yet" text="Recordings appear here after a live class ends." />}
            columns={[
              {
                key: "title",
                label: "Class",
                render: (r) => (
                  <div className="min-w-0">
                    <p className="truncate font-medium text-navy">{r.title}</p>
                    <p className="truncate text-xs text-muted">
                      {r.teacherName}
                      {r.subject ? ` · ${r.subject}` : ""}
                    </p>
                  </div>
                ),
              },
              { key: "startedAt", label: "Recorded", render: (r) => <span className="whitespace-nowrap">{fmtDateTime(r.startedAt)}</span> },
              { key: "durationSec", label: "Length", render: (r) => dur(r.durationSec) },
              { key: "size", label: "Size", render: (r) => fmtSize(r.size) || "—" },
              { key: "status", label: "Status", render: (r) => <Badge tone={STATUS[r.status]?.[0] || "gray"}>{STATUS[r.status]?.[1] || r.status}</Badge> },
              { key: "deleteAt", label: "Deleted on", render: (r) => <span className="whitespace-nowrap text-muted">{fmtDateTime(r.deleteAt)}</span> },
              {
                key: "actions",
                label: "",
                className: "text-right",
                render: (r) => (
                  <div className="flex justify-end gap-1">
                    {r.status === "ready" && (
                      <>
                        <Button size="sm" icon={Play} onClick={() => open(r)}>
                          Watch
                        </Button>
                        <IconButton icon={Download} label="Download" onClick={() => open(r, true)} />
                      </>
                    )}
                    {r.status !== "recording" && <IconButton icon={Trash2} label="Delete" tone="danger" onClick={() => remove(r)} />}
                  </div>
                ),
              },
            ]}
          />
        )}
      </Card>

      <Dialog open={!!playing} onClose={() => setPlaying(null)} size="xl" title={playing?.rec.title || ""} subtitle={playing ? `${playing.rec.teacherName} · ${fmtDateTime(playing.rec.startedAt)} · ${dur(playing.rec.durationSec)}` : ""}>
        {playing && (
          <>
            <video src={playing.url} controls autoPlay playsInline className="aspect-video w-full rounded-xl bg-black" />
            <p className="mt-2 text-xs text-muted">If jumping ahead is slow, download the recording and play it on your computer.</p>
          </>
        )}
      </Dialog>
    </>
  );
}
