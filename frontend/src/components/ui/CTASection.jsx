import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa6";
import { Container, Eyebrow } from "./Section";
import Reveal from "./Reveal";
import { btn } from "./styles";
import { WHATSAPP_URL } from "../../data/site";

const POINTS = ["Free demo class", "All major boards", "Flexible timings"];

// Closing call-to-action band shared by Home, About and Services
const CTASection = ({
  title = "Ready to discover your potential?",
  subtitle = "Join Silora Academy today and take the first step toward confident, personalized and flexible learning.",
}) => (
  <section className="bg-white pb-16 sm:pb-20 lg:pb-28">
    <Container>
      <Reveal className="relative overflow-hidden rounded-[2rem] bg-navy px-6 py-12 sm:px-12 sm:py-16 lg:px-16 lg:py-20">
        {/* decoration */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-brand/25 blur-[100px]" />
          <div className="absolute -bottom-40 left-1/3 h-96 w-96 rounded-full bg-white/5 blur-[100px]" />
          <div className="absolute inset-0 bg-[linear-gradient(to_right,rgb(255_255_255/0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.05)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_right,black_10%,transparent_70%)]" />
        </div>

        <div className="relative grid items-center gap-10 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <Eyebrow tone="dark">Get started</Eyebrow>
            <h2 className="mt-5 text-3xl font-bold leading-[1.1] !text-white sm:text-4xl lg:text-5xl">{title}</h2>
            <p className="mt-4 max-w-xl text-base text-slate-300 sm:text-lg">{subtitle}</p>
            <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2">
              {POINTS.map((p) => (
                <li key={p} className="flex items-center gap-2 text-sm text-slate-200">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand/20">
                    <Check className="h-3 w-3 text-brand" strokeWidth={3} />
                  </span>
                  {p}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row lg:col-span-5 lg:flex-col lg:items-end">
            <Link to="/book-demo" className={btn("primary", "lg", "w-full sm:w-auto lg:w-72")}>
              Book a free demo <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={btn("ghost", "lg", "w-full !text-white ring-1 ring-white/20 hover:!bg-white/10 sm:w-auto lg:w-72")}
            >
              <FaWhatsapp className="h-4 w-4" /> Chat on WhatsApp
            </a>
          </div>
        </div>
      </Reveal>
    </Container>
  </section>
);

export default CTASection;
