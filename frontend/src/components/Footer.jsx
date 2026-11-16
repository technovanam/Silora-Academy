import React from "react";
import { Link } from "react-router-dom";
import { FaFacebookF, FaInstagram, FaTelegram, FaWhatsapp } from "react-icons/fa6";
import { Phone, Mail } from "lucide-react";
import { SITE, SOCIAL_LINKS, WHATSAPP_URL } from "../data/site";
import { CONTAINER } from "./ui/styles";

// ============================================================
// FOOTER
// Brand + contact, four link columns, copyright bar and a
// floating WhatsApp button.
// ============================================================

const SUBJECTS = ["English & Grammar", "Mathematics", "Physics", "Chemistry", "Biology", "Computer Science", "Social Studies"];
const SERVICES = ["One-on-One Tutoring", "Group Classes", "Homework Help", "Exam Preparation", "Doubt Clearing", "Personalized Learning", "Interactive Classes"];
const CURRICULUM = ["CBSE", "ICSE", "IGCSE", "State Board", "IB", "A-Level", "Cambridge"];

const SOCIALS = [
  { href: SOCIAL_LINKS.facebook, label: "Facebook", Icon: FaFacebookF },
  { href: SOCIAL_LINKS.instagram, label: "Instagram", Icon: FaInstagram },
  { href: SOCIAL_LINKS.whatsapp, label: "WhatsApp", Icon: FaWhatsapp },
  { href: SOCIAL_LINKS.telegram, label: "Telegram", Icon: FaTelegram },
];

const linkClass = "text-sm text-slate-500 transition-colors hover:text-navy";

const Column = ({ title, children }) => (
  <div>
    <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider !text-navy">{title}</h3>
    <ul className="space-y-2.5">{children}</ul>
  </div>
);

const Footer = () => {
  return (
    <footer className="border-t border-line bg-surface">
      <div className={`${CONTAINER} py-14 lg:py-20`}>
        <div className="grid grid-cols-2 gap-10 md:grid-cols-4 lg:grid-cols-12 lg:gap-8">
          {/* Brand & contact */}
          <div className="col-span-2 md:col-span-4 lg:col-span-4">
            <img
              src={SITE.logo}
              alt={`${SITE.name} Logo`}
              className="h-12 w-auto rounded-lg object-contain mix-blend-multiply"
              width="80"
              height="80"
              loading="lazy"
            />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-slate-500">
              Personalized one-on-one and group tutoring across all major boards, with flexible schedules that fit your routine.
            </p>

            <div className="mt-6 space-y-2.5 text-sm">
              <a href={SITE.phoneHref} className="flex items-center gap-2.5 text-slate-600 transition hover:text-navy">
                <Phone className="h-4 w-4 text-brand" /> {SITE.phone}
              </a>
              <a href={`mailto:${SITE.email}`} className="flex items-center gap-2.5 text-slate-600 transition hover:text-navy">
                <Mail className="h-4 w-4 text-brand" /> {SITE.email}
              </a>
            </div>

            <div className="mt-6 flex gap-2">
              {SOCIALS.map(({ href, label, Icon }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-white text-slate-500 transition hover:border-brand hover:bg-brand hover:text-navy"
                >
                  <Icon size={14} />
                </a>
              ))}
            </div>
          </div>

          {/* Quick links */}
          <div className="lg:col-span-2">
            <Column title="Quick Links">
              <li><Link to="/" className={linkClass}>Home</Link></li>
              <li><Link to="/about" className={linkClass}>About Us</Link></li>
              <li><Link to="/services" className={linkClass}>Services</Link></li>
              <li><Link to="/contact" className={linkClass}>Contact</Link></li>
              <li>
                <Link to="/book-demo" className={`${linkClass} font-medium !text-brand-hover hover:!text-navy`}>
                  Book a Free Demo
                </Link>
              </li>
              <li>
                <Link to="/join-tutor" className={linkClass}>Join as a Tutor</Link>
              </li>
            </Column>
          </div>

          {/* Subjects – each links to the demo page */}
          <div className="lg:col-span-2">
            <Column title="Subjects">
              {SUBJECTS.map((s) => (
                <li key={s}>
                  <Link to="/book-demo" className={linkClass}>{s}</Link>
                </li>
              ))}
            </Column>
          </div>

          {/* Services */}
          <div className="lg:col-span-2">
            <Column title="Services">
              {SERVICES.map((s) => (
                <li key={s}>
                  <Link to="/services" className={linkClass}>{s}</Link>
                </li>
              ))}
            </Column>
          </div>

          {/* Curriculum – each links to the demo page */}
          <div className="lg:col-span-2">
            <Column title="Curriculum">
              {CURRICULUM.map((c) => (
                <li key={c}>
                  <Link to="/book-demo" className={linkClass}>{c}</Link>
                </li>
              ))}
            </Column>
          </div>
        </div>
      </div>

      {/* Copyright */}
      <div className="border-t border-line">
        <div className={`${CONTAINER} flex flex-col items-center justify-between gap-2 py-6 text-sm text-slate-500 sm:flex-row`}>
          <p>
            © {new Date().getFullYear()}{" "}
            <a href={SITE.websiteHref} className="font-medium text-navy hover:underline">
              {SITE.name}
            </a>
            . All rights reserved.
          </p>
          <p>
            Developed by{" "}
            <span className="font-medium text-navy">Techno Vanam Innovation Pvt Ltd</span>
          </p>
        </div>
      </div>

      {/* Floating WhatsApp button */}
      <a
        href={WHATSAPP_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Chat on WhatsApp"
        className="fixed bottom-5 right-5 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg shadow-green-600/30 transition hover:-translate-y-0.5 hover:shadow-xl focus:outline-none focus-visible:ring-4 focus-visible:ring-green-300 sm:bottom-6 sm:right-6 sm:h-14 sm:w-14"
      >
        <FaWhatsapp size={24} />
      </a>
    </footer>
  );
};

export default Footer;
