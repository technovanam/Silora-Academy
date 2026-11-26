// ============================================================================
// ONE-TIME MIGRATION – one teacher per subject
// ============================================================================
// Students used to have a single teacherId. Now each subject has its own teacher:
//   subjectTeachers: [{ subject: "Mathematics", teacherId }, ...] + teacherIds: [...]
// This gives every existing student's subjects their current teacher, so nothing changes
// for anyone until the admin edits a student's subjects & teachers.
//
// Dry run (shows what would change, writes nothing):   node scripts/migrate-subject-teachers.js
// Apply:                                                 node scripts/migrate-subject-teachers.js --apply
//
// It uses the same .env as the backend, so check which project it points at first.
// Safe to run twice: students that already have subjectTeachers are skipped.
import config from "../portal/config.js";
import { db, C } from "../portal/firebase.js";
import { assignmentFields, subjectTeachersOf } from "../portal/services/core.js";

const apply = process.argv.includes("--apply");
console.log(`Project: ${config.projectId}${config.useEmulators ? " (emulators)" : ""} · ${apply ? "APPLYING" : "dry run"}`);

const qs = await db.collection(C.users).where("role", "==", "student").get();
let changed = 0;
let skipped = 0;
for (const d of qs.docs) {
  const s = { id: d.id, ...d.data() };
  if (s.purged || Array.isArray(s.subjectTeachers)) {
    skipped++;
    continue;
  }
  const rows = subjectTeachersOf(s).filter((r) => r.subject || r.teacherId);
  // An old student with a teacher but no subject list keeps that teacher (subject left blank)
  const fields = assignmentFields(rows);
  console.log(`- ${s.name || s.id}: ${fields.subjectTeachers.map((r) => `${r.subject || "(no subject)"} → ${r.teacherId || "none"}`).join(", ") || "no subjects"}`);
  if (apply) await d.ref.update({ ...fields, legacyTeacherId: s.teacherId || null, migratedAt: new Date().toISOString() });
  changed++;
}
console.log(`${changed} student(s) ${apply ? "updated" : "to update"}, ${skipped} already done.`);
process.exit(0);
