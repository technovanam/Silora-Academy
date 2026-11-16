// ============================================================================
// SECURE FILE STORAGE
// - Validates type by extension AND file signature ("magic bytes")
// - Optional malware scan through a ClamAV daemon (open source)
// - Files live in Firebase Storage and are only served through the API,
//   using short-lived signed links (no public URLs)
// ============================================================================
import net from "net";
import path from "path";
import config from "../config.js";
import { bucket } from "../firebase.js";
import { fail, signToken } from "../util.js";

const SIGNATURES = {
  pdf: (b) => b.slice(0, 4).toString() === "%PDF",
  png: (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  gif: (b) => b.slice(0, 4).toString() === "GIF8",
  webp: (b) => b.slice(0, 4).toString() === "RIFF" && b.slice(8, 12).toString() === "WEBP",
  zip: (b) => b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05),
  ole: (b) => b.slice(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
  mp4: (b) => b.slice(4, 8).toString() === "ftyp",
  webm: (b) => b.slice(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])),
  mp3: (b) => b.slice(0, 3).toString() === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0),
  wav: (b) => b.slice(0, 4).toString() === "RIFF" && b.slice(8, 12).toString() === "WAVE",
  text: (b) => !b.slice(0, 8192).includes(0),
};

// extension → [signature check, content type, label]
export const MATERIAL_TYPES = {
  pdf: ["pdf", "application/pdf", "PDF"],
  doc: ["ole", "application/msword", "Word"],
  docx: ["zip", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Word"],
  ppt: ["ole", "application/vnd.ms-powerpoint", "PowerPoint"],
  pptx: ["zip", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "PowerPoint"],
  xls: ["ole", "application/vnd.ms-excel", "Excel"],
  xlsx: ["zip", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Excel"],
  txt: ["text", "text/plain; charset=utf-8", "Text"],
  csv: ["text", "text/csv; charset=utf-8", "CSV"],
  png: ["png", "image/png", "Image"],
  jpg: ["jpg", "image/jpeg", "Image"],
  jpeg: ["jpg", "image/jpeg", "Image"],
  gif: ["gif", "image/gif", "Image"],
  webp: ["webp", "image/webp", "Image"],
  mp4: ["mp4", "video/mp4", "Video"],
  webm: ["webm", "video/webm", "Video"],
  mp3: ["mp3", "audio/mpeg", "Audio"],
  m4a: ["mp4", "audio/mp4", "Audio"],
  zip: ["zip", "application/zip", "ZIP"],
};
export const RECORDING_TYPES = {
  mp4: MATERIAL_TYPES.mp4,
  webm: MATERIAL_TYPES.webm,
  mp3: MATERIAL_TYPES.mp3,
  m4a: MATERIAL_TYPES.m4a,
  wav: ["wav", "audio/wav", "Audio"],
};

const BLOCKED_SIGNATURES = [
  (b) => b[0] === 0x4d && b[1] === 0x5a, // Windows executable (MZ)
  (b) => b.slice(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])), // ELF
  (b) => b.slice(0, 2).toString() === "#!", // scripts
];

export function safeFileName(name) {
  const base = path.basename(String(name || "file")).normalize("NFKD");
  return base.replace(/[^\w.\- ()]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "file";
}

/** Validate an uploaded buffer. Returns { ext, contentType, label }. Throws 400 on failure. */
export function validateFile(buffer, originalName, allowed = MATERIAL_TYPES, maxMb = config.maxMaterialMb) {
  if (!buffer?.length) fail(400, "The file is empty");
  if (buffer.length > maxMb * 1024 * 1024) fail(400, `File is too large (max ${maxMb} MB)`);
  const ext = path.extname(originalName || "").slice(1).toLowerCase();
  const rule = allowed[ext];
  if (!rule) fail(400, `This file type isn't allowed. Allowed: ${Object.keys(allowed).join(", ")}`);
  const head = buffer.subarray(0, 8192);
  if (BLOCKED_SIGNATURES.some((f) => f(head))) fail(400, "Executable or script files aren't allowed");
  if (!SIGNATURES[rule[0]](head)) fail(400, `The file content doesn't match a .${ext} file`);
  return { ext, contentType: rule[1], label: rule[2] };
}

/**
 * Malware scan through a ClamAV daemon (clamd INSTREAM). Returns
 * { status: "clean" | "infected" | "skipped" | "error", detail }.
 */
export function scanBuffer(buffer) {
  if (!config.clamdHost) return Promise.resolve({ status: "skipped", detail: "Malware scanner not configured" });
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: config.clamdHost, port: config.clamdPort });
    let reply = "";
    socket.setTimeout(60000);
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      for (let i = 0; i < buffer.length; i += 64 * 1024) {
        const part = buffer.subarray(i, i + 64 * 1024);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(part.length);
        socket.write(len);
        socket.write(part);
      }
      socket.write(Buffer.alloc(4)); // zero-length chunk ends the stream
    });
    socket.on("data", (d) => (reply += d.toString()));
    socket.on("end", () => {
      const r = reply.replace(/\0/g, "").trim();
      if (/OK$/.test(r)) resolve({ status: "clean", detail: "ClamAV: OK" });
      else if (/FOUND$/.test(r)) resolve({ status: "infected", detail: r });
      else resolve({ status: "error", detail: r || "No reply from scanner" });
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve({ status: "error", detail: "Scanner timed out" });
    });
    socket.on("error", (e) => resolve({ status: "error", detail: e.message }));
  });
}

/** Validate + scan + store. Returns file metadata to save in Firestore. */
export async function storeUpload(storagePath, file, allowed = MATERIAL_TYPES, maxMb) {
  const info = validateFile(file.buffer, file.originalname, allowed, maxMb);
  const scan = await scanBuffer(file.buffer);
  if (scan.status === "infected") fail(400, "This file was blocked by the malware scanner");
  await bucket.file(storagePath).save(file.buffer, {
    contentType: info.contentType,
    resumable: false,
    metadata: { metadata: { originalName: safeFileName(file.originalname), scan: scan.status } },
  });
  return {
    path: storagePath,
    fileName: safeFileName(file.originalname),
    contentType: info.contentType,
    kind: info.label,
    size: file.buffer.length,
    scan: scan.status,
  };
}

export async function deleteStored(paths) {
  await Promise.all((paths || []).filter(Boolean).map((p) => bucket.file(p).delete({ ignoreNotFound: true }).catch(() => {})));
}

/** A link the browser can open directly (valid for a few minutes). */
export function fileLink({ path: p, fileName, contentType, download }) {
  const token = signToken({ p, n: fileName, t: contentType, d: download ? 1 : 0 });
  return `${config.apiPublicUrl}/api/portal/files/${token}`;
}

/** Stream a stored file, supporting HTTP Range (needed for video seeking). */
export async function streamFile(req, res, { p, n, t, d }) {
  const file = bucket.file(p);
  const [exists] = await file.exists();
  if (!exists) fail(404, "File not found");
  const [meta] = await file.getMetadata();
  const size = Number(meta.size);
  const type = t || meta.contentType || "application/octet-stream";
  res.setHeader("Content-Type", type);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", `${d ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(n || "file")}`);

  const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      res.status(416).setHeader("Content-Range", `bytes */${size}`);
      return res.end();
    }
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
    res.setHeader("Content-Length", end - start + 1);
    file.createReadStream({ start, end }).on("error", () => res.destroy()).pipe(res);
  } else {
    res.setHeader("Content-Length", size);
    file.createReadStream().on("error", () => res.destroy()).pipe(res);
  }
}
