// ============================================================
// PORTAL API CLIENT – adds the Firebase ID token to each request
// ============================================================
import { API_BASE_URL } from "../../config.js";
import { auth } from "./firebase.js";

export const PORTAL_API = `${API_BASE_URL}/api/portal`;
const SESSION_CODES = ["session_expired", "session_timeout", "inactive", "no_account", "unauthenticated"];

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function headers(extra = {}) {
  const h = { ...extra };
  const user = auth.currentUser;
  if (user) h.Authorization = `Bearer ${await user.getIdToken()}`;
  return h;
}

async function handle(res) {
  const type = res.headers.get("content-type") || "";
  const data = type.includes("application/json") ? await res.json().catch(() => ({})) : null;
  if (!res.ok) {
    const err = new ApiError(data?.error || `Request failed (${res.status})`, res.status, data?.code);
    if (res.status === 401 && SESSION_CODES.includes(err.code)) window.dispatchEvent(new CustomEvent("portal:session-ended", { detail: err }));
    if (res.status === 403 && err.code === "inactive") window.dispatchEvent(new CustomEvent("portal:session-ended", { detail: err }));
    throw err;
  }
  return data;
}

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(PORTAL_API + path, {
      method,
      headers: await headers(body !== undefined ? { "Content-Type": "application/json" } : {}),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0, "network");
  }
  return handle(res);
}

export const api = {
  get: (path, params) => {
    const qs = params ? `?${new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""))}` : "";
    return request("GET", path + (qs === "?" ? "" : qs));
  },
  post: (path, body = {}) => request("POST", path, body),
  put: (path, body = {}) => request("PUT", path, body),
  patch: (path, body = {}) => request("PATCH", path, body),
  del: (path) => request("DELETE", path),

  /** Multipart upload with progress (XHR so we can show a progress bar). */
  upload: async (path, formData, onProgress) => {
    const h = await headers();
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", PORTAL_API + path);
      Object.entries(h).forEach(([k, v]) => xhr.setRequestHeader(k, v));
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
      xhr.onload = () => {
        let data = {};
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          /* not JSON */
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new ApiError(data.error || `Upload failed (${xhr.status})`, xhr.status, data.code));
      };
      xhr.onerror = () => reject(new ApiError("Upload failed – check your connection.", 0, "network"));
      xhr.send(formData);
    });
  },

  /** Download a CSV (or other file) from an authenticated endpoint. */
  download: async (path, params, fallbackName = "export.csv") => {
    const qs = params ? `?${new URLSearchParams(params)}` : "";
    const res = await fetch(PORTAL_API + path + qs, { headers: await headers() });
    if (!res.ok) await handle(res);
    const blob = await res.blob();
    const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") || "")?.[1] || fallbackName;
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  },
};
