// ============================================================
// CLASS RECORDER – runs in the teacher's browser.
// Draws what the class sees (shared screen / whiteboard / teacher camera,
// plus the students speaking) onto a hidden canvas, mixes the sound, records
// it with the browser's MediaRecorder and uploads it in 4 MiB pieces while
// the class goes on (a resumable upload created by the API).
// ============================================================
import { drawBoard } from "./board.js";

const W = 1280;
const H = 720;
const FPS = 15;

// Timers in a worker keep running when the teacher switches to another tab
function makeTicker(fn) {
  try {
    const src = "let t;onmessage=e=>{clearInterval(t);if(e.data>0)t=setInterval(()=>postMessage(0),e.data)}";
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
    w.onmessage = fn;
    w.postMessage(1000 / FPS);
    return () => w.terminate();
  } catch {
    const t = setInterval(fn, 1000 / FPS);
    return () => clearInterval(t);
  }
}

function pickMime() {
  for (const m of ["video/webm;codecs=vp8,opus", "video/webm;codecs=vp9,opus", "video/webm"]) if (MediaRecorder.isTypeSupported?.(m)) return m;
  return "";
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fitRect(sw, sh, x, y, w, h) {
  if (!sw || !sh) return [x, y, w, h];
  const k = Math.min(w / sw, h / sh);
  const dw = sw * k, dh = sh * k;
  return [x + (w - dw) / 2, y + (h - dh) / 2, dw, dh];
}
function coverRect(sw, sh, w, h) {
  if (!sw || !sh) return [0, 0, sw, sh];
  const k = Math.max(w / sw, h / sh);
  const cw = w / k, ch = h / k;
  return [(sw - cw) / 2, (sh - ch) / 2, cw, ch];
}

export class ClassRecorder {
  /**
   * @param getScene () => ({ main:{type:"track",track}|{type:"board",strokes}|{type:"avatar",name},
   *                        corner: track|null, tiles:[{track,name}], audio:[track], title })
   */
  constructor({ getScene, onState }) {
    this.getScene = getScene;
    this.onState = onState;
    this.vids = new Map();
    this.audioNodes = new Map();
    this.parts = [];
    this.buffered = 0;
    this.offset = 0;
    this.uploading = false;
    this.state = "idle"; // idle | recording | stopping | done | error
    this.error = null;
  }

  set(state, error) {
    this.state = state;
    if (error !== undefined) this.error = error;
    this.onState?.(this);
  }

  videoFor(track) {
    if (!track || track.readyState === "ended") return null;
    let v = this.vids.get(track.id);
    if (!v) {
      v = document.createElement("video");
      v.muted = true;
      v.playsInline = true;
      v.srcObject = new MediaStream([track]);
      v.play().catch(() => {});
      this.vids.set(track.id, v);
    }
    return v.readyState >= 2 ? v : null;
  }

  syncAudio(tracks) {
    const ids = new Set();
    for (const t of tracks) {
      if (!t || t.readyState === "ended") continue;
      ids.add(t.id);
      if (!this.audioNodes.has(t.id)) {
        try {
          const node = this.ac.createMediaStreamSource(new MediaStream([t]));
          node.connect(this.dest);
          this.audioNodes.set(t.id, node);
        } catch {
          /* track without sound yet */
        }
      }
    }
    for (const [id, node] of this.audioNodes)
      if (!ids.has(id)) {
        node.disconnect();
        this.audioNodes.delete(id);
      }
  }

  draw() {
    const ctx = this.ctx;
    const sc = this.getScene();
    ctx.fillStyle = "#202124";
    ctx.fillRect(0, 0, W, H);
    const main = sc.main || {};
    if (main.type === "board") drawBoard(ctx, main.strokes || [], W, H);
    else {
      const v = main.type === "track" && this.videoFor(main.track);
      if (v) ctx.drawImage(v, ...fitRect(v.videoWidth, v.videoHeight, 0, 0, W, H));
      else this.avatar(ctx, main.name || "", 0, 0, W, H, 64);
    }
    // Teacher's camera in the corner while presenting
    const cv = sc.corner && this.videoFor(sc.corner);
    if (cv) this.box(ctx, cv, W - 256 - 16, 16, 256, 144, "");
    // Students speaking along the bottom right
    (sc.tiles || []).forEach((t, i) => {
      const x = W - (i + 1) * (224 + 12) - 4, y = H - 126 - 16;
      const v = t.track && this.videoFor(t.track);
      if (v) this.box(ctx, v, x, y, 224, 126, t.name);
      else {
        ctx.fillStyle = "#3c4043";
        ctx.fillRect(x, y, 224, 126);
        this.avatar(ctx, t.name, x, y, 224, 126, 26);
        this.label(ctx, t.name, x, y + 126);
      }
    });
    // Seen in the video: class name and time
    ctx.font = "500 15px system-ui, sans-serif";
    ctx.fillStyle = "rgba(0,0,0,.55)";
    const stamp = `${sc.title || "Class"} · ${new Date().toLocaleString()}`;
    const tw = ctx.measureText(stamp).width;
    ctx.fillRect(12, 12, tw + 20, 28);
    ctx.fillStyle = "#fff";
    ctx.fillText(stamp, 22, 31);
    this.syncAudio(sc.audio || []);
  }

  box(ctx, v, x, y, w, h, name) {
    ctx.save();
    ctx.fillStyle = "#000";
    ctx.fillRect(x, y, w, h);
    ctx.drawImage(v, ...coverRect(v.videoWidth, v.videoHeight, w, h), x, y, w, h);
    ctx.strokeStyle = "rgba(255,255,255,.35)";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
    if (name) this.label(ctx, name, x, y + h);
  }
  label(ctx, name, x, bottom) {
    ctx.font = "500 13px system-ui, sans-serif";
    const w = Math.min(200, ctx.measureText(name).width + 14);
    ctx.fillStyle = "rgba(0,0,0,.6)";
    ctx.fillRect(x + 6, bottom - 26, w, 20);
    ctx.fillStyle = "#fff";
    ctx.fillText(name, x + 13, bottom - 11, 186);
  }
  avatar(ctx, name, x, y, w, h, r) {
    ctx.fillStyle = "#5f6368";
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h / 2, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = `600 ${r}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText((name || "?").trim().charAt(0).toUpperCase(), x + w / 2, y + h / 2 + 2);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }

  /** Start recording into the upload the API created. */
  async start({ uploadUrl, chunkBytes, maxHours = 4 }) {
    this.url = uploadUrl;
    this.chunk = chunkBytes;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    this.ctx = canvas.getContext("2d");
    this.ac = new AudioContext();
    if (this.ac.state === "suspended") await this.ac.resume().catch(() => {});
    this.dest = this.ac.createMediaStreamDestination();
    // A silent source keeps the sound track running when nobody talks
    const silent = this.ac.createConstantSource();
    const g = this.ac.createGain();
    g.gain.value = 0;
    silent.connect(g).connect(this.dest);
    silent.start();
    this.draw();
    const video = canvas.captureStream(FPS).getVideoTracks()[0];
    const stream = new MediaStream([video, ...this.dest.stream.getAudioTracks()]);
    const mimeType = pickMime();
    this.rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 800000, audioBitsPerSecond: 64000 });
    this.rec.ondataavailable = (e) => {
      if (e.data?.size) {
        this.parts.push(e.data);
        this.buffered += e.data.size;
        this.pump();
      }
    };
    this.stopTicker = makeTicker(() => {
      try {
        this.draw();
      } catch {
        /* a source went away mid-frame */
      }
    });
    this.startedAt = Date.now();
    this.rec.start(4000);
    this.limit = setTimeout(() => this.onLimit?.(), maxHours * 3600000);
    this.set("recording", null);
  }

  get seconds() {
    return this.startedAt ? Math.round((Date.now() - this.startedAt) / 1000) : 0;
  }

  // Upload whole 4 MiB pieces as they fill up
  async pump(final = false) {
    if (this.uploading) return (this.pending = this.pending || final);
    this.uploading = true;
    try {
      while (this.buffered >= this.chunk || (final && this.buffered >= 0 && !this.finished)) {
        const all = new Blob(this.parts);
        const size = final ? all.size : Math.floor(all.size / this.chunk) * this.chunk;
        const piece = all.slice(0, size);
        const total = final ? this.offset + size : null;
        await this.put(piece, total);
        this.offset += size;
        const rest = all.slice(size);
        this.parts = rest.size ? [rest] : [];
        this.buffered = rest.size;
        if (final) this.finished = true;
      }
    } catch (e) {
      // Keep the data; the next piece tries again
      this.error = e;
      this.onState?.(this);
    } finally {
      this.uploading = false;
    }
    if (this.pending) {
      const f = this.pending === true;
      this.pending = false;
      return this.pump(f);
    }
  }

  async put(blob, total) {
    const range = blob.size ? `bytes ${this.offset}-${this.offset + blob.size - 1}/${total ?? "*"}` : `bytes */${total}`;
    let last;
    for (let i = 0; i < 5; i++) {
      try {
        const r = await fetch(this.url, { method: "PUT", headers: { "Content-Range": range }, body: blob });
        if (r.status === 308 || r.ok) {
          this.error = null;
          return;
        }
        last = new Error(`Upload answered ${r.status}`);
        if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) break;
      } catch (e) {
        last = e;
      }
      await sleep(1500 * (i + 1));
    }
    throw last || new Error("Upload failed");
  }

  /** Stop and upload what's left. Resolves with the length in seconds. */
  async stop() {
    if (this.state !== "recording") return { durationSec: this.seconds };
    this.set("stopping");
    clearTimeout(this.limit);
    const durationSec = this.seconds;
    await new Promise((resolve) => {
      this.rec.onstop = resolve;
      try {
        this.rec.stop();
      } catch {
        resolve();
      }
    });
    this.stopTicker?.();
    // Wait for a piece already uploading, then send the rest as the last piece
    while (this.uploading) await sleep(200);
    await this.pump(true);
    this.cleanup();
    this.set(this.finished ? "done" : "error", this.finished ? null : this.error || new Error("Upload failed"));
    return { durationSec, uploaded: this.finished };
  }

  cleanup() {
    this.stopTicker?.();
    this.vids.forEach((v) => (v.srcObject = null));
    this.vids.clear();
    this.audioNodes.forEach((n) => n.disconnect());
    this.audioNodes.clear();
    this.ac?.close().catch(() => {});
  }
}
