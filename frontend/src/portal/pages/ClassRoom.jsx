// ============================================================
// LIVE CLASS – our own meeting screen (no third-party video).
// Flow: "Ready to join?" (camera check) → waiting to be let in
// (students) → the class → "You left the class".
// Connection logic: lib/live.js · whiteboard: lib/board.js ·
// recording: lib/recorder.js · pieces: pages/classroom/*.
// ============================================================
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Circle, Hand, Info, LayoutGrid, Loader2, Maximize, MessageSquare, Mic, MicOff, Minimize, MonitorUp, MoreVertical, PenLine, Pin, PhoneOff, RefreshCw, Settings, ShieldCheck, Smile, UserX, Users, Video, VideoOff, WifiOff, X,
} from "lucide-react";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import { fmtTime } from "../lib/format.js";
import { HostEngine, MAX_SPEAKERS, ParticipantEngine, canRecord, canShareScreen, getCam, getMic, isMobile, liveDb, mediaErrorText, saveDevice } from "../lib/live.js";
import { Board } from "../lib/board.js";
import { ClassRecorder } from "../lib/recorder.js";
import { Dialog, Loading, Menu, Segmented, cx, useUi } from "../ui/index.jsx";
import { homeFor } from "./AuthPages.jsx";
import { AudioOut, SettingsDialog, SoundUnlock, VideoView } from "./classroom/media.jsx";
import { BigAvatar, Stage, useActiveSpeaker } from "./classroom/Stage.jsx";
import Whiteboard from "./classroom/Whiteboard.jsx";
import { ChatPanel, FloatingReactions, HostControlsPanel, InfoPanel, PeoplePanel, REACTIONS, SidePanel, WaitingCard, useChat } from "./classroom/panels.jsx";

const ROOM_BG = "bg-[#202124]";
const LIGHT = "flex min-h-svh flex-col bg-white text-[#202124]";

// Small animations used on this page
const STYLES = `
@keyframes live-float{0%{transform:translateY(0) scale(.6);opacity:0}12%{transform:translateY(-30px) scale(1);opacity:1}80%{opacity:1}100%{transform:translateY(-300px);opacity:0}}
.live-float{animation:live-float 3.2s ease-out forwards}
@keyframes live-bar{0%,100%{height:4px}50%{height:12px}}
.live-bar{height:4px;animation:live-bar .7s ease-in-out infinite}
`;

export default function ClassRoom() {
  const { id } = useParams();
  const { user } = useAuth();
  const ui = useUi();
  const [info, setInfo] = useState({ loading: true });
  const [phase, setPhase] = useState("pre"); // pre | room | done
  const [role, setRole] = useState(null);
  const [media, setMedia] = useState(null);
  const [done, setDone] = useState(null);
  const [joining, setJoining] = useState(false);

  const load = useCallback(() => {
    api
      .get(`/meetings/${id}/live`)
      .then((data) => setInfo({ data }))
      .catch((error) => setInfo({ error }));
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);
  // Keep "who's in the class" fresh on the join screen
  useEffect(() => {
    if (phase !== "pre") return;
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [phase, load]);

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
  const finish = useCallback((reason) => {
    setDone(reason);
    setPhase("done");
  }, []);
  const again = () => {
    setDone(null);
    setPhase("pre");
    load();
  };

  let body;
  if (info.loading)
    body = (
      <div className={cx(LIGHT, "items-center justify-center")}>
        <Loading label="Opening class…" />
      </div>
    );
  else if (info.error) body = <Message title="Can't open this class" text={info.error.message} user={user} />;
  else if (phase === "pre") body = info.data.windowError ? <Message title={info.data.meeting.title} text={info.data.windowError.message} user={user} /> : <PreJoin data={info.data} busy={joining} onJoin={join} user={user} />;
  else if (phase === "done") body = <Finished reason={done} data={info.data} user={user} onAgain={again} />;
  else body = <Room data={info.data} user={user} isHost={role === "host"} media={media} onDone={finish} />;
  return (
    <>
      <style>{STYLES}</style>
      {body}
    </>
  );
}

// ---------------------------------------------------------------- screens around the class
function Message({ title, text, user, children }) {
  const navigate = useNavigate();
  return (
    <div className={cx(LIGHT, "items-center justify-center px-4 text-center")}>
      <div className="w-full max-w-md">
        <h1 className="text-[28px] font-normal">{title}</h1>
        {text && <p className="mt-3 text-[#5f6368]">{text}</p>}
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {children}
          <PillButton variant="outline" onClick={() => navigate(homeFor(user))}>
            Return to the portal
          </PillButton>
        </div>
      </div>
    </div>
  );
}

function PillButton({ variant = "primary", className, children, loading, ...rest }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={loading || rest.disabled}
      className={cx(
        "inline-flex h-12 items-center justify-center gap-2 rounded-full px-6 text-sm font-medium transition disabled:opacity-60",
        variant === "primary" ? "bg-[#1a73e8] text-white shadow-sm hover:bg-[#1765cc] hover:shadow" : "border border-[#dadce0] text-[#1a73e8] hover:bg-[#f6fafe]",
        className
      )}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

function PreviewButton({ on, icon: OnIcon, offIcon: OffIcon, label, disabled, onClick }) {
  const Icon = on ? OnIcon : OffIcon;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cx("flex h-14 w-14 items-center justify-center rounded-full border transition disabled:cursor-not-allowed disabled:opacity-60", on ? "border-white/70 text-white hover:bg-white/15" : "border-transparent bg-[#ea4335] text-white hover:bg-[#d33b2c]")}
    >
      <Icon className="h-6 w-6" />
    </button>
  );
}

/** "Ready to join?" – camera preview, mic / camera toggles, devices. */
function PreJoin({ data, busy, onJoin, user }) {
  const navigate = useNavigate();
  const host = data.role === "host";
  const student = user.role === "student";
  const [mic, setMic] = useState(null);
  const [cam, setCam] = useState(null);
  const [micOn, setMicOn] = useState(host);
  const [camOn, setCamOn] = useState(host);
  const [error, setError] = useState(null);
  const [settings, setSettings] = useState(false);
  const handed = useRef(false);
  const tracks = useRef({});
  tracks.current = { mic, cam };

  // Teacher: microphone + camera straight away. Students: camera only if they turn it on.
  useEffect(() => {
    let dead = false;
    (async () => {
      if (host) {
        try {
          const m = await getMic();
          if (dead) return m.stop();
          setMic(m);
        } catch (e) {
          if (!dead) setError(mediaErrorText(e));
          setMicOn(false);
        }
      }
      if (host) {
        try {
          const c = await getCam(false);
          if (dead) return c.stop();
          setCam(c);
        } catch (e) {
          if (!dead) setError(mediaErrorText(e));
          setCamOn(false);
        }
      }
    })();
    return () => {
      dead = true;
      if (!handed.current) Object.values(tracks.current).forEach((t) => t?.stop());
    };
  }, [host]);

  const toggleCam = async () => {
    if (camOn) {
      setCamOn(false);
      if (!host) {
        cam?.stop();
        setCam(null);
      }
      return;
    }
    setError(null);
    try {
      if (!cam || cam.readyState === "ended") setCam(await getCam(!host));
      setCamOn(true);
    } catch (e) {
      setError(mediaErrorText(e));
    }
  };

  const switchDevice = async (kind, id) => {
    saveDevice(kind, id);
    try {
      if (kind === "mic" && mic) {
        const n = await getMic(id);
        mic.stop();
        setMic(n);
      }
      if (kind === "cam" && cam) {
        const n = await getCam(!host, id);
        cam.stop();
        setCam(n);
      }
    } catch (e) {
      setError(mediaErrorText(e));
    }
  };

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

  const who = data.live ? (data.inClass > 1 ? `${data.hostName} and ${data.inClass - 1} other${data.inClass > 2 ? "s are" : " is"} in the class` : `${data.hostName || data.meeting.teacherName} is in the class`) : host ? "No one else is here yet" : `The class hasn't started. You'll go in when ${data.meeting.teacherName} starts it.`;

  return (
    <div className={LIGHT}>
      <header className="flex h-16 items-center px-4 sm:px-6">
        <span className="text-[22px] text-[#5f6368]">
          <span className="font-medium text-[#202124]">Silora</span> Classes
        </span>
        <span className="ml-auto truncate text-sm text-[#5f6368]">{user.name}</span>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-10">
        <div className="flex w-full max-w-6xl flex-col items-center gap-8 lg:flex-row lg:gap-12">
          <div className="w-full lg:flex-[1.4]">
            <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-[#202124] shadow-[0_1px_3px_rgba(60,64,67,.3)]">
              {cam && camOn ? (
                <VideoView track={cam} mirror />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-white">
                  <BigAvatar name={user.name} className="w-24 text-4xl" />
                  <p className="text-sm text-white/80">{camOn ? "Starting camera…" : "Camera is off"}</p>
                </div>
              )}
              <span className="absolute left-4 top-3 text-sm font-medium text-white [text-shadow:0_1px_2px_rgba(0,0,0,.6)]">{user.name}</span>
              <div className="absolute inset-x-0 bottom-4 flex justify-center gap-4">
                <PreviewButton
                  on={micOn && !!mic}
                  icon={Mic}
                  offIcon={MicOff}
                  disabled={!host}
                  label={host ? (micOn ? "Turn off microphone" : "Turn on microphone") : "Your microphone stays off until the teacher lets you speak"}
                  onClick={() => setMicOn((v) => !v)}
                />
                <PreviewButton on={camOn && !!cam} icon={Video} offIcon={VideoOff} label={camOn ? "Turn off camera" : "Turn on camera"} onClick={toggleCam} />
              </div>
              <button type="button" onClick={() => setSettings(true)} aria-label="Settings" title="Settings" className="absolute bottom-4 right-4 flex h-10 w-10 items-center justify-center rounded-full text-white hover:bg-white/15">
                <Settings className="h-5 w-5" />
              </button>
            </div>
            {error && <p className="mt-3 rounded-lg bg-[#fce8e6] px-4 py-3 text-sm text-[#a50e0e]">{error}</p>}
          </div>

          <div className="w-full max-w-sm text-center lg:flex-1">
            <h1 className="text-[28px] font-normal">{host ? (data.live ? "Rejoin your class?" : "Ready to start?") : "Ready to join?"}</h1>
            <p className="mt-1 text-base font-medium">{data.meeting.title}</p>
            <p className="mt-1 text-sm text-[#5f6368]">
              {fmtTime(data.meeting.startAt)} – {fmtTime(data.meeting.endAt)} · {data.meeting.teacherName}
            </p>
            <p className="mt-4 text-sm text-[#3c4043]">{who}</p>
            {data.recording && (
              <p className="mt-2 inline-flex items-center gap-2 text-sm text-[#a50e0e]">
                <span className="h-2 w-2 rounded-full bg-[#ea4335]" /> This class is being recorded
              </p>
            )}
            <div className="mt-6 flex flex-col items-center gap-3">
              <PillButton loading={busy} onClick={start} className="min-w-[180px]">
                {host ? (data.live ? "Rejoin" : "Start class") : "Join now"}
              </PillButton>
              <button type="button" onClick={() => navigate(homeFor(user))} className="rounded-full px-4 py-2 text-sm font-medium text-[#1a73e8] hover:bg-[#f6fafe]">
                Back to the portal
              </button>
            </div>
            <p className="mt-6 text-xs leading-relaxed text-[#5f6368]">
              {host
                ? "Tip: use a laptop on home broadband and wear headphones so students' voices don't echo."
                : student
                  ? "Raise your hand when you want to speak – the teacher turns on your microphone. If you turn on your camera, only the teacher sees it."
                  : "You join as a guest. You can watch, chat and talk to the teacher."}
            </p>
          </div>
        </div>
      </main>
      <SettingsDialog open={settings} onClose={() => setSettings(false)} micTrack={mic} camTrack={cam} onSwitch={switchDevice} />
    </div>
  );
}

function WaitingScreen({ room, data, eng, onCancel }) {
  const live = room?.status === "live";
  return (
    <div className={LIGHT}>
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="flex w-full max-w-5xl flex-col items-center gap-8 lg:flex-row lg:gap-12">
          <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-[#202124] lg:flex-[1.4]">
            {eng.cam ? (
              <VideoView track={eng.cam} mirror />
            ) : (
              <div className="flex h-full items-center justify-center">
                <BigAvatar name={eng.me?.name || ""} className="w-24 text-4xl" />
              </div>
            )}
          </div>
          <div className="w-full max-w-sm text-center lg:flex-1">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-[#1a73e8]" />
            <h1 className="mt-4 text-[26px] font-normal">{live ? "Asking to be let in…" : "Waiting for the class to start"}</h1>
            <p className="mt-2 text-sm text-[#5f6368]">{live ? `You'll join when ${room.hostName || data.meeting.teacherName} lets you in.` : `You'll go in when ${data.meeting.teacherName} starts the class. Keep this page open.`}</p>
            <div className="mt-6">
              <PillButton variant="outline" onClick={onCancel}>
                Cancel
              </PillButton>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function Finished({ reason, data, user, onAgain }) {
  const t = {
    left: ["You left the class", ""],
    ended: ["The class has ended", "Thanks for joining."],
    removed: ["You were removed from this class", "Ask your teacher if you think this was a mistake."],
    denied: ["You can't join this class", "The teacher didn't let you in. You can ask again."],
  }[reason] || ["You left the class", ""];
  return (
    <Message title={t[0]} text={t[1]} user={user}>
      {(reason === "left" || reason === "denied") && (
        <PillButton variant="outline" onClick={onAgain}>
          {data.role === "host" ? "Rejoin" : reason === "denied" ? "Ask again" : "Rejoin"}
        </PillButton>
      )}
    </Message>
  );
}

// ---------------------------------------------------------------- shared hooks
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

// Check in with the server, keep the session alive, and leave when the tab closes.
// Returns checkNow() for an extra check (e.g. the connection dropped – did the class end?).
function useClassSession(mid, pingSec, onStatus) {
  const cb = useRef(onStatus);
  cb.current = onStatus;
  const last = useRef(0);
  const ping = useCallback(() => {
    last.current = Date.now();
    return api
      .post(`/meetings/${mid}/live/ping`)
      .then((r) => cb.current?.(r))
      .catch(() => {});
  }, [mid]);
  useEffect(() => {
    document.body.dataset.inClass = "1";
    const t = setInterval(ping, (pingSec || 120) * 1000);
    const bye = () => api.beacon(`/meetings/${mid}/live/leave`);
    // Coming back to the tab: check straight away (a hidden tab can miss updates)
    const back = () => document.visibilityState === "visible" && Date.now() - last.current > 10000 && ping();
    window.addEventListener("pagehide", bye);
    document.addEventListener("visibilitychange", back);
    return () => {
      clearInterval(t);
      window.removeEventListener("pagehide", bye);
      document.removeEventListener("visibilitychange", back);
      delete document.body.dataset.inClass;
    };
  }, [mid, pingSec, ping]);
  return useCallback(() => Date.now() - last.current > 8000 && ping(), [ping]);
}

const LAYOUT_KEY = "silora.live.layout";
function useLayoutPref() {
  const [pref, setPref] = useState(() => {
    try {
      return { layout: "auto", maxTiles: 16, ...JSON.parse(localStorage.getItem(LAYOUT_KEY) || "{}") };
    } catch {
      return { layout: "auto", maxTiles: 16 };
    }
  });
  const set = (p) => {
    const next = { ...pref, ...p };
    setPref(next);
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
    } catch {
      /* private mode */
    }
  };
  return [pref, set];
}

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function useElapsed(since) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!since) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  if (!since) return "";
  const s = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  const p = (n) => String(n).padStart(2, "0");
  return `${s >= 3600 ? `${Math.floor(s / 3600)}:` : ""}${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

// ---------------------------------------------------------------- control bar pieces
function CtrlButton({ icon: Icon, label, onClick, tone = "default", badge, disabled, className, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cx(
        "relative inline-flex h-10 min-w-10 shrink-0 items-center justify-center rounded-full px-2.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ab4f8] disabled:cursor-not-allowed disabled:opacity-40 sm:h-12 sm:min-w-12",
        tone === "off" ? "bg-[#ea4335] text-white hover:bg-[#d33b2c]" : tone === "on" ? "bg-[#8ab4f8] text-[#202124] hover:bg-[#aecbfa]" : tone === "rec" ? "bg-[#ea4335] text-white" : "bg-[#3c4043] text-white hover:bg-[#4a4e51]",
        className
      )}
    >
      <Icon className="h-5 w-5" />
      {children}
      {badge ? <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-[#8ab4f8] px-1 text-[11px] font-bold leading-[18px] text-[#202124]">{badge}</span> : null}
    </button>
  );
}

function SideIcon({ icon: Icon, label, active, badge, onClick }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={cx("relative flex h-12 w-12 items-center justify-center rounded-full transition hover:bg-white/10", active ? "text-[#8ab4f8]" : "text-white")}>
      <Icon className="h-6 w-6" />
      {badge ? <span className="absolute right-1.5 top-1.5 min-w-[18px] rounded-full bg-[#8ab4f8] px-1 text-[11px] font-bold leading-[18px] text-[#202124]">{badge}</span> : null}
    </button>
  );
}

function ReactionPicker({ open, onPick, onClose }) {
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="absolute bottom-[calc(100%+10px)] left-1/2 z-40 flex -translate-x-1/2 gap-1 rounded-full bg-[#3c4043] px-2 py-1.5 shadow-lg">
        {REACTIONS.map((e) => (
          <button key={e} type="button" onClick={() => onPick(e)} aria-label={`Send ${e}`} className="flex h-10 w-10 items-center justify-center rounded-full text-2xl transition hover:scale-125 hover:bg-white/10">
            {e}
          </button>
        ))}
      </div>
    </>
  );
}

const LAYOUTS = [
  { value: "auto", label: "Auto", text: "Picks the best layout for what's on screen" },
  { value: "tiled", label: "Tiled", text: "Everyone in a grid, the presentation too" },
  { value: "spotlight", label: "Spotlight", text: "Only the presentation or the person talking" },
  { value: "sidebar", label: "Sidebar", text: "One big screen with the others at the side" },
];

function LayoutDialog({ open, onClose, pref, setPref }) {
  return (
    <Dialog open={open} onClose={onClose} title="Change layout" subtitle="Saved on this device">
      <div className="space-y-2">
        {LAYOUTS.map((l) => (
          <label key={l.value} className={cx("flex cursor-pointer items-start gap-3 rounded-xl border p-3", pref.layout === l.value ? "border-[#1a73e8] bg-[#e8f0fe]" : "border-line hover:bg-surface")}>
            <input type="radio" name="layout" className="mt-1 accent-[#1a73e8]" checked={pref.layout === l.value} onChange={() => setPref({ layout: l.value })} />
            <span>
              <span className="block text-sm font-medium text-navy">{l.label}</span>
              <span className="block text-xs text-muted">{l.text}</span>
            </span>
          </label>
        ))}
      </div>
      <p className="mb-2 mt-5 text-sm font-medium text-navy">Most tiles on screen</p>
      <Segmented value={pref.maxTiles} onChange={(v) => setPref({ maxTiles: v })} options={[4, 9, 16, 25].map((n) => ({ value: n, label: String(n) }))} />
    </Dialog>
  );
}

const CONN = {
  connecting: "Connecting…",
  reconnecting: "Reconnecting…",
  failed: "Can't connect – their network may be blocking it",
};

// ---------------------------------------------------------------- THE CLASS
function Room({ data, user, isHost, media, onDone }) {
  const ui = useUi();
  const mid = data.meeting.id;
  const mobile = isMobile();
  const [panel, setPanel] = useState(null); // people | chat | info | host
  const [pref, setPref] = useLayoutPref();
  const [pinned, setPinned] = useState(null);
  const [dialog, setDialog] = useState(null); // layout | settings
  const [picker, setPicker] = useState(false);
  const [reactions, setReactions] = useState([]);
  const [recNotice, setRecNotice] = useState(false);
  const [full, setFull] = useState(!!document.fullscreenElement);
  const [recState, setRecState] = useState({ on: false, busy: false, warn: false, since: null });
  const board = useMemo(() => {
    const b = new Board();
    if (isHost) b.load(mid);
    return b;
  }, [isHost, mid]);
  const recRef = useRef(null);
  const sceneRef = useRef(null);
  const lastReact = useRef({});

  const { eng, ctx, error } = useEngine((c, onChange, onError) => {
    if (isHost) {
      const e = new HostEngine({ ...c, mid, uid: user.id, onChange, onError });
      e.start(media).catch(onError);
      return e;
    }
    const e = new ParticipantEngine({ ...c, mid, uid: user.id, onChange, onError });
    e.start({ cam: media?.cam });
    return e;
  });
  const checkNow = useClassSession(mid, data.pingSec, (r) => {
    if (r.status === "ended") onDone("ended");
    else if (!isHost && r.me === "removed") onDone("removed");
  });

  const room = eng?.room;
  const enginePeople = eng?.people;
  const people = useMemo(() => enginePeople || [], [enginePeople]);
  const me = isHost ? people.find((p) => p.id === user.id) : eng?.me;
  const inClassNow = isHost ? !!eng : me?.status === "in" && room?.status === "live";
  const { list: chat, ready: chatReady } = useChat(ctx, mid, inClassNow);

  // Participants: removed / turned away / class over
  useEffect(() => {
    if (isHost) return;
    if (me?.status === "removed") onDone("removed");
    else if (me?.status === "denied") onDone("denied");
    else if (room?.status === "ended") onDone("ended");
  }, [isHost, me?.status, room?.status, onDone]);

  // Lost the teacher's connection: ask the server whether the class has ended
  const connState = isHost ? null : eng?.state;
  useEffect(() => {
    if (connState === "reconnecting" || connState === "blocked") checkNow();
  }, [connState, checkNow]);

  // ---- data link: whiteboard + reactions ----
  const showReaction = useCallback((e, name) => {
    const id = Math.random().toString(36).slice(2);
    setReactions((list) => [...list.slice(-12), { id, e, name, x: Math.random() * 70 }]);
    setTimeout(() => setReactions((list) => list.filter((r) => r.id !== id)), 3300);
  }, []);

  useEffect(() => {
    if (!eng) return;
    if (isHost) {
      const offData = eng.onData((msg, from) => {
        const who = eng.people.find((p) => p.id === from);
        if (msg.t === "react") {
          const now = Date.now();
          if (!REACTIONS.includes(msg.e) || now - (lastReact.current[from] || 0) < 600) return;
          lastReact.current[from] = now;
          showReaction(msg.e, who?.name || "Student");
          eng.broadcast({ t: "react", e: msg.e, name: who?.name || "Student" }, from);
          return;
        }
        // A student drawing: only when allowed, and only their own strokes
        if (!eng.room?.allowDraw || !["wb-s", "wb-a", "wb-x"].includes(msg.t)) return;
        if (msg.t === "wb-s") msg = { ...msg, s: { ...msg.s, uid: from } };
        if (msg.t === "wb-a" && board.strokes.find((s) => s.id === msg.id)?.uid !== from) return;
        if (msg.t === "wb-x") msg = { ...msg, ids: (msg.ids || []).filter((id) => board.strokes.find((s) => s.id === id)?.uid === from) };
        board.apply(msg);
        eng.broadcast(msg, from);
      });
      // Someone (re)connected: send them the whole board
      const offOpen = eng.onPeerOpen((id) => {
        eng.sendTo(id, { t: "wb-reset", strokes: [] });
        board.strokes.forEach((s) => eng.sendTo(id, { t: "wb-s", s }));
      });
      return () => {
        offData();
        offOpen();
      };
    }
    return eng.onData((msg) => {
      if (board.apply(msg)) return;
      if (msg.t === "react" && REACTIONS.includes(msg.e)) showReaction(msg.e, String(msg.name || "").slice(0, 40));
    });
  }, [eng, isHost, board, showReaction]);

  const sendBoard = useCallback(
    (msg, { local = true } = {}) => {
      if (!eng) return;
      if (isHost) {
        if (local) board.apply(msg);
        eng.broadcast(msg);
      } else if (eng.room?.allowDraw) {
        if (local) board.apply(msg);
        eng.send(msg);
      }
    },
    [eng, isHost, board]
  );

  const react = (e) => {
    setPicker(false);
    showReaction(e, "You");
    if (isHost) eng.broadcast({ t: "react", e, name: me?.name || user.name });
    else eng.send({ t: "react", e });
  };

  // ---- notices: someone waiting, hands, new chat messages, recording ----
  const waiting = isHost ? people.filter((p) => p.status === "waiting").sort((a, b) => (a.requestedAt < b.requestedAt ? -1 : 1)) : [];
  const seenHands = useRef(new Set());
  useEffect(() => {
    if (!isHost) return;
    const now = new Set(people.filter((p) => p.hand && p.status === "in").map((p) => p.id));
    now.forEach((id) => !seenHands.current.has(id) && ui.toast(`${people.find((p) => p.id === id)?.name} raised their hand`, "info"));
    seenHands.current = now;
  }, [people, isHost, ui]);

  const [readCount, setReadCount] = useState(0);
  const unread = panel === "chat" ? 0 : Math.max(0, chat.filter((m) => m.uid !== user.id).length - readCount);
  const lastChat = useRef(null); // messages already there when we joined don't pop up
  useEffect(() => {
    if (!chatReady) return;
    const others = chat.filter((m) => m.uid !== user.id);
    if (lastChat.current === null) {
      lastChat.current = others.length;
      setReadCount(others.length);
      return;
    }
    if (panel === "chat") setReadCount(others.length);
    else if (others.length > lastChat.current) {
      const m = others[others.length - 1];
      ui.toast(`${m.name}: ${m.text.slice(0, 80)}`, "info");
    }
    lastChat.current = others.length;
  }, [chat, chatReady, panel, user.id, ui]);

  const recordingOn = !!room?.recording;
  const prevRec = useRef(false);
  useEffect(() => {
    if (recordingOn && !prevRec.current && !isHost) setRecNotice(true);
    if (!recordingOn) setRecNotice(false);
    prevRec.current = recordingOn;
  }, [recordingOn, isHost]);

  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  const act = async (fn) => {
    try {
      await fn();
    } catch (e) {
      ui.error(e);
    }
  };

  // ---- recording (teacher) ----
  const stopRecording = useCallback(
    async (quiet) => {
      const r = recRef.current;
      if (!r) return;
      recRef.current = null;
      setRecState((s) => ({ ...s, busy: true }));
      try {
        const { durationSec } = await r.recorder.stop();
        const res = await api.post(`/meetings/${mid}/live/recording/${r.id}/stop`, { durationSec });
        if (!quiet) ui.toast(res.status === "ready" ? "Recording saved. Admins can watch it under Recordings." : "The recording couldn't be saved.", res.status === "ready" ? "success" : "error");
      } catch (e) {
        if (!quiet) ui.error(e);
      } finally {
        setRecState({ on: false, busy: false, warn: false, since: null });
      }
    },
    [mid, ui]
  );

  const startRecording = () =>
    ui.confirm({
      title: "Record this class?",
      message: "Everyone in the class will see that it's being recorded. The recording is made on this computer and uploaded while you teach – keep this tab open until you stop it. Admins can watch it later.",
      confirmLabel: "Start recording",
      onConfirm: async () => {
        setRecState((s) => ({ ...s, busy: true }));
        try {
          const r = await api.post(`/meetings/${mid}/live/recording/start`);
          const recorder = new ClassRecorder({
            getScene: () => sceneRef.current || {},
            onState: (x) => setRecState((s) => ({ ...s, warn: !!x.error && x.state === "recording" })),
          });
          recorder.onLimit = () => stopRecording();
          recRef.current = { id: r.id, recorder };
          await recorder.start(r);
          setRecState({ on: true, busy: false, warn: false, since: new Date().toISOString() });
        } catch (e) {
          recRef.current = null;
          setRecState({ on: false, busy: false, warn: false, since: null });
          throw e;
        }
      },
    });

  // A recording this browser lost (page reloaded): close it so what was uploaded is kept
  const staleRec = isHost && room?.recording?.id && !recRef.current && !recState.busy ? room.recording.id : null;
  useEffect(() => {
    if (!staleRec) return;
    api
      .post(`/meetings/${mid}/live/recording/${staleRec}/stop`, {})
      .then(() => ui.toast("The recording stopped when the page reloaded. Start it again if you need to.", "info"))
      .catch(() => {});
  }, [staleRec, mid, ui]);

  // Warn before closing the tab while recording
  useEffect(() => {
    if (!recState.on) return;
    const k = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", k);
    return () => window.removeEventListener("beforeunload", k);
  }, [recState.on]);

  // ---- leaving ----
  const leave = async () => {
    if (recRef.current) await stopRecording(true);
    await api.post(`/meetings/${mid}/live/leave`).catch(() => {});
    onDone("left");
  };
  const end = () =>
    ui.confirm({
      title: "End the class for everyone?",
      message: "Everyone leaves the class. Attendance is saved." + (recRef.current ? " The recording is saved first." : ""),
      danger: true,
      confirmLabel: "End class",
      onConfirm: async () => {
        if (recRef.current) await stopRecording(true);
        await api.post(`/meetings/${mid}/live/end`);
        onDone("ended");
      },
    });

  // ---- controls ----
  const canSpeak = isHost || !!me?.canSpeak;
  const toggleMic = () => {
    if (!canSpeak) return ui.toast("Raise your hand – the teacher turns on your microphone.", "info");
    act(() => eng.setMic(!eng.micOn));
  };
  const camOn = isHost ? eng?.camOn && !!eng?.cam : !!eng?.cam;
  const toggleCam = () => act(() => eng.setCam(!camOn));
  const toggleScreen = () =>
    act(async () => {
      if (!eng.screen && room?.board) await eng.setRoom({ board: false });
      await eng.setScreen(!eng.screen).catch((e) => {
        if (e?.name !== "NotAllowedError") throw e;
      });
    });
  const toggleBoard = () =>
    act(async () => {
      if (!room?.board && eng.screen) await eng.setScreen(false);
      await eng.setRoom({ board: !room?.board });
    });
  const togglePanel = (p) => setPanel((cur) => (cur === p ? null : p));
  const fullscreen = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())?.catch?.(() => {});

  // Ctrl+D microphone, Ctrl+E camera (as in other meeting apps)
  const keys = useRef({});
  keys.current = { toggleMic, toggleCam };
  useEffect(() => {
    const k = (e) => {
      if (!(e.ctrlKey || e.metaKey) || /INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return;
      const key = e.key.toLowerCase();
      if (key === "d") {
        e.preventDefault();
        keys.current.toggleMic();
      } else if (key === "e") {
        e.preventDefault();
        keys.current.toggleCam();
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  const activeKey = useActiveSpeaker();
  const recElapsed = useElapsed(recState.since);

  // ---- loading / waiting ----
  if (!eng || (!isHost && !me))
    return (
      <div className={cx("flex h-svh flex-col items-center justify-center text-white", ROOM_BG)}>
        {error ? <ErrorBanner error={error} /> : <Loading label={isHost ? "Starting class…" : "Joining…"} className="text-white" />}
      </div>
    );
  if (!isHost && !inClassNow)
    return (
      <WaitingScreen
        room={room}
        data={data}
        eng={eng}
        onCancel={async () => {
          await api.post(`/meetings/${mid}/live/leave`).catch(() => {});
          onDone("left");
        }}
      />
    );

  // ---- who is on screen ----
  const inClass = people.filter((p) => p.status === "in");
  const others = inClass.filter((p) => p.id !== user.id);
  const s = isHost ? null : eng.streams;
  const speakers = isHost ? eng.speakers : (room?.speakers || []).map((sp) => sp?.uid || null);

  const personFor = (p) => {
    const peer = isHost ? eng.peers.get(p.id) : null;
    const conn = peer && CONN[peer.state];
    return { ...p, conn: conn || null, micOn: p.isHost ? !!room?.hostMic : p.canSpeak ? !!p.micOn : false, camOn: p.isHost ? !!room?.hostCam : !!p.camOn };
  };
  const listPeople = inClass.map((p) => (p.id === user.id ? { ...personFor(p), micOn: !!eng.micOn && canSpeak, camOn } : personFor(p)));

  const meTile = {
    key: user.id,
    name: me?.name || user.name,
    label: "You",
    isSelf: true,
    isTeacher: isHost,
    video: camOn ? { track: eng.cam, mirror: true } : null,
    audio: eng.mic,
    micOn: !!eng.micOn && canSpeak,
    hand: !!me?.hand,
  };
  const tiles = [];
  if (isHost) {
    tiles.push(meTile);
    for (const p of others) {
      const peer = eng.peers.get(p.id);
      tiles.push({
        key: p.id,
        name: p.name,
        hand: !!p.hand,
        video: p.camOn && peer ? { stream: peer.video } : null,
        audio: p.canSpeak && peer ? peer.audio : null,
        micOn: p.canSpeak ? !!p.micOn : false,
        conn: peer && CONN[peer.state],
        person: p,
      });
    }
  } else {
    const host = others.find((p) => p.isHost) || { id: room?.hostId || "host", name: room?.hostName || data.meeting.teacherName };
    tiles.push({ key: host.id, name: host.name, isTeacher: true, video: room?.hostCam && s ? { stream: s.teacherVideo } : null, audio: s?.teacherAudio, micOn: !!room?.hostMic, person: host });
    tiles.push(meTile);
    for (const p of others) {
      if (p.isHost) continue;
      const i = speakers.indexOf(p.id);
      tiles.push({
        key: p.id,
        name: p.name,
        hand: !!p.hand,
        video: i >= 0 && p.camOn && s ? { stream: s.speakers[i].video } : null,
        audio: i >= 0 && s ? s.speakers[i].audio : null,
        micOn: i >= 0 ? !!p.micOn : false,
        person: p,
      });
    }
  }
  // Order: teacher, you, students speaking, raised hands, cameras on, then by name
  const rank = (t) => (t.isTeacher ? 0 : t.isSelf ? 1 : speakers.includes(t.key) ? 2 : t.hand ? 3 : t.video ? 4 : 5);
  tiles.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

  const presenting = room?.board ? "board" : (isHost ? !!eng.screen : !!room?.screen) ? "screen" : null;
  const hostName = room?.hostName || data.meeting.teacherName;
  const present =
    presenting === "board"
      ? { key: "present", kind: "present", name: "Whiteboard", label: "Whiteboard", renderPresent: () => <Whiteboard board={board} send={sendBoard} canDraw={isHost || !!room?.allowDraw} canClear={isHost} uid={user.id} title={data.meeting.title} /> }
      : presenting === "screen"
        ? {
            key: "present",
            kind: "present",
            name: "Presentation",
            label: isHost ? "You are presenting" : `${hostName} is presenting`,
            renderPresent: () => (isHost ? <VideoView track={eng.screen} fit="contain" className="bg-black" /> : s ? <VideoView stream={s.screen} fit="contain" className="bg-black" /> : null),
          }
        : null;

  // What the recording shows (read by the recorder a few times a second)
  if (isHost) {
    const spk = eng.speakers.filter(Boolean).map((id) => ({ id, p: people.find((x) => x.id === id), peer: eng.peers.get(id) }));
    sceneRef.current = {
      title: data.meeting.title,
      main: presenting === "board" ? { type: "board", strokes: board.strokes } : presenting === "screen" ? { type: "track", track: eng.screen } : camOn ? { type: "track", track: eng.cam } : { type: "avatar", name: me?.name || user.name },
      corner: presenting && camOn ? eng.cam : null,
      tiles: spk.map((x) => ({ name: x.p?.name || "Student", track: x.p?.camOn ? x.peer?.video.getVideoTracks()[0] : null })),
      audio: [eng.mic, ...others.filter((p) => p.canSpeak).map((p) => eng.peers.get(p.id)?.audio.getAudioTracks()[0])].filter(Boolean),
    };
  }

  // Host options for a student (tile menu and people list)
  const full2 = eng.speakers?.every(Boolean);
  const hostMenu = (p) => {
    if (!isHost || !p || p.id === user.id || p.status !== "in") return [];
    const speaking = speakers.includes(p.id);
    return [
      { label: full2 && !speaking ? `Let speak (${MAX_SPEAKERS} already speaking)` : "Let speak", icon: Mic, hidden: p.canSpeak && speaking, onClick: () => act(() => eng.allowSpeak(p.id, true, false)) },
      { label: "Let speak with camera", icon: Video, hidden: p.canSpeak && p.canVideo && speaking, onClick: () => act(() => eng.allowSpeak(p.id, true, true)) },
      { label: "Stop speaking", icon: MicOff, hidden: !p.canSpeak || p.role !== "student", onClick: () => act(() => eng.allowSpeak(p.id, false)) },
      { label: "Lower hand", icon: Hand, hidden: !p.hand, onClick: () => act(() => eng.lowerHand(p.id)) },
      {
        label: "Remove from class",
        icon: UserX,
        danger: true,
        onClick: () => ui.confirm({ title: `Remove ${p.name}?`, message: "They leave the class and can't join again until the next class.", danger: true, confirmLabel: "Remove", onConfirm: () => api.post(`/meetings/${mid}/live/remove`, { userId: p.id }) }),
      },
    ];
  };
  const admit = (body) => act(() => api.post(`/meetings/${mid}/live/admit`, body));
  const muteAll = () => act(() => eng.muteAll());
  const lowerAll = () => act(() => eng.lowerAllHands());

  const blocked = !isHost && eng.state === "blocked";
  const connecting = !isHost && !blocked && eng.state !== "connected";
  const handCount = people.filter((p) => p.hand && p.status === "in").length;

  const moreItems = [
    { label: "Change layout", icon: LayoutGrid, onClick: () => setDialog("layout") },
    { label: full ? "Exit full screen" : "Full screen", icon: full ? Minimize : Maximize, hidden: !document.documentElement.requestFullscreen, onClick: fullscreen },
    { label: room?.board ? "Close the whiteboard" : "Open the whiteboard", icon: PenLine, hidden: !isHost || !mobile, onClick: toggleBoard },
    { label: "People", icon: Users, hidden: !mobile, onClick: () => togglePanel("people") },
    { label: "Chat", icon: MessageSquare, hidden: !mobile, onClick: () => togglePanel("chat") },
    { label: "Class details", icon: Info, hidden: !mobile, onClick: () => togglePanel("info") },
    { label: "Host controls", icon: ShieldCheck, hidden: !isHost || !mobile, onClick: () => togglePanel("host") },
    { label: "Settings", icon: Settings, onClick: () => setDialog("settings") },
  ];

  const clockBar = <ClockTitle title={data.meeting.title} />;

  return (
    <div className={cx("flex h-svh flex-col overflow-hidden text-white", ROOM_BG)}>
      <div className="relative flex min-h-0 flex-1">
        <main className="relative flex min-w-0 flex-1 flex-col p-2 sm:p-3">
          {/* Top: recording sign and connection messages */}
          <div className="pointer-events-none absolute left-3 right-3 top-3 z-20 flex flex-wrap items-start gap-2">
            {recordingOn && (
              <span className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-[#3c4043]/95 px-3 py-1.5 text-xs font-medium shadow">
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#ea4335]" />
                REC{isHost && recState.on ? ` ${recElapsed}` : ""}
                {isHost && recState.warn && <span className="text-[#fdd663]">· upload slow, keep this tab open</span>}
              </span>
            )}
            {presenting === "screen" && isHost && <span className="rounded-full bg-[#3c4043]/95 px-3 py-1.5 text-xs font-medium shadow">You are presenting to everyone</span>}
          </div>
          {(error || blocked || connecting || eng.mediaError || recNotice) && (
            <div className="relative z-20 mx-auto mb-2 flex w-full max-w-2xl flex-col gap-2 pt-10 sm:pt-0">
              <ErrorBanner error={error} />
              {blocked && (
                <div className="flex flex-wrap items-center gap-3 rounded-xl bg-[#3c4043] px-4 py-3 text-sm">
                  <WifiOff className="h-5 w-5 shrink-0 text-[#f28b82]" />
                  <span className="min-w-0 flex-1">Your network is blocking the class. Switch to another network (Wi-Fi or mobile data), then try again.</span>
                  <button type="button" onClick={() => eng.retryNow()} className="inline-flex items-center gap-1.5 rounded-full bg-[#8ab4f8] px-4 py-1.5 font-medium text-[#202124]">
                    <RefreshCw className="h-4 w-4" /> Try again
                  </button>
                </div>
              )}
              {connecting && (
                <p className="flex items-center gap-2 rounded-xl bg-[#3c4043] px-4 py-2.5 text-sm text-white/80">
                  <Loader2 className="h-4 w-4 animate-spin" /> {eng.state === "reconnecting" ? "Reconnecting to the class…" : "Connecting to the class…"}
                </p>
              )}
              {eng.mediaError && <p className="rounded-xl bg-[#3c4043] px-4 py-2.5 text-sm text-[#fdd663]">{eng.mediaError}</p>}
              {recNotice && (
                <div className="flex items-center gap-3 rounded-xl bg-[#3c4043] px-4 py-2.5 text-sm">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#ea4335]" />
                  <span className="flex-1">This class is being recorded. Admins can watch the recording later.</span>
                  <button type="button" onClick={() => setRecNotice(false)} className="rounded-full px-3 py-1 font-medium text-[#8ab4f8] hover:bg-white/10">
                    Got it
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="relative min-h-0 flex-1">
            <SoundUnlock />
            <Stage tiles={tiles} present={present} layout={pref.layout} pinned={pinned} onPin={setPinned} maxTiles={pref.maxTiles} activeKey={activeKey} menuFor={(t) => hostMenu(t.person)} onShowPeople={() => setPanel("people")} />
            <FloatingReactions items={reactions} />
            {isHost && panel !== "people" && <WaitingCard waiting={waiting} onAdmit={admit} onView={() => setPanel("people")} />}
          </div>

          {isHost ? [...eng.peers.values()].map((p) => <AudioOut key={`${p.id}-${p.gen}`} stream={p.audio} />) : null}
          {!isHost && s && <AudioOut stream={s.teacherAudio} />}
          {!isHost && s && speakers.map((uid, i) => (uid && uid !== user.id ? <AudioOut key={`${uid}-${eng.gen}`} stream={s.speakers[i].audio} /> : null))}
        </main>

        <SidePanel open={panel === "people"} title="People" onClose={() => setPanel(null)}>
          <PeoplePanel people={listPeople} meId={user.id} isHost={isHost} waiting={waiting} onAdmit={admit} menuFor={(p) => [{ label: pinned === p.id ? "Unpin" : "Pin to the screen", icon: Pin, onClick: () => setPinned(pinned === p.id ? null : p.id) }, ...hostMenu(inClass.find((x) => x.id === p.id))]} onMuteAll={muteAll} onLowerAll={lowerAll} />
        </SidePanel>
        <SidePanel open={panel === "chat"} title="In-class messages" onClose={() => setPanel(null)}>
          <ChatPanel ctx={ctx} mid={mid} me={me ? { uid: me.uid || user.id, name: me.name, role: me.role } : null} list={chat} chatOn={room?.chatOn !== false} isHost={isHost} />
        </SidePanel>
        <SidePanel open={panel === "info"} title="Class details" onClose={() => setPanel(null)}>
          <InfoPanel meeting={data.meeting} recording={recordingOn} startedAt={room?.startedAt} />
        </SidePanel>
        {isHost && (
          <SidePanel open={panel === "host"} title="Host controls" onClose={() => setPanel(null)}>
            <HostControlsPanel room={room} onSet={(f) => act(() => eng.setRoom(f))} onMuteAll={muteAll} onLowerAll={lowerAll} />
          </SidePanel>
        )}
      </div>

      {/* Bottom bar */}
      <footer className="relative flex h-[72px] shrink-0 items-center gap-2 px-3 sm:h-20 sm:px-4">
        <div className="hidden min-w-0 flex-1 md:block">{clockBar}</div>
        <div className="relative flex flex-1 items-center justify-center gap-2 sm:gap-3 md:flex-none">
          <CtrlButton icon={eng.micOn && canSpeak ? Mic : MicOff} tone={eng.micOn && canSpeak ? "default" : "off"} label={!canSpeak ? "Raise your hand to speak" : eng.micOn ? "Turn off microphone (Ctrl+D)" : "Turn on microphone (Ctrl+D)"} onClick={toggleMic} disabled={!canSpeak && isHost} />
          <CtrlButton icon={camOn ? Video : VideoOff} tone={camOn ? "default" : "off"} label={camOn ? "Turn off camera (Ctrl+E)" : isHost ? "Turn on camera (Ctrl+E)" : "Turn on camera – only the teacher sees it"} onClick={toggleCam} />
          {!isHost && user.role === "student" && <CtrlButton icon={Hand} tone={me?.hand ? "on" : "default"} label={me?.hand ? "Lower hand" : "Raise hand"} onClick={() => act(() => eng.raiseHand(!me?.hand))} />}
          <div className="relative">
            <CtrlButton icon={Smile} tone={picker ? "on" : "default"} label="Send a reaction" onClick={() => setPicker((v) => !v)} />
            <ReactionPicker open={picker} onPick={react} onClose={() => setPicker(false)} />
          </div>
          {isHost && canShareScreen() && <CtrlButton icon={MonitorUp} tone={eng.screen ? "on" : "default"} label={eng.screen ? "Stop presenting" : "Present your screen"} onClick={toggleScreen} className="hidden sm:inline-flex" />}
          {isHost && !mobile && <CtrlButton icon={PenLine} tone={room?.board ? "on" : "default"} label={room?.board ? "Close the whiteboard" : "Open the whiteboard"} onClick={toggleBoard} />}
          {isHost && canRecord() && (
            <CtrlButton icon={Circle} tone={recState.on ? "rec" : "default"} label={recState.on ? "Stop recording" : "Record the class"} disabled={recState.busy} onClick={() => (recState.on ? ui.confirm({ title: "Stop recording?", message: "The recording is saved for admins to watch.", confirmLabel: "Stop recording", onConfirm: () => stopRecording() }) : startRecording())} className={recState.on ? "[&>svg]:fill-white" : ""} />
          )}
          <Menu
            align="right"
            trigger={
              <span>
                <CtrlButton icon={MoreVertical} label="More options" />
              </span>
            }
            items={moreItems}
          />
          {isHost ? (
            <Menu
              align="right"
              trigger={
                <button type="button" aria-label="Leave or end the class" title="Leave or end the class" className="inline-flex h-10 items-center justify-center rounded-full bg-[#ea4335] px-4 text-white transition hover:bg-[#d33b2c] sm:h-12 sm:px-6">
                  <PhoneOff className="h-5 w-5" />
                </button>
              }
              items={[
                { label: "Leave the class", icon: PhoneOff, onClick: leave },
                { label: "End the class for everyone", icon: X, danger: true, onClick: end },
              ]}
            />
          ) : (
            <button type="button" onClick={leave} aria-label="Leave the class" title="Leave the class" className="inline-flex h-10 items-center justify-center rounded-full bg-[#ea4335] px-4 text-white transition hover:bg-[#d33b2c] sm:h-12 sm:px-6">
              <PhoneOff className="h-5 w-5" />
            </button>
          )}
        </div>
        <div className="hidden flex-1 items-center justify-end gap-1 sm:flex">
          <SideIcon icon={Info} label="Class details" active={panel === "info"} onClick={() => togglePanel("info")} />
          <SideIcon icon={Users} label="People" active={panel === "people"} badge={(isHost ? waiting.length : 0) + (isHost ? handCount : 0) || inClass.length} onClick={() => togglePanel("people")} />
          <SideIcon icon={MessageSquare} label="Chat with everyone" active={panel === "chat"} badge={unread || null} onClick={() => togglePanel("chat")} />
          {isHost && <SideIcon icon={ShieldCheck} label="Host controls" active={panel === "host"} onClick={() => togglePanel("host")} />}
        </div>
      </footer>

      <LayoutDialog open={dialog === "layout"} onClose={() => setDialog(null)} pref={pref} setPref={setPref} />
      <SettingsDialog open={dialog === "settings"} onClose={() => setDialog(null)} micTrack={eng.mic} camTrack={eng.cam} onSwitch={(k, v) => act(() => eng.switchDevice(k, v))} />
    </div>
  );
}

function ClockTitle({ title }) {
  const now = useClock();
  return (
    <p className="truncate text-base text-white">
      {now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
      <span className="mx-3 text-white/40">|</span>
      <span>{title}</span>
    </p>
  );
}

function ErrorBanner({ error }) {
  if (!error) return null;
  const denied = /permission/i.test(error.message || "");
  return <p className="rounded-xl bg-[#3c4043] px-4 py-2.5 text-sm text-[#f28b82]">{denied ? "Lost access to the class. Leave and join again." : "Connection problem with the class service. If it keeps happening, leave and join again."}</p>;
}

