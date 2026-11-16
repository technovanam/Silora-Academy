// ============================================================
// MESSAGES – private teacher ↔ student chat with file sharing.
// Files are deleted automatically after 7 days (the message
// stays and shows the file as expired). Admins with the
// "messages" permission get a read-only view of every chat.
// ============================================================
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowLeft, Download, FileText, Image as ImageIcon, Loader2, MessagesSquare, Paperclip, PenSquare, Send, X } from "lucide-react";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import { fmtDate, fmtSize, fmtTime, fromNow } from "../lib/format.js";
import { Avatar, Button, Card, Dialog, Empty, ErrorBox, IconButton, Loading, PageHeader, SearchInput, cx, useUi } from "../ui/index.jsx";

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

// ---- Teachers & students ------------------------------------------------------------------
export function MessagesPage() {
  const { user } = useAuth();
  return <Inbox mode="member" viewerId={user.id} viewerRole={user.role} />;
}

// ---- Admins: read-only view of every conversation -----------------------------------------
export function AdminMessagesPage() {
  const { user } = useAuth();
  return <Inbox mode="admin" viewerId={user.id} viewerRole="admin" />;
}

function Inbox({ mode, viewerId, viewerRole }) {
  const admin = mode === "admin";
  const base = admin ? "/admin/messages" : "/messages";
  const [params, setParams] = useSearchParams();
  const active = params.get("c") || null;
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

  const open = (id) => setParams(id ? { c: id } : {}, { replace: false });

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!list) return [];
    if (!s) return list;
    return list.filter((c) => `${c.otherName || ""} ${c.teacherName} ${c.studentName}`.toLowerCase().includes(s));
  }, [list, q]);

  const current = list?.find((c) => c.id === active);

  return (
    <>
      <PageHeader
        title="Messages"
        subtitle={admin ? "Every conversation between teachers and students. Read-only." : viewerRole === "teacher" ? "Chat privately with your students and share files." : "Chat privately with your teacher and share files."}
        actions={
          !admin && (
            <Button icon={PenSquare} onClick={() => setPicker(true)}>
              New message
            </Button>
          )
        }
      />
      <Card flush className="overflow-hidden">
        <div className="grid h-[calc(100svh-12.5rem)] min-h-[28rem] md:grid-cols-[20rem_1fr]">
          {/* Conversation list */}
          <div className={cx("flex min-h-0 flex-col border-line md:border-r", active && "hidden md:flex")}>
            <div className="border-b border-line p-3">
              <SearchInput value={q} onChange={setQ} placeholder={admin ? "Search teacher or student…" : "Search…"} />
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
                  text={q ? "Try another name." : admin ? "Messages between teachers and students will appear here." : "Start one with “New message”."}
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

function ConversationRow({ c, admin, viewerId, active, onClick }) {
  const last = c.lastMessage;
  const title = admin ? `${c.teacherName} · ${c.studentName}` : c.otherName;
  const preview = last ? `${last.senderId === viewerId ? "You: " : admin ? `${last.senderId === c.teacherId ? c.teacherName.split(" ")[0] : c.studentName.split(" ")[0]}: ` : ""}${last.text || (last.file ? `📎 ${last.file}` : "")}` : "No messages yet";
  return (
    <button type="button" onClick={onClick} className={cx("flex w-full items-center gap-3 px-4 py-3 text-left transition", active ? "bg-amber-50/70" : "hover:bg-slate-50")}>
      <Avatar name={admin ? c.teacherName : c.otherName} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className={cx("min-w-0 flex-1 truncate text-sm", c.unread ? "font-bold text-navy" : "font-semibold text-ink")}>{title}</p>
          {c.lastAt && <span className="shrink-0 text-[11px] text-slate-400">{fromNow(c.lastAt)}</span>}
        </div>
        {admin && <p className="truncate text-[11px] text-slate-400">Teacher · Student</p>}
        <div className="flex items-center gap-2">
          <p className={cx("min-w-0 flex-1 truncate text-[13px]", c.unread ? "font-medium text-ink" : "text-muted")}>{preview}</p>
          {c.unread > 0 && <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">{c.unread > 99 ? "99+" : c.unread}</span>}
        </div>
      </div>
    </button>
  );
}

// ---- One conversation ------------------------------------------------------------------------
function Thread({ id, base, admin, viewerId, summary, onBack, onChanged }) {
  const ui = useUi();
  const [conv, setConv] = useState(summary || null);
  const [messages, setMessages] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState(null);
  const listRef = useRef(null);
  const stick = useRef(true);
  const lastAt = useRef(null);

  const markRead = useCallback(() => {
    if (admin) return; // an admin reading changes nothing
    api
      .post(`/messages/conversations/${id}/read`)
      .then(() => window.dispatchEvent(new Event("portal:messages-read")))
      .catch(() => {});
  }, [admin, id]);

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
        lastAt.current = r.messages.at(-1)?.createdAt || null;
        if (r.conversation.unread) markRead();
        onChanged?.();
      })
      .catch((e) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, [base, id]); // eslint-disable-line react-hooks/exhaustive-deps

  // New messages (polling)
  useEffect(() => {
    if (!messages) return;
    const t = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await api.get(`${base}/conversations/${id}`, lastAt.current ? { after: lastAt.current } : undefined);
        const fresh = r.messages;
        if (!fresh.length) return;
        setMessages((cur) => {
          const seen = new Set(cur.map((m) => m.id));
          return [...cur, ...fresh.filter((m) => !seen.has(m.id))];
        });
        lastAt.current = fresh.at(-1).createdAt;
        if (fresh.some((m) => m.senderId !== viewerId)) {
          markRead();
          onChanged?.();
        }
      } catch {
        /* try again next tick */
      }
    }, THREAD_POLL_MS);
    return () => clearInterval(t);
  }, [base, id, !!messages, viewerId, markRead, onChanged]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setMessages((cur) => [...(cur || []), m]);
    lastAt.current = m.createdAt;
    onChanged?.();
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
          <p className="truncate text-xs text-muted">{admin ? "Teacher · Student" : summary?.otherId ? "Private conversation" : ""}</p>
        </div>
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
                  <Bubble m={m} mine={mine} grouped={grouped} name={admin ? nameOf(m) : null} convId={id} base={base} />
                </React.Fragment>
              );
            })}
          </>
        )}
      </div>

      {!admin && messages && <Composer id={id} onSent={onSent} />}
    </>
  );
}

function Bubble({ m, mine, grouped, name, convId, base }) {
  return (
    <div className={cx("flex flex-col", mine ? "items-end" : "items-start", grouped ? "mt-1" : "mt-3")}>
      {!grouped && name && <p className="mb-1 px-1 text-[11px] font-semibold text-slate-500">{name}</p>}
      <div className={cx("max-w-[85%] overflow-hidden rounded-2xl text-sm shadow-sm sm:max-w-[70%]", mine ? "rounded-br-md bg-navy text-white" : "rounded-bl-md bg-white text-ink ring-1 ring-slate-200")}>
        {m.file && <Attachment file={m.file} mine={mine} convId={convId} messageId={m.id} base={base} />}
        {m.text && <p className={cx("whitespace-pre-wrap break-words px-3.5 py-2", m.file && "pt-1.5")}>{m.text}</p>}
      </div>
      <p className="mt-0.5 px-1 text-[10px] text-slate-400">{fmtTime(m.createdAt)}</p>
    </div>
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

function Composer({ id, onSent }) {
  const ui = useUi();
  const [text, setText] = useState("");
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(null);
  const fileInput = useRef(null);
  const area = useRef(null);
  const sending = progress !== null;

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
    const body = text.trim();
    if ((!body && !file) || sending) return;
    const fd = new FormData();
    if (body) fd.append("text", body);
    if (file) fd.append("file", file);
    setProgress(0);
    try {
      const r = await api.upload(`/messages/conversations/${id}/messages`, fd, setProgress);
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
      {file && (
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
        <IconButton icon={Paperclip} label="Attach a file" onClick={() => fileInput.current?.click()} disabled={sending} className="h-11 w-11 shrink-0" />
        <textarea
          ref={area}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) send(e);
          }}
          onPaste={(e) => {
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
        <button type="submit" disabled={(!text.trim() && !file) || sending} aria-label="Send" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-navy transition hover:bg-brand-hover disabled:opacity-40">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
      <p className="mt-1.5 px-1 text-[11px] text-slate-400">Enter to send · Shift+Enter for a new line · Files up to {MAX_MB} MB are kept for 7 days</p>
    </form>
  );
}

function ContactPicker({ open, onClose, onPicked }) {
  const ui = useUi();
  const [contacts, setContacts] = useState(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(null);
  useEffect(() => {
    if (!open) return;
    setQ("");
    api
      .get("/messages/contacts")
      .then((r) => setContacts(r.contacts))
      .catch((e) => {
        ui.error(e);
        setContacts([]);
      });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async (c) => {
    setBusy(c.id);
    try {
      const r = await api.post("/messages/conversations", { userId: c.id });
      onPicked(r.id);
    } catch (e) {
      ui.error(e);
    } finally {
      setBusy(null);
    }
  };

  const shown = (contacts || []).filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Dialog open={open} onClose={onClose} title="New message" subtitle="Choose who to write to" size="sm">
      <SearchInput value={q} onChange={setQ} placeholder="Search by name…" />
      <div className="mt-3">
        {!contacts ? (
          <Loading className="py-10" />
        ) : shown.length === 0 ? (
          <Empty title={contacts.length ? "No matches" : "No one to message yet"} text={contacts.length ? "" : "You can message people you have classes with."} className="py-8" />
        ) : (
          <ul className="-mx-2 space-y-0.5">
            {shown.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => start(c)} disabled={!!busy} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-slate-50 disabled:opacity-60">
                  <Avatar name={c.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{c.name}</span>
                    {c.subtitle && <span className="block truncate text-xs text-muted">{c.subtitle}</span>}
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
