// ============================================================================
// LIFECYCLE – keeps classes, sessions, fees and teacher payments consistent when
// a class is cancelled, a student changes teacher, or an account is deleted.
// ============================================================================
import config from "../config.js";
import { db, C } from "../firebase.js";
import { listData, nowIso, localDateOf, addDays } from "../util.js";
import { sameSubject } from "./core.js";
import { notify } from "./notify.js";
import { sessionTitle, meetingsOfSession, isHeld, nextNumber } from "./sessions.js";
import { ensurePayments, payId, clearFeeCache } from "./fees.js";
import { recomputeSession, recomputeForMeeting } from "./teacherPayments.js";

const fmt = (iso) => new Intl.DateTimeFormat("en-IN", { timeZone: config.timezone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const upcoming = (m) => m.status === "scheduled" && !m.isDemo && m.endAt > nowIso();

/** Leave requests of a class that no longer takes place are closed, so they leave the admin queue. */
export async function closeLeavesForMeeting(meetingId, note = "The class was cancelled") {
  const at = nowIso();
  const list = listData(await db.collection(C.leaveRequests).where("meetingId", "==", meetingId).get()).filter((l) => ["pending", "approved"].includes(l.status));
  for (const l of list) {
    await db.collection(C.leaveRequests).doc(l.id).update({ status: "cancelled", decisionNote: note, updatedAt: at, history: [...(l.history || []), { at, action: "cancelled", note }] });
  }
  return list.length;
}

/** Cancel a class without an admin request (system clean-up). */
export async function cancelClass(m, { by = null, reason = "", notifyIds } = {}) {
  await db.collection(C.meetings).doc(m.id).update({ status: "cancelled", cancelledReason: reason, cancelledAt: nowIso(), cancelledBy: by, pendingRequest: null });
  await closeLeavesForMeeting(m.id);
  await recomputeForMeeting(m).catch(() => {});
  const ids = (notifyIds || [...(m.studentIds || []), m.teacherId]).filter(Boolean);
  if (ids.length) await notify(ids, { type: "class_cancelled", title: `Class cancelled: ${m.title}`, body: `${fmt(m.startAt)}${reason ? ` – ${reason}` : ""}`, link: "/portal", refId: m.id }).catch(() => {});
}

/** Take a student out of upcoming classes (optionally only one teacher / subject). Classes left empty are cancelled. */
export async function removeFromUpcomingClasses(studentId, { teacherId, subject, by, reason }) {
  let removed = 0, cancelled = 0;
  const list = listData(await db.collection(C.meetings).where("studentIds", "array-contains", studentId).get()).filter(
    (m) => upcoming(m) && (!teacherId || m.teacherId === teacherId) && (!subject || sameSubject(m.subject, subject))
  );
  for (const m of list) {
    const rest = (m.studentIds || []).filter((id) => id !== studentId);
    if (!rest.length) {
      await cancelClass(m, { by, reason, notifyIds: [m.teacherId] });
      cancelled++;
    } else {
      await db.collection(C.meetings).doc(m.id).update({ studentIds: rest, updatedAt: nowIso() });
      await closeLeavesForMeeting(m.id, reason);
      removed++;
    }
  }
  return { removed, cancelled };
}

/** Take a student out of weekly timetable slots (optionally one teacher / subject); empty slots are deleted. */
async function removeFromTimetable(studentId, { teacherId, subject } = {}) {
  let n = 0;
  for (const e of listData(await db.collection(C.timetable).where("studentIds", "array-contains", studentId).get())) {
    if ((teacherId && e.teacherId !== teacherId) || (subject && !sameSubject(e.subject, subject))) continue;
    const rest = (e.studentIds || []).filter((id) => id !== studentId);
    if (rest.length) await db.collection(C.timetable).doc(e.id).update({ studentIds: rest, updatedAt: nowIso() });
    else await db.collection(C.timetable).doc(e.id).delete();
    n++;
  }
  return n;
}

/**
 * A student's subject moved from one teacher to another. Their upcoming classes with the old
 * teacher (that subject) are given up, and the open session follows the new teacher:
 *  • no class held yet → the session simply moves to the new teacher
 *  • some classes held → the old teacher's part is closed as completed (so they are paid for
 *    what they taught) and a new session with the new teacher takes the remaining classes; the
 *    student's fee proof carries over, so they are not asked to pay again.
 */
export async function onTeacherChanged(by, student, { subject, from, to, toName }) {
  const out = { classesUpdated: 0, classesCancelled: 0, sessionsMoved: 0, sessionsSplit: 0 };
  if (!from || from === to) return out;
  const reason = "Student moved to another teacher";
  const r = await removeFromUpcomingClasses(student.id, { teacherId: from, subject, by: by?.id, reason });
  out.classesUpdated = r.removed;
  out.classesCancelled = r.cancelled;
  await removeFromTimetable(student.id, { teacherId: from, subject });
  if (!to) return out;

  const today = localDateOf(nowIso());
  const at = nowIso();
  const open = listData(await db.collection(C.sessions).where("studentId", "==", student.id).get()).filter(
    (s) => ["active", "draft"].includes(s.status) && s.teacherId === from && (!subject || sameSubject(s.subject, subject)) && s.endDate >= today
  );
  for (const s of open) {
    const held = (await meetingsOfSession(s)).filter(isHeld).length;
    const hist = (action, extra = {}) => [...(s.history || []), { at, by: by?.id || null, byName: by?.name || "System", action, ...extra }];
    if (!held || s.startDate > today) {
      await db.collection(C.sessions).doc(s.id).update({ teacherId: to, teacherIds: [to], teacherName: toName, subjects: (s.subjects || []).map((x) => ({ ...x, teacherId: to })), updatedAt: at, history: hist("teacher_changed", { from, to }) });
      await db.collection(C.feePayments).doc(payId(s.id, student.id)).update({ teacherName: toName, updatedAt: at }).catch(() => {});
      await recomputeSession(s.id);
      out.sessionsMoved++;
      continue;
    }
    // Close the old teacher's part today…
    const remaining = Math.max(1, (s.plannedClasses || held) - held);
    await db.collection(C.sessions).doc(s.id).update({ endDate: today, plannedClasses: held, totalClasses: held, subjects: (s.subjects || []).map((x) => ({ ...x, classes: held })), status: "completed", updatedAt: at, history: hist("split_teacher_changed", { held, newTeacher: to }) });
    await recomputeSession(s.id);
    // …and continue with the new teacher from tomorrow
    const number = await nextNumber(student.id, s.subject);
    const startDate = localDateOf(addDays(new Date(), 1).toISOString());
    const ref = db.collection(C.sessions).doc();
    const doc = {
      studentId: student.id, studentIds: [student.id], studentName: s.studentName, studentCode: s.studentCode || "",
      subject: s.subject, teacherId: to, teacherIds: [to], teacherName: toName, number, name: sessionTitle({ subject: s.subject, number }),
      startDate, endDate: s.endDate < startDate ? startDate : s.endDate, plannedClasses: remaining, totalClasses: remaining, status: s.status,
      paymentInstructions: s.paymentInstructions || "", subjects: [{ subject: s.subject, teacherId: to, classes: remaining }],
      continuedFrom: s.id, createdAt: at, createdBy: by?.id || null, updatedAt: at,
      history: [{ at, by: by?.id || null, byName: by?.name || "System", action: "created", status: s.status, note: `Continues ${s.name} with a new teacher` }],
    };
    await ref.set(doc);
    // The fee proof for the original session covers the continuation
    const fee = (await db.collection(C.feePayments).doc(payId(s.id, student.id)).get()).data();
    if (fee && fee.submission === "submitted") {
      await db.collection(C.feePayments).doc(payId(ref.id, student.id)).set({
        ...fee, sessionId: ref.id, sessionName: doc.name, sessionNumber: number, teacherName: toName, startDate: doc.startDate, endDate: doc.endDate,
        carriedFrom: s.id, createdAt: at, updatedAt: at, history: [...(fee.history || []), { at, action: "carried_over", from: s.id }].slice(-100),
      });
    } else await ensurePayments({ id: ref.id, ...doc }, [student.id]);
    await recomputeSession(ref.id);
    out.sessionsSplit++;
  }
  clearFeeCache(student.id);
  return out;
}

/** An account was deleted: nothing should keep running for it. */
export async function onAccountDeleted(by, u) {
  const out = { classesUpdated: 0, classesCancelled: 0, sessionsArchived: 0, timetableSlots: 0 };
  const reason = u.role === "teacher" ? "The teacher is no longer with the academy" : "The student left the academy";
  if (u.role === "student") {
    const r = await removeFromUpcomingClasses(u.id, { by: by?.id, reason });
    out.classesUpdated = r.removed;
    out.classesCancelled = r.cancelled;
    out.timetableSlots = await removeFromTimetable(u.id);
    const at = nowIso();
    for (const s of listData(await db.collection(C.sessions).where("studentId", "==", u.id).get()).filter((x) => ["active", "draft"].includes(x.status))) {
      await db.collection(C.sessions).doc(s.id).update({ status: "archived", archivedBecause: "student_deleted", updatedAt: at, history: [...(s.history || []), { at, by: by?.id || null, byName: by?.name || "System", action: "archived", note: reason }] });
      await recomputeSession(s.id);
      out.sessionsArchived++;
    }
    clearFeeCache(u.id);
  }
  if (u.role === "teacher") {
    for (const m of listData(await db.collection(C.meetings).where("teacherId", "==", u.id).get()).filter(upcoming)) {
      await cancelClass(m, { by: by?.id, reason });
      out.classesCancelled++;
    }
  }
  return out;
}

/** Restoring a deleted student brings back the sessions that were archived only because of the deletion. */
export async function onAccountRestored(by, u) {
  if (u.role !== "student") return 0;
  const at = nowIso();
  let n = 0;
  for (const s of listData(await db.collection(C.sessions).where("studentId", "==", u.id).get()).filter((x) => x.status === "archived" && x.archivedBecause === "student_deleted")) {
    await db.collection(C.sessions).doc(s.id).update({ status: "active", archivedBecause: null, updatedAt: at, history: [...(s.history || []), { at, by: by?.id || null, byName: by?.name || "System", action: "restored" }] });
    await ensurePayments({ ...s, status: "active" }, [u.id]);
    await recomputeSession(s.id);
    n++;
  }
  clearFeeCache(u.id);
  return n;
}

/** Upcoming classes of a teacher (for the deactivation warning and alerts). */
export async function upcomingClassesOf(teacherId) {
  return listData(await db.collection(C.meetings).where("teacherId", "==", teacherId).get()).filter(upcoming);
}
