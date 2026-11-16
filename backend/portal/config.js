// ============================================================================
// PORTAL CONFIGURATION (all values come from environment variables)
// See backend/.env.example for descriptions.
// ============================================================================

const bool = (v, def = false) => (v === undefined || v === "" ? def : ["1", "true", "yes", "on"].includes(String(v).toLowerCase()));
const num = (v, def) => (v === undefined || v === "" || Number.isNaN(Number(v)) ? def : Number(v));

const useEmulators = bool(process.env.USE_FIREBASE_EMULATORS, true);

// When running against the local Firebase Emulator Suite, the Admin SDK finds the
// emulators through these variables. Set them before firebase-admin initialises.
if (useEmulators) {
  process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8085";
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= "127.0.0.1:9099";
  process.env.FIREBASE_STORAGE_EMULATOR_HOST ||= "127.0.0.1:9199";
}

export const config = {
  useEmulators,
  projectId: process.env.FIREBASE_PROJECT_ID || "demo-silora",
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${process.env.FIREBASE_PROJECT_ID || "demo-silora"}.appspot.com`,
  // Path to a service-account JSON (only needed for a real Firebase project)
  serviceAccountPath: process.env.GOOGLE_APPLICATION_CREDENTIALS || "",
  // Firestore database id ("(default)" unless the project uses a named database)
  firestoreDatabaseId: process.env.FIRESTORE_DATABASE_ID || "",
  // Web API key – used by the backend to verify passwords through the Auth REST API
  webApiKey: process.env.FIREBASE_WEB_API_KEY || "demo-api-key",

  portalUrl: (process.env.PORTAL_URL || "http://localhost:5173").replace(/\/$/, ""),
  apiPublicUrl: (process.env.API_PUBLIC_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/$/, ""),
  timezone: process.env.APP_TIMEZONE || "Asia/Kolkata",

  // Secret used to sign short-lived file links (materials, recordings, backups)
  fileTokenSecret: process.env.FILE_TOKEN_SECRET || "dev-only-change-me-file-token-secret",
  fileTokenTtlSec: num(process.env.FILE_TOKEN_TTL_SEC, 15 * 60),

  // Uploads
  maxMaterialMb: num(process.env.MAX_MATERIAL_MB, 50),
  maxRecordingMb: num(process.env.MAX_RECORDING_MB, 2048),
  // Files sent in Messages: max size and how long they are kept
  maxMessageFileMb: num(process.env.MAX_MESSAGE_FILE_MB, 25),
  messageFileRetentionDays: num(process.env.MESSAGE_FILE_RETENTION_DAYS, 7),
  // Optional ClamAV daemon for malware scanning (open source). Leave empty to skip.
  clamdHost: process.env.CLAMD_HOST || "",
  clamdPort: num(process.env.CLAMD_PORT, 3310),

  // LiveKit (open-source WebRTC SFU, self-hosted). Dev: `livekit-server --dev` (keys devkey / secret).
  livekit: {
    // URL browsers connect to (ws:// locally, wss:// in production)
    url: (process.env.LIVEKIT_URL || "ws://localhost:7880").replace(/\/$/, ""),
    // URL the backend uses for the server API (defaults to LIVEKIT_URL with http/https)
    apiUrl: (process.env.LIVEKIT_API_URL || (process.env.LIVEKIT_URL || "ws://localhost:7880").replace(/^ws/, "http")).replace(/\/$/, ""),
    apiKey: process.env.LIVEKIT_API_KEY || "devkey",
    apiSecret: process.env.LIVEKIT_API_SECRET || "secret",
    roomPrefix: process.env.LIVEKIT_ROOM_PREFIX || "silora-class",
    // Recording through LiveKit Egress (needs the egress service, see livekit/README.md)
    egressEnabled: bool(process.env.LIVEKIT_EGRESS_ENABLED, false),
    // Record every class automatically when the teacher joins. Only admins see that
    // a class is being recorded; teachers and students get no indicator.
    autoRecord: bool(process.env.LIVEKIT_AUTO_RECORD, true),
    // Folder egress writes into (as seen by the egress container) and the same folder as seen by this backend
    egressOutputDir: (process.env.LIVEKIT_EGRESS_OUTPUT_DIR || "/out").replace(/\/$/, ""),
    recordingsDir: process.env.LIVEKIT_RECORDINGS_DIR || "",
  },
  // Automatic transcripts: each person's mic is captured separately and run through a
  // self-hosted whisper.cpp server (see ../whisper/README.md). Empty URL = off.
  whisper: {
    url: (process.env.WHISPER_URL || "").replace(/\/$/, ""),
    language: process.env.WHISPER_LANGUAGE || "auto", // "auto" or a code like "en"
    timeoutMin: num(process.env.WHISPER_TIMEOUT_MIN, 120),
  },
  // Shared secret for uploading a recording through POST /recordings/ingest (scripts / tools)
  recordingIngestSecret: process.env.RECORDING_INGEST_SECRET || "",
  recordingRetentionDays: num(process.env.RECORDING_RETENTION_DAYS, 7),

  // Email goes out through SMTP (backend/mailer.js)
  mailFrom: process.env.MAIL_FROM || process.env.PORTAL_MAIL_FROM || `Silora Academy <${process.env.MAIL_USER || "info@siloraacademy.com"}>`,

  // Run scheduled jobs (reminders, publishing, cleanup, backups) in this process
  enableJobs: bool(process.env.ENABLE_JOBS, true),
};

export default config;
