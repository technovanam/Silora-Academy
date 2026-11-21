import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Bell, BookOpen, CalendarDays, CalendarClock, ChartColumn, ClipboardCheck, Database, FolderOpen, GraduationCap, LayoutDashboard,
  KeyRound, LogOut, MessagesSquare, ChevronRight, ChevronDown, PanelLeftClose, PanelLeftOpen, Megaphone, Menu, Settings, Video, ShieldCheck, Siren, TrendingUp, User, Users, X, BellRing, CheckCheck, ExternalLink,
} from "lucide-react";
import { SITE } from "../data/site";
import { useAuth, can } from "./lib/auth.jsx";
import { api } from "./lib/api.js";
import { enablePush, pushConfigured, resumePush } from "./lib/firebase.js";
import { fromNow, roleLabel } from "./lib/format.js";
import { Avatar, Empty, cx, Menu as DropMenu, useUi } from "./ui/index.jsx";
import Lenis from "lenis";
import "lenis/dist/lenis.css";

// Smooth (Lenis) scrolling for the portal. Nested scroll areas (dropdowns, panels,
// tables) keep native scrolling; it pauses while a dialog/drawer locks the page.
function useSmoothScroll(pathname) {
  const lenisRef = useRef(null);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const lenis = new Lenis({
      autoRaf: true,
      lerp: 0.12,
      wheelMultiplier: 1,
      allowNestedScroll: true,
      prevent: (node) => !!node.closest?.("[role=dialog], [role=listbox], [data-lenis-prevent]"),
      virtualScroll: () => document.body.style.overflow !== "hidden",
    });
    lenisRef.current = lenis;
    return () => {
      lenis.destroy();
      lenisRef.current = null;
    };
  }, []);
  useEffect(() => {
    if (lenisRef.current) lenisRef.current.scrollTo(0, { immediate: true, force: true });
    else window.scrollTo(0, 0);
  }, [pathname]);
}

// Keeps one broken page from blanking the whole portal
class PageBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidUpdate(prev) {
    if (prev.path !== this.props.path && this.state.error) this.setState({ error: null });
  }
  render() {
    if (this.state.error) return <Empty title="This page couldn't load" text="Try reloading. If it keeps happening, tell the academy admin." />;
    return this.props.children;
  }
}

export function navFor(user) {
  if (!user) return [];
  if (user.role === "student")
    return [
      { to: "/portal/student", label: "Dashboard", icon: LayoutDashboard, end: true },
      { to: "/portal/student/classes", label: "My classes", icon: CalendarDays },
      { to: "/portal/student/materials", label: "Materials", icon: FolderOpen },
      { to: "/portal/student/attendance", label: "Weekly attendance", icon: ClipboardCheck },
      { to: "/portal/student/progress", label: "Progress", icon: TrendingUp },
      { to: "/portal/messages", label: "Messages", icon: MessagesSquare, badge: "messages" },
      { to: "/portal/announcements", label: "Announcements", icon: Megaphone },
    ];
  if (user.role === "teacher")
    return [
      { to: "/portal/teacher", label: "Dashboard", icon: LayoutDashboard, end: true },
      { to: "/portal/teacher/calendar", label: "Calendar & classes", icon: CalendarDays },
      { to: "/portal/teacher/students", label: "My students", icon: GraduationCap },
      { to: "/portal/teacher/materials", label: "Materials", icon: FolderOpen },
      { to: "/portal/teacher/requests", label: "Schedule requests", icon: CalendarClock },
      { to: "/portal/messages", label: "Messages", icon: MessagesSquare, badge: "messages" },
      { to: "/portal/announcements", label: "Announcements", icon: Megaphone },
    ];
  const items = [
    { to: "/portal/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
    { section: "People" },
    { to: "/portal/admin/students", label: "Students", icon: GraduationCap, perm: "users" },
    { to: "/portal/admin/teachers", label: "Teachers", icon: Users, perm: "users" },
    { to: "/portal/admin/admins", label: "Admins & access", icon: ShieldCheck, superOnly: true },
    { section: "Teaching" },
    { to: "/portal/admin/classes", label: "Classes", icon: CalendarDays, perm: "classes" },
    { to: "/portal/admin/requests", label: "Schedule requests", icon: CalendarClock, perm: "classes" },
    { to: "/portal/admin/materials", label: "Materials", icon: FolderOpen, perm: "materials" },
    { to: "/portal/admin/attendance", label: "Attendance", icon: ClipboardCheck, perm: "attendance" },
    { to: "/portal/admin/recordings", label: "Recordings", icon: Video, perm: "recordings" },
    { section: "Communication" },
    { to: "/portal/admin/messages", label: "Messages", icon: MessagesSquare, perm: "messages" },
    { to: "/portal/admin/announcements", label: "Announcements", icon: Megaphone, perm: "announcements" },
    { to: "/portal/admin/notifications", label: "Notification log", icon: BellRing, perm: "notifications" },
    { section: "Monitoring" },
    { to: "/portal/admin/alerts", label: "Alerts", icon: Siren },
    { to: "/portal/admin/reports", label: "Reports & logs", icon: ChartColumn, perm: "reports" },
    { to: "/portal/admin/settings", label: "Security settings", icon: Settings, perm: "settings" },
    { to: "/portal/admin/backups", label: "Backups", icon: Database, perm: "backups" },
  ];
  const visible = items.filter((i) => i.section || (i.superOnly ? user.superAdmin : !i.perm || can(user, i.perm)));
  // drop empty sections
  return visible.filter((i, idx) => !i.section || (visible[idx + 1] && !visible[idx + 1].section));
}

// Unread chat messages (teachers and students), refreshed every 30 s and when a chat is read
export function useUnreadMessages(user) {
  const [n, setN] = useState(0);
  const enabled = user?.role === "teacher" || user?.role === "student";
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () => api.get("/messages/unread").then((r) => alive && setN(r.unread || 0)).catch(() => {});
    load();
    const t = setInterval(load, 30000);
    window.addEventListener("portal:messages-read", load);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener("portal:messages-read", load);
    };
  }, [enabled]);
  return enabled ? n : 0;
}

function NavItem({ item, collapsed, onNavigate, count = 0 }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        cx(
          "group relative flex h-9 items-center gap-3 rounded-lg text-[13.5px] transition-colors",
          collapsed ? "justify-center px-0" : "px-2.5",
          isActive ? "bg-navy font-semibold text-white" : "font-medium text-slate-600 hover:bg-slate-100 hover:text-navy"
        )
      }
    >
      {({ isActive }) => (
        <>
          <item.icon className={cx("h-[18px] w-[18px] shrink-0", isActive ? "text-brand" : "text-slate-400 group-hover:text-slate-600")} strokeWidth={isActive ? 2.2 : 1.9} />
          {!collapsed && <span className="truncate">{item.label}</span>}
          {count > 0 && (
            <span className={cx("flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white", collapsed ? "absolute right-1 top-0.5 ring-2 ring-white" : "ml-auto")}>{count > 99 ? "99+" : count}</span>
          )}
        </>
      )}
    </NavLink>
  );
}

function Sidebar({ user, onNavigate, collapsed = false, onToggle, onLogout }) {
  const items = navFor(user);
  const unreadMessages = useUnreadMessages(user);
  return (
    <div className="flex h-full flex-col">
      <div className={cx("flex h-16 shrink-0 items-center border-b border-slate-100", collapsed ? "justify-center px-2" : "gap-2 px-4")}>
        <Link to="/" onClick={onNavigate} className="flex min-w-0 items-center" title="Silora Academy website">
          {collapsed ? (
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-navy text-sm font-bold text-brand">S</span>
          ) : (
            <img src={SITE.logo} alt={SITE.name} className="h-9 w-auto mix-blend-multiply" />
          )}
        </Link>
        {!collapsed && onToggle && (
          <button type="button" onClick={onToggle} className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-navy" aria-label="Collapse sidebar" title="Collapse sidebar">
            <PanelLeftClose className="h-4 w-4" />
          </button>
        )}
      </div>

      <nav className={cx("scrollbar-thin min-h-0 flex-1 overflow-y-auto py-3", collapsed ? "px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" : "px-3")} aria-label="Portal">
        <div className="space-y-0.5">
          {items.map((i, idx) =>
            i.section ? (
              collapsed ? (
                <div key={`s${idx}`} className="mx-2 my-3 h-px bg-slate-100" />
              ) : (
                <p key={`s${idx}`} className="px-2.5 pb-1 pt-5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  {i.section}
                </p>
              )
            ) : (
              <NavItem key={i.to} item={i} collapsed={collapsed} onNavigate={onNavigate} count={i.badge === "messages" ? unreadMessages : 0} />
            )
          )}
        </div>
      </nav>

      <div className={cx("shrink-0 border-t border-slate-100", collapsed ? "space-y-1 p-2" : "p-3")}>
        {collapsed ? (
          <>
            <button type="button" onClick={onToggle} className="flex h-9 w-full items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-navy" aria-label="Expand sidebar" title="Expand sidebar">
              <PanelLeftOpen className="h-4 w-4" />
            </button>
            <NavLink to="/portal/profile" title="My profile" className="flex justify-center py-1">
              <Avatar name={user.name} size="sm" />
            </NavLink>
          </>
        ) : (
          <div className="flex items-center gap-2.5 rounded-xl p-1.5">
            <NavLink to="/portal/profile" onClick={onNavigate} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-1 transition hover:bg-slate-50">
              <Avatar name={user.name} size="sm" />
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold text-navy">{user.name}</span>
                <span className="block truncate text-[11px] text-slate-500">{user.superAdmin ? "Super admin" : roleLabel[user.role]}</span>
              </span>
            </NavLink>
            <button type="button" onClick={() => onLogout()} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600" aria-label="Sign out" title="Sign out">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ unread: 0, notifications: [] });
  const btn = useRef(null);
  const panel = useRef(null);
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const load = () => api.get("/notifications", { limit: 8 }).then(setData).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 20000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    window.addEventListener("portal:notifications-changed", onFocus);
    window.addEventListener("portal:push", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("portal:notifications-changed", onFocus);
      window.removeEventListener("portal:push", onFocus);
    };
  }, []);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const h = (e) => !btn.current?.contains(e.target) && !panel.current?.contains(e.target) && setOpen(false);
    document.addEventListener("pointerdown", h);
    return () => document.removeEventListener("pointerdown", h);
  }, [open]);

  const openItem = async (n) => {
    if (!n.read) await api.post(`/notifications/${n.id}/read`).catch(() => {});
    load();
    setOpen(false);
    if (n.link) navigate(n.link);
  };
  const readAll = async () => {
    await api.post("/notifications/read-all").catch(() => {});
    load();
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          if (!open) load();
        }}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-navy"
        aria-label={`Notifications${data.unread ? ` (${data.unread} unread)` : ""}`}
      >
        <Bell className="h-5 w-5" />
        {data.unread > 0 && <span className="absolute right-1 top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-2 ring-white">{data.unread > 99 ? "99+" : data.unread}</span>}
      </button>
      {open &&
        createPortal(
          <div ref={panel} className="fixed right-2 top-[68px] z-[800] w-[min(400px,calc(100vw-16px))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_12px_32px_-12px_rgba(15,23,42,0.3)]">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <p className="font-bold text-navy">Notifications</p>
              {data.unread > 0 && (
                <button onClick={readAll} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-navy">
                  <CheckCheck className="h-3.5 w-3.5" /> Mark all read
                </button>
              )}
            </div>
            <ul className="scrollbar-thin max-h-[60vh] overflow-y-auto">
              {data.notifications.length === 0 && <li className="px-4 py-10 text-center text-sm text-muted">You're all caught up.</li>}
              {data.notifications.map((n) => (
                <li key={n.id}>
                  <button onClick={() => openItem(n)} className={cx("flex w-full gap-3 border-b border-line px-4 py-3 text-left transition hover:bg-surface", !n.read && "bg-brand-soft/50")}>
                    <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-brand")} />
                    <span className="min-w-0">
                      <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400">{n.typeLabel}</span>
                      <span className="block text-sm font-semibold text-navy">{n.title}</span>
                      {n.body && <span className="line-clamp-2 block text-xs text-muted">{n.body}</span>}
                      <span className="mt-0.5 block text-[11px] text-slate-400">{fromNow(n.createdAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <Link to="/portal/notifications" className="flex items-center justify-center gap-1.5 px-4 py-3 text-sm font-semibold text-navy hover:bg-surface">
              View all notifications <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </div>,
          document.body
        )}
    </>
  );
}

const COLLAPSE_KEY = "portal.sidebarCollapsed";
const readCollapsed = () => {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
};

// "Turn on notifications" banner + live toasts for pushes that arrive while the portal is open
const PUSH_DISMISS_KEY = "portal.pushPromptDismissed";
function PushPrompt({ user }) {
  const ui = useUi();
  const navigate = useNavigate();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const register = (token) => api.post("/me/push-token", { token });

  useEffect(() => {
    if (!pushConfigured()) return;
    resumePush(register);
    let dismissed = false;
    try {
      dismissed = Number(localStorage.getItem(PUSH_DISMISS_KEY) || 0) > Date.now() - 7 * 86400000;
    } catch {
      /* storage unavailable */
    }
    setShow(Notification.permission === "default" && user.notifyPush !== false && !dismissed);
  }, [user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onPush = (e) => {
      const d = e.detail || {};
      if (d.title) ui.toast(d.title, "info");
    };
    window.addEventListener("portal:push", onPush);
    return () => window.removeEventListener("portal:push", onPush);
  }, [ui, navigate]);

  if (!show) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(PUSH_DISMISS_KEY, String(Date.now()));
    } catch {
      /* storage unavailable */
    }
    setShow(false);
  };
  const turnOn = async () => {
    setBusy(true);
    try {
      await enablePush(register);
      if (user.notifyPush === undefined || user.notifyPush === false) await api.patch("/me", { notifyPush: true }).catch(() => {});
      ui.toast("Notifications are on for this browser");
      setShow(false);
    } catch (e) {
      ui.error(e);
      dismiss();
    } finally {
      setBusy(false);
    }
  };
  const what = user.role === "student" ? "new classes, materials and messages from your teacher" : user.role === "teacher" ? "new classes, join requests and messages from your students" : "classes, materials and requests from teachers";
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
      <BellRing className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1">Turn on notifications to hear about {what} – even when the portal is closed.</span>
      <button type="button" onClick={dismiss} className="rounded-lg px-3 py-1.5 font-semibold text-sky-800 hover:bg-sky-100">
        Not now
      </button>
      <button type="button" onClick={turnOn} disabled={busy} className="rounded-lg bg-navy px-3.5 py-1.5 font-semibold text-white hover:bg-navy-light disabled:opacity-60">
        {busy ? "Turning on…" : "Turn on"}
      </button>
    </div>
  );
}

export default function PortalLayout() {
  const { user, logout } = useAuth();
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  useEffect(() => setDrawer(false), [pathname]);
  useSmoothScroll(pathname);
  useEffect(() => {
    document.body.style.overflow = drawer ? "hidden" : "";
    return () => (document.body.style.overflow = "");
  }, [drawer]);
  const toggleCollapsed = () =>
    setCollapsed((v) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, v ? "0" : "1");
      } catch {
        /* storage unavailable */
      }
      return !v;
    });
  const current = useMemo(() => {
    const items = navFor(user);
    let section = null;
    for (const i of items) {
      if (i.section) section = i.section;
      else if (i.end ? pathname === i.to : pathname.startsWith(i.to)) return { label: i.label, section };
    }
    return null;
  }, [user, pathname]);
  const sideW = collapsed ? "lg:w-[72px]" : "lg:w-[248px]";
  const padL = collapsed ? "lg:pl-[72px]" : "lg:pl-[248px]";

  return (
    <div className="min-h-svh bg-[#f7f8fa]">
      {/* Desktop sidebar */}
      <aside className={cx("fixed inset-y-0 left-0 z-40 hidden border-r border-slate-200/80 bg-white transition-[width] duration-200 lg:block", sideW)}>
        <Sidebar user={user} collapsed={collapsed} onToggle={toggleCollapsed} onLogout={logout} />
      </aside>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-[700] lg:hidden">
          <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-[2px]" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 w-[min(280px,85vw)] bg-white shadow-2xl">
            <button onClick={() => setDrawer(false)} className="absolute right-3 top-4 z-10 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-navy" aria-label="Close menu">
              <X className="h-5 w-5" />
            </button>
            <Sidebar user={user} onNavigate={() => setDrawer(false)} onLogout={logout} />
          </aside>
        </div>
      )}

      <div className={cx("transition-[padding] duration-200", padL)}>
        <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-slate-200/80 bg-white/90 px-3 backdrop-blur-md sm:gap-3 sm:px-6 lg:px-8">
          <button onClick={() => setDrawer(true)} className="rounded-lg p-2 text-navy hover:bg-slate-100 lg:hidden" aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <nav className="flex min-w-0 flex-1 items-center gap-1.5 text-sm" aria-label="Breadcrumb">
            {current?.section && (
              <>
                <span className="hidden truncate text-slate-400 sm:inline">{current.section}</span>
                <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 text-slate-300 sm:block" />
              </>
            )}
            <span className="truncate font-semibold text-navy">{current?.label || "Silora Academy Portal"}</span>
          </nav>
          <NotificationBell />
          <DropMenu
            trigger={
              <button className="flex items-center gap-2 rounded-lg p-1 transition hover:bg-slate-100 sm:pr-2" aria-label="Account menu">
                <Avatar name={user.name} size="sm" />
                <ChevronDown className="hidden h-4 w-4 text-slate-400 sm:block" />
              </button>
            }
            items={[
              { label: "My profile", icon: User, onClick: () => navigate("/portal/profile") },
              { label: "Notifications", icon: Bell, onClick: () => navigate("/portal/notifications") },
              { label: "Announcements", icon: BookOpen, onClick: () => navigate("/portal/announcements") },
              { label: "Sign out", icon: LogOut, danger: true, onClick: () => logout() },
            ]}
          />
        </header>
        <main className="mx-auto w-full max-w-[1320px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          {user?.mustChangePassword && pathname !== "/portal/profile" && (
            // Phones: message across the full width, button underneath on the right
            <div className="mb-6 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center">
              <p className="flex min-w-0 flex-1 items-start gap-2.5 leading-relaxed">
                <KeyRound className="mt-0.5 h-4 w-4 shrink-0" />
                <span>You're signed in with a password the academy sent you. Please choose your own password to keep your account safe.</span>
              </p>
              <Link to="/portal/profile" className="self-end whitespace-nowrap rounded-lg bg-navy px-3.5 py-1.5 font-semibold text-white hover:bg-navy-light sm:self-auto">
                Change password
              </Link>
            </div>
          )}
          <PushPrompt user={user} />
          <PageBoundary path={pathname}>
            <Outlet />
          </PageBoundary>
        </main>
      </div>
    </div>
  );
}
