// ============================================================================
// SAMPLE DATA for the LOCAL Firebase emulators – about 20–25 realistic records
// in every module of the admin, teacher and student portals.
//
//   1. bash start-emulators.sh                       (from the repo root)
//   2. start the backend with USE_FIREBASE_EMULATORS=true (port 5000)
//   3. npm run seed:sample            – refuses if the emulator already has users
//      npm run seed:sample -- --reset – wipe the emulator first
//
// Most records are created through the portal's own API (as the admin / teacher /
// student would), so fees, teacher payments, notifications and logs are real.
// Past classes are written directly (the API can't schedule in the past), with
// classroom join/leave times so attendance is computed the normal way.
//
// Sign-in (emulator only – never use these on the live project):
//   Admins   : admin@silora.test (super admin), office@silora.test, accounts@silora.test
//   Teachers : priya@ / arjun@ / fatima@ / rahul@ / neha@ / vikram@silora.test
//   Students : aarav@silora.test … (see the printed list)
//   Passwords: Admin@2026 · Teacher@2026 · Student@2026
// ============================================================================
import "dotenv/config";
import config from "../portal/config.js";
import { auth, db, C, bucket } from "../portal/firebase.js";
import { ADMIN_PERMISSIONS } from "../portal/services/core.js";
import { saveDemoRequest } from "../portal/routes/demos.js";

if (!config.useEmulators) {
  console.error("Refusing to run: this script only fills the LOCAL emulators (USE_FIREBASE_EMULATORS=true).");
  process.exit(1);
}
const API = process.env.SEED_API || `http://localhost:${process.env.PORT || 5000}/api/portal`;
const AUTH_EMU = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099"}`;
const PW = { admin: "Admin@2026", teacher: "Teacher@2026", student: "Student@2026" };

// ---- Time helpers (classes are planned in India time) ---------------------------------
const TZ_MS = 5.5 * 3600000;
const istAt = (dayOffset, hh, mm = 0) => {
  const n = new Date(Date.now() + TZ_MS);
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + dayOffset, hh, mm) - TZ_MS).toISOString();
};
const istDate = (dayOffset) => new Date(new Date(istAt(dayOffset, 12)).getTime() + TZ_MS).toISOString().slice(0, 10);
const isoDay = (iso) => ((new Date(new Date(iso).getTime() + TZ_MS).getUTCDay() + 6) % 7) + 1; // 1 = Monday
const plusMin = (iso, n) => new Date(new Date(iso).getTime() + n * 60000).toISOString();
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

// ---- People ------------------------------------------------------------------------
const ADMINS = [
  { key: "admin", name: "Sasi Kiran", email: "admin@silora.test", superAdmin: true, phone: "+91 90000 00001" },
  { key: "office", name: "Kavya Reddy", email: "office@silora.test", perms: ["users", "contacts", "classes", "attendance", "sessions", "demos", "announcements", "groups"], phone: "+91 90000 00002" },
  { key: "accounts", name: "Mohammed Irfan", email: "accounts@silora.test", perms: ["fees", "teacherPayments", "reports", "sessions"], phone: "+91 90000 00003" },
];
const TEACHERS = [
  { key: "priya", name: "Priya Raman", subjects: ["Mathematics", "Physics"], phone: "+91 98450 11201" },
  { key: "arjun", name: "Arjun Menon", subjects: ["English", "Chemistry"], phone: "+91 98450 11202" },
  { key: "fatima", name: "Fatima Sheikh", subjects: ["Biology", "Chemistry"], phone: "+91 98450 11203" },
  { key: "rahul", name: "Rahul Verma", subjects: ["Computer Science"], phone: "+91 98450 11204" },
  { key: "neha", name: "Neha Kapoor", subjects: ["Mathematics"], phone: "+91 98450 11205" },
  { key: "vikram", name: "Vikram Rao", subjects: ["Physics"], phone: "+91 98450 11206" },
];
const STUDENTS = [
  ["aarav", "Aarav Sharma", "Grade 9", "CBSE", "Rohit Sharma", "+971 50 412 3301", "Dubai, UAE"],
  ["diya", "Diya Nair", "Grade 9", "CBSE", "Anita Nair", "+971 50 412 3302", "Sharjah, UAE"],
  ["kabir", "Kabir Iyer", "Grade 9", "CBSE", "Lakshmi Iyer", "+91 98860 33303", "Bengaluru"],
  ["ishaan", "Ishaan Gupta", "Grade 9", "CBSE", "Sanjay Gupta", "+974 5512 3304", "Doha, Qatar"],
  ["ananya", "Ananya Krishnan", "Grade 10", "ICSE", "Ramesh Krishnan", "+91 98860 33305", "Chennai"],
  ["meera", "Meera Pillai", "Grade 10", "ICSE", "Vinod Pillai", "+974 5512 3306", "Doha, Qatar"],
  ["rohan", "Rohan Das", "Grade 10", "ICSE", "Subhash Das", "+91 98300 33307", "Kolkata"],
  ["sara", "Sara Thomas", "Grade 11", "CBSE", "Joseph Thomas", "+968 9512 3308", "Muscat, Oman"],
  ["aditya", "Aditya Kulkarni", "Grade 11", "CBSE", "Mahesh Kulkarni", "+91 98220 33309", "Pune"],
  ["nisha", "Nisha Patel", "Grade 10", "ICSE", "Hemant Patel", "+44 7700 900310", "Leicester, UK"],
  ["arjunk", "Arjun Kumar", "Grade 10", "ICSE", "Prakash Kumar", "+91 98450 33311", "Mysuru"],
  ["zara", "Zara Khan", "Grade 11", "CBSE", "Imran Khan", "+966 50 512 3312", "Riyadh, KSA"],
  ["vivaan", "Vivaan Joshi", "Grade 11", "CBSE", "Amit Joshi", "+1 408 555 0113", "San Jose, USA"],
  ["saanvi", "Saanvi Reddy", "Grade 8", "CBSE", "Srinivas Reddy", "+91 98490 33314", "Hyderabad"],
  ["reyansh", "Reyansh Mehta", "Grade 8", "CBSE", "Kunal Mehta", "+971 55 512 3315", "Abu Dhabi, UAE"],
  ["myra", "Myra Bose", "Grade 8", "CBSE", "Debashish Bose", "+91 98300 33316", "Kolkata"],
  ["karthik", "Karthik Subramanian", "Grade 12", "CBSE", "Ganesh Subramanian", "+65 9123 3317", "Singapore"],
  ["aisha", "Aisha Rahman", "Grade 12", "IGCSE", "Faisal Rahman", "+971 50 512 3318", "Dubai, UAE"],
  ["dev", "Dev Malhotra", "Grade 12", "CBSE", "Rajiv Malhotra", "+91 98110 33319", "New Delhi"],
  ["tara", "Tara Varghese", "Grade 12", "CBSE", "George Varghese", "+973 3612 3320", "Manama, Bahrain"],
  ["arnav", "Arnav Chatterjee", "Grade 12", "IGCSE", "Sourav Chatterjee", "+91 98300 33321", "Kolkata"],
  ["ira", "Ira Deshpande", "Grade 12", "IGCSE", "Nitin Deshpande", "+61 412 555 322", "Melbourne, Australia"],
].map(([key, name, grade, board, parentName, parentPhone, city], i) => ({ key, name, grade, board, parentName, parentPhone, address: city, code: `SA26${String(101 + i).padStart(4, "0")}`, phone: parentPhone.replace(/\d{2}$/, String(40 + i)) }));

// Batches: one teacher + one subject + a few students, one class a week
// day = how many days ago the last class was (1–6); hour = start time (India)
const BATCHES = [
  { key: "g1", teacher: "priya", subject: "Mathematics", students: ["aarav", "diya", "kabir"], day: 1, hour: 16, title: "Grade 9 Maths", completedFirst: true },
  { key: "g2", teacher: "priya", subject: "Physics", students: ["aarav", "ishaan"], day: 2, hour: 17, title: "Grade 9 Physics" },
  { key: "g3", teacher: "arjun", subject: "English", students: ["ananya", "meera", "rohan"], day: 3, hour: 16, title: "Grade 10 English", completedFirst: true },
  { key: "g4", teacher: "arjun", subject: "Chemistry", students: ["sara", "aditya"], day: 4, hour: 18, title: "Grade 11 Chemistry" },
  { key: "g5", teacher: "fatima", subject: "Biology", students: ["meera", "nisha", "arjunk"], day: 5, hour: 16, title: "Grade 10 Biology", completedFirst: true },
  { key: "g6", teacher: "rahul", subject: "Computer Science", students: ["aditya", "zara", "vivaan"], day: 1, hour: 19, title: "Grade 11 Computer Science" },
  { key: "g7", teacher: "neha", subject: "Mathematics", students: ["saanvi", "reyansh", "myra"], day: 2, hour: 16, title: "Grade 8 Maths", completedFirst: true },
  { key: "g8", teacher: "vikram", subject: "Physics", students: ["karthik", "aisha"], day: 3, hour: 18, title: "Grade 12 Physics" },
  { key: "g9", teacher: "fatima", subject: "Chemistry", students: ["karthik", "dev", "tara"], day: 4, hour: 17, title: "Grade 12 Chemistry" },
  { key: "g10", teacher: "neha", subject: "Mathematics", students: ["aisha", "arnav", "ira"], day: 5, hour: 18, title: "Grade 12 Maths" },
];
const TOPICS = {
  Mathematics: ["Linear equations in two variables", "Polynomials – factorisation", "Quadratic equations", "Coordinate geometry", "Trigonometric ratios", "Probability basics"],
  Physics: ["Motion and velocity–time graphs", "Newton's laws of motion", "Work, energy and power", "Gravitation", "Current electricity", "Ray optics"],
  English: ["Formal letter writing", "Reading comprehension – unseen passage", "Tenses and reported speech", "Poetry analysis", "Argumentative essay", "Précis writing"],
  Chemistry: ["Mole concept", "Chemical bonding", "Periodic classification", "Acids, bases and salts", "Organic chemistry – nomenclature", "Electrochemistry"],
  Biology: ["Cell structure and functions", "Tissues", "Life processes – nutrition", "Control and coordination", "Heredity and evolution", "Our environment"],
  "Computer Science": ["Python basics – variables and types", "Conditional statements", "Loops and patterns", "Lists and dictionaries", "Functions", "File handling"],
};
const SUBJECTS = ["Mathematics", "Physics", "Chemistry", "Biology", "English", "Computer Science"];

// ---- Small helpers -------------------------------------------------------------------
const ids = {};
const tokens = {};
const emailOf = (key) => `${key}@silora.test`;
const log = (...a) => console.log(...a);
let warnings = 0;
const soft = async (label, fn) => {
  try {
    return await fn();
  } catch (e) {
    if (/fee payment details/.test(e.message)) return null; // fee-locked student: expected
    warnings++;
    console.warn(`   ⚠️  ${label}: ${e.message}`);
    return null;
  }
};

async function signIn(key, role) {
  if (tokens[key]) return tokens[key];
  const r = await fetch(`${API}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: emailOf(key), password: PW[role] }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`login ${key}: ${d.error || r.status}`);
  const t = await fetch(`${AUTH_EMU}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=demo-api-key`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: d.customToken, returnSecureToken: true }) });
  const td = await t.json();
  if (!td.idToken) throw new Error(`token ${key}: ${JSON.stringify(td).slice(0, 200)}`);
  return (tokens[key] = td.idToken);
}
const roleOf = (key) => (ADMINS.some((a) => a.key === key) ? "admin" : TEACHERS.some((t) => t.key === key) ? "teacher" : "student");

async function call(key, method, path, body) {
  const token = await signIn(key, roleOf(key));
  const r = await fetch(API + path, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${d.error || ""}`);
  return d;
}
async function upload(key, path, fields, file) {
  const token = await signIn(key, roleOf(key));
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, typeof v === "string" ? v : JSON.stringify(v));
  if (file) fd.append("file", new Blob([file.buf], { type: file.type }), file.name);
  const r = await fetch(API + path, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`POST ${path} → ${r.status} ${d.error || ""}`);
  return d;
}

// A small valid one-page PDF (materials, receipts)
function pdf(title, lines) {
  const clean = (l) => l.replace(/[()\\]/g, "").replace(/[^\x20-\x7e]/g, "-");
  const text = [title, "", ...lines].map((l, i) => `BT /F1 ${i ? 12 : 18} Tf 60 ${740 - i * 22} Td (${clean(l)}) Tj ET`).join("\n");
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
const pdfFile = (name, title, lines) => ({ buf: pdf(title, lines), type: "application/pdf", name });

// ---- 0. Wipe / guard -----------------------------------------------------------------
async function wipe() {
  for (const name of Object.values(C)) {
    const qs = await db.collection(name).get();
    for (const d of qs.docs) await db.recursiveDelete(d.ref);
  }
  let page;
  do {
    page = await auth.listUsers(1000);
    if (page.users.length) await auth.deleteUsers(page.users.map((u) => u.uid));
  } while (page.users.length);
  const [files] = await bucket.getFiles().catch(() => [[]]);
  await Promise.all(files.map((f) => f.delete().catch(() => {})));
  log("🧹 Emulator data wiped");
}

// ---- 1. Accounts (written directly, like the admin would create them) -------------------
async function makeUser({ key, role, name, email, password, profile, contact }) {
  const u = await auth.createUser({ email, password, displayName: name, emailVerified: true });
  ids[key] = u.uid;
  const createdAt = daysAgo(45 + (Object.keys(ids).length % 40));
  await db.collection(C.users).doc(u.uid).set({ role, name, active: true, createdAt, createdBy: ids.admin || null, notifyEmail: true, notifyPush: true, failedAttempts: 0, lockedUntil: null, mustChangePassword: false, ...profile });
  await db.collection(C.contacts).doc(u.uid).set({ email, phone: "", parentName: "", parentPhone: "", address: "", ...contact, updatedAt: createdAt });
}

async function accounts() {
  const at = daysAgo(60);
  await db.collection(C.settings).doc("app").set({
    subjects: SUBJECTS.map((name) => ({ name, active: true, description: "", createdAt: at, updatedAt: at, archivedAt: null })),
    attendanceRules: { minPercent: 75, graceMin: 10, reminderHours: 24, formsFrom: istDate(-30) },
  }, { merge: true });

  const allPerms = Object.fromEntries(Object.keys(ADMIN_PERMISSIONS).map((k) => [k, true]));
  for (const a of ADMINS) {
    const permissions = a.superAdmin ? allPerms : Object.fromEntries(Object.keys(ADMIN_PERMISSIONS).map((k) => [k, a.perms.includes(k)]));
    await makeUser({ key: a.key, role: "admin", name: a.name, email: a.email, password: PW.admin, profile: { superAdmin: !!a.superAdmin, permissions }, contact: { phone: a.phone } });
  }
  for (const t of TEACHERS) await makeUser({ key: t.key, role: "teacher", name: t.name, email: emailOf(t.key), password: PW.teacher, profile: { subjects: t.subjects }, contact: { phone: t.phone, address: "India" } });
  for (const s of STUDENTS) {
    const rows = BATCHES.filter((b) => b.students.includes(s.key)).map((b) => ({ subject: b.subject, teacherId: ids[b.teacher] }));
    await makeUser({
      key: s.key,
      role: "student",
      name: s.name,
      email: emailOf(s.key),
      password: PW.student,
      profile: { grade: s.grade, board: s.board, studentCode: s.code, subjectTeachers: rows, subjects: rows.map((r) => r.subject), teacherIds: [...new Set(rows.map((r) => r.teacherId))], teacherId: null, assignedAt: daysAgo(40) },
      contact: { phone: s.phone, parentName: s.parentName, parentPhone: s.parentPhone, address: s.address },
    });
  }
  log(`👤 ${ADMINS.length} admins, ${TEACHERS.length} teachers, ${STUDENTS.length} students`);
}

// ---- 2. Past classes with classroom join/leave times -----------------------------------
// Attendance pattern per (class, student): mostly present, some late / short stay / no-show
const PATTERN = ["present", "present", "late", "present", "present", "short", "present", "present", "noshow", "present", "present", "late", "present", "leave", "present"];
const pastMeetings = []; // { id, batch, week, startAt, endAt }

async function pastClasses() {
  let n = 0;
  for (const [bi, b] of BATCHES.entries()) {
    for (let week = 2; week >= 0; week--) {
      const startAt = istAt(-(b.day + week * 7), b.hour);
      const endAt = plusMin(startAt, 60);
      const topic = TOPICS[b.subject][2 - week];
      const ref = db.collection(C.meetings).doc();
      const studentIds = b.students.map((k) => ids[k]);
      const teacherJoin = plusMin(startAt, -3);
      await ref.set({
        title: `${b.title} – ${topic}`,
        subject: b.subject,
        notes: "",
        teacherId: ids[b.teacher],
        studentIds,
        startAt,
        endAt,
        durationMin: 60,
        status: "scheduled",
        seriesId: `seed-${b.key}`,
        createdBy: ids.admin,
        createdByRole: "admin",
        createdAt: daysAgo(30),
        hadLiveClass: true,
        liveStartedAt: teacherJoin,
        liveEndedAt: plusMin(endAt, 2),
      });
      const room = db.collection(C.liveRooms).doc(ref.id);
      await room.set({ meetingId: ref.id, teacherId: ids[b.teacher], status: "ended", startedAt: teacherJoin, endedAt: plusMin(endAt, 2), inClass: 0 });
      await room.collection("people").doc(ids[b.teacher]).set({ name: TEACHERS.find((t) => t.key === b.teacher).name, role: "teacher", status: "left", intervals: [{ from: teacherJoin, to: plusMin(endAt, 2) }], firstJoinedAt: teacherJoin, lastLeftAt: plusMin(endAt, 2), lastSeenAt: plusMin(endAt, 2) });
      for (const [si, sk] of b.students.entries()) {
        const kind = PATTERN[(bi * 5 + week * 3 + si) % PATTERN.length];
        const sid = ids[sk];
        const name = STUDENTS.find((s) => s.key === sk).name;
        if (kind === "noshow" || kind === "leave") {
          if (kind === "leave") {
            const at = plusMin(startAt, -26 * 60);
            await db.collection(C.leaveRequests).add({ studentId: sid, studentName: name, teacherId: ids[b.teacher], meetingId: ref.id, classTitle: `${b.title} – ${topic}`, subject: b.subject, classStartAt: startAt, sessionId: null, date: startAt.slice(0, 10), reason: ["Family function out of town", "Down with fever", "School exam the same evening", "Travelling back from holiday"][si % 4], remarks: "", status: "approved", decisionNote: "Approved – please review the class notes.", decidedAt: plusMin(at, 120), decidedBy: ids.office, decidedByName: "Kavya Reddy", createdAt: at, updatedAt: plusMin(at, 120), history: [{ at, by: sid, byName: name, action: "submitted" }, { at: plusMin(at, 120), by: ids.office, byName: "Kavya Reddy", action: "approved", note: "Approved – please review the class notes." }] });
          }
          continue;
        }
        const from = kind === "late" ? plusMin(startAt, 14 + si) : plusMin(startAt, -1 + si);
        const intervals = kind === "short" ? [{ from, to: plusMin(startAt, 22) }] : si === 1 && week === 1 ? [{ from, to: plusMin(startAt, 31) }, { from: plusMin(startAt, 33), to: endAt }] : [{ from, to: plusMin(endAt, 1) }];
        const last = intervals[intervals.length - 1].to;
        await room.collection("people").doc(sid).set({ name, role: "student", status: "left", intervals, firstJoinedAt: from, lastLeftAt: last, lastSeenAt: last });
      }
      pastMeetings.push({ id: ref.id, batch: b, week, startAt, endAt, topic });
      n++;
    }
  }
  log(`🏫 ${n} past classes (held, with join/leave times)`);
}

// ---- 3. Sessions (admin) – completed "Session 1" for some batches, active for all ----------
const sessionsByStudent = {}; // studentKey → [{ id, subject, status }]
async function sessions() {
  let n = 0;
  for (const b of BATCHES) {
    for (const sk of b.students) {
      const plans = b.completedFirst
        ? [
            { number: 1, startDate: istDate(-24), endDate: istDate(-1), classes: 3, status: "completed" },
            { number: 2, startDate: istDate(0), endDate: istDate(56), classes: 8, status: "active" },
          ]
        : [{ number: 1, startDate: istDate(-24), endDate: istDate(60), classes: 10, status: "active" }];
      for (const p of plans) {
        const r = await soft(`session ${sk} ${b.subject}`, () =>
          call("admin", "POST", "/admin/sessions", {
            studentId: ids[sk],
            rows: [{ subject: b.subject, teacherId: ids[b.teacher], classes: p.classes, number: p.number }],
            startDate: p.startDate,
            endDate: p.endDate,
            status: p.status,
            paymentInstructions: "Pay by UPI to siloraacademy@okaxis or bank transfer (HDFC Bank, A/c 50200012345678, IFSC HDFC0001234). Upload the receipt here.",
          })
        );
        if (r?.created?.[0]) {
          (sessionsByStudent[sk] ||= []).push({ id: r.created[0].id, subject: b.subject, status: p.status, batch: b });
          n++;
        }
      }
    }
  }
  log(`📅 ${n} sessions (with fee and teacher-payment records)`);
}

// ---- 4. Fees: students upload proof, admin verifies / rejects -----------------------------
async function fees() {
  let submitted = 0, verified = 0, rejected = 0;
  const all = Object.entries(sessionsByStudent).flatMap(([sk, list]) => list.map((s) => ({ sk, ...s })));
  for (const [i, s] of all.entries()) {
    const notYet = s.status === "active" && i % 9 === 4; // a few students still owe proof
    if (notYet) continue;
    const st = STUDENTS.find((x) => x.key === s.sk);
    const ref = `UPI${String(4021876500 + i * 37)}`;
    const paidOn = istDate(s.status === "completed" ? -25 : -(i % 6) - 1);
    const amount = s.subject === "Computer Science" ? 6500 : s.batch.students.length > 2 ? 5400 : 6000;
    const ok = await soft(`fee proof ${s.sk}`, () =>
      upload(s.sk, `/fees/${s.id}/submit`, { reference: ref, paidOn, note: i % 4 === 0 ? "Paid by my father through Google Pay." : "" }, pdfFile(`receipt-${ref}.pdf`, "Payment receipt", [`Paid to: Silora Academy`, `Student: ${st.name} (${st.code})`, `For: ${s.subject}`, `Amount: INR ${amount}`, `Reference: ${ref}`, `Date: ${paidOn}`, "Status: SUCCESS"]))
    );
    if (!ok) continue;
    submitted++;
    const payId = `${s.id}_${ids[s.sk]}`;
    if (s.status === "completed" || i % 5 !== 3) {
      if (s.status === "active" && i % 7 === 2) continue; // waiting for the admin to check
      if (await soft("fee verify", () => call("accounts", "POST", `/admin/fees/${payId}/review`, { decision: "verify" }))) verified++;
    } else if (await soft("fee reject", () => call("accounts", "POST", `/admin/fees/${payId}/review`, { decision: "reject", reason: "The screenshot doesn't show the transaction reference – please upload the full receipt." }))) rejected++;
  }
  log(`💳 Fees: ${submitted} proofs submitted, ${verified} verified, ${rejected} rejected, ${all.length - submitted} not submitted yet`);
}

// ---- 5. Attendance forms for the past classes (teachers) ----------------------------------
async function attendanceForms() {
  let n = 0;
  const HOMEWORK = ["Exercise 3.2, questions 1–10", "Worksheet on the board – finish at home", "Revise today's notes and solve the textbook examples", "Prepare for a 10-mark quiz next class", "Read the next chapter and note down doubts"];
  for (const [i, m] of pastMeetings.entries()) {
    if (m.week === 0 && [0, 3, 6, 8].includes(BATCHES.indexOf(m.batch))) continue; // a few recent forms still pending
    const b = m.batch;
    const rows = b.students.map((sk, si) => ({ studentId: ids[sk], remarks: ["Attentive, answered well", "Needs more practice", "Good improvement", "Asked good questions", ""][(i + si) % 5], ...(m.week === 1 ? { quizTopic: m.topic, quizResult: `${6 + ((i + si) % 5)}/10` } : {}), ...(m.week === 2 && si !== 1 ? { testTopic: `Unit test – ${m.topic}`, testResult: `${15 + ((i * 3 + si) % 10)}/25` } : {}) }));
    const ok = await soft(`attendance ${b.title}`, () => call(b.teacher, "PUT", `/teacher/attendance/${m.id}`, { lessonTaken: m.topic, homework: HOMEWORK[i % HOMEWORK.length], remarks: i % 4 === 0 ? "Class went well, covered the full topic." : "", rows }));
    if (ok) n++;
  }
  log(`📝 ${n} attendance forms submitted (${pastMeetings.length - n} pending)`);
}

// ---- 6. Upcoming classes (admin) ---------------------------------------------------------
const upcoming = []; // { id, batch, startAt }
async function upcomingClasses() {
  for (const [i, b] of BATCHES.entries()) {
    const startAt = istAt(7 - b.day, b.hour);
    const topic = TOPICS[b.subject][3];
    const r = await soft(`class ${b.title}`, () => call("admin", "POST", "/meetings", { teacherId: ids[b.teacher], subject: b.subject, studentIds: b.students.map((k) => ids[k]), title: `${b.title} – ${topic}`, durationMin: 60, startAt, repeatWeeks: 2, notes: i % 3 === 0 ? "Keep your notebook and calculator ready." : "" }));
    for (const [w, id] of (r?.ids || []).entries()) upcoming.push({ id, batch: b, startAt: plusMin(startAt, w * 7 * 1440) });
  }
  log(`🗓️  ${upcoming.length} upcoming classes`);
}

// ---- 7. Leave requests + schedule change requests --------------------------------------------
async function requests() {
  const reasons = ["We are travelling to Kerala for a family wedding", "I have my school science practical exam that day", "Doctor's appointment in the evening", "Inter-school sports meet", "Grandmother's birthday function", "Internet will be down – shifting house", "Feeling unwell, have a fever"];
  let n = 0;
  const leaveIds = [];
  for (let i = 0; i < 7; i++) {
    const m = upcoming[(i * 3) % upcoming.length];
    const sk = m.batch.students[i % m.batch.students.length];
    const r = await soft(`leave ${sk}`, () => call(sk, "POST", "/leave-requests", { meetingId: m.id, reason: reasons[i] }));
    if (r?.id) leaveIds.push(r.id), n++;
  }
  for (const [i, id] of leaveIds.entries()) {
    if (i < 3) await soft("leave approve", () => call("office", "POST", `/admin/leave-requests/${id}/decide`, { decision: "approve", note: "Approved. Please go through the class recording." }));
    else if (i === 3) await soft("leave reject", () => call("office", "POST", `/admin/leave-requests/${id}/decide`, { decision: "reject", note: "This is the revision class before the test – please attend if possible." }));
  }
  const sched = [
    { idx: 1, type: "reschedule", reason: "I have a parent–teacher meeting at my school that evening.", shiftMin: 24 * 60 + 90 },
    { idx: 4, type: "cancel", reason: "Public holiday – most students are travelling." },
    { idx: 7, type: "reschedule", reason: "Can we move this one hour later? Students asked for it after their school tuition.", shiftMin: 2 * 60 + 30 },
  ];
  const reqIds = [];
  for (const s of sched) {
    const m = upcoming[s.idx * 2 + 1];
    if (!m) continue;
    const r = await soft("schedule request", () => call(m.batch.teacher, "POST", "/schedule-requests", { meetingId: m.id, type: s.type, reason: s.reason, ...(s.shiftMin ? { proposedStartAt: plusMin(m.startAt, s.shiftMin), proposedDurationMin: 60 } : {}) }));
    if (r) {
      const q = await db.collection(C.scheduleRequests).where("meetingId", "==", m.id).get();
      if (!q.empty) reqIds.push(q.docs[0].id);
    }
  }
  if (reqIds[1]) await soft("schedule approve", () => call("admin", "POST", `/schedule-requests/${reqIds[1]}/decide`, { decision: "approve", note: "Okay – students will be informed." }));
  log(`🙋 ${n} leave requests, ${reqIds.length} schedule change requests`);
}

// ---- 8. Weekly timetable (admin) -----------------------------------------------------------
async function timetable() {
  let n = 0;
  for (const b of BATCHES) {
    const day = isoDay(istAt(-b.day, b.hour));
    const r = await soft(`timetable ${b.title}`, () => call("admin", "POST", "/timetable", { teacherId: ids[b.teacher], studentIds: b.students.map((k) => ids[k]), days: [day], start: `${b.hour}:00`, end: `${b.hour + 1}:00`, subject: b.subject, lesson: TOPICS[b.subject][3], notes: "" }));
    if (r) n++;
  }
  // Senior batches get a second weekly slot (Saturday / Sunday morning)
  for (const [i, k] of ["g8", "g9", "g10", "g4"].entries()) {
    const b = BATCHES.find((x) => x.key === k);
    if (await soft(`timetable extra ${b.title}`, () => call("admin", "POST", "/timetable", { teacherId: ids[b.teacher], studentIds: b.students.map((s) => ids[s]), days: [6 + (i % 2)], start: `${10 + i}:00`, end: `${11 + i}:00`, subject: b.subject, lesson: "Doubt clearing + practice", notes: "Weekend revision slot" }))) n++;
  }
  log(`🕒 ${n} timetable slots`);
}

// ---- 9. Materials (teachers) + student opens ------------------------------------------------
async function materials() {
  let n = 0;
  const kinds = [
    ["Worksheet", "Practice worksheet", (t) => [`Topic: ${t}`, "Answer all questions in your notebook.", "1. Short answer questions (5 x 2 marks)", "2. Long answer questions (2 x 5 marks)", "Submit a photo of your work before the next class."]],
    ["Notes", "Class notes", (t) => [`Topic: ${t}`, "Key definitions", "Important formulas and examples", "Common mistakes to avoid", "Summary points for revision"]],
  ];
  for (const [bi, b] of BATCHES.entries()) {
    for (let k = 0; k < 2; k++) {
      const topic = TOPICS[b.subject][k + 1];
      const [kind, label, lines] = kinds[(bi + k) % 2];
      const title = `${topic} – ${label}`;
      const r = await soft(`material ${title}`, () => upload(b.teacher, "/materials", { title, subject: b.subject, folder: kind === "Notes" ? "Class notes" : "Worksheets", description: `${label} for ${b.title}.`, studentIds: b.students.map((s) => ids[s]) }, pdfFile(`${title.replace(/[^\w]+/g, "-")}.pdf`, title, lines(topic))));
      const id = r?.id || r?.material?.id;
      if (!id) continue;
      n++;
      for (const [si, sk] of b.students.entries()) {
        if ((bi + k + si) % 3 === 2) continue; // some still unopened
        await soft("material open", () => call(sk, "POST", `/materials/${id}/opened`, {}));
        if ((bi + si) % 4 === 0) await soft("favourite", () => call(sk, "POST", `/materials/${id}/favourite`, { favourite: true }));
      }
    }
  }
  log(`📚 ${n} learning materials`);
}

// ---- 10. Lesson progress + private teacher notes -----------------------------------------
async function progress() {
  let l = 0, nn = 0;
  const NOTES = ["Strong in concepts, needs to work on speed.", "Gets nervous in tests – encourage more practice papers.", "Very regular and attentive.", "Struggles with word problems; give extra worksheets.", "Parent asked for a monthly progress call.", "Excellent improvement since the last session.", "Often joins a few minutes late – reminded politely.", "Ready for advanced problems."];
  for (const [bi, b] of BATCHES.entries()) {
    for (const [si, sk] of b.students.entries()) {
      for (let k = 0; k < (si === 0 ? 2 : 1); k++) {
        const status = k === 0 ? "completed" : "in_progress";
        if (await soft("lesson", () => call(b.teacher, "POST", "/lessons", { studentId: ids[sk], subject: b.subject, topic: TOPICS[b.subject][k], status, progress: status === "completed" ? 100 : 40 + ((bi + si) % 4) * 15, date: istDate(-(b.day + 7 * (2 - k))), comment: k === 0 ? "Completed with a short test." : "Continuing next class." }))) l++;
      }
      if ((bi + si) % 2 === 0 && nn < 14) if (await soft("note", () => call(b.teacher, "POST", "/notes", { studentId: ids[sk], text: NOTES[(bi + si) % NOTES.length], pinned: si === 0 }))) nn++;
    }
  }
  log(`📈 ${l} lesson progress entries, ${nn} teacher notes`);
}

// ---- 11. Messages: teacher–student chats, group chats --------------------------------------
async function messages() {
  const CHATS = [
    ["Good evening ma'am, I couldn't solve question 7 from the worksheet.", "Hi! Try factorising the middle term first – split 5x into 2x + 3x.", "Got it now, thank you!"],
    ["Sir, will we have the test this Saturday?", "Yes, it's on the last two chapters. 30 minutes.", "Okay sir, I'll revise."],
    ["Ma'am, I'll be 10 minutes late tomorrow, my school bus is late.", "No problem, join as soon as you can.", ""],
    ["Can you share the notes from today's class?", "I've uploaded them under Materials – Class notes.", "Found them, thanks!"],
    ["Sir, is the homework due next class?", "Yes, please bring it next class.", ""],
    ["Ma'am, my diagram for the experiment is attached in my notebook – can I show it in class?", "Sure, show it at the start of the class.", "Thank you ma'am"],
  ];
  let convs = 0, msgs = 0;
  let ci = 0;
  for (const b of BATCHES) {
    for (const sk of b.students.slice(0, b.students.length > 2 ? 2 : 1)) {
      if (convs >= 14) break;
      const r = await soft("conversation", () => call(sk, "POST", "/messages/conversations", { userId: ids[b.teacher] }));
      if (!r?.id) continue;
      convs++;
      const lines = CHATS[ci++ % CHATS.length];
      for (const [i, text] of lines.entries()) {
        if (!text) continue;
        if (await soft("message", () => call(i % 2 === 0 ? sk : b.teacher, "POST", `/messages/conversations/${r.id}/messages`, { text }))) msgs++;
      }
    }
  }
  // Group chats (admin)
  const GROUPS = [
    { name: "Grade 9 Maths batch", description: "Priya ma'am's Grade 9 Mathematics group", members: [...BATCHES[0].students, "priya"], managers: ["priya"], posts: [["admin", "Welcome to the Grade 9 Maths group! Class updates will be shared here."], ["priya", "Reminder: unit test on quadratic equations next week."]] },
    { name: "Grade 12 Board Prep", description: "Physics, Chemistry and Maths for Grade 12", members: ["karthik", "aisha", "dev", "tara", "arnav", "ira", "vikram", "fatima", "neha"], managers: ["vikram", "neha"], posts: [["admin", "Board exam timetable has been released – please check the announcement."], ["neha", "Extra doubt-clearing class this Sunday at 10 AM."], ["vikram", "Practice the numericals from chapter 3 before Thursday."]] },
    { name: "Teachers – staff room", description: "For all Silora Academy teachers", members: TEACHERS.map((t) => t.key), managers: [], onlyAdminsPost: false, posts: [["admin", "Please submit attendance forms within 24 hours of every class."], ["admin", "Teacher payments for completed sessions are being processed this week."]] },
  ];
  let groups = 0;
  for (const g of GROUPS) {
    const r = await soft(`group ${g.name}`, () => call("admin", "POST", "/admin/groups", { name: g.name, description: g.description, memberIds: g.members.map((k) => ids[k]), managerIds: g.managers.map((k) => ids[k]), onlyAdminsPost: !!g.onlyAdminsPost }));
    const id = r?.id || r?.group?.id || r?.conversation?.id;
    if (!id) continue;
    groups++;
    for (const [who, text] of g.posts) {
      const path = who === "admin" ? `/admin/groups/conversations/${id}/messages` : `/messages/conversations/${id}/messages`;
      if (await soft("group post", () => call(who, "POST", path, { text }))) msgs++;
    }
  }
  log(`💬 ${convs} teacher–student chats, ${groups} group chats, ${msgs} messages`);
}

// ---- 12. Announcements -------------------------------------------------------------------
async function announcements() {
  const LIST = [
    { title: "Welcome to the new Silora Academy portal", body: "Your classes, materials, attendance and fee details are now in one place. Join classes from your dashboard a few minutes before they start.", priority: "important", audience: "all", pinned: true },
    { title: "Mid-term tests from next week", body: "Mid-term tests for all subjects start next week during regular class time. Your teachers will share the syllabus in the class groups.", priority: "important", audience: "students" },
    { title: "Fee proof for the new session", body: "Please upload your payment receipt for the new session under Fees. Classes stay open, but materials and recordings unlock once the proof is uploaded.", priority: "urgent", audience: "students" },
    { title: "Attendance forms – 24 hour reminder", body: "Teachers, please submit the attendance form within 24 hours of each class. Late forms delay teacher payments.", priority: "normal", audience: "teachers" },
    { title: "Diwali holiday", body: "There will be no classes on the Diwali holiday. Missed classes will be rescheduled by your teacher.", priority: "normal", audience: "all" },
    { title: "Parent–teacher meeting next month", body: "We will hold online parent–teacher meetings next month. You will receive a time slot by email.", priority: "normal", audience: "students", publishAt: istAt(3, 10) },
  ];
  let n = 0;
  for (const a of LIST) if (await soft(`announcement ${a.title}`, () => call("admin", "POST", "/admin/announcements", a))) n++;
  log(`📣 ${n} announcements`);
}

// ---- 13. Demo class requests (website form) + admin follow-up ---------------------------------
async function demos() {
  const PEOPLE = [
    ["Riya Saxena", "Grade 9", "CBSE", "Dubai", "", "UAE"], ["Aryan Bhatt", "Grade 10", "ICSE", "Pune", "Maharashtra", "India"], ["Sneha Pillai", "Grade 8", "CBSE", "Kochi", "Kerala", "India"],
    ["Yash Agarwal", "Grade 11", "CBSE", "Jaipur", "Rajasthan", "India"], ["Fiza Ansari", "Grade 12", "CBSE", "Doha", "", "Qatar"], ["Omkar Patil", "Grade 7", "CBSE", "Nagpur", "Maharashtra", "India"],
    ["Lavanya Rao", "Grade 10", "IGCSE", "Singapore", "", "Singapore"], ["Siddharth Nair", "Grade 9", "ICSE", "Bengaluru", "Karnataka", "India"], ["Hiba Siddiqui", "Grade 11", "CBSE", "Muscat", "", "Oman"],
    ["Pranav Iyer", "Grade 12", "CBSE", "Chennai", "Tamil Nadu", "India"], ["Anika Sen", "Grade 6", "CBSE", "Kolkata", "West Bengal", "India"], ["Tanmay Joshi", "Grade 10", "CBSE", "Ahmedabad", "Gujarat", "India"],
    ["Mahi Choudhary", "Grade 9", "CBSE", "Riyadh", "", "Saudi Arabia"], ["Rehan Qureshi", "Grade 8", "ICSE", "Lucknow", "Uttar Pradesh", "India"], ["Navya Menon", "Grade 11", "IGCSE", "London", "", "UK"],
    ["Kiaan Shah", "Grade 7", "CBSE", "Mumbai", "Maharashtra", "India"], ["Avni Mishra", "Grade 12", "CBSE", "Bhopal", "Madhya Pradesh", "India"], ["Shaurya Kapoor", "Grade 10", "CBSE", "Gurugram", "Haryana", "India"],
    ["Ira Banerjee", "Grade 9", "ICSE", "Sharjah", "", "UAE"], ["Neil D'Souza", "Grade 11", "CBSE", "Mangaluru", "Karnataka", "India"],
  ];
  const created = [];
  for (const [i, [name, grade, board, city, state, country]] of PEOPLE.entries()) {
    const r = await soft(`demo ${name}`, () => saveDemoRequest({ name, email: `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.com`, mobile: `+91 9${String(800000000 + i * 7919).slice(0, 9)}`, class_grade: grade, board, city, state, country }, `10.20.0.${i + 1}`));
    if (r?.id) {
      created.push({ id: r.id, grade });
      // spread the requests over the last three weeks
      await db.collection(C.demoRequests).doc(r.id).update({ createdAt: daysAgo(21 - i), updatedAt: daysAgo(21 - i) });
    }
  }
  const pick = [
    ["priya", "Mathematics"], ["arjun", "English"], ["fatima", "Biology"], ["rahul", "Computer Science"], ["neha", "Mathematics"], ["vikram", "Physics"],
  ];
  for (const [i, [t, subject]] of pick.entries()) {
    const d = created[i * 3];
    if (d) await soft("demo schedule", () => call("office", "POST", `/admin/demos/${d.id}/schedule`, { teacherId: ids[t], subject, startAt: istAt(2 + (i % 4), 11 + (i % 3)), durationMin: 30 }));
  }
  if (created[1]) await soft("demo cancel", () => call("office", "PATCH", `/admin/demos/${created[1].id}`, { status: "cancelled", notes: "Parent said they have already joined another academy." }));
  if (created[4]) await soft("demo no-show", () => call("office", "PATCH", `/admin/demos/${created[4].id}`, { status: "no_show", notes: "Called twice, no answer. Try again next week." }));
  if (created[7]) await soft("demo notes", () => call("office", "PATCH", `/admin/demos/${created[7].id}`, { notes: "Prefers weekend classes. Call after 6 PM." }));
  log(`🎯 ${created.length} demo class requests (6 scheduled)`);
}

// ---- 14. Teacher payments: pay most completed sessions -----------------------------------------
async function teacherPayments() {
  const due = (await db.collection(C.teacherPayments).where("status", "==", "due").get()).docs;
  let paid = 0;
  for (const [i, d] of due.entries()) {
    if (i % 3 === 2) continue; // some still due
    const p = d.data();
    const amount = 350 * (p.conductedClasses || 3) + (i % 2) * 200;
    const ref = `NEFT${String(88213400 + i * 113)}`;
    if (await soft("teacher payment", () => upload("accounts", `/admin/teacher-payments/${d.id}/pay`, { amount: String(amount), paidOn: istDate(-(i % 3)), reference: ref, note: `${p.conductedClasses} classes × ₹350` }, pdfFile(`payout-${ref}.pdf`, "Bank transfer confirmation", [`Beneficiary: ${p.teacherName}`, `Amount: INR ${amount}`, `Reference: ${ref}`, `For: ${p.sessionName} (${p.studentName})`, "Status: SUCCESS"])))) paid++;
  }
  const total = (await db.collection(C.teacherPayments).get()).size;
  log(`💰 ${total} teacher payment records (${paid} paid, ${due.length - paid} due, rest pending)`);
}

// ---- 15. Backups -----------------------------------------------------------------------------
async function backups() {
  const r = await soft("backup", () => call("admin", "POST", "/admin/backups", {}));
  log(r ? `🗄️  1 backup created (${r.backup?.docs ?? "?"} records)` : "🗄️  backup skipped");
}

// ---- Run ------------------------------------------------------------------------------------
const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
if (!health?.emulators) {
  console.error(`The portal API at ${API} isn't running on the emulators. Start the backend with USE_FIREBASE_EMULATORS=true first.`);
  process.exit(1);
}
if (process.argv.includes("--reset")) await wipe();
else if (!(await db.collection(C.users).limit(1).get()).empty) {
  console.error("The emulator already has users. Run with --reset to wipe it and load the sample data.");
  process.exit(1);
}
await accounts();
await pastClasses();
await sessions();
await fees();
await attendanceForms();
await upcomingClasses();
await requests();
await timetable();
await materials();
await progress();
await messages();
await announcements();
await demos();
await teacherPayments();
await backups();

log("\n✅ Sample data ready" + (warnings ? ` (${warnings} warnings above)` : ""));
log("\nSign in at http://localhost:5173/portal/login");
log(`  Super admin : admin@silora.test      / ${PW.admin}`);
log(`  Office admin: office@silora.test     / ${PW.admin}   (users, classes, attendance, demos…)`);
log(`  Accounts    : accounts@silora.test   / ${PW.admin}   (fees, teacher payments, reports)`);
log(`  Teachers    : ${TEACHERS.map((t) => emailOf(t.key)).join(", ")} / ${PW.teacher}`);
log(`  Students    : ${STUDENTS.map((s) => emailOf(s.key)).join(", ")} / ${PW.student}`);
process.exit(0);
