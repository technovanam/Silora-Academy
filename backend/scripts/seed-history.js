// ============================================================================
// DEMO HISTORY for the admin dashboard charts (Firebase emulators only)
//   npm run seed:history
// Adds 8 weeks of past classes (a few cancelled), 14 days of sign-in events
// and some material opens. Run after `npm run seed`. Safe to re-run: it
// removes the history it created before (docs tagged demoHistory: true).
// ============================================================================
import "dotenv/config";
import config from "../portal/config.js";
import { db, C } from "../portal/firebase.js";

if (!config.useEmulators) {
  console.error("Refusing to add demo history to a real Firebase project.");
  process.exit(1);
}

const DAY = 86400000;
const rand = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rand(a.length)];

async function clearOld() {
  for (const col of [C.meetings, C.loginEvents]) {
    const qs = await db.collection(col).where("demoHistory", "==", true).get();
    const batch = db.batch();
    qs.docs.forEach((d) => batch.delete(d.ref));
    if (!qs.empty) await batch.commit();
  }
}

const users = (await db.collection(C.users).get()).docs.map((d) => ({ id: d.id, ...d.data() })).filter((u) => !u.deletedAt);
const teachers = users.filter((u) => u.role === "teacher");
const students = users.filter((u) => u.role === "student");
if (!teachers.length || !students.length) {
  console.error("Run `npm run seed` first.");
  process.exit(1);
}
await clearOld();

const SUBJECTS = { Mathematics: ["Algebra practice", "Geometry drills", "Calculus intro", "Statistics"], Physics: ["Motion & forces", "Electricity", "Waves"], English: ["Grammar workshop", "Essay feedback", "Reading comprehension"], Chemistry: ["Periodic table", "Chemical bonding"] };

// Past classes: ~3–6 per teacher per week over 8 weeks, ~8% cancelled
let classes = 0;
const batch = db.batch();
for (const t of teachers) {
  const mine = students.filter((s) => s.teacherId === t.id);
  if (!mine.length) continue;
  const subjects = (t.subjects || ["Mathematics"]).filter((s) => SUBJECTS[s]);
  for (let w = 0; w < 8; w++) {
    const perWeek = 2 + rand(4) + (t.subjects?.includes("Mathematics") ? 1 : 0);
    for (let k = 0; k < perWeek; k++) {
      const start = new Date(Date.now() - (w * 7 + 1 + rand(6)) * DAY);
      start.setHours(14 + rand(5), 0, 0, 0);
      if (start.getTime() > Date.now() - 2 * 3600000) continue;
      const subject = pick(subjects.length ? subjects : ["Mathematics"]);
      const dur = pick([45, 60, 60, 90]);
      const group = mine.slice(0, 1 + rand(Math.min(3, mine.length)));
      batch.set(db.collection(C.meetings).doc(), {
        title: pick(SUBJECTS[subject]),
        subject,
        teacherId: t.id,
        studentIds: group.map((s) => s.id),
        startAt: start.toISOString(),
        endAt: new Date(start.getTime() + dur * 60000).toISOString(),
        durationMin: dur,
        status: Math.random() < 0.08 ? "cancelled" : "scheduled",
        roomName: `${config.livekit.roomPrefix}-hist${Math.random().toString(16).slice(2, 14)}`,
        notes: "",
        seriesId: null,
        createdBy: t.id,
        createdByRole: "teacher",
        createdAt: new Date(start.getTime() - 7 * DAY).toISOString(),
        demoHistory: true,
      });
      classes++;
    }
  }
}

// Sign-ins: last 14 days, more on weekdays, a few failures
let events = 0;
for (let d = 13; d >= 0; d--) {
  const day = new Date(Date.now() - d * DAY);
  const weekend = [0, 6].includes(day.getDay());
  const n = (weekend ? 2 : 5) + rand(weekend ? 3 : 6);
  for (let i = 0; i < n; i++) {
    const u = pick(users);
    const at = new Date(day);
    at.setHours(8 + rand(13), rand(60), 0, 0);
    if (at.getTime() > Date.now()) continue;
    const success = Math.random() > 0.1;
    batch.set(db.collection(C.loginEvents).doc(), { at: at.toISOString(), uid: u.id, name: u.name, role: u.role, email: null, success, reason: success ? null : "bad_password", ip: "127.0.0.1", userAgent: "demo", demoHistory: true });
    events++;
  }
}
await batch.commit();

// Material opens: mark most assigned materials as opened
const mats = (await db.collection(C.materials).get()).docs.map((d) => ({ id: d.id, ...d.data() })).filter((m) => !m.deletedAt && m.status === "published");
let opens = 0;
for (const m of mats) {
  for (const sid of m.studentIds || []) {
    if (Math.random() < 0.3) continue;
    const at = new Date(Date.now() - rand(5) * DAY).toISOString();
    await db.collection(C.materialOpens).doc(`${m.id}_${sid}`).set({ materialId: m.id, studentId: sid, teacherId: m.teacherId, firstOpenedAt: at, lastOpenedAt: at, openCount: 1 + rand(3), downloadCount: rand(2) }, { merge: true });
    opens++;
  }
}

console.log(`📈 Demo history: ${classes} past classes, ${events} sign-ins, ${opens} material opens`);
process.exit(0);
