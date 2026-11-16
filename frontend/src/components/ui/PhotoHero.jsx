import React, { useEffect, useState } from "react";
import { Container, Eyebrow } from "./Section";

// ============================================================
// FULL-SCREEN PHOTO HERO (used on every page)
// - Fills the viewport (100svh) and slides under the transparent header
// - Photo with a slow zoom, navy overlay and soft gold glow
// - Centered headline, actions, and a glass stats bar at the bottom
// - Pass `slides` to turn it into an auto-playing slideshow
//   (photo + eyebrow + title + subtitle change every `interval` ms)
// ============================================================

const srcSetFor = (url) =>
  url.includes("w=1920")
    ? [640, 1024, 1280, 1920].map((w) => `${url.replace("w=1920", `w=${w}`)} ${w}w`).join(", ")
    : undefined;

const PhotoHero = ({
  // single-slide props
  image,
  imagePosition = "center",
  eyebrow,
  title,
  highlight,
  subtitle,
  // slideshow
  slides,
  interval = 3000,
  // shared
  actions,
  stats = [],
}) => {
  const items = slides?.length ? slides : [{ image, imagePosition, eyebrow, title, highlight, subtitle }];
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (items.length < 2) return;
    const t = setTimeout(() => setActive((i) => (i + 1) % items.length), interval);
    return () => clearTimeout(t);
  }, [active, items.length, interval]);

  return (
    <section className="relative isolate -mt-16 flex min-h-[100svh] flex-col overflow-hidden bg-navy lg:-mt-[72px]">
      {/* Background photos (cross-fade) */}
      {items.map((s, i) => (
        <img
          key={s.image}
          src={s.image.replace("w=1920", "w=1280")}
          srcSet={srcSetFor(s.image)}
          sizes="100vw"
          alt=""
          aria-hidden="true"
          className={`absolute inset-0 -z-20 h-full w-full object-cover transition-opacity duration-1000 ease-in-out ${
            i === active ? "animate-kenburns opacity-100" : "opacity-0"
          }`}
          style={{ objectPosition: s.imagePosition || "center" }}
          loading={i === 0 ? "eager" : "lazy"}
          fetchPriority={i === 0 ? "high" : "auto"}
        />
      ))}

      {/* Overlays */}
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-b from-navy/85 via-navy/65 to-navy/95" />
      <div aria-hidden="true" className="absolute -right-40 -top-40 -z-10 h-[36rem] w-[36rem] rounded-full bg-brand/20 blur-[140px]" />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[linear-gradient(to_right,rgb(255_255_255/0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.04)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_75%)]"
      />

      {/* Content – padded below the header so it stays visually centered */}
      <Container className="flex flex-1 flex-col items-center justify-center pb-8 pt-24 text-center lg:pt-28">
        {/* All slide texts share one grid cell, so the layout never jumps between slides */}
        <div className="grid" aria-live="polite">
          {items.map((s, i) => {
            const on = i === active;
            return (
              <div
                key={i}
                aria-hidden={!on}
                className={`[grid-area:1/1] flex flex-col items-center justify-center transition-all duration-700 ease-out ${
                  on ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0"
                }`}
              >
                {s.eyebrow && <Eyebrow tone="dark">{s.eyebrow}</Eyebrow>}
                {i === 0 ? (
                  <h1 className="mx-auto mt-5 max-w-6xl text-[2.5rem] font-bold leading-[1.04] tracking-tight !text-white sm:text-6xl lg:text-[clamp(3.25rem,8vh,6rem)]">
                    {s.title} {s.highlight && <span className="text-brand">{s.highlight}</span>}
                  </h1>
                ) : (
                  <p className="mx-auto mt-5 max-w-6xl text-[2.5rem] font-bold leading-[1.04] tracking-tight text-white sm:text-6xl lg:text-[clamp(3.25rem,8vh,6rem)]">
                    {s.title} {s.highlight && <span className="text-brand">{s.highlight}</span>}
                  </p>
                )}
                {s.subtitle && (
                  <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-200 sm:text-lg">{s.subtitle}</p>
                )}
              </div>
            );
          })}
        </div>

        {actions && <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">{actions}</div>}

      </Container>

      {/* Stats bar */}
      {stats.length > 0 && (
        <Container className="pb-6 sm:pb-8">
          <div
            className={`grid grid-cols-2 gap-px overflow-hidden rounded-3xl bg-white/10 ring-1 ring-white/15 backdrop-blur-md ${
              stats.length === 3 ? "md:grid-cols-3" : "md:grid-cols-4"
            }`}
          >
            {stats.map((s, i) => (
              <div
                key={s.label}
                className={`bg-navy/30 px-5 py-5 text-center sm:px-6 sm:py-6 ${
                  stats.length === 3 && i === 2 ? "col-span-2 md:col-span-1" : ""
                }`}
              >
                <div className="truncate text-2xl font-bold text-white sm:text-3xl">{s.value}</div>
                <p className="mt-1 text-xs text-slate-300 sm:text-sm">{s.label}</p>
              </div>
            ))}
          </div>
        </Container>
      )}
    </section>
  );
};

export default PhotoHero;
