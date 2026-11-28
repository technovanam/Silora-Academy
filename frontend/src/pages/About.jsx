import React from "react";
import { Link } from "react-router-dom";
import { Check, User, Users, BookOpen, Clock, Target, MessageCircle, UserCheck, Compass, Eye } from "lucide-react";
import { ArrowRight } from "lucide-react";
import { Section, SplitHeading, Eyebrow } from "../components/ui/Section";
import LightHero from "../components/ui/LightHero";
import Reveal from "../components/ui/Reveal";
import CTASection from "../components/ui/CTASection";
import { btn, cardClass } from "../components/ui/styles";

// Hero mosaic – photos of different heights, each with an optional stat card
const unsplash = (id) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=700&q=75`;
const MOSAIC = [
  { src: unsplash("1509062522246-3755977927d7"), alt: "Student learning with a tutor", h: "h-56 sm:h-72", stat: { value: "1K+", label: "Students guided" } },
  { src: unsplash("1522202176988-66273c2fd55f"), alt: "Students studying together", h: "h-72 sm:h-96", stat: { value: "90%", label: "Improved confidence" } },
  { src: unsplash("1503676260728-1c00da094a0b"), alt: "Learning materials on a desk", h: "h-60 sm:h-80", stat: { value: "12+", label: "Boards covered" } },
  { src: unsplash("1427504494785-3a9ca7044f45"), alt: "Students in a classroom", h: "h-52 sm:h-64", stat: { value: "4", label: "Faculty leads" } },
];

// ============================================================
// CONTENT
// ============================================================

const MISSION_VISION = [
  {
    Icon: Compass,
    title: "Our Mission",
    text: "Silora Academy is founded on the belief that every learner deserves personal attention, clear guidance, and a learning pace that fits them. Our mission is to make quality education both accessible and enjoyable for all.",
    points: [
      "Empower students to reach their full potential.",
      "Blend traditional teaching with modern tools.",
      "Provide consistent mentorship and flexibility.",
    ],
  },
  {
    Icon: Eye,
    title: "Our Vision",
    text: "We envision a world where education adapts to each learner — not the other way around. Silora Academy strives to build a safe, inspiring space that nurtures curiosity and lifelong learning.",
    points: [
      "Build confidence through personalized support.",
      "Create an environment for growth and independence.",
      "Inspire a lifelong love for learning.",
    ],
  },
];

const WHAT_WE_DO = [
  {
    Icon: User,
    title: "One-on-One Tutoring",
    text: "Focused attention with customized lessons tailored to each student's pace and goals. Tutors build on strengths, close learning gaps, and boost confidence with steady guidance.",
  },
  {
    Icon: Users,
    title: "Group Sessions",
    text: "Learn and grow together. Our interactive group classes encourage teamwork, discussion, and healthy competition while motivating students to learn from one another.",
  },
  {
    Icon: BookOpen,
    title: "All Boards Covered",
    text: "From CBSE and ICSE to IB, Cambridge, and State Boards — we cover it all. Each lesson is aligned with your curriculum to ensure solid understanding and exam readiness.",
  },
  {
    Icon: Clock,
    title: "Flexible Scheduling",
    text: "Morning, evening, or weekend — choose what fits best. Our flexible timings help students balance academics with their routine while keeping learning consistent and stress-free.",
  },
];

const APPROACH = [
  {
    Icon: Target,
    title: "Personalized Learning Paths",
    text: "Lessons designed to match each student's pace, style, and academic goals.",
  },
  {
    Icon: MessageCircle,
    title: "Interactive Sessions",
    text: "Engaging live classes and discussions that make learning active, fun, and meaningful.",
  },
  {
    Icon: UserCheck,
    title: "Mentorship Programs",
    text: "Ongoing one-on-one support from experienced educators who guide, motivate, and inspire progress.",
  },
];

// imgClass keeps each photo framed on the face (the source photos are cropped differently)
const TEAM = [
  {
    name: "Sameeha",
    role: "Founder & CEO",
    bio: "Enthusiastic about breaking down intricate Physics topics, empowering learners to thrive academically.",
    img: "https://res.cloudinary.com/dnmvriw3e/image/upload/v1764746980/01-removebg-preview_2_lqhbjc.jpg",
    imgClass: "",
  },
  {
    name: "Anusha",
    role: "Mathematics Faculty",
    bio: "Makes Mathematics clear and approachable, building strong problem-solving skills and confidence in every student.",
    img: "/Anusha.png",
    // Full-length photo: zoom in towards her face
    imgClass: "scale-[1.45] origin-[52%_14%]",
  },
  {
    name: "Aneesa Firdous",
    role: "Head of SST Faculty",
    bio: "Visionary historian weaving cultural narratives through immersive explorations, sparking critical thinking and lifelong appreciation.",
    img: "https://res.cloudinary.com/dnmvriw3e/image/upload/f_auto,q_auto,w_400/v1764439337/WhatsApp_Image_2025-11-29_at_09.58.43_e4cd9578_axbas2.jpg",
    imgClass: "",
  },
  {
    name: "Thaslima",
    role: "English Educator",
    bio: "Brings language and literature to life, helping students read, write and speak English with confidence.",
    img: "/Thaslima.jpeg",
    // Full-length garden photo: zoom in towards her face
    imgClass: "scale-[1.45] origin-[44%_12%]",
  },
];

// ============================================================
// PAGE
// ============================================================

const About = () => {
  return (
    <div className="bg-white">
      {/* ===================== HERO (photo mosaic) ===================== */}
      <LightHero
        eyebrow="About us"
        title="Empowering students through"
        highlight="personalized learning"
        subtitle="At Silora Academy, we make learning inspiring, flexible, and supportive so every student can grow with confidence."
        actions={
          <>
            <Link to="/book-demo" className={btn("primary", "lg", "w-full sm:w-auto")}>
              Book a free demo <ArrowRight className="h-4 w-4" />
            </Link>
            <a href="#team" className={btn("outline", "lg", "w-full sm:w-auto")}>
              Meet our team
            </a>
          </>
        }
      >
        <div className="mx-auto grid max-w-6xl grid-cols-2 items-end gap-3 sm:gap-4 md:grid-cols-4">
          {MOSAIC.map((m, i) => (
            <div key={m.src} className={`relative overflow-hidden rounded-[1.75rem] bg-slate-100 ring-1 ring-line ${m.h} ${i > 1 ? "hidden md:block" : ""}`}>
              <img src={m.src} alt={m.alt} className="h-full w-full object-cover" loading={i < 2 ? "eager" : "lazy"} />
              {m.stat && (
                <div className="absolute inset-x-3 bottom-3 rounded-2xl bg-white/95 px-4 py-3 text-left shadow-lg backdrop-blur">
                  <div className="text-xl font-bold text-navy sm:text-2xl">{m.stat.value}</div>
                  <p className="text-xs text-muted">{m.stat.label}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </LightHero>

      {/* ===================== STORY + MISSION / VISION ===================== */}
      <Section>
        <div className="grid gap-4 lg:grid-cols-12">
          {/* Story */}
          <Reveal className="flex flex-col justify-between rounded-[2rem] bg-navy p-6 sm:p-10 lg:col-span-5 lg:row-span-2">
            <div>
              <Eyebrow tone="dark">Our story</Eyebrow>
              <h2 className="mt-5 text-3xl font-bold leading-[1.1] !text-white sm:text-4xl">
                Shaping the future of personalized learning
              </h2>
              <p className="mt-5 text-base leading-relaxed text-slate-300 sm:text-lg">
                At Silora Academy, we believe education should be personal, flexible, and inspiring. Guided by a
                passion for meaningful learning, we've built a calm, supportive environment where every student can
                grow with confidence.
              </p>
            </div>
            <div className="mt-10 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-white/5 p-5 ring-1 ring-white/10">
                <div className="text-4xl font-bold text-brand">1K+</div>
                <p className="mt-1 text-sm text-slate-300">Students guided toward success</p>
              </div>
              <div className="rounded-2xl bg-white/5 p-5 ring-1 ring-white/10">
                <div className="text-4xl font-bold text-brand">90%</div>
                <p className="mt-1 text-sm text-slate-300">Improved confidence and understanding</p>
              </div>
            </div>
          </Reveal>

          {/* Mission & Vision */}
          {MISSION_VISION.map(({ Icon, title, text, points }, i) => (
            <Reveal key={title} delay={(i + 1) * 100} className={`${cardClass} p-6 sm:p-8 lg:col-span-7`}>
              <div className="grid gap-6 sm:grid-cols-5">
                <div className="sm:col-span-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-soft">
                      <Icon className="h-5 w-5 text-brand-hover" />
                    </span>
                    <h3 className="text-2xl font-semibold">{title}</h3>
                  </div>
                  <p className="mt-4 text-[15px] leading-relaxed text-muted">{text}</p>
                </div>
                <ul className="space-y-3 sm:col-span-2 sm:border-l sm:border-line sm:pl-6">
                  {points.map((p) => (
                    <li key={p} className="flex items-start gap-2.5 text-[15px] text-slate-700">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-soft">
                        <Check className="h-3 w-3 text-brand-hover" strokeWidth={3} />
                      </span>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ===================== WHAT WE DO ===================== */}
      <Section tone="surface">
        <SplitHeading
          eyebrow="What we do"
          title="Learning that adapts to every student"
          subtitle="We go beyond traditional tutoring — creating personalized learning experiences that adapt to every student's style, goals, and schedule."
        />
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:mt-16 lg:grid-cols-4">
          {WHAT_WE_DO.map(({ Icon, title, text }, i) => (
            <Reveal key={title} delay={i * 80} className={`${cardClass} group flex flex-col p-6 sm:p-7`}>
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft transition-colors group-hover:bg-brand">
                <Icon className="h-6 w-6 text-brand-hover transition-colors group-hover:text-navy" />
              </span>
              <h3 className="mt-8 text-xl font-semibold">{title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-slate-500">{text}</p>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ===================== APPROACH ===================== */}
      <Section>
        <div className="grid items-center gap-10 lg:grid-cols-12 lg:gap-16">
          <Reveal className="relative lg:col-span-6">
            <img
              src="https://res.cloudinary.com/dnmvriw3e/image/upload/f_auto,q_auto,w_900/v1761212328/approachImage_ova89m.jpg"
              alt="Student learning online"
              className="aspect-[4/3] w-full rounded-[2rem] object-cover"
              loading="lazy"
              width="900"
              height="675"
            />
            <div className="absolute -bottom-5 left-5 right-5 flex items-center gap-3 rounded-2xl border border-line bg-white/95 p-4 shadow-lg backdrop-blur sm:left-auto sm:right-6 sm:w-72">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-navy">
                <Target className="h-5 w-5 text-brand" />
              </span>
              <p className="text-sm font-semibold text-navy">Every student learns differently</p>
            </div>
          </Reveal>
          <Reveal delay={120} className="lg:col-span-6">
            <Eyebrow>Our approach</Eyebrow>
            <h2 className="mt-5 text-3xl font-bold leading-[1.1] sm:text-4xl lg:text-5xl">
              Empowering minds through personalized, interactive learning
            </h2>
            <p className="mt-5 text-base leading-relaxed text-muted sm:text-lg">
              Our approach focuses on understanding each learner's strengths and creating a path that builds confidence
              and lasting success.
            </p>
            <div className="mt-8 divide-y divide-line border-y border-line">
              {APPROACH.map(({ Icon, title, text }) => (
                <div key={title} className="flex gap-4 py-5">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-surface ring-1 ring-line">
                    <Icon className="h-5 w-5 text-navy" />
                  </span>
                  <div>
                    <h3 className="text-base font-semibold">{title}</h3>
                    <p className="mt-1 text-[15px] leading-relaxed text-slate-500">{text}</p>
                  </div>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </Section>

      {/* ===================== TEAM ===================== */}
      <Section id="team" tone="surface" className="scroll-mt-16">
        <SplitHeading
          eyebrow="Our team"
          title="Meet the people behind Silora"
          subtitle="Our dedicated team of educators and professionals is committed to providing the best learning experience for every student."
        />
        <div className="mx-auto mt-12 grid max-w-6xl grid-cols-1 gap-4 sm:grid-cols-2 lg:mt-16 lg:grid-cols-4">
          {TEAM.map((m, i) => (
            <Reveal key={m.name} delay={i * 80} className="group relative overflow-hidden rounded-[2rem] bg-slate-200">
              <div className="aspect-[3/4] overflow-hidden">
                <div className="h-full w-full transition-transform duration-700 group-hover:scale-105">
                  {m.img ? (
                    <img
                      src={m.img}
                      alt={m.name}
                      className={`h-full w-full object-cover object-top ${m.imgClass}`}
                      loading="lazy"
                    />
                  ) : (
                    // No photo: show initials on a brand background
                    <div className="flex h-full w-full items-start justify-center bg-gradient-to-br from-brand-soft via-white to-slate-200 pt-[22%]">
                      <span className="flex h-28 w-28 items-center justify-center rounded-full bg-navy text-4xl font-bold text-brand shadow-lg ring-8 ring-white/70">
                        {m.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-navy via-navy/85 to-transparent p-5 pt-16">
                <h3 className="text-xl font-semibold !text-white">{m.name}</h3>
                <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-brand">{m.role}</p>
                <p className="mt-2 overflow-hidden text-sm leading-relaxed text-slate-200 transition-all duration-500 lg:max-h-0 lg:opacity-0 lg:group-hover:max-h-40 lg:group-hover:opacity-100">
                  {m.bio}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      <div className="pt-16 sm:pt-20 lg:pt-28">
        <CTASection />
      </div>
    </div>
  );
};

export default About;
