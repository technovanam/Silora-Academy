import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, BellOff, CheckCheck, KeyRound, Laptop, Mail, Megaphone, Pin, ShieldCheck, Smartphone } from "lucide-react";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import { enablePush } from "../lib/firebase.js";
import { fmtDateTime, fromNow, roleLabel, plural } from "../lib/format.js";
import { Avatar, Badge, Button, Card, CardTitle, Empty, ErrorBox, Field, Loading, Notice, PageHeader, Segmented, Toggle, cx, useAsync, useUi } from "../ui/index.jsx";
import { PasswordInput } from "./AuthPages.jsx";

// ---- Notifications ----------------------------------------------------------------
export function NotificationsPage() {
  const [filter, setFilter] = useState("all");
  const { data, loading, error, reload } = useAsync(() => api.get("/notifications", { limit: 300 }), []);
  const navigate = useNavigate();
  const list = (data?.notifications || []).filter((n) => (filter === "unread" ? !n.read : true));

  const open = async (n) => {
    if (!n.read) await api.post(`/notifications/${n.id}/read`).catch(() => {});
    window.dispatchEvent(new Event("portal:notifications-changed"));
    if (n.link) navigate(n.link);
    else reload(true);
  };
  const readAll = async () => {
    await api.post("/notifications/read-all");
    window.dispatchEvent(new Event("portal:notifications-changed"));
    reload(true);
  };

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="Class reminders, new materials, schedule changes and announcements."
        actions={data?.unread > 0 && <Button variant="outline" icon={CheckCheck} onClick={readAll}>Mark all as read</Button>}
      />
      <div className="mb-4">
        <Segmented value={filter} onChange={setFilter} options={[{ value: "all", label: "All", count: data?.notifications.length }, { value: "unread", label: "Unread", count: data?.unread }]} />
      </div>
      <ErrorBox error={error} onRetry={reload} />
      <Card padded={false}>
        {loading ? (
          <Loading />
        ) : list.length === 0 ? (
          <Empty icon={Bell} title={filter === "unread" ? "No unread notifications" : "No notifications yet"} text="You'll see class reminders and updates here." />
        ) : (
          <ul>
            {list.map((n) => (
              <li key={n.id} className="border-b border-line last:border-0">
                <button onClick={() => open(n)} className={cx("flex w-full gap-4 px-5 py-4 text-left transition hover:bg-surface sm:px-6", !n.read && "bg-brand-soft/40")}>
                  <span className={cx("mt-2 h-2.5 w-2.5 shrink-0 rounded-full", n.read ? "bg-slate-200" : "bg-brand")} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge tone="gray">{n.typeLabel}</Badge>
                      <span className="text-xs text-slate-400">{fmtDateTime(n.createdAt)}</span>
                    </span>
                    <span className="mt-1 block font-semibold text-navy">{n.title}</span>
                    {n.body && <span className="block text-sm text-muted">{n.body}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

// ---- Announcements ----------------------------------------------------------------
const PRIORITY = { urgent: ["red", "Urgent"], important: ["amber", "Important"], normal: ["blue", "Notice"] };
export function AnnouncementsPage() {
  const { data, loading, error, reload, setData } = useAsync(() => api.get("/announcements"), []);
  const [openId, setOpenId] = useState(null);
  const markRead = async (a) => {
    setOpenId(openId === a.id ? null : a.id);
    if (!a.read) {
      await api.post(`/announcements/${a.id}/read`).catch(() => {});
      setData((d) => ({ ...d, announcements: d.announcements.map((x) => (x.id === a.id ? { ...x, read: true } : x)) }));
    }
  };
  return (
    <>
      <PageHeader title="Announcements" subtitle="News and important updates from Silora Academy." />
      <ErrorBox error={error} onRetry={reload} />
      {loading ? (
        <Loading />
      ) : !data?.announcements.length ? (
        <Card>
          <Empty icon={Megaphone} title="No announcements right now" text="When the academy posts an update, it will appear here." />
        </Card>
      ) : (
        <div className="space-y-3">
          {data.announcements.map((a) => {
            const [tone, label] = PRIORITY[a.priority] || PRIORITY.normal;
            const expanded = openId === a.id || a.body.length < 280;
            return (
              <Card key={a.id} className={cx("transition", !a.read && "border-brand/50 shadow-[0_0_0_3px_rgba(232,177,18,0.12)]")}>
                <button className="block w-full text-left" onClick={() => markRead(a)}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={tone}>{label}</Badge>
                    {a.pinned && (
                      <Badge tone="gold">
                        <Pin className="h-3 w-3" /> Pinned
                      </Badge>
                    )}
                    {!a.read && <Badge tone="navy">New</Badge>}
                    <span className="text-xs text-slate-400">{fmtDateTime(a.publishedAt)}</span>
                  </div>
                  <h2 className="mt-2 text-lg font-bold text-navy">{a.title}</h2>
                  <p className={cx("mt-1 whitespace-pre-line text-[15px] leading-relaxed text-muted", !expanded && "line-clamp-3")}>{a.body}</p>
                  {!expanded && <span className="mt-2 inline-block text-sm font-semibold text-navy">Read more</span>}
                  <p className="mt-3 text-xs text-slate-400">
                    From {a.createdByName}
                    {a.expiresAt && ` · Visible until ${fmtDateTime(a.expiresAt)}`}
                  </p>
                </button>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

// ---- Profile -----------------------------------------------------------------------
export function ProfilePage() {
  const { user, teachers, settings, reload } = useAuth();
  const ui = useUi();
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const activity = useAsync(() => api.get("/me/activity"), []);

  const changePassword = async (e) => {
    e.preventDefault();
    if (pw.next !== pw.confirm) return ui.error(new Error("The new passwords don't match"));
    setBusy(true);
    try {
      await api.post("/me/password", { currentPassword: pw.current, newPassword: pw.next });
      setPw({ current: "", next: "", confirm: "" });
      ui.toast("Password changed");
      reload?.();
    } catch (err) {
      ui.error(err);
    } finally {
      setBusy(false);
    }
  };
  const setPref = async (key, value) => {
    try {
      await api.patch("/me", { [key]: value });
      await reload();
      ui.toast("Preferences saved");
    } catch (e) {
      ui.error(e);
    }
  };
  const turnOnPush = async () => {
    try {
      await enablePush((token) => api.post("/me/push-token", { token }));
      if (!user.notifyPush) await api.patch("/me", { notifyPush: true });
      ui.toast("Browser notifications turned on");
    } catch (e) {
      ui.error(e);
    }
  };

  const c = user.contact || {};
  return (
    <>
      <PageHeader title="My profile" subtitle="Your account details, password and notification preferences." />
      <div className="grid gap-6 xl:grid-cols-[1.1fr_1fr]">
        <div className="space-y-6">
          <Card>
            <div className="flex flex-wrap items-center gap-4">
              <Avatar name={user.name} size="lg" />
              <div className="min-w-0">
                <h2 className="text-xl font-bold text-navy">{user.name}</h2>
                <div className="mt-1 flex flex-wrap gap-2">
                  <Badge tone="gold">{user.superAdmin ? "Super admin" : roleLabel[user.role]}</Badge>
                  {user.grade && <Badge>{user.grade}</Badge>}
                  {user.board && <Badge>{user.board}</Badge>}
                </div>
              </div>
            </div>
            <dl className="mt-6 grid gap-4 sm:grid-cols-2">
              <Info label="Email (sign-in)" value={c.email} />
              <Info label="Phone" value={c.phone} />
              {user.role === "student" && <Info label="Parent / guardian" value={c.parentName} />}
              {user.role === "student" && <Info label="Parent phone" value={c.parentPhone} />}
              {user.subjects?.length > 0 && <Info label="Subjects" value={user.subjects.join(", ")} />}
              {teachers?.length > 0 && <Info label={teachers.length > 1 ? "Your teachers" : "Your teacher"} value={teachers.map((t) => `${t.subjects?.length ? `${t.subjects.join(", ")}: ` : ""}${t.name}`).join(" · ")} />}
            </dl>
            <p className="mt-5 text-xs text-muted">To change these details, please contact the academy office.</p>
          </Card>

          <Card>
            <CardTitle icon={KeyRound} title="Change password" subtitle="At least 8 characters, with a letter and a number." />
            <form onSubmit={changePassword} className="grid gap-4 sm:grid-cols-2">
              <Field label="Current password" className="sm:col-span-2">
                <PasswordInput value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" required />
              </Field>
              <Field label="New password">
                <PasswordInput value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" required />
              </Field>
              <Field label="Confirm new password">
                <PasswordInput value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} autoComplete="new-password" required />
              </Field>
              <div className="sm:col-span-2">
                <Button type="submit" loading={busy}>
                  Update password
                </Button>
              </div>
            </form>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardTitle icon={Bell} title="Notifications" subtitle="In-app notifications are always on." />
            <div className="space-y-5">
              <Toggle label="Email notifications" description={`Sent to ${c.email || "your email"}`} checked={user.notifyEmail} onChange={(v) => setPref("notifyEmail", v)} />
              <Toggle label="Browser push notifications" description="Pop-up alerts on this device, e.g. 5 minutes before class" checked={user.notifyPush} onChange={(v) => setPref("notifyPush", v)} />
              {user.notifyPush && (
                <div className="flex flex-col gap-3 rounded-xl bg-surface p-3 sm:flex-row sm:items-center">
                  <p className="flex min-w-0 flex-1 items-start gap-2.5 text-sm text-muted">
                    <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                    <span>{settings?.pushAvailable ? "Allow notifications on this browser to receive push alerts." : "Push alerts become available once the portal runs on the live Firebase project."}</span>
                  </p>
                  <Button size="sm" variant="outline" icon={settings?.pushAvailable ? Bell : BellOff} onClick={turnOnPush} disabled={!settings?.pushAvailable} className="self-end sm:self-auto">
                    Enable on this device
                  </Button>
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardTitle icon={ShieldCheck} title="Recent sign-ins" subtitle={`You're signed out automatically after ${plural(settings?.sessionTimeoutMin || 30, "minute")} of inactivity.`} />
            {activity.loading ? (
              <Loading />
            ) : (
              <ul className="space-y-3">
                {(activity.data?.logins || []).slice(0, 8).map((l) => (
                  <li key={l.id} className="flex items-center gap-3 text-sm">
                    <span className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", l.success ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600")}>
                      <Laptop className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-ink">{l.success ? "Signed in" : `Failed attempt${l.reason === "locked" ? " (locked)" : ""}`}</span>
                      <span className="block text-xs text-muted">{l.device}</span>
                    </span>
                    <span className="text-xs text-slate-400">{fromNow(l.at)}</span>
                  </li>
                ))}
                {!activity.data?.logins?.length && <p className="text-sm text-muted">No sign-ins recorded yet.</p>}
              </ul>
            )}
            <Notice className="mt-5" icon={Mail}>
              If you see a sign-in you don't recognise, change your password and tell the academy.
            </Notice>
          </Card>
        </div>
      </div>
    </>
  );
}

function Info({ label, value }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 break-words text-[15px] text-ink">{value || "—"}</dd>
    </div>
  );
}


