// ============================================================================
// SILORA ACADEMY PORTAL – mounts every portal API under /api/portal
// ============================================================================
import express, { Router } from "express";
import config from "./config.js";
import "./firebase.js";
import { authenticate, requireRole } from "./middleware.js";
import { publicRouter, meRouter } from "./routes/auth.js";
import adminUsers from "./routes/adminUsers.js";
import admin from "./routes/admin.js";
import dashboard from "./routes/dashboard.js";
import meetings from "./routes/meetings.js";
import live from "./routes/live.js";
import recordings from "./routes/recordings.js";
import materials, { filesRouter } from "./routes/materials.js";
import progress from "./routes/progress.js";
import attendance from "./routes/attendance.js";
import notifications from "./routes/notifications.js";
import messages from "./routes/messages.js";
import { startJobs } from "./services/jobs.js";
import { HttpError } from "./util.js";

export function mountPortal(app) {
  const api = Router();
  api.use(express.json({ limit: "2mb" }));
  api.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  // Public (no login): signed file links, login
  api.use(filesRouter);
  api.use(publicRouter);
  api.get("/health", (req, res) => res.json({ ok: true, emulators: config.useEmulators }));

  // Everything below needs a signed-in user
  api.use(authenticate);
  api.use(meRouter);
  api.use(dashboard);
  api.use(meetings);
  api.use(live);
  api.use(recordings);
  api.use(materials);
  api.use(progress);
  api.use(attendance);
  api.use(notifications);
  api.use(messages);
  api.use("/admin", requireRole("admin"), adminUsers, admin);

  api.use((req, res) => res.status(404).json({ error: "Not found" }));
  // eslint-disable-next-line no-unused-vars
  api.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
    if (err?.code === "LIMIT_FILE_SIZE") return res.status(400).json({ error: "The file is too large" });
    if (err?.name === "MulterError") return res.status(400).json({ error: err.message });
    if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON" });
    console.error("[portal]", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  });

  app.use("/api/portal", api);
  startJobs();
  console.log(`🎓 Portal API mounted at /api/portal (${config.useEmulators ? "Firebase emulators" : "Firebase project " + config.projectId})`);
}
