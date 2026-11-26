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
//  • GROUPS (kind "group", grp__{id}): created by admins with the "groups"
//    permission. memberIds = teachers + students (participants mirror it),
//    managerIds = teacher members an admin authorised to add / remove their own
//    students, onlyAdminsPost = announcement group (admins + managers post).
//    Members only see messages from when they joined; removal cuts access at
//    once (their old messages stay). Ticks: delivered / seen by ALL members,
//    "Message info" lists each member. One notification per burst, per member,
//    unless they muted the group. Admins read and post through /admin/groups
//    (shown to members as "Silora Academy"); reading changes nothing.
// Data: conversations/{teacherId__studentId} + subcollection messages,
//       messageFiles (file → delete date, for the clean-up job).
// ============================================================================
import { Router } from "express";
import multer from "multer";
import config from "../config.js";
import { db, C, FieldValue } from "../firebase.js";
import { ah, fail, nowIso, str, addDays, listData, getMany, plural } from "../util.js";
import { requireRole, requirePerm } from "../middleware.js";
import { audit, studentsOfTeacher, teacherIdsOf, subjectTeachersOf, sameSubject } from "../services/core.js";
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
// What the admin monitor shows: real teacher–student chats only (not old test chats without both)
const isClassChat = (c) => !isDirect(c) && !!c.teacherId && !!c.studentId;
const isGroup = (c) => c.kind === "group";
const ACADEMY = "Silora Academy";
const justBefore = (iso) => new Date(new Date(iso).getTime() - 1).toISOString();
const convRef = (id) => db.collection(C.conversations).doc(id);
const msgs = (id) => convRef(id).collection("messages");
const alive = (u) => u && !u.deletedAt && !u.purged;

// ---- Who can talk to whom -------------------------------------------------------------
async function contactsFor(user) {
  if (user.role === "teacher") {
    const [assigned, classes] = await Promise.all([
      studentsOfTeacher(user.id),
      db.collection(C.meetings).where("teacherId", "==", user.id).get(),
    ]);
    const fromClasses = await getMany(db, C.users, listData(classes).flatMap((m) => m.studentIds || []));
    const all = { ...fromClasses, ...Object.fromEntries(assigned.map((u) => [u.id, u])) };
    return Object.values(all).filter((u) => u.role === "student" && alive(u) && u.active !== false);
  }
  if (user.role === "student") {
    const classes = await db.collection(C.meetings).where("studentIds", "array-contains", user.id).get();
    const ids = [...teacherIdsOf(user), ...listData(classes).map((m) => m.teacherId)];
    return Object.values(await getMany(db, C.users, ids)).filter((u) => u.role === "teacher" && alive(u) && u.active !== false);
  }
  if (user.role === "admin") {
    const qs = await db.collection(C.users).where("role", "in", ["teacher", "student"]).get();
    return listData(qs).filter((u) => alive(u) && u.active !== false);
  }
  return [];
}

/** monitor = the admin read-only view of teacher–student chats; groupAdmin = an admin managing groups. */
async function loadConversation(req, monitor = false, groupAdmin = false) {
  const snap = await convRef(req.params.id).get();
  if (!snap.exists) fail(404, "Conversation not found");
  const c = { id: snap.id, ...snap.data() };
  if (groupAdmin) {
    if (!isGroup(c)) fail(404, "Group not found");
    return c;
  }
  if (monitor ? !isClassChat(c) : !(c.participants || []).includes(req.user.id)) fail(404, "Conversation not found");
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
    senderName: m.senderRole === "admin" && !admin ? ACADEMY : m.senderName || null,
    system: !!m.system,
    text: deleted && !admin ? "" : m.text || "",
    createdAt: m.createdAt,
    updatedAt: m.updatedAt || m.createdAt,
    editedAt: m.editedAt || null,
    deleted,
    file: deleted && !admin ? null : shapeFile(m.file),
    ...(admin && m.edits?.length ? { edits: m.edits } : {}),
  };
}

/** The earliest time every other member has reached (read / delivered) – joining counts for older messages. */
function allReached(c, field, ids) {
  let min = null;
  for (const id of ids) {
    const v = [c[field]?.[id], field === "deliveredAt" ? c.readAt?.[id] : null, c.joinedAt?.[id]].filter(Boolean).sort().pop() || "";
    if (min === null || v < min) min = v;
  }
  return min || null;
}

function shapeGroup(c, viewer, groupAdmin) {
  const members = c.memberIds || [];
  const others = members.filter((id) => id !== viewer.id);
  const isManager = viewer.role === "teacher" && (c.managerIds || []).includes(viewer.id);
  const lm = c.lastMessage;
  const cleared = !groupAdmin && (c.clearedAt?.[viewer.id] || "") >= (c.lastAt || "~");
  return {
    id: c.id,
    kind: "group",
    name: c.name,
    description: c.description || "",
    otherName: c.name,
    memberCount: members.length,
    onlyAdminsPost: !!c.onlyAdminsPost,
    isManager,
    canManage: groupAdmin || isManager,
    canPost: groupAdmin || isManager || !c.onlyAdminsPost,
    // Announcement groups don't show students who else is in them
    showMembers: groupAdmin || viewer.role !== "student" || !c.onlyAdminsPost,
    muted: !groupAdmin && !!c.mutedBy?.[viewer.id],
    lastMessage: cleared || !lm ? null : { ...lm, senderName: lm.senderRole === "admin" && !groupAdmin ? ACADEMY : lm.senderName || null },
    lastAt: c.lastAt || c.createdAt,
    otherReadAt: others.length ? allReached(c, "readAt", others) : null,
    otherDeliveredAt: others.length ? allReached(c, "deliveredAt", others) : null,
    messageCount: c.messageCount || 0,
    unread: groupAdmin ? 0 : c.unread?.[viewer.id] || 0,
    ...(groupAdmin ? { memberIds: members, managerIds: c.managerIds || [], createdByName: c.createdByName || null, createdAt: c.createdAt } : {}),
  };
}

function shapeConversation(c, viewer, names, monitor = false) {
  if (isGroup(c)) return shapeGroup(c, viewer, monitor);
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
  // Group members only see what was sent after they joined
  const cleared = monitor ? "" : [c.clearedAt?.[viewer.id] || "", isGroup(c) ? c.joinedAt?.[viewer.id] || "" : ""].sort().pop();
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

const lastPreview = (id, m) => ({ id, text: (m.text || "").slice(0, 160), senderId: m.senderId, senderRole: m.senderRole || null, senderName: m.senderName || null, system: !!m.system, at: m.createdAt, file: m.file ? m.file.fileName : null, deleted: !!m.deletedAt });

/** A grey "Ravi was added" line in a group. Doesn't count as unread. */
async function addSystemLine(cid, text, at = nowIso()) {
  const mref = msgs(cid).doc();
  const doc = { system: true, senderId: null, senderRole: "system", text, createdAt: at, updatedAt: at };
  await mref.set(doc);
  await convRef(cid).update({ lastMessage: lastPreview(mref.id, doc), lastAt: at, messageCount: FieldValue.increment(1) });
}

const listNames = (names) => (names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(", ").replace(/, ([^,]*)$/, " and $1"));
const MEMBER_FIELDS = ["joinedAt", "unread", "readAt", "deliveredAt", "mutedBy", "clearedAt", "removedFor"];

/** Add / remove group members (and optionally set managers). actorName appears in the system line. */
async function changeMembers(c, { add = [], remove = [], managerIds }, actorName) {
  const at = nowIso();
  const cur = c.memberIds || [];
  const added = [...new Set(add)].filter((id) => !cur.includes(id));
  const removed = [...new Set(remove)].filter((id) => cur.includes(id));
  const members = cur.filter((id) => !removed.includes(id)).concat(added);
  const managers = [...new Set(managerIds ?? c.managerIds ?? [])].filter((id) => members.includes(id));
  const update = { memberIds: members, participants: members, managerIds: managers, updatedAt: at };
  for (const id of added) Object.assign(update, { [`joinedAt.${id}`]: justBefore(at), [`unread.${id}`]: 0, [`removedFor.${id}`]: FieldValue.delete() });
  for (const id of removed) for (const f of MEMBER_FIELDS) update[`${f}.${id}`] = FieldValue.delete();
  await convRef(c.id).update(update);
  const names = await nameMap([...added, ...removed, ...managers]);
  if (added.length) await addSystemLine(c.id, `${actorName} added ${listNames(added.map((id) => names[id] || "a member"))}`, at);
  if (removed.length) await addSystemLine(c.id, `${actorName} removed ${listNames(removed.map((id) => names[id] || "a member"))}`, at);
  const newManagers = managers.filter((id) => !(c.managerIds || []).includes(id));
  if (newManagers.length) await addSystemLine(c.id, `${listNames(newManagers.map((id) => names[id] || "A teacher"))} can now manage this group`, at);
  if (added.length) await notify(added, { type: "group_added", title: `You were added to "${c.name}"`, body: "Open Messages to see the group.", link: `/portal/messages?c=${encodeURIComponent(c.id)}`, refId: c.id }).catch(() => {});
  return { added, removed, members, managers };
}

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
function chatRoutes(P, guard, { groupAdmin: GA = false } = {}) {
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
      const qs = GA ? await db.collection(C.conversations).where("kind", "==", "group").get() : await db.collection(C.conversations).where("participants", "array-contains", req.user.id).get();
      if (!GA) await markDelivered(qs.docs, req.user.id);
      // "Delete chat" hides a conversation until someone writes in it again (groups show even when empty)
      const list = listData(qs).filter((c) => (c.messageCount > 0 || isGroup(c)) && !(c.removedFor?.[req.user.id] && (c.clearedAt?.[req.user.id] || "") >= (c.lastAt || "")));
      const names = await nameMap(list.filter((c) => !isGroup(c)).flatMap((c) => c.participants || []));
      res.json({ conversations: list.map((c) => shapeConversation(c, req.user, names, GA)).sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1)) });
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
      if (GA) fail(400, "Create groups with “New group”");
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
      const c = await loadConversation(req, false, GA);
      const names = isGroup(c) ? {} : await nameMap(c.participants || []);
      if (GA && !req.query.since && !req.query.before) await audit(req, "groups.view", { targetType: "conversation", targetId: c.id, summary: `Viewed group "${c.name}"` });
      res.json({ conversation: shapeConversation(c, req.user, names, GA), ...(await pageOfMessages(c, req.user, req.query, GA)) });
    })
  );

  r.post(
    `${P}/conversations/:id/messages`,
    upload.single("file"),
    ah(async (req, res) => {
      const c = await loadConversation(req, false, GA);
      const text = str(req.body.text, 4000);
      if (!text && !req.file) fail(400, "Write a message or attach a file");
      const group = isGroup(c);
      if (group && !GA && c.onlyAdminsPost && !(c.managerIds || []).includes(req.user.id)) fail(403, "Only the academy can post in this group", "admins_only");
      const otherId = group ? null : c.participants.find((p) => p !== req.user.id);
      const other = group ? null : (await getMany(db, C.users, [otherId]))[otherId];
      if (!group && !alive(other)) fail(400, "This person's account is no longer active");

      const mref = msgs(c.id).doc();
      const createdAt = nowIso();
      let file = null;
      if (req.file) {
        const stored = await storeUpload(`messages/${c.id}/${mref.id}/${req.file.originalname}`, req.file, MATERIAL_TYPES, config.maxMessageFileMb);
        const deleteAt = addDays(new Date(), config.messageFileRetentionDays).toISOString();
        file = { ...stored, deleteAt };
        await db.collection(C.messageFiles).doc(mref.id).set({ conversationId: c.id, messageId: mref.id, path: stored.path, deleteAt, createdAt });
      }
      const doc = { senderId: req.user.id, senderRole: req.user.role, senderName: req.user.name || "", text, file, createdAt, updatedAt: createdAt };
      await mref.set(doc);
      if (group) {
        const others = (c.memberIds || []).filter((id) => id !== req.user.id);
        const update = { lastMessage: lastPreview(mref.id, doc), lastAt: createdAt, messageCount: FieldValue.increment(1) };
        for (const id of others) update[`unread.${id}`] = FieldValue.increment(1);
        for (const id of Object.keys(c.removedFor || {})) update[`removedFor.${id}`] = FieldValue.delete();
        if ((c.memberIds || []).includes(req.user.id)) Object.assign(update, { [`unread.${req.user.id}`]: 0, [`readAt.${req.user.id}`]: createdAt });
        await convRef(c.id).update(update);
        // One notification per burst per member (only if nothing was unread), never to muted members
        const quiet = others.filter((id) => !(c.unread?.[id] > 0) && !c.mutedBy?.[id]);
        const who = GA ? ACADEMY : req.user.name;
        await notify(quiet, { type: "message", title: c.name, body: `${who}: ${text ? text.slice(0, 120) : `sent a file (${file.fileName})`}`, link: `/portal/messages?c=${encodeURIComponent(c.id)}`, refId: c.id }).catch(() => {});
        return res.status(201).json({ message: shapeMessage({ id: mref.id, ...doc }, req.user, GA) });
      }
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
      if (GA) return res.json({ ok: true }); // an admin reading a group changes nothing
      const c = await loadConversation(req, false, GA);
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
      const c = await loadConversation(req, false, GA);
      const { ref, m } = await loadMessage(c, req);
      if (m.senderId !== req.user.id || m.system) fail(403, "You can only edit your own messages");
      if (m.deletedAt) fail(400, "This message was deleted");
      if (Date.now() - new Date(m.createdAt).getTime() > EDIT_WINDOW_MIN * 60000) fail(400, `Messages can only be edited within ${EDIT_WINDOW_MIN} minutes of sending`, "edit_window");
      const text = str(req.body.text, 4000);
      if (!text && !m.file) fail(400, "A message can't be empty");
      if (text === (m.text || "")) return res.json({ message: shapeMessage(m, req.user, GA) });
      const now = nowIso();
      // Earlier versions are kept for admins only
      await ref.update({ text, editedAt: now, updatedAt: now, edits: FieldValue.arrayUnion({ text: m.text || "", at: now }) });
      const next = { ...m, text, editedAt: now, updatedAt: now };
      await syncPreview(c, next);
      res.json({ message: shapeMessage(next, req.user, GA) });
    })
  );

  // Delete: ?for=everyone (own message, within DELETE_WINDOW_H) or ?for=me (any message, any time)
  r.delete(
    `${P}/conversations/:id/messages/:mid`,
    ah(async (req, res) => {
      const c = await loadConversation(req, false, GA);
      const { ref, m } = await loadMessage(c, req);
      const now = nowIso();
      if (req.query.for === "everyone") {
        if (m.system) fail(400, "This line can't be deleted");
        // Admins can remove any message from a group (moderation); everyone else only their own
        if (m.senderId !== req.user.id && !GA) fail(403, "You can only delete your own messages for everyone");
        if (!m.deletedAt) {
          if (!GA && Date.now() - new Date(m.createdAt).getTime() > DELETE_WINDOW_H * 3600000) fail(400, `Messages can only be deleted for everyone within ${DELETE_WINDOW_H} hours of sending`, "delete_window");
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
      const c = await loadConversation(req, false, GA);
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
      const c = await loadConversation(req, false, GA);
      res.json({ url: await linkFor(c, req.params.mid, !!req.body?.download) });
    })
  );

  // ---- Groups ------------------------------------------------------------------------
  const loadGroup = async (req) => {
    const c = await loadConversation(req, false, GA);
    if (!isGroup(c)) fail(404, "Group not found");
    return c;
  };

  r.get(
    `${P}/conversations/:id/members`,
    ah(async (req, res) => {
      const c = await loadGroup(req);
      const g = shapeGroup(c, req.user, GA);
      if (!g.showMembers) fail(403, "The member list of this group is private");
      const users = await getMany(db, C.users, c.memberIds || []);
      // Names and roles only – never phone numbers or emails
      const members = (c.memberIds || [])
        .map((id) => ({ id, name: users[id]?.name || "Member", role: users[id]?.role || "student", isManager: (c.managerIds || []).includes(id), you: id === req.user.id, ...(GA ? { active: alive(users[id]) && users[id]?.active !== false } : {}) }))
        .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === "teacher" ? -1 : 1));
      res.json({ members, canManage: g.canManage });
    })
  );

  // Managers (teachers) add / remove their own students; admins anyone
  r.post(
    `${P}/conversations/:id/members`,
    ah(async (req, res) => {
      const c = await loadGroup(req);
      const g = shapeGroup(c, req.user, GA);
      if (!g.canManage) fail(403, "Only group managers can change members");
      const ids = (v) => (Array.isArray(v) ? v.map((x) => str(x, 60)).filter(Boolean).slice(0, 500) : []);
      const add = ids(req.body.add);
      const remove = ids(req.body.remove);
      if (add.length) {
        const allowed = Object.fromEntries((await contactsFor(req.user)).map((u) => [u.id, u]));
        for (const id of add) {
          if (!allowed[id] || (!GA && allowed[id].role !== "student")) fail(403, GA ? "Only active teachers and students can be added" : "You can only add your own students");
        }
      }
      if (!GA && remove.length) {
        const users = await getMany(db, C.users, remove);
        if (remove.some((id) => users[id]?.role !== "student")) fail(403, "Only an admin can remove teachers from a group");
      }
      const out = await changeMembers(c, { add, remove }, GA ? ACADEMY : req.user.name);
      if (GA) await audit(req, "groups.members", { targetType: "conversation", targetId: c.id, summary: `Changed members of group "${c.name}" (+${out.added.length} / −${out.removed.length})` });
      res.json({ ok: true, added: out.added.length, removed: out.removed.length });
    })
  );

  r.post(
    `${P}/conversations/:id/mute`,
    ah(async (req, res) => {
      if (GA) fail(400, "Admins don't get group notifications");
      const c = await loadGroup(req);
      await convRef(c.id).update({ [`mutedBy.${req.user.id}`]: req.body?.muted ? true : FieldValue.delete() });
      res.json({ ok: true, muted: !!req.body?.muted });
    })
  );

  // Who has received / seen one of your group messages
  r.get(
    `${P}/conversations/:id/messages/:mid/info`,
    ah(async (req, res) => {
      const c = await loadGroup(req);
      const { m } = await loadMessage(c, req);
      if (m.senderId !== req.user.id && !GA) fail(403, "You can only see info for your own messages");
      const ids = (c.memberIds || []).filter((id) => id !== m.senderId && (c.joinedAt?.[id] || "") <= m.createdAt);
      const users = await getMany(db, C.users, ids);
      const members = ids
        .map((id) => {
          const read = (c.readAt?.[id] || "") >= m.createdAt;
          const delivered = read || (c.deliveredAt?.[id] || "") >= m.createdAt;
          return { id, name: users[id]?.name || "Member", role: users[id]?.role || "", state: read ? "seen" : delivered ? "delivered" : "sent", at: read ? c.readAt[id] : delivered ? c.deliveredAt[id] : null };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      res.json({ sentAt: m.createdAt, members, seen: members.filter((x) => x.state === "seen").length, delivered: members.filter((x) => x.state !== "sent").length });
    })
  );

  return r;
}
const member = chatRoutes("/messages", [requireRole("teacher", "student")]);
const direct = chatRoutes("/admin/dm", [requireRole("admin"), requirePerm("messages")]);
const groupChat = chatRoutes("/admin/groups", [requireRole("admin"), requirePerm("groups")], { groupAdmin: true });

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
    let list = listData(await db.collection(C.conversations).get()).filter((c) => c.messageCount > 0 && isClassChat(c));
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

// ================================ GROUPS (admins) =========================================
const groupsR = Router();
const gAdmin = [requireRole("admin"), requirePerm("groups")];

/** Members must be active teachers / students; managers must be teacher members. */
async function cleanGroup(body, before) {
  const name = str(body.name ?? before?.name, 80);
  if (!name) fail(400, "Give the group a name");
  const ids = (v) => [...new Set((Array.isArray(v) ? v : []).map((x) => str(x, 60)).filter(Boolean))].slice(0, 1000);
  const memberIds = body.memberIds !== undefined ? ids(body.memberIds) : before?.memberIds || [];
  const users = await getMany(db, C.users, memberIds);
  const ok = (id) => users[id] && ["teacher", "student"].includes(users[id].role) && alive(users[id]) && users[id].active !== false;
  // Members who were already in the group may have been deactivated since – they can stay
  if (memberIds.some((id) => !ok(id) && !(before?.memberIds || []).includes(id))) fail(400, "Members must be active teachers or students");
  const managerIds = (body.managerIds !== undefined ? ids(body.managerIds) : before?.managerIds || []).filter((id) => memberIds.includes(id));
  if (managerIds.some((id) => users[id]?.role !== "teacher")) fail(400, "Only teacher members can manage a group");
  return { name, description: str(body.description ?? before?.description ?? "", 300), memberIds, managerIds, onlyAdminsPost: body.onlyAdminsPost !== undefined ? !!body.onlyAdminsPost : !!before?.onlyAdminsPost };
}

// Ready-made member lists: everyone (announcements), all teachers / students, each session, each subject
groupsR.get(
  "/admin/groups/templates",
  ...gAdmin,
  ah(async (req, res) => {
    const people = listData(await db.collection(C.users).where("role", "in", ["teacher", "student"]).get()).filter((u) => alive(u) && u.active !== false);
    const live = new Set(people.map((u) => u.id));
    const teachers = people.filter((u) => u.role === "teacher").map((u) => u.id);
    const students = people.filter((u) => u.role === "student").map((u) => u.id);
    const t = [
      { key: "announcements", label: "Academy announcements", name: "Silora Academy announcements", memberIds: [...teachers, ...students], onlyAdminsPost: true },
      { key: "teachers", label: "All teachers", name: "Teachers", memberIds: teachers },
      { key: "students", label: "All students", name: "Students", memberIds: students },
    ];
    for (const s of listData(await db.collection(C.sessions).get()).filter((x) => ["draft", "active"].includes(x.status))) {
      t.push({ key: `session_${s.id}`, label: `Session: ${s.name}`, name: `${s.name} – Batch`, memberIds: [...(s.teacherIds || []), ...(s.studentIds || [])].filter((id) => live.has(id)) });
    }
    const since = addDays(new Date(), -120).toISOString();
    const bySubject = {};
    for (const m of listData(await db.collection(C.meetings).where("startAt", ">=", since).get())) {
      if (!m.subject || m.status === "cancelled") continue;
      const k = m.subject.trim();
      bySubject[k] ||= { students: new Set(), teachers: new Set() };
      (m.studentIds || []).forEach((id) => bySubject[k].students.add(id));
      if (m.teacherId) bySubject[k].teachers.add(m.teacherId);
    }
    // …and each student's subject teachers
    for (const s of people.filter((u) => u.role === "student")) {
      for (const r of subjectTeachersOf(s)) {
        if (!r.subject || !r.teacherId) continue;
        const k = Object.keys(bySubject).find((x) => sameSubject(x, r.subject)) || r.subject.trim();
        bySubject[k] ||= { students: new Set(), teachers: new Set() };
        bySubject[k].students.add(s.id);
        bySubject[k].teachers.add(r.teacherId);
      }
    }
    for (const [subject, v] of Object.entries(bySubject).sort()) {
      t.push({ key: `subject_${subject}`, label: `Subject: ${subject}`, name: `${subject} – Students`, memberIds: [...v.teachers, ...v.students].filter((id) => live.has(id)) });
    }
    res.json({ templates: t.map((x) => ({ managerIds: [], onlyAdminsPost: false, ...x, memberIds: [...new Set(x.memberIds)], count: new Set(x.memberIds).size })) });
  })
);

groupsR.post(
  "/admin/groups",
  ...gAdmin,
  ah(async (req, res) => {
    const g = await cleanGroup(req.body);
    const id = `grp__${db.collection(C.conversations).doc().id}`;
    const created = justBefore(nowIso());
    await convRef(id).set({
      kind: "group",
      name: g.name,
      description: g.description,
      onlyAdminsPost: g.onlyAdminsPost,
      memberIds: [],
      participants: [],
      managerIds: [],
      unread: {},
      joinedAt: {},
      messageCount: 0,
      createdBy: req.user.id,
      createdByName: req.user.name,
      createdAt: created,
      lastAt: created,
    });
    await addSystemLine(id, `${ACADEMY} created the group “${g.name}”`, created);
    const c = (await convRef(id).get()).data();
    await changeMembers({ id, ...c }, { add: g.memberIds, managerIds: g.managerIds }, ACADEMY);
    await audit(req, "groups.create", { targetType: "conversation", targetId: id, summary: `Created group "${g.name}" with ${plural(g.memberIds.length, "member")}` });
    res.status(201).json({ id });
  })
);

groupsR.patch(
  "/admin/groups/:id",
  ...gAdmin,
  ah(async (req, res) => {
    const c = await loadConversation(req, false, true);
    const g = await cleanGroup(req.body, c);
    await convRef(c.id).update({ name: g.name, description: g.description, onlyAdminsPost: g.onlyAdminsPost, updatedAt: nowIso() });
    if (g.name !== c.name) await addSystemLine(c.id, `${ACADEMY} renamed the group to “${g.name}”`);
    if (g.onlyAdminsPost !== !!c.onlyAdminsPost) await addSystemLine(c.id, g.onlyAdminsPost ? "Only the academy and group managers can send messages now" : "All members can send messages now");
    const out = await changeMembers(
      { ...c, name: g.name },
      { add: g.memberIds.filter((id) => !(c.memberIds || []).includes(id)), remove: (c.memberIds || []).filter((id) => !g.memberIds.includes(id)), managerIds: g.managerIds },
      ACADEMY
    );
    await audit(req, "groups.update", { targetType: "conversation", targetId: c.id, summary: `Updated group "${g.name}" (+${out.added.length} / −${out.removed.length} members, ${plural(out.managers.length, "manager")})` });
    res.json({ ok: true });
  })
);

groupsR.delete(
  "/admin/groups/:id",
  ...gAdmin,
  ah(async (req, res) => {
    const c = await loadConversation(req, false, true);
    await purgeConversation(convRef(c.id));
    await audit(req, "groups.delete", { targetType: "conversation", targetId: c.id, summary: `Deleted group "${c.name}" and its ${plural(c.messageCount || 0, "message")}` });
    res.json({ ok: true });
  })
);

router.use(member, direct, groupChat, groupsR, adminR);

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

/** Delete a conversation with all its messages and files. */
async function purgeConversation(ref) {
  const m = await ref.collection("messages").get();
  await deleteStored(m.docs.map((d) => d.data().file?.path));
  for (const d of m.docs) await d.ref.delete();
  const files = await db.collection(C.messageFiles).where("conversationId", "==", ref.id).get();
  for (const f of files.docs) await f.ref.delete();
  await ref.delete();
}

/** Remove every conversation of a user (account purge). In groups they are only taken out. */
export async function deleteConversationsOf(userId) {
  const qs = await db.collection(C.conversations).where("participants", "array-contains", userId).get();
  for (const c of qs.docs) {
    const g = c.data();
    if (isGroup(g)) {
      const update = { memberIds: (g.memberIds || []).filter((id) => id !== userId), participants: (g.participants || []).filter((id) => id !== userId), managerIds: (g.managerIds || []).filter((id) => id !== userId) };
      for (const f of MEMBER_FIELDS) update[`${f}.${userId}`] = FieldValue.delete();
      await c.ref.update(update);
      continue;
    }
    await purgeConversation(c.ref);
  }
}

export default router;
