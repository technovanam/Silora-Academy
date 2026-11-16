// ============================================================================
// MESSAGES – private 1:1 chat between a teacher and their students, with files.
//  • A student can message their assigned teacher and the teachers of their
//    classes; a teacher can message their students. Students never see other
//    students.
//  • Files are stored in Storage and deleted automatically after
//    MESSAGE_FILE_RETENTION_DAYS (default 7); the message stays, marked "expired".
//  • Admins with the "messages" permission can read every conversation
//    (read-only). Reading leaves no trace that teachers or students can see:
//    unread counts and conversation data are never changed by an admin.
// Data: conversations/{teacherId__studentId} + subcollection messages,
//       messageFiles (file → delete date, for the clean-up job).
// ============================================================================
import { Router } from "express";
import multer from "multer";
import config from "../config.js";
import { db, C, FieldValue } from "../firebase.js";
import { ah, fail, nowIso, str, addDays, listData, getMany } from "../util.js";
import { requireRole, requirePerm } from "../middleware.js";
import { audit } from "../services/core.js";
import { notify } from "../services/notify.js";
import { storeUpload, deleteStored, fileLink, MATERIAL_TYPES } from "../services/files.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxMessageFileMb * 1024 * 1024, files: 1 } });
const PAGE = 60;

const convId = (teacherId, studentId) => `${teacherId}__${studentId}`;
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
  return [];
}

async function loadConversation(req) {
  const snap = await convRef(req.params.id).get();
  if (!snap.exists) fail(404, "Conversation not found");
  const c = { id: snap.id, ...snap.data() };
  if (req.user.role !== "admin" && !(c.participants || []).includes(req.user.id)) fail(404, "Conversation not found");
  return c;
}

// ---- Shaping --------------------------------------------------------------------------
const shapeMessage = (m) => ({
  id: m.id,
  senderId: m.senderId,
  senderRole: m.senderRole,
  text: m.text || "",
  createdAt: m.createdAt,
  file: m.file
    ? { fileName: m.file.fileName, kind: m.file.kind, size: m.file.size, contentType: m.file.contentType, expired: !!m.file.expired, deleteAt: m.file.deleteAt || null }
    : null,
});

function shapeConversation(c, viewer, names) {
  const other = viewer.role === "teacher" ? c.studentId : c.teacherId;
  return {
    id: c.id,
    teacherId: c.teacherId,
    studentId: c.studentId,
    teacherName: names[c.teacherId] || "Teacher",
    studentName: names[c.studentId] || "Student",
    otherId: viewer.role === "admin" ? null : other,
    otherName: viewer.role === "admin" ? null : names[other] || (viewer.role === "teacher" ? "Student" : "Teacher"),
    lastMessage: c.lastMessage || null,
    lastAt: c.lastAt || c.createdAt,
    messageCount: c.messageCount || 0,
    // Viewers only ever see their own unread count; admins see none (and change none)
    unread: viewer.role === "admin" ? 0 : c.unread?.[viewer.id] || 0,
  };
}

const nameMap = async (ids) => Object.fromEntries(Object.values(await getMany(db, C.users, ids)).map((u) => [u.id, u.name]));

async function pageOfMessages(id, { after, before }) {
  let q = msgs(id);
  if (after) q = q.where("createdAt", ">", String(after)).orderBy("createdAt", "asc").limit(200);
  else {
    q = q.orderBy("createdAt", "desc");
    if (before) q = q.where("createdAt", "<", String(before));
    q = q.limit(PAGE);
  }
  const list = listData(await q.get()).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  return { messages: list.map(shapeMessage), hasMore: !after && list.length === PAGE };
}

// ============================ TEACHERS & STUDENTS =======================================
const member = Router();
member.use("/messages", requireRole("teacher", "student"));

member.get(
  "/messages/contacts",
  ah(async (req, res) => {
    const list = await contactsFor(req.user);
    res.json({
      contacts: list
        .map((u) => ({ id: u.id, name: u.name, role: u.role, subtitle: u.role === "student" ? [u.grade, u.board].filter(Boolean).join(" · ") : (u.subjects || []).join(", ") }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  })
);

member.get(
  "/messages/conversations",
  ah(async (req, res) => {
    const list = listData(await db.collection(C.conversations).where("participants", "array-contains", req.user.id).get()).filter((c) => c.messageCount > 0);
    const names = await nameMap(list.flatMap((c) => [c.teacherId, c.studentId]));
    res.json({ conversations: list.map((c) => shapeConversation(c, req.user, names)).sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1)) });
  })
);

member.get(
  "/messages/unread",
  ah(async (req, res) => {
    const qs = await db.collection(C.conversations).where("participants", "array-contains", req.user.id).get();
    res.json({ unread: qs.docs.reduce((n, d) => n + (d.data().unread?.[req.user.id] || 0), 0) });
  })
);

// Open (or create) the conversation with a contact
member.post(
  "/messages/conversations",
  ah(async (req, res) => {
    const otherId = str(req.body.userId, 60);
    const contacts = await contactsFor(req.user);
    const other = contacts.find((u) => u.id === otherId);
    if (!other) fail(403, req.user.role === "student" ? "You can only message your teachers" : "You can only message your own students");
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

member.get(
  "/messages/conversations/:id",
  ah(async (req, res) => {
    const c = await loadConversation(req);
    const names = await nameMap([c.teacherId, c.studentId]);
    res.json({ conversation: shapeConversation(c, req.user, names), ...(await pageOfMessages(c.id, req.query)) });
  })
);

member.post(
  "/messages/conversations/:id/messages",
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
    const doc = { senderId: req.user.id, senderRole: req.user.role, text, file, createdAt };
    await mref.set(doc);
    const before = c.unread?.[otherId] || 0;
    await convRef(c.id).update({
      lastMessage: { text: text.slice(0, 160), senderId: req.user.id, at: createdAt, file: file ? file.fileName : null },
      lastAt: createdAt,
      messageCount: FieldValue.increment(1),
      [`unread.${otherId}`]: FieldValue.increment(1),
      [`unread.${req.user.id}`]: 0,
    });
    // One notification per burst: only when the other person had nothing unread here
    if (before === 0) {
      await notify([otherId], {
        type: "message",
        title: `New message from ${req.user.name}`,
        body: text ? text.slice(0, 140) : `Sent a file: ${file.fileName}`,
        link: `/portal/messages?c=${encodeURIComponent(c.id)}`,
        refId: c.id,
      }).catch(() => {});
    }
    res.status(201).json({ message: shapeMessage({ id: mref.id, ...doc }) });
  })
);

member.post(
  "/messages/conversations/:id/read",
  ah(async (req, res) => {
    const c = await loadConversation(req);
    if (c.unread?.[req.user.id]) await convRef(c.id).update({ [`unread.${req.user.id}`]: 0 });
    res.json({ ok: true });
  })
);

async function linkFor(c, messageId, download) {
  const snap = await msgs(c.id).doc(messageId).get();
  if (!snap.exists) fail(404, "Message not found");
  const f = snap.data().file;
  if (!f) fail(404, "This message has no file");
  if (f.expired || !f.path) fail(410, `Files are deleted after ${config.messageFileRetentionDays} days`, "expired");
  return fileLink({ path: f.path, fileName: f.fileName, contentType: f.contentType, download });
}

member.post(
  "/messages/conversations/:id/messages/:mid/link",
  ah(async (req, res) => {
    const c = await loadConversation(req);
    res.json({ url: await linkFor(c, req.params.mid, !!req.body?.download) });
  })
);

// ================================ ADMINS (read-only) ======================================
const adminR = Router();
adminR.use("/admin/messages", requireRole("admin"), requirePerm("messages"));

adminR.get(
  "/admin/messages/conversations",
  ah(async (req, res) => {
    let list = listData(await db.collection(C.conversations).get()).filter((c) => c.messageCount > 0);
    if (req.query.teacherId) list = list.filter((c) => c.teacherId === req.query.teacherId);
    if (req.query.studentId) list = list.filter((c) => c.studentId === req.query.studentId);
    const names = await nameMap(list.flatMap((c) => [c.teacherId, c.studentId]));
    res.json({ conversations: list.map((c) => shapeConversation(c, req.user, names)).sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1)), retentionDays: config.messageFileRetentionDays });
  })
);

adminR.get(
  "/admin/messages/conversations/:id",
  ah(async (req, res) => {
    const c = await loadConversation(req);
    const names = await nameMap([c.teacherId, c.studentId]);
    // Recorded for other admins only (audit log) – nothing changes for the teacher or student
    if (!req.query.after && !req.query.before) await audit(req, "messages.view", { targetType: "conversation", targetId: c.id, summary: `Viewed messages between ${names[c.teacherId] || "teacher"} and ${names[c.studentId] || "student"}` });
    res.json({ conversation: shapeConversation(c, req.user, names), ...(await pageOfMessages(c.id, req.query)) });
  })
);

adminR.post(
  "/admin/messages/conversations/:id/messages/:mid/link",
  ah(async (req, res) => {
    const c = await loadConversation(req);
    res.json({ url: await linkFor(c, req.params.mid, !!req.body?.download) });
  })
);

router.use(member, adminR);

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
  if (qs.size) await db.collection(C.audit).add({ at: nowIso(), actorId: null, actorName: "System", action: "messages.files_expired", targetType: "system", targetId: null, summary: `Deleted ${qs.size} message file(s) older than ${config.messageFileRetentionDays} days` });
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
