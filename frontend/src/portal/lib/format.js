// Date / size helpers (shown in the viewer's local time)
const d = (v) => (v instanceof Date ? v : new Date(v));

export const fmtDate = (v) => (v ? d(v).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—");
export const fmtDay = (v) => (v ? d(v).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }) : "—");
export const fmtTime = (v) => (v ? d(v).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "");
export const fmtDateTime = (v) => (v ? `${fmtDay(v)}, ${fmtTime(v)}` : "—");
export const fmtWeek = (weekStart) => {
  if (!weekStart) return "";
  const s = new Date(`${weekStart}T00:00:00`);
  const e = new Date(s.getTime() + 6 * 86400000);
  const o = { day: "numeric", month: "short" };
  return `${s.toLocaleDateString("en-IN", o)} – ${e.toLocaleDateString("en-IN", { ...o, year: "numeric" })}`;
};

export function fromNow(v) {
  if (!v) return "never";
  const diff = (Date.now() - d(v).getTime()) / 1000;
  const abs = Math.abs(diff);
  const fut = diff < 0;
  const unit = abs < 60 ? [Math.round(abs), "sec"] : abs < 3600 ? [Math.round(abs / 60), "min"] : abs < 86400 ? [Math.round(abs / 3600), "hr"] : abs < 86400 * 30 ? [Math.round(abs / 86400), "day"] : null;
  if (!unit) return fmtDate(v);
  if (unit[1] === "sec" && !fut) return "just now";
  const label = `${unit[0]} ${unit[1]}${unit[0] === 1 ? "" : "s"}`;
  return fut ? `in ${label}` : `${label} ago`;
}

export const fmtSize = (b) => (!b ? "" : b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : b < 1073741824 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1073741824).toFixed(2)} GB`);

// <input type="datetime-local"> value helpers
export const toLocalInput = (v) => {
  if (!v) return "";
  const x = d(v);
  const pad = (n) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
};
export const fromLocalInput = (s) => (s ? new Date(s).toISOString() : null);

export const initials = (name = "") =>
  name
    .split(/\s+/)
    .filter((p) => /^[\p{L}\p{N}]/u.test(p))
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("") || "?";

export const roleLabel = { admin: "Admin", teacher: "Teacher", student: "Student" };
