// ============================================================================
// AUTH MIDDLEWARE – verifies the Firebase ID token on every portal request,
// loads the user's role and enforces session timeout + role/permission rules.
// ============================================================================
import { auth, db, C } from "./firebase.js";
import { HttpError, nowIso } from "./util.js";
import { getSettings, hasPerm } from "./services/core.js";

const ACTIVITY_WRITE_EVERY_MS = 60 * 1000;
export const STUDENT_SESSION_DAYS = 30;
const STUDENT_SESSION_MS = STUDENT_SESSION_DAYS * 24 * 60 * 60 * 1000;
// What someone with a temporary password may still do: the profile page and sign out
const PASSWORD_CHANGE_ALLOWED = [/^\/me(\/(password|activity|push-token))?$/, /^\/auth\/logout(-all)?$/, /^\/notifications(\/read-all|\/[^/]+\/read)?$/, /^\/(messages|admin\/dm)\/unread$/, /^\/subjects$/];

export async function authenticate(req, res, next) {
  if (req.user) return next(); // already verified earlier in this request
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) throw new HttpError(401, "Please sign in", "unauthenticated");

    let decoded;
    try {
      decoded = await auth.verifyIdToken(token, true);
    } catch {
      throw new HttpError(401, "Your session has ended. Please sign in again.", "session_expired");
    }

    // Demo-class guest (temporary sign-in from a guest link): only their one class
    if (decoded.guest) {
      const { guestUser } = await import("./routes/demos.js");
      const user = await guestUser(decoded);
      const p = req.path;
      if (p !== "/me" && !p.startsWith(`/meetings/${user.meetingId}/live`)) throw new HttpError(403, "Guests can only join their demo class", "guest_only");
      req.user = user;
      req.settings = await getSettings();
      return next();
    }

    const ref = db.collection(C.users).doc(decoded.uid);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpError(403, "No portal account for this login", "no_account");
    const user = { id: snap.id, ...snap.data() };
    if (!user.active || user.deletedAt) throw new HttpError(403, "This account is deactivated. Contact the academy.", "inactive");

    const settings = await getSettings();
    const last = user.lastActiveAt ? new Date(user.lastActiveAt).getTime() : 0;
    const timeoutMs = settings.sessionTimeoutMin * 60 * 1000;
    if (user.role === "student") {
      // Students stay signed in on their device – no inactivity logout, but a fresh
      // password sign-in is required once the login is STUDENT_SESSION_DAYS old.
      if (Date.now() - decoded.auth_time * 1000 > STUDENT_SESSION_MS) {
        throw new HttpError(401, `For your security, please sign in again (sign-ins last ${STUDENT_SESSION_DAYS} days).`, "session_expired");
      }
    } else if (last && Date.now() - last > timeoutMs && decoded.auth_time * 1000 < last + timeoutMs - 1000) {
      // Server-side inactivity timeout for staff (the browser also logs out on its own)
      // Signed in before the idle period started → force a fresh login
      throw new HttpError(401, "You were signed out after a period of inactivity.", "session_timeout");
    }
    // A temporary password (new account / admin reset) must be changed before anything else
    if (user.mustChangePassword && !PASSWORD_CHANGE_ALLOWED.some((re) => re.test(req.path))) {
      throw new HttpError(403, "Please change your temporary password on your profile first.", "must_change_password");
    }
    if (!last || Date.now() - last > ACTIVITY_WRITE_EVERY_MS) {
      ref.update({ lastActiveAt: nowIso() }).catch(() => {});
    }

    req.user = user;
    req.settings = settings;
    next();
  } catch (e) {
    next(e);
  }
}

export const requireRole =
  (...roles) =>
  (req, res, next) =>
    roles.includes(req.user?.role) ? next() : next(new HttpError(403, "You don't have access to this", "forbidden"));

export const requirePerm = (perm) => (req, res, next) =>
  hasPerm(req.user, perm) ? next() : next(new HttpError(403, "Your admin account doesn't have this permission", "forbidden"));

export const requireSuperAdmin = (req, res, next) =>
  req.user?.role === "admin" && req.user.superAdmin ? next() : next(new HttpError(403, "Only a super admin can do this", "forbidden"));
