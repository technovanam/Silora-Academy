// ============================================================================
// TEACHER PAYMENT RECORDS – the portal never pays anyone.
// The academy pays teachers outside the portal; here an admin records the
// amount actually paid, uploads the proof and clicks "Mark as paid".
//
// teacherPayments/{sessionId}_{teacherId} – one per session, i.e. per student +
// subject ("Mathematics – Session 8" of one student)
//   scheduledClasses – the classes planned in the session
//   conductedClasses – the session's classes that were held (matched automatically)
//                      (live class started, not cancelled – same rule as attendance)
//   status: pending  – classes still to hold
//           due      – all scheduled classes held, payment not recorded yet
//           paid     – admin entered the amount + proof
//   notifications[], history[]
// Recalculated when a class is held, when a session changes, and hourly.
// ============================================================================
import { db, C } from "../firebase.js";
import { listData, nowIso, getMany } from "../util.js";
import { notify, notifyAdmins } from "./notify.js";
import { meetingsOfSession, sessionsForMeeting, inSession } from "./sessions.js";

export const tpId = (sessionId, teacherId) => `${sessionId}_${teacherId}`;
const held = (m) => m.status !== "cancelled" && !!m.hadLiveClass;

export async function recomputeSession(sessionId) {
  const sSnap = await db.collection(C.sessions).doc(sessionId).get();
  if (!sSnap.exists) return;
  const s = { id: sSnap.id, ...sSnap.data() };
  if (!s.studentId) return;
  if (s.status === "draft" || s.status === "archived") {
    // An archived session (or one put back to draft) no longer owes anything: close its unpaid records
    const at = new Date().toISOString();
    for (const p of listData(await db.collection(C.teacherPayments).where("sessionId", "==", s.id).get())) {
      if (!p.removed && p.status !== "paid") await db.collection(C.teacherPayments).doc(p.id).update({ removed: true, updatedAt: at, history: [...(p.history || []), { at, action: s.status === "archived" ? "session_archived" : "session_draft" }] });
    }
    return;
  }
  const meetings = await meetingsOfSession(s);
  const existing = Object.fromEntries(listData(await db.collection(C.teacherPayments).where("sessionId", "==", s.id).get()).map((p) => [p.teacherId, p]));
  const teacherIds = [...new Set((s.subjects || []).map((x) => x.teacherId))];
  const users = await getMany(db, C.users, teacherIds);
  const at = nowIso();

  for (const tid of teacherIds) {
    const subjects = (s.subjects || []).filter((x) => x.teacherId === tid);
    const scheduled = subjects.reduce((a, x) => a + (x.classes || 0), 0);
    const mine = meetings.filter((m) => m.teacherId === tid);
    const conducted = mine.filter(held).length;
    const studentIds = [s.studentId];
    const before = existing[tid];
    const status = before?.status === "paid" ? "paid" : scheduled && conducted >= scheduled ? "due" : "pending";
    const base = {
      sessionId: s.id,
      sessionName: s.name,
      studentName: s.studentName || "",
      studentCode: s.studentCode || "",
      subject: s.subject || "",
      sessionNumber: s.number || null,
      sessionStartDate: s.startDate,
      sessionEndDate: s.endDate,
      teacherId: tid,
      teacherName: users[tid]?.name || before?.teacherName || "Teacher",
      subjects: subjects.map((x) => ({ subject: x.subject, classes: x.classes })),
      studentIds,
      scheduledClasses: scheduled,
      conductedClasses: conducted,
      status,
      removed: false,
      updatedAt: at,
    };
    const ref = db.collection(C.teacherPayments).doc(tpId(s.id, tid));
    if (!before) {
      await ref.set({ ...base, createdAt: at, notifications: [], history: [{ at, action: "created", conducted, scheduled }] });
    } else {
      const changed = ["status", "conductedClasses", "scheduledClasses", "sessionName", "teacherName", "removed"].some((k) => before[k] !== base[k]) || JSON.stringify(before.studentIds) !== JSON.stringify(studentIds);
      if (!changed) continue;
      const history = [...(before.history || [])];
      if (before.status !== status) history.push({ at, action: `status_${status}`, from: before.status, conducted, scheduled });
      await ref.update({ ...base, history: history.slice(-100) });
    }
    // All classes held → notify the admins once ("all classes completed" + "payment due")
    if (status === "due" && !before?.dueNotifiedAt) {
      await notifyAdmins(
        {
          type: "teacher_payment_due",
          title: `Teacher payment due: ${base.teacherName}`,
          body: `${base.teacherName} has completed all ${scheduled} classes of ${s.name} for ${s.studentName || "the student"}. The payment is now due.`,
          link: `/portal/admin/teacher-payments?pay=${tpId(s.id, tid)}`,
          refId: tpId(s.id, tid),
        },
        "teacherPayments"
      );
      const now = nowIso();
      const fresh = (await ref.get()).data();
      await ref.update({
        dueNotifiedAt: now,
        dueAt: fresh.dueAt || now,
        notifications: [...(fresh.notifications || []), { at: now, type: "classes_completed", to: "admins" }, { at: now, type: "payment_due", to: "admins" }].slice(-50),
      });
    }
  }
  // A teacher taken off the session (and not paid) no longer has a record that counts
  for (const [tid, p] of Object.entries(existing)) {
    if (!teacherIds.includes(tid) && !p.removed && p.status !== "paid") await db.collection(C.teacherPayments).doc(p.id).update({ removed: true, updatedAt: at, history: [...(p.history || []), { at, action: "removed_from_session" }] });
  }
}

// A class changed (held, cancelled, moved…): recalculate the sessions it counts towards
export async function recomputeForMeeting(m, before) {
  try {
    const ids = new Set();
    for (const x of [m, before].filter(Boolean)) for (const s of Object.values(await sessionsForMeeting(x))) ids.add(s.id);
    for (const id of ids) await recomputeSession(id);
  } catch (e) {
    console.error("teacher payments", e.message);
  }
}
export { inSession };

export async function recomputeAll() {
  const sessions = listData(await db.collection(C.sessions).get()).filter((s) => ["active", "completed"].includes(s.status));
  for (const s of sessions) await recomputeSession(s.id);
  return sessions.length;
}

export async function notifyTeacherPaid(p) {
  await notify([p.teacherId], {
    type: "teacher_payment_paid",
    title: "Payment marked as paid",
    body: `The academy recorded your payment for ${p.sessionName}${p.studentName ? ` (${p.studentName})` : ""}${p.amount ? ` – ₹${Number(p.amount).toLocaleString("en-IN")}` : ""}.`,
    link: "/portal/teacher/payments",
    refId: tpId(p.sessionId, p.teacherId),
  });
}
