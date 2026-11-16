// ============================================================================
// ADMIN – STUDENTS, TEACHERS, ADMINS, CREDENTIALS, ASSIGNMENT, PERMISSIONS
// ============================================================================
import { Router } from "express";
import config from "../config.js";
import { auth, db, C } from "../firebase.js";
import { ah, fail, nowIso, isEmail, str, tempPassword, listData, addDays, weekStartOf, shiftWeek } from "../util.js";
import { requirePerm, requireSuperAdmin } from "../middleware.js";
import { adminView, audit, getUser, hasPerm, ADMIN_PERMISSIONS, usersByRole } from "../services/core.js";
import { notify } from "../services/notify.js";
import { strongPassword } from "./auth.js";
import { deleteConversationsOf } from "./messages.js";
import { mailConfigured, trySendMail } from "../../mailer.js";

const router = Router();
const ROLES = ["student", "teacher", "admin"];

const cleanList = (v, max = 20) =>
  (Array.isArray(v) ? v : String(v || "").split(","))
    .map((s) => str(s, 60))
    .filter(Boolean)
    .slice(0, max);

function profileFields(body, role) {
  const out = { name: str(body.name, 120) };
  if (role === "student") {
    out.grade = str(body.grade, 40);
    out.board = str(body.board, 60);
    out.subjects = cleanList(body.subjects);
  }
  if (role === "teacher") out.subjects = cleanList(body.subjects);
  return out;
}
function contactFields(body) {
  return {
    email: str(body.email, 200).toLowerCase(),
    phone: str(body.phone, 40),
    parentName: str(body.parentName, 120),
    parentPhone: str(body.parentPhone, 40),
    address: str(body.address, 300),
  };
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ROLE_LABEL = { student: "Student", teacher: "Teacher", admin: "Admin" };

function credentialsHtml({ name, role, email, password, reset }) {
  const loginUrl = `${config.portalUrl}/portal/login`;
  const intro = reset
    ? "Your Silora Academy portal password has been reset by the academy. Use the details below to sign in."
    : `Welcome to Silora Academy! Your <b>${esc(ROLE_LABEL[role] || "portal")}</b> account on the learning portal is ready. Use the details below to sign in.`;
  return `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px">
  <tr><td style="background:#0a2d4a;border-radius:16px 16px 0 0;padding:18px 24px;color:#ffffff;font-weight:bold;font-size:16px">Silora Academy Portal</td></tr>
  <tr><td style="padding:24px">
    <h2 style="margin:0 0 8px;font-size:20px;color:#0a2d4a">Hi ${esc(name)},</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#475569">${intro}</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fdf6e3;border:1px solid #f3e3b0;border-radius:12px;margin:0 0 20px">
      <tr><td style="padding:14px 18px;font-size:14px;color:#475569">User ID (email)<br><b style="font-size:16px;color:#0a2d4a">${esc(email)}</b></td></tr>
      <tr><td style="padding:0 18px 14px;font-size:14px;color:#475569">Password<br><b style="font-size:16px;color:#0a2d4a;font-family:Consolas,Menlo,monospace">${esc(password)}</b></td></tr>
    </table>
    <a href="${loginUrl}" style="display:inline-block;background:#e8b112;color:#0a2d4a;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:999px">Sign in to the portal</a>
    <p style="margin:20px 0 0;font-size:13px;line-height:1.6;color:#64748b">For your security, please change this password from <b>My profile</b> after you sign in. Never share it with anyone.</p>
  </td></tr>
  <tr><td style="padding:16px 24px;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8">If you weren't expecting this email, please contact Silora Academy.</td></tr>
  </table></td></tr></table></body></html>`;
}

// Emails the sign-in email + password. Returns { status: "sent" | "skipped" | "failed", error? }
async function sendCredentials(user, email, password, { reset = false } = {}) {
  if (!email) return { status: "skipped", error: "No email address on file" };
  const subject = reset ? "Your Silora Academy portal password was reset" : "Your Silora Academy portal login details";
  if (!mailConfigured()) {
    if (config.useEmulators) console.log(`✉️  [dev – email not sent, SMTP not configured] To: ${email} | ${subject} | password: ${password}`);
    return { status: "skipped", error: "Email isn't configured on the server (SMTP settings missing)" };
  }
  return trySendMail({ from: config.mailFrom, to: email, subject, html: credentialsHtml({ name: user.name, role: user.role, email, password, reset }) });
}

// ---- List ---------------------------------------------------------------------
router.get(
  "/users",
  requirePerm("users"),
  ah(async (req, res) => {
    const role = ROLES.includes(req.query.role) ? req.query.role : null;
    const qs = role ? await db.collection(C.users).where("role", "==", role).get() : await db.collection(C.users).get();
    let users = listData(qs).filter((u) => !u.purged);
    const status = req.query.status;
    if (status === "deleted") users = users.filter((u) => u.deletedAt);
    else {
      users = users.filter((u) => !u.deletedAt);
      if (status === "active") users = users.filter((u) => u.active);
      if (status === "inactive") users = users.filter((u) => !u.active);
    }

    const shaped = await adminView(users, req.user);
    // Helpful joins: teacher name for students, student count for teachers
    const all = listData(await db.collection(C.users).get());
    const names = Object.fromEntries(all.map((u) => [u.id, u.name]));
    const counts = {};
    all.forEach((u) => u.role === "student" && u.teacherId && !u.deletedAt && (counts[u.teacherId] = (counts[u.teacherId] || 0) + 1));
    const q = str(req.query.q, 100).toLowerCase();
    const out = shaped
      .map((u) => ({ ...u, teacherName: u.teacherId ? names[u.teacherId] || "—" : null, studentCount: u.role === "teacher" ? counts[u.id] || 0 : undefined }))
      .filter((u) => !q || [u.name, u.grade, u.board, u.teacherName, u.contact?.email, u.contact?.phone].join(" ").toLowerCase().includes(q))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    res.json({ users: out, canViewContacts: hasPerm(req.user, "contacts") });
  })
);

// Light list for pickers (teachers to assign, students of a teacher)
router.get(
  "/directory",
  ah(async (req, res) => {
    const [teachers, students] = await Promise.all([usersByRole("teacher"), usersByRole("student")]);
    const slim = (u) => ({ id: u.id, name: u.name, role: u.role, active: u.active && !u.deletedAt, teacherId: u.teacherId || null, grade: u.grade, board: u.board, subjects: u.subjects || [] });
    res.json({ teachers: teachers.filter((t) => !t.deletedAt).map(slim), students: students.filter((s) => !s.deletedAt).map(slim) });
  })
);

// ---- Detail ---------------------------------------------------------------------
router.get(
  "/users/:id",
  requirePerm("users"),
  ah(async (req, res) => {
    const u = await getUser(req.params.id);
    if (!u || u.purged) fail(404, "User not found");
    const view = await adminView(u, req.user);
    const extra = {};
    if (u.role === "student") {
      const t = u.teacherId ? await getUser(u.teacherId) : null;
      extra.teacher = t ? { id: t.id, name: t.name } : null;
      const meetings = listData(await db.collection(C.meetings).where("studentIds", "array-contains", u.id).get());
      extra.upcomingClasses = meetings.filter((m) => m.status === "scheduled" && m.startAt > nowIso()).length;
      extra.totalClasses = meetings.filter((m) => m.status !== "cancelled").length;
      const att = listData(await db.collection(C.attendance).where("studentId", "==", u.id).get());
      extra.attendanceSubmitted = att.length;
    }
    if (u.role === "teacher") {
      const students = listData(await db.collection(C.users).where("teacherId", "==", u.id).get()).filter((s) => s.role === "student" && !s.deletedAt);
      extra.students = students.map((s) => ({ id: s.id, name: s.name, grade: s.grade, board: s.board, active: s.active }));
    }
    const logins = listData(await db.collection(C.loginEvents).where("uid", "==", u.id).get())
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, 15);
    res.json({ user: { ...view, ...extra }, logins });
  })
);

// ---- Create ---------------------------------------------------------------------
router.post(
  "/users",
  requirePerm("users"),
  ah(async (req, res) => {
    const role = req.body.role;
    if (!ROLES.includes(role)) fail(400, "Choose a role");
    if (role === "admin" && !req.user.superAdmin) fail(403, "Only a super admin can create admin accounts");
    const profile = profileFields(req.body, role);
    const contact = contactFields(req.body);
    if (!profile.name) fail(400, "Name is required");
    if (!isEmail(contact.email)) fail(400, "A valid email is required (it's the sign-in ID)");
    let password = String(req.body.password || "");
    const generated = !password;
    if (generated) password = tempPassword();
    else if (!strongPassword(password)) fail(400, "Password must be at least 8 characters with a letter and a number");

    let teacherId = null;
    if (role === "student") {
      teacherId = str(req.body.teacherId, 60) || null;
      if (teacherId) {
        const t = await getUser(teacherId);
        if (!t || t.role !== "teacher" || t.deletedAt) fail(400, "Selected teacher not found");
      }
    }

    let authUser;
    try {
      authUser = await auth.createUser({ email: contact.email, password, displayName: profile.name });
    } catch (e) {
      if (e.code === "auth/email-already-exists") fail(409, "An account with this email already exists");
      throw e;
    }
    const at = nowIso();
    const doc = {
      role,
      ...profile,
      teacherId: role === "student" ? teacherId : undefined,
      active: true,
      createdAt: at,
      createdBy: req.user.id,
      notifyEmail: true,
      notifyPush: true,
      failedAttempts: 0,
      mustChangePassword: true,
    };
    if (role === "admin") {
      doc.superAdmin = !!req.body.superAdmin;
      doc.permissions = Object.fromEntries(Object.keys(ADMIN_PERMISSIONS).map((k) => [k, !!req.body.permissions?.[k]]));
    }
    await db.collection(C.users).doc(authUser.uid).set(doc);
    await db.collection(C.contacts).doc(authUser.uid).set({ ...contact, updatedAt: at });

    await audit(req, "user.create", { targetType: role, targetId: authUser.uid, summary: `Created ${role} account for ${profile.name}` });
    if (teacherId) await audit(req, "user.assign_teacher", { targetType: "student", targetId: authUser.uid, summary: `Assigned ${profile.name} to a teacher`, meta: { teacherId } });

    // Email the login details unless the admin explicitly opted out
    const email = req.body.sendCredentials === false ? { status: "off" } : await sendCredentials(doc, contact.email, password);
    if (email.status === "sent") await audit(req, "user.credentials_emailed", { targetType: role, targetId: authUser.uid, summary: `Emailed login details to ${profile.name}` });
    res.status(201).json({ id: authUser.uid, tempPassword: generated ? password : undefined, email });
  })
);

// ---- Update -----------------------------------------------------------------------
router.patch(
  "/users/:id",
  requirePerm("users"),
  ah(async (req, res) => {
    const u = await getUser(req.params.id);
    if (!u || u.purged) fail(404, "User not found");
    if (u.role === "admin" && !req.user.superAdmin) fail(403, "Only a super admin can edit admin accounts");
    const profile = profileFields({ ...u, ...req.body }, u.role);
    if (!profile.name) fail(400, "Name is required");
    await db.collection(C.users).doc(u.id).update({ ...profile, updatedAt: nowIso() });

    // Contact details can only be changed by admins who may see them
    if (hasPerm(req.user, "contacts") && ["email", "phone", "parentName", "parentPhone", "address"].some((k) => k in req.body)) {
      const prev = (await db.collection(C.contacts).doc(u.id).get()).data() || {};
      const contact = contactFields({ ...prev, ...req.body });
      if (!isEmail(contact.email)) fail(400, "A valid email is required");
      if (contact.email !== prev.email) {
        try {
          await auth.updateUser(u.id, { email: contact.email });
        } catch (e) {
          if (e.code === "auth/email-already-exists") fail(409, "Another account already uses this email");
          throw e;
        }
      }
      await db.collection(C.contacts).doc(u.id).set({ ...contact, updatedAt: nowIso() }, { merge: true });
    }
    await auth.updateUser(u.id, { displayName: profile.name }).catch(() => {});
    await audit(req, "user.update", { targetType: u.role, targetId: u.id, summary: `Updated ${u.role} ${profile.name}` });
    res.json({ ok: true });
  })
);

// ---- Activate / deactivate --------------------------------------------------------
router.post(
  "/users/:id/status",
  requirePerm("users"),
  ah(async (req, res) => {
    const u = await getUser(req.params.id);
    if (!u || u.purged) fail(404, "User not found");
    if (u.id === req.user.id) fail(400, "You can't deactivate your own account");
    if (u.role === "admin" && !req.user.superAdmin) fail(403, "Only a super admin can change admin accounts");
    const active = !!req.body.active;
    await db.collection(C.users).doc(u.id).update({ active, deletedAt: active ? null : u.deletedAt || null, statusChangedAt: nowIso() });
    await auth.updateUser(u.id, { disabled: !active });
    if (!active) await auth.revokeRefreshTokens(u.id);
    await audit(req, active ? "user.activate" : "user.deactivate", { targetType: u.role, targetId: u.id, summary: `${active ? "Activated" : "Deactivated"} ${u.name}` });
    res.json({ ok: true, active });
  })
);

// ---- Credentials ------------------------------------------------------------------
router.post(
  "/users/:id/reset-password",
  requirePerm("users"),
  ah(async (req, res) => {
    const u = await getUser(req.params.id);
    if (!u || u.purged) fail(404, "User not found");
    if (u.role === "admin" && !req.user.superAdmin) fail(403, "Only a super admin can reset admin passwords");
    let password = String(req.body.password || "");
    const generated = !password;
    if (generated) password = tempPassword();
    else if (!strongPassword(password)) fail(400, "Password must be at least 8 characters with a letter and a number");
    await auth.updateUser(u.id, { password });
    await auth.revokeRefreshTokens(u.id);
    await db.collection(C.users).doc(u.id).update({ failedAttempts: 0, lockedUntil: null, mustChangePassword: true });
    await audit(req, "user.reset_password", { targetType: u.role, targetId: u.id, summary: `Reset password for ${u.name}` });
    let email = { status: "off" };
    if (req.body.sendCredentials) {
      const contact = (await db.collection(C.contacts).doc(u.id).get()).data() || {};
      email = await sendCredentials(u, contact.email, password, { reset: true });
    }
    res.json({ ok: true, tempPassword: generated ? password : undefined, email });
  })
);

router.post(
  "/users/:id/unlock",
  requirePerm("users"),
  ah(async (req, res) => {
    const u = await getUser(req.params.id);
    if (!u) fail(404, "User not found");
    await db.collection(C.users).doc(u.id).update({ failedAttempts: 0, lockedUntil: null });
    await audit(req, "user.unlock", { targetType: u.role, targetId: u.id, summary: `Unlocked ${u.name}` });
    res.json({ ok: true });
  })
);

// ---- Student → teacher assignment ------------------------------------------------
router.post(
  "/users/:id/assign",
  requirePerm("users"),
  ah(async (req, res) => {
    const s = await getUser(req.params.id);
    if (!s || s.role !== "student") fail(404, "Student not found");
    const teacherId = str(req.body.teacherId, 60) || null;
    let t = null;
    if (teacherId) {
      t = await getUser(teacherId);
      if (!t || t.role !== "teacher" || t.deletedAt) fail(400, "Teacher not found");
    }
    await db.collection(C.users).doc(s.id).update({ teacherId, assignedAt: nowIso() });
    await audit(req, "user.assign_teacher", {
      targetType: "student",
      targetId: s.id,
      summary: t ? `Assigned ${s.name} to ${t.name}` : `Removed teacher from ${s.name}`,
      meta: { from: s.teacherId || null, to: teacherId },
    });
    if (t) {
      await notify([t.id], { type: "account", title: "New student assigned", body: `${s.name} has been assigned to you.`, link: "/portal/teacher/students" });
      await notify([s.id], { type: "account", title: "Your teacher", body: `${t.name} is now your teacher.`, link: "/portal/student" });
    }
    res.json({ ok: true });
  })
);

// ---- Admin permissions (super admin) -------------------------------------------
router.get(
  "/permissions",
  requirePerm("settings"),
  ah(async (req, res) => {
    const admins = await usersByRole("admin");
    res.json({
      catalog: ADMIN_PERMISSIONS,
      admins: admins.filter((a) => !a.deletedAt).map((a) => ({ id: a.id, name: a.name, active: a.active, superAdmin: !!a.superAdmin, permissions: a.permissions || {} })),
    });
  })
);

router.patch(
  "/users/:id/permissions",
  requireSuperAdmin,
  ah(async (req, res) => {
    const u = await getUser(req.params.id);
    if (!u || u.role !== "admin") fail(404, "Admin not found");
    if (u.id === req.user.id && req.body.superAdmin === false) fail(400, "You can't remove your own super admin access");
    const permissions = Object.fromEntries(Object.keys(ADMIN_PERMISSIONS).map((k) => [k, !!req.body.permissions?.[k]]));
    await db.collection(C.users).doc(u.id).update({ superAdmin: !!req.body.superAdmin, permissions });
    await audit(req, "user.permissions", { targetType: "admin", targetId: u.id, summary: `Changed permissions for ${u.name}`, meta: { superAdmin: !!req.body.superAdmin, permissions } });
    res.json({ ok: true });
  })
);

// ---- Delete (data retention) ------------------------------------------------------
export async function purgeUser(id) {
  await auth.deleteUser(id).catch(() => {});
  await db.collection(C.contacts).doc(id).delete().catch(() => {});
  const tokens = await db.collection(C.pushTokens).where("userId", "==", id).get();
  await Promise.all(tokens.docs.map((d) => d.ref.delete()));
  const notes = await db.collection(C.notes).where("studentId", "==", id).get();
  await Promise.all(notes.docs.map((d) => d.ref.delete()));
  await deleteConversationsOf(id).catch((e) => console.error("Couldn't delete conversations of", id, e.message));
  await db.collection(C.users).doc(id).set({ name: "Deleted user", purged: true, active: false, purgedAt: nowIso(), grade: null, board: null, subjects: [] }, { merge: true });
}

router.delete(
  "/users/:id",
  requirePerm("users"),
  ah(async (req, res) => {
    const u = await getUser(req.params.id);
    if (!u || u.purged) fail(404, "User not found");
    if (u.id === req.user.id) fail(400, "You can't delete your own account");
    if (u.role === "admin" && !req.user.superAdmin) fail(403, "Only a super admin can delete admin accounts");
    const purgeNow = req.query.purge === "1";
    if (purgeNow) {
      if (!req.user.superAdmin) fail(403, "Only a super admin can permanently delete immediately");
      await purgeUser(u.id);
      await audit(req, "user.purge", { targetType: u.role, targetId: u.id, summary: `Permanently deleted ${u.name}` });
      return res.json({ ok: true, purged: true });
    }
    const days = req.settings.retention.deletedAccountDays;
    await db.collection(C.users).doc(u.id).update({ active: false, deletedAt: nowIso(), purgeAfter: addDays(new Date(), days).toISOString() });
    await auth.updateUser(u.id, { disabled: true }).catch(() => {});
    await auth.revokeRefreshTokens(u.id).catch(() => {});
    await audit(req, "user.delete", { targetType: u.role, targetId: u.id, summary: `Deleted ${u.name} (personal data removed after ${days} days)` });
    res.json({ ok: true, purgeAfterDays: days });
  })
);

router.post(
  "/users/:id/restore",
  requirePerm("users"),
  ah(async (req, res) => {
    const u = await getUser(req.params.id);
    if (!u || u.purged) fail(404, "This account can't be restored");
    await db.collection(C.users).doc(u.id).update({ active: true, deletedAt: null, purgeAfter: null });
    await auth.updateUser(u.id, { disabled: false });
    await audit(req, "user.restore", { targetType: u.role, targetId: u.id, summary: `Restored ${u.name}` });
    res.json({ ok: true });
  })
);

// ---- Teacher workload ------------------------------------------------------------
router.get(
  "/workload",
  requirePerm("users"),
  ah(async (req, res) => {
    const teachers = (await usersByRole("teacher")).filter((t) => !t.deletedAt);
    const students = (await usersByRole("student")).filter((s) => !s.deletedAt);
    const from = new Date().toISOString();
    const to = addDays(new Date(), 30).toISOString();
    const meetings = listData(await db.collection(C.meetings).where("startAt", ">=", addDays(new Date(), -7).toISOString()).get()).filter((m) => m.status !== "cancelled");
    const wk = weekStartOf();
    const wkEnd = shiftWeek(wk, 1);
    const rows = teachers.map((t) => {
      const mine = meetings.filter((m) => m.teacherId === t.id);
      const thisWeek = mine.filter((m) => m.startAt.slice(0, 10) >= wk && m.startAt.slice(0, 10) < wkEnd);
      const upcoming = mine.filter((m) => m.startAt >= from && m.startAt <= to);
      return {
        id: t.id,
        name: t.name,
        active: t.active,
        subjects: t.subjects || [],
        students: students.filter((s) => s.teacherId === t.id).length,
        activeStudents: students.filter((s) => s.teacherId === t.id && s.active).length,
        classesThisWeek: thisWeek.length,
        hoursThisWeek: Math.round((thisWeek.reduce((a, m) => a + (m.durationMin || 60), 0) / 60) * 10) / 10,
        upcoming30Days: upcoming.length,
        groupClasses: upcoming.filter((m) => (m.studentIds || []).length > 1).length,
      };
    });
    res.json({ teachers: rows.sort((a, b) => b.students - a.students), unassigned: students.filter((s) => !s.teacherId).map((s) => ({ id: s.id, name: s.name })) });
  })
);

export default router;
