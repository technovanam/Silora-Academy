// ============================================================================
// CLASS LOBBY ("Ask to join", like Google Meet)
// Students (and anyone who opened a shared class link) wait here until a host
// (the teacher or an admin) lets them in. Lobby state only matters while a class
// is running, so it lives in memory; after a restart people simply ask again.
// ============================================================================

const lobbies = new Map(); // meetingId -> Map(userId -> entry)
const STALE_MS = 20000; // a waiting person who stops polling has closed the page

function lobby(meetingId) {
  if (!lobbies.has(meetingId)) lobbies.set(meetingId, new Map());
  return lobbies.get(meetingId);
}

/** Ask to join (or ask again after being turned away). */
export function requestEntry(meetingId, user, { enrolled }) {
  const l = lobby(meetingId);
  const cur = l.get(user.id);
  if (cur?.status === "admitted") return touch(meetingId, user.id);
  const entry = { userId: user.id, name: user.name, role: user.role, enrolled: !!enrolled, status: "waiting", requestedAt: Date.now(), seenAt: Date.now(), denials: cur?.denials || 0 };
  l.set(user.id, entry);
  return entry;
}

/** The waiting page polls this – keeps the request alive. */
export function touch(meetingId, userId) {
  const e = lobbies.get(meetingId)?.get(userId);
  if (e) e.seenAt = Date.now();
  return e || null;
}

export const entryFor = (meetingId, userId) => lobbies.get(meetingId)?.get(userId) || null;

export function cancelEntry(meetingId, userId) {
  const e = entryFor(meetingId, userId);
  if (e && e.status !== "admitted") lobbies.get(meetingId).delete(userId);
}

export function waiting(meetingId) {
  const now = Date.now();
  return [...(lobbies.get(meetingId)?.values() || [])].filter((e) => e.status === "waiting" && now - e.seenAt < STALE_MS).sort((a, b) => a.requestedAt - b.requestedAt);
}

export function decide(meetingId, userId, admit) {
  const e = entryFor(meetingId, userId);
  if (!e) return null;
  e.status = admit ? "admitted" : "denied";
  if (!admit) e.denials += 1;
  e.decidedAt = Date.now();
  return e;
}

/** Admit directly (auto-admit for enrolled students). */
export function admit(meetingId, user, { enrolled }) {
  const e = requestEntry(meetingId, user, { enrolled });
  e.status = "admitted";
  e.decidedAt = Date.now();
  return e;
}

/** Removed from class: must ask again to come back. */
export const forget = (meetingId, userId) => lobbies.get(meetingId)?.delete(userId);
export const clearLobby = (meetingId) => lobbies.delete(meetingId);
