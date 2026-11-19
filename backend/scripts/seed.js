// ============================================================================
// DEMO DATA for local development (Firebase emulators only)
//   npm run seed            – create demo accounts + sample data (idempotent)
//   npm run seed -- --reset – wipe the emulator database first
//
// Demo sign-in accounts (test values, emulator only):
//   Super admin : admin@silora.test      / Admin@2026
//   Admin (limited): office@silora.test  / Office@2026
//   Teacher     : priya@silora.test      / Teacher@2026
//   Teacher     : arjun@silora.test      / Teacher@2026
//   Student     : aarav@silora.test      / Student@2026
//   Student     : diya@silora.test       / Student@2026
//   Student     : kabir@silora.test      / Student@2026
//   Student     : meera@silora.test      / Student@2026 (Arjun's student)
// ============================================================================
import "dotenv/config";
import config from "../portal/config.js";
import { auth, db, C, bucket } from "../portal/firebase.js";
import { weekStartOf, shiftWeek, addDays, addMinutes } from "../portal/util.js";

if (!config.useEmulators && !process.argv.includes("--force")) {
  console.error("Refusing to seed a real Firebase project. Use the emulators (USE_FIREBASE_EMULATORS=true) or pass --force.");
  process.exit(1);
}

const ALL_PERMS = { users: true, contacts: true, classes: true, materials: true, attendance: true, announcements: true, reports: true, notifications: true, backups: true, settings: true };

const PEOPLE = [
  { key: "admin", role: "admin", name: "Sasi (Super Admin)", email: "admin@silora.test", password: "Admin@2026", superAdmin: true, permissions: ALL_PERMS, phone: "+91 90000 00001" },
  { key: "office", role: "admin", name: "Front Office", email: "office@silora.test", password: "Office@2026", superAdmin: false, permissions: { users: true, classes: true, attendance: true, announcements: true }, phone: "+91 90000 00002" },
  { key: "priya", role: "teacher", name: "Priya Raman", email: "priya@silora.test", password: "Teacher@2026", subjects: ["Mathematics", "Physics"], phone: "+91 90000 00011" },
  { key: "arjun", role: "teacher", name: "Arjun Menon", email: "arjun@silora.test", password: "Teacher@2026", subjects: ["English", "Chemistry"], phone: "+91 90000 00012" },
  { key: "aarav", role: "student", name: "Aarav Sharma", email: "aarav@silora.test", password: "Student@2026", grade: "Grade 9", board: "CBSE", subjects: ["Mathematics", "Physics"], teacher: "priya", parentName: "Rohit Sharma", parentPhone: "+971 50 000 0001" },
  { key: "diya", role: "student", name: "Diya Nair", email: "diya@silora.test", password: "Student@2026", grade: "Grade 10", board: "ICSE", subjects: ["Mathematics"], teacher: "priya", parentName: "Anita Nair", parentPhone: "+971 50 000 0002" },
  { key: "kabir", role: "student", name: "Kabir Iyer", email: "kabir@silora.test", password: "Student@2026", grade: "Grade 8", board: "CBSE", subjects: ["Physics"], teacher: "priya", parentName: "Lakshmi Iyer", parentPhone: "+91 98000 00003" },
  { key: "meera", role: "student", name: "Meera Pillai", email: "meera@silora.test", password: "Student@2026", grade: "Grade 11", board: "IGCSE", subjects: ["English", "Chemistry"], teacher: "arjun", parentName: "Vinod Pillai", parentPhone: "+974 5000 0004" },
];

async function wipe() {
  for (const name of Object.values(C)) {
    const qs = await db.collection(name).get();
    for (let i = 0; i < qs.docs.length; i += 400) {
      const b = db.batch();
      qs.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
      await b.commit();
    }
  }
  const list = await auth.listUsers(1000);
  if (list.users.length) await auth.deleteUsers(list.users.map((u) => u.uid));
  const [files] = await bucket.getFiles().catch(() => [[]]);
  await Promise.all(files.map((f) => f.delete().catch(() => {})));
  console.log("🧹 Emulator data wiped");
}

async function ensureUser(p, ids) {
  let u;
  try {
    u = await auth.getUserByEmail(p.email);
  } catch {
    u = await auth.createUser({ email: p.email, password: p.password, displayName: p.name });
  }
  const at = new Date(Date.now() - 40 * 86400000).toISOString();
  const doc = { role: p.role, name: p.name, active: true, createdAt: at, notifyEmail: true, notifyPush: true, failedAttempts: 0 };
  if (p.role === "admin") Object.assign(doc, { superAdmin: !!p.superAdmin, permissions: p.permissions });
  if (p.subjects) doc.subjects = p.subjects;
  if (p.role === "student") Object.assign(doc, { grade: p.grade, board: p.board, teacherId: ids[p.teacher] });
  await db.collection(C.users).doc(u.uid).set(doc, { merge: true });
  await db.collection(C.contacts).doc(u.uid).set({ email: p.email, phone: p.phone || "", parentName: p.parentName || "", parentPhone: p.parentPhone || "", address: "", updatedAt: at });
  ids[p.key] = u.uid;
}

// A tiny valid PDF so the material viewer has something to open
function samplePdf(title, lines) {
  const text = [title, "", ...lines].map((l, i) => `BT /F1 ${i ? 12 : 20} Tf 60 ${740 - i * 24} Td (${l.replace(/[()\\]/g, "")}) Tj ET`).join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

async function seedData(ids) {
  const existing = await db.collection(C.meetings).limit(1).get();
  if (!existing.empty) {
    console.log("ℹ️  Sample data already present – skipped (use --reset to start fresh)");
    return;
  }
  const now = new Date();
  const roundTo = (d, mins) => new Date(Math.ceil(d.getTime() / (mins * 60000)) * mins * 60000);
  const soon = roundTo(addMinutes(now, 2), 5); // joinable right away
  const meetings = [
    { title: "Algebra – Quadratic equations", subject: "Mathematics", teacherId: ids.priya, studentIds: [ids.aarav, ids.diya], startAt: soon, durationMin: 60 },
    { title: "Physics – Laws of motion", subject: "Physics", teacherId: ids.priya, studentIds: [ids.aarav, ids.kabir], startAt: addDays(roundTo(now, 60), 1), durationMin: 60 },
    { title: "Geometry revision", subject: "Mathematics", teacherId: ids.priya, studentIds: [ids.diya], startAt: addDays(roundTo(now, 60), 2), durationMin: 45 },
    { title: "Essay writing", subject: "English", teacherId: ids.arjun, studentIds: [ids.meera], startAt: addDays(roundTo(now, 60), 1), durationMin: 60 },
    { title: "Trigonometry basics", subject: "Mathematics", teacherId: ids.priya, studentIds: [ids.aarav], startAt: addDays(roundTo(now, 60), -2), durationMin: 60 },
  ];
  for (const [i, m] of meetings.entries()) {
    const startAt = new Date(m.startAt).toISOString();
    await db.collection(C.meetings).add({
      ...m,
      startAt,
      endAt: addMinutes(startAt, m.durationMin).toISOString(),
      status: "scheduled",
      notes: "",
      seriesId: null,
      createdBy: ids.admin,
      createdByRole: "admin",
      createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
    });
  }

  const mats = [
    { title: "Quadratic equations – worksheet", subject: "Mathematics", folder: "Algebra", teacherId: ids.priya, studentIds: [ids.aarav, ids.diya], lines: ["1. Solve x^2 - 5x + 6 = 0", "2. Solve 2x^2 + 3x - 2 = 0", "3. Find the discriminant of x^2 + 4x + 5"] },
    { title: "Newton's laws – notes", subject: "Physics", folder: "Mechanics", teacherId: ids.priya, studentIds: [ids.aarav, ids.kabir], lines: ["First law: inertia", "Second law: F = m a", "Third law: action and reaction"] },
    { title: "Essay structure guide", subject: "English", folder: "Writing", teacherId: ids.arjun, studentIds: [ids.meera], lines: ["Introduction", "Body paragraphs", "Conclusion"] },
  ];
  for (const [i, m] of mats.entries()) {
    const ref = db.collection(C.materials).doc();
    const path = `materials/${ref.id}/v1-seed-${i}.pdf`;
    const buf = samplePdf(m.title, m.lines);
    await bucket.file(path).save(buf, { contentType: "application/pdf", resumable: false });
    const file = { path, fileName: `${m.title.replace(/[^\w]+/g, "-")}.pdf`, contentType: "application/pdf", kind: "PDF", size: buf.length, scan: "skipped" };
    const at = new Date(Date.now() - (5 - i) * 86400000).toISOString();
    const { lines, ...rest } = m;
    await ref.set({ ...rest, description: "Sample material created by the seed script.", uploadedBy: m.teacherId, file, version: 1, versions: [{ version: 1, file, uploadedAt: at, uploadedBy: m.teacherId, note: "First upload" }], status: "published", publishAt: null, publishedAt: at, notifiedIds: m.studentIds, createdAt: at, updatedAt: at });
    if (i === 0) await db.collection(C.materialOpens).doc(`${ref.id}_${ids.aarav}`).set({ materialId: ref.id, studentId: ids.aarav, teacherId: ids.priya, firstOpenedAt: at, lastOpenedAt: at, openCount: 2, downloadCount: 0 });
  }

  const lessons = [
    [ids.aarav, "Mathematics", "Linear equations", "completed", 100],
    [ids.aarav, "Mathematics", "Quadratic equations", "in_progress", 60],
    [ids.aarav, "Physics", "Motion in a straight line", "completed", 100],
    [ids.diya, "Mathematics", "Coordinate geometry", "in_progress", 40],
    [ids.kabir, "Physics", "Force and pressure", "planned", 0],
    [ids.meera, "English", "Argumentative essays", "in_progress", 50],
  ];
  for (const [studentId, subject, topic, status, progress] of lessons) {
    const teacherId = studentId === ids.meera ? ids.arjun : ids.priya;
    await db.collection(C.lessons).add({ studentId, teacherId, subject, topic, status, progress, date: new Date().toISOString().slice(0, 10), comment: "", createdAt: new Date().toISOString() });
  }
  await db.collection(C.notes).add({ teacherId: ids.priya, studentId: ids.aarav, text: "Strong with algebra, needs more practice with word problems.", pinned: true, createdAt: new Date().toISOString() });

  const lastWeek = shiftWeek(weekStartOf(new Date()), -1);
  await db.collection(C.attendance).doc(`${ids.aarav}_${lastWeek}`).set({ studentId: ids.aarav, studentName: "Aarav Sharma", teacherId: ids.priya, weekStart: lastWeek, weekendAttendance: "yes", classesAttended: 3, lessonsCovered: "Linear equations, motion in a straight line", rating: 5, review: "Very clear explanations.", remarks: "", submittedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), late: false, history: [] });

  await db.collection(C.announcements).add({ title: "Welcome to the Silora Academy portal", body: "Your classes, materials and weekly attendance are all in one place now. Join classes from the dashboard a few minutes before they start.", priority: "important", audience: "all", userIds: [], publishAt: null, expiresAt: null, pinned: true, status: "active", createdBy: ids.admin, createdByName: "Silora Academy", createdAt: new Date().toISOString(), notifiedAt: new Date().toISOString() });

  console.log("📚 Sample classes, materials, lessons, attendance and an announcement created");
}

const ids = {};
if (process.argv.includes("--reset")) await wipe();
for (const p of PEOPLE) await ensureUser(p, ids);
console.log(`👤 ${PEOPLE.length} demo accounts ready (see the header of scripts/seed.js for sign-in details)`);
await seedData(ids);
process.exit(0);
