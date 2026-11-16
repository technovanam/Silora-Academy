import React from "react";
import { Container, Eyebrow } from "./Section";
import Reveal from "./Reveal";

// ============================================================
// LIGHT CENTERED HERO (Home, About, Services, Contact)
// - Soft light background with a faint grid and gold glow
// - Centered eyebrow, big headline (gold underlined highlight), subtitle, actions
// - `children` renders below the text: a photo, a mosaic, filter chips…
// ============================================================

const LightHero = ({ eyebrow, title, highlight, subtitle, actions, children, className = "" }) => (
  <section className={`relative isolate overflow-hidden -mt-16 pt-16 lg:-mt-[72px] lg:pt-[72px] bg-gradient-to-b from-brand-soft/70 via-white to-white ${className}`}>
    <div aria-hidden="true" className="absolute left-1/2 top-[-12rem] -z-10 h-[30rem] w-[52rem] -translate-x-1/2 rounded-full bg-brand/15 blur-[120px]" />
    <div
      aria-hidden="true"
      className="absolute inset-0 -z-10 bg-[linear-gradient(to_right,rgb(10_45_74/0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgb(10_45_74/0.05)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_at_top,black_25%,transparent_70%)]"
    />

    <Container className="pb-14 pt-14 text-center sm:pb-20 sm:pt-20 lg:pt-24">
      <Reveal className="mx-auto max-w-4xl">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h1 className="mt-6 text-[2.5rem] font-bold leading-[1.05] tracking-tight text-navy sm:text-6xl lg:text-7xl">
          {title}{" "}
          {highlight && (
            <span className="relative inline-block whitespace-nowrap text-navy">
              <span className="relative z-10">{highlight}</span>
              <svg aria-hidden="true" viewBox="0 0 300 12" preserveAspectRatio="none" className="absolute -bottom-1 left-0 z-0 h-3 w-full text-brand sm:-bottom-2 sm:h-4">
                <path d="M2 9C60 3 140 1 298 6" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
              </svg>
            </span>
          )}
        </h1>
        {subtitle && <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">{subtitle}</p>}
        {actions && <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">{actions}</div>}
      </Reveal>

      {children && (
        <Reveal delay={150} className="mt-12 sm:mt-14">
          {children}
        </Reveal>
      )}
    </Container>
  </section>
);

// Wide rounded photo with optional stat cards overlapping its bottom edge
export const HeroPhoto = ({ src, alt = "", position = "center", stats = [] }) => (
  <div className="relative mx-auto max-w-6xl">
    <div className="overflow-hidden rounded-[2rem] bg-slate-100 shadow-[0_30px_60px_-30px_rgba(10,45,74,0.45)] ring-1 ring-line">
      <img src={src} alt={alt} className="aspect-[16/9] w-full object-cover sm:aspect-[21/9]" style={{ objectPosition: position }} loading="eager" fetchPriority="high" />
    </div>
    {stats.length > 0 && (
      <div className={`relative mx-auto -mt-10 grid max-w-5xl grid-cols-2 gap-3 px-4 sm:-mt-12 sm:px-8 ${stats.length === 3 ? "md:grid-cols-3" : "md:grid-cols-4"}`}>
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl border border-line bg-white px-4 py-4 text-center shadow-[0_12px_30px_-16px_rgba(10,45,74,0.35)] sm:py-5">
            <div className="text-2xl font-bold text-navy sm:text-3xl">{s.value}</div>
            <p className="mt-1 text-xs text-muted sm:text-sm">{s.label}</p>
          </div>
        ))}
      </div>
    )}
  </div>
);

export default LightHero;
