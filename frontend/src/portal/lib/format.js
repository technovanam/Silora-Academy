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

// ---- Consistent people data in tables --------------------------------------------------
/** "SASIKIRAN TT" / "sanjana b" → "Sasikiran TT" / "Sanjana B". Mixed-case words (McDonald) are left alone. */
export const fmtName = (name = "") =>
  String(name)
    .trim()
    .split(/\s+/)
    .map((w) => {
      if (w.length <= 2) return w.toUpperCase(); // initials
      if (w !== w.toUpperCase() && w !== w.toLowerCase()) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");

/** "9" / "9th" / "grade 9" → "Grade 9"; anything else (e.g. "LKG") is just trimmed. */
export const fmtGrade = (g) => {
  const s = String(g || "").trim();
  const n = /^(?:grade|class|std\.?)?\s*(\d{1,2})(?:st|nd|rd|th)?$/i.exec(s);
  return n ? `Grade ${Number(n[1])}` : s;
};

/** Indian numbers → "+91 98765 43210"; others keep their country code: "+44 7911123456". */
export const fmtPhone = (v) => {
  const raw = String(v || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (!digits) return raw;
  if (digits.length === 10 && !raw.startsWith("+")) return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  const m = /^\+(\d{1,4})[\s-]+(.+)$/.exec(raw);
  return m ? `+${m[1]} ${m[2].replace(/\D/g, "")}` : `${raw.startsWith("+") ? "+" : ""}${digits}`;
};

/** Last sign-in: "Just now", "17 min ago", "Today, 9:40 am", "Yesterday, 6:10 pm", "12 Nov, 6:10 pm". */
export const fmtLastSeen = (v) => {
  if (!v) return "Never";
  const t = d(v);
  const mins = Math.floor((Date.now() - t.getTime()) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const today = new Date();
  const yest = new Date(Date.now() - 86400000);
  if (t.toDateString() === today.toDateString()) return `Today, ${fmtTime(t)}`;
  if (t.toDateString() === yest.toDateString()) return `Yesterday, ${fmtTime(t)}`;
  const opts = { day: "numeric", month: "short", ...(t.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) };
  return `${t.toLocaleDateString("en-IN", opts)}, ${fmtTime(t)}`;
};

export const roleLabel ={ admin: "Admin", teacher: "Teacher", student: "Student" };

// "1 class", "2 classes": a count with the right singular/plural word
export const plural = (n, one, many = `${one}s`) => `${n ?? 0} ${Number(n) === 1 ? one : many}`;
