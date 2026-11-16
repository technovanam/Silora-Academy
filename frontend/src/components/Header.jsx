import React, { useEffect, useState } from "react";
import { NavLink, Link, useLocation } from "react-router-dom";
import { ArrowRight, Menu, X } from "lucide-react";
import { SITE, NAV_LINKS } from "../data/site";
import { btn, CONTAINER } from "./ui/styles";

// ============================================================
// HEADER – floating pill
// A rounded white bar that floats just below the top of the screen.
// Total height stays 64px (mobile) / 72px (desktop) so page offsets don't change.
// ============================================================

const Header = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { pathname } = useLocation();

  // Stronger shadow once the page is scrolled
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close the mobile menu whenever the route changes
  useEffect(() => setIsOpen(false), [pathname]);

  const navLinkClasses = ({ isActive }) =>
    `rounded-full px-3.5 py-2 text-[15px] font-medium transition-colors lg:px-4 ${
      isActive ? "bg-navy text-white" : "text-slate-500 hover:bg-surface hover:text-navy"
    }`;

  const mobileNavLinkClasses = ({ isActive }) =>
    `block rounded-xl px-4 py-3 text-base font-medium transition-colors ${
      isActive ? "bg-surface text-navy" : "text-slate-600 hover:bg-surface hover:text-navy"
    }`;

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-50 pt-2 lg:pt-3">
      <div className={CONTAINER}>
        <div
          className={`pointer-events-auto flex h-14 items-center justify-between gap-3 rounded-full border border-line bg-white/90 pl-4 pr-2 backdrop-blur-md transition-shadow duration-300 lg:h-[60px] lg:pl-5 ${
            scrolled || isOpen
              ? "shadow-[0_12px_30px_-12px_rgba(10,45,74,0.28)]"
              : "shadow-[0_6px_20px_-12px_rgba(10,45,74,0.18)]"
          }`}
        >
          {/* Logo */}
          <Link to="/" className="flex shrink-0 items-center" aria-label={`${SITE.name} Home`}>
            <img
              src={SITE.logo}
              alt={`${SITE.name} Logo`}
              className="h-9 w-auto object-contain mix-blend-multiply lg:h-10"
              width="60"
              height="60"
              loading="eager"
              fetchPriority="high"
            />
          </Link>

          {/* Desktop navigation */}
          <nav className="hidden md:block" aria-label="Main">
            <ul className="flex items-center gap-0.5">
              {NAV_LINKS.map((l) => (
                <li key={l.to}>
                  <NavLink to={l.to} end={l.to === "/"} className={navLinkClasses}>
                    {l.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>

          {/* Desktop actions */}
          <div className="hidden items-center gap-1 md:flex">
            <Link to="/join-tutor" className={btn("ghost", "md", "hidden lg:inline-flex")}>
              Join as Tutor
            </Link>
            <Link to="/book-demo" className={btn("primary", "md")}>
              Book a demo <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {/* Mobile toggle */}
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="rounded-full p-2 text-navy transition hover:bg-surface md:hidden"
            aria-label={isOpen ? "Close menu" : "Open menu"}
            aria-expanded={isOpen}
          >
            {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>

        {/* Mobile navigation – drops down as a card under the pill */}
        <div
          className={`pointer-events-auto mt-2 overflow-hidden rounded-3xl border-line bg-white shadow-[0_20px_40px_-20px_rgba(10,45,74,0.35)] transition-all duration-300 ease-in-out md:hidden ${
            isOpen ? "max-h-[28rem] border opacity-100" : "pointer-events-none max-h-0 opacity-0"
          }`}
        >
          <nav className="space-y-1 p-3" aria-label="Mobile">
            {NAV_LINKS.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.to === "/"} className={mobileNavLinkClasses}>
                {l.label}
              </NavLink>
            ))}
            <div className="grid grid-cols-2 gap-2 pt-3">
              <Link to="/join-tutor" className={btn("outline", "md")}>
                Join as Tutor
              </Link>
              <Link to="/book-demo" className={btn("primary", "md")}>
                Book a demo
              </Link>
            </div>
          </nav>
        </div>
      </div>
    </header>
  );
};

export default Header;
