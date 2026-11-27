// ============================================================================
// SESSION FEES – the portal NEVER takes or processes a payment.
// Students pay the academy outside the portal (GPay, bank transfer…), then
// upload a screenshot / receipt here. The portal only keeps that proof, the
// statuses and the notifications.
//
// feePayments/{sessionId}_{studentId}
//   submission:   not_submitted | submitted      (the student sent proof)
//   verification: unverified | verified | rejected (the admin checked it)
//   notifications: [{at, type, to}]               (every notice sent about it)
//   submissions[], history[]
//
// A session is one subject of one student, so fees are PER SUBJECT: once the
// Mathematics proof is submitted, Mathematics is never asked again.
// Access: while an ACTIVE session that has STARTED has no proof (or it was
// rejected), only THAT SUBJECT is locked by the backend (feeGate): its upcoming
// classes, timetable, and – per the admin's settings – materials, recordings,
// progress. A session that starts later doesn't lock anything yet. Past classes,
// attendance history and leave requests always stay open, as do other subjects,
// login, profile, messages, notifications and the fees page.
// ============================================================================
import { db, C } from "../firebase.js";
import { listData, nowIso, localDateOf } from "../util.js";
import { getSettings, sameSubject } from "./core.js";
import { notify } from "./notify.js";

export const payId = (sessionId, studentId) => `${sessionId}_${studentId}`;
export const DEFAULT_FEE_RESTRICTIONS = { materials: true, recordings: true, progress: true };

export async function feeRestrictions() {
  const s = await getSettings();
  return { ...DEFAULT_FEE_RESTRICTIONS, ...(s.feeRestrictions || {}) };
}

// Proof still needed? (never sent, or the admin rejected it)
export const needsProof = (p) => !p || p.submission !== "submitted" || p.verification === "rejected";

// ---- Per-student state (cached briefly; cleared on every change) -------------------
const cache = new Map();
const TTL = 15000;
export const clearFeeCache = (studentId) => (studentId ? cache.delete(studentId) : cache.clear());

export async function feeState(studentId) {
  const hit = cache.get(studentId);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const today = localDateOf(nowIso());
  // Only sessions already running can lock (one starting next month doesn't hide today's classes)
  const sessions = listData(await db.collection(C.sessions).where("studentIds", "array-contains", studentId).get()).filter((s) => s.status === "active" && (!s.startDate || s.startDate <= today));
  const pays = sessions.length ? await db.getAll(...sessions.map((s) => db.collection(C.feePayments).doc(payId(s.id, studentId)))) : [];
  const byId = Object.fromEntries(pays.filter((p) => p.exists).map((p) => [p.data().sessionId, p.data()]));
  const blocking = sessions
    .filter((s) => needsProof(byId[s.id]))
    .map((s) => ({
      sessionId: s.id,
      name: s.name,
      subject: s.subject || "",
      number: s.number || null,
      teacherName: s.teacherName || "",
      startDate: s.startDate,
      endDate: s.endDate,
      rejected: byId[s.id]?.verification === "rejected",
      rejectReason: byId[s.id]?.verification === "rejected" ? byId[s.id].rejectReason || "" : "",
    }));
  // An older batch session (no subject) still locks everything
  const all = blocking.some((b) => !b.subject);
  const value = { restricted: blocking.length > 0, blocking, all, subjects: [...new Set(blocking.map((b) => b.subject).filter(Boolean))] };
  cache.set(studentId, { at: Date.now(), value });
  return value;
}

// Which feature a student request belongs to (null = always allowed)
function featureOf(method, path) {
  if (/^\/meetings\/[^/]+\/live\/(leave|ping)$/.test(path)) return null; // let them leave a class cleanly
  if (path.startsWith("/meetings")) return "classes";
  if (path.startsWith("/timetable")) return "timetable";
  // Attendance history and leave requests are never locked
  if (path.startsWith("/materials")) return "materials";
  if (path.startsWith("/recordings")) return "recordings";
  if (path.startsWith("/lessons")) return "progress";
  return null;
}
const ALWAYS = new Set(["classes", "timetable"]);
// A class that has finished stays visible (its details, attendance) even when its subject is locked
const finished = (x) => !!x?.endAt && x.endAt <= nowIso();

// Is this subject locked for the student?
export const isLocked = (st, subject) => !!st?.restricted && (st.all || (!!subject && st.subjects.some((x) => sameSubject(x, subject))));

// Which subjects a feature hides for this student right now (null = nothing hidden)
export async function lockedFor(studentId, feature) {
  if (!ALWAYS.has(feature) && !(await feeRestrictions())[feature]) return null;
  const st = await feeState(studentId);
  return st.restricted ? st : null;
}

const ITEM = { meetings: C.meetings, materials: C.materials, recordings: C.recordings };
const lockedError = (st, subject) => {
  const b = st.blocking.filter((x) => st.all || sameSubject(x.subject, subject));
  const what = b.map((x) => x.name).join(", ");
  return { error: `Please submit your fee payment details for ${what} to use this.`, code: "fee_pending", blocking: b };
};

// Express middleware (after authenticate)
export async function feeGate(req, res, next) {
  try {
    if (req.user?.role !== "student") return next();
    const feature = featureOf(req.method, req.path);
    if (!feature) return next();
    const st = await lockedFor(req.user.id, feature);
    if (!st) return next();
    // One class / material / recording: blocked when its subject is locked
    const one = req.path.match(/^\/(meetings|materials|recordings)\/([^/]+)/);
    if (one && ITEM[one[1]]) {
      const snap = await db.collection(ITEM[one[1]]).doc(one[2]).get();
      const subject = snap.exists ? snap.data().subject || "" : "";
      if (isLocked(st, subject) && !(one[1] === "meetings" && finished(snap.data()))) return res.status(403).json(lockedError(st, subject));
      return next();
    }
    if (st.all) return res.status(403).json(lockedError(st, ""));
    // Lists: leave out what belongs to a locked subject
    const json = res.json.bind(res);
    res.json = (body) => {
      if (body && typeof body === "object" && res.statusCode < 400) {
        for (const [k, v] of Object.entries(body)) {
          if (Array.isArray(v)) body[k] = v.filter((x) => !(x && typeof x === "object" && isLocked(st, x.subject) && !(feature === "classes" && finished(x))));
        }
        body.feeLockedSubjects = st.subjects;
      }
      return json(body);
    };
    next();
  } catch (e) {
    next(e);
  }
}

export async function isFeeRestricted(studentId) {
  return (await feeState(studentId)).restricted;
}

// ---- Create payment records + send the "fee due" notice ----------------------------
export async function ensurePayments(session, studentIds) {
  if (session.status !== "active" || !studentIds?.length) return 0;
  const users = await db.getAll(...studentIds.map((id) => db.collection(C.users).doc(id)));
  const names = Object.fromEntries(users.filter((u) => u.exists).map((u) => [u.id, u.data().name]));
  let created = [];
  for (const sid of studentIds) {
    const ref = db.collection(C.feePayments).doc(payId(session.id, sid));
    const snap = await ref.get();
    const at = nowIso();
    if (snap.exists) {
      // Added back to the session after being removed
      if (snap.data().removed) await ref.update({ removed: false, updatedAt: at, history: [...(snap.data().history || []), { at, action: "added_to_session" }] });
      continue;
    }
    await ref.set({
      sessionId: session.id,
      sessionName: session.name,
      subject: session.subject || "",
      sessionNumber: session.number || null,
      teacherName: session.teacherName || "",
      studentCode: session.studentCode || "",
      startDate: session.startDate || "",
      endDate: session.endDate || "",
      studentId: sid,
      studentName: names[sid] || "Student",
      submission: "not_submitted",
      verification: "unverified",
      submissions: [],
      notifications: [{ at, type: "fee_due", to: "student" }],
      history: [{ at, action: "created" }],
      createdAt: at,
      updatedAt: at,
    });
    created.push(sid);
    clearFeeCache(sid);
  }
  if (created.length)
    await notify(created, {
      type: "fee_due",
      title: `Fee for ${session.name}`,
      body: `Your ${session.subject ? `${session.subject} ` : ""}session (${session.startDate} – ${session.endDate}${session.teacherName ? `, with ${session.teacherName}` : ""}) has started. Please pay the fee for ${session.subject || "it"} to the academy and submit your payment details in the portal.`,
      link: "/portal/student/fees",
      refId: session.id,
    });
  return created.length;
}
