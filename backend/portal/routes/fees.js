// ============================================================================
// SESSION FEE PROOF – no payment gateway, no payment processing.
//  • Student: sees their sessions, pays the academy OUTSIDE the portal, uploads
//    a screenshot / receipt and clicks "I have paid – submit". Access to the
//    academic features opens as soon as the proof is submitted.
//  • Admin (permission "fees"): sees every submission, marks it
//    Received/Verified or Rejected (with a reason). Rejected → the student is
//    blocked again until they submit new proof.
//  • A session is one subject of one student, so every fee is for ONE SUBJECT
//    and the subject is named everywhere (pop-up, pages, notices, exports).
//  • Statuses are separate: submission, verification, notifications (see
//    services/fees.js). Every change is kept in history[].
// ============================================================================
import { Router } from "express";
import multer from "multer";
import { db, C } from "../firebase.js";
import { ah, fail, nowIso, str, listData, getMany, toCsv, localDateOf } from "../util.js";
import { requireRole, requirePerm } from "../middleware.js";
import { audit, logActivity, saveSettings, sameSubject } from "../services/core.js";
import { notify, notifyAdmins } from "../services/notify.js";
import { storeUpload, fileLink, MATERIAL_TYPES } from "../services/files.js";
import { payId, feeState, feeRestrictions, clearFeeCache, needsProof, DEFAULT_FEE_RESTRICTIONS } from "../services/fees.js";
import { loadSession } from "./sessions.js";
import { progressOf } from "../services/sessions.js";

const router = Router();
const PROOF_TYPES = Object.fromEntries(["pdf", "png", "jpg", "jpeg", "webp", "gif"].map((k) => [k, MATERIAL_TYPES[k]]));
const MAX_PROOF_MB = 10;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_PROOF_MB * 1024 * 1024, files: 1 } });

const link = (f, download) => (f ? fileLink({ path: f.path, fileName: f.fileName, contentType: f.contentType, download }) : null);
const shapeSubmission = (s) => ({ at: s.at, reference: s.reference || "", paidOn: s.paidOn || "", note: s.note || "", file: { fileName: s.file.fileName, kind: s.file.kind, size: s.file.size, contentType: s.file.contentType }, url: link(s.file), downloadUrl: link(s.file, true) });

// One label for lists: what the admin / student should see
export function feeLabel(p, sessionActive = true) {
  if (!p || p.submission !== "submitted") return sessionActive ? "pending" : "not_submitted";
  if (p.verification === "verified") return "verified";
  if (p.verification === "rejected") return "rejected";
  return "submitted";
}

// ============================================================================
// STUDENT
// ============================================================================
router.get(
  "/fees/me",
  requireRole("student"),
  ah(async (req, res) => {
    const sessions = listData(await db.collection(C.sessions).where("studentIds", "array-contains", req.user.id).get()).filter((s) => ["active", "completed"].includes(s.status));
    const meetings = listData(await db.collection(C.meetings).where("studentIds", "array-contains", req.user.id).get());
    const pays = sessions.length ? await db.getAll(...sessions.map((s) => db.collection(C.feePayments).doc(payId(s.id, req.user.id)))) : [];
    const byId = Object.fromEntries(pays.filter((p) => p.exists).map((p) => [p.data().sessionId, p.data()]));
    const state = await feeState(req.user.id);
    sessions.sort((a, b) => (a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : (a.subject || "").localeCompare(b.subject || "")));
    res.json({
      restricted: state.restricted,
      blocking: state.blocking,
      lockedSubjects: state.subjects,
      restrictions: await feeRestrictions(),
      sessions: sessions.map((s) => {
        const p = byId[s.id];
        return {
          session: { id: s.id, name: s.name, subject: s.subject || "", number: s.number || null, teacherName: s.teacherName || "", startDate: s.startDate, endDate: s.endDate, status: s.status, totalClasses: s.totalClasses, paymentInstructions: s.paymentInstructions || "", progress: s.studentId ? progressOf(s, meetings) : null },
          status: feeLabel(p, s.status === "active"),
          needsProof: s.status === "active" && needsProof(p),
          submission: p?.submission || "not_submitted",
          verification: p?.verification || "unverified",
          rejectReason: p?.verification === "rejected" ? p.rejectReason || "" : "",
          verifiedAt: p?.verifiedAt || null,
          submissions: (p?.submissions || []).map(shapeSubmission).reverse(),
          history: (p?.history || []).filter((h) => ["submitted", "verified", "rejected", "created"].includes(h.action)).map((h) => ({ at: h.at, action: h.action, reason: h.reason || "" })).reverse(),
        };
      }),
    });
  })
);

router.post(
  "/fees/:sessionId/submit",
  requireRole("student"),
  upload.single("file"),
  ah(async (req, res) => {
    const s = await loadSession(req.params.sessionId);
    if (!(s.studentIds || []).includes(req.user.id) || !["active", "completed"].includes(s.status)) fail(404, "Session not found");
    if (!req.file) fail(400, "Attach the payment screenshot or receipt");
    const paidOn = /^\d{4}-\d{2}-\d{2}$/.test(req.body.paidOn || "") ? req.body.paidOn : "";
    if (paidOn && paidOn > localDateOf(nowIso())) fail(400, "The payment date can't be in the future");
    const ref = db.collection(C.feePayments).doc(payId(s.id, req.user.id));
    const snap = await ref.get();
    const p = snap.exists ? snap.data() : null;
    if (p && !needsProof(p)) fail(409, p.verification === "verified" ? "The academy has already verified this payment" : "You've already submitted payment details – the academy will check them");
    const at = nowIso();
    const file = await storeUpload(`payments/students/${s.id}/${req.user.id}/${Date.now()}-${req.file.originalname}`.replace(/[^\w./-]+/g, "_"), req.file, PROOF_TYPES, MAX_PROOF_MB);
    const submission = { at, file, reference: str(req.body.reference, 120), paidOn, note: str(req.body.note, 1000) };
    const base = p || { sessionId: s.id, sessionName: s.name, studentId: req.user.id, studentName: req.user.name, submissions: [], notifications: [], history: [], createdAt: at };
    await ref.set({
      ...base,
      sessionName: s.name,
      subject: s.subject || "",
      sessionNumber: s.number || null,
      teacherName: s.teacherName || "",
      studentCode: s.studentCode || "",
      startDate: s.startDate || "",
      endDate: s.endDate || "",
      studentName: req.user.name,
      submission: "submitted",
      verification: "unverified",
      rejectReason: "",
      submittedAt: at,
      updatedAt: at,
      submissions: [...(base.submissions || []), submission].slice(-20),
      notifications: [...(base.notifications || []), { at, type: "proof_submitted", to: "admins" }].slice(-50),
      history: [...(base.history || []), { at, by: req.user.id, byName: req.user.name, action: "submitted", ...(p?.verification === "rejected" ? { resubmitted: true } : {}) }].slice(-100),
    });
    clearFeeCache(req.user.id);
    await logActivity(req, "fee.submit", { targetType: "feePayment", targetId: ref.id, summary: `Submitted payment proof for ${s.name}` });
    await notifyAdmins({ type: "fee_proof_submitted", title: `Payment proof from ${req.user.name} – ${s.subject || s.name}`, body: `${s.name}${s.teacherName ? ` with ${s.teacherName}` : ""}${submission.reference ? ` · ref ${submission.reference}` : ""}. Please verify it.`, link: `/portal/admin/fees?pay=${ref.id}`, refId: ref.id }, "fees");
    res.status(201).json({ ok: true });
  })
);

// ============================================================================
// ADMIN (permission "fees")
// ============================================================================
const feesAdmin = [requireRole("admin"), requirePerm("fees")];

router.get(
  "/admin/fees",
  ...feesAdmin,
  ah(async (req, res) => {
    const sessions = listData(await db.collection(C.sessions).get()).filter((s) => s.status !== "draft" && (req.query.all || s.status !== "archived"));
    const sById = Object.fromEntries(sessions.map((s) => [s.id, s]));
    const pays = listData(await db.collection(C.feePayments).get());
    const pBy = Object.fromEntries(pays.map((p) => [p.id, p]));
    const users = await getMany(db, C.users, sessions.flatMap((s) => s.studentIds || []));
    const subjects = [...new Set(sessions.map((s) => s.subject).filter(Boolean))].sort();
    // One row per student per session (students with no record yet show as pending)
    let rows = [];
    for (const s of sessions) {
      if (req.query.sessionId && s.id !== req.query.sessionId) continue;
      if (req.query.subject && !sameSubject(s.subject, req.query.subject)) continue;
      for (const sid of s.studentIds || []) {
        const p = pBy[payId(s.id, sid)];
        const last = p?.submissions?.[p.submissions.length - 1];
        rows.push({
          id: payId(s.id, sid),
          sessionId: s.id,
          sessionName: s.name,
          sessionStatus: s.status,
          subject: s.subject || "",
          sessionNumber: s.number || null,
          teacherName: s.teacherName || "",
          startDate: s.startDate,
          endDate: s.endDate,
          studentId: sid,
          studentCode: users[sid]?.studentCode || "",
          studentName: users[sid]?.name || p?.studentName || "Student",
          grade: users[sid]?.grade || "",
          status: feeLabel(p, s.status === "active"),
          submission: p?.submission || "not_submitted",
          verification: p?.verification || "unverified",
          submittedAt: p?.submittedAt || null,
          verifiedAt: p?.verifiedAt || null,
          verifiedByName: p?.verifiedByName || null,
          rejectReason: p?.rejectReason || "",
          reference: last?.reference || "",
          paidOn: last?.paidOn || "",
          submissions: (p?.submissions || []).length,
          proof: last ? shapeSubmission(last) : null,
        });
      }
    }
    if (req.query.status) rows = rows.filter((r) => r.status === req.query.status);
    rows.sort((a, b) => (a.status === "submitted") !== (b.status === "submitted") ? (a.status === "submitted" ? -1 : 1) : (b.submittedAt || "").localeCompare(a.submittedAt || "") || a.studentName.localeCompare(b.studentName));
    if (req.query.format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="fee-payments-${localDateOf(new Date())}.csv"`);
      return res.send(
        toCsv(rows, [
          { label: "Student ID", key: "studentCode" },
          { label: "Student", key: "studentName" },
          { label: "Subject", key: "subject" },
          { label: "Session", key: "sessionName" },
          { label: "Teacher", key: "teacherName" },
          { label: "From", key: "startDate" },
          { label: "To", key: "endDate" },
          { label: "Grade", key: "grade" },
          { label: "Status", key: "status" },
          { label: "Proof submitted", key: "submission" },
          { label: "Verification", key: "verification" },
          { label: "Submitted at", key: "submittedAt" },
          { label: "Paid on (student)", key: "paidOn" },
          { label: "Reference", key: "reference" },
          { label: "Verified/rejected at", key: "verifiedAt" },
          { label: "By", key: "verifiedByName" },
          { label: "Reject reason", key: "rejectReason" },
        ])
      );
    }
    const count = (st) => rows.filter((r) => r.status === st).length;
    res.json({
      rows,
      counts: { submitted: count("submitted"), verified: count("verified"), rejected: count("rejected"), pending: count("pending") },
      sessions: sessions.map((s) => ({ id: s.id, name: s.studentName ? `${s.studentName} – ${s.name}` : s.name, status: s.status })),
      subjects,
    });
  })
);

router.get(
  "/admin/fees/:id",
  ...feesAdmin,
  ah(async (req, res) => {
    const snap = await db.collection(C.feePayments).doc(req.params.id).get();
    if (!snap.exists) fail(404, "No payment record yet – the student hasn't submitted anything");
    const p = snap.data();
    res.json({ payment: { id: snap.id, ...p, submissions: (p.submissions || []).map(shapeSubmission).reverse(), history: [...(p.history || [])].reverse(), notifications: [...(p.notifications || [])].reverse() } });
  })
);

router.post(
  "/admin/fees/:id/review",
  ...feesAdmin,
  ah(async (req, res) => {
    const ref = db.collection(C.feePayments).doc(req.params.id);
    const p = (await ref.get()).data();
    if (!p) fail(404, "Payment record not found");
    if (p.submission !== "submitted") fail(400, "The student hasn't submitted payment details yet");
    const decision = req.body.decision === "verify" ? "verified" : req.body.decision === "reject" ? "rejected" : null;
    if (!decision) fail(400, "Choose verify or reject");
    const reason = str(req.body.reason, 1000);
    if (decision === "rejected" && !reason) fail(400, "Tell the student why the payment details were rejected");
    if (p.verification === decision) return res.json({ ok: true });
    const at = nowIso();
    await ref.update({
      verification: decision,
      rejectReason: decision === "rejected" ? reason : "",
      verifiedAt: at,
      verifiedBy: req.user.id,
      verifiedByName: req.user.name,
      updatedAt: at,
      notifications: [...(p.notifications || []), { at, type: `fee_${decision}`, to: "student" }].slice(-50),
      history: [...(p.history || []), { at, by: req.user.id, byName: req.user.name, action: decision, ...(reason ? { reason } : {}) }].slice(-100),
    });
    clearFeeCache(p.studentId);
    await audit(req, `fee.${decision}`, { targetType: "feePayment", targetId: req.params.id, summary: `${decision === "verified" ? "Verified" : "Rejected"} payment proof from ${p.studentName} for ${p.sessionName}`, meta: { reason } });
    await notify([p.studentId], {
      type: `fee_${decision}`,
      title: decision === "verified" ? `Payment received – ${p.subject || p.sessionName}` : `Payment details not accepted – ${p.subject || p.sessionName}`,
      body: decision === "verified" ? `The academy confirmed your payment for ${p.sessionName}. Thank you!` : `${p.sessionName}: ${reason} Please submit your payment details for ${p.subject || "this session"} again.`,
      link: "/portal/student/fees",
      refId: req.params.id,
    });
    res.json({ ok: true });
  })
);

// ---- What's blocked while proof is missing (classes, timetable, attendance always) ------
router.get(
  "/admin/fees-settings",
  ...feesAdmin,
  ah(async (req, res) => res.json({ restrictions: await feeRestrictions(), defaults: DEFAULT_FEE_RESTRICTIONS }))
);
router.put(
  "/admin/fees-settings",
  ...feesAdmin,
  ah(async (req, res) => {
    const r = Object.fromEntries(Object.keys(DEFAULT_FEE_RESTRICTIONS).map((k) => [k, !!req.body?.[k]]));
    await saveSettings({ feeRestrictions: r });
    clearFeeCache();
    await audit(req, "fee.settings", { targetType: "settings", summary: `Fee restrictions: ${Object.entries(r).filter(([, v]) => v).map(([k]) => k).join(", ") || "only classes, timetable, attendance"}`, meta: r });
    res.json({ restrictions: r });
  })
);

export default router;
