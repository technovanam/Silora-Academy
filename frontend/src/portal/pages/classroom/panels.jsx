// ============================================================
// Live class: side panels (people, chat, class details, host
// controls) and small floating pieces (reactions, join requests).
// ============================================================
import React, { useEffect, useRef, useState } from "react";
import { Check, Copy, Hand, Mic, MicOff, MoreVertical, Search, Send, ShieldCheck, Video, VideoOff, X } from "lucide-react";
import { fmtDay, fmtTime } from "../../lib/format.js";
import { sendChat, watchChat } from "../../lib/live.js";
import { Menu, Toggle, cx, useUi } from "../../ui/index.jsx";
import { BigAvatar } from "./Stage.jsx";

export function SidePanel({ open, title, onClose, children, footer }) {
  if (!open) return null;
  return (
    <aside className="fixed inset-0 z-40 flex flex-col bg-white text-[#202124] lg:static lg:z-auto lg:my-2 lg:mr-2 lg:w-[360px] lg:shrink-0 lg:rounded-2xl">
      <div className="flex items-center justify-between px-5 pb-2 pt-4">
        <h2 className="text-lg font-normal">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="flex h-10 w-10 items-center justify-center rounded-full text-[#5f6368] hover:bg-black/5">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      {footer}
    </aside>
  );
}

const roleTag = (p) => (p.isHost ? "Running the class" : p.role === "teacher" ? "Teacher" : p.role === "admin" ? "Admin" : "");

// ---------------------------------------------------------------- People
export function PeoplePanel({ people, meId, isHost, waiting = [], onAdmit, menuFor, onMuteAll, onLowerAll }) {
  const [q, setQ] = useState("");
  const match = (p) => !q || p.name.toLowerCase().includes(q.toLowerCase());
  const sorted = [...people].filter(match).sort((a, b) => (b.isHost ? 1 : 0) - (a.isHost ? 1 : 0) || (b.id === meId ? 1 : 0) - (a.id === meId ? 1 : 0) || (b.hand ? 1 : 0) - (a.hand ? 1 : 0) || a.name.localeCompare(b.name));
  const hands = people.filter((p) => p.hand);
  return (
    <div className="space-y-5 px-3 pb-4">
      <label className="mx-2 flex items-center gap-2 rounded-lg border border-[#dadce0] px-3 focus-within:border-[#1a73e8]">
        <Search className="h-4 w-4 text-[#5f6368]" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search for people" className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none" />
      </label>

      {isHost && waiting.length > 0 && (
        <section className="rounded-xl bg-[#f1f3f4] p-2">
          <div className="flex items-center justify-between px-2 py-1">
            <h3 className="text-xs font-medium uppercase tracking-wide text-[#5f6368]">Waiting to join ({waiting.length})</h3>
            {waiting.length > 1 && (
              <button type="button" onClick={() => onAdmit({ all: true })} className="rounded-full px-3 py-1 text-sm font-medium text-[#1a73e8] hover:bg-[#e8f0fe]">
                Admit all
              </button>
            )}
          </div>
          <ul>
            {waiting.map((p) => (
              <li key={p.id} className="flex items-center gap-3 rounded-lg px-2 py-2">
                <BigAvatar name={p.name} className="w-8 text-sm" />
                <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                <button type="button" onClick={() => onAdmit({ userId: p.id, allow: false })} className="rounded-full px-3 py-1.5 text-sm font-medium text-[#5f6368] hover:bg-black/5">
                  Deny
                </button>
                <button type="button" onClick={() => onAdmit({ userId: p.id })} className="rounded-full px-3 py-1.5 text-sm font-medium text-[#1a73e8] hover:bg-[#e8f0fe]">
                  Admit
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {isHost && (hands.length > 0 || people.some((p) => p.canSpeak && p.role === "student")) && (
        <div className="flex flex-wrap gap-2 px-2">
          {hands.length > 0 && (
            <button type="button" onClick={onLowerAll} className="inline-flex items-center gap-1.5 rounded-full border border-[#dadce0] px-3 py-1.5 text-sm font-medium text-[#1a73e8] hover:bg-[#f8f9fa]">
              <Hand className="h-4 w-4" /> Lower all hands ({hands.length})
            </button>
          )}
          {people.some((p) => p.canSpeak && p.role === "student") && (
            <button type="button" onClick={onMuteAll} className="inline-flex items-center gap-1.5 rounded-full border border-[#dadce0] px-3 py-1.5 text-sm font-medium text-[#1a73e8] hover:bg-[#f8f9fa]">
              <MicOff className="h-4 w-4" /> Stop all students speaking
            </button>
          )}
        </div>
      )}

      <section>
        <h3 className="px-4 pb-1 text-xs font-medium uppercase tracking-wide text-[#5f6368]">In the class ({people.length})</h3>
        <ul>
          {sorted.map((p) => {
            const items = menuFor?.(p) || [];
            return (
              <li key={p.id} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-[#f1f3f4]">
                <BigAvatar name={p.name} className="w-8 text-sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">
                    {p.name}
                    {p.id === meId && " (You)"}
                  </p>
                  {(roleTag(p) || p.conn || p.canSpeak) && <p className={cx("truncate text-xs", p.conn ? "text-[#b06000]" : "text-[#5f6368]")}>{p.conn || roleTag(p) || (p.role === "student" && p.canSpeak ? "Allowed to speak" : "")}</p>}
                </div>
                {p.hand && <Hand className="h-4 w-4 shrink-0 text-[#e37400]" aria-label="Hand raised" />}
                {p.camOn ? <Video className="h-4 w-4 shrink-0 text-[#5f6368]" aria-label="Camera on" /> : <VideoOff className="h-4 w-4 shrink-0 text-[#bdc1c6]" aria-label="Camera off" />}
                {p.micOn ? <Mic className="h-4 w-4 shrink-0 text-[#5f6368]" aria-label="Mic on" /> : <MicOff className="h-4 w-4 shrink-0 text-[#bdc1c6]" aria-label="Mic off" />}
                {items.length > 0 ? (
                  <Menu
                    trigger={
                      <button type="button" aria-label={`Options for ${p.name}`} className="flex h-8 w-8 items-center justify-center rounded-full text-[#5f6368] hover:bg-black/5">
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    }
                    items={items}
                  />
                ) : (
                  <span className="w-8" />
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- Chat
/** Chat messages; `ready` turns true once the messages already sent have loaded. */
export function useChat(ctx, mid, enabled = true) {
  const [state, setState] = useState({ list: [], ready: false });
  useEffect(() => {
    if (!ctx || !enabled) return;
    return watchChat({ ...ctx, mid }, (list) => setState({ list, ready: true }), () => {});
  }, [ctx, mid, enabled]);
  return state;
}

export function ChatPanel({ ctx, mid, me, list, chatOn, isHost }) {
  const ui = useUi();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [list.length]);
  const allowed = chatOn || isHost;
  const send = async (e) => {
    e.preventDefault();
    if (!text.trim() || !me || !allowed) return;
    setBusy(true);
    try {
      await sendChat({ ...ctx, mid }, me, text);
      setText("");
    } catch {
      ui.toast("Message not sent. Try again.", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex h-full flex-col">
      <p className="mx-4 mb-2 rounded-lg bg-[#f1f3f4] px-3 py-2 text-xs text-[#5f6368]">{chatOn ? "Messages can be seen by everyone in the class and are deleted when the class ends." : "The teacher has turned off chat for students."}</p>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-2">
        {!list.length && <p className="pt-6 text-center text-sm text-[#5f6368]">No messages yet</p>}
        {list.map((m, i) => {
          const same = i > 0 && list[i - 1].uid === m.uid;
          const at = m.at?.toDate ? m.at.toDate() : m.at;
          return (
            <div key={m.id} className={same ? "-mt-3" : ""}>
              {!same && (
                <p className="text-sm">
                  <span className="font-medium">{m.uid === me?.uid ? "You" : m.name}</span>
                  <span className="ml-2 text-xs text-[#5f6368]">{at ? fmtTime(at) : ""}</span>
                </p>
              )}
              <p className="whitespace-pre-wrap break-words text-sm text-[#3c4043]">{m.text}</p>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      <form onSubmit={send} className="m-3 flex items-center gap-2 rounded-full bg-[#f1f3f4] pl-4 pr-1">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          disabled={!allowed}
          placeholder={allowed ? "Send a message" : "Chat is turned off"}
          className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#5f6368]"
        />
        <button type="submit" disabled={busy || !text.trim() || !allowed} aria-label="Send" className="flex h-10 w-10 items-center justify-center rounded-full text-[#1a73e8] hover:bg-black/5 disabled:text-[#bdc1c6]">
          <Send className="h-5 w-5" />
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- Class details
export function InfoPanel({ meeting, recording, startedAt }) {
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/portal/class/${meeting.id}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <div className="space-y-5 px-5 pb-5">
      <div>
        <h3 className="text-base font-medium">{meeting.title}</h3>
        <p className="mt-1 text-sm text-[#5f6368]">
          {fmtDay(meeting.startAt)} · {fmtTime(meeting.startAt)} – {fmtTime(meeting.endAt)}
        </p>
        <p className="text-sm text-[#5f6368]">Teacher: {meeting.teacherName}</p>
        {meeting.subject && <p className="text-sm text-[#5f6368]">Subject: {meeting.subject}</p>}
        {startedAt && <p className="text-sm text-[#5f6368]">Started at {fmtTime(startedAt)}</p>}
      </div>
      <div>
        <h3 className="text-sm font-medium">Class link</h3>
        <p className="mt-1 break-all text-sm text-[#5f6368]">{link}</p>
        <button type="button" onClick={copy} className="mt-2 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium text-[#1a73e8] hover:bg-[#e8f0fe]">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : "Copy link"}
        </button>
        <p className="mt-1 text-xs text-[#5f6368]">Only students in this class can join, after signing in to the portal.</p>
      </div>
      <div className="rounded-xl bg-[#f1f3f4] p-3 text-sm text-[#3c4043]">
        {recording ? (
          <p className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#ea4335]" /> This class is being recorded.
          </p>
        ) : (
          <p>This class is not being recorded.</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Host controls
export function HostControlsPanel({ room, onSet, onMuteAll, onLowerAll }) {
  return (
    <div className="space-y-5 px-5 pb-5">
      <p className="flex items-center gap-2 text-sm text-[#5f6368]">
        <ShieldCheck className="h-4 w-4" /> Only you can change these.
      </p>
      <section className="space-y-4">
        <h3 className="text-xs font-medium uppercase tracking-wide text-[#5f6368]">Let students</h3>
        <Toggle checked={room?.chatOn !== false} onChange={(v) => onSet({ chatOn: v })} label="Send chat messages" />
        <Toggle checked={!!room?.allowDraw} onChange={(v) => onSet({ allowDraw: v })} label="Draw on the whiteboard" description="You can always draw and clear it." />
      </section>
      <section className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-[#5f6368]">Quick actions</h3>
        <button type="button" onClick={onMuteAll} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-[#f1f3f4]">
          <MicOff className="h-4 w-4 text-[#5f6368]" /> Stop all students speaking
        </button>
        <button type="button" onClick={onLowerAll} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-[#f1f3f4]">
          <Hand className="h-4 w-4 text-[#5f6368]" /> Lower all hands
        </button>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- Floating pieces
export const REACTIONS = ["💖", "👍", "🎉", "👏", "😂", "😮", "😢", "🤔", "👎"];

export function FloatingReactions({ items }) {
  return (
    <div className="pointer-events-none absolute bottom-2 left-4 z-20 h-[60%] w-40">
      {items.map((r) => (
        <div key={r.id} className="live-float absolute bottom-0 flex flex-col items-center" style={{ left: `${r.x}%` }}>
          <span className="text-4xl drop-shadow">{r.e}</span>
          <span className="mt-1 max-w-[120px] truncate rounded-full bg-[#3c4043]/90 px-2 py-0.5 text-[11px] text-white">{r.name}</span>
        </div>
      ))}
    </div>
  );
}

export function WaitingCard({ waiting, onAdmit, onView }) {
  if (!waiting.length) return null;
  const first = waiting[0];
  return (
    <div className="absolute bottom-3 right-3 z-30 w-[300px] max-w-[calc(100%-24px)] rounded-2xl bg-white p-4 text-[#202124] shadow-[0_4px_16px_rgba(0,0,0,.35)]">
      <div className="flex items-center gap-3">
        <BigAvatar name={first.name} className="w-9 text-sm" />
        <p className="min-w-0 flex-1 text-sm">
          {waiting.length === 1 ? (
            <>
              <span className="font-medium">{first.name}</span> wants to join
            </>
          ) : (
            <>
              <span className="font-medium">{first.name}</span> and {waiting.length - 1} other{waiting.length > 2 ? "s" : ""} want to join
            </>
          )}
        </p>
      </div>
      <div className="mt-3 flex justify-end gap-1">
        <button type="button" onClick={onView} className="rounded-full px-3 py-1.5 text-sm font-medium text-[#1a73e8] hover:bg-[#e8f0fe]">
          View
        </button>
        <button type="button" onClick={() => onAdmit(waiting.length === 1 ? { userId: first.id } : { all: true })} className="rounded-full px-3 py-1.5 text-sm font-medium text-[#1a73e8] hover:bg-[#e8f0fe]">
          {waiting.length === 1 ? "Admit" : "Admit all"}
        </button>
      </div>
    </div>
  );
}
