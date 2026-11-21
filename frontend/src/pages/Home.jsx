import React from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, ArrowUpRight, Star, CalendarClock, BookOpenCheck, LifeBuoy, ClipboardList, Users, GraduationCap,
  Video, FolderOpen, ClipboardCheck, BellRing, LogIn, ShieldCheck, BookOpen, TrendingUp, Quote,
} from "lucide-react";
import { testimonials } from "../data/testimonials";
import { BOARDS } from "../data/site";
import { Container, Section, SplitHeading } from "../components/ui/Section";
import LightHero, { HeroPhoto } from "../components/ui/LightHero";
import ClassroomShowcase from "../components/home/ClassroomShowcase";
import Reveal from "../components/ui/Reveal";
import CTASection from "../components/ui/CTASection";
import { btn, cardClass } from "../components/ui/styles";

// ============================================================
// CONTENT
// ============================================================

// Hero photo below the centered headline
const HERO_IMAGE = "https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=1800&q=80";
const FEATURE_IMAGE = "https://images.unsplash.com/photo-1571260899304-425eee4c7efc?auto=format&fit=crop&w=900&q=60";

const STATS = [
  { value: "100%", label: "Parent satisfaction" },
  { value: "1K+", label: "Students mentored" },
  { value: "12+", label: "Boards covered" },
  { value: "24/7", label: "Support & guidance" },
];

const STEPS = [
  {
    Icon: ClipboardList,
    title: "Book a free demo",
    text: "Fill in a short form with your grade, board and subjects — it takes less than a minute.",
  },
  {
    Icon: Users,
    title: "Meet your tutor",
    text: "We match you with a subject expert and you try a session before you commit.",
  },
  {
    Icon: GraduationCap,
    title: "Start learning",
    text: "Regular one-on-one classes at times that suit you, with progress updates along the way.",
  },
];

// Portal section
const PORTAL_FEATURES = [
  { Icon: Video, title: "Join live classes", text: "One click from your dashboard – no links to hunt for." },
  { Icon: FolderOpen, title: "Learning materials", text: "Notes, worksheets and recordings shared by your tutor." },
  { Icon: ClipboardCheck, title: "Attendance & progress", text: "Weekly attendance and lesson progress at a glance." },
  { Icon: BellRing, title: "Reminders & updates", text: "Class reminders and announcements, right on time." },
];
const PORTAL_ROLES = [
  [GraduationCap, "Students & parents"],
  [BookOpen, "Teachers"],
  [ShieldCheck, "Admins"],
];

const initials = (name) =>
  name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");

// ============================================================
// SMALL COMPONENTS
// ============================================================

const Stars = ({ n = 5, className = "h-4 w-4" }) => (
  <div className="flex gap-0.5" aria-label={`${n} out of 5 stars`}>
    {[...Array(n)].map((_, i) => (
      <Star key={i} className={`${className} fill-brand text-brand`} />
    ))}
  </div>
);

const TestimonialCard = ({ quote, name, role, rating }) => (
  <figure className="mx-2.5 flex w-[300px] shrink-0 flex-col rounded-3xl border border-line bg-white p-6 sm:w-[360px] sm:p-7">
    {/* Only show stars when a real rating was given */}
    {rating ? <Stars n={rating} /> : <Quote className="h-6 w-6 fill-brand/25 text-brand" aria-hidden="true" />}
    <blockquote className="mt-4 flex-1 text-[15px] leading-relaxed text-slate-600">“{quote}”</blockquote>
    <figcaption className="mt-6 flex items-center gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-navy text-sm font-semibold text-white">
        {initials(name)}
      </span>
      <span>
        <span className="block text-sm font-semibold text-navy">{name}</span>
        <span className="block text-xs text-slate-500">{role}</span>
      </span>
    </figcaption>
  </figure>
);

// ============================================================
// PAGE
// ============================================================

const Home = () => {
  const half = Math.ceil(testimonials.length / 2);
  const rows = [testimonials.slice(0, half), testimonials.slice(half)];

  return (
    <div className="bg-white">
      {/* ===================== HERO (bold centered type) ===================== */}
      <LightHero
        eyebrow="#1 Online Tutoring Platform"
        title="Shape your future with the"
        highlight="right knowledge."
        subtitle="Discover the joy of learning with expert tutors who guide you every step of the way. Build confidence, sharpen skills, and unlock your true potential."
        actions={
          <>
            <Link to="/book-demo" className={btn("primary", "lg", "w-full sm:w-auto")}>
              Book a free demo <ArrowRight className="h-4 w-4" />
            </Link>
            <a href="#testimonials" className={btn("outline", "lg", "w-full sm:w-auto")}>
              View success stories
            </a>
          </>
        }
      >
        <HeroPhoto src={HERO_IMAGE} alt="Students learning together" stats={STATS} />
      </LightHero>

      {/* ===================== BOARDS MARQUEE ===================== */}
      <div className="border-y border-line bg-white py-5">
        <div className="marquee-fade overflow-hidden">
          <div className="marquee" style={{ "--marquee-duration": "30s" }}>
            {[...BOARDS, ...BOARDS, ...BOARDS, ...BOARDS].map((b, i) => (
              <span key={i} className="mx-8 flex items-center gap-8 whitespace-nowrap text-lg font-semibold text-slate-400 sm:text-xl">
                {b}
                <span className="h-1.5 w-1.5 rounded-full bg-brand" />
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ===================== FEATURES (BENTO) ===================== */}
      <Section>
        <SplitHeading
          eyebrow="Why choose Silora Academy"
          title="Powerful features for your learning journey"
          subtitle="From personalized learning paths to interactive sessions, every feature is designed to make your learning experience simple, engaging, and confidence-building."
        />

        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:mt-16 lg:grid-cols-4 lg:grid-rows-2">
          {/* Large image card */}
          <Reveal className="group relative min-h-[320px] overflow-hidden rounded-[2rem] md:col-span-2 lg:row-span-2">
            <img
              src={FEATURE_IMAGE}
              alt="Student learning online with a tutor"
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-navy via-navy/40 to-transparent" />
            <div className="relative flex h-full flex-col justify-end p-6 sm:p-8">
              <span className="mb-auto inline-flex w-fit rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-white ring-1 ring-white/20 backdrop-blur">
                Our core
              </span>
              <h3 className="text-2xl font-bold !text-white sm:text-3xl">One-on-One Tutoring</h3>
              <p className="mt-2 max-w-md text-slate-200">
                Individualized lessons focused on each student's goals and pace.
              </p>
            </div>
          </Reveal>

          {/* Flexible scheduling – wide */}
          <Reveal delay={80} className={`${cardClass} flex flex-col justify-between p-6 sm:p-8 md:col-span-2`}>
            <div className="flex items-start justify-between">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft">
                <CalendarClock className="h-6 w-6 text-brand-hover" />
              </span>
              <div className="flex gap-1.5">
                {["Mon", "Wed", "Fri", "Sat"].map((d, i) => (
                  <span
                    key={d}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      i === 1 ? "bg-navy text-white" : "bg-surface text-slate-500"
                    }`}
                  >
                    {d}
                  </span>
                ))}
              </div>
            </div>
            <div className="mt-8">
              <h3 className="text-xl font-semibold">Flexible Scheduling</h3>
              <p className="mt-2 text-[15px] text-slate-500">Book classes at times that suit your routine and comfort.</p>
            </div>
          </Reveal>

          <Reveal delay={160} className={`${cardClass} flex flex-col justify-between p-6 sm:p-8`}>
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft">
              <BookOpenCheck className="h-6 w-6 text-brand-hover" />
            </span>
            <div className="mt-8">
              <h3 className="text-xl font-semibold">Curriculum-Aligned</h3>
              <p className="mt-2 text-[15px] text-slate-500">Covering CBSE, ICSE, IB, Cambridge, and State Boards.</p>
            </div>
          </Reveal>

          <Reveal delay={240} className="flex flex-col justify-between rounded-[2rem] bg-navy p-6 sm:p-8">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10">
              <LifeBuoy className="h-6 w-6 text-brand" />
            </span>
            <div className="mt-8">
              <h3 className="text-xl font-semibold !text-white">Continuous Support</h3>
              <p className="mt-2 text-[15px] text-slate-300">
                Progress updates, doubt-clearing sessions, and consistent mentorship.
              </p>
            </div>
          </Reveal>
        </div>
      </Section>

      {/* ===================== VIRTUAL CLASSROOM ===================== */}
      <ClassroomShowcase />

      {/* ===================== HOW IT WORKS ===================== */}
      <Section>
        <SplitHeading
          eyebrow="How it works"
          title="Start learning in three simple steps"
          subtitle="Getting started takes minutes. Book a free demo and we'll take care of the rest."
          action={
            <Link to="/book-demo" className={btn("dark", "md")}>
              Book a free demo <ArrowUpRight className="h-4 w-4" />
            </Link>
          }
        />
        <div className="mt-12 grid gap-4 md:grid-cols-3 lg:mt-16">
          {STEPS.map(({ Icon, title, text }, i) => (
            <Reveal key={title} delay={i * 100} className="relative rounded-[2rem] border border-line bg-surface p-6 sm:p-8">
              <span className="absolute right-6 top-5 text-6xl font-bold text-slate-200 sm:right-8 sm:top-6">0{i + 1}</span>
              <span className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-navy">
                <Icon className="h-6 w-6 text-brand" />
              </span>
              <h3 className="relative mt-8 text-xl font-semibold">{title}</h3>
              <p className="relative mt-2 text-[15px] leading-relaxed text-slate-500">{text}</p>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ===================== PORTAL LOGIN ===================== */}
      <section id="portal" className="relative isolate scroll-mt-16 overflow-hidden bg-navy py-16 sm:py-20 lg:py-28">
        <div aria-hidden="true" className="absolute -right-40 -top-40 -z-10 h-[32rem] w-[32rem] rounded-full bg-brand/20 blur-[130px]" />
        <div aria-hidden="true" className="absolute -bottom-40 -left-40 -z-10 h-[28rem] w-[28rem] rounded-full bg-sky-400/10 blur-[120px]" />
        {/* grid-cols-1 (= minmax(0,1fr)) stops the nowrap preview text from stretching the column past the phone screen */}
        <Container className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-white ring-1 ring-white/15">
              <span className="h-1.5 w-1.5 rounded-full bg-brand" /> Silora learning portal
            </span>
            <h2 className="mt-6 text-3xl font-bold leading-[1.1] !text-white sm:text-4xl lg:text-5xl">
              Already learning with us? <span className="text-brand">Sign in to your portal.</span>
            </h2>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-300 sm:text-lg">
              Students, parents and teachers get their own secure account. Sign in with the user ID and password the academy emailed you.
            </p>
            <div className="mt-8 grid gap-5 sm:grid-cols-2">
              {PORTAL_FEATURES.map(({ Icon, title, text }) => (
                <div key={title} className="flex gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/10">
                    <Icon className="h-5 w-5 text-brand" />
                  </span>
                  <span>
                    <span className="block font-semibold text-white">{title}</span>
                    <span className="mt-0.5 block text-sm leading-relaxed text-slate-400">{text}</span>
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link to="/portal/login" className={btn("primary", "lg", "w-full sm:w-auto")}>
                <LogIn className="h-4 w-4" /> Go to portal login
              </Link>
              <Link to="/contact" className={btn("glass", "lg", "w-full sm:w-auto")}>
                Need an account?
              </Link>
            </div>
            <ul className="mt-6 flex flex-wrap gap-2">
              {PORTAL_ROLES.map(([Icon, label]) => (
                <li key={label} className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1 text-xs font-medium text-slate-300 ring-1 ring-white/10">
                  <Icon className="h-3.5 w-3.5 text-brand" /> {label}
                </li>
              ))}
            </ul>
          </Reveal>

          {/* Portal preview (illustration only) */}
          <Reveal delay={150} aria-hidden="true">
            <div className="rounded-[2rem] bg-white/5 p-3 ring-1 ring-white/10 backdrop-blur sm:p-4">
              <div className="rounded-[1.5rem] bg-white p-5 shadow-2xl sm:p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Student dashboard</p>
                    <p className="mt-1 text-lg font-bold text-navy">Good evening, Aarav</p>
                  </div>
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-navy">AS</span>
                </div>
                <div className="mt-5 flex items-center justify-between gap-4 rounded-2xl bg-navy p-4 text-white">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wider text-brand">Next class · Today</p>
                    <p className="mt-1 truncate font-semibold">Physics – Laws of motion</p>
                    <p className="text-sm text-slate-300">4:30 PM · with your tutor</p>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500 px-3.5 py-2 text-sm font-semibold text-white">
                    <Video className="h-4 w-4" /> Join
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-line p-4">
                    <ClipboardCheck className="h-5 w-5 text-brand-hover" />
                    <p className="mt-3 text-2xl font-bold text-navy">96%</p>
                    <p className="text-xs text-slate-500">Attendance this month</p>
                  </div>
                  <div className="rounded-2xl border border-line p-4">
                    <TrendingUp className="h-5 w-5 text-brand-hover" />
                    <p className="mt-3 text-2xl font-bold text-navy">18 / 24</p>
                    <p className="text-xs text-slate-500">Lessons completed</p>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface">
                      <div className="h-full w-3/4 rounded-full bg-brand" />
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-3 rounded-2xl bg-surface p-4">
                  <FolderOpen className="h-5 w-5 shrink-0 text-navy" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-navy">Algebra worksheet 7.pdf</p>
                    <p className="text-xs text-slate-500">New material from your tutor</p>
                  </div>
                  <span className="rounded-full bg-brand px-2.5 py-0.5 text-[11px] font-semibold text-navy">New</span>
                </div>
              </div>
            </div>
          </Reveal>
        </Container>
      </section>

      {/* ===================== TESTIMONIALS (MARQUEE) ===================== */}
      <section id="testimonials" className="scroll-mt-16 overflow-hidden bg-surface py-16 sm:py-20 lg:py-28">
        <Container>
          <SplitHeading
            eyebrow="Testimonials"
            title="What our learners say"
            subtitle="Hear from our students and parents about how Silora Academy has made learning easier and more rewarding."
          />
        </Container>
        <div className="marquee-fade marquee-pause mt-12 space-y-5 lg:mt-16">
          {rows.map((row, r) => (
            <div key={r} className="overflow-hidden">
              <div
                className={`marquee ${r === 1 ? "marquee-reverse" : ""}`}
                style={{ "--marquee-duration": `${row.length * 18}s` }}
              >
                {[...row, ...row, ...row, ...row].map((t, i) => (
                  <TestimonialCard key={`${t.name}-${i}`} {...t} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="pt-16 sm:pt-20 lg:pt-28">
        <CTASection />
      </div>
    </div>
  );
};

export default Home;
