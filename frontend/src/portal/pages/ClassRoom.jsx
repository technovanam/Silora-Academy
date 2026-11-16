// ============================================================
// LIVE CLASSROOM – LiveKit (open source, self-hosted) with our
// own interface. Flow: join details → pre-join (camera / mic
// check) → live room → left / ended.
// ============================================================
import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { createLocalAudioTrack, createLocalVideoTrack, Room } from "livekit-client";
import { ArrowLeft, Camera, CameraOff, ChevronDown, Clock, DoorOpen, Loader2, Mic, MicOff, ShieldCheck, UserX, Video, Wifi } from "lucide-react";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import { fmtDateTime, fmtTime } from "../lib/format.js";
import { Button, cx } from "../ui/index.jsx";
import LiveRoom, { RoomShell, Centered } from "../components/classroom.jsx";

export default function ClassRoom() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const code = search.get("code") || undefined; // opened from a shared class link
  const { user } = useAuth();
  const navigate = useNavigate();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | waiting | prejoin | live | left | ended | error
  const [endReason, setEndReason] = useState(null);
  const [choices, setChoices] = useState(null);
  const back = `/portal/${user.role === "admin" ? "admin/classes" : user.role === "teacher" ? "teacher/calendar" : "student/classes"}`;

  // Get join details (retry while the class hasn't opened yet)
  useEffect(() => {
    let timer;
    let cancelled = false;
    const tryJoin = async () => {
      try {
        const res = await api.get(`/meetings/${id}/join`, { code });
        if (cancelled) return;
        setInfo(res);
        setStatus("prejoin");
      } catch (e) {
        if (cancelled) return;
        if (e.code === "too_early") {
          setStatus("waiting");
          setError(e);
          const m = await api.get(`/meetings/${id}`).catch(() => null);
          if (m && !cancelled) setInfo({ meeting: m.meeting, waiting: true });
          timer = setTimeout(tryJoin, 30000);
        } else {
          setError(e);
          setStatus("error");
        }
      }
    };
    tryJoin();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id, code]);

  // Keep the portal session alive while in class
  useEffect(() => {
    if (status !== "live" && status !== "prejoin") return;
    document.body.dataset.inClass = "1";
    const t = setInterval(() => api.get("/me").catch(() => {}), 5 * 60000);
    return () => {
      delete document.body.dataset.inClass;
      clearInterval(t);
    };
  }, [status]);

  const rejoin = async () => {
    setStatus("loading");
    try {
      const res = await api.get(`/meetings/${id}/join`, { code });
      setInfo(res);
      setStatus("prejoin");
    } catch (e) {
      setError(e);
      setStatus("error");
    }
  };

  const m = info?.meeting;

  if (status === "live" && info?.token) {
    return (
      <LiveRoom
        info={info}
        choices={choices}
        meetingId={id}
        back={back}
        onLeave={(reason) => {
          setEndReason(reason || null);
          setStatus(reason === "ended" || reason === "removed" ? "ended" : "left");
        }}
      />
    );
  }

  return (
    <RoomShell>
      <header className="flex items-center gap-3 px-3 py-3 text-white sm:px-6">
        <Link to={back} className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium text-white/75 transition hover:bg-white/10 hover:text-white">
          <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">Back to portal</span>
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{m?.title || "Live class"}</p>
          {m && (
            <p className="truncate text-xs text-white/50">
              {fmtDateTime(m.startAt)} – {fmtTime(m.endAt)}
              {m.subject ? ` · ${m.subject}` : ""}
            </p>
          )}
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        {status === "loading" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/70">
            <Loader2 className="h-8 w-8 animate-spin text-brand" />
            <p className="text-sm">Getting your class ready…</p>
          </div>
        )}
        {status === "prejoin" && info && (
          <PreJoin
            info={info}
            meetingId={id}
            code={code}
            onJoin={(c, joinInfo) => {
              if (joinInfo) setInfo(joinInfo);
              setChoices(c);
              setStatus("live");
            }}
          />
        )}
        {status === "waiting" && (
          <Centered icon={Clock} title="Your class hasn't opened yet" text={`${error?.message}. This page will connect automatically.`}>
            {m && <p className="mt-2 text-sm text-white/60">Starts {fmtDateTime(m.startAt)}</p>}
          </Centered>
        )}
        {status === "error" && (
          <Centered icon={Video} title="Can't join this class" text={error?.message}>
            <Button className="mt-6" onClick={() => navigate(back)}>
              Back to portal
            </Button>
          </Centered>
        )}
        {status === "left" && (
          <Centered icon={Video} title="You left the class" text={endReason === "error" ? "The connection to the class dropped. You can rejoin while it's running." : "Thanks for joining. You can rejoin while the class is running."}>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Button variant="outline" onClick={rejoin}>
                Rejoin
              </Button>
              <Button onClick={() => navigate(back)}>Back to portal</Button>
            </div>
          </Centered>
        )}
        {status === "ended" && (
          <Centered icon={Video} title={endReason === "removed" ? "You were removed from the class" : "The class has ended"} text={endReason === "removed" ? "The teacher removed you from this class. Contact them if this was a mistake." : "The host ended this class for everyone. See you next time!"}>
            <Button className="mt-6" onClick={() => navigate(back)}>
              Back to portal
            </Button>
          </Centered>
        )}
      </div>
    </RoomShell>
  );
}

// ---- Pre-join: camera / mic check --------------------------------------------------
function useDevices(kind) {
  const [devices, setDevices] = useState([]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      Room.getLocalDevices(kind, false)
        .then((d) => alive && setDevices(d.filter((x) => x.deviceId)))
        .catch(() => {});
    load();
    navigator.mediaDevices?.addEventListener?.("devicechange", load);
    return () => {
      alive = false;
      navigator.mediaDevices?.removeEventListener?.("devicechange", load);
    };
  }, [kind]);
  return devices;
}

// ---- Lobby: ask to join, wait for the teacher (polls every 2 s) ---------------------
function useAdmission({ meetingId, code, enabled }) {
  const [state, setState] = useState({ status: "idle" }); // idle | asking | denied | blocked | error
  const timer = useRef(null);
  const asking = state.status === "asking";
  const knockPath = `/meetings/${meetingId}/knock${code ? `?code=${encodeURIComponent(code)}` : ""}`;

  useEffect(() => () => clearTimeout(timer.current), []);

  // Stop asking if the page is closed while waiting
  useEffect(() => {
    if (!asking) return;
    const leave = () => api.del(knockPath).catch(() => {});
    window.addEventListener("pagehide", leave);
    return () => window.removeEventListener("pagehide", leave);
  }, [asking, knockPath]);

  const ask = async (onAdmitted) => {
    if (!enabled) return;
    clearTimeout(timer.current);
    const poll = async () => {
      try {
        const s = await api.get(`/meetings/${meetingId}/knock`, { code });
        if (s.status === "admitted") {
          setState({ status: "idle" });
          return onAdmitted(s.join);
        }
        if (s.status === "denied") return setState({ status: "denied" });
        if (s.status === "none") await api.post(`/meetings/${meetingId}/knock`, { code }); // server restarted – ask again
        setState((cur) => (cur.status === "asking" ? { status: "asking", hostPresent: s.hostPresent !== false } : cur));
      } catch (e) {
        if (e.code === "ended") return setState({ status: "error", message: e.message });
      }
      timer.current = setTimeout(poll, 2000);
    };
    try {
      const r = await api.post(`/meetings/${meetingId}/knock`, { code });
      setState({ status: "asking", hostPresent: true });
      timer.current = setTimeout(poll, r.status === "admitted" ? 0 : 1500);
    } catch (e) {
      setState({ status: e.code === "blocked" ? "blocked" : "error", message: e.message });
    }
  };

  const cancel = () => {
    clearTimeout(timer.current);
    setState({ status: "idle" });
    api.del(knockPath).catch(() => {});
  };
  return { ...state, ask, cancel };
}

function PreJoin({ info, onJoin, meetingId, code }) {
  const videoEl = useRef(null);
  const [camOn, setCamOn] = useState(true);
  const [micOn, setMicOn] = useState(!!info.isHost);
  const [camId, setCamId] = useState("");
  const [micId, setMicId] = useState("");
  const [camError, setCamError] = useState("");
  const [micError, setMicError] = useState("");
  const [level, setLevel] = useState(0);
  const cams = useDevices("videoinput");
  const mics = useDevices("audioinput");

  // Camera preview
  useEffect(() => {
    if (!camOn) return;
    let track;
    let alive = true;
    setCamError("");
    createLocalVideoTrack({ deviceId: camId || undefined, resolution: { width: 1280, height: 720 } })
      .then((t) => {
        if (!alive) return t.stop();
        track = t;
        if (videoEl.current) t.attach(videoEl.current);
      })
      .catch(() => alive && setCamError("Camera blocked or not found"));
    return () => {
      alive = false;
      track?.stop();
    };
  }, [camOn, camId]);

  // Mic level meter
  useEffect(() => {
    if (!micOn) return setLevel(0);
    let track, ctx, raf;
    let alive = true;
    setMicError("");
    createLocalAudioTrack({ deviceId: micId || undefined })
      .then((t) => {
        if (!alive) return t.stop();
        track = t;
        ctx = new AudioContext();
        const src = ctx.createMediaStreamSource(new MediaStream([t.mediaStreamTrack]));
        const an = ctx.createAnalyser();
        an.fftSize = 256;
        src.connect(an);
        const buf = new Uint8Array(an.frequencyBinCount);
        const tick = () => {
          an.getByteFrequencyData(buf);
          setLevel(Math.min(1, buf.reduce((a, b) => a + b, 0) / buf.length / 60));
          raf = requestAnimationFrame(tick);
        };
        tick();
      })
      .catch(() => alive && setMicError("Microphone blocked or not found"));
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ctx?.close().catch(() => {});
      track?.stop();
    };
  }, [micOn, micId]);

  const admission = useAdmission({ meetingId, code, enabled: !!info.needsAdmission });
  const currentChoices = () => ({ audio: micOn && !micError, video: camOn && !camError, audioDeviceId: micId, videoDeviceId: camId });

  const m = info.meeting;
  return (
    <div className="scrollbar-thin absolute inset-0 overflow-y-auto">
      <div className="mx-auto grid min-h-full max-w-6xl items-center gap-8 px-4 py-6 sm:px-6 lg:grid-cols-[1.4fr_1fr] lg:gap-12">
        <div>
          <div className="relative aspect-video overflow-hidden rounded-3xl bg-[#13283d] shadow-2xl shadow-black/40 ring-1 ring-white/10">
            {camOn && !camError ? (
              <video ref={videoEl} className="h-full w-full -scale-x-100 object-cover" muted playsInline autoPlay />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-white/60">
                <span className="flex h-20 w-20 items-center justify-center rounded-full bg-white/10 text-2xl font-bold text-white">{initialsOf(info.displayName)}</span>
                <p className="text-sm">{camError || "Camera is off"}</p>
              </div>
            )}
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-3 bg-gradient-to-t from-black/60 to-transparent p-4 pt-12">
              <RoundToggle on={micOn} onClick={() => setMicOn((v) => !v)} onIcon={Mic} offIcon={MicOff} label={micOn ? "Turn microphone off" : "Turn microphone on"} />
              <RoundToggle on={camOn} onClick={() => setCamOn((v) => !v)} onIcon={Camera} offIcon={CameraOff} label={camOn ? "Turn camera off" : "Turn camera on"} />
            </div>
            <span className="absolute left-4 top-4 rounded-full bg-black/45 px-3 py-1 text-xs font-medium text-white backdrop-blur">{info.displayName}</span>
            {micOn && !micError && (
              <div className="absolute right-4 top-4 flex h-7 items-end gap-0.5 rounded-full bg-black/45 px-2.5 py-1.5 backdrop-blur" aria-label="Microphone level">
                {[0.15, 0.35, 0.55, 0.75, 0.9].map((t) => (
                  <span key={t} className={cx("w-1 rounded-full transition-all", level > t ? "bg-brand" : "bg-white/25")} style={{ height: `${30 + t * 70}%` }} />
                ))}
              </div>
            )}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <DevicePicker icon={Mic} devices={mics} value={micId} onChange={setMicId} placeholder="Default microphone" error={micOn ? micError : ""} />
            <DevicePicker icon={Camera} devices={cams} value={camId} onChange={setCamId} placeholder="Default camera" error={camOn ? camError : ""} />
          </div>
        </div>

        <div className="text-white">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">Ready to join?</p>
          <h1 className="mt-2 text-2xl font-bold leading-tight sm:text-3xl">{m.title}</h1>
          <p className="mt-2 text-sm text-white/60">
            {fmtDateTime(m.startAt)} – {fmtTime(m.endAt)}
            {m.subject ? ` · ${m.subject}` : ""}
          </p>
          <ul className="mt-6 space-y-3 text-sm text-white/70">
            <li className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> {info.isHost ? "Private room – students wait in the lobby until you let them in." : "Private room – the teacher lets each person in."}
            </li>
            <li className="flex items-start gap-3">
              <Wifi className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" /> Video quality adapts automatically to your connection.
            </li>
            {info.isHost && (
              <li className="flex items-start gap-3">
                <Video className="mt-0.5 h-4 w-4 shrink-0 text-brand" /> You're the host: you can let people in, mute or remove participants{info.canRecord ? ", record," : ""} and end the class.
              </li>
            )}
          </ul>
          {info.needsAdmission ? (
            <AskToJoin admission={admission} hostPresent={info.hostPresent} onAsk={() => admission.ask((joinInfo) => onJoin(currentChoices(), joinInfo))} />
          ) : (
            <Button size="lg" className="mt-8 w-full sm:w-auto sm:min-w-56" onClick={() => onJoin(currentChoices())}>
              Join class
            </Button>
          )}
          {!info.isHost && <p className="mt-3 text-xs text-white/45">Tip: keep your mic off until you want to speak, and raise your hand to ask a question.</p>}
        </div>
      </div>
    </div>
  );
}

function RoundToggle({ on, onClick, onIcon: On, offIcon: Off, label }) {
  const Icon = on ? On : Off;
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={cx("flex h-12 w-12 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand", on ? "bg-white/15 text-white backdrop-blur hover:bg-white/25" : "bg-rose-500 text-white hover:bg-rose-600")}>
      <Icon className="h-5 w-5" />
    </button>
  );
}

function DevicePicker({ icon: Icon, devices, value, onChange, placeholder, error }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener("pointerdown", h);
    return () => document.removeEventListener("pointerdown", h);
  }, [open]);
  const current = devices.find((d) => d.deviceId === value);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className={cx("flex h-11 w-full items-center gap-2.5 rounded-xl px-3.5 text-left text-sm ring-1 transition", error ? "bg-rose-500/10 text-rose-200 ring-rose-400/30" : "bg-white/5 text-white/85 ring-white/10 hover:bg-white/10")}>
        <Icon className="h-4 w-4 shrink-0 text-white/50" />
        <span className="min-w-0 flex-1 truncate">{error || current?.label || placeholder}</span>
        <ChevronDown className={cx("h-4 w-4 shrink-0 text-white/40 transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute inset-x-0 top-full z-20 mt-1.5 overflow-hidden rounded-xl bg-[#13283d] py-1 shadow-2xl ring-1 ring-white/10">
          {[{ deviceId: "", label: placeholder }, ...devices].map((d) => (
            <button
              key={d.deviceId || "default"}
              type="button"
              onClick={() => {
                onChange(d.deviceId);
                setOpen(false);
              }}
              className={cx("block w-full truncate px-3.5 py-2.5 text-left text-sm transition hover:bg-white/10", d.deviceId === value ? "font-semibold text-brand" : "text-white/80")}
            >
              {d.label || "Unnamed device"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const initialsOf = (name = "") =>
  name
    .replace(/\(.*?\)/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");

function AskToJoin({ admission, hostPresent, onAsk }) {
  if (admission.status === "asking")
    return (
      <div className="mt-8 rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 shrink-0 animate-spin text-brand" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Asking to join…</p>
            <p className="text-xs text-white/55">{admission.hostPresent === false ? "Your teacher hasn't joined yet. You'll get in as soon as they let you in." : "You'll join the class when your teacher lets you in."}</p>
          </div>
        </div>
        <button type="button" onClick={admission.cancel} className="mt-3 text-xs font-semibold text-white/60 underline-offset-2 hover:text-white hover:underline">
          Cancel
        </button>
      </div>
    );
  return (
    <div className="mt-8">
      {admission.status === "denied" && (
        <p className="mb-3 flex items-start gap-2 rounded-xl bg-rose-500/10 px-3 py-2.5 text-sm text-rose-200 ring-1 ring-rose-400/20">
          <UserX className="mt-0.5 h-4 w-4 shrink-0" /> Your request to join wasn't accepted. You can ask again.
        </p>
      )}
      {(admission.status === "blocked" || admission.status === "error") && <p className="mb-3 rounded-xl bg-rose-500/10 px-3 py-2.5 text-sm text-rose-200 ring-1 ring-rose-400/20">{admission.message}</p>}
      <Button size="lg" icon={DoorOpen} className="w-full sm:w-auto sm:min-w-56" onClick={onAsk} disabled={admission.status === "blocked"}>
        {admission.status === "denied" ? "Ask again" : "Ask to join"}
      </Button>
      {!hostPresent && admission.status === "idle" && <p className="mt-3 text-xs text-white/45">Your teacher hasn't joined yet – you can ask now and wait here.</p>}
    </div>
  );
}
