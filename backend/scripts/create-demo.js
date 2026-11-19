// ============================================================================
// One DEMO account per portal (admin / teacher / student) in the configured
// Firebase project – real or emulator.
//   npm run create-demo            – create the accounts (reuses existing ones)
//   npm run create-demo -- --reset-passwords   – give them new passwords
// Passwords are random and written to backend/demo-accounts.local.txt
// (gitignored) – never to the repo or the console.
// Demo addresses use the .test domain, so no real mailbox receives anything;
// email notifications are switched off for them.
// ============================================================================
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import config from "../portal/config.js";
import { auth, db, C } from "../portal/firebase.js";

const ALL_PERMS = { users: true, contacts: true, classes: true, materials: true, attendance: true, announcements: true, reports: true, notifications: true, backups: true, settings: true };

const PEOPLE = [
  { key: "admin", role: "admin", name: "Demo Admin", email: "demo.admin@silora.test", superAdmin: false, permissions: ALL_PERMS },
  { key: "teacher", role: "teacher", name: "Demo Teacher", email: "demo.teacher@silora.test", subjects: ["Mathematics", "Physics"] },
  { key: "student", role: "student", name: "Demo Student", email: "demo.student@silora.test", grade: "Grade 9", board: "CBSE", subjects: ["Mathematics", "Physics"], teacher: "teacher", parentName: "Demo Parent" },
];

const resetPasswords = process.argv.includes("--reset-passwords");
// Random, readable, and meets the usual rules (upper, lower, digit, symbol)
const makePassword = () => `Demo-${randomBytes(9).toString("base64url")}-9a`;

const ids = {};
const out = [];
for (const p of PEOPLE) {
  let u;
  let password = null;
  try {
    u = await auth.getUserByEmail(p.email);
    if (resetPasswords) {
      password = makePassword();
      await auth.updateUser(u.uid, { password });
    }
  } catch {
    password = makePassword();
    u = await auth.createUser({ email: p.email, password, displayName: p.name, emailVerified: true });
  }
  const now = new Date().toISOString();
  const doc = { role: p.role, name: p.name, active: true, demo: true, notifyEmail: false, notifyPush: true, failedAttempts: 0, lockedUntil: null, mustChangePassword: false };
  if (password) doc.createdAt = now;
  if (p.role === "admin") Object.assign(doc, { superAdmin: !!p.superAdmin, permissions: p.permissions });
  if (p.subjects) doc.subjects = p.subjects;
  if (p.role === "student") Object.assign(doc, { grade: p.grade, board: p.board, teacherId: ids[p.teacher] });
  await db.collection(C.users).doc(u.uid).set(doc, { merge: true });
  await db.collection(C.contacts).doc(u.uid).set({ email: p.email, phone: "", parentName: p.parentName || "", parentPhone: "", address: "", updatedAt: now }, { merge: true });
  ids[p.key] = u.uid;
  out.push({ ...p, uid: u.uid, password });
  console.log(`${password ? "✅ Ready" : "ℹ️  Already existed (password unchanged)"}: ${p.role.padEnd(7)} ${p.email}`);
}

const fresh = out.filter((p) => p.password);
if (fresh.length) {
  const file = fileURLToPath(new URL("../demo-accounts.local.txt", import.meta.url));
  const lines = [
    `Silora portal demo accounts – ${config.useEmulators ? "emulators" : `project ${config.projectId}`}`,
    `Sign in at ${config.portalUrl}/portal/login`,
    `Created ${new Date().toISOString()}  (keep this file private – it is gitignored)`,
    "",
    ...fresh.map((p) => `${p.role.padEnd(8)} ${p.email.padEnd(28)} ${p.password}`),
    "",
  ];
  writeFileSync(file, lines.join("\n"), { flag: resetPasswords ? "w" : "a" });
  console.log(`\nPasswords saved to ${file}`);
}
process.exit(0);
