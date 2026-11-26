// One teacher per subject: a student has rows like [{ subject: "Mathematics", teacherId }]
// (the backend checks the same rules – this only keeps the pickers tidy)
const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

export const rowsOf = (s) => s?.subjectTeachers || [];
export const teacherIdsOf = (s) => s?.teacherIds || [...new Set(rowsOf(s).map((r) => r.teacherId).filter(Boolean))];

/** Can this teacher take this student (for this subject, when given)? */
export function canTeach(s, teacherId, subject) {
  if (!teacherId || !teacherIdsOf(s).includes(teacherId)) return false;
  if (!subject) return true;
  const row = rowsOf(s).find((r) => r.subject && same(r.subject, subject));
  return !row || row.teacherId === teacherId;
}

/** "Mathematics – Ms A · Science – Mr B" */
export const teachersLine = (s, nameOf) =>
  rowsOf(s)
    .filter((r) => r.teacherId)
    .map((r) => (r.subject ? `${r.subject} – ${nameOf(r.teacherId) || "—"}` : nameOf(r.teacherId) || "—"))
    .join(" · ");

/** The subjects this teacher teaches this student */
export const subjectsWith = (s, teacherId) => rowsOf(s).filter((r) => r.teacherId === teacherId && r.subject).map((r) => r.subject);
