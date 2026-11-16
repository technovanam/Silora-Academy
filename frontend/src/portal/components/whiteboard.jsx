// ============================================================
// SHARED WHITEBOARD for the live classroom (LiveKit data channels)
// - Teachers/admins open and close it, clear it, and decide
//   whether students may draw.
// - Finished strokes go over a reliable text stream ("wb");
//   strokes in progress go over lossy data packets ("wb-live")
//   so everyone sees drawing as it happens.
// - Late joiners ask for the current board ("sync-req").
// - The host who opened the board also publishes it as a video
//   track ("whiteboard"), so the server-side class recording
//   includes it. Clients hide that track: they draw the board
//   themselves at full sharpness.
// Coordinates are stored 0..1 on a 16:9 board, so every screen
// size shows the same picture.
// ============================================================
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RoomEvent, Track } from "livekit-client";
import { useRoomContext } from "@livekit/components-react";
import { Circle, Download, Eraser, Highlighter, Lock, Minus, MoveUpRight, Pencil, Square, Trash2, Undo2, Users, X } from "lucide-react";
import { cx } from "../ui/index.jsx";

export const WB_TRACK = "whiteboard";
export const BOARD_W = 1280;
export const BOARD_H = 720;
const TOPIC = "wb";
const LIVE_TOPIC = "wb-live";
const enc = new TextEncoder();
const dec = new TextDecoder();
const uid = () => Math.random().toString(36).slice(2, 10);
const r4 = (n) => Math.round(Math.min(1, Math.max(0, n)) * 10000) / 10000;

export const COLORS = ["#111827", "#2563eb", "#dc2626", "#16a34a", "#ea580c", "#9333ea"];
const SIZES = [3, 6, 12];
const SHAPES = new Set(["line", "arrow", "rect", "ellipse"]);

/** True for the hidden video track that carries the board into the recording */
export const isWhiteboardTrack = (t) => t?.publication?.trackName === WB_TRACK;

// ---- Drawing ----------------------------------------------------------------------------
function drawStroke(ctx, s, W, H) {
  const k = W / BOARD_W;
  const p = s.pts;
  if (!p || p.length < 2) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = s.tool === "eraser" ? "#ffffff" : s.color;
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = s.size * k * (s.tool === "eraser" ? 4 : s.tool === "highlighter" ? 3 : 1);
  if (s.tool === "highlighter") ctx.globalAlpha = 0.3;
  const X = (i) => p[i] * W;
  const Y = (i) => p[i + 1] * H;

  if (SHAPES.has(s.tool)) {
    const [x0, y0, x1, y1] = [X(0), Y(0), X(2) || X(0), Y(2) || Y(0)];
    ctx.beginPath();
    if (s.tool === "rect") ctx.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    else if (s.tool === "ellipse") ctx.ellipse((x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, 0, 0, Math.PI * 2);
    else {
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      if (s.tool === "arrow") {
        const a = Math.atan2(y1 - y0, x1 - x0);
        const head = Math.max(12 * k, ctx.lineWidth * 3);
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 - head * Math.cos(a - Math.PI / 7), y1 - head * Math.sin(a - Math.PI / 7));
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 - head * Math.cos(a + Math.PI / 7), y1 - head * Math.sin(a + Math.PI / 7));
      }
    }
    ctx.stroke();
  } else if (p.length === 2) {
    ctx.beginPath();
    ctx.arc(X(0), Y(0), ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Smooth freehand: quadratic curves through the midpoints
    ctx.beginPath();
    ctx.moveTo(X(0), Y(0));
    for (let i = 2; i < p.length - 2; i += 2) {
      const mx = (X(i) + X(i + 2)) / 2;
      const my = (Y(i) + Y(i + 2)) / 2;
      ctx.quadraticCurveTo(X(i), Y(i), mx, my);
    }
    ctx.lineTo(X(p.length - 2), Y(p.length - 2));
    ctx.stroke();
  }
  ctx.restore();
}

export function paintBoard(ctx, W, H, store) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  for (const s of store.strokes) drawStroke(ctx, s, W, H);
  for (const s of store.live.values()) drawStroke(ctx, s, W, H);
}

// Strokes live outside React state so drawing doesn't re-render the whole room
class BoardStore {
  strokes = [];
  live = new Map();
  listeners = new Set();
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit() {
    this.listeners.forEach((fn) => fn());
  }
}

// ---- State + sync --------------------------------------------------------------------------
export function useWhiteboard({ isHost }) {
  const room = useRoomContext();
  const me = room.localParticipant;
  const store = useMemo(() => new BoardStore(), []);
  const [board, setBoard] = useState({ open: false, owner: null, studentsCanDraw: false });
  const boardRef = useRef(board);
  boardRef.current = board;
  const pubRef = useRef(null);

  const send = useCallback((msg, to) => me.sendText(JSON.stringify(msg), { topic: TOPIC, destinationIdentities: to }).catch(() => {}), [me]);
  const isHostId = useCallback((id) => room.remoteParticipants.get(id)?.attributes?.host === "true", [room]);
  const canDrawId = useCallback((id) => isHostId(id) || boardRef.current.studentsCanDraw, [isHostId]);

  // Incoming board messages
  useEffect(() => {
    const onText = async (reader, info) => {
      let msg;
      try {
        msg = JSON.parse(await reader.readAll());
      } catch {
        return;
      }
      const from = info.identity;
      const fromHost = isHostId(from);
      switch (msg.t) {
        case "state":
          if (!fromHost) return;
          setBoard({ open: !!msg.open, owner: msg.owner || from, studentsCanDraw: !!msg.studentsCanDraw });
          if (Array.isArray(msg.strokes)) store.strokes = msg.strokes;
          store.emit();
          break;
        case "sync":
          // Reply to our sync request – only take it if we have nothing yet
          if (!boardRef.current.open && msg.open) {
            setBoard({ open: true, owner: msg.owner, studentsCanDraw: !!msg.studentsCanDraw });
            store.strokes = Array.isArray(msg.strokes) ? msg.strokes : [];
            store.emit();
          }
          break;
        case "sync-req":
          if (boardRef.current.open) setTimeout(() => send({ t: "sync", ...boardRef.current, strokes: store.strokes }, [from]), Math.random() * 300);
          break;
        case "add":
          if (!msg.s || !canDrawId(from)) return;
          store.live.delete(msg.s.id);
          if (!store.strokes.some((s) => s.id === msg.s.id)) store.strokes.push({ ...msg.s, by: from });
          store.emit();
          break;
        case "undo":
          store.strokes = store.strokes.filter((s) => !(s.id === msg.id && (s.by === from || fromHost)));
          store.emit();
          break;
        case "clear":
          if (!fromHost) return;
          store.strokes = [];
          store.live.clear();
          store.emit();
          break;
        default:
      }
    };
    room.registerTextStreamHandler(TOPIC, onText);
    return () => room.unregisterTextStreamHandler(TOPIC);
  }, [room, store, send, isHostId, canDrawId]);

  // Strokes in progress from others (lossy)
  useEffect(() => {
    const onData = (payload, participant, _kind, topic) => {
      if (topic !== LIVE_TOPIC || !participant || !canDrawId(participant.identity)) return;
      let m;
      try {
        m = JSON.parse(dec.decode(payload));
      } catch {
        return;
      }
      if (store.strokes.some((s) => s.id === m.id)) return; // already finished
      const prev = store.live.get(m.id);
      const pts = m.i > 0 && prev ? prev.pts.slice(0, m.i).concat(m.pts) : m.pts;
      store.live.set(m.id, { id: m.id, by: participant.identity, tool: m.tool, color: m.color, size: m.size, pts });
      store.emit();
    };
    const onLeft = (p) => {
      let changed = false;
      for (const [id, s] of store.live) if (s.by === p.identity) changed = store.live.delete(id) || changed;
      if (changed) store.emit();
      // The host who was feeding the recording left: another host takes over
      const b = boardRef.current;
      if (isHost && b.open && b.owner === p.identity) {
        const hosts = [me.identity, ...[...room.remoteParticipants.values()].filter((x) => x.attributes?.host === "true").map((x) => x.identity)].sort();
        if (hosts[0] === me.identity) {
          const next = { ...b, owner: me.identity };
          setBoard(next);
          send({ t: "state", ...next });
        }
      }
    };
    room.on(RoomEvent.DataReceived, onData).on(RoomEvent.ParticipantDisconnected, onLeft);
    return () => {
      room.off(RoomEvent.DataReceived, onData).off(RoomEvent.ParticipantDisconnected, onLeft);
    };
  }, [room, me, store, isHost, send, canDrawId]);

  // Don't download the recording copy of the board – we draw it locally
  useEffect(() => {
    const skip = (pub) => pub?.trackName === WB_TRACK && pub.isSubscribed !== false && pub.setSubscribed(false);
    const onPub = (pub) => skip(pub);
    const onSub = (_track, pub) => skip(pub);
    room.on(RoomEvent.TrackPublished, onPub).on(RoomEvent.TrackSubscribed, onSub);
    room.remoteParticipants.forEach((p) => p.trackPublications.forEach(skip));
    return () => {
      room.off(RoomEvent.TrackPublished, onPub).off(RoomEvent.TrackSubscribed, onSub);
    };
  }, [room]);

  // Ask for the current board when we arrive
  useEffect(() => {
    const ask = () => send({ t: "sync-req" });
    if (room.state === "connected") ask();
    room.on(RoomEvent.Connected, ask);
    return () => {
      room.off(RoomEvent.Connected, ask);
    };
  }, [room, send]);

  // The owner feeds the board into the recording as a video track
  useEffect(() => {
    if (!(board.open && board.owner === me.identity)) return undefined;
    const canvas = document.createElement("canvas");
    canvas.width = BOARD_W;
    canvas.height = BOARD_H;
    const ctx = canvas.getContext("2d");
    const draw = () => paintBoard(ctx, BOARD_W, BOARD_H, store);
    draw();
    const mst = canvas.captureStream(15).getVideoTracks()[0];
    let cancelled = false;
    me.publishTrack(mst, { name: WB_TRACK, source: Track.Source.ScreenShare, simulcast: false, videoEncoding: { maxBitrate: 1_500_000, maxFramerate: 15 } })
      .then((pub) => {
        if (cancelled) me.unpublishTrack(pub.track, true).catch(() => {});
        else pubRef.current = pub;
      })
      .catch(() => {});
    let raf = 0;
    const unsub = store.subscribe(() => {
      if (!raf) raf = requestAnimationFrame(() => {
        raf = 0;
        draw();
      });
    });
    const keepAlive = setInterval(draw, 1000); // a still canvas sends no frames otherwise
    return () => {
      cancelled = true;
      unsub();
      clearInterval(keepAlive);
      cancelAnimationFrame(raf);
      const pub = pubRef.current;
      pubRef.current = null;
      if (pub?.track) me.unpublishTrack(pub.track, true).catch(() => {});
      mst.stop();
    };
  }, [board.open, board.owner, me, store]);

  // ---- Actions ----
  const setState = (next) => {
    setBoard(next);
    send({ t: "state", ...next, strokes: store.strokes });
  };
  const openBoard = async () => {
    if (!isHost) return;
    if (me.isScreenShareEnabled) await me.setScreenShareEnabled(false).catch(() => {});
    setState({ ...boardRef.current, open: true, owner: me.identity });
  };
  const closeBoard = async () => {
    if (!isHost) return;
    setState({ ...boardRef.current, open: false });
    const pub = pubRef.current;
    pubRef.current = null;
    if (pub?.track) await me.unpublishTrack(pub.track, true).catch(() => {});
  };
  const setStudentsCanDraw = (v) => isHost && setState({ ...boardRef.current, studentsCanDraw: v });
  const clear = () => {
    if (!isHost) return;
    store.strokes = [];
    store.live.clear();
    store.emit();
    send({ t: "clear" });
  };
  const commit = (s) => {
    store.live.delete(s.id);
    store.strokes.push(s);
    store.emit();
    send({ t: "add", s });
  };
  const undo = () => {
    for (let i = store.strokes.length - 1; i >= 0; i--) {
      if (store.strokes[i].by === me.identity) {
        const [s] = store.strokes.splice(i, 1);
        store.emit();
        send({ t: "undo", id: s.id });
        return;
      }
    }
  };
  // Throttled broadcast of the stroke being drawn
  const liveRef = useRef({ id: null, sent: 0, at: 0, timer: null });
  const sendLive = (s, force) => {
    const L = liveRef.current;
    if (L.id !== s.id) Object.assign(L, { id: s.id, sent: 0, at: 0 });
    const flush = () => {
      L.timer = null;
      L.at = Date.now();
      const shape = SHAPES.has(s.tool);
      const from = shape ? 0 : Math.max(0, L.sent - 2);
      const msg = { id: s.id, tool: s.tool, color: s.color, size: s.size, i: from, pts: s.pts.slice(from) };
      L.sent = s.pts.length;
      me.publishData(enc.encode(JSON.stringify(msg)), { reliable: false, topic: LIVE_TOPIC }).catch(() => {});
    };
    if (force || Date.now() - L.at > 50) flush();
    else if (!L.timer) L.timer = setTimeout(flush, 50);
  };

  const canDraw = isHost || board.studentsCanDraw;
  return { ...board, store, canDraw, isHost, me, openBoard, closeBoard, setStudentsCanDraw, clear, commit, undo, sendLive };
}

// ---- Board UI ----------------------------------------------------------------------------
const TOOLS = [
  { id: "pen", icon: Pencil, label: "Pen" },
  { id: "highlighter", icon: Highlighter, label: "Highlighter" },
  { id: "eraser", icon: Eraser, label: "Eraser" },
  { id: "line", icon: Minus, label: "Line" },
  { id: "arrow", icon: MoveUpRight, label: "Arrow" },
  { id: "rect", icon: Square, label: "Rectangle" },
  { id: "ellipse", icon: Circle, label: "Circle" },
];

export function Whiteboard({ wb }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [tool, setTool] = useState("pen");
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(SIZES[0]);
  const cur = useRef(null);
  const { store } = wb;

  // Fit a 16:9 board into the space available
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      const w = Math.floor(Math.min(width, (height * 16) / 9));
      setBox({ w, h: Math.floor((w * 9) / 16) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Redraw on every change (batched per frame)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !box.w) return undefined;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = box.w * dpr;
    canvas.height = box.h * dpr;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let raf = 0;
    const draw = () => paintBoard(ctx, box.w, box.h, store);
    draw();
    const unsub = store.subscribe(() => {
      if (!raf) raf = requestAnimationFrame(() => {
        raf = 0;
        draw();
      });
    });
    return () => {
      unsub();
      cancelAnimationFrame(raf);
    };
  }, [box, store]);

  // Ctrl/⌘+Z undoes your last stroke
  useEffect(() => {
    const h = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && wb.canDraw) {
        e.preventDefault();
        wb.undo();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [wb]);

  const pos = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return [r4((e.clientX - r.left) / r.width), r4((e.clientY - r.top) / r.height)];
  };
  const down = (e) => {
    if (!wb.canDraw || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    canvasRef.current.setPointerCapture(e.pointerId);
    const [x, y] = pos(e);
    cur.current = { id: uid(), by: wb.me.identity, tool, color, size, pts: SHAPES.has(tool) ? [x, y, x, y] : [x, y] };
    store.live.set(cur.current.id, cur.current);
    store.emit();
    wb.sendLive(cur.current, true);
  };
  const move = (e) => {
    const s = cur.current;
    if (!s) return;
    if (SHAPES.has(s.tool)) {
      const [x, y] = pos(e);
      s.pts = [s.pts[0], s.pts[1], x, y];
    } else {
      for (const ev of e.nativeEvent.getCoalescedEvents?.() || [e]) {
        const [x, y] = pos(ev);
        const n = s.pts.length;
        if (Math.abs(x - s.pts[n - 2]) + Math.abs(y - s.pts[n - 1]) > 0.0015) s.pts.push(x, y);
      }
    }
    store.emit();
    wb.sendLive(s);
  };
  const up = () => {
    const s = cur.current;
    if (!s) return;
    cur.current = null;
    wb.commit({ ...s, pts: [...s.pts] });
  };

  const download = () => {
    const c = document.createElement("canvas");
    c.width = BOARD_W;
    c.height = BOARD_H;
    paintBoard(c.getContext("2d"), BOARD_W, BOARD_H, store);
    const a = document.createElement("a");
    a.href = c.toDataURL("image/png");
    a.download = `whiteboard-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.png`;
    a.click();
  };

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="scrollbar-thin flex shrink-0 items-center gap-1 overflow-x-auto rounded-2xl bg-[#0f2236]/90 p-1.5 ring-1 ring-white/10">
        {wb.canDraw ? (
          <>
            {TOOLS.map((t) => (
              <ToolBtn key={t.id} active={tool === t.id} onClick={() => setTool(t.id)} icon={t.icon} label={t.label} />
            ))}
            <Sep />
            {COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setColor(c)} aria-label={`Colour ${c}`} title="Colour" className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition hover:bg-white/10", color === c && "bg-white/10")}>
                <span className={cx("h-5 w-5 rounded-full ring-2", color === c ? "ring-white" : "ring-white/20")} style={{ background: c }} />
              </button>
            ))}
            <Sep />
            {SIZES.map((s) => (
              <button key={s} type="button" onClick={() => setSize(s)} aria-label={`Thickness ${s}`} title="Thickness" className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition hover:bg-white/10", size === s && "bg-white/10")}>
                <span className="rounded-full bg-white" style={{ width: 4 + s, height: 4 + s }} />
              </button>
            ))}
            <Sep />
            <ToolBtn onClick={wb.undo} icon={Undo2} label="Undo (Ctrl+Z)" />
          </>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-2 px-3 text-xs font-medium text-white/60">
            <Lock className="h-3.5 w-3.5" /> View only – your teacher can let you draw
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {wb.isHost && (
            <button
              type="button"
              onClick={() => wb.setStudentsCanDraw(!wb.studentsCanDraw)}
              className={cx("inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-semibold transition", wb.studentsCanDraw ? "bg-brand text-navy hover:bg-brand-hover" : "text-white/70 hover:bg-white/10 hover:text-white")}
              title="Let students draw on the board"
            >
              <Users className="h-4 w-4" /> <span className="hidden lg:inline">{wb.studentsCanDraw ? "Students can draw" : "Only you draw"}</span>
            </button>
          )}
          <ToolBtn onClick={download} icon={Download} label="Save as image" />
          {wb.isHost && <ToolBtn onClick={wb.clear} icon={Trash2} label="Clear board" />}
          {wb.isHost && <ToolBtn onClick={wb.closeBoard} icon={X} label="Close whiteboard" />}
        </div>
      </div>
      <div ref={wrapRef} className="flex min-h-0 flex-1 items-center justify-center">
        <canvas
          ref={canvasRef}
          style={{ width: box.w, height: box.h, touchAction: "none" }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          className={cx("rounded-2xl bg-white shadow-2xl shadow-black/30", wb.canDraw ? (tool === "eraser" ? "cursor-cell" : "cursor-crosshair") : "cursor-default")}
        />
      </div>
    </div>
  );
}

function ToolBtn({ active, onClick, icon: Icon, label }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition", active ? "bg-white text-navy" : "text-white/75 hover:bg-white/10 hover:text-white")}>
      <Icon className="h-4 w-4" />
    </button>
  );
}

const Sep = () => <span className="mx-1 h-6 w-px shrink-0 bg-white/10" />;
