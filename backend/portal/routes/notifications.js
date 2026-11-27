// ============================================================================
// NOTIFICATIONS (own inbox + admin delivery monitor) and ANNOUNCEMENT CENTRE
// ============================================================================
import { Router } from "express";
import { db, C } from "../firebase.js";
import { ah, fail, nowIso, str, toIso, listData, chunk } from "../util.js";
import { requireRole, requirePerm } from "../middleware.js";
import { usersByRole, logActivity, audit } from "../services/core.js";
import { notify, retryNotification, MAX_ATTEMPTS } from "../services/notify.js";

const router = Router();

// ---- My notifications ----------------------------------------------------------------
router.get(
  "/notifications",
  ah(async (req, res) => {
    const list = listData(await db.collection(C.notifications).where("userId", "==", req.user.id).get()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const limit = Math.min(Number(req.query.limit || 100), 300);
    const filtered = req.query.unread ? list.filter((n) => !n.read) : list;
    res.json({
      unread: list.filter((n) => !n.read).length,
      notifications: filtered.slice(0, limit).map(({ id, type, typeLabel, title, body, link, read, readAt, createdAt }) => ({ id, type, typeLabel, title, body, link, read, readAt, createdAt })),
    });
  })
);

router.post(
  "/notifications/:id/read",
  ah(async (req, res) => {
    const ref = db.collection(C.notifications).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists || snap.data().userId !== req.user.id) fail(404, "Notification not found");
    if (!snap.data().read) await ref.update({ read: true, readAt: nowIso() });
    res.json({ ok: true });
  })
);

// Remove one of your notifications, or clear all of them
router.delete(
  "/notifications/:id",
  ah(async (req, res) => {
    const ref = db.collection(C.notifications).doc(req.params.id);
    const n = (await ref.get()).data();
    if (!n || n.userId !== req.user.id) fail(404, "Notification not found");
    await ref.delete();
    res.json({ ok: true });
  })
);
router.post(
  "/notifications/clear",
  ah(async (req, res) => {
    const qs = await db.collection(C.notifications).where("userId", "==", req.user.id).get();
    const docs = req.body?.readOnly ? qs.docs.filter((d) => d.data().read) : qs.docs;
    for (const group of chunk(docs, 400)) {
      const batch = db.batch();
      group.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
    res.json({ ok: true, count: docs.length });
  })
);

router.post(
  "/notifications/read-all",
  ah(async (req, res) => {
    const qs = await db.collection(C.notifications).where("userId", "==", req.user.id).get();
    const unread = qs.docs.filter((d) => !d.data().read);
    for (const group of chunk(unread, 400)) {
      const batch = db.batch();
      group.forEach((d) => batch.update(d.ref, { read: true, readAt: nowIso() }));
      await batch.commit();
    }
    res.json({ ok: true, count: unread.length });
  })
);

// ---- Admin: delivery monitor ----------------------------------------------------------
router.get(
  "/admin/notifications",
  requireRole("admin"),
  requirePerm("notifications"),
  ah(async (req, res) => {
    const days = Number(req.query.days || 14);
    const since = new Date(Date.now() - days * 86400000).toISOString();
    let list = listData(await db.collection(C.notifications).where("createdAt", ">=", since).get());
    if (req.query.type) list = list.filter((n) => n.type === req.query.type);
    if (req.query.channel && req.query.status) list = list.filter((n) => n.channels?.[req.query.channel]?.status === req.query.status);
    else if (req.query.status) list = list.filter((n) => n.status === req.query.status);
    if (req.query.q) {
      const q = String(req.query.q).toLowerCase();
      list = list.filter((n) => `${n.title} ${n.userName}`.toLowerCase().includes(q));
    }
    list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const stat = (ch) => ({
      sent: list.filter((n) => ["sent", "delivered"].includes(n.channels?.[ch]?.status)).length,
      failed: list.filter((n) => n.channels?.[ch]?.status === "failed").length,
      skipped: list.filter((n) => n.channels?.[ch]?.status === "skipped").length,
      pending: list.filter((n) => n.channels?.[ch]?.status === "pending").length,
    });
    res.json({
      stats: { total: list.length, read: list.filter((n) => n.read).length, inApp: stat("inApp"), email: stat("email"), push: stat("push") },
      maxAttempts: MAX_ATTEMPTS,
      notifications: list.slice(0, 500).map(({ id, userId, userName, userRole, type, typeLabel, title, body, read, createdAt, channels, status, attempts, lastAttemptAt, nextRetryAt }) => ({
        id,
        userId,
        userName,
        userRole,
        type,
        typeLabel,
        title,
        body,
        read,
        createdAt,
        channels,
        status,
        attempts,
        lastAttemptAt,
        nextRetryAt,
      })),
    });
  })
);

router.post(
  "/admin/notifications/:id/retry",
  requireRole("admin"),
  requirePerm("notifications"),
  ah(async (req, res) => {
    const n = await retryNotification(req.params.id);
    if (!n) fail(404, "Notification not found");
    await logActivity(req, "notification.retry", { targetType: "notification", targetId: req.params.id, summary: `Retried "${n.title}" for ${n.userName}` });
    res.json({ ok: true, status: n.status, channels: n.channels });
  })
);

// ============================================================================
// ANNOUNCEMENTS
// ============================================================================
const PRIORITIES = ["normal", "important", "urgent"];
const AUDIENCES = ["all", "students", "teachers", "selected"];

function annStatus(a, now = nowIso()) {
  if (a.status === "draft") return "draft";
  if (a.expiresAt && a.expiresAt <= now) return "expired";
  if (a.publishAt && a.publishAt > now) return "scheduled";
  return "published";
}

function isForUser(a, user) {
  if (a.audience === "all") return true;
  if (a.audience === "students") return user.role === "student";
  if (a.audience === "teachers") return user.role === "teacher";
  if (a.audience === "selected") return (a.userIds || []).includes(user.id);
  return false;
}

async function audienceIds(a) {
  if (a.audience === "selected") return a.userIds || [];
  const roles = a.audience === "students" ? ["student"] : a.audience === "teachers" ? ["teacher"] : ["student", "teacher"];
  const lists = await Promise.all(roles.map((r) => usersByRole(r, { activeOnly: true })));
  return lists.flat().filter((u) => !u.deletedAt).map((u) => u.id);
}

/** Send notifications for a published announcement (once). Used by the scheduler too. */
export async function deliverAnnouncement(a) {
  if (a.notifiedAt) return;
  await db.collection(C.announcements).doc(a.id).update({ notifiedAt: nowIso(), publishedAt: a.publishedAt || nowIso() });
  const ids = await audienceIds(a);
  const prefix = a.priority === "urgent" ? "Urgent: " : a.priority === "important" ? "Important: " : "";
  await notify(ids, { type: "announcement", title: `${prefix}${a.title}`, body: a.body.slice(0, 240), link: "/portal/announcements", refId: a.id });
}

function cleanAnnouncement(body) {
  const title = str(body.title, 150);
  const text = str(body.body, 5000);
  if (!title || !text) fail(400, "Add a title and message");
  const audience = AUDIENCES.includes(body.audience) ? body.audience : "all";
  const userIds = audience === "selected" ? [...new Set((body.userIds || []).map((s) => str(s, 60)).filter(Boolean))] : [];
  if (audience === "selected" && !userIds.length) fail(400, "Choose at least one recipient");
  const publishAt = body.publishAt ? toIso(body.publishAt) : null;
  const expiresAt = body.expiresAt ? toIso(body.expiresAt) : null;
  if (expiresAt && expiresAt <= (publishAt || nowIso())) fail(400, "Expiry must be after the publish time");
  return {
    title,
    body: text,
    priority: PRIORITIES.includes(body.priority) ? body.priority : "normal",
    audience,
    userIds,
    publishAt,
    expiresAt,
    pinned: !!body.pinned,
    status: body.draft ? "draft" : "active",
  };
}

// Users: announcements meant for me
router.get(
  "/announcements",
  ah(async (req, res) => {
    const now = nowIso();
    const all = listData(await db.collection(C.announcements).get());
    const mine = all.filter((a) => annStatus(a, now) === "published" && (req.user.role === "admin" ? true : isForUser(a, req.user)));
    const reads = new Set(listData(await db.collection(C.announcementReads).where("userId", "==", req.user.id).get()).map((r) => r.announcementId));
    const rank = { urgent: 0, important: 1, normal: 2 };
    res.json({
      announcements: mine
        .map((a) => ({ id: a.id, title: a.title, body: a.body, priority: a.priority, pinned: !!a.pinned, publishedAt: a.publishAt || a.publishedAt || a.createdAt, expiresAt: a.expiresAt || null, createdByName: a.createdByName || "Silora Academy", read: reads.has(a.id) }))
        .sort((x, y) => Number(y.pinned) - Number(x.pinned) || (x.read === y.read ? 0 : x.read ? 1 : -1) || rank[x.priority] - rank[y.priority] || (x.publishedAt < y.publishedAt ? 1 : -1)),
    });
  })
);

router.post(
  "/announcements/:id/read",
  ah(async (req, res) => {
    const snap = await db.collection(C.announcements).doc(req.params.id).get();
    if (!snap.exists) fail(404, "Announcement not found");
    const ref = db.collection(C.announcementReads).doc(`${snap.id}_${req.user.id}`);
    if (!(await ref.get()).exists) await ref.set({ announcementId: snap.id, userId: req.user.id, userName: req.user.name, role: req.user.role, readAt: nowIso() });
    res.json({ ok: true });
  })
);

// Admin management
router.get(
  "/admin/announcements",
  requireRole("admin"),
  requirePerm("announcements"),
  ah(async (req, res) => {
    const all = listData(await db.collection(C.announcements).get());
    const reads = listData(await db.collection(C.announcementReads).get());
    const out = await Promise.all(
      all.map(async (a) => {
        const audience = await audienceIds(a);
        const readers = reads.filter((r) => r.announcementId === a.id && audience.includes(r.userId));
        return { ...a, state: annStatus(a), audienceCount: audience.length, readCount: readers.length };
      })
    );
    res.json({ announcements: out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)) });
  })
);

router.post(
  "/admin/announcements",
  requireRole("admin"),
  requirePerm("announcements"),
  ah(async (req, res) => {
    const doc = { ...cleanAnnouncement(req.body || {}), createdBy: req.user.id, createdByName: req.user.name, createdAt: nowIso() };
    const ref = await db.collection(C.announcements).add(doc);
    const a = { id: ref.id, ...doc };
    if (annStatus(a) === "published") await deliverAnnouncement(a);
    await logActivity(req, "announcement.create", { targetType: "announcement", targetId: ref.id, summary: `Created announcement "${doc.title}" (${annStatus(a)})` });
    res.status(201).json({ id: ref.id, state: annStatus(a) });
  })
);

router.patch(
  "/admin/announcements/:id",
  requireRole("admin"),
  requirePerm("announcements"),
  ah(async (req, res) => {
    const ref = db.collection(C.announcements).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) fail(404, "Announcement not found");
    const prev = { id: snap.id, ...snap.data() };
    const update = { ...cleanAnnouncement({ ...prev, ...req.body, draft: req.body.draft ?? prev.status === "draft" }), updatedAt: nowIso() };
    await ref.update(update);
    const a = { ...prev, ...update };
    if (annStatus(a) === "published") await deliverAnnouncement(a);
    await logActivity(req, "announcement.update", { targetType: "announcement", targetId: a.id, summary: `Updated announcement "${a.title}"` });
    res.json({ ok: true, state: annStatus(a) });
  })
);

// Expire immediately
router.post(
  "/admin/announcements/:id/expire",
  requireRole("admin"),
  requirePerm("announcements"),
  ah(async (req, res) => {
    const ref = db.collection(C.announcements).doc(req.params.id);
    if (!(await ref.get()).exists) fail(404, "Announcement not found");
    await ref.update({ expiresAt: nowIso() });
    res.json({ ok: true });
  })
);

router.delete(
  "/admin/announcements/:id",
  requireRole("admin"),
  requirePerm("announcements"),
  ah(async (req, res) => {
    const ref = db.collection(C.announcements).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) fail(404, "Announcement not found");
    const reads = await db.collection(C.announcementReads).where("announcementId", "==", snap.id).get();
    for (const group of chunk(reads.docs, 400)) {
      const b = db.batch();
      group.forEach((d) => b.delete(d.ref));
      await b.commit();
    }
    await ref.delete();
    await audit(req, "announcement.delete", { targetType: "announcement", targetId: snap.id, summary: `Deleted announcement "${snap.data().title}"` });
    res.json({ ok: true });
  })
);

// Read tracking for one announcement
router.get(
  "/admin/announcements/:id/reads",
  requireRole("admin"),
  requirePerm("announcements"),
  ah(async (req, res) => {
    const snap = await db.collection(C.announcements).doc(req.params.id).get();
    if (!snap.exists) fail(404, "Announcement not found");
    const a = { id: snap.id, ...snap.data() };
    const ids = await audienceIds(a);
    const reads = Object.fromEntries(listData(await db.collection(C.announcementReads).where("announcementId", "==", a.id).get()).map((r) => [r.userId, r]));
    const users = [...(await usersByRole("student")), ...(await usersByRole("teacher"))].filter((u) => ids.includes(u.id));
    res.json({
      announcement: { id: a.id, title: a.title },
      rows: users.map((u) => ({ userId: u.id, name: u.name, role: u.role, read: !!reads[u.id], readAt: reads[u.id]?.readAt || null })).sort((x, y) => Number(x.read) - Number(y.read) || x.name.localeCompare(y.name)),
    });
  })
);


export default router;
