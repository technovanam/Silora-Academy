import React, { useEffect, useState } from "react";
import { Activity, ChartColumn, Database, Download, FileSpreadsheet, History, LogIn, RotateCcw, Save, ShieldAlert, ShieldCheck, Plus } from "lucide-react";
import { api } from "../../lib/api.js";
import { useAuth, can } from "../../lib/auth.jsx";
import { fmtDateTime, fmtSize, fromNow, plural } from "../../lib/format.js";
import { Badge, Button, Card, CardTitle, Checkbox, Dialog, Empty, ErrorBox, Field, Input, Loading, Notice, PageHeader, SearchInput, Segmented, StatCard, Table, Toggle, useAsync, useUi } from "../../ui/index.jsx";

const fmtCell = (v) => {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.join(", ") || "—";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return fmtDateTime(v);
  return String(v);
};

// ---- Reports -----------------------------------------------------------------------
function ReportsTab() {
  const ui = useUi();
  const { user } = useAuth();
  const list = useAsync(() => api.get("/admin/reports"), []);
  const [id, setId] = useState("students");
  const [days, setDays] = useState(30);
  const needsDays = id === "notifications";
  const report = useAsync(() => api.get(`/admin/reports/${id}`, needsDays ? { days } : undefined), [id, days]);
  const blocked = (rid) => (rid === "attendance" && !can(user, "attendance")) || (rid === "notifications" && !can(user, "notifications"));
  const exportCsv = () => api.download(`/admin/reports/${id}`, { format: "csv", ...(needsDays ? { days } : {}) }).catch(ui.error);
  return (
    <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
      <Card padded={false} className="h-fit p-2">
        {(list.data?.reports || []).map((r) => (
          <button key={r.id} disabled={blocked(r.id)} onClick={() => setId(r.id)} className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition disabled:opacity-40 ${id === r.id ? "bg-navy text-white" : "text-ink hover:bg-surface"}`}>
            <FileSpreadsheet className="h-4 w-4 shrink-0" /> {r.title}
          </button>
        ))}
      </Card>
      <Card className="min-w-0">
        <CardTitle
          title={report.data?.title || "Report"}
          subtitle={report.data ? plural(report.data.rows.length, "row") : ""}
          action={
            <div className="flex flex-wrap items-center gap-2">
              {needsDays && (
                <Segmented
                  size="sm"
                  value={days}
                  onChange={setDays}
                  options={[
                    { value: 7, label: "7 d" },
                    { value: 30, label: "30 d" },
                    { value: 90, label: "90 d" },
                  ]}
                />
              )}
              <Button size="sm" icon={Download} onClick={exportCsv}>
                Export CSV
              </Button>
            </div>
          }
        />
        <ErrorBox error={report.error} />
        {report.loading ? (
          <Loading />
        ) : report.data ? (
          <Table bleed dense pageSize={25} rowKey="__i" rows={report.data.rows.map((r, i) => ({ ...r, __i: i }))} columns={report.data.columns.map((c) => ({ key: c.key, label: c.label, render: (r) => <span className="line-clamp-2">{fmtCell(r[c.key])}</span> }))} empty={<Empty title="No data for this report" />} />
        ) : null}
        {report.data?.rows.length > 300 && <p className="py-3 text-center text-xs text-muted">Showing the first 300 rows – export CSV for everything.</p>}
      </Card>
    </div>
  );
}

function LogTab({ kind }) {
  const ui = useUi();
  const [q, setQ] = useState("");
  const [days, setDays] = useState(kind === "audit" ? 90 : 30);
  const [result, setResult] = useState("all");
  const { data, loading, error, reload } = useAsync(() => api.get(`/admin/logs/${kind}`, { days, q: q || undefined, result: kind === "logins" && result !== "all" ? result : undefined }), [kind, days, result, q]);
  const columns =
    kind === "logins"
      ? [
          { key: "at", label: "When", render: (r) => <span className="whitespace-nowrap">{fmtDateTime(r.at)}</span> },
          { key: "name", label: "User", render: (r) => <span><span className="block font-medium text-navy">{r.name || r.email || "Unknown"}</span><span className="text-xs capitalize text-muted">{r.role || ""}</span></span> },
          { key: "success", label: "Result", render: (r) => (r.success ? <Badge tone="green">Success</Badge> : <Badge tone="red">{(r.reason || "failed").replace(/_/g, " ")}</Badge>) },
          { key: "device", label: "Device" },
          { key: "ip", label: "IP", render: (r) => <span className="font-mono text-xs">{r.ip}</span> },
        ]
      : [
          { key: "at", label: "When", render: (r) => <span className="whitespace-nowrap">{fmtDateTime(r.at)}</span> },
          { key: "actorName", label: "By", render: (r) => <span><span className="block font-medium text-navy">{r.actorName || "System"}</span>{r.actorRole && <span className="text-xs capitalize text-muted">{r.actorRole}</span>}</span> },
          { key: "action", label: "Action", render: (r) => <Badge>{r.action}</Badge> },
          { key: "summary", label: "Details", className: "max-w-[420px]" },
        ];
  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          size="sm"
          value={days}
          onChange={setDays}
          options={[
            { value: 1, label: "24 h" },
            { value: 7, label: "7 d" },
            { value: 30, label: "30 d" },
            { value: 90, label: "90 d" },
          ]}
        />
        {kind === "logins" && (
          <Segmented
            size="sm"
            value={result}
            onChange={setResult}
            options={[
              { value: "all", label: "All" },
              { value: "failed", label: "Failed only" },
              { value: "success", label: "Successful" },
            ]}
          />
        )}
        <div className="flex-1" />
        <SearchInput value={q} onChange={setQ} className="w-full sm:w-64" />
        {kind !== "audit" && (
          <Button size="sm" icon={Download} onClick={() => api.download(`/admin/reports/${kind}`, { format: "csv", days }).catch(ui.error)}>
            Export CSV
          </Button>
        )}
      </div>
      {kind === "logins" && data?.stats && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <StatCard icon={LogIn} label="Attempts" value={data.stats.total} />
          <StatCard icon={ShieldAlert} label="Failed" value={data.stats.failed} tone="red" />
          <StatCard icon={ShieldCheck} label="Blocked by lockout" value={data.stats.locked} tone="violet" />
        </div>
      )}
      <ErrorBox error={error} onRetry={reload} />
      {loading ? <Loading /> : <Table bleed dense pageSize={25} rows={data?.logs || []} columns={columns} empty={<Empty icon={History} title="Nothing logged in this period" />} />}
    </Card>
  );
}

export function AdminReports() {
  const [tab, setTab] = useState("reports");
  return (
    <>
      <PageHeader title="Reports & logs" subtitle="Export data for the academy and review who did what. Sensitive actions are recorded in the audit log." />
      <Segmented
        className="mb-6"
        value={tab}
        onChange={setTab}
        options={[
          { value: "reports", label: "Reports", icon: ChartColumn },
          { value: "activity", label: "Activity log", icon: Activity },
          { value: "audit", label: "Audit log", icon: ShieldCheck },
          { value: "logins", label: "Login history", icon: LogIn },
        ]}
      />
      {tab === "reports" ? <ReportsTab /> : <LogTab key={tab} kind={tab} />}
    </>
  );
}

// ---- Settings ------------------------------------------------------------------------------
export function AdminSettings() {
  const ui = useUi();
  const { data, loading, error, reload } = useAsync(() => api.get("/admin/settings"), []);
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data) setS(structuredClone(data.settings));
  }, [data]);
  if (loading || !s) return error ? <ErrorBox error={error} onRetry={reload} /> : <Loading />;
  const num = (path) => ({
    type: "number",
    value: path.split(".").reduce((o, k) => o?.[k], s) ?? "",
    onChange: (e) => {
      const v = e.target.value === "" ? "" : Number(e.target.value);
      setS((prev) => {
        const next = structuredClone(prev);
        const keys = path.split(".");
        let o = next;
        keys.slice(0, -1).forEach((k) => (o = o[k]));
        o[keys.at(-1)] = v;
        return next;
      });
    },
  });
  const save = async () => {
    setBusy(true);
    try {
      await api.patch("/admin/settings", s);
      ui.toast("Settings saved");
      reload(true);
    } catch (e) {
      ui.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader title="Security settings" subtitle="Changes are recorded in the audit log." actions={<Button icon={Save} onClick={save} loading={busy}>Save settings</Button>} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardTitle icon={ShieldCheck} title="Sign-in & sessions" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Auto sign-out after inactivity (minutes)" hint="5 – 480">
              <Input min={5} max={480} {...num("sessionTimeoutMin")} />
            </Field>
            <Field label="Lock account after failed attempts" hint="3 – 20">
              <Input min={3} max={20} {...num("maxFailedLogins")} />
            </Field>
            <Field label="Lock duration (minutes)">
              <Input min={1} max={1440} {...num("lockMinutes")} />
            </Field>
          </div>
        </Card>
        <Card>
          <CardTitle icon={Activity} title="Reminders & alerts" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Class reminder (minutes before)">
              <Input min={1} max={120} {...num("classReminderMinutes")} />
            </Field>
            <Field label="Inactive after (days without sign-in)">
              <Input min={1} max={90} {...num("inactivityDays")} />
            </Field>
            <Field label="Alert when material unopened for (days)">
              <Input min={1} max={60} {...num("unopenedMaterialDays")} />
            </Field>
            <div className="sm:col-span-2">
              <Toggle label="Weekly attendance reminders" description="Saturday 10 AM and Sunday 6 PM to students who haven't submitted" checked={s.attendanceReminder?.enabled} onChange={(v) => setS({ ...s, attendanceReminder: { enabled: v } })} />
            </div>
          </div>
        </Card>
        <Card className="xl:col-span-2">
          <CardTitle icon={Database} title="Data retention" subtitle="Older records are deleted automatically every night." />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <Field label="Login history (days)">
              <Input min={30} {...num("retention.loginEventsDays")} />
            </Field>
            <Field label="Activity log (days)">
              <Input min={30} {...num("retention.activityDays")} />
            </Field>
            <Field label="Notifications (days)">
              <Input min={7} {...num("retention.notificationsDays")} />
            </Field>
            <Field label="Deleted accounts kept (days)" hint="Then personal data is removed">
              <Input min={1} {...num("retention.deletedAccountDays")} />
            </Field>
            <Field label="Backups to keep">
              <Input min={1} max={90} {...num("retention.backupsKeep")} />
            </Field>
          </div>
        </Card>
      </div>
    </>
  );
}

// ---- Backups --------------------------------------------------------------------------------
export function AdminBackups() {
  const ui = useUi();
  const { user } = useAuth();
  const { data, loading, error, reload } = useAsync(() => api.get("/admin/backups"), []);
  const [busy, setBusy] = useState(false);
  const [restore, setRestore] = useState(null);
  const [confirmText, setConfirmText] = useState("");
  const [cols, setCols] = useState([]);
  const create = async () => {
    setBusy(true);
    try {
      const r = await api.post("/admin/backups");
      ui.toast(`Backup created (${plural(r.backup.docs, "record")})`);
      reload(true);
    } catch (e) {
      ui.error(e);
    } finally {
      setBusy(false);
    }
  };
  const doRestore = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/admin/backups/${restore.id}/restore`, { confirm: confirmText, collections: cols });
      ui.toast(`Restored. A safety backup (${r.safetyBackup}) was taken first.`);
      setRestore(null);
      reload(true);
    } catch (e) {
      ui.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader title="Backups & recovery" subtitle="A full database backup runs every night at 2 AM. Uploaded files stay safely in storage." actions={<Button icon={Plus} onClick={create} loading={busy}>Back up now</Button>} />
      <ErrorBox error={error} onRetry={reload} />
      <Card flush>
        {loading ? (
          <Loading />
        ) : (
          <Table
            rows={data.backups}
            empty={<Empty icon={Database} title="No backups yet" action={<Button onClick={create}>Create the first backup</Button>} />}
            columns={[
              { key: "createdAt", label: "Created", render: (b) => <span><span className="block font-medium text-navy">{fmtDateTime(b.createdAt)}</span><span className="text-xs text-muted">{fromNow(b.createdAt)}</span></span> },
              { key: "createdBy", label: "By" },
              { key: "docs", label: "Records" },
              { key: "size", label: "Size", render: (b) => fmtSize(b.size) },
              {
                key: "x",
                label: "",
                render: (b) =>
                  user.superAdmin ? (
                    <Button
                      size="xs"
                      variant="outline"
                      icon={RotateCcw}
                      onClick={() => {
                        setRestore(b);
                        setConfirmText("");
                        setCols(data.collections);
                      }}
                    >
                      Restore
                    </Button>
                  ) : null,
              },
            ]}
          />
        )}
      </Card>
      {!user.superAdmin && <Notice className="mt-4">Only a super admin can restore a backup.</Notice>}
      <Dialog
        open={!!restore}
        onClose={() => setRestore(null)}
        title="Restore backup"
        subtitle={restore && fmtDateTime(restore.createdAt)}
        footer={
          <>
            <Button variant="outline" onClick={() => setRestore(null)}>Cancel</Button>
            <Button variant="danger" onClick={doRestore} loading={busy} disabled={confirmText !== "RESTORE" || !cols.length}>Restore</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Notice tone="danger">The selected data is replaced with the backup. Changes made after it was created will be lost. A safety backup of the current state is taken first.</Notice>
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Collections to restore</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {(data?.collections || []).map((c) => (
                <Checkbox key={c} checked={cols.includes(c)} onChange={(v) => setCols((p) => (v ? [...p, c] : p.filter((x) => x !== c)))} label={c} />
              ))}
            </div>
          </div>
          <Field label='Type "RESTORE" to confirm'>
            <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
          </Field>
        </div>
      </Dialog>
    </>
  );
}
