// ============================================================================
// SESSIONS – one student + one subject + one teacher, numbered per student and
// subject ("Mathematics – Session 8"), with start/end dates and the number of
// classes planned. This is the client's per-student sheet.
//
// Classes are NOT put into a session by hand: a class counts towards a
// student's session when the student is in it, the subject and teacher match
// and the class date falls inside the session dates. So "classes taken" can't
// be typed or changed – it always comes from the classes really held.
// ============================================================================
import { db, C } from "../firebase.js";
import { listData, localDateOf } from "../util.js";
import { sameSubject } from "./core.js";

export const SESSION_STATUSES = ["draft", "active", "completed", "archived"];
export const isHeld = (m) => m.status !== "cancelled" && !!m.hadLiveClass;
export const sessionTitle = (s) => `${s.subject} – Session ${s.number}`;

// Does this class belong to this session (for this student)?
export function inSession(s, m, studentId = s.studentId) {
  if (!m || m.isDemo || !s || s.status === "archived") return false;
  if (m.teacherId !== s.teacherId || !(m.studentIds || []).includes(studentId)) return false;
  if (!m.subject || !sameSubject(m.subject, s.subject)) return false;
  const d = localDateOf(m.startAt);
  return d >= s.startDate && d <= s.endDate;
}

// All classes of a session (oldest first)
export async function meetingsOfSession(s) {
  const list = listData(await db.collection(C.meetings).where("teacherId", "==", s.teacherId).get());
  return list.filter((m) => inSession(s, m)).sort((a, b) => (a.startAt < b.startAt ? -1 : 1));
}

// Sessions of one student (not archived unless asked)
export async function sessionsOfStudent(studentId, { all = false } = {}) {
  const list = listData(await db.collection(C.sessions).where("studentIds", "array-contains", studentId).get());
  return all ? list : list.filter((s) => s.status !== "archived");
}

// For a class: the session each of its students' attendance counts towards
export async function sessionsForMeeting(m) {
  const out = {};
  if (!m || m.isDemo) return out;
  for (const sid of m.studentIds || []) {
    const s = (await sessionsOfStudent(sid)).find((x) => inSession(x, m, sid));
    if (s) out[sid] = s;
  }
  return out;
}

// Planned vs held, from the matched classes
export function progressOf(s, meetings) {
  const now = new Date().toISOString();
  const mine = meetings.filter((m) => inSession(s, m));
  const held = mine.filter(isHeld).length;
  const planned = s.plannedClasses || 0;
  return {
    planned,
    held,
    pending: Math.max(0, planned - held),
    upcoming: mine.filter((m) => m.status === "scheduled" && m.endAt > now).length,
    cancelled: mine.filter((m) => m.status === "cancelled").length,
    notStarted: mine.filter((m) => m.status !== "cancelled" && !m.hadLiveClass && m.endAt <= now).length,
    percent: planned ? Math.min(100, Math.round((held / planned) * 100)) : 0,
  };
}

// Overlapping session for the same student + subject (only one may be open at a time)
export async function overlapping({ studentId, subject, startDate, endDate }, ignoreId) {
  return (await sessionsOfStudent(studentId)).find((x) => x.id !== ignoreId && sameSubject(x.subject, subject) && x.startDate <= endDate && x.endDate >= startDate);
}

// Next session number for a student + subject
export async function nextNumber(studentId, subject) {
  const nums = (await sessionsOfStudent(studentId, { all: true })).filter((x) => sameSubject(x.subject, subject)).map((x) => x.number || 0);
  return (nums.length ? Math.max(...nums) : 0) + 1;
}
