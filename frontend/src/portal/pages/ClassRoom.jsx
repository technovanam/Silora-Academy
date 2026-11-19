// ============================================================
// LIVE CLASS – our own meeting screen (no third-party video).
// Flow: class details → before joining (camera check for the
// teacher) → waiting room (students) → live class → finished.
// The connection logic lives in lib/live.js.
// ============================================================
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, Check, Clock, Hand, Loader2, LogOut, MessageSquare, Mic, MicOff, MonitorOff, MonitorUp, PhoneOff, RefreshCw, Send, UserX, Users, Video, VideoOff, Volume2, WifiOff, X,
} from "lucide-react";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import { fmtDay, fmtTime } from "../lib/format.js";
import { HostEngine, MAX_SPEAKERS, ParticipantEngine, canShareScreen, getCam, getMic, liveDb, mediaErrorText, sendChat, watchChat } from "../lib/live.js";
import { Avatar, Button, Loading, Menu, cx, useAsync, useUi } from "../ui/index.jsx";
import { homeFor } from "./AuthPages.jsx";

const DARK = "flex min-h-svh flex-col bg-[#0b1724] text-white";

export default function ClassRoom() {
  const { id } = useParams();
  const { user } = useAuth();
  const ui = useUi();
  const info = useAsync(() => api.get(`/meetings/${id}/live`), [id]);
  const [phase, setPhase] = useState("pre"); // pre | room | done
  const [role, setRole] = useState(null);
  const [media, setMedia] = useState(null);
  const [done, setDone] = useState(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    document.title = info.data ? `${info.data.meeting.title} – Live class` : "Live class";
  }, [info.data]);

  const join = async (m) => {
    setJoining(true);
    try {
      const r = await api.post(`/meetings/${id}/live/enter`);
      setMedia(m || {});
      setRole(r.role);
      setPhase("room");
    } catch (e) {
      m?.mic?.stop();
      m?.cam?.stop();
      ui.error(e);
    } finally {
      setJoining(false);
    }
  };
  const finish = (reason) => {
    setDone(reason);
    setPhase("done");
  };
  const again = () => {
    setDone(null);
    setPhase("pre");
    info.reload();
  };

  if (info.loading && !info.data)
    return (
      <div className={cx(DARK, "items-center justify-center")}>
        <Loading label="Opening class…" />
      </div>
    );
  if (info.error) return <Message title="Can't open this class" text={info.error.message} user={user} />;
  const data = info.data;
  if (phase === "pre") return <PreJoin data={data} busy={joining} onJoin={join} user={user} />;
  if (phase === "done") return <Finished reason={done} data={data} user={user} onAgain={again} />;
  return role === "host" ? <HostRoom data={data} media={media} user={user} onDone={finish} /> : <ParticipantRoom data={data} user={user} onDone={finish} />;
}

// ---------------------------------------------------------------- screens around the class
function Message({ title, text, user, children }) {
  const navigate = useNavigate();
  return (
    <div className={cx(DARK, "items-center justify-center px-4 text-center")}>
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-bold text-white">{title}</h1>
        {text && <p className="mt-3 text-white/70">{text}</p>}
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          {children}
          <Button variant="outline" icon={ArrowLeft} onClick={() => navigate(homeFor(user))}>
            Back to the portal
          </Button>
        </div>
      </div>
    </div>
  );
}

function ClassHeading({ m }) {
  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-wider text-brand">Live class</p>
      <h1 className="mt-2 text-2xl font-bold text-white sm:text-3xl">{m.title}</h1>
      <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/70">
        <span className="inline-flex items-center gap-1.5">
          <Clock className="h-4 w-4" /> {fmtDay(m.startAt)} · {fmtTime(m.startAt)} – {fmtTime(m.endAt)}
        </span>
        <span>with {m.teacherName}</span>
      </p>
    </>
  );
}

function PreJoin({ data, busy, onJoin, user }) {
  const host = data.role === "host";
  if (data.windowError) return <Message title={data.meeting.title} text={data.windowError.message} user={user} />;
  return host ? <HostPreJoin data={data} busy={busy} onJoin={onJoin} /> : <ParticipantPreJoin data={data} busy={busy} onJoin={onJoin} user={user} />;
}

function HostPreJoin({ data, busy, onJoin }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [mic, setMic] = useState(null);
  const [cam, setCam] = useState(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [error, setError] = useState(null);
  const handed = useRef(false);

  useEffect(() => {
    let dead = false;
    const got = [];
    (async () => {
      try {
        const m = await getMic();
        got.push(m);
        if (!dead) setMic(m);
      } catch (e) {
        if (!dead) setError(mediaErrorText(e));
      }
      try {
        const c = await getCam(false);
        got.push(c);
        if (!dead) setCam(c);
      } catch (e) {
        if (!dead) setError(mediaErrorText(e));
      }
    })();
    return () => {
      dead = true;
      if (!handed.current) got.forEach((t) => t.stop());
    };
  }, []);

  const start = () => {
    handed.current = true;
    if (mic) mic.enabled = micOn;
    let c = cam;
    if (cam && !camOn) {
      cam.stop();
      c = null;
    }
    onJoin({ mic, cam: c });
  };

  return (
    <div className={cx(DARK, "px-4 py-8")}>
      <div className="mx-auto grid w-full max-w-5xl items-center gap-8 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <div className="relative aspect-video overflow-hidden rounded-2xl bg-black/40 ring-1 ring-white/10">
            {cam && camOn ? <VideoView track={cam} mirror className="h-full w-full object-cover" /> : <Placeholder name={user.name} text={cam ? "Camera is off" : "No camera"} />}
            <div className="absolute inset-x-0 bottom-3 flex justify-center gap-3">
              <RoundButton icon={micOn ? Mic : MicOff} label={micOn ? "Turn mic off" : "Turn mic on"} off={!micOn} disabled={!mic} onClick={() => setMicOn((v) => !v)} />
              <RoundButton icon={camOn ? Video : VideoOff} label={camOn ? "Turn camera off" : "Turn camera on"} off={!camOn} disabled={!cam} onClick={() => setCamOn((v) => !v)} />
            </div>
          </div>
          {error && <p className="mt-3 rounded-xl bg-amber-500/15 px-4 py-3 text-sm text-amber-200">{error}</p>}
        </div>
        <div>
          <ClassHeading m={data.meeting} />
          <ul className="mt-6 space-y-2 text-sm text-white/70">
            <li>• Use a laptop on home broadband – your video goes to every student.</li>
            <li>• Headphones stop echo when students speak.</li>
            <li>• Students wait until you let them in.</li>
          </ul>
          <div className="mt-8 flex flex-wrap gap-2">
            <Button size="lg" icon={Video} loading={busy} onClick={start}>
              {data.live ? "Rejoin class" : "Start class"}
            </Button>
            <Button size="lg" variant="outline" onClick={() => navigate(homeFor(user))}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ParticipantPreJoin({ data, busy, onJoin, user }) {
  const navigate = useNavigate();
  return (
    <div className={cx(DARK, "items-center justify-center px-4 py-8")}>
      <div className="w-full max-w-lg">
        <ClassHeading m={data.meeting} />
        <p className="mt-6 text-white/70">{user.role === "student" ? "Your microphone and camera stay off. Raise your hand when you want to speak – the teacher turns your mic on." : "You join as a guest: you can watch and use the chat."}</p>
        <div className="mt-8 flex flex-wrap gap-2">
          <Button size="lg" icon={Video} loading={busy} onClick={() => onJoin({})}>
            Join class
          </Button>
          <Button size="lg" variant="outline" onClick={() => navigate(homeFor(user))}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

function Finished({ reason, data, user, onAgain }) {
  const t = {
    left: ["You left the class", "You can join again while the class is running."],
    ended: ["The class has ended", "Thanks for joining."],
    removed: ["You were removed from this class", "Ask your teacher if you think this was a mistake."],
    denied: ["The teacher didn't let you in", "You can ask to join again."],
  }[reason] || ["You left the class", ""];
  return (
    <Message title={t[0]} text={t[1]} user={user}>
      {(reason === "left" || reason === "denied") && (
        <Button icon={RefreshCw} onClick={onAgain}>
          {data.role === "host" ? "Rejoin" : "Join again"}
        </Button>
      )}
    </Message>
  );
}

// ---------------------------------------------------------------- shared pieces
function useEngine(make) {
  const [state, setState] = useState({ eng: null, ctx: null, error: null });
  const [, setVersion] = useState(0);
  useEffect(() => {
    let eng;
    let dead = false;
    liveDb()
      .then((ctx) => {
        if (dead) return;
        eng = make(ctx, (v) => setVersion(v), (e) => setState((s) => ({ ...s, error: e })));
        setState({ eng, ctx, error: null });
      })
      .catch((e) => setState((s) => ({ ...s, error: e })));
    return () => {
      dead = true;
      eng?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return state;
}

// Check in with the server, keep the session alive, and leave when the tab closes
function useClassSession(mid, pingSec, onStatus) {
  const cb = useRef(onStatus);
  cb.current = onStatus;
  useEffect(() => {
    document.body.dataset.inClass = "1";
    const ping = () =>
      api
        .post(`/meetings/${mid}/live/ping`)
        .then((r) => cb.current?.(r))
        .catch(() => {});
    const t = setInterval(ping, (pingSec || 120) * 1000);
    const bye = () => api.beacon(`/meetings/${mid}/live/leave`);
    window.addEventListener("pagehide", bye);
    return () => {
      clearInterval(t);
      window.removeEventListener("pagehide", bye);
      delete document.body.dataset.inClass;
    };
  }, [mid, pingSec]);
}

function VideoView({ stream, track, mirror, className, muted = true }) {
  const ref = useRef(null);
  const src = useMemo(() => stream || (track ? new MediaStream([track]) : null), [stream, track]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = src;
    if (src) el.play().catch(() => {});
  }, [src]);
  return <video ref={ref} autoPlay playsInline muted={muted} className={cx(className, mirror && "-scale-x-100")} />;
}

// Sound from the class. Browsers may block it until the page is tapped once.
function AudioOut({ stream }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !stream) return;
    el.srcObject = stream;
    // Only a blocked autoplay needs a tap; other errors (a new stream arriving) don't
    el.play().catch((e) => e?.name === "NotAllowedError" && window.dispatchEvent(new Event("live:sound-blocked")));
  }, [stream]);
  return <audio ref={ref} autoPlay data-live-audio="" className="hidden" />;
}

function SoundUnlock() {
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const on = () => setBlocked(true);
    window.addEventListener("live:sound-blocked", on);
    return () => window.removeEventListener("live:sound-blocked", on);
  }, []);
  if (!blocked) return null;
  return (
    <button
      onClick={() => {
        document.querySelectorAll("audio[data-live-audio]").forEach((a) => a.play().catch(() => {}));
        setBlocked(false);
      }}
      className="absolute left-1/2 top-4 z-30 inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-navy shadow-lg"
    >
      <Volume2 className="h-4 w-4" /> Tap to turn on sound
    </button>
  );
}

function Placeholder({ name, text }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-[#10243a] p-4 text-center">
      <Avatar name={name} size="lg" />
      {text && <p className="text-sm text-white/60">{text}</p>}
    </div>
  );
}

function RoundButton({ icon: Icon, label, off, danger, active, disabled, badge, onClick, className }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cx(
        "relative inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-40",
        danger ? "bg-rose-600 text-white hover:bg-rose-700" : off ? "bg-rose-500/90 text-white hover:bg-rose-500" : active ? "bg-brand text-navy hover:bg-brand-hover" : "bg-white/10 text-white hover:bg-white/20",
        className
      )}
    >
      <Icon className="h-5 w-5" />
      {badge ? <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-brand px-1.5 text-[11px] font-bold leading-5 text-navy">{badge}</span> : null}
    </button>
  );
}

function Elapsed({ since }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!since) return null;
  const s = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  const p = (n) => String(n).padStart(2, "0");
  return <span className="tabular-nums">{s >= 3600 ? `${Math.floor(s / 3600)}:` : ""}{p(Math.floor((s % 3600) / 60))}:{p(s % 60)}</span>;
}

function TopBar({ title, startedAt, count }) {
  return (
    <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-600 px-2.5 py-1 text-xs font-bold uppercase tracking-wide">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> Live
      </span>
      <h1 className="min-w-0 flex-1 truncate font-semibold text-white">{title}</h1>
      <span className="text-sm text-white/60">
        <Elapsed since={startedAt} />
      </span>
      {count != null && (
        <span className="inline-flex items-center gap-1 text-sm text-white/60">
          <Users className="h-4 w-4" /> {count}
        </span>
      )}
    </header>
  );
}

function Tile({ children, label, mic, className }) {
  return (
    <div className={cx("relative overflow-hidden rounded-2xl bg-black/40 ring-1 ring-white/10", className)}>
      {children}
      {label && (
        <span className="absolute bottom-2 left-2 inline-flex max-w-[85%] items-center gap-1 truncate rounded-lg bg-black/60 px-2 py-1 text-xs font-medium">
          {mic === false && <MicOff className="h-3 w-3 text-rose-300" />}
          {label}
        </span>
      )}
    </div>
  );
}

function SidePanel({ open, title, onClose, children }) {
  if (!open) return null;
  return (
    <aside className="fixed inset-0 z-40 flex flex-col bg-[#0e2135] lg:static lg:z-auto lg:w-[360px] lg:border-l lg:border-white/10">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <h2 className="font-semibold text-white">{title}</h2>
        <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </aside>
  );
}

function Chat({ ctx, mid, me }) {
  const ui = useUi();
  const [list, setList] = useState([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef(null);
  useEffect(() => {
    if (!ctx) return;
    return watchChat({ ...ctx, mid }, setList, () => {});
  }, [ctx, mid]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [list.length]);
  const send = async (e) => {
    e.preventDefault();
    if (!text.trim() || !me) return;
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
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {!list.length && <p className="text-center text-sm text-white/50">No messages yet.</p>}
        {list.map((m) => (
          <div key={m.id}>
            <p className="text-xs text-white/50">
              <span className={cx("font-semibold", m.role === "student" ? "text-white/80" : "text-brand")}>{m.uid === me?.uid ? "You" : m.name}</span>
              {m.at && ` · ${fmtTime(m.at.toDate ? m.at.toDate() : m.at)}`}
            </p>
            <p className="whitespace-pre-wrap break-words text-sm text-white">{m.text}</p>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form onSubmit={send} className="flex gap-2 border-t border-white/10 p-3">
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Message the class" className="h-10 min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/40 focus:border-brand focus:outline-none" />
        <button type="submit" disabled={busy || !text.trim()} aria-label="Send" className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand text-navy disabled:opacity-40">
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}

function ErrorBanner({ error }) {
  if (!error) return null;
  const denied = /permission/i.test(error.message || "");
  return <p className="mx-4 mt-3 rounded-xl bg-rose-500/15 px-4 py-2.5 text-sm text-rose-200">{denied ? "Lost access to the class. Leave and join again." : "Connection problem with the class service. If it keeps happening, leave and join again."}</p>;
}

const usePanel = () => useState(typeof window !== "undefined" && window.innerWidth >= 1024 ? "people" : null);

// ---------------------------------------------------------------- TEACHER
function HostRoom({ data, media, user, onDone }) {
  const ui = useUi();
  const mid = data.meeting.id;
  const [panel, setPanel] = usePanel();
  const { eng, ctx, error } = useEngine((c, onChange, onError) => {
    const e = new HostEngine({ ...c, mid, uid: user.id, onChange, onError });
    e.start(media).catch(onError);
    return e;
  });
  useClassSession(mid, data.pingSec, (r) => r.status === "ended" && onDone("ended"));

  const people = eng?.people || [];
  const waiting = people.filter((p) => p.status === "waiting").sort((a, b) => (a.requestedAt < b.requestedAt ? -1 : 1));
  const inClass = people.filter((p) => p.status === "in" && p.id !== user.id);
  const hands = inClass.filter((p) => p.hand).length;
  const me = people.find((p) => p.id === user.id);

  // A short note when someone starts waiting
  const seen = useRef(0);
  useEffect(() => {
    if (waiting.length > seen.current) ui.toast(`${waiting[waiting.length - 1].name} is waiting to join`, "info");
    seen.current = waiting.length;
  }, [waiting, ui]);

  const act = async (fn) => {
    try {
      await fn();
    } catch (e) {
      ui.error(e);
    }
  };
  const admit = (body) => act(() => api.post(`/meetings/${mid}/live/admit`, body));
  const remove = (p) =>
    ui.confirm({ title: `Remove ${p.name}?`, message: "They leave the class and can't join again until the next class.", danger: true, confirmLabel: "Remove", onConfirm: () => api.post(`/meetings/${mid}/live/remove`, { userId: p.id }) });
  const end = () =>
    ui.confirm({
      title: "End the class for everyone?",
      message: "Everyone leaves the class. Attendance is saved.",
      danger: true,
      confirmLabel: "End class",
      onConfirm: async () => {
        await api.post(`/meetings/${mid}/live/end`);
        onDone("ended");
      },
    });
  const leave = async () => {
    await api.post(`/meetings/${mid}/live/leave`).catch(() => {});
    onDone("left");
  };

  if (!eng) return <div className={cx(DARK, "items-center justify-center")}>{error ? <ErrorBanner error={error} /> : <Loading label="Starting class…" />}</div>;

  const speakers = eng.speakers.map((id) => (id ? { id, peer: eng.peers.get(id), person: people.find((p) => p.id === id) } : null)).filter(Boolean);

  return (
    <div className="flex h-svh flex-col bg-[#0b1724] text-white">
      <TopBar title={data.meeting.title} startedAt={eng.room?.startedAt} count={eng.room?.inClass} />
      <ErrorBanner error={error} />
      <div className="flex min-h-0 flex-1">
        <main className="relative flex min-w-0 flex-1 flex-col gap-3 p-3 sm:p-4">
          <SoundUnlock />
          <Tile className="min-h-0 flex-1" label={eng.screen ? "You are sharing your screen" : "You"} mic={eng.micOn}>
            {eng.screen ? <VideoView track={eng.screen} className="h-full w-full bg-black object-contain" /> : eng.camOn && eng.cam ? <VideoView track={eng.cam} mirror className="h-full w-full object-cover" /> : <Placeholder name={user.name} text="Your camera is off" />}
            {eng.screen && eng.camOn && eng.cam && (
              <div className="absolute right-3 top-3 w-32 overflow-hidden rounded-xl ring-2 ring-white/20 sm:w-44">
                <VideoView track={eng.cam} mirror className="aspect-video w-full object-cover" />
              </div>
            )}
          </Tile>
          {speakers.length > 0 && (
            <div className="grid shrink-0 grid-cols-2 gap-3 sm:h-40 sm:grid-cols-[repeat(2,minmax(0,16rem))]">
              {speakers.map((s) => (
                <Tile key={s.id} label={s.person?.name || "Student"} mic={s.person?.micOn !== false} className="aspect-video sm:aspect-auto">
                  {s.person?.camOn && s.peer ? <VideoView stream={s.peer.video} className="h-full w-full object-cover" /> : <Placeholder name={s.person?.name} />}
                </Tile>
              ))}
            </div>
          )}
          {[...eng.peers.values()].map((p) => (
            <AudioOut key={`${p.id}-${p.gen}`} stream={p.audio} />
          ))}
        </main>
        <SidePanel open={panel === "people"} title={`People (${inClass.length + 1})`} onClose={() => setPanel(null)}>
          <HostPeople eng={eng} waiting={waiting} inClass={inClass} admit={admit} remove={remove} act={act} />
        </SidePanel>
        <SidePanel open={panel === "chat"} title="Chat" onClose={() => setPanel(null)}>
          <Chat ctx={ctx} mid={mid} me={me ? { uid: me.uid, name: me.name, role: me.role } : null} />
        </SidePanel>
      </div>
      <footer className="flex flex-wrap items-center justify-center gap-2 border-t border-white/10 px-3 py-3 sm:gap-3">
        <RoundButton icon={eng.micOn ? Mic : MicOff} label={eng.micOn ? "Turn mic off" : "Turn mic on"} off={!eng.micOn} onClick={() => act(() => eng.setMic(!eng.micOn))} />
        <RoundButton icon={eng.camOn ? Video : VideoOff} label={eng.camOn ? "Turn camera off" : "Turn camera on"} off={!eng.camOn} onClick={() => act(() => eng.setCam(!eng.camOn))} />
        {canShareScreen() && (
          <RoundButton
            icon={eng.screen ? MonitorOff : MonitorUp}
            label={eng.screen ? "Stop sharing" : "Share screen"}
            active={!!eng.screen}
            onClick={() =>
              act(() =>
                eng.setScreen(!eng.screen).catch((e) => {
                  if (e?.name !== "NotAllowedError") throw e;
                })
              )
            }
          />
        )}
        <RoundButton icon={Users} label="People" active={panel === "people"} badge={waiting.length + hands || null} onClick={() => setPanel(panel === "people" ? null : "people")} />
        <RoundButton icon={MessageSquare} label="Chat" active={panel === "chat"} onClick={() => setPanel(panel === "chat" ? null : "chat")} />
        <span className="mx-1 hidden h-8 w-px bg-white/10 sm:block" />
        <Button variant="outline" size="md" icon={LogOut} onClick={leave} className="!border-white/15 !bg-white/5 !text-white hover:!bg-white/10">
          Leave
        </Button>
        <Button variant="danger" size="md" icon={PhoneOff} onClick={end}>
          End class
        </Button>
      </footer>
    </div>
  );
}

const CONN = {
  connecting: ["text-white/50", "Connecting…"],
  reconnecting: ["text-amber-300", "Reconnecting…"],
  failed: ["text-rose-300", "Can't connect – their network may be blocking it"],
};

function HostPeople({ eng, waiting, inClass, admit, remove, act }) {
  const full = eng.speakers.every(Boolean);
  const sorted = [...inClass].sort((a, b) => (b.hand ? 1 : 0) - (a.hand ? 1 : 0) || (b.canSpeak ? 1 : 0) - (a.canSpeak ? 1 : 0) || a.name.localeCompare(b.name));
  return (
    <div className="space-y-5 p-4">
      {waiting.length > 0 && (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-brand">Waiting to join ({waiting.length})</h3>
            {waiting.length > 1 && (
              <button onClick={() => admit({ all: true })} className="text-xs font-semibold text-brand hover:underline">
                Let everyone in
              </button>
            )}
          </div>
          <ul className="space-y-2">
            {waiting.map((p) => (
              <li key={p.id} className="flex items-center gap-2 rounded-xl bg-white/5 p-2">
                <Avatar name={p.name} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                <Button size="xs" variant="success" icon={Check} onClick={() => admit({ userId: p.id })}>
                  Let in
                </Button>
                <button onClick={() => admit({ userId: p.id, allow: false })} aria-label={`Turn ${p.name} away`} title="Turn away" className="rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-white">
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/50">In class ({inClass.length})</h3>
        {!inClass.length && <p className="text-sm text-white/50">No one has joined yet.</p>}
        <ul className="space-y-1">
          {sorted.map((p) => {
            const peer = eng.peers.get(p.id);
            const conn = peer && CONN[peer.state];
            return (
              <li key={p.id} className="flex items-center gap-2 rounded-xl p-2 hover:bg-white/5">
                <Avatar name={p.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-sm">
                    {p.hand && <Hand className="h-4 w-4 shrink-0 text-brand" />}
                    <span className="truncate">{p.name}</span>
                  </p>
                  {conn ? <p className={cx("text-xs", conn[0])}>{conn[1]}</p> : p.canSpeak ? <p className="text-xs text-emerald-300">{p.micOn ? "Speaking" : "Can speak (mic off)"}</p> : null}
                </div>
                {p.canSpeak ? <Mic className="h-4 w-4 text-emerald-300" /> : null}
                <Menu
                  trigger={
                    <button aria-label={`Options for ${p.name}`} className="rounded-lg px-2 py-1 text-xs font-semibold text-white/70 hover:bg-white/10 hover:text-white">
                      •••
                    </button>
                  }
                  items={[
                    { label: full ? `Let speak (${MAX_SPEAKERS} already speaking)` : "Let speak", icon: Mic, hidden: p.canSpeak, disabled: full, onClick: () => act(() => eng.allowSpeak(p.id, true, false)) },
                    { label: "Let speak with camera", icon: Video, hidden: p.canSpeak && p.canVideo, disabled: full && !p.canSpeak, onClick: () => act(() => eng.allowSpeak(p.id, true, true)) },
                    { label: "Stop speaking", icon: MicOff, hidden: !p.canSpeak, onClick: () => act(() => eng.allowSpeak(p.id, false)) },
                    { label: "Lower hand", icon: Hand, hidden: !p.hand, onClick: () => act(() => eng.lowerHand(p.id)) },
                    { label: "Remove from class", icon: UserX, danger: true, onClick: () => remove(p) },
                  ]}
                />
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- STUDENT (and guests)
function ParticipantRoom({ data, user, onDone }) {
  const ui = useUi();
  const mid = data.meeting.id;
  const [panel, setPanel] = useState(null);
  const { eng, ctx, error } = useEngine((c, onChange, onError) => {
    const e = new ParticipantEngine({ ...c, mid, uid: user.id, onChange, onError });
    e.start();
    return e;
  });
  useClassSession(mid, data.pingSec, (r) => r.status === "ended" && onDone("ended"));

  const me = eng?.me;
  const room = eng?.room;
  useEffect(() => {
    if (me?.status === "removed") onDone("removed");
    else if (me?.status === "denied") onDone("denied");
    else if (room?.status === "ended") onDone("ended");
  }, [me?.status, room?.status, onDone]);

  const leave = async () => {
    await api.post(`/meetings/${mid}/live/leave`).catch(() => {});
    onDone("left");
  };
  const act = async (fn) => {
    try {
      await fn();
    } catch (e) {
      ui.error(e);
    }
  };

  if (!eng || !me) return <div className={cx(DARK, "items-center justify-center")}>{error ? <ErrorBanner error={error} /> : <Loading label="Joining…" />}</div>;

  if (me.status !== "in" || room?.status !== "live")
    return (
      <div className={cx(DARK, "items-center justify-center px-4 text-center")}>
        <div className="w-full max-w-md">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand" />
          <h1 className="mt-5 text-2xl font-bold text-white">{room?.status === "live" ? "Waiting for the teacher to let you in" : "The class hasn't started yet"}</h1>
          <p className="mt-3 text-white/70">{room?.status === "live" ? `${data.meeting.teacherName} will let you in shortly. Keep this page open.` : `You'll go in when ${data.meeting.teacherName} starts the class. Keep this page open.`}</p>
          <div className="mt-8">
            <Button variant="outline" onClick={leave}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    );

  const s = eng.streams;
  const sharing = !!room.screen;
  const teacherCam = !!room.hostCam;
  const speakers = (room.speakers || []).map((sp, i) => (sp ? { ...sp, i } : null)).filter(Boolean);
  const blocked = eng.state === "blocked";

  return (
    <div className="flex h-svh flex-col bg-[#0b1724] text-white">
      <TopBar title={data.meeting.title} startedAt={room.startedAt} count={room.inClass} />
      <ErrorBanner error={error} />
      {blocked ? (
        <div className="mx-4 mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-rose-500/15 px-4 py-3 text-sm text-rose-100">
          <WifiOff className="h-5 w-5 shrink-0" />
          <span className="min-w-0 flex-1">Your network is blocking the class. Switch to another network (Wi-Fi or mobile data), then try again.</span>
          <Button size="sm" icon={RefreshCw} onClick={() => eng.retryNow()}>
            Try again
          </Button>
        </div>
      ) : eng.state !== "connected" ? (
        <p className="mx-4 mt-3 flex items-center gap-2 rounded-xl bg-white/5 px-4 py-2.5 text-sm text-white/70">
          <Loader2 className="h-4 w-4 animate-spin" /> {eng.state === "reconnecting" ? "Reconnecting to the class…" : "Connecting to the class…"}
        </p>
      ) : null}
      {eng.mediaError && <p className="mx-4 mt-3 rounded-xl bg-amber-500/15 px-4 py-2.5 text-sm text-amber-200">{eng.mediaError}</p>}
      {me.canSpeak && <p className="mx-4 mt-3 rounded-xl bg-emerald-500/15 px-4 py-2.5 text-sm text-emerald-200">The teacher has let you speak{me.canVideo ? " with your camera" : ""}. Everyone can hear you while your mic is on.</p>}

      <div className="flex min-h-0 flex-1">
        <main className="relative flex min-w-0 flex-1 flex-col gap-3 p-3 sm:p-4">
          <SoundUnlock />
          <Tile className="min-h-0 flex-1" label={sharing ? `${data.meeting.teacherName} is sharing the screen` : data.meeting.teacherName} mic={room.hostMic}>
            {sharing && s ? (
              <VideoView stream={s.screen} className="h-full w-full bg-black object-contain" />
            ) : teacherCam && s ? (
              <VideoView stream={s.teacherVideo} className="h-full w-full object-contain" />
            ) : (
              <Placeholder name={data.meeting.teacherName} text="The teacher's camera is off" />
            )}
            {sharing && teacherCam && s && (
              <div className="absolute right-3 top-3 w-28 overflow-hidden rounded-xl ring-2 ring-white/20 sm:w-40">
                <VideoView stream={s.teacherVideo} className="aspect-video w-full object-cover" />
              </div>
            )}
          </Tile>
          {(speakers.length > 0 || eng.cam) && (
            <div className="grid shrink-0 grid-cols-2 gap-3 sm:h-36 sm:grid-cols-[repeat(3,minmax(0,14rem))]">
              {speakers.map((sp) =>
                sp.uid === user.id ? (
                  <Tile key={sp.uid} label="You" mic={eng.micOn} className="aspect-video sm:aspect-auto">
                    {eng.cam ? <VideoView track={eng.cam} mirror className="h-full w-full object-cover" /> : <Placeholder name={user.name} />}
                  </Tile>
                ) : (
                  <Tile key={sp.uid} label={sp.name} className="aspect-video sm:aspect-auto">
                    {s ? <VideoView stream={s.speakers[sp.i].video} className="h-full w-full object-cover" /> : <Placeholder name={sp.name} />}
                  </Tile>
                )
              )}
            </div>
          )}
          {s && <AudioOut stream={s.teacherAudio} />}
          {s && speakers.filter((sp) => sp.uid !== user.id).map((sp) => <AudioOut key={`${sp.uid}-${eng.gen}`} stream={s.speakers[sp.i].audio} />)}
        </main>
        <SidePanel open={panel === "chat"} title="Chat" onClose={() => setPanel(null)}>
          <Chat ctx={ctx} mid={mid} me={{ uid: me.uid, name: me.name, role: me.role }} />
        </SidePanel>
      </div>

      <footer className="flex flex-wrap items-center justify-center gap-2 border-t border-white/10 px-3 py-3 sm:gap-3">
        <RoundButton icon={eng.micOn ? Mic : MicOff} label={me.canSpeak ? (eng.micOn ? "Turn mic off" : "Turn mic on") : "Raise your hand to speak"} off={me.canSpeak && !eng.micOn} disabled={!me.canSpeak} onClick={() => act(() => eng.setMic(!eng.micOn))} />
        {me.canVideo && <RoundButton icon={eng.cam ? Video : VideoOff} label={eng.cam ? "Turn camera off" : "Turn camera on"} off={!eng.cam} onClick={() => act(() => eng.setCam(!eng.cam))} />}
        {user.role === "student" && !me.canSpeak && <RoundButton icon={Hand} label={me.hand ? "Lower hand" : "Raise hand"} active={!!me.hand} onClick={() => act(() => eng.raiseHand(!me.hand))} />}
        <RoundButton icon={MessageSquare} label="Chat" active={panel === "chat"} onClick={() => setPanel(panel === "chat" ? null : "chat")} />
        <span className="mx-1 hidden h-8 w-px bg-white/10 sm:block" />
        <Button variant="danger" size="md" icon={LogOut} onClick={leave}>
          Leave
        </Button>
      </footer>
    </div>
  );
}
