// ============================================================================
// Create the first SUPER ADMIN in a real Firebase project.
//   npm run create-admin -- you@example.com "Your Name"
// Creates (or reuses) the Auth user, writes the portal profile with every
// permission, and prints a one-time link to choose a password. No password
// is ever typed into or stored by this script.
// ============================================================================
import "dotenv/config";
import config from "../portal/config.js";
import { auth, db, C } from "../portal/firebase.js";

const [email, ...nameParts] = process.argv.slice(2);
const name = nameParts.join(" ").trim() || "Super Admin";
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('Usage: npm run create-admin -- you@example.com "Your Name"');
  process.exit(1);
}

const ALL_PERMS = { users: true, contacts: true, classes: true, materials: true, attendance: true, announcements: true, reports: true, notifications: true, backups: true, settings: true };

let user;
try {
  user = await auth.getUserByEmail(email);
  console.log(`Found existing sign-in for ${email}`);
} catch {
  user = await auth.createUser({ email, displayName: name, emailVerified: false });
  console.log(`Created sign-in for ${email}`);
}

const now = new Date().toISOString();
await db.collection(C.users).doc(user.uid).set(
  { role: "admin", name, superAdmin: true, permissions: ALL_PERMS, active: true, createdAt: now, notifyEmail: true, notifyPush: true, failedAttempts: 0, mustChangePassword: false },
  { merge: true }
);
await db.collection(C.contacts).doc(user.uid).set({ email, phone: "", parentName: "", parentPhone: "", address: "", updatedAt: now }, { merge: true });

const link = await auth.generatePasswordResetLink(email, { url: `${config.portalUrl}/portal/login` });
console.log(`\n✅ ${name} is a super admin in ${config.useEmulators ? "the emulators" : `project ${config.projectId}`}.`);
console.log(`Open this link to choose a password (single use):\n${link}\n`);
process.exit(0);
