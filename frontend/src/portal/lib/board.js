// ============================================================
// WHITEBOARD – shared drawing for a live class.
// The teacher's browser holds the board; drawings travel over the class
// data link (lib/live.js), so nothing is stored online. Points are kept in
// a fixed 1600 × 900 space, so the board looks the same on every screen.
//
// Messages:  {t:"wb-s", s:stroke}          new stroke (pen / shape / text)
//            {t:"wb-a", id, p:[x,y,…]}     more points for a stroke being drawn
//            {t:"wb-x", ids:[…]}           strokes erased
//            {t:"wb-clear"} {t:"wb-reset", strokes:[…]}
// ============================================================
export const BOARD_W = 1600;
export const BOARD_H = 900;
export const COLORS = ["#1f1f1f", "#d93025", "#1a73e8", "#188038", "#f9ab00", "#a142f4", "#ffffff"];
export const SIZES = [3, 6, 12];
const KEY = (mid) => `silora.board.${mid}`;

export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export class Board {
  constructor(onChange) {
    this.strokes = []; // { id, uid, tool, c, w, p:[x,y,…], text? }
    this.onChange = onChange;
  }

  load(mid) {
    try {
      const saved = JSON.parse(sessionStorage.getItem(KEY(mid)) || "[]");
      if (Array.isArray(saved)) this.strokes = saved;
    } catch {
      /* nothing saved */
    }
    this.mid = mid;
  }
  save() {
    if (!this.mid) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try {
        sessionStorage.setItem(KEY(this.mid), JSON.stringify(this.strokes));
      } catch {
        /* storage full or blocked */
      }
    }, 800);
  }

  changed() {
    this.save();
    this.onChange?.();
  }

  /** Apply a whiteboard message; returns true if it was one. */
  apply(msg) {
    switch (msg?.t) {
      case "wb-s":
        if (!msg.s?.id || this.strokes.some((s) => s.id === msg.s.id)) return true;
        this.strokes.push(clean(msg.s));
        break;
      case "wb-a": {
        const s = this.strokes.find((x) => x.id === msg.id);
        if (s && Array.isArray(msg.p)) s.p = s.tool === "pen" || s.tool === "marker" ? s.p.concat(msg.p.map(Number)) : msg.p.map(Number);
        break;
      }
      case "wb-x": {
        const ids = new Set(msg.ids || []);
        this.strokes = this.strokes.filter((s) => !ids.has(s.id));
        break;
      }
      case "wb-clear":
        this.strokes = [];
        break;
      case "wb-reset":
        this.strokes = (msg.strokes || []).map(clean);
        break;
      default:
        return false;
    }
    this.changed();
    return true;
  }

  /** Strokes touching a point (for the eraser). */
  hit(x, y, r = 14) {
    return this.strokes.filter((s) => touches(s, x, y, r)).map((s) => s.id);
  }
}

function clean(s) {
  return { id: String(s.id).slice(0, 24), uid: String(s.uid || "").slice(0, 60), tool: s.tool, c: String(s.c || "#000").slice(0, 9), w: Math.min(40, Math.max(1, Number(s.w) || 3)), p: (s.p || []).slice(0, 20000).map(Number), text: s.text ? String(s.text).slice(0, 300) : undefined };
}

function touches(s, x, y, r) {
  const p = s.p;
  if (s.tool === "text") {
    const size = s.w * 6;
    const w = (s.text || "").length * size * 0.55;
    return x >= p[0] - r && x <= p[0] + w + r && y >= p[1] - size - r && y <= p[1] + r;
  }
  if (s.tool === "rect" || s.tool === "ellipse") {
    const [x1, y1, x2, y2] = [Math.min(p[0], p[2]), Math.min(p[1], p[3]), Math.max(p[0], p[2]), Math.max(p[1], p[3])];
    const inside = x >= x1 - r && x <= x2 + r && y >= y1 - r && y <= y2 + r;
    const nearEdge = Math.min(Math.abs(x - x1), Math.abs(x - x2), Math.abs(y - y1), Math.abs(y - y2)) <= r + s.w;
    return inside && (nearEdge || s.tool === "ellipse");
  }
  for (let i = 0; i + 1 < p.length; i += 2) {
    const ax = p[i], ay = p[i + 1];
    const bx = p[i + 2] ?? ax, by = p[i + 3] ?? ay;
    if (distToSeg(x, y, ax, ay, bx, by) <= r + s.w / 2) return true;
  }
  return false;
}
function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Draw the whole board on a canvas context, scaled to (w × h). */
export function drawBoard(ctx, strokes, w, h, { background = "#ffffff" } = {}) {
  const k = Math.min(w / BOARD_W, h / BOARD_H);
  const ox = (w - BOARD_W * k) / 2, oy = (h - BOARD_H * k) / 2;
  ctx.save();
  ctx.fillStyle = "#e8eaed";
  ctx.fillRect(0, 0, w, h);
  ctx.translate(ox, oy);
  ctx.scale(k, k);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, BOARD_W, BOARD_H);
  ctx.beginPath();
  ctx.rect(0, 0, BOARD_W, BOARD_H);
  ctx.clip();
  for (const s of strokes) drawStroke(ctx, s);
  ctx.restore();
}

export function drawStroke(ctx, s) {
  const p = s.p;
  if (!p?.length) return;
  ctx.save();
  ctx.strokeStyle = s.c;
  ctx.fillStyle = s.c;
  ctx.lineWidth = s.w;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (s.tool === "marker") {
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = s.w * 3;
  }
  if (s.tool === "text") {
    ctx.font = `600 ${s.w * 6}px system-ui, sans-serif`;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(s.text || "", p[0], p[1]);
  } else if (s.tool === "line" || s.tool === "arrow") {
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(p[2] ?? p[0], p[3] ?? p[1]);
    ctx.stroke();
    if (s.tool === "arrow" && p.length >= 4) {
      const a = Math.atan2(p[3] - p[1], p[2] - p[0]);
      const L = 14 + s.w * 2.5;
      ctx.beginPath();
      ctx.moveTo(p[2], p[3]);
      ctx.lineTo(p[2] - L * Math.cos(a - 0.45), p[3] - L * Math.sin(a - 0.45));
      ctx.moveTo(p[2], p[3]);
      ctx.lineTo(p[2] - L * Math.cos(a + 0.45), p[3] - L * Math.sin(a + 0.45));
      ctx.stroke();
    }
  } else if (s.tool === "rect") {
    ctx.strokeRect(Math.min(p[0], p[2]), Math.min(p[1], p[3]), Math.abs(p[2] - p[0]), Math.abs(p[3] - p[1]));
  } else if (s.tool === "ellipse") {
    ctx.beginPath();
    ctx.ellipse((p[0] + p[2]) / 2, (p[1] + p[3]) / 2, Math.abs(p[2] - p[0]) / 2, Math.abs(p[3] - p[1]) / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    if (p.length === 2) ctx.lineTo(p[0] + 0.1, p[1]);
    for (let i = 2; i + 1 < p.length; i += 2) {
      // Smooth through mid-points
      const mx = (p[i - 2] + p[i]) / 2, my = (p[i - 1] + p[i + 1]) / 2;
      ctx.quadraticCurveTo(p[i - 2], p[i - 1], mx, my);
    }
    ctx.lineTo(p[p.length - 2], p[p.length - 1]);
    ctx.stroke();
  }
  ctx.restore();
}
