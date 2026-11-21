// ============================================================
// Live class: the whiteboard screen (drawing tools on top).
// The board itself and its messages are in lib/board.js.
// ============================================================
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUpRight, Circle, Download, Eraser, Highlighter, Minus, Pencil, Square, Trash2, Type, Undo2 } from "lucide-react";
import { BOARD_H, BOARD_W, COLORS, SIZES, drawBoard, drawStroke, newId } from "../../lib/board.js";
import { cx } from "../../ui/index.jsx";

const TOOLS = [
  { id: "pen", icon: Pencil, label: "Pen" },
  { id: "marker", icon: Highlighter, label: "Highlighter" },
  { id: "line", icon: Minus, label: "Line" },
  { id: "arrow", icon: ArrowUpRight, label: "Arrow" },
  { id: "rect", icon: Square, label: "Rectangle" },
  { id: "ellipse", icon: Circle, label: "Circle" },
  { id: "text", icon: Type, label: "Text" },
  { id: "eraser", icon: Eraser, label: "Eraser" },
];
const MAX_POINTS = 3000; // a long line is split so each message stays small

/**
 * @param board  Board instance (lib/board.js)
 * @param send   (msg) => void – applies locally and shares with the class
 * @param canDraw  false → view only
 * @param canClear the teacher can clear the board and erase anything
 */
export default function Whiteboard({ board, send, canDraw, canClear, uid, title }) {
  const wrap = useRef(null);
  const canvas = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [tool, setTool] = useState("pen");
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(SIZES[0]);
  const [text, setText] = useState(null); // { x, y, sx, sy, value }
  const live = useRef(null); // stroke being drawn
  const pendingPts = useRef([]);
  const flushTimer = useRef(null);
  const [version, setVersion] = useState(0);

  // Redraw whenever the board changes (here or from someone else)
  useEffect(() => {
    board.onChange = () => setVersion((v) => v + 1);
    return () => {
      board.onChange = null;
    };
  }, [board]);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Redraw on every change
  useEffect(() => {
    const c = canvas.current;
    if (!c || !size.w) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== size.w * dpr) {
      c.width = size.w * dpr;
      c.height = size.h * dpr;
    }
    const ctx = c.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBoard(ctx, board.strokes, size.w, size.h);
  }, [version, size, board]);

  const view = () => {
    const k = Math.min(size.w / BOARD_W, size.h / BOARD_H);
    return { k, ox: (size.w - BOARD_W * k) / 2, oy: (size.h - BOARD_H * k) / 2 };
  };
  const toBoard = (e) => {
    const r = canvas.current.getBoundingClientRect();
    const { k, ox, oy } = view();
    const x = (e.clientX - r.left - ox) / k;
    const y = (e.clientY - r.top - oy) / k;
    return [Math.round(Math.max(0, Math.min(BOARD_W, x))), Math.round(Math.max(0, Math.min(BOARD_H, y)))];
  };

  const flush = () => {
    clearTimeout(flushTimer.current);
    flushTimer.current = null;
    const s = live.current;
    if (!s) return;
    if (s.tool === "pen" || s.tool === "marker") {
      if (pendingPts.current.length) send({ t: "wb-a", id: s.id, p: pendingPts.current }, { local: false });
      pendingPts.current = [];
    } else send({ t: "wb-a", id: s.id, p: s.p }, { local: false });
  };
  const scheduleFlush = () => {
    if (!flushTimer.current) flushTimer.current = setTimeout(flush, 60);
  };

  const erase = (x, y) => {
    const ids = board.hit(x, y, 14).filter((id) => canClear || board.strokes.find((s) => s.id === id)?.uid === uid);
    if (ids.length) send({ t: "wb-x", ids });
  };

  const down = (e) => {
    if (!canDraw || e.button > 0) return;
    const [x, y] = toBoard(e);
    if (tool === "text") {
      const r = canvas.current.getBoundingClientRect();
      setText({ x, y, sx: e.clientX - r.left, sy: e.clientY - r.top, value: "" });
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === "eraser") {
      live.current = { tool: "eraser" };
      erase(x, y);
      return;
    }
    const s = { id: newId(), uid, tool, c: color, w: width, p: tool === "pen" || tool === "marker" ? [x, y] : [x, y, x, y] };
    live.current = s;
    pendingPts.current = [];
    send({ t: "wb-s", s: { ...s, p: [...s.p] } });
  };

  const move = (e) => {
    const s = live.current;
    if (!s) return;
    const [x, y] = toBoard(e);
    if (s.tool === "eraser") return erase(x, y);
    const local = board.strokes.find((b) => b.id === s.id);
    if (s.tool === "pen" || s.tool === "marker") {
      const n = s.p.length;
      if (Math.abs(s.p[n - 2] - x) + Math.abs(s.p[n - 1] - y) < 2) return;
      s.p.push(x, y);
      pendingPts.current.push(x, y);
      if (local) local.p = [...s.p];
      if (s.p.length > MAX_POINTS * 2) {
        // Start a fresh stroke from here so messages stay small
        flush();
        const next = { ...s, id: newId(), p: [x, y] };
        live.current = next;
        send({ t: "wb-s", s: { ...next, p: [x, y] } });
        return;
      }
    } else {
      s.p = [s.p[0], s.p[1], x, y];
      if (local) local.p = [...s.p];
    }
    // Draw the change right away; others get it a moment later
    const c = canvas.current;
    if (c) {
      const ctx = c.getContext("2d");
      if (s.tool === "pen" || s.tool === "marker") {
        const dpr = window.devicePixelRatio || 1;
        const { k, ox, oy } = view();
        ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * ox, dpr * oy);
        const n = s.p.length;
        drawStroke(ctx, { ...s, p: s.p.slice(Math.max(0, n - 6)) });
      } else {
        const dpr = window.devicePixelRatio || 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawBoard(ctx, board.strokes, size.w, size.h);
      }
    }
    scheduleFlush();
  };

  const up = () => {
    if (live.current && live.current.tool !== "eraser") flush();
    live.current = null;
    setVersion((v) => v + 1);
  };

  const commitText = () => {
    if (text?.value.trim()) send({ t: "wb-s", s: { id: newId(), uid, tool: "text", c: color, w: Math.max(4, width + 2), p: [text.x, text.y], text: text.value.trim().slice(0, 300) } });
    setText(null);
  };

  const undo = () => {
    const mine = [...board.strokes].reverse().find((s) => s.uid === uid);
    if (mine) send({ t: "wb-x", ids: [mine.id] });
  };

  const download = () => {
    const c = document.createElement("canvas");
    c.width = BOARD_W;
    c.height = BOARD_H;
    drawBoard(c.getContext("2d"), board.strokes, BOARD_W, BOARD_H);
    const a = document.createElement("a");
    a.href = c.toDataURL("image/png");
    a.download = `${(title || "Whiteboard").replace(/[^\w\- ]+/g, "")} whiteboard.png`;
    a.click();
  };

  // Ctrl+Z undoes your last drawing
  useEffect(() => {
    if (!canDraw) return;
    const k = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  const btn = (active) => cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition", active ? "bg-[#d3e3fd] text-[#041e49]" : "text-[#444746] hover:bg-black/5");

  return (
    <div className="relative h-full w-full bg-[#e8eaed]">
      <div ref={wrap} className="absolute inset-0">
        <canvas
          ref={canvas}
          style={{ width: size.w, height: size.h, touchAction: "none", cursor: canDraw ? (tool === "text" ? "text" : tool === "eraser" ? "cell" : "crosshair") : "default" }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        />
      </div>

      {text && (
        <input
          autoFocus
          value={text.value}
          onChange={(e) => setText({ ...text, value: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitText();
            if (e.key === "Escape") setText(null);
          }}
          onBlur={commitText}
          maxLength={300}
          placeholder="Type, then press Enter"
          className="absolute z-10 min-w-[180px] rounded border border-[#1a73e8] bg-white/90 px-2 py-1 text-base outline-none"
          style={{ left: text.sx, top: text.sy - 18, color }}
        />
      )}

      {canDraw ? (
        <div className="absolute left-1/2 top-2 z-10 flex max-w-[calc(100%-16px)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-full bg-white px-2 py-1 shadow-[0_1px_3px_rgba(0,0,0,.3)] [scrollbar-width:none]">
          {TOOLS.map((t) => (
            <button key={t.id} type="button" title={t.label} aria-label={t.label} aria-pressed={tool === t.id} onClick={() => setTool(t.id)} className={btn(tool === t.id)}>
              <t.icon className="h-[18px] w-[18px]" />
            </button>
          ))}
          <span className="mx-1 h-6 w-px shrink-0 bg-black/10" />
          {COLORS.map((c) => (
            <button key={c} type="button" title="Colour" aria-label={`Colour ${c}`} aria-pressed={color === c} onClick={() => setColor(c)} className={cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", color === c && "ring-2 ring-[#1a73e8]")}>
              <span className="h-5 w-5 rounded-full border border-black/15" style={{ background: c }} />
            </button>
          ))}
          <span className="mx-1 h-6 w-px shrink-0 bg-black/10" />
          {SIZES.map((s) => (
            <button key={s} type="button" title="Thickness" aria-label={`Thickness ${s}`} aria-pressed={width === s} onClick={() => setWidth(s)} className={btn(width === s)}>
              <span className="rounded-full bg-current" style={{ width: s + 3, height: s + 3 }} />
            </button>
          ))}
          <span className="mx-1 h-6 w-px shrink-0 bg-black/10" />
          <button type="button" title="Undo (Ctrl+Z)" aria-label="Undo" onClick={undo} className={btn(false)}>
            <Undo2 className="h-[18px] w-[18px]" />
          </button>
          {canClear && (
            <button type="button" title="Clear the board" aria-label="Clear the board" onClick={() => send({ t: "wb-clear" })} className={btn(false)}>
              <Trash2 className="h-[18px] w-[18px]" />
            </button>
          )}
          <button type="button" title="Download as a picture" aria-label="Download as a picture" onClick={download} className={btn(false)}>
            <Download className="h-[18px] w-[18px]" />
          </button>
        </div>
      ) : (
        <div className="absolute right-2 top-2 z-10 flex items-center gap-2">
          <span className="rounded-full bg-white/90 px-3 py-1.5 text-xs font-medium text-[#444746] shadow">View only</span>
          <button type="button" title="Download as a picture" aria-label="Download as a picture" onClick={download} className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-[#444746] shadow hover:bg-slate-50">
            <Download className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
