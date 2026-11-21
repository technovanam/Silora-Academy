// ============================================================
// Lazy-loaded pages that survive a new deploy.
// After a deploy the old page files are gone; a browser still showing the
// old version would fail to open the next page ("Failed to fetch
// dynamically imported module"). Then we reload once to get the new version.
// ============================================================
import React from "react";

const KEY = "silora.reloadedForUpdate";

function reloadOnce() {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < 60000) return false; // already tried – show the real error
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* storage blocked – still try once */
  }
  window.location.reload();
  return true;
}

export const lazyPage = (load) =>
  React.lazy(() =>
    load().catch((err) => {
      if (reloadOnce()) return new Promise(() => {}); // the page is reloading
      throw err;
    })
  );

// Vite's own preloading of page files
if (typeof window !== "undefined") {
  window.addEventListener("vite:preloadError", (e) => {
    if (reloadOnce()) e.preventDefault();
  });
}
