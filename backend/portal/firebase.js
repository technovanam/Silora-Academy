// ============================================================================
// FIREBASE ADMIN – Firestore, Auth and Storage (emulators in development)
// ============================================================================
// config.js must load first: it points the Admin SDK at the emulators
import config from "./config.js";
import fs from "fs";
import { initializeApp, cert, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";
import { getMessaging } from "firebase-admin/messaging";

function init() {
  if (getApps().length) return getApps()[0];
  const options = { projectId: config.projectId, storageBucket: config.storageBucket };
  if (!config.useEmulators) {
    options.credential =
      config.serviceAccountPath && fs.existsSync(config.serviceAccountPath)
        ? cert(JSON.parse(fs.readFileSync(config.serviceAccountPath, "utf8")))
        : applicationDefault();
  }
  return initializeApp(options);
}

const app = init();

// Named database support: the production project uses a database called "default"
export const db = config.firestoreDatabaseId && !config.useEmulators ? getFirestore(app, config.firestoreDatabaseId) : getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });

export const auth = getAuth(app);
export const bucket = getStorage(app).bucket();
export const messaging = () => getMessaging(app);
export { FieldValue };

// Collection names in one place
export const C = {
  users: "users",
  contacts: "contacts", // contact details – admin + the user themselves only
  loginEvents: "loginEvents",
  meetings: "meetings",
  scheduleRequests: "scheduleRequests",
  materials: "materials",
  materialOpens: "materialOpens",
  favourites: "favourites",
  lessons: "lessons",
  notes: "studentNotes",
  attendance: "attendance",
  notifications: "notifications",
  pushTokens: "pushTokens",
  announcements: "announcements",
  announcementReads: "announcementReads",
  recordings: "recordings",
  conversations: "conversations", // teacher–student chats (+ messages subcollection)
  messageFiles: "messageFiles", // chat attachments and when to delete them
  transcriptParts: "transcriptParts", // per-speaker transcript pieces (backend only)
  activity: "activityLogs",
  audit: "auditLogs",
  settings: "settings",
};

export const BACKUP_COLLECTIONS = Object.values(C);
