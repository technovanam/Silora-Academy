// ============================================================================
// AUTH + MY ACCOUNT
// Login goes through the API so we can count failed attempts, lock accounts,
// block deactivated users and keep a login history.
// ============================================================================
import { Router } from "express";
import config from "../config.js";
import { auth, db, C, FieldValue } from "../firebase.js";
import { ah, fail, nowIso, addMinutes, isEmail, str, clientIp, listData } from "../util.js";
import { authenticate, STUDENT_SESSION_DAYS } from "../middleware.js";
import { getSettings, getUser, publicProfile, logActivity, teacherIdsOf, subjectsTaughtBy } from "../services/core.js";
import { mailConfigured, trySendMail } from "../../mailer.js";

export const publicRouter = Router();
export const meRouter = Router();

// Revoke every session of a user and hand back a new sign-in for the current device.
// Firebase compares whole seconds, so wait past the revocation second before signing in again.
async function signOutEverywhere(uid, role) {
  await auth.revokeRefreshTokens(uid);
  await new Promise((r) => setTimeout(r, 1100));
  return auth.createCustomToken(uid, { role });
}

const PASSWORD_RULE = "Password must be at least 8 characters and include a letter and a number";
export const strongPassword = (p) => typeof p === "string" && p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);

function identityToolkitUrl(method) {
  const host = config.useEmulators
    ? `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com`
    : "https://identitytoolkit.googleapis.com";
  return `${host}/v1/accounts:${method}?key=${config.webApiKey}`;
}

async function passwordIsValid(email, password) {
  const res = await fetch(identityToolkitUrl("signInWithPassword"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: false }),
  });
  return res.ok;
}

async function logLogin(req, { uid, email, success, reason, role, name }) {
  await db.collection(C.loginEvents).add({
    at: nowIso(),
    uid: uid || null,
    name: name || null,
    role: role || null,
    email: email || null,
    success,
    reason: reason || null,
    ip: clientIp(req),
    userAgent: str(req.headers["user-agent"], 300),
  });
}

/** Find the login for an email, trying the aliased domain (e.g. .in → .com) if there's no exact match. */
async function findAuthUser(email) {
  try {
    return await auth.getUserByEmail(email);
  } catch (e) {
    if (e?.code !== "auth/user-not-found") throw e;
    const [local, domain] = email.split("@");
    const alias = config.emailDomainAliases[domain];
    if (!alias) throw e;
    return auth.getUserByEmail(`${local}@${alias}`);
  }
}

// ---- Failed sign-ins, counted per device (IP) --------------------------------------
// • one IP + one account: locked after maxFailedLogins failures (only that device is
//   blocked, so someone who knows a student's email can't lock the student out)
// • one account from anywhere: locked in the database after 3× that many failures
// • one IP across all accounts: refused after IP_FAIL_LIMIT failures (password spraying)
const fails = new Map(); // key → failure times
const IP_FAIL_LIMIT = 30;
const recentFails = (key, windowMs) => (fails.get(key) || []).filter((t) => Date.now() - t < windowMs);
function noteFail(...keys) {
  if (fails.size > 20000) fails.clear();
  for (const k of keys) fails.set(k, [...recentFails(k, 3600000), Date.now()]);
}
const forgotHits = new Map();
/** Admin "Unlock": forget this account's failed attempts on every device */
export function clearLoginFails(uid) {
  for (const k of fails.keys()) if (k.startsWith(`acct|${uid}|`)) fails.delete(k);
}

// ---- POST /auth/login ---------------------------------------------------------
publicRouter.post(
  "/auth/login",
  ah(async (req, res) => {
    const email = str(req.body.email, 200).toLowerCase();
    const password = String(req.body.password || "");
    if (!isEmail(email) || !password) fail(400, "Enter your email and password");
    const settings = await getSettings();
    const ip = clientIp(req) || "unknown";
    const lockMs = settings.lockMinutes * 60000;
    if (recentFails(`ip|${ip}`, 15 * 60000).length >= IP_FAIL_LIMIT) fail(429, "Too many sign-in attempts from this network. Please wait 15 minutes and try again.", "rate_limited");

    let authUser = null;
    try {
      authUser = await findAuthUser(email);
    } catch {
      /* unknown email – handled below without revealing it */
    }
    const user = authUser ? await getUser(authUser.uid) : null;
    const accountEmail = authUser?.email || email; // the real email when an alias was typed

    const deviceFails = user ? recentFails(`acct|${user.id}|${ip}`, lockMs) : [];
    if (user && deviceFails.length >= settings.maxFailedLogins) {
      await logLogin(req, { uid: user.id, email, success: false, reason: "locked", role: user.role, name: user.name });
      const mins = Math.max(1, Math.ceil((deviceFails[0] + lockMs - Date.now()) / 60000));
      fail(423, `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"} or reset your password.`, "locked");
    }
    if (user?.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      await logLogin(req, { uid: user.id, email, success: false, reason: "locked", role: user.role, name: user.name });
      const mins = Math.ceil((new Date(user.lockedUntil) - Date.now()) / 60000);
      fail(423, `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"} or reset your password.`, "locked");
    }

    const ok = authUser ? await passwordIsValid(accountEmail, password) : false;
    if (!ok) {
      noteFail(`ip|${ip}`, ...(user ? [`acct|${user.id}|${ip}`] : []));
      if (user) {
        const failed = (user.failedAttempts || 0) + 1;
        const update = { failedAttempts: failed, lastFailedLoginAt: nowIso() };
        if (failed >= settings.maxFailedLogins * 3) {
          update.lockedUntil = addMinutes(new Date(), settings.lockMinutes).toISOString();
          update.failedAttempts = 0;
        }
        await db.collection(C.users).doc(user.id).update(update);
      }
      await logLogin(req, { uid: user?.id, email, success: false, reason: user ? "wrong_password" : "unknown_email", role: user?.role, name: user?.name });
      fail(401, "Incorrect email or password", "bad_credentials");
    }

    if (!user || user.purged) {
      await logLogin(req, { uid: authUser.uid, email, success: false, reason: "no_portal_account" });
      fail(403, "This login doesn't have a portal account", "no_account");
    }
    if (!user.active || user.deletedAt) {
      await logLogin(req, { uid: user.id, email, success: false, reason: "inactive", role: user.role, name: user.name });
      fail(403, "This account is deactivated. Please contact the academy.", "inactive");
    }

    const at = nowIso();
    fails.delete(`acct|${user.id}|${ip}`);
    await db.collection(C.users).doc(user.id).update({ failedAttempts: 0, lockedUntil: null, lastLoginAt: at, lastActiveAt: at });
    await logLogin(req, { uid: user.id, email, success: true, role: user.role, name: user.name });
    await logActivity(req, "auth.login", { actor: user, summary: "Signed in" });

    const customToken = await auth.createCustomToken(user.id, { role: user.role });
    res.json({ customToken, role: user.role });
  })
);

// ---- POST /auth/forgot ----------------------------------------------------------
publicRouter.post(
  "/auth/forgot",
  ah(async (req, res) => {
    const typed = str(req.body.email, 200).toLowerCase();
    // Always answer the same way so the form can't be used to discover accounts.
    // The email is sent BEFORE answering: on Cloud Functions, work after the
    // response is sent may never run.
    if (!isEmail(typed)) return res.json({ ok: true });
    // At most 5 reset emails per network per 15 minutes (same answer either way)
    const fip = clientIp(req) || "unknown";
    const hits = (forgotHits.get(fip) || []).filter((t) => Date.now() - t < 15 * 60000);
    if (forgotHits.size > 10000) forgotHits.clear();
    forgotHits.set(fip, [...hits, Date.now()]);
    if (hits.length >= 5) return res.json({ ok: true });
    let email = typed;
    try {
      const authUser = await findAuthUser(typed);
      email = authUser.email; // an alias (.in) resets the real account and mails its real address
      const user = await getUser(authUser.uid);
      if (!user || !user.active || user.deletedAt) {
        console.warn(`Password reset skipped for ${email}: ${!user ? "no portal account" : "account inactive"}`);
        return res.json({ ok: true });
      }
      const firebaseLink = await auth.generatePasswordResetLink(email);
      const oobCode = new URL(firebaseLink).searchParams.get("oobCode");
      const link = `${config.portalUrl}/portal/reset-password?oobCode=${encodeURIComponent(oobCode)}`;
      await logActivity(req, "auth.password_reset_requested", { actor: user, summary: "Requested a password reset" });
      if (mailConfigured()) {
        const sent = await trySendMail({
          from: config.mailFrom,
          to: email,
          subject: "Reset your Silora Academy portal password",
          html: `<p>Hi ${user.name || ""},</p><p>Use the button below to choose a new password. The link expires in 1 hour.</p>
            <p><a href="${link}" style="display:inline-block;background:#e8b112;color:#0a2d4a;padding:12px 20px;border-radius:999px;font-weight:bold;text-decoration:none">Reset password</a></p>
            <p style="color:#64748b;font-size:13px">If you didn't ask for this, you can ignore this email.</p>`,
        });
        if (sent.status !== "sent") console.error(`Password reset email to ${email} ${sent.status}: ${sent.error}`);
        else console.log(`Password reset email sent to ${email}`);
      } else {
        console.log(`\n🔑 Password reset link for ${email} (email not configured):\n${link}\n`);
      }
    } catch (e) {
      // Same answer for unknown emails, but log why no mail went out
      if (e?.code === "auth/user-not-found") console.warn(`Password reset requested for unknown email ${email}`);
      else console.error("Password reset failed:", e?.message || e);
    }
    res.json({ ok: true });
  })
);

// ---- Authenticated: my account ---------------------------------------------------
meRouter.use(authenticate);

meRouter.get(
  "/me",
  ah(async (req, res) => {
    const u = req.user;
    if (u.role === "guest") {
      return res.json({ user: { id: u.id, name: u.name, role: "guest", guest: true, meetingId: u.meetingId }, teachers: [], settings: { sessionTimeoutMin: 24 * 60, classReminderMinutes: req.settings.classReminderMinutes, timezone: config.timezone, pushAvailable: false } });
    }
    const contactSnap = await db.collection(C.contacts).doc(u.id).get();
    // A student's teachers, one per subject (never contact details)
    const teachers = [];
    if (u.role === "student") {
      for (const id of teacherIdsOf(u)) {
        const t = await getUser(id);
        if (t && !t.deletedAt) teachers.push({ id: t.id, name: t.name, subjects: subjectsTaughtBy(u, id).filter(Boolean) });
      }
    }
    res.json({
      user: {
        ...publicProfile(u),
        superAdmin: u.superAdmin || false,
        permissions: u.role === "admin" ? (u.superAdmin ? "all" : u.permissions || {}) : undefined,
        notifyEmail: u.notifyEmail !== false,
        notifyPush: u.notifyPush !== false,
        mustChangePassword: !!u.mustChangePassword,
        contact: contactSnap.exists ? contactSnap.data() : {}, // own details only
      },
      teachers,
      settings: {
        // Students have no inactivity logout – they stay signed in for STUDENT_SESSION_DAYS
        sessionTimeoutMin: u.role === "student" ? null : req.settings.sessionTimeoutMin,
        sessionDays: u.role === "student" ? STUDENT_SESSION_DAYS : null,
        classReminderMinutes: req.settings.classReminderMinutes,
        timezone: config.timezone,
        pushAvailable: !config.useEmulators,
      },
    });
  })
);

meRouter.patch(
  "/me",
  ah(async (req, res) => {
    const update = {};
    if (typeof req.body.notifyEmail === "boolean") update.notifyEmail = req.body.notifyEmail;
    if (typeof req.body.notifyPush === "boolean") update.notifyPush = req.body.notifyPush;
    if (!Object.keys(update).length) fail(400, "Nothing to update");
    await db.collection(C.users).doc(req.user.id).update(update);
    res.json({ ok: true, ...update });
  })
);

meRouter.post(
  "/me/password",
  ah(async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!strongPassword(newPassword)) fail(400, PASSWORD_RULE);
    const authUser = await auth.getUser(req.user.id);
    if (!(await passwordIsValid(authUser.email, String(currentPassword || "")))) fail(400, "Your current password is incorrect");
    await auth.updateUser(req.user.id, { password: newPassword });
    await db.collection(C.users).doc(req.user.id).update({ mustChangePassword: false });
    // Every other device is signed out; this one gets a fresh sign-in
    const customToken = await signOutEverywhere(req.user.id, req.user.role);
    await logActivity(req, "auth.password_changed", { summary: "Changed their password (signed out on other devices)" });
    res.json({ ok: true, customToken });
  })
);

meRouter.post(
  "/me/push-token",
  ah(async (req, res) => {
    const token = str(req.body.token, 4096);
    if (!token) fail(400, "Missing token");
    await db.collection(C.pushTokens).doc(token.slice(-60).replace(/[^\w-]/g, "_")).set({ userId: req.user.id, token, createdAt: nowIso() });
    res.json({ ok: true });
  })
);

// Sign out on every device (lost phone, shared computer…)
meRouter.post(
  "/auth/logout-all",
  ah(async (req, res) => {
    await auth.revokeRefreshTokens(req.user.id);
    await db.collection(C.users).doc(req.user.id).update({ lastActiveAt: FieldValue.delete() });
    await logActivity(req, "auth.logout_all", { summary: "Signed out on all devices" });
    res.json({ ok: true });
  })
);

meRouter.post(
  "/auth/logout",
  ah(async (req, res) => {
    await logActivity(req, "auth.logout", { summary: "Signed out" });
    await db.collection(C.users).doc(req.user.id).update({ lastActiveAt: FieldValue.delete() });
    res.json({ ok: true });
  })
);

// Own relevant activity (students/teachers) – their login history and actions
meRouter.get(
  "/me/activity",
  ah(async (req, res) => {
    const [logins, acts] = await Promise.all([
      db.collection(C.loginEvents).where("uid", "==", req.user.id).get(),
      db.collection(C.activity).where("actorId", "==", req.user.id).get(),
    ]);
    const sortDesc = (a, b) => (a.at < b.at ? 1 : -1);
    res.json({
      logins: listData(logins).sort(sortDesc).slice(0, 30).map(({ ip, userAgent, ...r }) => ({ ...r, device: userAgent ? deviceLabel(userAgent) : "" })),
      activity: listData(acts).sort(sortDesc).slice(0, 50).map(({ ip, meta, ...r }) => r),
    });
  })
);

export function deviceLabel(ua = "") {
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "Other";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${br} on ${os}`;
}
