import React from "react";
import { CONTAINER } from "./styles";
import Reveal from "./Reveal";

// ============================================================
// LAYOUT PRIMITIVES
// One wide container (max 1440px, slim side padding) used everywhere.
// ============================================================

export const Container = ({ className = "", children }) => (
  <div className={`${CONTAINER} ${className}`}>{children}</div>
);

export const Section = ({ id, tone = "white", className = "", children }) => (
  <section
    id={id}
    className={`py-16 sm:py-20 lg:py-28 ${tone === "surface" ? "bg-surface" : "bg-white"} ${className}`}
  >
    <Container>{children}</Container>
  </section>
);

export const Eyebrow = ({ children, className = "", tone = "light" }) => (
  <span
    className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${
      tone === "dark" ? "bg-white/10 text-white ring-1 ring-white/15" : "bg-white text-navy ring-1 ring-line"
    } ${className}`}
  >
    <span className="relative flex h-1.5 w-1.5">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand" />
    </span>
    {children}
  </span>
);

// Centered heading (used sparingly)
export const SectionHeading = ({ eyebrow, title, subtitle, className = "" }) => (
  <Reveal className={`mx-auto max-w-3xl text-center ${className}`}>
    {eyebrow && <Eyebrow className="mb-5">{eyebrow}</Eyebrow>}
    <h2 className="text-3xl font-bold leading-[1.1] sm:text-4xl lg:text-5xl">{title}</h2>
    {subtitle && <p className="mt-5 text-base leading-relaxed text-muted sm:text-lg">{subtitle}</p>}
  </Reveal>
);

// Editorial heading: title on the left, description (and optional action) on the right
export const SplitHeading = ({ eyebrow, title, subtitle, action, className = "" }) => (
  <Reveal className={`grid items-end gap-6 lg:grid-cols-12 lg:gap-10 ${className}`}>
    <div className="lg:col-span-7">
      {eyebrow && <Eyebrow className="mb-5">{eyebrow}</Eyebrow>}
      <h2 className="text-3xl font-bold leading-[1.1] sm:text-4xl lg:text-5xl">{title}</h2>
    </div>
    <div className="lg:col-span-5">
      {subtitle && <p className="text-base leading-relaxed text-muted sm:text-lg">{subtitle}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  </Reveal>
);

// Soft brand glow used behind heroes
export const Glow = () => (
  <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
    <div className="absolute -right-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-brand/20 blur-[120px]" />
    <div className="absolute -left-40 top-1/3 h-[28rem] w-[28rem] rounded-full bg-navy/10 blur-[120px]" />
    <div className="absolute inset-0 bg-[linear-gradient(to_right,rgb(10_45_74/0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgb(10_45_74/0.05)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_75%)]" />
  </div>
);

// Hero for inner pages (About, Services, Contact): big title left, intro right
export const PageHero = ({ eyebrow, title, highlight, subtitle, children }) => (
  <section className="relative overflow-hidden border-b border-line bg-surface">
    <Glow />
    <Container className="relative grid items-end gap-8 py-16 sm:py-20 lg:grid-cols-12 lg:gap-12 lg:py-28">
      <Reveal className="lg:col-span-7">
        {eyebrow && <Eyebrow className="mb-6">{eyebrow}</Eyebrow>}
        <h1 className="text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl xl:text-7xl">
          {title} {highlight && <span className="text-brand">{highlight}</span>}
        </h1>
      </Reveal>
      <Reveal delay={150} className="lg:col-span-5 lg:pb-3">
        {subtitle && <p className="text-base leading-relaxed text-muted sm:text-lg">{subtitle}</p>}
        {children}
      </Reveal>
    </Container>
  </section>
);
