import React, { useEffect, useState } from "react";
import { BellRing, Eye, Mail, Megaphone, MoreHorizontal, Pencil, Pin, Plus, RefreshCw, Smartphone, Timer, Trash2, Monitor } from "lucide-react";
import { api } from "../../lib/api.js";
import { fmtDateTime, fromLocalInput, fromNow, toLocalInput, plural } from "../../lib/format.js";
import { Badge, Button, Card, Checkbox, Dialog, Empty, ErrorBox, Field, IconButton, Input, Loading, Menu, Notice, PageHeader, Progress, SearchInput, Segmented, Select, StatCard, Table, Textarea, cx, useAsync, useUi } from "../../ui/index.jsx";

const PRIORITY = [
  { value: "normal", label: "Normal" },
  { value: "important", label: "Important" },
  { value: "urgent", label: "Urgent" },
];
const P_TONE = { normal: "blue", important: "amber", urgent: "red" };
const AUDIENCE = [
  { value: "all", label: "Everyone (students & teachers)" },
  { value: "students", label: "All students & parents" },
  { value: "teachers", label: "All teachers" },
  { value: "selected", label: "Selected people" },
];
const STATE = { published: ["green", "Live"], scheduled: ["violet", "Scheduled"], expired: ["gray", "Expired"], draft: ["gray", "Draft"] };

function AnnouncementDialog({ open, onClose, item, onSaved }) {
  const ui = useUi();
  const dir = useAsync(() => (open ? api.get("/admin/directory") : Promise.resolve(null)), [open]);
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setF(
      item
        ? { title: item.title, body: item.body, priority: item.priority, audience: item.audience, userIds: item.userIds || [], schedule: !!item.publishAt && item.state === "scheduled", publishAt: toLocalInput(item.publishAt), expires: !!item.expiresAt, expiresAt: toLocalInput(item.expiresAt), pinned: !!item.pinned }
        : { title: "", body: "", priority: "normal", audience: "all", userIds: [], schedule: false, publishAt: toLocalInput(new Date(Date.now() + 3600000)), expires: false, expiresAt: toLocalInput(new Date(Date.now() + 7 * 86400000)), pinned: false }
    );
  }, [open, item]);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v?.target ? v.target.value : v }));
  const people = [...(dir.data?.students || []).map((s) => ({ value: s.id, label: s.name, hint: "Student" })), ...(dir.data?.teachers || []).map((t) => ({ value: t.id, label: t.name, hint: "Teacher" }))];

  const save = async (draft) => {
    setBusy(true);
    try {
      const body = { title: f.title, body: f.body, priority: f.priority, audience: f.audience, userIds: f.userIds, pinned: f.pinned, publishAt: f.schedule ? fromLocalInput(f.publishAt) : null, expiresAt: f.expires ? fromLocalInput(f.expiresAt) : null, draft };
      const r = item ? await api.patch(`/admin/announcements/${item.id}`, body) : await api.post("/admin/announcements", body);
      ui.toast(draft ? "Saved as draft" : r.state === "scheduled" ? "Scheduled" : "Published – recipients notified");
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
      open={open}
      onClose={onClose}
      title={item ? "Edit announcement" : "New announcement"}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={() => save(true)} loading={busy}>Save draft</Button>
          <Button onClick={() => save(false)} loading={busy} icon={Megaphone}>{f.schedule ? "Schedule" : "Publish"}</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" required className="sm:col-span-2">
          <Input value={f.title || ""} onChange={set("title")} maxLength={150} />
        </Field>
        <Field label="Message" required className="sm:col-span-2">
          <Textarea rows={5} value={f.body || ""} onChange={set("body")} maxLength={5000} />
        </Field>
        <Field label="Priority">
          <Select value={f.priority} onChange={set("priority")} options={PRIORITY.map((p) => ({ ...p, icon: <span className={cx("h-2 w-2 rounded-full", p.value === "urgent" ? "bg-rose-500" : p.value === "important" ? "bg-amber-500" : "bg-sky-500")} /> }))} />
        </Field>
        <Field label="Who should see it">
          <Select value={f.audience} onChange={set("audience")} options={AUDIENCE} />
        </Field>
        {f.audience === "selected" && (
          <Field label="Recipients" className="sm:col-span-2">
            <Select multiple searchable value={f.userIds} onChange={set("userIds")} options={people} placeholder="Choose people" />
          </Field>
        )}
        <div className="space-y-3 sm:col-span-2">
          <Checkbox checked={f.schedule} onChange={set("schedule")} label="Schedule for later" />
          {f.schedule && <Input type="datetime-local" value={f.publishAt} onChange={set("publishAt")} />}
          <Checkbox checked={f.expires} onChange={set("expires")} label="Hide automatically after a date (expiry)" />
          {f.expires && <Input type="datetime-local" value={f.expiresAt} onChange={set("expiresAt")} />}
          <Checkbox checked={f.pinned} onChange={set("pinned")} label="Pin to the top" />
        </div>
        <Notice className="sm:col-span-2">Recipients get an in-app notification, plus email and push if they've turned those on.</Notice>
      </div>
    </Dialog>
  );
}

function ReadsDialog({ item, onClose }) {
  const { data, loading, error, reload } = useAsync(() => (item ? api.get(`/admin/announcements/${item.id}/reads`) : Promise.resolve(null)), [item?.id]);
  if (!item) return null;
  const rows = data?.rows || [];
  const read = rows.filter((r) => r.read).length;
  return (
    <Dialog open onClose={onClose} title="Read tracking" subtitle={item.title} size="lg">
      {error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : loading ? (
        <Loading />
      ) : (
        <>
          <div className="mb-4 flex items-center gap-3">
            <Progress value={rows.length ? (read / rows.length) * 100 : 0} tone="green" className="flex-1" />
            <span className="text-sm font-semibold text-navy">
              {read} of {rows.length} read
            </span>
          </div>
          <Card flush>
            <Table
              rowKey="userId"
              rows={rows}
              dense
              columns={[
                { key: "name", label: "Name", render: (r) => <span className="font-medium">{r.name}</span> },
                { key: "role", label: "Role", render: (r) => <span className="capitalize">{r.role}</span> },
                { key: "read", label: "Status", render: (r) => (r.read ? <Badge tone="green">Read {fromNow(r.readAt)}</Badge> : <Badge tone="amber">Not read</Badge>) },
              ]}
            />
          </Card>
        </>
      )}
    </Dialog>
  );
}

export function AdminAnnouncements() {
  const ui = useUi();
  const [tab, setTab] = useState("all");
  const [dialog, setDialog] = useState(null);
  const { data, loading, error, reload } = useAsync(() => api.get("/admin/announcements"), []);
  const all = data?.announcements || [];
  const list = all.filter((a) => tab === "all" || a.state === tab);
  const remove = (a) =>
    ui.confirm({ title: "Delete announcement?", message: `"${a.title}" will be removed for everyone.`, danger: true, confirmLabel: "Delete", onConfirm: async () => { await api.del(`/admin/announcements/${a.id}`); reload(true); } });
  const expire = async (a) => {
    await api.post(`/admin/announcements/${a.id}/expire`);
    ui.toast("Announcement expired");
    reload(true);
  };
  return (
    <>
      <PageHeader title="Announcement centre" subtitle="Publish now or schedule, set priority and expiry, and see who has read each announcement." actions={<Button icon={Plus} onClick={() => setDialog({})}>New announcement</Button>} />
      <Segmented
        className="mb-4"
        value={tab}
        onChange={setTab}
        options={[
          { value: "all", label: "All", count: all.length },
          { value: "published", label: "Live", count: all.filter((a) => a.state === "published").length },
          { value: "scheduled", label: "Scheduled", count: all.filter((a) => a.state === "scheduled").length },
          { value: "draft", label: "Drafts" },
          { value: "expired", label: "Expired" },
        ]}
      />
      <ErrorBox error={error} onRetry={reload} />
      {loading ? (
        <Loading />
      ) : list.length === 0 ? (
        <Card>
          <Empty icon={Megaphone} title="No announcements here" action={<Button icon={Plus} onClick={() => setDialog({})}>New announcement</Button>} />
        </Card>
      ) : (
        <div className="space-y-3">
          {list.map((a) => (
            <Card key={a.id}>
              <div className="flex flex-wrap items-start gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={STATE[a.state][0]}>{STATE[a.state][1]}</Badge>
                    <Badge tone={P_TONE[a.priority]}>{PRIORITY.find((p) => p.value === a.priority)?.label}</Badge>
                    {a.pinned && (
                      <Badge tone="gold">
                        <Pin className="h-3 w-3" /> Pinned
                      </Badge>
                    )}
                    <span className="text-xs text-slate-400">{AUDIENCE.find((x) => x.value === a.audience)?.label}</span>
                  </div>
                  <h3 className="mt-2 font-bold text-navy">{a.title}</h3>
                  <p className="line-clamp-2 text-sm text-muted">{a.body}</p>
                  <p className="mt-2 flex flex-wrap gap-x-4 text-xs text-slate-400">
                    <span>{a.state === "scheduled" ? `Publishes ${fmtDateTime(a.publishAt)}` : `Created ${fmtDateTime(a.createdAt)}`}</span>
                    {a.expiresAt && (
                      <span className="inline-flex items-center gap-1">
                        <Timer className="h-3 w-3" /> {a.state === "expired" ? "Expired" : "Expires"} {fmtDateTime(a.expiresAt)}
                      </span>
                    )}
                    <span>by {a.createdByName}</span>
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {a.state !== "draft" && (
                    <button onClick={() => setDialog({ reads: a })} className="rounded-xl px-3 py-1.5 text-left hover:bg-surface">
                      <span className="block text-xs text-muted">Read</span>
                      <span className="flex items-center gap-2">
                        <Progress value={a.audienceCount ? (a.readCount / a.audienceCount) * 100 : 0} tone="green" className="w-16" />
                        <span className="text-sm font-semibold text-navy">
                          {a.readCount}/{a.audienceCount}
                        </span>
                      </span>
                    </button>
                  )}
                  <Menu
                    trigger={<IconButton icon={MoreHorizontal} label="Actions" />}
                    items={[
                      { label: "Edit", icon: Pencil, onClick: () => setDialog({ edit: a }) },
                      { label: "Read tracking", icon: Eye, onClick: () => setDialog({ reads: a }), hidden: a.state === "draft" },
                      { label: "Expire now", icon: Timer, onClick: () => expire(a), hidden: a.state !== "published" },
                      { label: "Delete", icon: Trash2, danger: true, onClick: () => remove(a) },
                    ]}
                  />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      <AnnouncementDialog open={!!dialog && !dialog.reads} item={dialog?.edit} onClose={() => setDialog(null)} onSaved={() => reload(true)} />
      <ReadsDialog item={dialog?.reads} onClose={() => setDialog(null)} />
    </>
  );
}

// ---- Notification delivery log -------------------------------------------------------------
const CH_TONE = { delivered: "green", sent: "green", failed: "red", skipped: "gray", pending: "amber" };
function Channel({ icon: Icon, c }) {
  if (!c) return null;
  return (
    <span title={c.error || c.status} className="inline-flex items-center gap-1">
      <Icon className="h-3.5 w-3.5 text-slate-400" />
      <Badge tone={CH_TONE[c.status] || "gray"}>{c.status}</Badge>
    </span>
  );
}

export function AdminNotifications() {
  const ui = useUi();
  const [days, setDays] = useState(7);
  const [status, setStatus] = useState(null);
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState(null);
  const { data, loading, error, reload } = useAsync(() => api.get("/admin/notifications", { days, status }), [days, status]);
  const list = (data?.notifications || []).filter((n) => !q || `${n.title} ${n.userName}`.toLowerCase().includes(q.toLowerCase()));
  const retry = async (n) => {
    try {
      const r = await api.post(`/admin/notifications/${n.id}/retry`);
      ui.toast(`Retried – now ${r.status}`, r.status === "delivered" ? "success" : "info");
      reload(true);
      setDetail(null);
    } catch (e) {
      ui.error(e);
    }
  };
  const st = data?.stats;
  return (
    <>
      <PageHeader title="Notification delivery" subtitle={`Every notification with its in-app, email and push status. Failed channels are retried automatically up to ${plural(data?.maxAttempts || 3, "time")}.`} actions={<Button variant="outline" icon={RefreshCw} onClick={() => reload()}>Refresh</Button>} />
      {st && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={BellRing} label="Sent" value={st.total} hint={`${st.read} read in-app`} />
          <StatCard icon={Monitor} label="In-app delivered" value={st.inApp.sent} tone="green" />
          <StatCard icon={Mail} label="Emails sent" value={st.email.sent} hint={`${st.email.failed} failed · ${st.email.skipped} skipped`} tone={st.email.failed ? "red" : "blue"} />
          <StatCard icon={Smartphone} label="Push sent" value={st.push.sent} hint={`${st.push.failed} failed · ${st.push.skipped} skipped`} tone={st.push.failed ? "red" : "violet"} />
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          value={days}
          onChange={setDays}
          options={[
            { value: 1, label: "24 h" },
            { value: 7, label: "7 days" },
            { value: 30, label: "30 days" },
          ]}
        />
        <Select
          className="w-full sm:w-48"
          value={status}
          onChange={setStatus}
          options={[
            { value: "failed", label: "Failed" },
            { value: "partial", label: "Partly failed" },
            { value: "delivered", label: "Delivered" },
            { value: "pending", label: "Pending" },
          ]}
          placeholder="Any status"
          clearable
        />
        <div className="flex-1" />
        <SearchInput value={q} onChange={setQ} className="w-full sm:w-64" />
      </div>
      <ErrorBox error={error} onRetry={reload} />
      <Card flush>
        {loading ? (
          <Loading />
        ) : (
          <Table
            rows={list}
            pageSize={25}
            minWidth="min-w-[920px]"
            onRowClick={setDetail}
            empty={<Empty icon={BellRing} title="No notifications in this period" />}
            columns={[
              { key: "createdAt", label: "Sent", headClass: "w-[170px]", className: "whitespace-nowrap", render: (n) => <span className="text-sm">{fmtDateTime(n.createdAt)}</span> },
              { key: "user", label: "Recipient", headClass: "w-[190px]", render: (n) => <span className="block max-w-[190px]"><span className="block truncate font-medium text-navy" title={n.userName}>{n.userName}</span><span className="block text-xs capitalize text-muted">{n.userRole}</span></span> },
              { key: "title", label: "Notification", render: (n) => <span className="block min-w-[180px]"><span className="block text-xs text-slate-400">{n.typeLabel}</span><span className="line-clamp-1" title={n.title}>{n.title}</span></span> },
              { key: "ch", label: "Channels", headClass: "w-[300px]", className: "whitespace-nowrap", render: (n) => <span className="flex items-center gap-3"><Channel icon={Monitor} c={n.channels?.inApp} /><Channel icon={Mail} c={n.channels?.email} /><Channel icon={Smartphone} c={n.channels?.push} /></span> },
              { key: "read", label: "Read", headClass: "w-[90px]", className: "whitespace-nowrap", render: (n) => (n.read ? <Badge tone="green">Read</Badge> : <Badge>Unread</Badge>) },
              { key: "x", label: "", headClass: "w-[100px]", className: "text-right", render: (n) => (["failed", "partial"].includes(n.status) ? <Button size="xs" variant="outline" icon={RefreshCw} onClick={(e) => { e.stopPropagation(); retry(n); }}>Retry</Button> : null) },
            ]}
          />
        )}
      </Card>
      <Dialog open={!!detail} onClose={() => setDetail(null)} title={detail?.title} subtitle={detail && `${detail.userName} · ${fmtDateTime(detail.createdAt)}`} footer={detail && ["failed", "partial"].includes(detail.status) && <Button icon={RefreshCw} onClick={() => retry(detail)}>Retry failed channels</Button>}>
        {detail && (
          <div className="space-y-4">
            {detail.body && <p className="text-[15px] text-muted">{detail.body}</p>}
            <ul className="space-y-2">
              {[
                ["inApp", "In-app", Monitor],
                ["email", "Email", Mail],
                ["push", "Browser push", Smartphone],
              ].map(([k, label, Icon]) => (
                <li key={k} className="flex items-start gap-3 rounded-2xl border border-line p-3">
                  <Icon className="mt-0.5 h-4 w-4 text-slate-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-navy">{label}</span>
                    {detail.channels?.[k]?.error && <span className="block text-xs text-muted">{detail.channels[k].error}</span>}
                  </span>
                  <Badge tone={CH_TONE[detail.channels?.[k]?.status] || "gray"}>{detail.channels?.[k]?.status || "—"}</Badge>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted">
              Attempts: {detail.attempts || 1}
              {detail.lastAttemptAt && ` · last ${fromNow(detail.lastAttemptAt)}`}
              {detail.nextRetryAt && ` · next automatic retry ${fromNow(detail.nextRetryAt)}`}
            </p>
          </div>
        )}
      </Dialog>
    </>
  );
}
