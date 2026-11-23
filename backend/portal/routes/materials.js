// ============================================================================
// LEARNING MATERIALS – upload, versions, scheduled publishing, assignment,
// "opened" tracking (Mandatory rule 1: we only ever say OPENED, never "read")
// and favourites. Also serves signed file links.
// ============================================================================
import { Router } from "express";
import multer from "multer";
import config from "../config.js";
import { db, C } from "../firebase.js";
import { ah, fail, nowIso, str, toIso, listData, getMany, verifyToken, plural } from "../util.js";
import { requireRole } from "../middleware.js";
import { hasPerm, logActivity, audit } from "../services/core.js";
import { notify, notifyAdmins } from "../services/notify.js";
import { storeUpload, deleteStored, fileLink, streamFile, MATERIAL_TYPES, safeFileName } from "../services/files.js";

const router = Router();
export const filesRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxMaterialMb * 1024 * 1024, files: 1 } });

const parseList = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v.trim().startsWith("[")) {
    try {
      return JSON.parse(v);
    } catch {
      return [];
    }
  }
  return v ? String(v).split(",") : [];
};

function isLive(m) {
  return !m.deletedAt && m.status === "published";
}

function canManage(user, m) {
  if (user.role === "admin") return hasPerm(user, "materials");
  return user.role === "teacher" && m.teacherId === user.id;
}

async function loadMaterial(id) {
  const snap = await db.collection(C.materials).doc(id).get();
  if (!snap.exists || snap.data().deletedAt) fail(404, "Material not found");
  return { id: snap.id, ...snap.data() };
}

async function validateAssignees(user, teacherId, ids) {
  const list = [...new Set(parseList(ids).map((s) => str(s, 60)).filter(Boolean))];
  if (!list.length) return [];
  const users = await getMany(db, C.users, list);
  for (const id of list) {
    const s = users[id];
    if (!s || s.role !== "student" || s.deletedAt) fail(400, "One of the selected students was not found");
    if (user.role === "teacher" && s.teacherId !== user.id) fail(403, "You can only assign materials to your own students");
    if (user.role === "admin" && teacherId && s.teacherId !== teacherId) fail(400, `${s.name} is not assigned to this material's teacher`);
  }
  return list;
}

// Shape for teachers/admins (with tracking counts) or students (with own opened status)
function shapeForStaff(m, opens, names) {
  const assigned = m.studentIds || [];
  const opened = opens.filter((o) => o.materialId === m.id && assigned.includes(o.studentId));
  return {
    id: m.id,
    title: m.title,
    description: m.description || "",
    subject: m.subject || "",
    folder: m.folder || "",
    teacherId: m.teacherId,
    teacherName: names[m.teacherId] || "",
    status: m.status,
    publishAt: m.publishAt || null,
    publishedAt: m.publishedAt || null,
    version: m.version || 1,
    file: { fileName: m.file?.fileName, kind: m.file?.kind, size: m.file?.size, contentType: m.file?.contentType, scan: m.file?.scan },
    studentIds: assigned,
    students: assigned.map((id) => ({ id, name: names[id] || "Student" })),
    assignedCount: assigned.length,
    openedCount: opened.length,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt || m.createdAt,
  };
}

function shapeForStudent(m, open, fav, names) {
  return {
    id: m.id,
    title: m.title,
    description: m.description || "",
    subject: m.subject || "",
    folder: m.folder || "",
    teacherName: names[m.teacherId] || "",
    version: m.version || 1,
    publishedAt: m.publishedAt || m.createdAt,
    updatedAt: m.updatedAt || m.createdAt,
    file: { fileName: m.file?.fileName, kind: m.file?.kind, size: m.file?.size, contentType: m.file?.contentType },
    opened: !!open,
    firstOpenedAt: open?.firstOpenedAt || null,
    lastOpenedAt: open?.lastOpenedAt || null,
    favourite: !!fav,
    isNew: !open,
  };
}

async function nameMap(ids) {
  const users = await getMany(db, C.users, ids);
  return Object.fromEntries(Object.values(users).map((u) => [u.id, u.name]));
}

/** Publish a material now and notify its assigned students (used by the scheduler too). */
export async function publishMaterial(m, studentIds = m.studentIds || []) {
  const at = nowIso();
  await db.collection(C.materials).doc(m.id).update({ status: "published", publishedAt: m.publishedAt || at, notifiedIds: [...new Set([...(m.notifiedIds || []), ...studentIds])] });
  const fresh = studentIds.filter((id) => !(m.notifiedIds || []).includes(id));
  if (fresh.length)
    await notify(fresh, { type: "material_new", title: `New material: ${m.title}`, body: `${m.subject ? `${m.subject} · ` : ""}${m.file?.kind || "File"} – open it in your portal.`, link: "/portal/student/materials", refId: m.id });
}

// ---- List -------------------------------------------------------------------------
router.get(
  "/materials",
  ah(async (req, res) => {
    const u = req.user;
    if (u.role === "student") {
      const [qs, opensQs, favQs] = await Promise.all([
        db.collection(C.materials).where("studentIds", "array-contains", u.id).get(),
        db.collection(C.materialOpens).where("studentId", "==", u.id).get(),
        db.collection(C.favourites).where("userId", "==", u.id).get(),
      ]);
      const list = listData(qs).filter(isLive);
      const opens = Object.fromEntries(listData(opensQs).map((o) => [o.materialId, o]));
      const favs = new Set(listData(favQs).map((f) => f.materialId));
      const names = await nameMap(list.map((m) => m.teacherId));
      const out = list.map((m) => shapeForStudent(m, opens[m.id], favs.has(m.id), names)).sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
      return res.json({ materials: out });
    }
    let list;
    if (u.role === "teacher") list = listData(await db.collection(C.materials).where("teacherId", "==", u.id).get());
    else {
      if (!hasPerm(u, "materials")) fail(403, "Your admin account doesn't have the materials permission");
      list = listData(await db.collection(C.materials).get());
      if (req.query.teacherId) list = list.filter((m) => m.teacherId === req.query.teacherId);
    }
    list = list.filter((m) => !m.deletedAt);
    if (req.query.studentId) list = list.filter((m) => (m.studentIds || []).includes(req.query.studentId));
    const opens = listData(await db.collection(C.materialOpens).get()).filter((o) => list.some((m) => m.id === o.materialId));
    const names = await nameMap(list.flatMap((m) => [m.teacherId, ...(m.studentIds || [])]));
    const out = list.map((m) => shapeForStaff(m, opens, names)).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    res.json({ materials: out, folders: [...new Set(out.map((m) => m.folder).filter(Boolean))].sort() });
  })
);

router.get(
  "/materials/:id",
  ah(async (req, res) => {
    const m = await loadMaterial(req.params.id);
    if (req.user.role === "student") {
      if (!(m.studentIds || []).includes(req.user.id) || !isLive(m)) fail(404, "Material not found");
      const [open, fav] = await Promise.all([db.collection(C.materialOpens).doc(`${m.id}_${req.user.id}`).get(), db.collection(C.favourites).doc(`${req.user.id}_${m.id}`).get()]);
      const names = await nameMap([m.teacherId]);
      return res.json({ material: shapeForStudent(m, open.exists ? open.data() : null, fav.exists, names) });
    }
    if (!canManage(req.user, m)) fail(404, "Material not found");
    const opens = listData(await db.collection(C.materialOpens).where("materialId", "==", m.id).get());
    const names = await nameMap([m.teacherId, ...(m.studentIds || [])]);
    res.json({
      material: {
        ...shapeForStaff(m, opens, names),
        versions: (m.versions || []).map((v) => ({ version: v.version, fileName: v.file?.fileName, size: v.file?.size, kind: v.file?.kind, uploadedAt: v.uploadedAt, note: v.note || "" })),
      },
    });
  })
);

// ---- Create (multipart: file + fields) -------------------------------------------
router.post(
  "/materials",
  requireRole("teacher", "admin"),
  upload.single("file"),
  ah(async (req, res) => {
    if (req.user.role === "admin" && !hasPerm(req.user, "materials")) fail(403, "Your admin account doesn't have the materials permission");
    if (!req.file) fail(400, "Choose a file to upload");
    const title = str(req.body.title, 150) || safeFileName(req.file.originalname).replace(/\.[^.]+$/, "");
    const teacherId = req.user.role === "teacher" ? req.user.id : str(req.body.teacherId, 60) || null;
    const studentIds = await validateAssignees(req.user, teacherId, req.body.studentIds);
    const publishAt = req.body.publishAt ? toIso(req.body.publishAt) : null;
    const scheduled = publishAt && publishAt > nowIso();

    const ref = db.collection(C.materials).doc();
    const file = await storeUpload(`materials/${ref.id}/v1-${Date.now()}-${safeFileName(req.file.originalname)}`, req.file, MATERIAL_TYPES, config.maxMaterialMb);
    const at = nowIso();
    const doc = {
      title,
      description: str(req.body.description, 1000),
      subject: str(req.body.subject, 80),
      folder: str(req.body.folder, 80),
      teacherId,
      uploadedBy: req.user.id,
      studentIds,
      file,
      version: 1,
      versions: [{ version: 1, file, uploadedAt: at, uploadedBy: req.user.id, note: "First upload" }],
      status: scheduled ? "scheduled" : "published",
      publishAt: scheduled ? publishAt : null,
      publishedAt: scheduled ? null : at,
      notifiedIds: [],
      createdAt: at,
      updatedAt: at,
    };
    await ref.set(doc);
    if (!scheduled) await publishMaterial({ id: ref.id, ...doc });
    // Teacher uploads → admins; admin uploads for a teacher's students → that teacher
    const who = studentIds.length ? `${studentIds.length} student${studentIds.length > 1 ? "s" : ""}` : "no students yet";
    const whenTxt = scheduled ? " (scheduled)" : "";
    if (req.user.role === "teacher")
      await notifyAdmins({ type: "material_uploaded", title: `${req.user.name} uploaded material`, body: `"${title}"${whenTxt} for ${who}.`, link: "/portal/admin/materials", refId: ref.id }, "materials");
    else if (teacherId)
      await notify([teacherId], { type: "material_uploaded", title: `New material for your students: ${title}`, body: `Added by ${req.user.name}${whenTxt} for ${who}.`, link: "/portal/teacher/materials", refId: ref.id });
    await logActivity(req, "material.upload", { targetType: "material", targetId: ref.id, summary: `Uploaded "${title}"${scheduled ? " (scheduled)" : ""}` });
    res.status(201).json({ id: ref.id });
  })
);

// ---- Edit details / schedule ---------------------------------------------------------
router.patch(
  "/materials/:id",
  requireRole("teacher", "admin"),
  ah(async (req, res) => {
    const m = await loadMaterial(req.params.id);
    if (!canManage(req.user, m)) fail(404, "Material not found");
    const update = { updatedAt: nowIso() };
    for (const [k, max] of [["title", 150], ["description", 1000], ["subject", 80], ["folder", 80]]) if (k in req.body) update[k] = str(req.body[k], max);
    if (update.title === "") delete update.title;
    if ("publishAt" in req.body && m.status !== "published") {
      const publishAt = req.body.publishAt ? toIso(req.body.publishAt) : null;
      if (publishAt && publishAt > nowIso()) Object.assign(update, { status: "scheduled", publishAt });
      else Object.assign(update, { status: "published", publishAt: null });
    }
    await db.collection(C.materials).doc(m.id).update(update);
    if (update.status === "published") await publishMaterial({ ...m, ...update });
    await logActivity(req, "material.edit", { targetType: "material", targetId: m.id, summary: `Edited "${update.title || m.title}"` });
    res.json({ ok: true });
  })
);

// ---- New version of the file (history kept) -------------------------------------------
router.post(
  "/materials/:id/version",
  requireRole("teacher", "admin"),
  upload.single("file"),
  ah(async (req, res) => {
    const m = await loadMaterial(req.params.id);
    if (!canManage(req.user, m)) fail(404, "Material not found");
    if (!req.file) fail(400, "Choose a file to upload");
    const version = (m.version || 1) + 1;
    const file = await storeUpload(`materials/${m.id}/v${version}-${Date.now()}-${safeFileName(req.file.originalname)}`, req.file, MATERIAL_TYPES, config.maxMaterialMb);
    const at = nowIso();
    await db.collection(C.materials).doc(m.id).update({
      file,
      version,
      versions: [...(m.versions || []), { version, file, uploadedAt: at, uploadedBy: req.user.id, note: str(req.body.note, 300) }],
      updatedAt: at,
    });
    if (isLive(m) && (m.studentIds || []).length)
      await notify(m.studentIds, { type: "material_new", title: `Updated material: ${m.title}`, body: `Version ${version} is now available.`, link: "/portal/student/materials", refId: m.id });
    await logActivity(req, "material.version", { targetType: "material", targetId: m.id, summary: `Uploaded version ${version} of "${m.title}"` });
    res.json({ ok: true, version });
  })
);

// ---- Assign / unassign students ------------------------------------------------------
router.post(
  "/materials/:id/assign",
  requireRole("teacher", "admin"),
  ah(async (req, res) => {
    const m = await loadMaterial(req.params.id);
    if (!canManage(req.user, m)) fail(404, "Material not found");
    const studentIds = await validateAssignees(req.user, m.teacherId, req.body.studentIds);
    await db.collection(C.materials).doc(m.id).update({ studentIds, updatedAt: nowIso() });
    if (isLive(m)) await publishMaterial({ ...m, studentIds }, studentIds);
    await logActivity(req, "material.assign", { targetType: "material", targetId: m.id, summary: `Assigned "${m.title}" to ${plural(studentIds.length, "student")}` });
    res.json({ ok: true });
  })
);

router.delete(
  "/materials/:id",
  requireRole("teacher", "admin"),
  ah(async (req, res) => {
    const m = await loadMaterial(req.params.id);
    if (!canManage(req.user, m)) fail(404, "Material not found");
    await deleteStored((m.versions || []).map((v) => v.file?.path).concat(m.file?.path));
    await db.collection(C.materials).doc(m.id).update({ deletedAt: nowIso(), deletedBy: req.user.id, studentIds: [], versions: [], file: null });
    const opens = await db.collection(C.materialOpens).where("materialId", "==", m.id).get();
    const favs = await db.collection(C.favourites).where("materialId", "==", m.id).get();
    const batch = db.batch();
    [...opens.docs, ...favs.docs].forEach((d) => batch.delete(d.ref));
    await batch.commit();
    const fn = req.user.role === "admin" ? audit : logActivity;
    await fn(req, "material.delete", { targetType: "material", targetId: m.id, summary: `Deleted "${m.title}"` });
    res.json({ ok: true });
  })
);

// ---- Open / download link ------------------------------------------------------------
// Getting a link records nothing: a student could still cancel the browser's save
// dialog. The portal calls /opened once the file was actually shown or fully saved.
router.post(
  "/materials/:id/link",
  ah(async (req, res) => {
    const m = await loadMaterial(req.params.id);
    const download = !!req.body?.download;
    const versionNo = Number(req.body?.version || 0);
    if (req.user.role === "student") {
      if (!(m.studentIds || []).includes(req.user.id) || !isLive(m)) fail(404, "Material not found");
    } else if (!canManage(req.user, m)) fail(404, "Material not found");

    let file = m.file;
    if (versionNo && req.user.role !== "student") file = (m.versions || []).find((v) => v.version === versionNo)?.file || file;
    if (!file?.path) fail(404, "File not found");
    res.json({ url: fileLink({ path: file.path, fileName: file.fileName, contentType: file.contentType, download }), contentType: file.contentType, fileName: file.fileName });
  })
);

// ---- "Opened": the student viewed the file, or its download finished --------------------
router.post(
  "/materials/:id/opened",
  requireRole("student"),
  ah(async (req, res) => {
    const m = await loadMaterial(req.params.id);
    if (!(m.studentIds || []).includes(req.user.id) || !isLive(m)) fail(404, "Material not found");
    const download = req.body?.how === "download";
    const ref = db.collection(C.materialOpens).doc(`${m.id}_${req.user.id}`);
    const snap = await ref.get();
    const at = nowIso();
    if (snap.exists) {
      const o = snap.data();
      await ref.update({ lastOpenedAt: at, openCount: (o.openCount || 0) + (download ? 0 : 1), downloadCount: (o.downloadCount || 0) + (download ? 1 : 0) });
    } else {
      await ref.set({ materialId: m.id, studentId: req.user.id, teacherId: m.teacherId, firstOpenedAt: at, lastOpenedAt: at, openCount: download ? 0 : 1, downloadCount: download ? 1 : 0 });
      await logActivity(req, "material.opened", { targetType: "material", targetId: m.id, summary: `${download ? "Downloaded" : "Opened"} "${m.title}"` });
    }
    res.json({ ok: true, at });
  })
);

// ---- Tracking (who opened) -------------------------------------------------------------
router.get(
  "/materials/:id/tracking",
  requireRole("teacher", "admin"),
  ah(async (req, res) => {
    const m = await loadMaterial(req.params.id);
    if (!canManage(req.user, m)) fail(404, "Material not found");
    const opens = Object.fromEntries(listData(await db.collection(C.materialOpens).where("materialId", "==", m.id).get()).map((o) => [o.studentId, o]));
    const names = await nameMap(m.studentIds || []);
    const rows = (m.studentIds || []).map((id) => ({
      studentId: id,
      studentName: names[id] || "Student",
      status: opens[id] ? "opened" : "not_opened",
      firstOpenedAt: opens[id]?.firstOpenedAt || null,
      lastOpenedAt: opens[id]?.lastOpenedAt || null,
      openCount: opens[id]?.openCount || 0,
      downloadCount: opens[id]?.downloadCount || 0,
    }));
    res.json({ material: { id: m.id, title: m.title, publishedAt: m.publishedAt }, rows });
  })
);

// ---- Favourites -----------------------------------------------------------------------
router.post(
  "/materials/:id/favourite",
  requireRole("student"),
  ah(async (req, res) => {
    const m = await loadMaterial(req.params.id);
    if (!(m.studentIds || []).includes(req.user.id)) fail(404, "Material not found");
    const ref = db.collection(C.favourites).doc(`${req.user.id}_${m.id}`);
    if (req.body?.favourite === false) await ref.delete();
    else await ref.set({ userId: req.user.id, materialId: m.id, createdAt: nowIso() });
    res.json({ ok: true, favourite: req.body?.favourite !== false });
  })
);

// ---- Signed file links (public, the token is the permission) --------------------------
filesRouter.get(
  "/files/:token",
  ah(async (req, res) => {
    const payload = verifyToken(req.params.token);
    if (!payload?.p) fail(403, "This link has expired. Go back to the portal and open the file again.");
    await streamFile(req, res, payload);
  })
);

export default router;
