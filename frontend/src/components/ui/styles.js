// ============================================================
// SHARED CLASS NAMES
// Keeps buttons and form fields identical across the site.
// ============================================================

// Page width: up to 1440px, slim side padding (shared by header, sections, footer)
export const CONTAINER = "mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-10";

const btnBase =
  "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-all duration-200 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 " +
  "disabled:opacity-60 disabled:cursor-not-allowed";

const btnSizes = {
  sm: "px-4 py-2 text-sm",
  md: "px-5 py-2.5 text-sm sm:text-[15px]",
  lg: "px-7 py-3.5 text-base",
};

const btnVariants = {
  // Gold – the one main action on a screen
  primary: "bg-brand text-navy hover:bg-brand-hover shadow-sm hover:shadow-md",
  // Navy – strong secondary
  dark: "bg-navy text-white hover:bg-navy-light",
  // Outlined – quiet secondary
  outline: "border border-line bg-white text-navy hover:border-slate-300 hover:bg-surface",
  // Text only
  ghost: "text-slate-600 hover:text-navy hover:bg-surface",
  // For dark backgrounds
  light: "bg-white text-navy hover:bg-slate-100",
  // See-through button for photos / dark heroes
  glass: "bg-white/10 text-white ring-1 ring-white/25 backdrop-blur hover:bg-white/20",
};

export const btn = (variant = "primary", size = "md", extra = "") =>
  `${btnBase} ${btnSizes[size]} ${btnVariants[variant]} ${extra}`.trim();

export const inputClass =
  "block w-full rounded-xl border border-line bg-white px-4 py-3 text-[15px] text-ink placeholder:text-slate-400 " +
  "transition focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/20";

export const labelClass = "mb-1.5 block text-sm font-medium text-slate-700";

export const cardClass =
  "rounded-[2rem] border border-line bg-white transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_12px_32px_-12px_rgba(15,23,42,0.18)]";
