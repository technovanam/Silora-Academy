// ============================================================
// Save a file and know whether it was really saved.
//
// A plain <a download> / location change can't tell us if the
// person pressed Cancel in the browser's save dialog. So:
//  • Chrome / Edge (File System Access API): we show the save
//    dialog ourselves – Cancel is reported – and write the file;
//    the promise resolves only when the last byte is on disk.
//  • Other browsers: the file is downloaded in the page first and
//    handed to the browser only once it's complete.
// Returns true when saved, false when cancelled.
// ============================================================

/** Stream a fetch response into `write`, reporting progress (0–100). */
async function pump(res, write, onProgress) {
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    await write(value);
    got += value.byteLength;
    if (total && onProgress) onProgress(Math.min(100, Math.round((got / total) * 100)));
  }
}

async function fetchOk(url) {
  const res = await fetch(url);
  if (!res.ok) {
    let msg = "The file couldn't be downloaded. Please try again.";
    try {
      const body = await res.json();
      msg = body.error?.message || body.message || body.error || msg;
      if (typeof msg !== "string") msg = "The file couldn't be downloaded. Please try again.";
    } catch {
      /* not JSON */
    }
    throw new Error(msg);
  }
  return res;
}

/**
 * @param getUrl   async () => url  (called after the save dialog, so the link is fresh)
 * @param fileName suggested file name
 * Must be called straight from a click handler (the save dialog needs the click).
 */
export async function saveFile(getUrl, fileName, { onProgress } = {}) {
  let handle = null;
  if (typeof window.showSaveFilePicker === "function" && window.self === window.top) {
    try {
      handle = await window.showSaveFilePicker({ suggestedName: fileName || "download" });
    } catch (e) {
      if (e?.name === "AbortError") return false; // Cancel in the save dialog
      handle = null; // not allowed here (e.g. a blocked file type) – use the fallback
    }
  }
  const url = await getUrl();
  const res = await fetchOk(url);

  if (handle) {
    const out = await handle.createWritable();
    try {
      await pump(res, (chunk) => out.write(chunk), onProgress);
      await out.close();
    } catch (e) {
      await out.abort().catch(() => {});
      throw e;
    }
    return true;
  }

  // Fallback: complete the download in the page, then hand it to the browser
  const parts = [];
  await pump(res, (chunk) => parts.push(chunk), onProgress);
  const blob = new Blob(parts, { type: res.headers.get("content-type") || "application/octet-stream" });
  const href = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href, download: fileName || "download" });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60000);
  return true;
}
