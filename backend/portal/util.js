// ============================================================================
// SMALL SHARED HELPERS
// ============================================================================
import crypto from "crypto";
import config from "./config.js";

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const fail = (status, message, code) => {
  throw new HttpError(status, message, code);
};

// Wrap async route handlers so thrown errors reach the error middleware
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const nowIso = () => new Date().toISOString();
export const addDays = (d, n) => new Date(new Date(d).getTime() + n * 86400000);
export const addMinutes = (d, n) => new Date(new Date(d).getTime() + n * 60000);

export const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 20);

export const docData = (snap) => (snap.exists ? { id: snap.id, ...snap.data() } : null);
export const listData = (qs) => qs.docs.map((d) => ({ id: d.id, ...d.data() }));

export const str = (v, max = 500) => (v === undefined || v === null ? "" : String(v).trim().slice(0, max));
export const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || ""));
export const toIso = (v) => {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) fail(400, "Invalid date");
  return d.toISOString();
};

// Firestore "in" queries accept at most 30 values – split into chunks
export const chunk = (arr, size = 30) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

export async function getMany(db, collection, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};
  const refs = unique.map((id) => db.collection(collection).doc(id));
  const snaps = await db.getAll(...refs);
  return Object.fromEntries(snaps.filter((s) => s.exists).map((s) => [s.id, { id: s.id, ...s.data() }]));
}

// Readable random password for new accounts / resets
export function tempPassword() {
  const words = ["Maple", "River", "Cloud", "Stone", "Amber", "Cedar", "Lotus", "Orbit", "Pixel", "Sunny"];
  const w = words[crypto.randomInt(words.length)];
  const digits = String(crypto.randomInt(1000, 9999));
  const sym = "!@#$%&"[crypto.randomInt(6)];
  return `${w}${sym}${digits}${crypto.randomBytes(2).toString("hex")}`;
}

// ---- Dates in the academy's timezone ----------------------------------------
function partsIn(date, tz = config.timezone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" })
      .formatToParts(new Date(date))
      .map((x) => [x.type, x.value])
  );
  return p;
}

// Monday of the week (YYYY-MM-DD) for a date, in the academy timezone
export function weekStartOf(date = new Date(), tz = config.timezone) {
  const p = partsIn(date, tz);
  const idx = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[p.weekday];
  const d = new Date(Date.UTC(+p.year, +p.month - 1, +p.day));
  d.setUTCDate(d.getUTCDate() - idx);
  return d.toISOString().slice(0, 10);
}
export const shiftWeek = (weekStart, n) => {
  const d = new Date(`${weekStart}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n * 7);
  return d.toISOString().slice(0, 10);
};
// Approximate UTC range that covers a local week (padded by the tz offset)
export function weekRangeUtc(weekStart) {
  const start = new Date(`${weekStart}T00:00:00Z`);
  return { from: addDays(start, -1).toISOString(), to: addDays(start, 8).toISOString() };
}
export function localDateOf(iso, tz = config.timezone) {
  const p = partsIn(iso, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

// ---- CSV ----------------------------------------------------------------------
export function toCsv(rows, columns) {
  const esc = (v) => {
    if (v === null || v === undefined) return "";
    const s = Array.isArray(v) ? v.join("; ") : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => esc(c.label)).join(",");
  const body = rows.map((r) => columns.map((c) => esc(typeof c.value === "function" ? c.value(r) : r[c.key])).join(",")).join("\r\n");
  return `﻿${head}\r\n${body}`;
}

// ---- Signed, short-lived tokens (file links) -------------------
const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const fromB64url = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

export function signToken(payload, secret = config.fileTokenSecret, ttlSec = config.fileTokenTtlSec) {
  const body = b64url(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec }));
  const sig = b64url(crypto.createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}
export function verifyToken(token, secret = config.fileTokenSecret) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  const expected = b64url(crypto.createHmac("sha256", secret).update(body).digest());
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const payload = JSON.parse(fromB64url(body).toString("utf8"));
  if (payload.exp && payload.exp < Date.now() / 1000) return null;
  return payload;
}

// Standard HS256 JWT
export function signJwt(payload, secret) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

export const clientIp = (req) => (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "";
