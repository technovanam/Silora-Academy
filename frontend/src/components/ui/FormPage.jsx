import React from "react";
import { Check } from "lucide-react";
import { Container, Eyebrow, Section, SplitHeading } from "./Section";
import Reveal from "./Reveal";

// ============================================================
// FORM PAGE LAYOUT (Book a demo / Join as tutor)
// Light hero: intro, benefits and a photo on the left,
// white form card on the right. "What happens next" steps below.
// ============================================================

const FormPage = ({ image, imagePosition = "center", eyebrow, title, highlight, subtitle, points = [], formTitle, formSubtitle, steps = [], stepsTitle, children }) => (
  <div className="bg-white">
    {/* Only the background is clipped, so dropdowns in the form can overflow the section */}
    {/* Pulled up under the floating header so the background shows around it */}
    <section className="relative isolate z-10 border-b border-line -mt-16 pt-16 lg:-mt-[72px] lg:pt-[72px]">
      <div aria-hidden="true" className="absolute inset-0 -z-10 overflow-hidden bg-gradient-to-b from-brand-soft/70 via-white to-white">
        <div className="absolute -left-40 -top-40 h-[30rem] w-[30rem] rounded-full bg-brand/15 blur-[120px]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgb(10_45_74/0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgb(10_45_74/0.05)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_at_top_left,black_25%,transparent_70%)]" />
      </div>

      {/* Tablet & desktop: exactly one screen tall (minus the 64/72px header).
          Desktop: two columns; the photo takes whatever height is left and hides on short screens. */}
      <Container className="grid content-center gap-8 py-10 md:min-h-[calc(100svh-64px)] md:gap-5 md:py-4 lg:h-[calc(100svh-72px)] lg:min-h-[600px] lg:grid-cols-12 lg:items-stretch lg:gap-12 lg:py-6">
        {/* Intro */}
        <div className="flex min-h-0 flex-col lg:col-span-5">
          <Eyebrow className="w-fit">{eyebrow}</Eyebrow>
          <h1 className="mt-4 text-4xl font-bold leading-[1.05] tracking-tight text-navy sm:text-5xl md:text-[2.75rem] lg:text-[clamp(2.25rem,6vh,3rem)]">
            {title} {highlight && <span className="text-brand-hover">{highlight}</span>}
          </h1>
          <p className="mt-3 max-w-lg text-base leading-relaxed text-muted sm:text-lg lg:text-[clamp(0.95rem,2.2vh,1.125rem)]">{subtitle}</p>

          <ul className="mt-5 grid gap-2.5 md:grid-cols-2 md:gap-x-6 lg:grid-cols-1 lg:gap-2">
            {points.map((pt) => (
              <li key={pt} className="flex items-start gap-3 text-[15px] text-slate-700">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand">
                  <Check className="h-3.5 w-3.5 text-navy" strokeWidth={3} />
                </span>
                {pt}
              </li>
            ))}
          </ul>

          {image && (
            // The photo is absolutely positioned so it never makes the row taller:
            // it just fills the space down to the bottom of the form card.
            <div className="relative mt-6 hidden min-h-[140px] flex-1 overflow-hidden rounded-[1.75rem] bg-slate-100 shadow-[0_24px_50px_-28px_rgba(10,45,74,0.45)] ring-1 ring-line lg:block lg:[@media(max-height:700px)]:hidden">
              <img
                src={image.replace("w=1920", "w=900")}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
                style={{ objectPosition: imagePosition }}
                fetchPriority="high"
              />
            </div>
          )}
        </div>

        {/* Form card */}
        <div className="lg:col-span-7 lg:flex lg:flex-col">
          <div className="animate-fadeIn rounded-[2rem] lg:flex lg:flex-1 lg:flex-col border border-line bg-white p-5 shadow-[0_30px_60px_-30px_rgba(10,45,74,0.35)] sm:p-7 lg:p-7">
            <h2 className="text-2xl font-bold sm:text-[1.75rem]">{formTitle}</h2>
            {formSubtitle && <p className="mt-1 text-sm text-muted">{formSubtitle}</p>}
            <div className="mt-4 lg:flex lg:flex-1 lg:flex-col">{children}</div>
          </div>
        </div>
      </Container>
    </section>

    {/* What happens next */}
    {steps.length > 0 && (
      <Section>
        <SplitHeading eyebrow="What happens next" title={stepsTitle} />
        <div className="mt-10 grid gap-4 md:grid-cols-3 lg:mt-14">
          {steps.map(({ Icon, title: t, text }, i) => (
            <Reveal key={t} delay={i * 100} className="relative rounded-[2rem] border border-line bg-surface p-7">
              <span className="absolute right-6 top-5 text-5xl font-bold text-slate-200">0{i + 1}</span>
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft ring-1 ring-brand/20">
                <Icon className="h-6 w-6 text-brand-hover" />
              </span>
              <h3 className="mt-5 text-lg font-semibold">{t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{text}</p>
            </Reveal>
          ))}
        </div>
      </Section>
    )}
  </div>
);

export default FormPage;
