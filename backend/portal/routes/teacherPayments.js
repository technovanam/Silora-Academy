// ============================================================================
// TEACHER PAYMENTS – records only (no gateway, nothing is paid by the portal)
//  • Admin (permission "teacherPayments"): sees every teacher's session record
//    (scheduled vs held classes, students), enters the amount actually paid,
//    uploads the payment proof and clicks "Mark as paid". A paid record can be
//    corrected later with a reason (history keeps the original).
//  • Teacher: sees only their own records, amounts and proof.
// See services/teacherPayments.js for how records are kept up to date.
// ============================================================================
import { Router } from "express";
import { meetingsOfSession } from "../services/sessions.js";
import multer from "multer";
import { db, C } from "../firebase.js";
import { ah, fail, nowIso, str, listData, getMany, toCsv, localDateOf } from "../util.js";
import { requireRole, requirePerm } from "../middleware.js";
import { audit } from "../services/core.js";
import { storeUpload, fileLink, MATERIAL_TYPES } from "../services/files.js";
import { recomputeAll, notifyTeacherPaid } from "../services/teacherPayments.js";

const router = Router();
const PROOF_TYPES = Object.fromEntries(["pdf", "png", "jpg", "jpeg", "webp", "gif"].map((k) => [k, MATERIAL_TYPES[k]]));
const MAX_PROOF_MB = 10;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_PROOF_MB * 1024 * 1024, files: 1 } });
const link = (f, download) => (f ? fileLink({ path: f.path, fileName: f.fileName, contentType: f.contentType, download }) : null);
const proofOut = (f) => (f ? { fileName: f.fileName, kind: f.kind, size: f.size, contentType: f.contentType, url: link(f), downloadUrl: link(f, true) } : null);

function shape(p, { admin } = {}) {
  return {
    id: p.id,
    sessionId: p.sessionId,
    sessionName: p.sessionName,
    studentName: p.studentName || "",
    studentCode: p.studentCode || "",
    subject: p.subject || p.subjects?.[0]?.subject || "",
    sessionNumber: p.sessionNumber || null,
    sessionStartDate: p.sessionStartDate,
    sessionEndDate: p.sessionEndDate,
    teacherId: p.teacherId,
    teacherName: p.teacherName,
    subjects: p.subjects || [],
    studentCount: (p.studentIds || []).length,
    scheduledClasses: p.scheduledClasses,
    conductedClasses: p.conductedClasses,
    status: p.status,
    dueAt: p.dueAt || null,
    amount: p.amount ?? null,
    paidOn: p.paidOn || null,
    reference: p.reference || "",
    note: p.note || "",
    paidAt: p.paidAt || null,
    paidEarly: !!p.paidEarly,
    proof: proofOut(p.proof),
    ...(admin ? { paidByName: p.paidByName || null, history: [...(p.history || [])].reverse(), notifications: [...(p.notifications || [])].reverse() } : { history: (p.history || []).filter((h) => ["status_due", "paid", "corrected"].includes(h.action)).map((h) => ({ at: h.at, action: h.action })).reverse() }),
  };
}

function cleanPayment(body, { requireAmount }) {
  const raw = String(body.amount ?? "").replace(/[,\s₹]/g, "");
  const amount = raw === "" ? null : Number(raw);
  if (requireAmount && !(amount > 0)) fail(400, "Enter the amount paid to the teacher");
  if (amount !== null && !(amount > 0 && amount < 10000000)) fail(400, "Enter a valid amount");
  const paidOn = /^\d{4}-\d{2}-\d{2}$/.test(body.paidOn || "") ? body.paidOn : null;
  return { amount: amount === null ? null : Math.round(amount * 100) / 100, paidOn, reference: str(body.reference, 120), note: str(body.note, 1000) };
}

// ============================================================================
// ADMIN
// ============================================================================
const tpAdmin = [requireRole("admin"), requirePerm("teacherPayments")];

router.get(
  "/admin/teacher-payments",
  ...tpAdmin,
  ah(async (req, res) => {
    await recomputeAll(); // keep classes-held counts fresh
    let list = listData(await db.collection(C.teacherPayments).get()).filter((p) => !p.removed);
    const sessions = await getMany(db, C.sessions, list.map((p) => p.sessionId));
    list = list.filter((p) => sessions[p.sessionId] && (req.query.all || sessions[p.sessionId].status !== "archived"));
    if (req.query.sessionId) list = list.filter((p) => p.sessionId === req.query.sessionId);
    if (req.query.teacherId) list = list.filter((p) => p.teacherId === req.query.teacherId);
    const counts = { pending: list.filter((p) => p.status === "pending").length, due: list.filter((p) => p.status === "due").length, paid: list.filter((p) => p.status === "paid").length };
    if (req.query.status) list = list.filter((p) => p.status === req.query.status);
    const rank = { due: 0, pending: 1, paid: 2 };
    list.sort((a, b) => rank[a.status] - rank[b.status] || (b.sessionStartDate || "").localeCompare(a.sessionStartDate || "") || a.teacherName.localeCompare(b.teacherName));
    if (req.query.format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="teacher-payments-${localDateOf(new Date())}.csv"`);
      return res.send(
        toCsv(list, [
          { label: "Session", key: "sessionName" },
          { label: "Teacher", key: "teacherName" },
          { label: "Subjects", value: (p) => (p.subjects || []).map((x) => x.subject) },
          { label: "Scheduled classes", key: "scheduledClasses" },
          { label: "Classes held", key: "conductedClasses" },
          { label: "Status", key: "status" },
          { label: "Amount paid", key: "amount" },
          { label: "Paid on", key: "paidOn" },
          { label: "Reference", key: "reference" },
          { label: "Recorded by", key: "paidByName" },
          { label: "Recorded at", key: "paidAt" },
        ])
      );
    }
    const teachers = [...new Map(list.map((p) => [p.teacherId, { id: p.teacherId, name: p.teacherName }])).values()];
    res.json({
      payments: list.map((p) => shape(p, { admin: true })),
      counts,
      sessions: Object.values(sessions).map((s) => ({ id: s.id, name: s.studentName ? `${s.studentName} – ${s.name}` : s.name, status: s.status })),
      teachers,
    });
  })
);

router.get(
  "/admin/teacher-payments/:id",
  ...tpAdmin,
  ah(async (req, res) => {
    const snap = await db.collection(C.teacherPayments).doc(req.params.id).get();
    if (!snap.exists) fail(404, "Payment record not found");
    const p = { id: snap.id, ...snap.data() };
    const sSnap = await db.collection(C.sessions).doc(p.sessionId).get();
    const meetings = sSnap.exists && sSnap.data().studentId ? await meetingsOfSession({ id: sSnap.id, ...sSnap.data() }) : [];
    const students = await getMany(db, C.users, p.studentIds || []);
    res.json({
      payment: shape(p, { admin: true }),
      students: (p.studentIds || []).map((id) => ({ id, name: students[id]?.name || "Student" })).sort((a, b) => a.name.localeCompare(b.name)),
      classes: meetings
        .sort((a, b) => (a.startAt < b.startAt ? -1 : 1))
        .map((m) => ({ id: m.id, title: m.title, subject: m.subject || "", startAt: m.startAt, status: m.status, held: m.status !== "cancelled" && !!m.hadLiveClass, studentCount: (m.studentIds || []).length })),
    });
  })
);

router.post(
  "/admin/teacher-payments/:id/pay",
  ...tpAdmin,
  upload.single("file"),
  ah(async (req, res) => {
    const ref = db.collection(C.teacherPayments).doc(req.params.id);
    const p = (await ref.get()).data();
    if (!p || p.removed) fail(404, "Payment record not found");
    if (p.status === "paid") fail(409, "This payment is already marked as paid – use Correct to change it");
    if (p.status === "pending" && req.body.confirmEarly !== "1") fail(400, `Only ${p.conductedClasses} of ${p.scheduledClasses} classes have been held. Confirm to mark it as paid before completion.`, "confirm_early");
    const data = cleanPayment(req.body, { requireAmount: true });
    if (!req.file) fail(400, "Upload the payment screenshot or transaction receipt");
    const proof = await storeUpload(`payments/teachers/${p.sessionId}/${p.teacherId}/${Date.now()}-${req.file.originalname}`.replace(/[^\w./-]+/g, "_"), req.file, PROOF_TYPES, MAX_PROOF_MB);
    const at = nowIso();
    const doc = { ...data, paidOn: data.paidOn || localDateOf(new Date()), proof, status: "paid", paidAt: at, paidBy: req.user.id, paidByName: req.user.name, paidEarly: p.status === "pending", updatedAt: at };
    await ref.update({
      ...doc,
      notifications: [...(p.notifications || []), { at, type: "paid", to: "teacher" }].slice(-50),
      history: [...(p.history || []), { at, by: req.user.id, byName: req.user.name, action: "paid", amount: data.amount, ...(doc.paidEarly ? { early: true } : {}) }].slice(-100),
    });
    await audit(req, "teacher_payment.paid", { targetType: "teacherPayment", targetId: req.params.id, summary: `Marked ${p.teacherName}'s payment for "${p.sessionName}" as paid (₹${data.amount})${doc.paidEarly ? " before all classes were held" : ""}`, meta: { amount: data.amount, reference: data.reference } });
    await notifyTeacherPaid({ ...p, ...doc });
    res.json({ ok: true });
  })
);

// Correct a paid record (new amount / proof / details) – reason required, history keeps the old values
router.post(
  "/admin/teacher-payments/:id/correct",
  ...tpAdmin,
  upload.single("file"),
  ah(async (req, res) => {
    const ref = db.collection(C.teacherPayments).doc(req.params.id);
    const p = (await ref.get()).data();
    if (!p) fail(404, "Payment record not found");
    if (p.status !== "paid") fail(400, "Only a paid record can be corrected");
    const reason = str(req.body.reason, 500);
    if (!reason) fail(400, "Add a reason for the correction");
    const data = cleanPayment(req.body, { requireAmount: false });
    const at = nowIso();
    const update = { updatedAt: at };
    if (data.amount !== null) update.amount = data.amount;
    if (data.paidOn) update.paidOn = data.paidOn;
    if ("reference" in req.body) update.reference = data.reference;
    if ("note" in req.body) update.note = data.note;
    if (req.file) update.proof = await storeUpload(`payments/teachers/${p.sessionId}/${p.teacherId}/${Date.now()}-${req.file.originalname}`.replace(/[^\w./-]+/g, "_"), req.file, PROOF_TYPES, MAX_PROOF_MB);
    const before = { amount: p.amount, paidOn: p.paidOn, reference: p.reference, proof: p.proof?.fileName };
    await ref.update({ ...update, history: [...(p.history || []), { at, by: req.user.id, byName: req.user.name, action: "corrected", reason, before }].slice(-100) });
    await audit(req, "teacher_payment.correct", { targetType: "teacherPayment", targetId: req.params.id, summary: `Corrected ${p.teacherName}'s payment record for "${p.sessionName}"`, meta: { reason, before, after: { amount: update.amount, paidOn: update.paidOn, reference: update.reference, proof: update.proof?.fileName } } });
    res.json({ ok: true });
  })
);

// ============================================================================
// TEACHER – own records only
// ============================================================================
router.get(
  "/teacher/payments",
  requireRole("teacher"),
  ah(async (req, res) => {
    const list = listData(await db.collection(C.teacherPayments).where("teacherId", "==", req.user.id).get()).filter((p) => !p.removed);
    list.sort((a, b) => (b.sessionStartDate || "").localeCompare(a.sessionStartDate || ""));
    res.json({ payments: list.map((p) => shape(p)) });
  })
);

export default router;
