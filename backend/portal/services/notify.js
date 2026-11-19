// ============================================================================
// NOTIFICATIONS – in-app (always), email (SMTP) and browser push (FCM)
// Each notification stores per-channel delivery status so admins can monitor
// failures; failed channels are retried automatically (max 3 attempts).
// ============================================================================
import config from "../config.js";
import { db, C, messaging } from "../firebase.js";
import { nowIso, chunk, getMany, addMinutes } from "../util.js";
import { trySendMail } from "../../mailer.js";

export const MAX_ATTEMPTS = 3;

const TYPE_LABELS = {
  class_reminder: "Class reminder",
  class_scheduled: "New class",
  class_cancelled: "Class cancelled",
  class_rescheduled: "Class rescheduled",
  schedule_request: "Schedule change request",
  schedule_decision: "Schedule change",
  material_new: "New learning material",
  attendance_reminder: "Attendance reminder",
  inactivity_alert: "Inactivity alert",
  announcement: "Announcement",
  message: "New message",
  material_uploaded: "Material uploaded by a teacher",
  class_scheduled_admin: "Class scheduled by a teacher",
  account: "Account",
};

function emailHtml({ title, body, link }) {
  const url = link ? `${config.portalUrl}${link}` : config.portalUrl + "/portal";
  return `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px">
  <tr><td style="background:#0a2d4a;border-radius:16px 16px 0 0;padding:18px 24px;color:#ffffff;font-weight:bold;font-size:16px">Silora Academy Portal</td></tr>
  <tr><td style="padding:24px">
    <h2 style="margin:0 0 8px;font-size:20px;color:#0a2d4a">${escapeHtml(title)}</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#475569">${escapeHtml(body).replace(/\n/g, "<br>")}</p>
    <a href="${url}" style="display:inline-block;background:#e8b112;color:#0a2d4a;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:999px">Open the portal</a>
  </td></tr>
  <tr><td style="padding:16px 24px;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8">You receive this because you have a Silora Academy portal account. You can turn off email notifications in your profile.</td></tr>
  </table></td></tr></table></body></html>`;
}
const escapeHtml = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

async function sendEmail(to, n) {
  if (!to) return { status: "skipped", error: "No email address on file" };
  return trySendMail({ from: config.mailFrom, to, subject: `${n.title} – Silora Academy`, html: emailHtml(n) });
}

async function sendPush(userId, n) {
  if (config.useEmulators) return { status: "skipped", error: "Push needs a real Firebase project (not available on emulators)" };
  const qs = await db.collection(C.pushTokens).where("userId", "==", userId).get();
  const tokens = qs.docs.map((d) => d.data().token);
  if (!tokens.length) return { status: "skipped", error: "User has not enabled push notifications" };
  // Data-only: the portal's service worker shows it (a "notification" payload would
  // make the browser show it a second time), and open tabs get it as a live update.
  const resp = await messaging().sendEachForMulticast({
    tokens,
    data: { title: String(n.title || ""), body: String(n.body || ""), link: `${config.portalUrl}${n.link || "/portal"}`, type: String(n.type || ""), id: String(n.id || "") },
    webpush: { headers: { Urgency: "high", TTL: String(24 * 3600) } },
  });
  // Remove tokens that are no longer valid
  await Promise.all(
    resp.responses.map((r, i) =>
      !r.success && /registration-token-not-registered|invalid-argument/.test(r.error?.code || "") ? qs.docs[i].ref.delete() : null
    )
  );
  if (resp.successCount > 0) return { status: "sent" };
  return { status: "failed", error: resp.responses[0]?.error?.message || "Push failed" };
}

function overall(channels) {
  const st = Object.values(channels).map((c) => c.status);
  if (st.includes("failed")) return st.some((s) => s === "sent" || s === "delivered") ? "partial" : "failed";
  return "delivered";
}

async function deliverChannels(n, user, contact, only) {
  const channels = { ...(n.channels || {}) };
  const want = (ch) => !only || only.includes(ch);
  if (want("email")) {
    if (user?.notifyEmail === false) channels.email = { status: "skipped", error: "Turned off by user" };
    else {
      try {
        channels.email = await sendEmail(contact?.email, n);
      } catch (e) {
        channels.email = { status: "failed", error: e.message };
      }
    }
  }
  if (want("push")) {
    if (user?.notifyPush === false) channels.push = { status: "skipped", error: "Turned off by user" };
    else {
      try {
        channels.push = await sendPush(n.userId, n);
      } catch (e) {
        channels.push = { status: "failed", error: e.message };
      }
    }
  }
  return channels;
}

/**
 * Notify one or more users. Always stored in-app; email/push sent in the background.
 * @param {string[]} userIds
 * @param {{type:string,title:string,body:string,link?:string,refId?:string}} payload
 */
export async function notify(userIds, payload) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return [];
  const users = await getMany(db, C.users, ids);
  const contacts = await getMany(db, C.contacts, ids);
  const created = [];
  for (const group of chunk(ids, 400)) {
    const batch = db.batch();
    for (const userId of group) {
      const u = users[userId];
      if (!u || !u.active || u.deletedAt) continue;
      const ref = db.collection(C.notifications).doc();
      const doc = {
        userId,
        userName: u.name || "",
        userRole: u.role || "",
        type: payload.type,
        typeLabel: TYPE_LABELS[payload.type] || "Notification",
        title: payload.title,
        body: payload.body || "",
        link: payload.link || null,
        refId: payload.refId || null,
        read: false,
        createdAt: nowIso(),
        attempts: 1,
        channels: { inApp: { status: "delivered" }, email: { status: "pending" }, push: { status: "pending" } },
        status: "pending",
      };
      batch.set(ref, doc);
      created.push({ id: ref.id, ...doc });
    }
    await batch.commit();
  }
  // Send email/push without blocking the API response
  setImmediate(async () => {
    for (const n of created) {
      try {
        const channels = await deliverChannels(n, users[n.userId], contacts[n.userId]);
        const status = overall(channels);
        await db.collection(C.notifications).doc(n.id).update({
          channels,
          status,
          lastAttemptAt: nowIso(),
          nextRetryAt: status === "delivered" ? null : addMinutes(new Date(), 5).toISOString(),
        });
      } catch (e) {
        console.error("notification delivery failed", e.message);
      }
    }
  });
  return created;
}

// Retry the failed channels of one notification (used by admin "Retry" and the job)
export async function retryNotification(id) {
  const ref = db.collection(C.notifications).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const n = { id, ...snap.data() };
  const failed = Object.entries(n.channels || {})
    .filter(([, v]) => v.status === "failed")
    .map(([k]) => k);
  if (!failed.length) return n;
  const [user, contactSnap] = await Promise.all([db.collection(C.users).doc(n.userId).get(), db.collection(C.contacts).doc(n.userId).get()]);
  const channels = await deliverChannels(n, user.data(), contactSnap.data(), failed);
  const attempts = (n.attempts || 1) + 1;
  const status = overall(channels);
  const update = {
    channels,
    status,
    attempts,
    lastAttemptAt: nowIso(),
    nextRetryAt: status === "delivered" || attempts >= MAX_ATTEMPTS ? null : addMinutes(new Date(), 5 * attempts).toISOString(),
  };
  await ref.update(update);
  return { ...n, ...update };
}

export async function notifyAdmins(payload, perm) {
  const qs = await db.collection(C.users).where("role", "==", "admin").get();
  const ids = qs.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((u) => u.active && !u.deletedAt && (!perm || u.superAdmin || u.permissions?.[perm]))
    .map((u) => u.id);
  return notify(ids, payload);
}
