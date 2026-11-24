// ============================================================
// FIREBASE (client) – only Authentication is used directly.
// All data goes through the portal API, which enforces roles.
// ============================================================
import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator, browserLocalPersistence, setPersistence } from "firebase/auth";

const env = import.meta.env;
export const USE_EMULATORS = env.VITE_USE_FIREBASE_EMULATORS !== "false";

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || "demo-api-key",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || "demo-silora.firebaseapp.com",
  projectId: env.VITE_FIREBASE_PROJECT_ID || "demo-silora",
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || "demo-silora.appspot.com",
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: env.VITE_FIREBASE_APP_ID || "",
};

export const app = initializeApp(firebaseConfig, "portal");
export const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(() => {});

if (USE_EMULATORS) {
  connectAuthEmulator(auth, env.VITE_AUTH_EMULATOR_URL || "http://127.0.0.1:9099", { disableWarnings: true });
}

// Browser push (Firebase Cloud Messaging). Needs a real project + VAPID key.
export const pushConfigured = () => !USE_EMULATORS && !!env.VITE_FIREBASE_VAPID_KEY && typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator;

let listening = false;

// Resolves once the registration has an active service worker (gives up after 15 s)
function activeWorker(registration) {
  if (registration.active) return Promise.resolve(registration);
  const failed = () => new Error("Notifications couldn't start. Please reload the page and try again.");
  return new Promise((resolve, reject) => {
    const sw = registration.installing || registration.waiting;
    const timer = setTimeout(() => reject(failed()), 15000);
    const done = () => {
      clearTimeout(timer);
      resolve(registration);
    };
    if (!sw) return navigator.serviceWorker.ready.then(done, reject);
    sw.addEventListener("statechange", () => {
      if (sw.state === "activated") done();
      else if (sw.state === "redundant") {
        clearTimeout(timer);
        reject(failed());
      }
    });
  });
}

async function connectPush(registerToken) {
  const { getMessaging, getToken, isSupported, onMessage } = await import("firebase/messaging");
  if (!(await isSupported())) throw new Error("This browser doesn't support push notifications.");
  const params = new URLSearchParams(Object.entries(firebaseConfig).filter(([, v]) => v));
  const registration = await navigator.serviceWorker.register(`/firebase-messaging-sw.js?${params}`);
  // The first time, the worker is still installing: push can only subscribe once it is active
  await activeWorker(registration);
  const messaging = getMessaging(app);
  const token = await getToken(messaging, { vapidKey: env.VITE_FIREBASE_VAPID_KEY, serviceWorkerRegistration: registration });
  await registerToken(token);
  // While the portal is open and in front, show the message inside the page instead
  if (!listening) {
    listening = true;
    onMessage(messaging, (payload) => window.dispatchEvent(new CustomEvent("portal:push", { detail: payload.data || payload.notification || {} })));
  }
  return token;
}

/** Ask permission (button / prompt) and register this browser. */
export async function enablePush(registerToken) {
  if (USE_EMULATORS || !env.VITE_FIREBASE_VAPID_KEY) throw new Error("Push notifications aren't configured for this environment yet.");
  if (!("Notification" in window) || !("serviceWorker" in navigator)) throw new Error("This browser doesn't support push notifications.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications were blocked in the browser settings.");
  return connectPush(registerToken);
}

/** Already allowed earlier: refresh the token silently on each visit (tokens rotate). */
export async function resumePush(registerToken) {
  if (!pushConfigured() || Notification.permission !== "granted") return null;
  return connectPush(registerToken).catch(() => null);
}
