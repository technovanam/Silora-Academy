// ============================================================
// AUTH CONTEXT – sign in through the API (lockout + login history),
// then Firebase custom token. Auto sign-out after inactivity.
// ============================================================
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { onAuthStateChanged, signInWithCustomToken, signOut } from "firebase/auth";
import { auth } from "./firebase.js";
import { api, PORTAL_API } from "./api.js";
import { plural } from "./format.js";

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

const LAST_ACTIVE_KEY = "silora.portal.lastActive";
const readLast = () => {
  try {
    return Number(localStorage.getItem(LAST_ACTIVE_KEY) || 0);
  } catch {
    return 0;
  }
};
const writeLast = (t) => {
  try {
    localStorage.setItem(LAST_ACTIVE_KEY, String(t));
  } catch {
    /* storage blocked */
  }
};

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, teachers: [], settings: null });
  const [endedReason, setEndedReason] = useState(null);
  const lastWrite = useRef(0);

  const loadMe = useCallback(async () => {
    const me = await api.get("/me");
    setState({ loading: false, user: me.user, teachers: me.teachers || [], settings: me.settings });
    return me;
  }, []);

  useEffect(() => {
    return onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) return setState({ loading: false, user: null, teachers: [], settings: null });
      try {
        await loadMe();
      } catch {
        await signOut(auth).catch(() => {});
        setState({ loading: false, user: null, teachers: [], settings: null });
      }
    });
  }, [loadMe]);

  const login = useCallback(
    async (email, password) => {
      const res = await fetch(`${PORTAL_API}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) }).catch(() => null);
      if (!res) throw new Error("Can't reach the server. Check your connection and try again.");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(data.error || "Sign in failed"), { code: data.code });
      writeLast(Date.now());
      setEndedReason(null);
      await signInWithCustomToken(auth, data.customToken);
      return loadMe();
    },
    [loadMe]
  );

  const logout = useCallback(async (why) => {
    const reason = typeof why === "string" ? why : null; // never a click event
    if (auth.currentUser && !reason) await api.post("/auth/logout").catch(() => {});
    await signOut(auth).catch(() => {});
    setEndedReason(reason || null);
    setState({ loading: false, user: null, teachers: [], settings: null });
  }, []);

  // Server says the session is over (timeout, deactivated…)
  useEffect(() => {
    const onEnded = (e) => logout(e.detail?.message || "Your session has ended. Please sign in again.");
    window.addEventListener("portal:session-ended", onEnded);
    return () => window.removeEventListener("portal:session-ended", onEnded);
  }, [logout]);

  // Client-side inactivity timer (shared between tabs through localStorage)
  const timeoutMin = state.settings?.sessionTimeoutMin;
  useEffect(() => {
    if (!state.user || !timeoutMin) return;
    const mark = () => {
      const now = Date.now();
      if (now - lastWrite.current > 15000) {
        lastWrite.current = now;
        writeLast(now);
      }
    };
    if (!readLast()) writeLast(Date.now());
    const events = ["pointerdown", "keydown", "scroll", "touchstart", "mousemove"];
    events.forEach((ev) => window.addEventListener(ev, mark, { passive: true }));
    const timer = setInterval(() => {
      // Don't time out while a class is in progress
      if (document.body.dataset.inClass === "1") return mark();
      if (Date.now() - readLast() > timeoutMin * 60000) logout(`You were signed out after ${plural(timeoutMin, "minute")} of inactivity.`);
    }, 20000);
    return () => {
      events.forEach((ev) => window.removeEventListener(ev, mark));
      clearInterval(timer);
    };
  }, [state.user, timeoutMin, logout]);

  // Demo-class guest link: a temporary sign-in that only opens one class
  const guestLogin = useCallback(
    async (customToken) => {
      await signInWithCustomToken(auth, customToken);
      return loadMe();
    },
    [loadMe]
  );

  const value = { ...state, login, logout, guestLogin, reload: loadMe, endedReason, clearEnded: () => setEndedReason(null) };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

// perm may be a list: any one of them is enough
export const can = (user, perm) => (Array.isArray(perm) ? perm.some((p) => can(user, p)) : user?.role === "admin" && (user.superAdmin || user.permissions === "all" || !!user.permissions?.[perm]));
