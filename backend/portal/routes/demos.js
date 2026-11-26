// ============================================================================
// DEMO CLASSES
//  • The website's "Book a demo" form is saved here (saveDemoRequest) as well as
//    emailed. Spam: hidden honeypot field, per-IP limit, repeat requests merged.
//  • Admins (permission "demos") schedule the demo with a teacher. That makes a
//    meeting marked isDemo (no students, no session, no attendance, no teacher
//    payment, NEVER recorded) and a private guest link.
//  • Guest link: /portal/demo/{token}. The visitor types a name and gets a
//    temporary sign-in (Firebase custom token, uid guest_{demoId}) that only
//    opens THIS class (middleware.js) and only around its time. They wait in the
//    lobby until the teacher lets them in. No account is created.
//  • The teacher sees only the first name, grade and board – never the email or
//    phone – and can leave feedback. "Convert to student" creates a normal
//    account (admin form, prefilled) and marks the request converted.
// demoRequests/{id}: name, email, phone, grade, board, city, state, country,
//   status (new|scheduled|completed|no_show|cancelled|converted), notes,
//   teacherId, subject, startAt, endAt, meetingId, guestToken, guestName,
//   feedback, studentId, history[]
// ============================================================================
import crypto from "crypto";
import { Router } from "express";
import config from "../config.js";
import { db, C, auth } from "../firebase.js";
import { ah, fail, nowIso, str, toIso, addDays, addMinutes, listData, getMany, toCsv, localDateOf, isEmail, clientIp } from "../util.js";
import { requireRole, requirePerm } from "../middleware.js";
import { audit, getUser } from "../services/core.js";
import { notify, notifyAdmins } from "../services/notify.js";
import { trySendMail } from "../../mailer.js";
import { assertNoClash } from "./meetings.js";

export const DEMO_STATUSES = ["new", "scheduled", "completed", "no_show", "cancelled", "converted"];
const OPEN_EARLY_MIN = 15; // same window as every class (routes/live.js)
const OPEN_LATE_MIN = 60;
const ref = (id) => db.collection(C.demoRequests).doc(id);
const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "Student";
const newToken = () => crypto.randomBytes(24).toString("base64url");
export const guestLink = (token) => `${config.portalUrl}/portal/demo/${token}`;
const fmt = (iso) => new Date(iso).toLocaleString("en-IN", { timeZone: config.timezone, dateStyle: "medium", timeStyle: "short" });
const push = (d, entry) => [...(d.history || []), { at: nowIso(), ...entry }].slice(-100);

// ---- Website form -----------------------------------------------------------------
const recent = new Map(); // ip → request times (last hour)
const LIMIT_PER_HOUR = 5;

/**
 * Save a demo request from the website. Returns { id } – or { spam | limited }
 * (the website still answers "received" but sends no emails), or { duplicate, id }.
 */
export async function saveDemoRequest(body = {}, ip = "") {
  if (str(body.website, 200)) return { spam: true }; // hidden field only bots fill in
  const now = Date.now();
  const times = (recent.get(ip) || []).filter((t) => now - t < 3600000);
  if (times.length >= LIMIT_PER_HOUR) return { limited: true };
  recent.set(ip, [...times, now]);
  if (recent.size > 5000) recent.clear();

  const d = {
    name: str(body.name, 80),
    email: str(body.email, 120).toLowerCase(),
    phone: str(body.mobile ?? body.phone, 30),
    grade: str(body.class_grade ?? body.grade, 40),
    board: str(body.board, 40),
    city: str(body.city, 60),
    state: str(body.state, 60),
    country: str(body.country, 60),
  };
  if (!d.name || !(isEmail(d.email) || d.phone)) return { invalid: true };

  // The same person again within a week → one request, marked "asked again"
  const since = addDays(new Date(), -7).toISOString();
  const open = (x) => ["new", "scheduled"].includes(x.status) && x.createdAt >= since;
  const same = [
    ...(d.email ? listData(await db.collection(C.demoRequests).where("email", "==", d.email).get()) : []),
    ...(d.phone ? listData(await db.collection(C.demoRequests).where("phone", "==", d.phone).get()) : []),
  ].find(open);
  if (same) {
    await ref(same.id).update({ resubmittedAt: nowIso(), resubmitCount: (same.resubmitCount || 0) + 1, history: push(same, { action: "requested_again" }) });
    return { duplicate: true, id: same.id };
  }

  const doc = { ...d, status: "new", source: "website", notes: "", createdAt: nowIso(), updatedAt: nowIso(), history: [{ at: nowIso(), action: "requested" }] };
  const r = await db.collection(C.demoRequests).add(doc);
  await notifyAdmins(
    { type: "demo_request", title: `New demo request: ${d.name}`, body: [d.grade, d.board, d.city].filter(Boolean).join(" · "), link: `/portal/admin/demos?d=${r.id}`, refId: r.id },
    "demos"
  ).catch(() => {});
  return { id: r.id };
}

// ---- Shapes --------------------------------------------------------------------------
function adminShape(d, names = {}) {
  return {
    id: d.id,
    name: d.name,
    email: d.email,
    phone: d.phone,
    grade: d.grade,
    board: d.board,
    city: d.city,
    state: d.state,
    country: d.country,
    status: d.status,
    notes: d.notes || "",
    createdAt: d.createdAt,
    resubmitCount: d.resubmitCount || 0,
    teacherId: d.teacherId || null,
    teacherName: d.teacherId ? names[d.teacherId] || d.teacherName || "Teacher" : null,
    subject: d.subject || "",
    startAt: d.startAt || null,
    endAt: d.endAt || null,
    durationMin: d.durationMin || null,
    meetingId: d.meetingId || null,
    link: d.guestToken && ["scheduled"].includes(d.status) ? guestLink(d.guestToken) : null,
    guestName: d.guestName || null,
    guestJoinedAt: d.guestJoinedAt || null,
    heldAt: d.heldAt || null,
    feedback: d.feedback || null,
    studentId: d.studentId || null,
    linkEmailedAt: d.linkEmailedAt || null,
  };
}

// Teachers never see contact details
const teacherShape = (d) => ({
  id: d.id,
  firstName: firstName(d.name),
  grade: d.grade,
  board: d.board,
  subject: d.subject || "",
  startAt: d.startAt,
  endAt: d.endAt,
  durationMin: d.durationMin,
  status: d.status,
  meetingId: d.meetingId,
  guestName: d.guestName || null,
  heldAt: d.heldAt || null,
  feedback: d.feedback || null,
});

async function load(id) {
  const snap = await ref(id).get();
  if (!snap.exists) fail(404, "Demo request not found");
  return { id: snap.id, ...snap.data() };
}

async function cancelMeeting(d, by) {
  if (!d.meetingId) return;
  await db.collection(C.meetings).doc(d.meetingId).update({ status: "cancelled", cancelledAt: nowIso(), cancelledBy: by, cancelledReason: "Demo cancelled" }).catch(() => {});
}

// ============================================================================
const router = Router();
const dAdmin = [requireRole("admin"), requirePerm("demos")];

router.get(
  "/admin/demos",
  ...dAdmin,
  ah(async (req, res) => {
    let list = listData(await db.collection(C.demoRequests).get());
    const counts = Object.fromEntries(DEMO_STATUSES.map((s) => [s, list.filter((d) => d.status === s).length]));
    if (req.query.status) list = list.filter((d) => d.status === req.query.status);
    const q = str(req.query.q, 80).toLowerCase();
    if (q) list = list.filter((d) => [d.name, d.email, d.phone, d.city, d.grade, d.board].join(" ").toLowerCase().includes(q));
    list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const names = Object.fromEntries(Object.values(await getMany(db, C.users, list.map((d) => d.teacherId))).map((u) => [u.id, u.name]));
    if (req.query.format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="demo-requests-${localDateOf(new Date())}.csv"`);
      return res.send(
        toCsv(list.map((d) => adminShape(d, names)), [
          { label: "Requested", key: "createdAt" },
          { label: "Name", key: "name" },
          { label: "Email", key: "email" },
          { label: "Phone", key: "phone" },
          { label: "Grade", key: "grade" },
          { label: "Board", key: "board" },
          { label: "City", key: "city" },
          { label: "State", key: "state" },
          { label: "Country", key: "country" },
          { label: "Status", key: "status" },
          { label: "Teacher", key: "teacherName" },
          { label: "Subject", key: "subject" },
          { label: "Demo at", key: "startAt" },
          { label: "Teacher feedback", value: (d) => d.feedback?.text || "" },
          { label: "Notes", key: "notes" },
        ])
      );
    }
    res.json({ demos: list.map((d) => adminShape(d, names)), counts });
  })
);

router.get(
  "/admin/demos/:id",
  ...dAdmin,
  ah(async (req, res) => {
    const d = await load(req.params.id);
    const names = d.teacherId ? { [d.teacherId]: (await getUser(d.teacherId))?.name } : {};
    res.json({ demo: adminShape(d, names), history: [...(d.history || [])].reverse() });
  })
);

// Status / notes. Cancelling also cancels the class and switches the guest link off.
router.patch(
  "/admin/demos/:id",
  ...dAdmin,
  ah(async (req, res) => {
    const d = await load(req.params.id);
    const update = { updatedAt: nowIso() };
    const entry = {};
    if (req.body.notes !== undefined) update.notes = str(req.body.notes, 2000);
    if (req.body.status !== undefined) {
      const s = String(req.body.status);
      if (!["new", "completed", "no_show", "cancelled"].includes(s)) fail(400, "Choose a valid status");
      if (s !== d.status) {
        update.status = s;
        entry.action = `status_${s}`;
        if (s === "cancelled" || s === "new") {
          await cancelMeeting(d, req.user.id);
          Object.assign(update, { guestToken: null, ...(s === "new" ? { meetingId: null, startAt: null, endAt: null } : {}) });
        }
      }
    }
    await ref(d.id).update({ ...update, ...(entry.action ? { history: push(d, { ...entry, by: req.user.id, byName: req.user.name }) } : {}) });
    if (entry.action) await audit(req, "demo.status", { targetType: "demoRequest", targetId: d.id, summary: `Demo request of ${d.name}: ${update.status}` });
    res.json({ ok: true });
  })
);

// Schedule (or reschedule) with a teacher → a demo class + a guest link
router.post(
  "/admin/demos/:id/schedule",
  ...dAdmin,
  ah(async (req, res) => {
    const d = await load(req.params.id);
    if (["converted", "cancelled"].includes(d.status)) fail(400, "This request is closed – set it back to New first");
    const teacher = await getUser(str(req.body.teacherId, 60));
    if (!teacher || teacher.role !== "teacher" || teacher.deletedAt || teacher.active === false) fail(400, "Choose an active teacher");
    const subject = str(req.body.subject, 80);
    if (!subject) fail(400, "Add the subject of the demo");
    const startAt = toIso(req.body.startAt);
    if (!startAt || startAt < addMinutes(new Date(), -5).toISOString()) fail(400, "Choose a date and time in the future");
    const durationMin = Math.min(120, Math.max(15, Math.round(Number(req.body.durationMin) || 30)));
    const endAt = addMinutes(startAt, durationMin).toISOString();
    const existing = d.meetingId ? (await db.collection(C.meetings).doc(d.meetingId).get()).data() : null;
    const keep = existing && existing.status !== "cancelled" ? d.meetingId : null;
    await assertNoClash(teacher.id, startAt, endAt, keep || undefined);

    const meeting = {
      title: `Demo class – ${firstName(d.name)}`,
      subject,
      notes: [d.grade, d.board].filter(Boolean).join(" · "),
      teacherId: teacher.id,
      studentIds: [],
      startAt,
      endAt,
      durationMin,
      status: "scheduled",
      isDemo: true,
      demoId: d.id,
      demoInfo: { firstName: firstName(d.name), grade: d.grade, board: d.board },
      updatedAt: nowIso(),
    };
    let meetingId = keep;
    if (keep) {
      if (existing.teacherId !== teacher.id) await notify([existing.teacherId], { type: "class_cancelled", title: "Demo class moved", body: `The demo class on ${fmt(existing.startAt)} was given to another teacher.`, link: "/portal/teacher/demos", refId: d.id });
      await db.collection(C.meetings).doc(keep).update(meeting);
    } else {
      const m = await db.collection(C.meetings).add({ ...meeting, createdBy: req.user.id, createdByRole: "admin", createdAt: nowIso() });
      meetingId = m.id;
    }
    const guestToken = d.guestToken || newToken();
    const rescheduled = d.status === "scheduled";
    await ref(d.id).update({
      status: "scheduled",
      teacherId: teacher.id,
      teacherName: teacher.name,
      subject,
      startAt,
      endAt,
      durationMin,
      meetingId,
      guestToken,
      updatedAt: nowIso(),
      history: push(d, { action: rescheduled ? "rescheduled" : "scheduled", by: req.user.id, byName: req.user.name, teacherName: teacher.name, startAt }),
    });
    await notify([teacher.id], {
      type: "class_scheduled",
      title: rescheduled ? "Demo class rescheduled" : "New demo class",
      body: `${subject} demo with ${firstName(d.name)}${d.grade ? ` (${d.grade})` : ""} on ${fmt(startAt)}.`,
      link: "/portal/teacher/demos",
      refId: d.id,
    });
    await audit(req, "demo.schedule", { targetType: "demoRequest", targetId: d.id, summary: `Scheduled the demo of ${d.name} with ${teacher.name} on ${fmt(startAt)}` });
    res.json({ ok: true, meetingId, link: guestLink(guestToken) });
  })
);

// Copy / email the guest link; { regenerate: true } switches the old link off
router.post(
  "/admin/demos/:id/link",
  ...dAdmin,
  ah(async (req, res) => {
    const d = await load(req.params.id);
    if (d.status !== "scheduled" || !d.meetingId) fail(400, "Schedule the demo first");
    const guestToken = req.body?.regenerate || !d.guestToken ? newToken() : d.guestToken;
    const update = { guestToken, updatedAt: nowIso() };
    let email = null;
    if (req.body?.email) {
      if (!isEmail(d.email)) fail(400, "This request has no email address");
      email = await trySendMail({
        from: config.mailFrom,
        to: d.email,
        subject: "Your Silora Academy demo class",
        html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:20px">
          <h2 style="color:#0b2545">Your demo class is booked</h2>
          <p>Dear ${firstName(d.name).replace(/[<>&]/g, "")},</p>
          <p>Your <b>${String(d.subject).replace(/[<>&]/g, "")}</b> demo class is on <b>${fmt(d.startAt)}</b> (${d.durationMin} minutes).</p>
          <p>Open this link a few minutes before the class. You only need to type your name – no account or app is needed:</p>
          <p><a href="${guestLink(guestToken)}" style="display:inline-block;background:#f5b800;color:#0b2545;padding:12px 20px;border-radius:24px;text-decoration:none;font-weight:bold">Join the demo class</a></p>
          <p style="color:#555;font-size:13px">The link opens ${OPEN_EARLY_MIN} minutes before the class. Your teacher will let you in. The demo class is not recorded.</p>
        </div>`,
      });
      if (email?.status === "sent") update.linkEmailedAt = nowIso();
    }
    await ref(d.id).update({ ...update, ...(guestToken !== d.guestToken || email ? { history: push(d, { action: email ? "link_emailed" : "link_renewed", by: req.user.id, byName: req.user.name }) } : {}) });
    res.json({ link: guestLink(guestToken), email });
  })
);

// After the admin created the student account from this request
router.post(
  "/admin/demos/:id/converted",
  ...dAdmin,
  ah(async (req, res) => {
    const d = await load(req.params.id);
    const student = await getUser(str(req.body.studentId, 60));
    if (!student || student.role !== "student") fail(400, "Student account not found");
    await ref(d.id).update({ status: "converted", studentId: student.id, guestToken: null, updatedAt: nowIso(), history: push(d, { action: "converted", by: req.user.id, byName: req.user.name, studentId: student.id }) });
    await audit(req, "demo.convert", { targetType: "demoRequest", targetId: d.id, summary: `Converted the demo request of ${d.name} to a student account` });
    res.json({ ok: true });
  })
);

// ---- Teacher --------------------------------------------------------------------------
router.get(
  "/teacher/demos",
  requireRole("teacher"),
  ah(async (req, res) => {
    const list = listData(await db.collection(C.demoRequests).where("teacherId", "==", req.user.id).get()).filter((d) => d.meetingId && d.status !== "new");
    list.sort((a, b) => (a.startAt < b.startAt ? 1 : -1));
    res.json({ demos: list.map(teacherShape) });
  })
);

router.post(
  "/teacher/demos/:id/feedback",
  requireRole("teacher"),
  ah(async (req, res) => {
    const d = await load(req.params.id);
    if (d.teacherId !== req.user.id) fail(404, "Demo request not found");
    if (!d.heldAt && (!d.startAt || d.startAt > nowIso())) fail(400, "You can add feedback once the demo has started");
    const text = str(req.body.text, 2000);
    if (!text) fail(400, "Write a short feedback");
    const feedback = { text, level: str(req.body.level, 40), at: nowIso(), byName: req.user.name };
    await ref(d.id).update({ feedback, updatedAt: nowIso(), history: push(d, { action: "feedback", byName: req.user.name }) });
    await notifyAdmins({ type: "demo_feedback", title: `Demo feedback: ${d.name}`, body: text.slice(0, 140), link: `/portal/admin/demos?d=${d.id}`, refId: d.id }, "demos").catch(() => {});
    res.json({ ok: true });
  })
);

export default router;

// ============================================================================
// GUEST LINK (public – no sign-in yet)
// ============================================================================
export const guestRouter = Router();
const joins = new Map(); // ip → attempts (10 min)

async function byToken(token) {
  const t = str(token, 80);
  if (t.length < 20) fail(404, "This link isn't valid", "invalid_link");
  const qs = await db.collection(C.demoRequests).where("guestToken", "==", t).limit(1).get();
  if (qs.empty) fail(404, "This link isn't valid any more. Ask Silora Academy for a new one.", "invalid_link");
  const d = { id: qs.docs[0].id, ...qs.docs[0].data() };
  if (d.status !== "scheduled" || !d.meetingId) fail(404, "This demo class isn't scheduled any more", "invalid_link");
  const m = (await db.collection(C.meetings).doc(d.meetingId).get()).data();
  if (!m || m.status === "cancelled") fail(404, "This demo class was cancelled", "invalid_link");
  return { d, m };
}

const windowState = (m) => {
  const now = Date.now();
  if (now < new Date(m.startAt).getTime() - OPEN_EARLY_MIN * 60000) return "too_early";
  if (now > new Date(m.endAt).getTime() + OPEN_LATE_MIN * 60000) return "finished";
  return "open";
};

guestRouter.get(
  "/guest/:token",
  ah(async (req, res) => {
    const { d, m } = await byToken(req.params.token);
    const teacher = await getUser(m.teacherId);
    res.json({
      demo: { subject: m.subject, teacherName: firstName(teacher?.name), startAt: m.startAt, endAt: m.endAt, durationMin: m.durationMin, opensAt: addMinutes(m.startAt, -OPEN_EARLY_MIN).toISOString(), state: windowState(m), guestName: d.guestName || "" },
    });
  })
);

guestRouter.post(
  "/guest/:token/join",
  ah(async (req, res) => {
    const ip = clientIp(req);
    const now = Date.now();
    const tries = (joins.get(ip) || []).filter((t) => now - t < 600000);
    if (tries.length >= 20) fail(429, "Too many attempts. Please wait a few minutes.");
    joins.set(ip, [...tries, now]);
    if (joins.size > 5000) joins.clear();

    const { d, m } = await byToken(req.params.token);
    const state = windowState(m);
    if (state === "too_early") fail(400, `The class opens ${OPEN_EARLY_MIN} minutes before it starts`, "too_early");
    if (state === "finished") fail(400, "This demo class has finished", "finished");
    const name = str(req.body?.name, 60).replace(/[<>]/g, "");
    if (name.length < 2) fail(400, "Type your name");
    const uid = `guest_${d.id}`;
    const customToken = await auth.createCustomToken(uid, { guest: true, demoId: d.id, meetingId: d.meetingId });
    await ref(d.id).update({ guestName: name, guestJoinedAt: d.guestJoinedAt || nowIso(), guestLastJoinAt: nowIso(), ...(d.guestName ? {} : { history: push(d, { action: "guest_opened", guestName: name }) }) });
    res.json({ customToken, meetingId: d.meetingId });
  })
);

/** For middleware.js: the signed-in guest, or an error if the link / class is over. */
export async function guestUser(decoded) {
  const snap = await ref(decoded.demoId).get();
  const d = snap.exists ? snap.data() : null;
  if (!d || d.status !== "scheduled" || d.meetingId !== decoded.meetingId || !d.guestToken) fail(401, "This demo link has ended", "session_expired");
  const m = (await db.collection(C.meetings).doc(d.meetingId).get()).data();
  if (!m || m.status === "cancelled" || windowState(m) === "finished") fail(401, "This demo class has finished", "session_expired");
  return { id: decoded.uid, role: "guest", guest: true, name: d.guestName || "Guest", demoId: decoded.demoId, meetingId: d.meetingId, active: true };
}
