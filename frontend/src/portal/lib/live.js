// ============================================================
// LIVE CLASS ENGINE – our own meeting, no video company.
//
// Video and sound go straight between browsers (WebRTC). Each student
// connects only to the teacher (the "host"):
//   • the teacher's camera, microphone and shared screen go to every student
//   • a student's microphone / camera is sent only after the teacher lets them
//     speak; the teacher's browser then passes it on to the rest of the class
//     (at most two speakers at a time)
// Browsers swap their connection details through Firestore (liveRooms/*).
// Google's free public address helper (STUN) lets browsers on different
// networks find each other; no video or sound passes through it.
// ============================================================
import { app, USE_EMULATORS } from "./firebase.js";

const env = import.meta.env;

function iceServers() {
  try {
    if (env.VITE_ICE_SERVERS) return JSON.parse(env.VITE_ICE_SERVERS);
  } catch {
    /* fall back to the default */
  }
  return [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
}
export const ICE_SERVERS = iceServers();

// The teacher's total upload for all students together (kbit/s). Shared out per student.
const UPLOAD_BUDGET_KBPS = Number(env.VITE_LIVE_UPLOAD_KBPS) || 9000;
export const MAX_SPEAKERS = 2;

// Order of the media lines in every teacher ↔ student connection
const T = { AUDIO: 0, VIDEO: 1, SCREEN: 2 };
const SPK_AUDIO = (i) => 3 + i * 2;
const SPK_VIDEO = (i) => 4 + i * 2;

let dbPromise;
/** Firestore is only loaded on the class page. */
export function liveDb() {
  return (dbPromise ||= import("firebase/firestore").then((fs) => {
    const id = env.VITE_FIREBASE_DATABASE_ID;
    const db = id && !USE_EMULATORS ? fs.getFirestore(app, id) : fs.getFirestore(app);
    if (USE_EMULATORS) {
      const [host, port] = (env.VITE_FIRESTORE_EMULATOR || "127.0.0.1:8085").split(":");
      try {
        fs.connectFirestoreEmulator(db, host, Number(port));
      } catch {
        /* already connected */
      }
    }
    return { db, fs };
  }));
}

export const canShareScreen = () => !!navigator.mediaDevices?.getDisplayMedia && !/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

export function mediaErrorText(e) {
  const n = e?.name || "";
  if (n === "NotAllowedError" || n === "SecurityError") return "The browser blocked the camera or microphone. Allow it from the lock icon next to the address bar, then try again.";
  if (n === "NotFoundError" || n === "OverconstrainedError") return "No camera or microphone was found on this device.";
  if (n === "NotReadableError") return "The camera or microphone is being used by another app. Close it and try again.";
  return "Couldn't start the camera or microphone.";
}

export const getMic = () =>
  navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }).then((s) => s.getAudioTracks()[0]);
export const getCam = (small) =>
  navigator.mediaDevices
    .getUserMedia({ video: small ? { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 15, max: 15 } } : { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24, max: 24 } } })
    .then((s) => s.getVideoTracks()[0]);

// Send the connection details in one go (all network addresses gathered first)
function waitIce(pc, ms = 3500) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", check);
      clearTimeout(t);
      resolve();
    };
    const check = () => pc.iceGatheringState === "complete" && done();
    const t = setTimeout(done, ms);
    pc.addEventListener("icegatheringstatechange", check);
  });
}

async function setBitrate(sender, kbps) {
  try {
    const p = sender.getParameters();
    if (!p.encodings || !p.encodings.length) p.encodings = [{}];
    p.encodings[0].maxBitrate = Math.round(Math.max(60, kbps) * 1000);
    await sender.setParameters(p);
  } catch {
    /* not ready yet – applied again on the next change */
  }
}

const desc = (d) => ({ type: d.type, sdp: d.sdp });
const streamOf = (track) => new MediaStream(track ? [track] : []);

class Emitter {
  constructor(onChange) {
    this.onChange = onChange;
    this.version = 0;
  }
  emit() {
    this.version++;
    this.onChange?.(this.version);
  }
}

// ============================================================
// TEACHER (host)
// ============================================================
export class HostEngine extends Emitter {
  constructor({ db, fs, mid, uid, onChange, onError }) {
    super(onChange);
    Object.assign(this, { db, fs, mid, uid, onError });
    this.peers = new Map(); // studentId → { pc, tr, gen, state, attempts, audio, video }
    this.people = [];
    this.room = null;
    this.speakers = [null, null];
    this.mic = null;
    this.cam = null;
    this.screen = null;
    this.micOn = false;
    this.camOn = false;
    this.unsubs = [];
    this.closed = false;
  }

  ref(...path) {
    return this.fs.doc(this.db, "liveRooms", this.mid, ...path);
  }

  /** Start with the camera / microphone chosen on the pre-join screen. */
  async start({ mic, cam }) {
    this.mic = mic || null;
    this.cam = cam || null;
    this.micOn = !!mic && mic.enabled !== false;
    this.camOn = !!cam;
    const { fs, db, mid } = this;
    const room = (await fs.getDoc(this.ref())).data() || {};
    this.speakers = (room.speakers || [null, null]).map((s) => s?.uid || null);
    await this.pushRoomFlags();
    this.unsubs.push(
      fs.onSnapshot(
        this.ref(),
        (s) => {
          this.room = s.data() || null;
          this.emit();
        },
        (e) => this.onError?.(e)
      ),
      fs.onSnapshot(
        fs.collection(db, "liveRooms", mid, "people"),
        (qs) => {
          this.people = qs.docs.map((d) => ({ id: d.id, ...d.data() }));
          this.syncPeers();
          this.emit();
        },
        (e) => this.onError?.(e)
      ),
      fs.onSnapshot(
        fs.collection(db, "liveRooms", mid, "signals"),
        (qs) => qs.docs.forEach((d) => this.onSignal(d.id, d.data())),
        (e) => this.onError?.(e)
      )
    );
  }

  pushRoomFlags() {
    return this.fs.updateDoc(this.ref(), { hostCam: this.camOn && !!this.cam, hostMic: this.micOn && !!this.mic, screen: !!this.screen }).catch(() => {});
  }

  syncPeers() {
    if (this.closed) return;
    const inClass = this.people.filter((p) => p.status === "in" && p.id !== this.uid);
    const ids = new Set(inClass.map((p) => p.id));
    for (const id of ids) if (!this.peers.has(id)) this.connect(id);
    for (const id of [...this.peers.keys()]) if (!ids.has(id)) this.dropPeer(id);
    // Speakers who left or lost permission stop being passed on
    const next = this.speakers.map((s) => (s && ids.has(s) && inClass.find((p) => p.id === s)?.canSpeak ? s : null));
    if (next.some((s, i) => s !== this.speakers[i])) this.setSpeakers(next);
  }

  async connect(id) {
    if (this.closed) return;
    const old = this.peers.get(id);
    if (old) {
      clearTimeout(old.timer);
      old.pc.close();
    }
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const tr = [
      pc.addTransceiver("audio", { direction: "sendrecv" }), // teacher mic → / ← student mic
      pc.addTransceiver("video", { direction: "sendrecv" }), // teacher camera → / ← student camera
      pc.addTransceiver("video", { direction: "sendonly" }), // shared screen
      pc.addTransceiver("audio", { direction: "sendonly" }), // speaker 1
      pc.addTransceiver("video", { direction: "sendonly" }),
      pc.addTransceiver("audio", { direction: "sendonly" }), // speaker 2
      pc.addTransceiver("video", { direction: "sendonly" }),
    ];
    const peer = {
      id,
      pc,
      tr,
      gen: Date.now(),
      state: "connecting",
      attempts: old?.attempts || 0,
      lastNeed: 0,
      audio: streamOf(tr[T.AUDIO].receiver.track),
      video: streamOf(tr[T.VIDEO].receiver.track),
    };
    this.peers.set(id, peer);
    pc.onconnectionstatechange = () => this.onPeerState(peer);
    this.applyTracks(peer);
    // Anyone passing this student on to the class needs the new tracks
    if (this.speakers.includes(id)) this.peers.forEach((p) => p !== peer && this.applyTracks(p));
    this.emit();
    try {
      await pc.setLocalDescription(await pc.createOffer());
      await waitIce(pc);
      if (this.peers.get(id) !== peer || this.closed) return;
      await this.fs.setDoc(this.ref("signals", id), { gen: peer.gen, offer: desc(pc.localDescription), answer: null, answerGen: 0, needOffer: 0, at: this.fs.serverTimestamp() });
    } catch (e) {
      this.onError?.(e);
    }
    peer.timer = setTimeout(() => peer.pc.connectionState !== "connected" && this.retry(peer), 30000);
  }

  onSignal(id, d) {
    const peer = this.peers.get(id);
    if (!peer || !d || d.gen !== peer.gen) return; // an older connection's details
    if ((d.needOffer || 0) > peer.lastNeed) {
      // The student asked for a fresh connection
      peer.lastNeed = d.needOffer;
      peer.attempts = 0;
      this.connect(id);
      return;
    }
    if (d.answer && d.answerGen === peer.gen && peer.pc.signalingState === "have-local-offer") {
      peer.pc
        .setRemoteDescription(d.answer)
        .then(() => this.applyBitrates(peer))
        .catch((e) => this.onError?.(e));
    }
  }

  onPeerState(peer) {
    if (this.peers.get(peer.id) !== peer) return;
    const s = peer.pc.connectionState;
    clearTimeout(peer.timer);
    if (s === "connected") {
      peer.state = "connected";
      peer.attempts = 0;
      this.applyBitrates(peer);
    } else if (s === "failed") this.retry(peer);
    else if (s === "disconnected") {
      peer.state = "reconnecting";
      peer.timer = setTimeout(() => peer.pc.connectionState !== "connected" && this.retry(peer), 8000);
    }
    this.emit();
  }

  retry(peer) {
    if (this.peers.get(peer.id) !== peer || this.closed) return;
    peer.attempts++;
    if (peer.attempts > 3) {
      peer.state = "failed"; // most likely a network that blocks direct connections
      this.emit();
      return;
    }
    peer.state = "reconnecting";
    this.connect(peer.id);
  }

  dropPeer(id) {
    const p = this.peers.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    p.pc.close();
    this.peers.delete(id);
    this.fs.deleteDoc(this.ref("signals", id)).catch(() => {});
    this.applyAllBitrates();
    this.emit();
  }

  applyTracks(peer) {
    const s = peer.tr;
    s[T.AUDIO].sender.replaceTrack(this.mic).catch(() => {});
    s[T.VIDEO].sender.replaceTrack(this.camOn ? this.cam : null).catch(() => {});
    s[T.SCREEN].sender.replaceTrack(this.screen).catch(() => {});
    this.speakers.forEach((uid, i) => {
      const src = uid && uid !== peer.id ? this.peers.get(uid) : null;
      s[SPK_AUDIO(i)].sender.replaceTrack(src ? src.tr[T.AUDIO].receiver.track : null).catch(() => {});
      s[SPK_VIDEO(i)].sender.replaceTrack(src ? src.tr[T.VIDEO].receiver.track : null).catch(() => {});
    });
  }

  applyBitrates(peer) {
    // Share the teacher's upload between all students
    const per = UPLOAD_BUDGET_KBPS / Math.max(1, this.peers.size);
    const sharing = !!this.screen;
    setBitrate(peer.tr[T.VIDEO].sender, sharing ? Math.min(150, per * 0.2) : Math.min(700, per * 0.8));
    setBitrate(peer.tr[T.SCREEN].sender, Math.min(1200, per * 0.7));
    for (let i = 0; i < MAX_SPEAKERS; i++) setBitrate(peer.tr[SPK_VIDEO(i)].sender, Math.min(250, per * 0.15));
  }
  applyAllBitrates() {
    this.peers.forEach((p) => this.applyBitrates(p));
  }

  // ---- Teacher's own camera / microphone / screen ----
  async setMic(on) {
    if (on && !this.mic) {
      this.mic = await getMic();
      this.peers.forEach((p) => this.applyTracks(p));
    }
    if (this.mic) this.mic.enabled = on;
    this.micOn = on;
    await this.pushRoomFlags();
    this.emit();
  }

  async setCam(on) {
    if (on && !this.cam) this.cam = await getCam(false);
    if (!on && this.cam) {
      this.cam.stop();
      this.cam = null;
    }
    this.camOn = on && !!this.cam;
    this.peers.forEach((p) => this.applyTracks(p));
    await this.pushRoomFlags();
    this.emit();
  }

  async setScreen(on) {
    if (on && !this.screen) {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 10, max: 15 }, width: { max: 1280 }, height: { max: 720 } }, audio: false });
      const track = s.getVideoTracks()[0];
      track.contentHint = "detail";
      track.addEventListener("ended", () => this.setScreen(false));
      this.screen = track;
    } else if (!on && this.screen) {
      this.screen.stop();
      this.screen = null;
    }
    this.peers.forEach((p) => this.applyTracks(p));
    this.applyAllBitrates();
    await this.pushRoomFlags();
    this.emit();
  }

  // ---- Who may speak ----
  async allowSpeak(id, on, video = false) {
    const person = this.people.find((p) => p.id === id);
    if (!person) return;
    if (on && !this.speakers.includes(id)) {
      const free = this.speakers.indexOf(null);
      if (free === -1) throw new Error(`Only ${MAX_SPEAKERS} students can speak at a time. Stop someone else first.`);
      const next = [...this.speakers];
      next[free] = id;
      await this.fs.updateDoc(this.ref("people", id), { canSpeak: true, canVideo: !!video, hand: false });
      await this.setSpeakers(next);
    } else if (on) {
      await this.fs.updateDoc(this.ref("people", id), { canSpeak: true, canVideo: !!video, hand: false });
    } else {
      await this.fs.updateDoc(this.ref("people", id), { canSpeak: false, canVideo: false });
      await this.setSpeakers(this.speakers.map((s) => (s === id ? null : s)));
    }
  }

  lowerHand(id) {
    return this.fs.updateDoc(this.ref("people", id), { hand: false });
  }

  async setSpeakers(list) {
    this.speakers = list;
    this.peers.forEach((p) => this.applyTracks(p));
    const name = (id) => this.people.find((p) => p.id === id)?.name || "Student";
    await this.fs.updateDoc(this.ref(), { speakers: list.map((id) => (id ? { uid: id, name: name(id) } : null)) }).catch(() => {});
    this.emit();
  }

  close() {
    this.closed = true;
    this.unsubs.forEach((u) => u());
    this.peers.forEach((p) => {
      clearTimeout(p.timer);
      p.pc.close();
    });
    this.peers.clear();
    [this.mic, this.cam, this.screen].forEach((t) => t?.stop());
  }
}

// ============================================================
// STUDENT (and anyone else who joins: other teachers, admins)
// ============================================================
export class ParticipantEngine extends Emitter {
  constructor({ db, fs, mid, uid, onChange, onError }) {
    super(onChange);
    Object.assign(this, { db, fs, mid, uid, onError });
    this.room = null;
    this.me = null;
    this.pc = null;
    this.tr = null;
    this.gen = 0;
    this.lastSig = null;
    this.state = "waiting"; // waiting | connecting | connected | reconnecting | blocked
    this.attempts = 0;
    this.streams = null;
    this.mic = null;
    this.cam = null;
    this.micOn = false;
    this.camOn = false;
    this.mediaError = null;
    this.unsubs = [];
    this.sigUnsub = null;
    this.closed = false;
  }

  ref(...path) {
    return this.fs.doc(this.db, "liveRooms", this.mid, ...path);
  }

  start() {
    this.unsubs.push(
      this.fs.onSnapshot(
        this.ref("people", this.uid),
        (s) => this.onMe(s.data() || null),
        (e) => this.onError?.(e)
      )
    );
    this.watchRoom();
  }

  watchRoom() {
    if (this.closed) return;
    this.roomUnsub?.();
    this.roomUnsub = this.fs.onSnapshot(
      this.ref(),
      (s) => {
        this.room = s.data() || null;
        this.watchSignals();
        this.emit();
      },
      () => setTimeout(() => this.watchRoom(), 2000) // our join request may not be visible yet
    );
  }

  onMe(me) {
    const prev = this.me;
    this.me = me;
    // Permission to speak just given → switch the mic on (and camera if allowed)
    if (me?.canSpeak && !prev?.canSpeak) this.micOn = true;
    if (me?.canVideo && !prev?.canVideo) this.camOn = true;
    if (!me?.canSpeak) this.micOn = false;
    if (!me?.canVideo) this.camOn = false;
    this.watchSignals();
    this.applySend();
    this.emit();
  }

  inClass() {
    return this.me?.status === "in" && this.room?.status === "live";
  }

  watchSignals() {
    if (this.closed) return;
    if (this.inClass() && !this.sigUnsub) {
      if (this.state === "waiting") this.state = "connecting";
      this.sigUnsub = this.fs.onSnapshot(
        this.ref("signals", this.uid),
        (s) => this.onSignal(s.data() || null),
        () => {
          // Rules can briefly lag behind being let in – try again
          this.sigUnsub = null;
          setTimeout(() => this.watchSignals(), 1500);
        }
      );
      clearTimeout(this.offerTimer);
      this.offerTimer = setTimeout(() => this.state !== "connected" && this.requestOffer(), 20000);
    } else if (!this.inClass() && this.sigUnsub) {
      this.sigUnsub();
      this.sigUnsub = null;
      this.pc?.close();
      this.pc = null;
      this.streams = null;
      this.state = "waiting";
    }
  }

  async onSignal(d) {
    this.lastSig = d;
    if (!d?.offer || d.gen <= this.gen) return;
    this.gen = d.gen;
    this.pc?.close();
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc = pc;
    this.state = this.state === "connected" ? "reconnecting" : "connecting";
    pc.onconnectionstatechange = () => this.onState(pc);
    try {
      await pc.setRemoteDescription(d.offer);
      const tr = pc.getTransceivers();
      tr[T.AUDIO].direction = "sendrecv";
      tr[T.VIDEO].direction = "sendrecv";
      for (let i = 2; i < tr.length; i++) tr[i].direction = "recvonly";
      this.tr = tr;
      const track = (i) => tr[i]?.receiver.track;
      this.streams = {
        teacherAudio: streamOf(track(T.AUDIO)),
        teacherVideo: streamOf(track(T.VIDEO)),
        screen: streamOf(track(T.SCREEN)),
        speakers: [0, 1].map((i) => ({ audio: streamOf(track(SPK_AUDIO(i))), video: streamOf(track(SPK_VIDEO(i))) })),
      };
      await this.applySend();
      await pc.setLocalDescription(await pc.createAnswer());
      await waitIce(pc);
      if (this.pc !== pc || this.closed) return;
      await this.fs.updateDoc(this.ref("signals", this.uid), { answer: desc(pc.localDescription), answerGen: d.gen });
    } catch (e) {
      this.onError?.(e);
    }
    this.emit();
  }

  onState(pc) {
    if (this.pc !== pc) return;
    const s = pc.connectionState;
    clearTimeout(this.stateTimer);
    if (s === "connected") {
      this.state = "connected";
      this.attempts = 0;
    } else if (s === "failed") this.requestOffer();
    else if (s === "disconnected") {
      this.state = "reconnecting";
      this.stateTimer = setTimeout(() => pc.connectionState !== "connected" && this.requestOffer(), 8000);
    }
    this.emit();
  }

  /** Ask the teacher's browser for a fresh connection. */
  async requestOffer() {
    if (this.closed || !this.inClass()) return;
    this.attempts++;
    if (this.attempts > 3) {
      this.state = "blocked";
      this.emit();
      return;
    }
    this.state = "reconnecting";
    this.emit();
    await this.fs.updateDoc(this.ref("signals", this.uid), { needOffer: (this.lastSig?.needOffer || 0) + 1 }).catch(() => {});
    clearTimeout(this.offerTimer);
    this.offerTimer = setTimeout(() => this.state !== "connected" && this.requestOffer(), 25000);
  }

  retryNow() {
    this.attempts = 0;
    this.requestOffer();
  }

  // Send our mic / camera only while the teacher allows it
  async applySend() {
    const me = this.me || {};
    this.mediaError = null;
    try {
      if (me.canSpeak && !this.mic) this.mic = await getMic();
    } catch (e) {
      this.mediaError = mediaErrorText(e);
      this.micOn = false;
    }
    if (!me.canSpeak && this.mic) {
      this.mic.stop();
      this.mic = null;
    }
    if (this.mic) this.mic.enabled = this.micOn;
    try {
      if (me.canVideo && this.camOn && !this.cam) this.cam = await getCam(true);
    } catch (e) {
      this.mediaError = mediaErrorText(e);
      this.camOn = false;
    }
    if ((!me.canVideo || !this.camOn) && this.cam) {
      this.cam.stop();
      this.cam = null;
    }
    if (this.tr) {
      await this.tr[T.AUDIO].sender.replaceTrack(this.mic).catch(() => {});
      await this.tr[T.VIDEO].sender.replaceTrack(this.cam).catch(() => {});
      setBitrate(this.tr[T.VIDEO].sender, 250);
    }
    if (me.status === "in" && (me.micOn !== this.micOn || me.camOn !== !!this.cam)) {
      this.fs.updateDoc(this.ref("people", this.uid), { micOn: this.micOn, camOn: !!this.cam }).catch(() => {});
    }
    this.emit();
  }

  async setMic(on) {
    this.micOn = on && !!this.me?.canSpeak;
    await this.applySend();
  }
  async setCam(on) {
    this.camOn = on && !!this.me?.canVideo;
    await this.applySend();
  }
  raiseHand(on) {
    return this.fs.updateDoc(this.ref("people", this.uid), { hand: on, handAt: this.fs.serverTimestamp() });
  }

  close() {
    this.closed = true;
    clearTimeout(this.offerTimer);
    clearTimeout(this.stateTimer);
    this.unsubs.forEach((u) => u());
    this.roomUnsub?.();
    this.sigUnsub?.();
    this.pc?.close();
    [this.mic, this.cam].forEach((t) => t?.stop());
  }
}

// ============================================================
// CHAT
// ============================================================
export function watchChat({ db, fs, mid }, onMessages, onError) {
  const q = fs.query(fs.collection(db, "liveRooms", mid, "chat"), fs.orderBy("at"), fs.limitToLast(200));
  return fs.onSnapshot(
    q,
    (qs) => onMessages(qs.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))),
    onError
  );
}
export function sendChat({ db, fs, mid }, me, text) {
  return fs.addDoc(fs.collection(db, "liveRooms", mid, "chat"), { uid: me.uid, name: me.name, role: me.role, text: text.trim().slice(0, 500), at: fs.serverTimestamp() });
}
