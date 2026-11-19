// ============================================================================
// AUTH + MY ACCOUNT
// Login goes through the API so we can count failed attempts, lock accounts,
// block deactivated users and keep a login history.
// ============================================================================
import { Router } from "express";
import config from "../config.js";
import { auth, db, C, FieldValue } from "../firebase.js";
import { ah, fail, nowIso, addMinutes, isEmail, str, clientIp, listData } from "../util.js";
import { authenticate } from "../middleware.js";
import { getSettings, getUser, publicProfile, logActivity } from "../services/core.js";
import { mailConfigured, trySendMail } from "../../mailer.js";

export const publicRouter = Router();
export const meRouter = Router();

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

// ---- POST /auth/login ---------------------------------------------------------
publicRouter.post(
  "/auth/login",
  ah(async (req, res) => {
    const email = str(req.body.email, 200).toLowerCase();
    const password = String(req.body.password || "");
    if (!isEmail(email) || !password) fail(400, "Enter your email and password");
    const settings = await getSettings();

    let authUser = null;
    try {
      authUser = await auth.getUserByEmail(email);
    } catch {
      /* unknown email – handled below without revealing it */
    }
    const user = authUser ? await getUser(authUser.uid) : null;

    if (user?.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      await logLogin(req, { uid: user.id, email, success: false, reason: "locked", role: user.role, name: user.name });
      const mins = Math.ceil((new Date(user.lockedUntil) - Date.now()) / 60000);
      fail(423, `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"} or reset your password.`, "locked");
    }

    const ok = authUser ? await passwordIsValid(email, password) : false;
    if (!ok) {
      if (user) {
        const failed = (user.failedAttempts || 0) + 1;
        const update = { failedAttempts: failed, lastFailedLoginAt: nowIso() };
        if (failed >= settings.maxFailedLogins) {
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
    const email = str(req.body.email, 200).toLowerCase();
    // Always answer the same way so the form can't be used to discover accounts
    res.json({ ok: true });
    if (!isEmail(email)) return;
    try {
      const authUser = await auth.getUserByEmail(email);
      const user = await getUser(authUser.uid);
      if (!user || !user.active || user.deletedAt) return;
      const firebaseLink = await auth.generatePasswordResetLink(email);
      const oobCode = new URL(firebaseLink).searchParams.get("oobCode");
      const link = `${config.portalUrl}/portal/reset-password?oobCode=${encodeURIComponent(oobCode)}`;
      await logActivity(req, "auth.password_reset_requested", { actor: user, summary: "Requested a password reset" });
      if (mailConfigured()) {
        await trySendMail({
          from: config.mailFrom,
          to: email,
          subject: "Reset your Silora Academy portal password",
          html: `<p>Hi ${user.name || ""},</p><p>Use the button below to choose a new password. The link expires in 1 hour.</p>
            <p><a href="${link}" style="display:inline-block;background:#e8b112;color:#0a2d4a;padding:12px 20px;border-radius:999px;font-weight:bold;text-decoration:none">Reset password</a></p>
            <p style="color:#64748b;font-size:13px">If you didn't ask for this, you can ignore this email.</p>`,
        });
      } else {
        console.log(`\n🔑 Password reset link for ${email} (email not configured):\n${link}\n`);
      }
    } catch {
      /* unknown email – ignore */
    }
  })
);

// ---- Authenticated: my account ---------------------------------------------------
meRouter.use(authenticate);

meRouter.get(
  "/me",
  ah(async (req, res) => {
    const u = req.user;
    const contactSnap = await db.collection(C.contacts).doc(u.id).get();
    let teacher = null;
    if (u.role === "student" && u.teacherId) {
      const t = await getUser(u.teacherId);
      if (t) teacher = { id: t.id, name: t.name, subjects: t.subjects || [] }; // never contact details
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
      teacher,
      settings: {
        sessionTimeoutMin: req.settings.sessionTimeoutMin,
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
    await logActivity(req, "auth.password_changed", { summary: "Changed their password" });
    res.json({ ok: true });
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
