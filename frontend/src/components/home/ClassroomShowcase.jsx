import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  Video, MonitorUp, PenLine, ListChecks, Mic, MessageSquare, Hand, PhoneOff, ArrowRight, Check, CircleDot,
} from "lucide-react";
import { Section, SplitHeading } from "../ui/Section";
import Reveal from "../ui/Reveal";
import { btn } from "../ui/styles";

// ============================================================
// VIRTUAL CLASSROOM SHOWCASE (Home page)
// Feature tabs on the left; a mock live-class window on the right
// that changes when the visitor clicks a tab.
// ============================================================

const TUTOR_PHOTO = "https://images.unsplash.com/photo-1758876020337-2501eeb1ede5?auto=format&fit=crop&w=900&q=70";

const FEATURES = [
  {
    key: "video",
    Icon: Video,
    title: "Live Video Classes",
    text: "High-definition video sessions that replicate the in-classroom experience with real-time interaction.",
  },
  {
    key: "screen",
    Icon: MonitorUp,
    title: "Screen Sharing",
    text: "Effortlessly collaborate on documents, presentations, or share textbook content in real-time.",
  },
  {
    key: "board",
    Icon: PenLine,
    title: "Interactive Whiteboard",
    text: "A shared digital canvas for live explanations, drawing complex diagrams, and solving problems together.",
  },
  {
    key: "quiz",
    Icon: ListChecks,
    title: "Online Tests & Quizzes",
    text: "Regular assessments and quizzes built into the platform to track progress and gauge understanding immediately.",
  },
];

// ---------- Stage contents (one per feature) ----------

const StageVideo = () => (
  <div className="relative h-full w-full overflow-hidden rounded-2xl">
    <img src={TUTOR_PHOTO} alt="" className="absolute inset-0 h-full w-full object-cover object-[42%_35%]" loading="lazy" />
    <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
    <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-full bg-black/40 px-3 py-1 text-xs font-medium text-white backdrop-blur">
      <Mic className="h-3 w-3" /> Your tutor · Live
    </div>
  </div>
);

const StageScreen = () => (
  <div className="flex h-full w-full flex-col rounded-2xl bg-white p-4 sm:p-6">
    <div className="flex items-center justify-between">
      <span className="rounded-md bg-brand-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand-hover">
        Chapter 4
      </span>
      <span className="text-[10px] text-slate-400">Page 12 / 30</span>
    </div>
    <p className="mt-3 text-base font-bold text-navy sm:text-lg">Quadratic Equations</p>
    <div className="mt-3 space-y-2">
      {[100, 92, 96, 70].map((w, i) => (
        <div key={i} className="h-2 rounded-full bg-slate-100" style={{ width: `${w}%` }} />
      ))}
    </div>
    <div className="mt-4 rounded-xl border border-dashed border-brand/60 bg-brand-soft/60 p-3">
      <p className="font-mono text-sm text-navy">ax² + bx + c = 0</p>
      <p className="mt-1 text-[11px] text-slate-500">Standard form – highlighted by your tutor</p>
    </div>
    <div className="mt-auto flex items-center gap-1.5 pt-3 text-[11px] text-slate-400">
      <MonitorUp className="h-3.5 w-3.5" /> Tutor is sharing their screen
    </div>
  </div>
);

const StageBoard = () => (
  <div className="relative h-full w-full overflow-hidden rounded-2xl bg-white">
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgb(10_45_74/0.10)_1px,transparent_0)] [background-size:18px_18px]" />
    <svg viewBox="0 0 320 200" className="relative h-full w-full" fill="none">
      <text x="20" y="40" className="fill-navy" style={{ font: "600 18px var(--font-sans)" }}>x² + 5x + 6 = 0</text>
      <text x="20" y="72" className="fill-slate-500" style={{ font: "500 15px var(--font-sans)" }}>(x + 2)(x + 3) = 0</text>
      <text x="20" y="100" style={{ font: "700 15px var(--font-sans)", fill: "#d4a010" }}>x = −2, x = −3</text>
      {/* axes */}
      <path d="M190 170 H305 M247 70 V185" stroke="#cbd5e1" strokeWidth="1.5" />
      {/* parabola */}
      <path d="M195 80 Q247 230 300 80" stroke="#0a2d4a" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="222" cy="170" r="4" fill="#e8b112" />
      <circle cx="272" cy="170" r="4" fill="#e8b112" />
      {/* underline stroke */}
      <path d="M20 108 C60 114 100 104 140 110" stroke="#e8b112" strokeWidth="3" strokeLinecap="round" />
    </svg>
    <div className="absolute bottom-3 left-3 flex gap-1.5">
      {["#0a2d4a", "#e8b112", "#ef4444", "#10b981"].map((c) => (
        <span key={c} className="h-4 w-4 rounded-full ring-2 ring-white" style={{ background: c }} />
      ))}
    </div>
  </div>
);

const StageQuiz = () => (
  <div className="flex h-full w-full flex-col rounded-2xl bg-white p-4 sm:p-6">
    <div className="flex items-center justify-between text-[11px] text-slate-400">
      <span className="font-semibold uppercase tracking-wider text-navy">Quick quiz</span>
      <span>Question 3 of 10</span>
    </div>
    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
      <div className="h-full w-[30%] rounded-full bg-brand" />
    </div>
    <p className="mt-4 text-sm font-semibold text-navy sm:text-base">What are the roots of x² + 5x + 6 = 0?</p>
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {["x = 2, 3", "x = −2, −3", "x = −1, −6", "x = 1, 6"].map((o, i) => {
        const correct = i === 1;
        return (
          <div
            key={o}
            className={`flex items-center justify-between rounded-xl border px-3 py-2 text-sm ${
              correct ? "border-emerald-300 bg-emerald-50 font-semibold text-emerald-800" : "border-line text-slate-600"
            }`}
          >
            <span>
              <span className="mr-2 text-slate-400">{String.fromCharCode(65 + i)}.</span>
              {o}
            </span>
            {correct && <Check className="h-4 w-4" strokeWidth={3} />}
          </div>
        );
      })}
    </div>
    <p className="mt-auto pt-3 text-[11px] text-emerald-700">Correct! Score saved to your progress report.</p>
  </div>
);

const STAGES = { video: StageVideo, screen: StageScreen, board: StageBoard, quiz: StageQuiz };

// ---------- Section ----------

const ClassroomShowcase = () => {
  const [active, setActive] = useState(0);

  const current = FEATURES[active];
  const Stage = STAGES[current.key];

  return (
    <Section tone="surface">
      <SplitHeading
        eyebrow="Inside a live class"
        title="A virtual classroom built for learning"
        subtitle="Every session happens in an interactive online classroom — so learning from home feels just as engaging as being there in person."
      />

      <div className="mt-12 grid grid-cols-1 items-stretch gap-6 lg:mt-16 lg:grid-cols-12 lg:gap-8">
        {/* Feature tabs */}
        <Reveal className="flex min-w-0 flex-col gap-2 lg:col-span-4">
          {FEATURES.map(({ key, Icon, title, text }, i) => {
            const on = i === active;
            return (
              <button
                key={key}
                onClick={() => setActive(i)}
                aria-pressed={on}
                className={`group rounded-3xl border p-5 text-left transition-all duration-300 ${
                  on ? "border-navy bg-navy shadow-lg" : "border-line bg-white hover:border-slate-300"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${
                      on ? "bg-brand" : "bg-surface ring-1 ring-line"
                    }`}
                  >
                    <Icon className={`h-5 w-5 ${on ? "text-navy" : "text-slate-500"}`} />
                  </span>
                  <span className={`text-base font-semibold ${on ? "text-white" : "text-navy"}`}>{title}</span>
                </div>
                <div className={`grid transition-all duration-300 ${on ? "mt-3 grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                  <p className={`overflow-hidden text-sm leading-relaxed ${on ? "text-slate-300" : "text-slate-500"}`}>{text}</p>
                </div>
              </button>
            );
          })}
          <Link to="/book-demo" className={btn("primary", "lg", "mt-2 w-full")}>
            Try a free demo class <ArrowRight className="h-4 w-4" />
          </Link>
        </Reveal>

        {/* Mock live-class window */}
        <Reveal delay={120} className="min-w-0 lg:col-span-8">
          <div className="flex h-full flex-col overflow-hidden rounded-[2rem] bg-navy p-3 shadow-[0_40px_80px_-40px_rgba(10,45,74,0.6)] sm:p-4">
            {/* window bar */}
            <div className="flex items-center justify-between px-2 pb-3 pt-1">
              <div className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-full bg-red-400" />
                <span className="h-3 w-3 rounded-full bg-amber-400" />
                <span className="h-3 w-3 rounded-full bg-emerald-400" />
              </div>
              <p className="hidden text-sm font-medium text-slate-300 sm:block">Mathematics · Grade 10 · One-on-One</p>
              <span className="flex items-center gap-1.5 rounded-full bg-red-500/15 px-2.5 py-1 text-xs font-semibold text-red-300">
                <CircleDot className="h-3 w-3 animate-pulse" /> LIVE 24:18
              </span>
            </div>

            {/* main area */}
            <div className="grid flex-1 gap-3 sm:grid-cols-4">
              <div key={current.key} className="animate-fadeIn min-h-[260px] sm:col-span-3 sm:min-h-[340px]">
                <Stage />
              </div>

              {/* side column */}
              <div className="hidden flex-col gap-3 sm:flex">
                <div className="relative aspect-[4/3] overflow-hidden rounded-2xl">
                  {current.key === "video" ? (
                    <div className="flex h-full w-full items-center justify-center bg-white/10">
                      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand text-sm font-bold text-navy">AM</span>
                    </div>
                  ) : (
                    <img src={TUTOR_PHOTO} alt="" className="h-full w-full object-cover object-[42%_35%]" loading="lazy" />
                  )}
                  <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/40 px-2 py-0.5 text-[10px] text-white backdrop-blur">
                    {current.key === "video" ? "You" : "Tutor"}
                  </span>
                </div>
                <div className="flex flex-1 flex-col gap-2 rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Chat</p>
                  <div className="w-fit max-w-full rounded-xl rounded-tl-sm bg-white/10 px-2.5 py-1.5 text-[11px] text-slate-200">
                    Can you explain step 2 again?
                  </div>
                  <div className="ml-auto w-fit max-w-full rounded-xl rounded-tr-sm bg-brand px-2.5 py-1.5 text-[11px] font-medium text-navy">
                    Sure! Let's use the board 👍
                  </div>
                  <div className="mt-auto flex items-center gap-1.5 text-[10px] text-slate-400">
                    <Hand className="h-3 w-3" /> Raise hand anytime
                  </div>
                </div>
              </div>
            </div>

            {/* toolbar */}
            <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 sm:gap-2">
              {[
                { Icon: Mic, k: "mic" },
                { Icon: Video, k: "video" },
                { Icon: MonitorUp, k: "screen" },
                { Icon: PenLine, k: "board" },
                { Icon: ListChecks, k: "quiz" },
                { Icon: MessageSquare, k: "chat" },
              ].map(({ Icon, k }) => (
                <span
                  key={k}
                  className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors sm:h-10 sm:w-10 ${
                    k === current.key ? "bg-brand text-navy" : "bg-white/10 text-slate-300"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </span>
              ))}
              <span className="ml-1 flex h-9 w-12 items-center justify-center rounded-full bg-red-500 text-white sm:ml-2 sm:h-10 sm:w-14">
                <PhoneOff className="h-4 w-4" />
              </span>
            </div>
          </div>
        </Reveal>
      </div>
    </Section>
  );
};

export default ClassroomShowcase;
