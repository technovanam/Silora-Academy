// ============================================================
// MESSAGES – private teacher ↔ student chat with file sharing.
// Files are deleted automatically after 7 days (the message
// stays and shows the file as expired). Admins with the
// "messages" permission get two tabs: their own direct chats
// with teachers / students, and a read-only view of every
// teacher–student chat.
// ============================================================
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowLeft, Ban, Eye, Check, CheckCheck, ChevronDown, Copy, Download, Eraser, FileText, Image as ImageIcon, Loader2, MessagesSquare, MoreVertical, Paperclip, Pencil, PenSquare, Send, Trash2, X } from "lucide-react";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import { fmtDate, fmtSize, fmtTime, fromNow } from "../lib/format.js";
import { Avatar, Button, Card, Dialog, Empty, ErrorBox, IconButton, Loading, Menu, PageHeader, SearchInput, Segmented, cx, useUi } from "../ui/index.jsx";

const ACCEPT = ".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv,.png,.jpg,.jpeg,.gif,.webp,.mp4,.webm,.mp3,.m4a,.zip";
const MAX_MB = 25;
const THREAD_POLL_MS = 4000;
const LIST_POLL_MS = 12000;

const dayLabel = (iso) => {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return fmtDate(iso);
};

const ROLE_LABEL = { admin: "Silora Academy admin", teacher: "Teacher", student: "Student" };

// ---- Teachers & students ------------------------------------------------------------------
export function MessagesPage() {
  const { user } = useAuth();
  return <Inbox mode="member" viewerId={user.id} viewerRole={user.role} />;
}

// ---- Admins: direct messages + read-only view of teacher–student chats ---------------------
export function AdminMessagesPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "monitor" ? "monitor" : "direct";
  return (
    <>
      <PageHeader
        title="Messages"
        subtitle={tab === "direct" ? "Message teachers and students directly. They can reply to you here." : "Every conversation between teachers and students. Read-only."}
      />
      <Segmented
        className="mb-4"
        value={tab}
        onChange={(t) => setParams(t === "direct" ? {} : { tab: t })}
        options={[
          { value: "direct", label: "Direct messages", icon: MessagesSquare },
          { value: "monitor", label: "Teacher–student chats", icon: Eye },
        ]}
      />
      <Inbox key={tab} mode={tab} viewerId={user.id} viewerRole="admin" embedded />
    </>
  );
}

/**
 * mode: "member" (teacher / student), "direct" (an admin's own chats),
 * "monitor" (admin read-only view of teacher–student chats).
 */
function Inbox({ mode, viewerId, viewerRole, embedded }) {
  const admin = mode === "monitor";
  const base = { member: "/messages", direct: "/admin/dm", monitor: "/admin/messages" }[mode];
  const [params, setParams] = useSearchParams();
  const active = params.get("c") || null;
  const tabParam = params.get("tab");
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [picker, setPicker] = useState(false);

  const loadList = useCallback(async () => {
    try {
      const r = await api.get(`${base}/conversations`);
      setList(r.conversations);
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [base]);

  useEffect(() => {
    loadList();
    const t = setInterval(() => document.visibilityState === "visible" && loadList(), LIST_POLL_MS);
    return () => clearInterval(t);
  }, [loadList]);

  const open = (id) => setParams({ ...(tabParam ? { tab: tabParam } : {}), ...(id ? { c: id } : {}) }, { replace: false });

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!list) return [];
    if (!s) return list;
    return list.filter((c) => `${c.otherName || ""} ${c.teacherName} ${c.studentName}`.toLowerCase().includes(s));
  }, [list, q]);

  const current = list?.find((c) => c.id === active);

  return (
    <>
      {!embedded && (
        <PageHeader
          title="Messages"
          subtitle={viewerRole === "teacher" ? "Chat privately with your students and share files." : "Chat privately with your teacher and share files."}
          actions={
            <Button icon={PenSquare} onClick={() => setPicker(true)}>
              New message
            </Button>
          }
        />
      )}
      {mode === "direct" && (
        <div className="-mt-1 mb-4 flex justify-end">
          <Button icon={PenSquare} onClick={() => setPicker(true)}>
            New message
          </Button>
        </div>
      )}
      <Card flush className="overflow-hidden">
        <div className={cx("grid min-h-[28rem] md:grid-cols-[20rem_1fr]", embedded ? "h-[calc(100svh-17rem)]" : "h-[calc(100svh-12.5rem)]")}>
          {/* Conversation list */}
          <div className={cx("flex min-h-0 flex-col border-line md:border-r", active && "hidden md:flex")}>
            <div className="border-b border-line p-3">
              <SearchInput value={q} onChange={setQ} placeholder={admin || mode === "direct" ? "Search teacher or student…" : "Search…"} />
            </div>
            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto" data-lenis-prevent>
              {error && !list ? (
                <div className="p-4">
                  <ErrorBox error={error} onRetry={loadList} />
                </div>
              ) : !list ? (
                <Loading className="py-16" />
              ) : filtered.length === 0 ? (
                <Empty
                  icon={MessagesSquare}
                  title={q ? "No matches" : "No conversations yet"}
                  text={q ? "Try another name." : admin ? "Messages between teachers and students will appear here." : mode === "direct" ? "Message a teacher or student with “New message”." : "Start one with “New message”."}
                  className="py-14"
                />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {filtered.map((c) => (
                    <li key={c.id}>
                      <ConversationRow c={c} admin={admin} viewerId={viewerId} active={c.id === active} onClick={() => open(c.id)} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Thread */}
          <div className={cx("min-h-0 flex-col", active ? "flex" : "hidden md:flex")}>
            {active ? (
              <Thread key={active} id={active} base={base} admin={admin} viewerId={viewerId} summary={current} onBack={() => open(null)} onChanged={loadList} />
            ) : (
              <Empty icon={MessagesSquare} title="Select a conversation" text={admin ? "Choose a conversation to read it." : "Choose a conversation, or start a new one."} className="m-auto" />
            )}
          </div>
        </div>
      </Card>
      {!admin && (
        <ContactPicker
          base={base}
          groupByRole={mode === "direct"}
          open={picker}
          onClose={() => setPicker(false)}
          onPicked={async (id) => {
            setPicker(false);
            await loadList();
            open(id);
          }}
        />
      )}
    </>
  );
}

/** WhatsApp-style ticks: one grey = sent, two grey = delivered, two blue = seen. */
function tickState(createdAt, conv) {
  if (!conv || !createdAt) return "sent";
  if (conv.otherReadAt && conv.otherReadAt >= createdAt) return "seen";
  if (conv.otherDeliveredAt && conv.otherDeliveredAt >= createdAt) return "delivered";
  return "sent";
}

function Ticks({ state, onDark, className }) {
  const label = { sent: "Sent", delivered: "Delivered", seen: "Seen" }[state];
  const color = state === "seen" ? (onDark ? "text-sky-300" : "text-sky-500") : onDark ? "text-white/60" : "text-slate-400";
  const Icon = state === "sent" ? Check : CheckCheck;
  return (
    <span title={label} aria-label={label} className={cx("inline-flex", color, className)}>
      <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
    </span>
  );
}

const firstName = (n) => String(n || "").trim().split(/s+/)[0];

function ConversationRow({ c, admin, viewerId, active, onClick }) {
  const last = c.lastMessage;
  const title = admin ? `${c.teacherName || "Teacher"} · ${c.studentName || "Student"}` : c.otherName || "";
  const mineLast = !admin && last && last.senderId === viewerId;
  const who = last ? (mineLast ? "" : admin ? `${firstName(last.senderId === c.teacherId ? c.teacherName : c.studentName) || (last.senderRole === "teacher" ? "Teacher" : "Student")}: ` : "") : "";
  const body = last ? (last.deleted ? (mineLast ? "You deleted this message" : "This message was deleted") : last.text || (last.file ? `📎 ${last.file}` : "")) : "";
  const preview = last ? `${who}${body}` : "No messages yet";
  return (
    <button type="button" onClick={onClick} className={cx("flex w-full items-center gap-3 px-4 py-3 text-left transition", active ? "bg-amber-50/70" : "hover:bg-slate-50")}>
      <Avatar name={admin ? c.teacherName : c.otherName} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className={cx("min-w-0 flex-1 truncate text-sm", c.unread ? "font-bold text-navy" : "font-semibold text-ink")}>{title}</p>
          {c.lastAt && <span className="shrink-0 text-[11px] text-slate-400">{fromNow(c.lastAt)}</span>}
        </div>
        {admin ? <p className="truncate text-[11px] text-slate-400">Teacher · Student</p> : c.otherRole && (c.kind === "direct" || c.otherRole === "admin") ? <p className="truncate text-[11px] text-slate-400">{ROLE_LABEL[c.otherRole]}</p> : null}
        <div className="flex items-center gap-2">
          {mineLast && !last.deleted && <Ticks state={tickState(last.at, c)} className="-mr-1 shrink-0" />}
          <p className={cx("min-w-0 flex-1 truncate text-[13px]", last?.deleted && "italic", c.unread ? "font-medium text-ink" : "text-muted")}>{preview}</p>
          {c.unread > 0 && <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">{c.unread > 99 ? "99+" : c.unread}</span>}
        </div>
      </div>
    </button>
  );
}

// ---- One conversation ------------------------------------------------------------------------
const byTime = (a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);

/** Apply created / edited / deleted / hidden messages from a poll to the loaded list. */
function mergeChanges(cur, changes) {
  const map = new Map(cur.map((m) => [m.id, m]));
  const oldest = cur[0]?.createdAt;
  for (const m of changes) {
    if (m.hidden) map.delete(m.id);
    else if (map.has(m.id) || !oldest || m.createdAt >= oldest) map.set(m.id, m);
  }
  return [...map.values()].sort(byTime);
}

function Thread({ id, base, admin, viewerId, summary, onBack, onChanged }) {
  const ui = useUi();
  const [conv, setConv] = useState(summary || null);
  const [messages, setMessages] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const listRef = useRef(null);
  const stick = useRef(true);
  const cursor = useRef(null);
  const idsRef = useRef(new Set());

  useEffect(() => {
    idsRef.current = new Set((messages || []).map((m) => m.id));
  }, [messages]);

  const markRead = useCallback(() => {
    if (admin) return; // an admin reading changes nothing
    api
      .post(`${base}/conversations/${id}/read`)
      .then(() => window.dispatchEvent(new Event("portal:messages-read")))
      .catch(() => {});
  }, [admin, base, id]);

  // First page
  useEffect(() => {
    let alive = true;
    api
      .get(`${base}/conversations/${id}`)
      .then((r) => {
        if (!alive) return;
        setConv(r.conversation);
        setMessages(r.messages);
        setHasMore(r.hasMore);
        cursor.current = r.cursor || null;
        markRead();
        onChanged?.();
      })
      .catch((e) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, [base, id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live updates: new, edited and deleted messages + the other person's ticks
  const poll = useCallback(async () => {
    if (!cursor.current) return;
    const r = await api.get(`${base}/conversations/${id}`, { since: cursor.current });
    setConv(r.conversation);
    cursor.current = r.cursor || cursor.current;
    if (!r.messages.length) return;
    const incoming = r.messages.some((m) => !m.hidden && m.senderId !== viewerId && !idsRef.current.has(m.id));
    setMessages((cur) => mergeChanges(cur || [], r.messages));
    if (incoming) {
      markRead();
      onChanged?.();
    }
  }, [base, id, viewerId, markRead, onChanged]);

  useEffect(() => {
    if (!messages) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") poll().catch(() => {});
    }, THREAD_POLL_MS);
    return () => clearInterval(t);
  }, [!!messages, poll]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep scrolled to the bottom unless the reader scrolled up
  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);
  const onScroll = () => {
    const el = listRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const loadOlder = async () => {
    if (!messages?.length) return;
    setLoadingOlder(true);
    const el = listRef.current;
    const prevHeight = el?.scrollHeight || 0;
    try {
      const r = await api.get(`${base}/conversations/${id}`, { before: messages[0].createdAt });
      stick.current = false;
      setMessages((cur) => [...r.messages, ...cur]);
      setHasMore(r.hasMore);
      requestAnimationFrame(() => el && (el.scrollTop = el.scrollHeight - prevHeight));
    } catch (e) {
      ui.error(e);
    } finally {
      setLoadingOlder(false);
    }
  };

  const onSent = (m) => {
    stick.current = true;
    setMessages((cur) => mergeChanges(cur || [], [m]));
    onChanged?.();
  };

  const onEdited = (m) => {
    setMessages((cur) => mergeChanges(cur || [], [m]));
    setEditing(null);
    onChanged?.();
  };

  const remove = async (m, scope) => {
    try {
      await api.del(`${base}/conversations/${id}/messages/${m.id}?for=${scope}`);
      setMessages((cur) => (scope === "me" ? cur.filter((x) => x.id !== m.id) : cur.map((x) => (x.id === m.id ? { ...x, deleted: true, text: "", file: null } : x))));
      if (editing?.id === m.id) setEditing(null);
      setDeleting(null);
      onChanged?.();
    } catch (e) {
      ui.error(e);
    }
  };

  const clearChat = async (removeChat) => {
    const ok = await ui.confirm({
      title: removeChat ? "Delete this chat?" : "Clear this chat?",
      message: removeChat
        ? "The chat and its messages will be removed from your list. The other person keeps their copy. If a new message arrives, the chat comes back."
        : "All messages will be removed for you. The other person keeps their copy.",
      confirmLabel: removeChat ? "Delete chat" : "Clear chat",
      danger: true,
      onConfirm: () => api.post(`${base}/conversations/${id}/clear`, { remove: removeChat }),
    });
    if (!ok) return;
    setMessages([]);
    setHasMore(false);
    setEditing(null);
    onChanged?.();
    if (removeChat) onBack();
  };

  const title = admin ? `${conv?.teacherName || ""} · ${conv?.studentName || ""}` : conv?.otherName;
  const nameOf = (m) => (m.senderId === conv?.teacherId ? conv?.teacherName : conv?.studentName);

  return (
    <>
      <div className="flex items-center gap-3 border-b border-line px-3 py-2.5 sm:px-4">
        <IconButton icon={ArrowLeft} label="Back" onClick={onBack} className="md:hidden" />
        {conv && <Avatar name={admin ? conv.teacherName : conv.otherName} />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-navy">{title || "…"}</p>
          <p className="truncate text-xs text-muted">{admin ? "Teacher · Student" : conv?.kind === "direct" || conv?.otherRole === "admin" ? ROLE_LABEL[conv.otherRole] || "" : conv?.otherId ? "Private conversation" : ""}</p>
        </div>
        {!admin && messages && (
          <Menu
            trigger={<IconButton icon={MoreVertical} label="Chat options" />}
            items={[
              { label: "Clear chat", icon: Eraser, onClick: () => clearChat(false) },
              { label: "Delete chat", icon: Trash2, danger: true, onClick: () => clearChat(true) },
            ]}
          />
        )}
      </div>

      <div ref={listRef} onScroll={onScroll} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto bg-slate-50/60 px-3 py-4 sm:px-5" data-lenis-prevent>
        {error ? (
          <ErrorBox error={error} />
        ) : !messages ? (
          <Loading className="py-16" />
        ) : messages.length === 0 ? (
          <Empty icon={MessagesSquare} title="No messages yet" text={admin ? "" : "Say hello, or share a worksheet or a photo of your work."} className="py-14" />
        ) : (
          <>
            {hasMore && (
              <div className="mb-3 text-center">
                <Button size="sm" variant="outline" loading={loadingOlder} onClick={loadOlder}>
                  Load earlier messages
                </Button>
              </div>
            )}
            {messages.map((m, i) => {
              const prev = messages[i - 1];
              const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
              const grouped = !newDay && prev && prev.senderId === m.senderId && new Date(m.createdAt) - new Date(prev.createdAt) < 5 * 60000;
              // Admin view: teacher on the right, student on the left
              const mine = admin ? m.senderId === conv?.teacherId : m.senderId === viewerId;
              return (
                <React.Fragment key={m.id}>
                  {newDay && (
                    <div className="my-3 flex justify-center">
                      <span className="rounded-full bg-white px-3 py-1 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200">{dayLabel(m.createdAt)}</span>
                    </div>
                  )}
                  <Bubble
                    m={m}
                    mine={mine}
                    own={!admin && m.senderId === viewerId}
                    admin={admin}
                    grouped={grouped}
                    name={admin ? nameOf(m) : null}
                    convId={id}
                    base={base}
                    ticks={!admin && m.senderId === viewerId && !m.deleted ? tickState(m.createdAt, conv) : null}
                    editingThis={editing?.id === m.id}
                    onEdit={() => setEditing(m)}
                    onDelete={() => setDeleting(m)}
                  />
                </React.Fragment>
              );
            })}
          </>
        )}
      </div>

      {!admin && messages && <Composer base={base} id={id} onSent={onSent} editing={editing} onEdited={onEdited} onCancelEdit={() => setEditing(null)} />}
      {!admin && <DeleteDialog m={deleting} viewerId={viewerId} onClose={() => setDeleting(null)} onDelete={remove} />}
    </>
  );
}

const EDIT_WINDOW_MS = 15 * 60000;
const DELETE_WINDOW_MS = 48 * 3600000;
const canEdit = (m) => !m.deleted && !!m.text && Date.now() - new Date(m.createdAt).getTime() < EDIT_WINDOW_MS;
const canDeleteForEveryone = (m) => !m.deleted && Date.now() - new Date(m.createdAt).getTime() < DELETE_WINDOW_MS;

function Bubble({ m, mine, own, admin, grouped, name, convId, base, ticks, editingThis, onEdit, onDelete }) {
  const ui = useUi();
  const [showEdits, setShowEdits] = useState(false);
  const copy = () =>
    navigator.clipboard
      ?.writeText(m.text)
      .then(() => ui.toast("Copied"))
      .catch(() => {});

  // Admins see what was deleted (struck through) – teachers & students see a placeholder
  const deletedForMember = m.deleted && !admin;
  const items = admin
    ? [{ label: "Copy text", icon: Copy, onClick: copy, hidden: !m.text }]
    : [
        { label: "Copy text", icon: Copy, onClick: copy, hidden: !m.text || m.deleted },
        { label: "Edit", icon: Pencil, onClick: onEdit, hidden: !own || !canEdit(m) },
        { label: "Delete", icon: Trash2, onClick: onDelete, danger: true },
      ];
  const hasMenu = items.some((i) => !i.hidden);

  return (
    <div className={cx("group flex flex-col", mine ? "items-end" : "items-start", grouped ? "mt-1" : "mt-3")}>
      {!grouped && name && <p className="mb-1 px-1 text-[11px] font-semibold text-slate-500">{name}</p>}
      <div className={cx("flex max-w-[88%] items-center gap-1 sm:max-w-[72%]", mine && "flex-row-reverse")}>
        <div
          className={cx(
            "min-w-0 overflow-hidden rounded-2xl text-sm shadow-sm transition",
            deletedForMember ? "bg-white text-slate-400 ring-1 ring-slate-200" : mine ? "rounded-br-md bg-navy text-white" : "rounded-bl-md bg-white text-ink ring-1 ring-slate-200",
            editingThis && "ring-2 ring-brand"
          )}
        >
          {deletedForMember ? (
            <p className="flex items-center gap-1.5 px-3.5 py-2 italic">
              <Ban className="h-3.5 w-3.5 shrink-0" />
              {own ? "You deleted this message" : "This message was deleted"}
            </p>
          ) : (
            <>
              {m.file && <Attachment file={m.file} mine={mine} convId={convId} messageId={m.id} base={base} />}
              {m.text && <p className={cx("whitespace-pre-wrap break-words px-3.5 py-2", m.file && "pt-1.5", m.deleted && "line-through opacity-70")}>{m.text}</p>}
            </>
          )}
        </div>
        {hasMenu && (
          <span className="shrink-0 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
            <Menu align={mine ? "right" : "left"} trigger={<IconButton icon={ChevronDown} label="Message options" className="h-7 w-7 text-slate-400" />} items={items} />
          </span>
        )}
      </div>
      <p className={cx("mt-0.5 flex items-center gap-1 px-1 text-[10px] text-slate-400", mine && "flex-row-reverse")}>
        {ticks && <Ticks state={ticks} />}
        <span>
          {m.editedAt && !deletedForMember && (
            <button type="button" disabled={!admin || !m.edits?.length} onClick={() => setShowEdits((s) => !s)} className={cx("mr-1 font-medium", admin && m.edits?.length && "underline decoration-dotted")}>
              Edited
            </button>
          )}
          {admin && m.deleted && <span className="mr-1 font-semibold text-rose-500">Deleted by sender ·</span>}
          {fmtTime(m.createdAt)}
        </span>
      </p>
      {admin && showEdits && m.edits?.length > 0 && (
        <div className="mt-1 max-w-[85%] rounded-xl bg-white px-3 py-2 text-xs text-slate-500 ring-1 ring-slate-200 sm:max-w-[70%]">
          <p className="mb-1 font-semibold text-slate-600">Earlier versions</p>
          {m.edits.map((e, i) => (
            <p key={i} className="whitespace-pre-wrap break-words border-t border-slate-100 py-1 first:border-0">
              <span className="text-slate-400">{fmtTime(e.at)} · </span>
              {e.text || "(empty)"}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function DeleteDialog({ m, viewerId, onClose, onDelete }) {
  const [busy, setBusy] = useState(null);
  useEffect(() => setBusy(null), [m]);
  if (!m) return null;
  const everyone = m.senderId === viewerId && canDeleteForEveryone(m);
  const run = async (scope) => {
    setBusy(scope);
    await onDelete(m, scope);
    setBusy(null);
  };
  return (
    <Dialog open onClose={onClose} title="Delete message?" size="sm">
      <p className="text-sm text-slate-600">{everyone ? "Delete it for everyone in this chat, or only from your view." : "This removes the message from your view only."}</p>
      <div className="mt-5 flex flex-col items-stretch gap-2 sm:items-end">
        {everyone && (
          <Button variant="danger" loading={busy === "everyone"} disabled={!!busy} onClick={() => run("everyone")} className="sm:min-w-48">
            Delete for everyone
          </Button>
        )}
        <Button variant={everyone ? "outline" : "danger"} loading={busy === "me"} disabled={!!busy} onClick={() => run("me")} className="sm:min-w-48">
          Delete for me
        </Button>
        <Button variant="ghost" disabled={!!busy} onClick={onClose} className="sm:min-w-48">
          Cancel
        </Button>
      </div>
    </Dialog>
  );
}

function Attachment({ file, mine, convId, messageId, base }) {
  const ui = useUi();
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const isImage = file.contentType?.startsWith("image/");
  const linkPath = `${base}/conversations/${convId}/messages/${messageId}/link`;

  useEffect(() => {
    if (!isImage || file.expired) return;
    let alive = true;
    api
      .post(linkPath, {})
      .then((r) => alive && setPreview(r.url))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [isImage, file.expired, linkPath]);

  const openFile = async (download) => {
    setBusy(true);
    // Open the tab first so pop-up blockers allow it, then point it at the file
    const w = download ? null : window.open("", "_blank");
    try {
      const { url } = await api.post(linkPath, { download });
      if (w) w.location.href = url;
      else window.location.href = url;
    } catch (e) {
      w?.close();
      ui.error(e);
    } finally {
      setBusy(false);
    }
  };

  if (file.expired)
    return (
      <div className={cx("flex items-center gap-2.5 px-3.5 py-2.5 text-xs italic", mine ? "text-white/60" : "text-slate-400")}>
        <FileText className="h-4 w-4 shrink-0" />
        <span className="min-w-0 truncate">{file.fileName} – file deleted after 7 days</span>
      </div>
    );

  return (
    <div>
      {isImage && preview && (
        <button type="button" onClick={() => openFile(false)} className="block w-full">
          <img src={preview} alt={file.fileName} className="max-h-72 w-full object-cover" loading="lazy" onError={() => setPreview(null)} />
        </button>
      )}
      <div className={cx("flex items-center gap-2.5 px-3 py-2.5", isImage && preview && "pt-2")}>
        <span className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", mine ? "bg-white/10" : "bg-slate-100")}>
          {isImage ? <ImageIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
        </span>
        <button type="button" onClick={() => openFile(false)} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[13px] font-semibold">{file.fileName}</span>
          <span className={cx("block text-[11px]", mine ? "text-white/55" : "text-slate-400")}>
            {[file.kind, fmtSize(file.size)].filter(Boolean).join(" · ")}
            {file.deleteAt ? ` · until ${fmtDate(file.deleteAt)}` : ""}
          </span>
        </button>
        <button type="button" onClick={() => openFile(true)} disabled={busy} aria-label="Download" title="Download" className={cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition", mine ? "hover:bg-white/10" : "hover:bg-slate-100")}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function Composer({ base, id, onSent, editing, onEdited, onCancelEdit }) {
  const ui = useUi();
  const [text, setText] = useState("");
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(null);
  const fileInput = useRef(null);
  const area = useRef(null);
  const draft = useRef("");
  const sending = progress !== null;

  // Entering edit mode loads the message into the box (and keeps the draft for later)
  useEffect(() => {
    if (editing) {
      draft.current = text;
      setText(editing.text || "");
      setTimeout(() => {
        const el = area.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      }, 0);
    } else {
      setText(draft.current);
      draft.current = "";
    }
  }, [editing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveEdit = async () => {
    const body = text.trim();
    if (!body && !editing.file) return;
    setProgress(0);
    try {
      const r = await api.patch(`${base}/conversations/${id}/messages/${editing.id}`, { text: body });
      onEdited(r.message);
    } catch (err) {
      ui.error(err);
    } finally {
      setProgress(null);
    }
  };

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const pick = (f) => {
    if (!f) return;
    if (f.size > MAX_MB * 1024 * 1024) return ui.toast(`Files can be up to ${MAX_MB} MB`, "error");
    setFile(f);
  };

  const send = async (e) => {
    e?.preventDefault();
    if (editing) return saveEdit();
    const body = text.trim();
    if ((!body && !file) || sending) return;
    const fd = new FormData();
    if (body) fd.append("text", body);
    if (file) fd.append("file", file);
    setProgress(0);
    try {
      const r = await api.upload(`${base}/conversations/${id}/messages`, fd, setProgress);
      setText("");
      setFile(null);
      onSent(r.message);
    } catch (err) {
      ui.error(err);
    } finally {
      setProgress(null);
      area.current?.focus();
    }
  };

  return (
    <form
      onSubmit={send}
      className="border-t border-line bg-white p-2.5 sm:p-3"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        pick(e.dataTransfer.files?.[0]);
      }}
    >
      {editing && (
        <div className="mb-2 flex items-center gap-2.5 rounded-xl border-l-4 border-brand bg-amber-50/70 px-3 py-2">
          <Pencil className="h-4 w-4 shrink-0 text-[#8a6700]" />
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold text-[#8a6700]">Editing message</span>
            <span className="block truncate text-xs text-slate-500">{editing.text}</span>
          </span>
          {!sending && <IconButton icon={X} label="Cancel editing" onClick={onCancelEdit} className="h-7 w-7" />}
        </div>
      )}
      {file && !editing && (
        <div className="mb-2 flex items-center gap-2.5 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
          <Paperclip className="h-4 w-4 shrink-0 text-slate-400" />
          <span className="min-w-0 flex-1 truncate text-sm text-ink">{file.name}</span>
          <span className="shrink-0 text-xs text-slate-400">{fmtSize(file.size)}</span>
          {!sending && <IconButton icon={X} label="Remove file" onClick={() => setFile(null)} className="h-7 w-7" />}
        </div>
      )}
      {sending && file && (
        <div className="mb-2 h-1 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full bg-brand transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}
      <div className="flex items-end gap-2">
        <input ref={fileInput} type="file" accept={ACCEPT} className="hidden" onChange={(e) => (pick(e.target.files?.[0]), (e.target.value = ""))} />
        <IconButton icon={Paperclip} label="Attach a file" onClick={() => fileInput.current?.click()} disabled={sending || !!editing} className="h-11 w-11 shrink-0 disabled:opacity-40" />
        <textarea
          ref={area}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) send(e);
            if (e.key === "Escape" && editing) onCancelEdit();
          }}
          onPaste={(e) => {
            if (editing) return;
            const f = [...(e.clipboardData?.files || [])][0];
            if (f) {
              e.preventDefault();
              pick(f);
            }
          }}
          rows={1}
          maxLength={4000}
          placeholder="Write a message…"
          className="scrollbar-thin min-h-11 flex-1 resize-none rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-ink placeholder:text-slate-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
        />
        <button type="submit" disabled={(!text.trim() && !(editing ? editing.file : file)) || sending} aria-label={editing ? "Save" : "Send"} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-navy transition hover:bg-brand-hover disabled:opacity-40">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? <Check className="h-4 w-4" strokeWidth={3} /> : <Send className="h-4 w-4" />}
        </button>
      </div>
      <p className="mt-1.5 hidden px-1 text-[11px] text-slate-400 sm:block">
        {editing ? "Enter to save · Esc to cancel" : `Enter to send · Shift+Enter for a new line · Files up to ${MAX_MB} MB are kept for 7 days`}
      </p>
    </form>
  );
}

function ContactPicker({ base, groupByRole, open, onClose, onPicked }) {
  const ui = useUi();
  const [contacts, setContacts] = useState(null);
  const [q, setQ] = useState("");
  const [role, setRole] = useState("all");
  const [busy, setBusy] = useState(null);
  useEffect(() => {
    if (!open) return;
    setQ("");
    api
      .get(`${base}/contacts`)
      .then((r) => setContacts(r.contacts))
      .catch((e) => {
        ui.error(e);
        setContacts([]);
      });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async (c) => {
    setBusy(c.id);
    try {
      const r = await api.post(`${base}/conversations`, { userId: c.id });
      onPicked(r.id);
    } catch (e) {
      ui.error(e);
    } finally {
      setBusy(null);
    }
  };

  const shown = (contacts || []).filter((c) => (role === "all" || c.role === role) && c.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Dialog open={open} onClose={onClose} title="New message" subtitle="Choose who to write to" size="sm">
      {groupByRole && (
        <Segmented
          size="sm"
          className="mb-3"
          value={role}
          onChange={setRole}
          options={[
            { value: "all", label: "Everyone" },
            { value: "teacher", label: "Teachers", count: (contacts || []).filter((c) => c.role === "teacher").length },
            { value: "student", label: "Students", count: (contacts || []).filter((c) => c.role === "student").length },
          ]}
        />
      )}
      <SearchInput value={q} onChange={setQ} placeholder="Search by name…" />
      <div className="mt-3">
        {!contacts ? (
          <Loading className="py-10" />
        ) : shown.length === 0 ? (
          <Empty title={contacts.length ? "No matches" : "No one to message yet"} text={contacts.length ? "" : groupByRole ? "There are no active teachers or students yet." : "You can message people you have classes with."} className="py-8" />
        ) : (
          <ul className="-mx-2 space-y-0.5">
            {shown.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => start(c)} disabled={!!busy} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-slate-50 disabled:opacity-60">
                  <Avatar name={c.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{c.name}</span>
                    {(c.subtitle || groupByRole) && <span className="block truncate text-xs text-muted">{[groupByRole && ROLE_LABEL[c.role], c.subtitle].filter(Boolean).join(" · ")}</span>}
                  </span>
                  {busy === c.id && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
