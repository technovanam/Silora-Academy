// ============================================================================
// BACKUP & RECOVERY – JSON snapshots of the portal database in Storage.
// (Uploaded files are already in Storage and are not duplicated.)
// ============================================================================
import zlib from "zlib";
import { promisify } from "util";
import { db, bucket, BACKUP_COLLECTIONS } from "../firebase.js";
import { nowIso, chunk } from "../util.js";
import { getSettings } from "./core.js";

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const PREFIX = "backups/";

export async function createBackup(by = "system") {
  const data = {};
  let docs = 0;
  for (const name of BACKUP_COLLECTIONS) {
    const qs = await db.collection(name).get();
    data[name] = Object.fromEntries(qs.docs.map((d) => [d.id, d.data()]));
    docs += qs.size;
  }
  const at = nowIso();
  const id = at.replace(/[:.]/g, "-");
  const body = await gzip(Buffer.from(JSON.stringify({ version: 1, createdAt: at, createdBy: by, collections: data })));
  await bucket.file(`${PREFIX}${id}.json.gz`).save(body, {
    contentType: "application/gzip",
    resumable: false,
    metadata: { metadata: { createdAt: at, createdBy: by, docs: String(docs) } },
  });
  await pruneBackups();
  return { id, createdAt: at, docs, size: body.length };
}

export async function listBackups() {
  const [files] = await bucket.getFiles({ prefix: PREFIX });
  return files
    .filter((f) => f.name.endsWith(".json.gz"))
    .map((f) => ({
      id: f.name.slice(PREFIX.length, -".json.gz".length),
      path: f.name,
      size: Number(f.metadata.size || 0),
      createdAt: f.metadata.metadata?.createdAt || f.metadata.timeCreated,
      createdBy: f.metadata.metadata?.createdBy || "",
      docs: Number(f.metadata.metadata?.docs || 0),
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

async function pruneBackups() {
  const keep = (await getSettings()).retention.backupsKeep || 14;
  const list = await listBackups();
  await Promise.all(list.slice(keep).map((b) => bucket.file(b.path).delete({ ignoreNotFound: true })));
}

/** Restore selected collections from a backup. Documents not in the backup are removed. */
export async function restoreBackup(id, collections = BACKUP_COLLECTIONS) {
  const file = bucket.file(`${PREFIX}${id}.json.gz`);
  const [exists] = await file.exists();
  if (!exists) throw Object.assign(new Error("Backup not found"), { status: 404 });
  const [buf] = await file.download();
  const snapshot = JSON.parse((await gunzip(buf)).toString("utf8"));
  const result = {};
  for (const name of collections) {
    if (!BACKUP_COLLECTIONS.includes(name)) continue;
    const wanted = snapshot.collections[name] || {};
    const current = await db.collection(name).get();
    const ops = [];
    current.docs.forEach((d) => !(d.id in wanted) && ops.push((b) => b.delete(d.ref)));
    Object.entries(wanted).forEach(([docId, value]) => ops.push((b) => b.set(db.collection(name).doc(docId), value)));
    for (const group of chunk(ops, 400)) {
      const b = db.batch();
      group.forEach((op) => op(b));
      await b.commit();
    }
    result[name] = Object.keys(wanted).length;
  }
  return { restored: result, backupCreatedAt: snapshot.createdAt };
}
