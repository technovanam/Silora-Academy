// ============================================================
// LIVE ROOM UI (LiveKit) – our own interface: adaptive video
// grid, screen-share spotlight, chat, participants with host
// controls, raise hand, reactions, shared whiteboard.
// Classes are recorded automatically on the server; only
// admins see the recording indicator and controls.
// ============================================================
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DisconnectReason, RoomEvent, Track, ConnectionQuality, VideoPresets } from "livekit-client";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  VideoTrack,
  isTrackReference,
  useChat,
  useConnectionQualityIndicator,
  useConnectionState,
  useDataChannel,
  useIsMuted,
  useIsSpeaking,
  useLocalParticipant,
  useMediaDeviceSelect,
  useParticipantAttributes,
  useParticipants,
  useRoomContext,
  useStartAudio,
  useTrackToggle,
  useTracks,
} from "@livekit/components-react";
import {
  ArrowLeft,
  Check,
  ChevronUp,
  Copy,
  DoorOpen,
  Link2,
  Circle,
  Hand,
  Loader2,
  LogOut,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  MoreVertical,
  Pin,
  PinOff,
  Presentation,
  PhoneOff,
  Send,
  Smile,
  Square,
  UserCheck,
  UserMinus,
  Users,
  Video,
  VideoOff,
  Volume2,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import { fmtTime } from "../lib/format.js";
import { Button, cx } from "../ui/index.jsx";
import { Whiteboard, isWhiteboardTrack, useWhiteboard } from "./whiteboard.jsx";

const ROOM_OPTIONS = {
  adaptiveStream: true,
  dynacast: true,
  videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
  publishDefaults: { simulcast: true, videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360] },
  audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
};
const REACTIONS = ["👍", "👏", "😂", "❤️", "🎉", "🤔"];
const enc = new TextEncoder();
const dec = new TextDecoder();

export function RoomShell({ children }) {
  return <div className="flex h-svh flex-col overflow-hidden bg-[radial-gradient(ellipse_at_top,#12304d_0%,#0b1724_55%,#08111b_100%)]">{children}</div>;
}

export function Centered({ icon: Icon, title, text, children }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6">
      <div className="max-w-md text-center">
        <span className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10 text-brand ring-1 ring-white/10">
          <Icon className="h-8 w-8" />
        </span>
        <h1 className="text-xl font-bold text-white">{title}</h1>
        {text && <p className="mt-2 text-sm text-white/65">{text}</p>}
        {children}
      </div>
    </div>
  );
}

// ---- Room wrapper ---------------------------------------------------------------------
export default function LiveRoom({ info, choices, meetingId, back, onLeave }) {
  const [connectError, setConnectError] = useState(null);
  const audio = choices?.audio ? (choices.audioDeviceId ? { deviceId: choices.audioDeviceId } : true) : false;
  const video = choices?.video ? (choices.videoDeviceId ? { deviceId: choices.videoDeviceId } : true) : false;
  return (
    <LiveKitRoom
      serverUrl={info.url}
      token={info.token}
      connect
      audio={audio}
      video={video}
      options={ROOM_OPTIONS}
      onError={(e) => setConnectError(e)}
      onDisconnected={(reason) => {
        if (reason === DisconnectReason.ROOM_DELETED) onLeave("ended");
        else if (reason === DisconnectReason.PARTICIPANT_REMOVED) onLeave("removed");
        else if (reason === DisconnectReason.CLIENT_INITIATED) onLeave("left");
        else onLeave("error");
      }}
      className="contents"
    >
      <RoomShell>
        <RoomBody info={info} meetingId={meetingId} back={back} connectError={connectError} />
        <RoomAudioRenderer />
      </RoomShell>
    </LiveKitRoom>
  );
}

function RoomBody({ info, meetingId, back, connectError }) {
  const room = useRoomContext();
  const state = useConnectionState();
  const [panel, setPanel] = useState(null); // chat | people | null
  const [pinned, setPinned] = useState(null); // track key
  const [toasts, setToasts] = useState([]);
  const [floating, setFloating] = useState([]);
  const [unread, setUnread] = useState(0);
  const panelRef = useRef(panel);
  panelRef.current = panel;

  const toast = useCallback((text, icon) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t.slice(-3), { id, text, icon }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  // Host-relevant events
  useEffect(() => {
    const onJoin = (p) => info.isHost && toast(`${p.name || "Someone"} joined`, Users);
    const onLeft = (p) => info.isHost && toast(`${p.name || "Someone"} left`, LogOut);
    const onAttr = (changed, p) => {
      if (changed.hand && p !== room.localParticipant) toast(`${p.name} raised their hand`, Hand);
    };
    room.on(RoomEvent.ParticipantConnected, onJoin).on(RoomEvent.ParticipantDisconnected, onLeft).on(RoomEvent.ParticipantAttributesChanged, onAttr);
    return () => {
      room.off(RoomEvent.ParticipantConnected, onJoin).off(RoomEvent.ParticipantDisconnected, onLeft).off(RoomEvent.ParticipantAttributesChanged, onAttr);
    };
  }, [room, info.isHost, toast]);

  // Reactions (lossy data messages)
  const addFloat = useCallback((emoji, name) => {
    const id = Math.random().toString(36).slice(2);
    setFloating((f) => [...f.slice(-14), { id, emoji, name, left: 8 + Math.random() * 30 }]);
    setTimeout(() => setFloating((f) => f.filter((x) => x.id !== id)), 3200);
  }, []);
  const { send: sendData } = useDataChannel("reaction", (msg) => addFloat(dec.decode(msg.payload), msg.from?.name));
  const react = (emoji) => {
    addFloat(emoji, "You");
    sendData(enc.encode(emoji), { reliable: false }).catch(() => {});
  };

  // Chat with unread badge
  const chat = useChat();
  const seen = useRef(0);
  useEffect(() => {
    const n = chat.chatMessages.length;
    if (n > seen.current) {
      const fresh = chat.chatMessages.slice(seen.current).filter((m) => m.from?.identity !== room.localParticipant.identity);
      if (panelRef.current !== "chat" && fresh.length) {
        setUnread((u) => u + fresh.length);
        const last = fresh[fresh.length - 1];
        toast(`${last.from?.name || "Someone"}: ${last.message.slice(0, 80)}`, MessageSquare);
      }
      seen.current = n;
    }
  }, [chat.chatMessages, room, toast]);
  useEffect(() => {
    if (panel === "chat") setUnread(0);
  }, [panel]);

  const moderate = useCallback(
    async (body) => {
      try {
        await api.post(`/meetings/${meetingId}/moderate`, body);
        return true;
      } catch (e) {
        toast(e.message, X);
        return false;
      }
    },
    [meetingId, toast]
  );

  const wb = useWhiteboard({ isHost: info.isHost });
  const lobby = useLobby({ meetingId, enabled: info.isHost, toast });

  const connecting = state === "connecting" || state === "reconnecting";

  if (connectError && state === "disconnected") {
    return (
      <div className="relative flex-1">
        <Centered icon={VideoOff} title="Couldn't connect to the class" text="The video server didn't respond. Check your internet connection and try again. If it keeps happening, the class server may be offline.">
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button variant="outline" onClick={() => window.location.reload()}>
              Try again
            </Button>
            <Link to={back}>
              <Button>Back to portal</Button>
            </Link>
          </div>
        </Centered>
      </div>
    );
  }

  return (
    <>
      <TopBar info={info} back={back} lobby={lobby} toast={toast} />
      <div className="relative flex min-h-0 flex-1 gap-3 px-2 pb-2 sm:px-4">
        <div className="relative min-w-0 flex-1">
          <Stage pinned={pinned} setPinned={setPinned} board={wb.open ? <Whiteboard wb={wb} /> : null} />
          {connecting && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-3xl bg-black/40 backdrop-blur-sm">
              <div className="flex items-center gap-3 rounded-full bg-[#13283d] px-5 py-3 text-sm text-white ring-1 ring-white/10">
                <Loader2 className="h-4 w-4 animate-spin text-brand" /> {state === "reconnecting" ? "Reconnecting…" : "Joining class…"}
              </div>
            </div>
          )}
          <FloatingReactions items={floating} />
          <Toasts items={toasts} />
          {info.isHost && panel !== "people" && <LobbyPrompt lobby={lobby} onViewAll={() => setPanel("people")} />}
          <StartAudioPrompt />
        </div>
        {panel && (
          <aside className="absolute inset-0 z-30 flex flex-col overflow-hidden rounded-3xl bg-[#0f2236]/95 ring-1 ring-white/10 backdrop-blur-xl sm:relative sm:inset-auto sm:w-[22rem] sm:shrink-0 sm:bg-[#0f2236]">
            <div className="flex items-center gap-1 border-b border-white/10 p-2">
              <PanelTab active={panel === "chat"} onClick={() => setPanel("chat")} icon={MessageSquare} label="Chat" />
              <PanelTab active={panel === "people"} onClick={() => setPanel("people")} icon={Users} label="People" badge={lobby.waiting.length} />
              <button type="button" onClick={() => setPanel(null)} aria-label="Close panel" className="ml-auto flex h-9 w-9 items-center justify-center rounded-full text-white/60 hover:bg-white/10 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            {panel === "chat" ? <ChatPanel chat={chat} /> : <PeoplePanel isHost={info.isHost} moderate={moderate} lobby={lobby} />}
          </aside>
        )}
      </div>
      <ControlBar info={info} meetingId={meetingId} panel={panel} setPanel={setPanel} unread={unread} onReact={react} moderate={moderate} toast={toast} wb={wb} waiting={lobby.waiting.length} />
    </>
  );
}

function PanelTab({ active, onClick, icon: Icon, label, badge }) {
  return (
    <button type="button" onClick={onClick} className={cx("inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm font-semibold transition", active ? "bg-white/10 text-white" : "text-white/55 hover:text-white")}>
      <Icon className="h-4 w-4" /> {label}
      {badge > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-navy">{badge}</span>}
    </button>
  );
}

// ---- Top bar ---------------------------------------------------------------------------
function useElapsed(since) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// LiveKit reports when a server recording (egress) is running. Only admins are shown it.
function useRecording() {
  const room = useRoomContext();
  const [on, setOn] = useState(room.isRecording);
  useEffect(() => {
    const h = (v) => setOn(!!v);
    setOn(room.isRecording);
    room.on(RoomEvent.RecordingStatusChanged, h);
    return () => {
      room.off(RoomEvent.RecordingStatusChanged, h);
    };
  }, [room]);
  return on;
}

function TopBar({ info, back, lobby, toast }) {
  const [share, setShare] = useState(false);
  const m = info.meeting;
  const [joinedAt] = useState(Date.now());
  const elapsed = useElapsed(joinedAt);
  const recording = useRecording();
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const { quality } = useConnectionQualityIndicator({ participant: localParticipant });
  return (
    <header className="flex items-center gap-2 px-3 py-2.5 text-white sm:gap-3 sm:px-5">
      <Link to={back} aria-label="Back to portal" className="flex h-9 w-9 items-center justify-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white">
        <ArrowLeft className="h-4 w-4" />
      </Link>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{m.title}</p>
        <p className="truncate text-xs text-white/50">
          {fmtTime(m.startAt)} – {fmtTime(m.endAt)}
          {m.subject ? ` · ${m.subject}` : ""}
        </p>
      </div>
      {info.isAdmin && recording && (
        <span title="Visible to admins only" className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/15 px-2.5 py-1 text-xs font-semibold text-rose-300 ring-1 ring-rose-400/20">
          <span className="h-2 w-2 animate-pulse rounded-full bg-rose-400" /> REC
        </span>
      )}
      {info.isHost && info.joinUrl && (
        <div className="relative">
          <button type="button" onClick={() => setShare((v) => !v)} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white/10 px-3 text-xs font-semibold text-white transition hover:bg-white/20" aria-expanded={share}>
            <Link2 className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Class link</span>
          </button>
          {share && (
            <Popover onClose={() => setShare(false)} className="right-0 top-full mt-2 w-[min(22rem,calc(100vw-1.5rem))]">
              <SharePanel info={info} lobby={lobby} toast={toast} />
            </Popover>
          )}
        </div>
      )}
      <span className="hidden items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 text-xs font-medium text-white/70 ring-1 ring-white/10 sm:inline-flex">
        <Users className="h-3.5 w-3.5" /> {participants.length}
      </span>
      <span className="inline-flex items-center gap-2 rounded-full bg-white/5 px-2.5 py-1 font-mono text-xs text-white/80 ring-1 ring-white/10">
        <SignalBars quality={quality} /> {elapsed}
      </span>
    </header>
  );
}

function SignalBars({ quality, className }) {
  const n = quality === ConnectionQuality.Excellent ? 3 : quality === ConnectionQuality.Good ? 2 : quality === ConnectionQuality.Poor ? 1 : 0;
  const color = n === 3 ? "bg-emerald-400" : n === 2 ? "bg-amber-300" : "bg-rose-400";
  const label = n === 3 ? "Excellent connection" : n === 2 ? "Good connection" : n === 1 ? "Poor connection" : "Connection lost";
  return (
    <span className={cx("inline-flex h-3 items-end gap-[2px]", className)} title={label} aria-label={label}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={cx("w-[3px] rounded-sm", i <= n ? color : "bg-white/25")} style={{ height: `${i * 33}%` }} />
      ))}
    </span>
  );
}

// ---- Stage: grid or spotlight ------------------------------------------------------------
const trackKey = (t) => `${t.participant.identity}:${t.source}`;

function Stage({ pinned, setPinned, board }) {
  const all = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  );
  // The whiteboard's video copy exists only for the recording – everyone draws the board locally
  const tracks = useMemo(() => all.filter((t) => !isWhiteboardTrack(t)), [all]);
  const screen = tracks.find((t) => t.source === Track.Source.ScreenShare && isTrackReference(t));
  const focusKey = pinned && tracks.some((t) => trackKey(t) === pinned) ? pinned : screen ? trackKey(screen) : null;
  const focus = focusKey ? tracks.find((t) => trackKey(t) === focusKey) : null;

  // Hosts first, then by join time
  const ordered = useMemo(
    () =>
      [...tracks].sort((a, b) => {
        const ah = a.participant.attributes?.host === "true" ? 0 : 1;
        const bh = b.participant.attributes?.host === "true" ? 0 : 1;
        return ah - bh || (a.participant.joinedAt?.getTime() || 0) - (b.participant.joinedAt?.getTime() || 0);
      }),
    [tracks]
  );

  if (board) {
    return (
      <div className="flex h-full flex-col gap-2 lg:flex-row lg:gap-3">
        <div className="min-h-0 flex-1">{board}</div>
        <div className="scrollbar-thin flex h-24 shrink-0 gap-2 overflow-x-auto sm:h-28 lg:h-auto lg:w-48 lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden xl:w-56">
          {ordered.map((t) => (
            <div key={trackKey(t)} className="aspect-video h-full shrink-0 lg:h-auto lg:w-full">
              <Tile trackRef={t} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (focus) {
    const rest = ordered.filter((t) => trackKey(t) !== focusKey);
    return (
      <div className="flex h-full flex-col gap-2 lg:flex-row lg:gap-3">
        <div className="min-h-0 flex-1">
          <Tile trackRef={focus} big pinned={pinned === focusKey} onPin={() => setPinned(pinned === focusKey ? null : focusKey)} />
        </div>
        {rest.length > 0 && (
          <div className="scrollbar-thin flex h-28 shrink-0 gap-2 overflow-x-auto sm:h-32 lg:h-auto lg:w-56 lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden xl:w-64">
            {rest.map((t) => (
              <div key={trackKey(t)} className="aspect-video h-full shrink-0 lg:h-auto lg:w-full">
                <Tile trackRef={t} onPin={() => setPinned(trackKey(t))} />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const n = ordered.length;
  const cols = n <= 1 ? "grid-cols-1" : n === 2 ? "grid-cols-1 sm:grid-cols-2" : n <= 4 ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-3";
  const rows = n <= 1 ? "grid-rows-1" : n === 2 ? "grid-rows-2 sm:grid-rows-1" : n <= 4 ? "grid-rows-2" : "grid-rows-3 lg:grid-rows-2";
  return (
    <div className={cx("grid h-full gap-2 sm:gap-3", cols, rows)}>
      {ordered.map((t) => (
        <Tile key={trackKey(t)} trackRef={t} big={n === 1} onPin={n > 1 ? () => setPinned(trackKey(t)) : undefined} />
      ))}
    </div>
  );
}

function Tile({ trackRef, big, pinned, onPin }) {
  const p = trackRef.participant;
  const isScreen = trackRef.source === Track.Source.ScreenShare;
  const speaking = useIsSpeaking(p);
  const { attributes } = useParticipantAttributes({ participant: p });
  const micMuted = useIsMuted({ participant: p, source: Track.Source.Microphone, publication: p.getTrackPublication(Track.Source.Microphone) });
  const camMuted = useIsMuted(trackRef);
  const { quality } = useConnectionQualityIndicator({ participant: p });
  const hasVideo = isTrackReference(trackRef) && !camMuted;
  const hand = attributes?.hand;
  const host = attributes?.host === "true";
  const name = p.name || p.identity;
  const showSpeaking = speaking && !isScreen && !micMuted;

  return (
    <div
      className={cx(
        "group relative h-full w-full overflow-hidden rounded-2xl bg-[#13283d] ring-1 transition-shadow duration-200 sm:rounded-3xl",
        showSpeaking ? "ring-2 ring-brand shadow-[0_0_0_4px_rgba(232,177,18,0.15)]" : "ring-white/10"
      )}
    >
      {hasVideo ? (
        <VideoTrack trackRef={trackRef} className={cx("h-full w-full", isScreen ? "bg-black object-contain" : "object-cover", p.isLocal && !isScreen && "-scale-x-100")} />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#16314b] to-[#0e2135]">
          <span className={cx("flex items-center justify-center rounded-full font-bold text-white ring-4 transition", avatarColor(name), showSpeaking ? "ring-brand/60" : "ring-white/5", big ? "h-28 w-28 text-4xl" : "h-14 w-14 text-lg sm:h-20 sm:w-20 sm:text-2xl")}>{initialsOf(name)}</span>
        </div>
      )}

      {hand && (
        <span className="absolute left-2.5 top-2.5 inline-flex items-center gap-1.5 rounded-full bg-brand px-2.5 py-1 text-xs font-bold text-navy shadow-lg sm:left-3 sm:top-3">
          <Hand className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Hand raised</span>
        </span>
      )}

      {onPin && (
        <button type="button" onClick={onPin} aria-label={pinned ? "Unpin" : "Pin to main view"} title={pinned ? "Unpin" : "Pin to main view"} className="absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white opacity-0 backdrop-blur transition hover:bg-black/70 focus-visible:opacity-100 group-hover:opacity-100 sm:right-3 sm:top-3">
          {pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
        </button>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/70 via-black/30 to-transparent px-2.5 pb-2 pt-8 sm:px-3 sm:pb-2.5">
        {!isScreen && (micMuted ? <MicOff className="h-3.5 w-3.5 shrink-0 text-rose-400" /> : <SpeakingIcon active={showSpeaking} />)}
        {isScreen && <MonitorUp className="h-3.5 w-3.5 shrink-0 text-sky-300" />}
        <span className="min-w-0 truncate text-xs font-semibold text-white sm:text-sm">
          {isScreen ? `${name.replace(/\s*\(.*\)$/, "")}'s screen` : name}
          {p.isLocal && !isScreen ? " (You)" : ""}
        </span>
        {host && !isScreen && <span className="hidden shrink-0 rounded-full bg-brand/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand sm:inline">Host</span>}
        <SignalBars quality={quality} className="ml-auto shrink-0" />
      </div>
    </div>
  );
}

function SpeakingIcon({ active }) {
  return (
    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center gap-[2px]">
      {[0, 1, 2].map((i) => (
        <span key={i} className={cx("w-[3px] rounded-full", active ? "animate-[lkbar_0.9s_ease-in-out_infinite] bg-brand" : "h-1 bg-white/60")} style={active ? { animationDelay: `${i * 0.15}s`, height: "100%" } : undefined} />
      ))}
    </span>
  );
}

// ---- Controls -----------------------------------------------------------------------------
function ControlBar({ info, meetingId, panel, setPanel, unread, onReact, moderate, toast, wb, waiting = 0 }) {
  const room = useRoomContext();
  const mic = useTrackToggle({ source: Track.Source.Microphone, onDeviceError: () => toast("Couldn't use your microphone. Check browser permissions.", MicOff) });
  const cam = useTrackToggle({ source: Track.Source.Camera, onDeviceError: () => toast("Couldn't use your camera. Check browser permissions.", VideoOff) });
  const screen = useTrackToggle({ source: Track.Source.ScreenShare, captureOptions: { audio: true, resolution: VideoPresets.h1080.resolution }, onDeviceError: (e) => e?.name !== "NotAllowedError" && toast("Screen sharing isn't available here.", MonitorUp) });
  const { localParticipant } = useLocalParticipant();
  const { attributes } = useParticipantAttributes({ participant: localParticipant });
  const hand = !!attributes?.hand;
  const recording = useRecording();
  const [recBusy, setRecBusy] = useState(false);
  const [showReact, setShowReact] = useState(false);
  const [showLeave, setShowLeave] = useState(false);
  const canShare = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;

  // The whiteboard's recording feed is published as a screen share – don't count it as one
  const sharing = screen.enabled && !localParticipant.getTrackPublications().some((p) => p.trackName === "whiteboard" && p.source === Track.Source.ScreenShare);
  const toggleShare = async () => {
    if (sharing) return screen.toggle(false);
    if (wb.open && wb.owner === localParticipant.identity) await wb.closeBoard();
    screen.toggle(true);
  };

  const toggleHand = () => localParticipant.setAttributes({ hand: hand ? "" : String(Date.now()) }).catch(() => {});

  // Keyboard shortcuts: Ctrl/⌘+D mic, Ctrl/⌘+E camera
  useEffect(() => {
    const h = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "d") {
        e.preventDefault();
        mic.toggle();
      } else if (k === "e") {
        e.preventDefault();
        cam.toggle();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [mic, cam]);

  const toggleRecording = async () => {
    setRecBusy(true);
    try {
      await api.post(`/meetings/${meetingId}/recording`, { action: recording ? "stop" : "start" });
      toast(recording ? "Recording stopped – it will appear in Recordings shortly" : "Recording started", Circle);
    } catch (e) {
      toast(e.message, X);
    } finally {
      setRecBusy(false);
    }
  };

  return (
    <footer className="relative flex items-center justify-between gap-2 px-2 pb-3 pt-1 sm:px-5 sm:pb-4">
      <div className="hidden w-48 text-xs text-white/40 md:block">
        <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-sans">Ctrl+D</kbd> mic · <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-sans">Ctrl+E</kbd> camera
      </div>

      <div className="mx-auto flex items-center gap-1.5 rounded-full bg-[#0f2236]/90 p-1.5 shadow-2xl shadow-black/40 ring-1 ring-white/10 backdrop-blur sm:gap-2 sm:p-2">
        <SplitControl on={mic.enabled} pending={mic.pending} onClick={() => mic.toggle()} onIcon={Mic} offIcon={MicOff} label={mic.enabled ? "Mute" : "Unmute"} kind="audioinput" />
        <SplitControl on={cam.enabled} pending={cam.pending} onClick={() => cam.toggle()} onIcon={Video} offIcon={VideoOff} label={cam.enabled ? "Stop video" : "Start video"} kind="videoinput" />
        {canShare && <Ctrl active={sharing} onClick={toggleShare} icon={MonitorUp} label={sharing ? "Stop sharing" : "Share screen"} className="hidden sm:flex" />}
        {info.isHost && <Ctrl active={wb.open} onClick={() => (wb.open ? wb.closeBoard() : wb.openBoard())} icon={Presentation} label={wb.open ? "Close whiteboard" : "Whiteboard"} activeClass="bg-brand text-navy hover:bg-brand-hover" />}
        <Ctrl active={hand} onClick={toggleHand} icon={Hand} label={hand ? "Lower hand" : "Raise hand"} activeClass="bg-brand text-navy hover:bg-brand-hover" />
        <div className="relative">
          <Ctrl active={showReact} onClick={() => setShowReact((v) => !v)} icon={Smile} label="Reactions" />
          {showReact && (
            <Popover onClose={() => setShowReact(false)} className="bottom-full left-1/2 mb-3 -translate-x-1/2">
              <div className="flex gap-1 p-1.5">
                {REACTIONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => {
                      onReact(r);
                      setShowReact(false);
                    }}
                    className="flex h-11 w-11 items-center justify-center rounded-xl text-2xl transition hover:scale-110 hover:bg-white/10"
                  >
                    {r}
                  </button>
                ))}
              </div>
            </Popover>
          )}
        </div>
        {info.canRecord && <Ctrl active={recording} onClick={toggleRecording} icon={recBusy ? Loader2 : recording ? Square : Circle} label={recording ? "Stop recording" : "Record"} activeClass="bg-rose-500/20 text-rose-300 hover:bg-rose-500/30" className={cx("hidden sm:flex", recBusy && "[&_svg]:animate-spin")} />}
        <span className="mx-0.5 hidden h-6 w-px bg-white/10 sm:block" />
        <Ctrl active={panel === "chat"} onClick={() => setPanel(panel === "chat" ? null : "chat")} icon={MessageSquare} label="Chat" badge={unread} />
        <Ctrl active={panel === "people"} onClick={() => setPanel(panel === "people" ? null : "people")} icon={Users} label={waiting ? `People (${waiting} waiting)` : "People"} badge={waiting} className={waiting ? "flex" : "hidden sm:flex"} />
        <div className="relative">
          <button
            type="button"
            onClick={() => (info.isHost ? setShowLeave((v) => !v) : room.disconnect())}
            aria-label="Leave class"
            title="Leave class"
            className="flex h-11 items-center gap-2 rounded-full bg-rose-500 px-4 text-sm font-semibold text-white transition hover:bg-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 sm:h-12 sm:px-5"
          >
            <PhoneOff className="h-5 w-5" /> <span className="hidden sm:inline">Leave</span>
          </button>
          {showLeave && (
            <Popover onClose={() => setShowLeave(false)} className="bottom-full right-0 mb-3 w-64">
              <div className="p-1.5">
                <MenuItem icon={LogOut} onClick={() => room.disconnect()} title="Leave class" text="Others can stay in the room" />
                <MenuItem
                  icon={PhoneOff}
                  danger
                  onClick={async () => {
                    setShowLeave(false);
                    if (await moderate({ action: "end" })) room.disconnect();
                  }}
                  title="End class for everyone"
                  text="Closes the room for all participants"
                />
              </div>
            </Popover>
          )}
        </div>
      </div>

      <div className="hidden w-48 md:block" />
    </footer>
  );
}

function Ctrl({ active, onClick, icon: Icon, label, badge, className, activeClass = "bg-white text-navy hover:bg-white/90" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={!!active}
      className={cx(
        "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand sm:h-12 sm:w-12",
        active ? activeClass : "bg-white/10 text-white hover:bg-white/20",
        className
      )}
    >
      <Icon className="h-5 w-5" />
      {badge > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-navy ring-2 ring-[#0f2236]">{badge > 9 ? "9+" : badge}</span>}
    </button>
  );
}

// Mic / camera button with a device menu
function SplitControl({ on, pending, onClick, onIcon: On, offIcon: Off, label, kind }) {
  const [open, setOpen] = useState(false);
  const Icon = on ? On : Off;
  return (
    <div className={cx("relative flex shrink-0 items-center rounded-full transition", on ? "bg-white/10" : "bg-rose-500/90")}>
      <button type="button" onClick={onClick} disabled={pending} aria-label={label} title={label} className="flex h-11 w-11 items-center justify-center rounded-full text-white transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60 sm:h-12 sm:w-12">
        {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Icon className="h-5 w-5" />}
      </button>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-label="Choose device" title="Choose device" className="-ml-1.5 mr-1 hidden h-8 w-6 items-center justify-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white sm:flex">
        <ChevronUp className="h-3.5 w-3.5" />
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)} className="bottom-full left-0 mb-3 w-72">
          <DeviceList kind={kind} onPicked={() => setOpen(false)} />
          {kind === "audioinput" && (
            <>
              <div className="mx-3 my-1 h-px bg-white/10" />
              <DeviceList kind="audiooutput" onPicked={() => setOpen(false)} />
            </>
          )}
        </Popover>
      )}
    </div>
  );
}

function DeviceList({ kind, onPicked }) {
  const room = useRoomContext();
  const { devices, activeDeviceId, setActiveMediaDevice } = useMediaDeviceSelect({ kind, room });
  const title = kind === "audioinput" ? "Microphone" : kind === "videoinput" ? "Camera" : "Speaker";
  if (kind === "audiooutput" && !devices.length) return null;
  return (
    <div className="p-1.5">
      <p className="flex items-center gap-2 px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/40">
        {kind === "audiooutput" && <Volume2 className="h-3 w-3" />}
        {title}
      </p>
      {devices.length === 0 && <p className="px-2.5 py-2 text-sm text-white/50">No devices found</p>}
      {devices.map((d) => (
        <button
          key={d.deviceId}
          type="button"
          onClick={() => {
            setActiveMediaDevice(d.deviceId);
            onPicked();
          }}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-white/85 transition hover:bg-white/10"
        >
          <span className="min-w-0 flex-1 truncate">{d.label || "Unnamed device"}</span>
          {(d.deviceId === activeDeviceId || (activeDeviceId === "default" && d.deviceId === "default")) && <Check className="h-4 w-4 shrink-0 text-brand" />}
        </button>
      ))}
    </div>
  );
}

function Popover({ onClose, className, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => !ref.current?.contains(e.target) && onClose();
    const k = (e) => e.key === "Escape" && onClose();
    const t = setTimeout(() => document.addEventListener("pointerdown", h));
    document.addEventListener("keydown", k);
    return () => {
      clearTimeout(t);
      document.removeEventListener("pointerdown", h);
      document.removeEventListener("keydown", k);
    };
  }, [onClose]);
  return (
    <div ref={ref} className={cx("absolute z-40 overflow-hidden rounded-2xl bg-[#13283d] shadow-2xl shadow-black/50 ring-1 ring-white/10", className)}>
      {children}
    </div>
  );
}

function MenuItem({ icon: Icon, title, text, onClick, danger }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-white/10">
      <Icon className={cx("mt-0.5 h-4 w-4 shrink-0", danger ? "text-rose-400" : "text-white/60")} />
      <span>
        <span className={cx("block text-sm font-semibold", danger ? "text-rose-300" : "text-white")}>{title}</span>
        {text && <span className="block text-xs text-white/50">{text}</span>}
      </span>
    </button>
  );
}

// ---- Chat --------------------------------------------------------------------------------
function ChatPanel({ chat }) {
  const { chatMessages, send, isSending } = chat;
  const [text, setText] = useState("");
  const list = useRef(null);
  const { localParticipant } = useLocalParticipant();
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [chatMessages.length]);
  const submit = async (e) => {
    e.preventDefault();
    const msg = text.trim();
    if (!msg) return;
    setText("");
    await send(msg).catch(() => setText(msg));
  };
  return (
    <>
      <div ref={list} className="scrollbar-thin min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-4">
        {chatMessages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center text-white/45">
            <MessageSquare className="mb-3 h-8 w-8 text-white/20" />
            <p className="text-sm">No messages yet.</p>
            <p className="mt-1 text-xs">Messages are visible to everyone in the class and aren't saved after it ends.</p>
          </div>
        )}
        {chatMessages.map((m, i) => {
          const mine = m.from?.identity === localParticipant.identity;
          const prev = chatMessages[i - 1];
          const grouped = prev && prev.from?.identity === m.from?.identity && m.timestamp - prev.timestamp < 60000;
          return (
            <div key={m.id || i} className={cx("flex flex-col", mine ? "items-end" : "items-start", grouped && "-mt-2")}>
              {!grouped && (
                <p className="mb-1 px-1 text-[11px] text-white/45">
                  <span className="font-semibold text-white/70">{mine ? "You" : m.from?.name || "Someone"}</span> · {new Date(m.timestamp).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
                </p>
              )}
              <p className={cx("max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm", mine ? "rounded-br-md bg-brand text-navy" : "rounded-bl-md bg-white/10 text-white")}>{m.message}</p>
            </div>
          );
        })}
      </div>
      <form onSubmit={submit} className="flex items-end gap-2 border-t border-white/10 p-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) submit(e);
          }}
          rows={1}
          maxLength={1000}
          placeholder="Message everyone…"
          className="scrollbar-thin max-h-28 min-h-11 flex-1 resize-none rounded-2xl bg-white/5 px-4 py-2.5 text-sm text-white ring-1 ring-white/10 placeholder:text-white/35 focus:outline-none focus:ring-brand"
        />
        <button type="submit" disabled={!text.trim() || isSending} aria-label="Send" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-navy transition hover:bg-brand-hover disabled:opacity-40">
          <Send className="h-4 w-4" />
        </button>
      </form>
    </>
  );
}

// ---- People ------------------------------------------------------------------------------
function PeoplePanel({ isHost, moderate, lobby }) {
  const participants = useParticipants();
  const sorted = [...participants].sort((a, b) => {
    const ha = a.attributes?.hand ? Number(a.attributes.hand) : Infinity;
    const hb = b.attributes?.hand ? Number(b.attributes.hand) : Infinity;
    const hostA = a.attributes?.host === "true" ? 0 : 1;
    const hostB = b.attributes?.host === "true" ? 0 : 1;
    return ha - hb || hostA - hostB || (a.name || "").localeCompare(b.name || "");
  });
  const hands = participants.filter((p) => p.attributes?.hand).length;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <p className="text-sm text-white/60">
          {participants.length} in class{hands ? ` · ${hands} hand${hands > 1 ? "s" : ""} raised` : ""}
        </p>
        {isHost && participants.length > 1 && (
          <button type="button" onClick={() => moderate({ action: "muteAll" })} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white/10 px-3 text-xs font-semibold text-white transition hover:bg-white/20">
            <MicOff className="h-3.5 w-3.5" /> Mute all
          </button>
        )}
      </div>
      <ul className="scrollbar-thin min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
        {isHost && lobby?.waiting.length > 0 && <WaitingList lobby={lobby} />}
        {sorted.map((p) => (
          <PersonRow key={p.identity} p={p} isHost={isHost} moderate={moderate} />
        ))}
      </ul>
    </div>
  );
}

function PersonRow({ p, isHost, moderate }) {
  const [menu, setMenu] = useState(false);
  const { attributes } = useParticipantAttributes({ participant: p });
  const micPub = p.getTrackPublication(Track.Source.Microphone);
  const micMuted = useIsMuted({ participant: p, source: Track.Source.Microphone, publication: micPub });
  const camMuted = useIsMuted({ participant: p, source: Track.Source.Camera, publication: p.getTrackPublication(Track.Source.Camera) });
  const speaking = useIsSpeaking(p);
  const name = p.name || p.identity;
  const host = attributes?.host === "true";
  const canModerate = isHost && !p.isLocal && !host;
  return (
    <li className="relative flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-white/5">
      <span className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ring-2", avatarColor(name), speaking && !micMuted ? "ring-brand" : "ring-transparent")}>{initialsOf(name)}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white">
          {name}
          {p.isLocal ? " (You)" : ""}
        </p>
        <p className="text-xs text-white/45">{host ? "Host" : "Student"}</p>
      </div>
      {attributes?.hand && <Hand className="h-4 w-4 shrink-0 text-brand" aria-label="Hand raised" />}
      {camMuted ? <VideoOff className="h-4 w-4 shrink-0 text-white/35" /> : <Video className="h-4 w-4 shrink-0 text-white/60" />}
      {micMuted ? <MicOff className="h-4 w-4 shrink-0 text-rose-400" /> : <Mic className={cx("h-4 w-4 shrink-0", speaking ? "text-brand" : "text-white/60")} />}
      {canModerate && (
        <>
          <button type="button" onClick={() => setMenu((v) => !v)} aria-label={`Manage ${name}`} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/60 hover:bg-white/10 hover:text-white">
            <MoreVertical className="h-4 w-4" />
          </button>
          {menu && (
            <Popover onClose={() => setMenu(false)} className="right-2 top-full z-50 mt-1 w-56">
              <div className="p-1.5">
                {!micMuted && micPub && (
                  <MenuItem
                    icon={MicOff}
                    title="Mute microphone"
                    onClick={() => {
                      setMenu(false);
                      moderate({ action: "mute", identity: p.identity, trackSid: micPub.trackSid });
                    }}
                  />
                )}
                {attributes?.hand && (
                  <MenuItem
                    icon={Hand}
                    title="Lower hand"
                    onClick={() => {
                      setMenu(false);
                      moderate({ action: "lowerHand", identity: p.identity });
                    }}
                  />
                )}
                <MenuItem
                  icon={UserMinus}
                  danger
                  title="Remove from class"
                  onClick={() => {
                    setMenu(false);
                    moderate({ action: "remove", identity: p.identity });
                  }}
                />
              </div>
            </Popover>
          )}
        </>
      )}
    </li>
  );
}

// ---- Lobby (hosts): people asking to join ---------------------------------------------------
function useLobby({ meetingId, enabled, toast }) {
  const [waiting, setWaiting] = useState([]);
  const [autoAdmit, setAutoAdmit] = useState(false);
  const known = useRef(new Set());

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/meetings/${meetingId}/lobby`);
      setWaiting(r.waiting);
      setAutoAdmit(!!r.autoAdmit);
      const fresh = r.waiting.filter((w) => !known.current.has(w.userId));
      known.current = new Set(r.waiting.map((w) => w.userId));
      if (fresh.length) toast(fresh.length === 1 ? `${fresh[0].name} wants to join` : `${fresh.length} people want to join`, DoorOpen);
    } catch {
      /* try again on the next tick */
    }
  }, [meetingId, toast]);

  useEffect(() => {
    if (!enabled) return;
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [enabled, load]);

  const act = async (body) => {
    try {
      await api.post(`/meetings/${meetingId}/lobby`, body);
    } catch (e) {
      toast(e.message, X);
    }
    load();
  };
  return {
    waiting: enabled ? waiting : [],
    autoAdmit,
    admit: (userId) => (setWaiting((w) => w.filter((x) => x.userId !== userId)), act({ action: "admit", userId })),
    deny: (userId) => (setWaiting((w) => w.filter((x) => x.userId !== userId)), act({ action: "deny", userId })),
    admitAll: () => (setWaiting([]), act({ action: "admitAll" })),
    setAutoAdmit: (value) => (setAutoAdmit(value), act({ action: "autoAdmit", value })),
  };
}

// Google Meet–style card: "X wants to join this class"
function LobbyPrompt({ lobby, onViewAll }) {
  const first = lobby.waiting[0];
  if (!first) return null;
  const more = lobby.waiting.length - 1;
  return (
    <div className="absolute bottom-4 right-4 z-30 w-[min(21rem,calc(100%-2rem))] animate-[lkin_0.25s_ease-out] rounded-2xl bg-[#13283d]/95 p-4 text-white shadow-2xl shadow-black/50 ring-1 ring-white/10 backdrop-blur">
      <div className="flex items-start gap-3">
        <span className={cx("flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white", avatarColor(first.name))}>{initialsOf(first.name)}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{more > 0 ? `${first.name} and ${more} other${more > 1 ? "s" : ""} want to join` : `${first.name} wants to join`}</p>
          <p className="text-xs text-white/55">{first.enrolled ? "Student in this class" : first.role === "student" ? "Not in this class – opened the class link" : "Opened the class link"}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {more > 0 ? (
          <>
            <button type="button" onClick={onViewAll} className="h-9 rounded-full px-4 text-sm font-semibold text-white/80 transition hover:bg-white/10">
              View all
            </button>
            <button type="button" onClick={lobby.admitAll} className="h-9 rounded-full bg-brand px-4 text-sm font-semibold text-navy transition hover:bg-brand-hover">
              Admit all
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => lobby.deny(first.userId)} className="h-9 rounded-full px-4 text-sm font-semibold text-white/80 transition hover:bg-white/10">
              Deny
            </button>
            <button type="button" onClick={() => lobby.admit(first.userId)} className="h-9 rounded-full bg-brand px-4 text-sm font-semibold text-navy transition hover:bg-brand-hover">
              Admit
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function WaitingList({ lobby }) {
  return (
    <li className="mb-2 rounded-2xl bg-brand/10 p-2 ring-1 ring-brand/20">
      <div className="flex items-center justify-between gap-2 px-2 pb-1.5 pt-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Waiting to join ({lobby.waiting.length})</p>
        {lobby.waiting.length > 1 && (
          <button type="button" onClick={lobby.admitAll} className="text-xs font-semibold text-white hover:underline">
            Admit all
          </button>
        )}
      </div>
      <ul className="space-y-1">
        {lobby.waiting.map((w) => (
          <li key={w.userId} className="flex items-center gap-2.5 rounded-xl px-2 py-1.5">
            <span className={cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white", avatarColor(w.name))}>{initialsOf(w.name)}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">{w.name}</p>
              <p className="truncate text-[11px] text-white/45">{w.enrolled ? "In this class" : "Not in this class"}</p>
            </div>
            <button type="button" onClick={() => lobby.deny(w.userId)} aria-label={`Deny ${w.name}`} title="Deny" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/60 hover:bg-white/10 hover:text-white">
              <X className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => lobby.admit(w.userId)} aria-label={`Admit ${w.name}`} title="Admit" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-navy hover:bg-brand-hover">
              <UserCheck className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
    </li>
  );
}

// Class link + "let students in without asking"
function SharePanel({ info, lobby, toast }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(info.joinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast("Couldn't copy – select the link and copy it", X);
    }
  };
  return (
    <div className="p-4 text-white">
      <p className="text-sm font-semibold">Share this class</p>
      <p className="mt-1 text-xs text-white/55">Send this link to students. They sign in to the portal and ask to join – you let them in.</p>
      <div className="mt-3 flex items-center gap-2 rounded-xl bg-white/5 p-1.5 pl-3 ring-1 ring-white/10">
        <span className="min-w-0 flex-1 select-all truncate font-mono text-xs text-white/85">{info.joinUrl.replace(/^https?:\/\//, "")}</span>
        <button type="button" onClick={copy} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-brand px-3 text-xs font-semibold text-navy transition hover:bg-brand-hover">
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <label className="mt-4 flex cursor-pointer items-start gap-3">
        <input type="checkbox" checked={lobby.autoAdmit} onChange={(e) => lobby.setAutoAdmit(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#e8b112]" />
        <span>
          <span className="block text-sm font-medium">Let this class's students in without asking</span>
          <span className="block text-xs text-white/50">Anyone else who opens the link still has to ask.</span>
        </span>
      </label>
    </div>
  );
}

// ---- Overlays ----------------------------------------------------------------------------
function Toasts({ items }) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-3 z-20 flex w-[min(92%,24rem)] -translate-x-1/2 flex-col gap-2">
      {items.map(({ id, text, icon: Icon }) => (
        <div key={id} className="flex animate-[lkin_0.25s_ease-out] items-center gap-2.5 rounded-2xl bg-[#13283d]/95 px-4 py-2.5 text-sm text-white shadow-xl ring-1 ring-white/10 backdrop-blur">
          {Icon && <Icon className="h-4 w-4 shrink-0 text-brand" />}
          <span className="min-w-0 truncate">{text}</span>
        </div>
      ))}
    </div>
  );
}

function FloatingReactions({ items }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      {items.map((r) => (
        <div key={r.id} className="absolute bottom-4 flex animate-[lkfloat_3.2s_ease-out_forwards] flex-col items-center" style={{ left: `${r.left}%` }}>
          <span className="text-4xl drop-shadow-lg">{r.emoji}</span>
          {r.name && <span className="mt-1 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-semibold text-white">{r.name}</span>}
        </div>
      ))}
      <style>{`
        @keyframes lkfloat { 0% { transform: translateY(0) scale(.6); opacity: 0 } 10% { opacity: 1; transform: translateY(-20px) scale(1.1) } 100% { transform: translateY(-320px) scale(1); opacity: 0 } }
        @keyframes lkin { from { transform: translateY(-6px); opacity: 0 } to { transform: none; opacity: 1 } }
        @keyframes lkbar { 0%,100% { transform: scaleY(.35) } 50% { transform: scaleY(1) } }
      `}</style>
    </div>
  );
}

function StartAudioPrompt() {
  const room = useRoomContext();
  const { mergedProps, canPlayAudio } = useStartAudio({ room, props: {} });
  if (canPlayAudio) return null;
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <button type="button" onClick={mergedProps.onClick} className="inline-flex items-center gap-2 rounded-full bg-brand px-6 py-3 text-sm font-semibold text-navy shadow-xl transition hover:bg-brand-hover">
        <Volume2 className="h-4 w-4" /> Click to enable class audio
      </button>
    </div>
  );
}

// ---- Helpers -----------------------------------------------------------------------------
const PALETTE = ["bg-sky-600", "bg-amber-600", "bg-emerald-600", "bg-violet-600", "bg-rose-600", "bg-teal-600"];
const avatarColor = (name = "") => PALETTE[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];
const initialsOf = (name = "") =>
  name
    .replace(/\(.*?\)/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("") || "?";
