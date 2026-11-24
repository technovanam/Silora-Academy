// ============================================================================
// MESSAGES – private 1:1 chat between a teacher and their students, with files.
//  • A student can message their assigned teacher and the teachers of their
//    classes; a teacher can message their students. Students never see other
//    students.
//  • Files are stored in Storage and deleted automatically after
//    MESSAGE_FILE_RETENTION_DAYS (default 7); the message stays, marked "expired".
//  • Admins with the "messages" permission can also message any teacher or
//    student directly ("direct" chats, dm__{adminId}__{userId}); the teacher /
//    student can reply but can't start one. These work exactly like the other
//    chats (ticks, edit, delete) and are not part of the monitoring view.
//  • Admins with the "messages" permission can read every teacher–student
//    conversation (read-only). Reading leaves no trace that teachers or students can see:
//    unread counts and conversation data are never changed by an admin.
//  • WhatsApp-style: senders can edit a text message for EDIT_WINDOW_MIN,
//    "delete for everyone" within DELETE_WINDOW_H, "delete for me" any time,
//    and clear a chat. Ticks: sent → delivered (the other person's portal
//    fetched it) → seen (they opened the chat). Admins still see the original
//    text of edited/deleted messages (marked as such) for safeguarding.
// Data: conversations/{teacherId__studentId} + subcollection messages,
//       messageFiles (file → delete date, for the clean-up job).
// ============================================================================
import { Router } from "express";
import multer from "multer";
import config from "../config.js";
import { db, C, FieldValue } from "../firebase.js";
import { ah, fail, nowIso, str, addDays, listData, getMany, plural } from "../util.js";
import { requireRole, requirePerm } from "../middleware.js";
import { audit } from "../services/core.js";
import { notify } from "../services/notify.js";
import { storeUpload, deleteStored, fileLink, MATERIAL_TYPES } from "../services/files.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxMessageFileMb * 1024 * 1024, files: 1 } });
const PAGE = 60;
const EDIT_WINDOW_MIN = 15;
const DELETE_WINDOW_H = 48;

const convId = (teacherId, studentId) => `${teacherId}__${studentId}`;
const dmId = (adminId, userId) => `dm__${adminId}__${userId}`;
// Older direct chats were saved without "kind", so the dm__ id counts too
const isDirect = (c) => c.kind === "direct" || String(c.id || "").startsWith("dm__");
const convRef = (id) => db.collection(C.conversations).doc(id);
const msgs = (id) => convRef(id).collection("messages");
const alive = (u) => u && !u.deletedAt && !u.purged;

// ---- Who can talk to whom -------------------------------------------------------------
async function contactsFor(user) {
  if (user.role === "teacher") {
    const [assigned, classes] = await Promise.all([
      db.collection(C.users).where("teacherId", "==", user.id).get(),
      db.collection(C.meetings).where("teacherId", "==", user.id).get(),
    ]);
    const fromClasses = await getMany(db, C.users, listData(classes).flatMap((m) => m.studentIds || []));
    const all = { ...fromClasses, ...Object.fromEntries(listData(assigned).map((u) => [u.id, u])) };
    return Object.values(all).filter((u) => u.role === "student" && alive(u) && u.active !== false);
  }
  if (user.role === "student") {
    const classes = await db.collection(C.meetings).where("studentIds", "array-contains", user.id).get();
    const ids = [user.teacherId, ...listData(classes).map((m) => m.teacherId)];
    return Object.values(await getMany(db, C.users, ids)).filter((u) => u.role === "teacher" && alive(u) && u.active !== false);
  }
  if (user.role === "admin") {
    const qs = await db.collection(C.users).where("role", "in", ["teacher", "student"]).get();
    return listData(qs).filter((u) => alive(u) && u.active !== false);
  }
  return [];
}

/** monitor = the admin read-only view of teacher–student chats. */
async function loadConversation(req, monitor = false) {
  const snap = await convRef(req.params.id).get();
  if (!snap.exists) fail(404, "Conversation not found");
  const c = { id: snap.id, ...snap.data() };
  if (monitor ? isDirect(c) : !(c.participants || []).includes(req.user.id)) fail(404, "Conversation not found");
  return c;
}

// ---- Shaping --------------------------------------------------------------------------
const shapeFile = (f) => (f ? { fileName: f.fileName, kind: f.kind, size: f.size, contentType: f.contentType, expired: !!f.expired, deleteAt: f.deleteAt || null } : null);

/** viewer = req.user. The monitoring view also sees what an edited / deleted message originally said. */
function shapeMessage(m, viewer, monitor = false) {
  const admin = monitor;
  if (!admin && (m.hiddenFor || []).includes(viewer?.id)) return { id: m.id, hidden: true, createdAt: m.createdAt, updatedAt: m.updatedAt || m.createdAt };
  const deleted = !!m.deletedAt;
  return {
    id: m.id,
    senderId: m.senderId,
    senderRole: m.senderRole,
    text: deleted && !admin ? "" : m.text || "",
    createdAt: m.createdAt,
    updatedAt: m.updatedAt || m.createdAt,
    editedAt: m.editedAt || null,
    deleted,
    file: deleted && !admin ? null : shapeFile(m.file),
    ...(admin && m.edits?.length ? { edits: m.edits } : {}),
  };
}

function shapeConversation(c, viewer, names, monitor = false) {
  const direct = isDirect(c);
  const other = monitor ? null : (c.participants || []).find((p) => p !== viewer.id) || null;
  const otherRole = monitor ? null : direct ? (other === c.adminId ? "admin" : c.userRole) : viewer.role === "teacher" ? "student" : "teacher";
  return {
    id: c.id,
    kind: direct ? "direct" : "class",
    teacherId: c.teacherId || null,
    studentId: c.studentId || null,
    teacherName: c.teacherId ? names[c.teacherId] || "Teacher" : direct ? null : "Teacher",
    studentName: c.studentId ? names[c.studentId] || "Student" : direct ? null : "Student",
    otherId: other,
    otherRole,
    otherName: monitor ? null : names[other] || { admin: "Silora Academy", teacher: "Teacher", student: "Student" }[otherRole] || "",
    lastMessage: !monitor && (c.clearedAt?.[viewer.id] || "") >= (c.lastAt || "~") ? null : c.lastMessage || null,
    lastAt: c.lastAt || c.createdAt,
    // Ticks for the viewer's own messages (the monitoring view never sees or changes these)
    otherReadAt: monitor ? null : c.readAt?.[other] || null,
    otherDeliveredAt: monitor ? null : c.deliveredAt?.[other] || c.readAt?.[other] || null,
    messageCount: c.messageCount || 0,
    // Viewers only ever see their own unread count; the monitoring view sees none (and changes none)
    unread: monitor ? 0 : c.unread?.[viewer.id] || 0,
  };
}

const nameMap = async (ids) => Object.fromEntries(Object.values(await getMany(db, C.users, ids)).map((u) => [u.id, u.name]));

/**
 * A page of messages (newest PAGE, or older than `before`), or – with `since` – every
 * message created, edited or deleted after that cursor (used for live polling).
 */
async function pageOfMessages(c, viewer, { since, before }, monitor = false) {
  const cleared = monitor ? "" : c.clearedAt?.[viewer.id] || "";
  if (since) {
    const list = listData(await msgs(c.id).where("updatedAt", ">", String(since)).orderBy("updatedAt", "asc").limit(200).get()).filter((m) => m.createdAt > cleared);
    const cursor = list.reduce((mx, m) => (m.updatedAt > mx ? m.updatedAt : mx), String(since));
    return { messages: list.map((m) => shapeMessage(m, viewer, monitor)), cursor, hasMore: false };
  }
  let q = msgs(c.id).orderBy("createdAt", "desc");
  if (before) q = q.where("createdAt", "<", String(before));
  if (cleared) q = q.where("createdAt", ">", cleared);
  const raw = listData(await q.limit(PAGE).get()).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const cursor = raw.reduce((mx, m) => ((m.updatedAt || m.createdAt) > mx ? m.updatedAt || m.createdAt : mx), cleared || "0");
  return { messages: raw.map((m) => shapeMessage(m, viewer, monitor)).filter((m) => !m.hidden), cursor, hasMore: raw.length === PAGE };
}

const lastPreview = (id, m) => ({ id, text: (m.text || "").slice(0, 160), senderId: m.senderId, at: m.createdAt, file: m.file ? m.file.fileName : null, deleted: !!m.deletedAt });

/** Mark conversations as delivered to `userId` (their portal has fetched them). */
async function markDelivered(docs, userId) {
  const now = nowIso();
  await Promise.all(
    docs
      .filter((d) => {
        const c = d.data();
        return (c.unread?.[userId] || 0) > 0 && (c.deliveredAt?.[userId] || "") < (c.lastAt || "");
      })
      .map((d) => d.ref.update({ [`deliveredAt.${userId}`]: now }).catch(() => {}))
  );
}

// ============================ CHAT (teachers, students, admins' direct chats) ===========
/** The chat API for one audience: /messages (teachers & students) or /admin/dm (admins). */
function chatRoutes(P, guard) {
  const r = Router();
  r.use(P, ...guard);

  r.get(
    `${P}/contacts`,
    ah(async (req, res) => {
      const list = await contactsFor(req.user);
      res.json({
        contacts: list
          .map((u) => ({ id: u.id, name: u.name, role: u.role, subtitle: u.role === "student" ? [u.grade, u.board].filter(Boolean).join(" · ") : (u.subjects || []).join(", ") }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      });
    })
  );

  r.get(
    `${P}/conversations`,
    ah(async (req, res) => {
      const qs = await db.collection(C.conversations).where("participants", "array-contains", req.user.id).get();
      await markDelivered(qs.docs, req.user.id);
      // "Delete chat" hides a conversation until someone writes in it again
      const list = listData(qs).filter((c) => c.messageCount > 0 && !(c.removedFor?.[req.user.id] && (c.clearedAt?.[req.user.id] || "") >= (c.lastAt || "")));
      const names = await nameMap(list.flatMap((c) => c.participants || []));
      res.json({ conversations: list.map((c) => shapeConversation(c, req.user, names)).sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1)) });
    })
  );

  r.get(
    `${P}/unread`,
    ah(async (req, res) => {
      const qs = await db.collection(C.conversations).where("participants", "array-contains", req.user.id).get();
      await markDelivered(qs.docs, req.user.id);
      res.json({ unread: qs.docs.reduce((n, d) => n + (d.data().unread?.[req.user.id] || 0), 0) });
    })
  );

  // Open (or create) the conversation with a contact
  r.post(
    `${P}/conversations`,
    ah(async (req, res) => {
      const otherId = str(req.body.userId, 60);
      const contacts = await contactsFor(req.user);
      const other = contacts.find((u) => u.id === otherId);
      if (!other) fail(403, { student: "You can only message your teachers", teacher: "You can only message your own students" }[req.user.role] || "You can only message active teachers and students");
      if (req.user.role === "admin") {
        // Direct chat between this admin and a teacher / student
        const id = dmId(req.user.id, other.id);
        const ref = convRef(id);
        if (!(await ref.get()).exists) {
          await ref.set({ kind: "direct", adminId: req.user.id, userId: other.id, userRole: other.role, participants: [req.user.id, other.id], unread: { [req.user.id]: 0, [other.id]: 0 }, messageCount: 0, createdAt: nowIso(), lastAt: nowIso() });
        }
        return res.json({ id });
      }
      const teacherId = req.user.role === "teacher" ? req.user.id : other.id;
      const studentId = req.user.role === "student" ? req.user.id : other.id;
      const id = convId(teacherId, studentId);
      const ref = convRef(id);
      if (!(await ref.get()).exists) {
        await ref.set({ teacherId, studentId, participants: [teacherId, studentId], unread: { [teacherId]: 0, [studentId]: 0 }, messageCount: 0, createdAt: nowIso(), lastAt: nowIso() });
      }
      res.json({ id });
    })
  );

  r.get(
    `${P}/conversations/:id`,
    ah(async (req, res) => {
      const c = await loadConversation(req);
      const names = await nameMap(c.participants || []);
      res.json({ conversation: shapeConversation(c, req.user, names), ...(await pageOfMessages(c, req.user, req.query)) });
    })
  );

  r.post(
    `${P}/conversations/:id/messages`,
    upload.single("file"),
    ah(async (req, res) => {
      const c = await loadConversation(req);
      const text = str(req.body.text, 4000);
      if (!text && !req.file) fail(400, "Write a message or attach a file");
      const otherId = c.participants.find((p) => p !== req.user.id);
      const other = (await getMany(db, C.users, [otherId]))[otherId];
      if (!alive(other)) fail(400, "This person's account is no longer active");

      const mref = msgs(c.id).doc();
      const createdAt = nowIso();
      let file = null;
      if (req.file) {
        const stored = await storeUpload(`messages/${c.id}/${mref.id}/${req.file.originalname}`, req.file, MATERIAL_TYPES, config.maxMessageFileMb);
        const deleteAt = addDays(new Date(), config.messageFileRetentionDays).toISOString();
        file = { ...stored, deleteAt };
        await db.collection(C.messageFiles).doc(mref.id).set({ conversationId: c.id, messageId: mref.id, path: stored.path, deleteAt, createdAt });
      }
      const doc = { senderId: req.user.id, senderRole: req.user.role, text, file, createdAt, updatedAt: createdAt };
      await mref.set(doc);
      const before = c.unread?.[otherId] || 0;
      await convRef(c.id).update({
        lastMessage: lastPreview(mref.id, doc),
        lastAt: createdAt,
        messageCount: FieldValue.increment(1),
        [`unread.${otherId}`]: FieldValue.increment(1),
        [`unread.${req.user.id}`]: 0,
        // Replying means you have seen everything before it
        [`readAt.${req.user.id}`]: createdAt,
        [`removedFor.${req.user.id}`]: FieldValue.delete(),
        [`removedFor.${otherId}`]: FieldValue.delete(),
      });
      // One notification per burst: only when the other person had nothing unread here
      if (before === 0) {
        await notify([otherId], {
          type: "message",
          title: `New message from ${req.user.name}`,
          body: text ? text.slice(0, 140) : `Sent a file: ${file.fileName}`,
          link: other.role === "admin" ? `/portal/admin/messages?tab=direct&c=${encodeURIComponent(c.id)}` : `/portal/messages?c=${encodeURIComponent(c.id)}`,
          refId: c.id,
        }).catch(() => {});
      }
      res.status(201).json({ message: shapeMessage({ id: mref.id, ...doc }, req.user) });
    })
  );

  r.post(
    `${P}/conversations/:id/read`,
    ah(async (req, res) => {
      const c = await loadConversation(req);
      const now = nowIso();
      if (c.unread?.[req.user.id] || (c.readAt?.[req.user.id] || "") < (c.lastAt || "")) {
        await convRef(c.id).update({ [`unread.${req.user.id}`]: 0, [`readAt.${req.user.id}`]: now, [`deliveredAt.${req.user.id}`]: now });
      }
      res.json({ ok: true });
    })
  );

  async function loadMessage(c, req) {
    const ref = msgs(c.id).doc(str(req.params.mid, 60));
    const snap = await ref.get();
    if (!snap.exists) fail(404, "Message not found");
    return { ref, m: { id: snap.id, ...snap.data() } };
  }

  /** Keep the chat-list preview in step when its last message changes. */
  async function syncPreview(c, m) {
    const lm = c.lastMessage;
    if (lm && (lm.id === m.id || (!lm.id && lm.at === m.createdAt && lm.senderId === m.senderId))) {
      await convRef(c.id).update({ lastMessage: lastPreview(m.id, m) });
    }
  }

  // Edit your own text message (within EDIT_WINDOW_MIN)
  r.patch(
    `${P}/conversations/:id/messages/:mid`,
    ah(async (req, res) => {
      const c = await loadConversation(req);
      const { ref, m } = await loadMessage(c, req);
      if (m.senderId !== req.user.id) fail(403, "You can only edit your own messages");
      if (m.deletedAt) fail(400, "This message was deleted");
      if (Date.now() - new Date(m.createdAt).getTime() > EDIT_WINDOW_MIN * 60000) fail(400, `Messages can only be edited within ${EDIT_WINDOW_MIN} minutes of sending`, "edit_window");
      const text = str(req.body.text, 4000);
      if (!text && !m.file) fail(400, "A message can't be empty");
      if (text === (m.text || "")) return res.json({ message: shapeMessage(m, req.user) });
      const now = nowIso();
      // Earlier versions are kept for admins only
      await ref.update({ text, editedAt: now, updatedAt: now, edits: FieldValue.arrayUnion({ text: m.text || "", at: now }) });
      const next = { ...m, text, editedAt: now, updatedAt: now };
      await syncPreview(c, next);
      res.json({ message: shapeMessage(next, req.user) });
    })
  );

  // Delete: ?for=everyone (own message, within DELETE_WINDOW_H) or ?for=me (any message, any time)
  r.delete(
    `${P}/conversations/:id/messages/:mid`,
    ah(async (req, res) => {
      const c = await loadConversation(req);
      const { ref, m } = await loadMessage(c, req);
      const now = nowIso();
      if (req.query.for === "everyone") {
        if (m.senderId !== req.user.id) fail(403, "You can only delete your own messages for everyone");
        if (!m.deletedAt) {
          if (Date.now() - new Date(m.createdAt).getTime() > DELETE_WINDOW_H * 3600000) fail(400, `Messages can only be deleted for everyone within ${DELETE_WINDOW_H} hours of sending`, "delete_window");
          // The file is removed at once; the text stays visible to admins only (marked deleted)
          if (m.file?.path) {
            await deleteStored([m.file.path]);
            await db.collection(C.messageFiles).doc(m.id).delete().catch(() => {});
          }
          await ref.update({ deletedAt: now, deletedBy: req.user.id, updatedAt: now, ...(m.file ? { "file.path": null, "file.expired": true } : {}) });
          await syncPreview(c, { ...m, deletedAt: now });
        }
      } else {
        await ref.update({ hiddenFor: FieldValue.arrayUnion(req.user.id), updatedAt: now });
      }
      res.json({ ok: true });
    })
  );

  // Clear the chat for yourself; { remove: true } also hides it from your list until a new message
  r.post(
    `${P}/conversations/:id/clear`,
    ah(async (req, res) => {
      const c = await loadConversation(req);
      const now = nowIso();
      await convRef(c.id).update({
        [`clearedAt.${req.user.id}`]: now,
        [`unread.${req.user.id}`]: 0,
        [`readAt.${req.user.id}`]: now,
        ...(req.body?.remove ? { [`removedFor.${req.user.id}`]: true } : {}),
      });
      res.json({ ok: true });
    })
  );

  r.post(
    `${P}/conversations/:id/messages/:mid/link`,
    ah(async (req, res) => {
      const c = await loadConversation(req);
      res.json({ url: await linkFor(c, req.params.mid, !!req.body?.download) });
    })
  );

  return r;
}
const member = chatRoutes("/messages", [requireRole("teacher", "student")]);
const direct = chatRoutes("/admin/dm", [requireRole("admin"), requirePerm("messages")]);

async function linkFor(c, messageId, download) {
  const snap = await msgs(c.id).doc(messageId).get();
  if (!snap.exists) fail(404, "Message not found");
  if (snap.data().deletedAt) fail(410, "This message was deleted", "deleted");
  const f = snap.data().file;
  if (!f) fail(404, "This message has no file");
  if (f.expired || !f.path) fail(410, `Files are deleted after ${plural(config.messageFileRetentionDays, "day")}`, "expired");
  return fileLink({ path: f.path, fileName: f.fileName, contentType: f.contentType, download });
}

// ================================ ADMINS (read-only) ======================================
const adminR = Router();
adminR.use("/admin/messages", requireRole("admin"), requirePerm("messages"));

adminR.get(
  "/admin/messages/conversations",
  ah(async (req, res) => {
    let list = listData(await db.collection(C.conversations).get()).filter((c) => c.messageCount > 0 && !isDirect(c));
    if (req.query.teacherId) list = list.filter((c) => c.teacherId === req.query.teacherId);
    if (req.query.studentId) list = list.filter((c) => c.studentId === req.query.studentId);
    const names = await nameMap(list.flatMap((c) => [c.teacherId, c.studentId]));
    res.json({ conversations: list.map((c) => shapeConversation(c, req.user, names, true)).sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1)), retentionDays: config.messageFileRetentionDays });
  })
);

adminR.get(
  "/admin/messages/conversations/:id",
  ah(async (req, res) => {
    const c = await loadConversation(req, true);
    const names = await nameMap([c.teacherId, c.studentId]);
    // Recorded for other admins only (audit log) – nothing changes for the teacher or student
    if (!req.query.since && !req.query.before) await audit(req, "messages.view", { targetType: "conversation", targetId: c.id, summary: `Viewed messages between ${names[c.teacherId] || "teacher"} and ${names[c.studentId] || "student"}` });
    res.json({ conversation: shapeConversation(c, req.user, names, true), ...(await pageOfMessages(c, req.user, req.query, true)) });
  })
);

adminR.post(
  "/admin/messages/conversations/:id/messages/:mid/link",
  ah(async (req, res) => {
    const c = await loadConversation(req, true);
    res.json({ url: await linkFor(c, req.params.mid, !!req.body?.download) });
  })
);

router.use(member, direct, adminR);

// ================================ CLEAN-UP (scheduled) ====================================
/** Delete message files past their retention date; the message stays as "file expired". */
export async function cleanupMessageFiles() {
  const qs = await db.collection(C.messageFiles).where("deleteAt", "<=", nowIso()).get();
  for (const d of qs.docs) {
    const f = d.data();
    await deleteStored([f.path]);
    await msgs(f.conversationId)
      .doc(f.messageId)
      .update({ "file.expired": true, "file.path": null, "file.expiredAt": nowIso() })
      .catch(() => {});
    await d.ref.delete();
  }
  if (qs.size) await db.collection(C.audit).add({ at: nowIso(), actorId: null, actorName: "System", action: "messages.files_expired", targetType: "system", targetId: null, summary: `Deleted ${plural(qs.size, "message file")} older than ${plural(config.messageFileRetentionDays, "day")}` });
  return qs.size;
}

/** Remove every conversation of a user (account purge). */
export async function deleteConversationsOf(userId) {
  const qs = await db.collection(C.conversations).where("participants", "array-contains", userId).get();
  for (const c of qs.docs) {
    const m = await c.ref.collection("messages").get();
    await deleteStored(m.docs.map((d) => d.data().file?.path));
    for (const d of m.docs) await d.ref.delete();
    const files = await db.collection(C.messageFiles).where("conversationId", "==", c.id).get();
    for (const f of files.docs) await f.ref.delete();
    await c.ref.delete();
  }
}

export default router;
