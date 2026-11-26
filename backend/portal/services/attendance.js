// ============================================================================
// CLASS ATTENDANCE – built from the live classroom's join/leave intervals.
//
//  • Every time someone is let into a class a new interval {from, to} starts;
//    leaving, losing the connection, being removed or the class ending closes
//    it (routes/live.js). Rejoining after a network drop simply adds another
//    interval – it is never treated as an absence.
//  • Total time = the merged intervals (overlaps are never counted twice).
//  • The status comes from the admin's rules (minimum % of the class,
//    late-arrival grace period) and approved leave. Date, time, minutes, status
//    and class count are AUTOMATIC and teachers can't change them (only an
//    admin can correct a status, with a reason).
//  • The teacher fills in the teaching columns of the client's sheet: lesson
//    taken, homework, quiz/test topic and result, remarks, compensation class.
//
// Data: classAttendance/{meetingId}  – one form per conducted class
//       leaveRequests/{id}            – student leave requests
// ============================================================================
import config from "../config.js";
import { db, C } from "../firebase.js";
import { listData, getMany, localDateOf } from "../util.js";
import { getSettings } from "./core.js";

export const STATUSES = ["present", "late", "absent", "leave", "uninformed"];
// What the teacher writes for each student (the rest is automatic)
export const ROW_FIELDS = { remarks: 500, quizTopic: 200, quizResult: 60, testTopic: 200, testResult: 60 };
// What the teacher writes for the class as a whole
export const CLASS_FIELDS = { lessonTaken: 500, homework: 500, compensationFor: 120, remarks: 2000 };
export const STATUS_LABEL = { present: "Present", late: "Late", absent: "Absent", leave: "Leave", uninformed: "Uninformed absence" };
export const ATTENDED = new Set(["present", "late"]);
export const TEACHER_EDIT_DAYS = 7; // a teacher can change a submitted form for this long

export const DEFAULT_RULES = {
  minPercent: 75, // at least this % of the scheduled class time → present/late
  graceMin: 10, // first join more than this many minutes after the start → late
  reminderHours: 24, // remind the teacher if the form isn't submitted this long after the class
  formsFrom: "2026-11-25", // classes before this date don't need a form (older classes had no intervals)
};

export async function getRules() {
  const s = await getSettings();
  return { ...DEFAULT_RULES, ...(s.attendanceRules || {}) };
}

const ms = (iso) => new Date(iso).getTime();
const dayName = (iso) => new Intl.DateTimeFormat("en-GB", { timeZone: config.timezone, weekday: "long" }).format(new Date(iso));

// Intervals from a liveRooms people doc. Older docs (before intervals were
// stored) only have a running total – they become one interval.
export function intervalsOf(p, now = new Date().toISOString()) {
  if (!p) return [];
  let list = Array.isArray(p.intervals) ? p.intervals.map((i) => ({ from: i.from, to: i.to || null })) : [];
  if (!list.length && p.firstJoinedAt && (p.totalSec || p.openSince)) {
    const to = p.openSince ? null : p.lastLeftAt || new Date(ms(p.firstJoinedAt) + (p.totalSec || 0) * 1000).toISOString();
    list = [{ from: p.firstJoinedAt, to }];
  }
  // An interval still open: the person is in the class right now (or their browser
  // went quiet – then count until their last check-in)
  const stale = p.lastSeenAt && Date.now() - ms(p.lastSeenAt) > 6 * 60000;
  return list.map((i) => {
    if (i.to) return i;
    if (p.status === "in") return { ...i, to: stale ? p.lastSeenAt : now, open: !stale };
    return { ...i, to: p.lastLeftAt || p.lastSeenAt || i.from };
  });
}

// Merge overlapping / touching intervals and sort them
export function mergeIntervals(list) {
  const sorted = list.filter((i) => i.from && i.to && ms(i.to) > ms(i.from)).sort((a, b) => ms(a.from) - ms(b.from));
  const out = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && ms(i.from) <= ms(last.to)) {
      if (ms(i.to) > ms(last.to)) last.to = i.to;
      last.open = last.open || i.open;
    } else out.push({ ...i });
  }
  return out;
}

export const totalSec = (merged) => merged.reduce((a, i) => a + Math.round((ms(i.to) - ms(i.from)) / 1000), 0);

// Suggested status for one student
export function suggestStatus({ merged, scheduledMin, classStartRef, leave, rules }) {
  const attendedMin = totalSec(merged) / 60;
  const percent = scheduledMin ? Math.min(100, Math.round((attendedMin / scheduledMin) * 100)) : 0;
  const joined = merged.length > 0;
  const met = joined && percent >= rules.minPercent;
  const late = joined && ms(merged[0].from) > ms(classStartRef) + rules.graceMin * 60000;
  let status;
  if (met) status = late ? "late" : "present";
  else if (leave?.status === "approved") status = "leave";
  else if (joined) status = "absent";
  else status = "uninformed";
  return { status, percent, attendedMin: Math.round(attendedMin), late };
}

// Approved / pending / rejected leave for a class, by student
export async function leavesForMeeting(meetingId) {
  const list = listData(await db.collection(C.leaveRequests).where("meetingId", "==", meetingId).get()).filter((l) => l.status !== "cancelled");
  // the latest request per student wins
  const by = {};
  for (const l of list.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))) by[l.studentId] = l;
  return by;
}

// Build the (draft) rows for a class from the live data
export async function computeRows(m, { rules, saved } = {}) {
  rules ||= await getRules();
  const roomRef = db.collection(C.liveRooms).doc(m.id);
  const [room, peopleQs, leaves, users] = await Promise.all([
    roomRef.get().then((s) => (s.exists ? s.data() : null)),
    roomRef.collection("people").get(),
    leavesForMeeting(m.id),
    getMany(db, C.users, m.studentIds || []),
  ]);
  const people = Object.fromEntries(listData(peopleQs).map((p) => [p.id, p]));
  // Lateness is measured from when the class could really start: the scheduled
  // start, or later if the teacher opened the class late
  const classStartRef = room?.startedAt && room.startedAt > m.startAt ? room.startedAt : m.startAt;
  const savedRows = Object.fromEntries((saved?.rows || []).map((r) => [r.studentId, r]));
  const rows = (m.studentIds || []).map((sid) => {
    const p = people[sid];
    const raw = intervalsOf(p);
    const merged = mergeIntervals(raw);
    const leave = leaves[sid] || null;
    const s = suggestStatus({ merged, scheduledMin: m.durationMin, classStartRef, leave, rules });
    const prev = savedRows[sid];
    return {
      studentId: sid,
      name: users[sid]?.name || p?.name || "Student",
      intervals: merged.map(({ from, to, open }) => ({ from, to, ...(open ? { open: true } : {}) })),
      interruptions: Math.max(0, merged.length - 1),
      firstJoinedAt: merged[0]?.from || null,
      lastLeftAt: merged.length ? merged[merged.length - 1].to : null,
      attendedMin: s.attendedMin,
      percent: s.percent,
      suggested: s.status,
      status: prev?.status || s.status,
      overridden: prev ? prev.status !== s.status : false,
      ...Object.fromEntries(Object.keys(ROW_FIELDS).map((k) => [k, prev?.[k] || ""])),
      leave: leave ? { id: leave.id, status: leave.status, reason: leave.reason || "" } : null,
    };
  });
  return { rows, room, classStartRef };
}

export function formBase(m, teacherName) {
  return {
    meetingId: m.id,
    title: m.title,
    subject: m.subject || "",
    teacherId: m.teacherId,
    teacherName: teacherName || "",
    startAt: m.startAt,
    endAt: m.endAt,
    date: localDateOf(m.startAt),
    day: dayName(m.startAt),
    scheduledMin: m.durationMin,
  };
}

// Is a class finished enough to fill in its form?
export const isFormDue = (m, room) => !m.isDemo && m.status !== "cancelled" && !!m.hadLiveClass && (room?.status === "ended" || ms(m.endAt) < Date.now());

// Totals for a list of attendance rows (one row = one student in one class)
export function summarize(rows) {
  const n = (st) => rows.filter((r) => r.status === st).length;
  const attended = rows.filter((r) => ATTENDED.has(r.status)).length;
  return {
    conducted: rows.length,
    attended,
    present: n("present"),
    late: n("late"),
    absent: n("absent"),
    leave: n("leave"),
    uninformed: n("uninformed"),
    minutes: rows.reduce((a, r) => a + (r.attendedMin || 0), 0),
    percent: rows.length ? Math.round((attended / rows.length) * 100) : null,
  };
}

// Flatten submitted forms into one row per student per class, with a running
// class number per (student, subject, session)
export function flattenForms(forms, { studentId } = {}) {
  const out = [];
  for (const f of forms) {
    for (const r of f.rows || []) {
      if (studentId && r.studentId !== studentId) continue;
      out.push({
        id: `${f.meetingId}_${r.studentId}`,
        meetingId: f.meetingId,
        title: f.title,
        subject: f.subject,
        sessionId: r.sessionId || f.sessionId || null,
        teacherId: f.teacherId,
        teacherName: f.teacherName,
        date: f.date,
        day: f.day,
        startAt: f.startAt,
        scheduledMin: f.scheduledMin,
        studentId: r.studentId,
        studentName: r.name,
        status: r.status,
        suggested: r.suggested,
        overridden: !!r.overridden,
        attendedMin: r.attendedMin,
        percent: r.percent,
        intervals: r.intervals || [],
        interruptions: r.interruptions || 0,
        remarks: r.remarks || "",
        quizTopic: r.quizTopic || "",
        quizResult: r.quizResult || "",
        testTopic: r.testTopic || "",
        testResult: r.testResult || "",
        lessonTaken: f.lessonTaken || "",
        homework: f.homework || "",
        compensationFor: f.compensationFor || "",
        formRemarks: f.remarks || "",
        corrected: !!f.correctedAt,
      });
    }
  }
  out.sort((a, b) => (a.startAt < b.startAt ? -1 : 1));
  const counters = {};
  for (const r of out) {
    const k = `${r.studentId}|${r.subject}|${r.sessionId || ""}`;
    r.classNo = counters[k] = (counters[k] || 0) + 1;
  }
  return out.reverse();
}

export async function submittedForms() {
  return listData(await db.collection(C.classAttendance).where("status", "==", "submitted").get());
}
