// ============================================================
// Live class: video / sound elements, speaking detection, devices.
// ============================================================
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Volume2 } from "lucide-react";
import { listDevices, savedDevices, saveDevice } from "../../lib/live.js";
import { Button, Dialog, Field, Select, cx } from "../../ui/index.jsx";

export function VideoView({ stream, track, mirror, className, fit = "cover" }) {
  const ref = useRef(null);
  const src = useMemo(() => stream || (track ? new MediaStream([track]) : null), [stream, track]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = src;
    if (src) el.play().catch(() => {});
  }, [src]);
  return <video ref={ref} autoPlay playsInline muted className={cx("h-full w-full", fit === "contain" ? "object-contain" : "object-cover", mirror && "-scale-x-100", className)} />;
}

// Sound from the class. Browsers may block it until the page is tapped once.
export function AudioOut({ stream }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !stream) return;
    el.srcObject = stream;
    const sink = savedDevices().speaker;
    if (sink && el.setSinkId) el.setSinkId(sink).catch(() => {});
    // Only a blocked autoplay needs a tap; other errors (a new stream arriving) don't
    el.play().catch((e) => e?.name === "NotAllowedError" && window.dispatchEvent(new Event("live:sound-blocked")));
  }, [stream]);
  return <audio ref={ref} autoPlay data-live-audio="" className="hidden" />;
}

export function SoundUnlock() {
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
      className="absolute left-1/2 top-4 z-30 inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-[#8ab4f8] px-5 py-2.5 text-sm font-semibold text-[#202124] shadow-lg"
    >
      <Volume2 className="h-4 w-4" /> Tap to turn on sound
    </button>
  );
}

// ---- Who is talking (a shared audio analyser, checked a few times a second) ----
let ac;
const audioCtx = () => {
  if (!ac) {
    try {
      ac = new AudioContext();
    } catch {
      return null;
    }
  }
  if (ac.state === "suspended") ac.resume().catch(() => {});
  return ac;
};

/** true while there is sound on this track / stream. */
export function useSpeaking(source, enabled = true) {
  const [on, setOn] = useState(false);
  const track = source ? (source instanceof MediaStream ? source.getAudioTracks()[0] : source) : null;
  useEffect(() => {
    if (!enabled || !track || track.readyState === "ended") {
      setOn(false);
      return;
    }
    const ctx = audioCtx();
    if (!ctx) return;
    let node, an, t;
    try {
      node = ctx.createMediaStreamSource(new MediaStream([track]));
      an = ctx.createAnalyser();
      an.fftSize = 512;
      node.connect(an);
    } catch {
      return;
    }
    const buf = new Uint8Array(an.fftSize);
    let quiet = 0;
    t = setInterval(() => {
      if (!track.enabled) return setOn(false);
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += (buf[i] - 128) ** 2;
      const level = Math.sqrt(sum / buf.length);
      if (level > 6) {
        quiet = 0;
        setOn(true);
      } else if (++quiet > 4) setOn(false);
    }, 150);
    return () => {
      clearInterval(t);
      node.disconnect();
    };
  }, [track, enabled]);
  return on;
}

// ---- Settings: microphone, speaker, camera ----
export function useDevices(open) {
  const [devs, setDevs] = useState({ mics: [], cams: [], speakers: [] });
  useEffect(() => {
    if (!open) return;
    let dead = false;
    const load = () => listDevices().then((d) => !dead && setDevs(d));
    load();
    navigator.mediaDevices?.addEventListener?.("devicechange", load);
    return () => {
      dead = true;
      navigator.mediaDevices?.removeEventListener?.("devicechange", load);
    };
  }, [open]);
  return devs;
}

export function currentId(track, kind, list) {
  const id = track?.getSettings?.().deviceId || savedDevices()[kind];
  return list.some((d) => d.id === id) ? id : list[0]?.id || "";
}

export function SettingsDialog({ open, onClose, micTrack, camTrack, onSwitch }) {
  const d = useDevices(open);
  const [speaker, setSpeaker] = useState(savedDevices().speaker || "");
  const canSink = typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
  const pickSpeaker = (id) => {
    setSpeaker(id);
    saveDevice("speaker", id);
    document.querySelectorAll("audio[data-live-audio]").forEach((a) => a.setSinkId?.(id).catch(() => {}));
  };
  const opts = (list) => list.map((x) => ({ value: x.id, label: x.label }));
  return (
    <Dialog open={open} onClose={onClose} title="Settings" subtitle="Choose your microphone, speaker and camera" footer={<Button onClick={onClose}>Done</Button>}>
      <div className="space-y-4">
        <Field label="Microphone">
          <Select value={currentId(micTrack, "mic", d.mics)} onChange={(v) => onSwitch("mic", v)} options={opts(d.mics)} emptyText="No microphone found" />
        </Field>
        {canSink && (
          <Field label="Speaker">
            <Select value={d.speakers.some((x) => x.id === speaker) ? speaker : d.speakers[0]?.id || ""} onChange={pickSpeaker} options={opts(d.speakers)} emptyText="Default speaker" />
          </Field>
        )}
        <Field label="Camera">
          <Select value={currentId(camTrack, "cam", d.cams)} onChange={(v) => onSwitch("cam", v)} options={opts(d.cams)} emptyText="No camera found" />
        </Field>
        <p className="text-xs text-muted">Your choice is remembered on this device.</p>
      </div>
    </Dialog>
  );
}
