// ============================================================
// PORTAL UI KIT – buttons, cards, custom selects (no native
// dropdowns), dialogs, tabs, toasts, tables, empty states…
// ============================================================
import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Info, Loader2, Search, X, XCircle } from "lucide-react";
import { initials } from "../lib/format.js";

export const cx = (...c) => c.filter(Boolean).join(" ");

// ---- Button ------------------------------------------------------------------
const BTN = {
  primary: "bg-brand text-navy hover:bg-brand-hover",
  dark: "bg-navy text-white hover:bg-navy-light",
  outline: "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-navy",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-navy",
  danger: "bg-rose-600 text-white hover:bg-rose-700",
  "danger-outline": "border border-rose-200 bg-white text-rose-600 hover:bg-rose-50",
  success: "bg-emerald-600 text-white hover:bg-emerald-700",
};
const BTN_SIZE = { xs: "h-8 px-2.5 text-xs gap-1.5 rounded-lg", sm: "h-9 px-3 text-sm gap-1.5 rounded-lg", md: "h-10 px-4 text-sm gap-2 rounded-xl", lg: "h-12 px-6 text-[15px] gap-2 rounded-xl" };

export const Button = React.forwardRef(function Button({ variant = "primary", size = "md", loading, icon: Icon, className, children, disabled, type = "button", ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cx(
        "inline-flex shrink-0 items-center justify-center font-semibold whitespace-nowrap transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60",
        BTN[variant],
        BTN_SIZE[size],
        className
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon ? <Icon className="h-4 w-4" /> : null}
      {children}
    </button>
  );
});

export function IconButton({ icon: Icon, label, className, tone = "default", ...rest }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
        tone === "danger" ? "text-rose-500 hover:bg-rose-50" : "text-slate-500 hover:bg-slate-100 hover:text-navy",
        className
      )}
      {...rest}
    >
      <Icon className="h-[18px] w-[18px]" />
    </button>
  );
}

// ---- Layout pieces -------------------------------------------------------------
/** flush: no padding and clipped corners – for a card that is just a table. */
export function Card({ className, children, padded = true, flush = false, ...rest }) {
  return (
    <div className={cx("min-w-0 rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]", flush ? "overflow-hidden" : padded && "p-5 sm:p-6", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardTitle({ title, subtitle, action, icon: Icon }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {Icon && (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <Icon className="h-4 w-4" />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-navy">{title}</h2>
          {subtitle && <p className="text-[13px] text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, back }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {back}
        <h1 className="text-xl font-bold tracking-tight text-navy sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const TONES = {
  gray: "bg-slate-100 text-slate-600",
  blue: "bg-sky-50 text-sky-700",
  green: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-700",
  red: "bg-rose-50 text-rose-700",
  navy: "bg-navy text-white",
  gold: "bg-brand-soft text-[#8a6700]",
  violet: "bg-violet-50 text-violet-700",
};
export function Badge({ tone = "gray", children, className, dot }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium", TONES[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function StatCard({ icon: Icon, label, value, hint, tone = "gold", onClick }) {
  const toneCls = { gold: "text-[#a77d00] bg-brand-soft", blue: "text-sky-600 bg-sky-50", green: "text-emerald-600 bg-emerald-50", red: "text-rose-600 bg-rose-50", violet: "text-violet-600 bg-violet-50", navy: "text-navy bg-slate-100" }[tone];
  const Comp = onClick ? "button" : "div";
  return (
    <Comp onClick={onClick} className={cx("group flex min-w-0 flex-col rounded-2xl border border-slate-200/80 bg-white p-4 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-5", onClick && "transition hover:border-slate-300 hover:shadow-[0_4px_16px_-8px_rgba(15,23,42,0.15)]")}>
      <div className="flex items-center justify-between gap-3">
        <p className="line-clamp-2 text-[13px] font-medium leading-snug text-slate-500">{label}</p>
        {Icon && (
          <span className={cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", toneCls)}>
            <Icon className="h-4 w-4" />
          </span>
        )}
      </div>
      <p className="mt-2 text-[28px] font-bold leading-none tracking-tight text-navy">{value ?? "—"}</p>
      {hint && <p className="mt-2 truncate text-xs text-slate-400">{hint}</p>}
    </Comp>
  );
}

export function Avatar({ name, size = "md", className }) {
  const s = { sm: "h-8 w-8 text-xs", md: "h-10 w-10 text-sm", lg: "h-14 w-14 text-lg" }[size];
  const palette = ["bg-sky-100 text-sky-700", "bg-amber-100 text-amber-700", "bg-emerald-100 text-emerald-700", "bg-violet-100 text-violet-700", "bg-rose-100 text-rose-700"];
  const idx = [...(name || "")].reduce((a, c) => a + c.charCodeAt(0), 0) % palette.length;
  return <span className={cx("inline-flex shrink-0 items-center justify-center rounded-full font-bold", s, palette[idx], className)}>{initials(name)}</span>;
}

export function Progress({ value = 0, tone = "brand", className }) {
  const c = { brand: "bg-brand", green: "bg-emerald-500", blue: "bg-sky-500", amber: "bg-amber-500", red: "bg-rose-500" }[tone];
  return (
    <div className={cx("h-2 w-full overflow-hidden rounded-full bg-slate-100", className)}>
      <div className={cx("h-full rounded-full transition-all", c)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Spinner({ className }) {
  return <Loader2 className={cx("h-5 w-5 animate-spin text-brand", className)} />;
}
export function Loading({ label = "Loading…", className }) {
  return (
    <div className={cx("flex items-center justify-center gap-3 py-16 text-sm text-muted", className)}>
      <Spinner /> {label}
    </div>
  );
}
export function Empty({ icon: Icon = Info, title, text, action, className }) {
  return (
    <div className={cx("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
        <Icon className="h-6 w-6" />
      </span>
      <p className="font-semibold text-navy">{title}</p>
      {text && <p className="mt-1 max-w-sm text-sm text-muted">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
      <span className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0" /> {error.message || String(error)}
      </span>
      {onRetry && (
        <Button size="xs" variant="danger-outline" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
export function Notice({ tone = "info", children, className, icon }) {
  const t = { info: "border-sky-200 bg-sky-50 text-sky-800", warn: "border-amber-200 bg-amber-50 text-amber-800", success: "border-emerald-200 bg-emerald-50 text-emerald-800", danger: "border-rose-200 bg-rose-50 text-rose-800" }[tone];
  const I = icon || { info: Info, warn: AlertTriangle, success: CheckCircle2, danger: XCircle }[tone];
  return (
    <div className={cx("flex items-start gap-3 rounded-xl border px-4 py-3 text-sm", t, className)}>
      <I className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// ---- Form controls ----------------------------------------------------------------
const FIELD = "block w-full rounded-lg border border-slate-200 bg-white px-3.5 text-sm text-ink placeholder:text-slate-400 transition focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/20 disabled:bg-surface disabled:text-slate-500";

export function Field({ label, hint, error, required, children, className }) {
  return (
    <label className={cx("block min-w-0", className)}>
      {label && (
        <span className="mb-1.5 block text-[13px] font-medium text-slate-700">
          {label} {required && <span className="text-rose-500">*</span>}
        </span>
      )}
      {children}
      {error ? <span className="mt-1 block text-xs text-rose-600">{error}</span> : hint ? <span className="mt-1 block text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}
export const Input = React.forwardRef(function Input({ className, icon: Icon, ...rest }, ref) {
  if (!Icon) return <input ref={ref} className={cx(FIELD, "h-10", className)} {...rest} />;
  return (
    <span className="relative block">
      <Icon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input ref={ref} className={cx(FIELD, "h-10 pl-10", className)} {...rest} />
    </span>
  );
});
export const Textarea = React.forwardRef(function Textarea({ className, rows = 4, ...rest }, ref) {
  return <textarea ref={ref} rows={rows} className={cx(FIELD, "resize-y py-2.5 leading-relaxed", className)} {...rest} />;
});
export function SearchInput({ value, onChange, placeholder = "Search…", className }) {
  return (
    <span className={cx("relative block min-w-0", className)}>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cx(FIELD, "h-10 pl-10 pr-9")} />
      {value && (
        <button type="button" onClick={() => onChange("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 hover:text-navy" aria-label="Clear search">
          <X className="h-4 w-4" />
        </button>
      )}
    </span>
  );
}

export function Toggle({ checked, onChange, label, description, disabled }) {
  return (
    <label className={cx("flex cursor-pointer items-start justify-between gap-4", disabled && "cursor-not-allowed opacity-60")}>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        {description && <span className="block text-xs text-muted">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={!!checked}
        aria-label={typeof label === "string" ? label : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx("relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2", checked ? "bg-brand" : "bg-slate-300")}
      >
        <span className={cx("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", checked ? "left-[22px]" : "left-0.5")} />
      </button>
    </label>
  );
}

export function Checkbox({ checked, onChange, label, className }) {
  return (
    <label className={cx("inline-flex cursor-pointer items-center gap-2.5 text-sm text-ink", className)}>
      <span className={cx("flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition", checked ? "border-brand bg-brand text-navy" : "border-slate-300 bg-white")}>
        {checked && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
      </span>
      <input type="checkbox" className="sr-only" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** Segmented options (radio chips). */
export function Segmented({ value, onChange, options, className, size = "md" }) {
  return (
    // One row that scrolls sideways on small screens (never wraps into a lopsided second line)
    <div className={cx("scrollbar-none inline-flex max-w-full gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
            size === "sm" ? "px-3 py-1.5 text-xs" : "px-3.5 py-2 text-sm",
            value === o.value ? "bg-white text-navy shadow-sm" : "text-slate-500 hover:text-navy"
          )}
        >
          {o.icon && <o.icon className="h-4 w-4" />}
          {o.label}
          {o.count !== undefined && <span className={cx("rounded-full px-1.5 text-[11px]", value === o.value ? "bg-brand-soft text-[#8a6700]" : "bg-white text-slate-500")}>{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ---- Floating layer (positions dropdowns above everything, never clipped) ----------
function useFloating(open, anchorRef, { minWidth = 220, maxHeight = 300 } = {}) {
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = Math.min(Math.max(r.width, minWidth), vw - 16);
      const left = Math.min(Math.max(8, r.left), vw - width - 8);
      const below = vh - r.bottom - 8;
      const up = below < Math.min(maxHeight, 220) && r.top > below;
      setPos({ left, width, top: up ? undefined : r.bottom + 6, bottom: up ? vh - r.top + 6 : undefined, maxHeight: Math.min(maxHeight, (up ? r.top : below) - 12) });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, anchorRef, minWidth, maxHeight]);
  return pos;
}

function useOutside(open, refs, onClose) {
  useEffect(() => {
    if (!open) return;
    const h = (e) => {
      if (refs.every((r) => !r.current || !r.current.contains(e.target))) onClose();
    };
    const k = (e) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", h);
    document.addEventListener("keydown", k);
    return () => {
      document.removeEventListener("pointerdown", h);
      document.removeEventListener("keydown", k);
    };
  }, [open, refs, onClose]);
}

/**
 * Custom select. options: [{ value, label, hint?, icon? }]
 * multiple: value is an array; max limits selections.
 */
export function Select({ value, onChange, options = [], placeholder = "Select…", multiple = false, max, searchable, disabled, className, size = "md", emptyText = "No options", renderValue, clearable }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const anchor = useRef(null);
  const panel = useRef(null);
  const searchRef = useRef(null);
  const pos = useFloating(open, anchor);
  const refs = useMemo(() => [anchor, panel], []);
  const close = useCallback(() => {
    setOpen(false);
    setQ("");
  }, []);
  useOutside(open, refs, close);
  const showSearch = searchable ?? options.length > 8;
  const list = useMemo(() => (q ? options.filter((o) => `${o.label} ${o.hint || ""}`.toLowerCase().includes(q.toLowerCase())) : options), [q, options]);
  const selected = multiple ? options.filter((o) => (value || []).includes(o.value)) : options.find((o) => o.value === value);

  useEffect(() => {
    if (open) {
      setActive(Math.max(0, list.findIndex((o) => (multiple ? false : o.value === value))));
      setTimeout(() => searchRef.current?.focus(), 0);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (o) => {
    if (o.disabled) return;
    if (multiple) {
      const cur = value || [];
      if (cur.includes(o.value)) onChange(cur.filter((v) => v !== o.value));
      else if (!max || cur.length < max) onChange([...cur, o.value]);
    } else {
      onChange(o.value);
      close();
      anchor.current?.focus();
    }
  };

  const onKey = (e) => {
    if (!open && ["ArrowDown", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      return setOpen(true);
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(list.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (list[active]) pick(list[active]);
    } else if (e.key === "Tab") close();
  };

  const h = size === "sm" ? "min-h-9 text-sm" : "min-h-11 text-[15px]";
  let display;
  if (renderValue) display = renderValue(selected);
  else if (multiple)
    display = selected.length ? (
      <span className="flex flex-wrap gap-1">
        {selected.map((o) => (
          <span key={o.value} className="inline-flex items-center gap-1 rounded-lg bg-brand-soft px-2 py-0.5 text-xs font-semibold text-[#7a5b00]">
            {o.label}
            <span
              role="button"
              tabIndex={-1}
              aria-label={`Remove ${o.label}`}
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onChange((value || []).filter((v) => v !== o.value));
              }}
              className="rounded hover:bg-white/60"
            >
              <X className="h-3 w-3" />
            </span>
          </span>
        ))}
      </span>
    ) : null;
  else display = selected ? (
    <span className="flex min-w-0 items-center gap-2">
      {selected.icon}
      <span className="truncate">{selected.label}</span>
    </span>
  ) : null;

  return (
    <div className={cx("relative min-w-0", className)}>
      <button
        ref={anchor}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKey}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cx(
          "flex w-full items-center justify-between gap-2 rounded-lg border bg-white px-3.5 py-1.5 text-left transition focus:outline-none disabled:cursor-not-allowed disabled:bg-surface",
          h,
          open ? "border-brand ring-[3px] ring-brand/20" : "border-slate-200 hover:border-slate-300 focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-brand/20"
        )}
      >
        <span className={cx("min-w-0 flex-1", !display && "text-slate-400")}>{display || placeholder}</span>
        {clearable && !multiple && value ? (
          <span
            role="button"
            tabIndex={-1}
            aria-label="Clear"
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onChange(null);
            }}
            className="rounded-full p-0.5 text-slate-400 hover:text-navy"
          >
            <X className="h-4 w-4" />
          </span>
        ) : (
          <ChevronDown className={cx("h-4 w-4 shrink-0 text-slate-400 transition", open && "rotate-180")} />
        )}
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panel}
            role="listbox"
            onKeyDown={onKey}
            style={{ position: "fixed", left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, zIndex: 1000 }}
            className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_12px_32px_-12px_rgba(15,23,42,0.25)]"
          >
            {showSearch && (
              <div className="border-b border-line p-2">
                <span className="relative block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    ref={searchRef}
                    value={q}
                    onChange={(e) => {
                      setQ(e.target.value);
                      setActive(0);
                    }}
                    onKeyDown={onKey}
                    placeholder="Search…"
                    className="h-9 w-full rounded-lg bg-surface pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand/30"
                  />
                </span>
              </div>
            )}
            {multiple && max && <p className="border-b border-line px-3.5 py-2 text-xs text-muted">{(value || []).length} of {max} selected</p>}
            <ul className="scrollbar-thin overflow-y-auto p-1.5" style={{ maxHeight: Math.max(120, pos.maxHeight - (showSearch ? 56 : 0)) }}>
              {list.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">{emptyText}</li>}
              {list.map((o, i) => {
                const isSel = multiple ? (value || []).includes(o.value) : o.value === value;
                const blocked = o.disabled || (multiple && max && !isSel && (value || []).length >= max);
                return (
                  <li
                    key={String(o.value)}
                    role="option"
                    aria-selected={isSel}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => !blocked && pick(o)}
                    className={cx("flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm", i === active && "bg-surface", isSel && "font-semibold text-navy", blocked && "cursor-not-allowed opacity-45")}
                  >
                    {multiple && (
                      <span className={cx("flex h-4.5 w-4.5 h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border", isSel ? "border-brand bg-brand text-navy" : "border-slate-300")}>
                        {isSel && <Check className="h-3 w-3" strokeWidth={3} />}
                      </span>
                    )}
                    {o.icon}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{o.label}</span>
                      {o.hint && <span className="block truncate text-xs font-normal text-slate-500">{o.hint}</span>}
                    </span>
                    {!multiple && isSel && <Check className="h-4 w-4 shrink-0 text-brand" />}
                  </li>
                );
              })}
            </ul>
          </div>,
          document.body
        )}
    </div>
  );
}

/** Small "⋯" style menu. items: [{label, icon, onClick, danger, hidden}] */
export function Menu({ trigger, items, align = "right" }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef(null);
  const panel = useRef(null);
  const pos = useFloating(open, anchor, { minWidth: 200 });
  const refs = useMemo(() => [anchor, panel], []);
  useOutside(open, refs, () => setOpen(false));
  const visible = items.filter((i) => !i.hidden);
  return (
    <>
      <span ref={anchor} className="inline-flex" onClick={() => setOpen((o) => !o)}>
        {trigger}
      </span>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panel}
            style={{ position: "fixed", top: pos.top, bottom: pos.bottom, zIndex: 1000, ...(align === "right" ? { right: Math.max(8, window.innerWidth - (anchor.current?.getBoundingClientRect().right || 0)) } : { left: pos.left }), width: 220 }}
            className="rounded-xl border border-slate-200 bg-white p-1 shadow-[0_12px_32px_-12px_rgba(15,23,42,0.25)]"
          >
            {visible.map((i) => (
              <button
                key={i.label}
                type="button"
                onClick={() => {
                  setOpen(false);
                  i.onClick();
                }}
                className={cx("flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition", i.danger ? "text-rose-600 hover:bg-rose-50" : "text-ink hover:bg-surface")}
              >
                {i.icon && <i.icon className="h-4 w-4 shrink-0" />}
                {i.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}

// ---- Dialog -------------------------------------------------------------------------
export function Dialog({ open, onClose, title, subtitle, children, footer, size = "md", dismissable = true }) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const k = (e) => e.key === "Escape" && dismissable && !document.querySelector('[role="listbox"]') && onClose();
    document.addEventListener("keydown", k);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", k);
    };
  }, [open, onClose, dismissable]);
  if (!open) return null;
  const w = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-5xl" }[size];
  return createPortal(
    <div className="fixed inset-0 z-[900] flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[3px]" onClick={() => dismissable && onClose()} />
      <div className={cx("relative flex max-h-[92svh] w-full flex-col rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl", w)}>
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-navy">{title}</h2>
            {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
          </div>
          {dismissable && <IconButton icon={X} label="Close" onClick={onClose} className="-mr-2" />}
        </div>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-4 sm:px-6">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

// ---- Toasts + confirm ----------------------------------------------------------------
const UiCtx = createContext(null);
export const useUi = () => useContext(UiCtx);

export function UiProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useCallback((message, tone = "success") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  const confirm = useCallback((opts) => new Promise((resolve) => setConfirm({ ...opts, resolve })), []);
  const value = useMemo(() => ({ toast, confirm, error: (e) => toast(e?.message || String(e), "error") }), [toast, confirm]);
  const finish = async (ok) => {
    if (ok && confirmState.onConfirm) {
      setBusy(true);
      try {
        await confirmState.onConfirm();
      } catch (e) {
        toast(e.message, "error");
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    confirmState.resolve(ok);
    setConfirm(null);
  };
  return (
    <UiCtx.Provider value={value}>
      {children}
      <Dialog
        open={!!confirmState}
        onClose={() => finish(false)}
        title={confirmState?.title || "Are you sure?"}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => finish(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant={confirmState?.danger ? "danger" : "primary"} onClick={() => finish(true)} loading={busy}>
              {confirmState?.confirmLabel || "Confirm"}
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-slate-600">{confirmState?.message}</p>
      </Dialog>
      {createPortal(
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[1100] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:right-6 sm:left-auto sm:items-end">
          {toasts.map((t) => (
            <div key={t.id} className="pointer-events-auto flex max-w-sm items-start gap-2.5 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-ink shadow-[0_12px_32px_-12px_rgba(15,23,42,0.3)]">
              {t.tone === "error" ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" /> : t.tone === "info" ? <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />}
              <span>{t.message}</span>
            </div>
          ))}
        </div>,
        document.body
      )}
    </UiCtx.Provider>
  );
}

// ---- Table ------------------------------------------------------------------------------
/**
 * columns: [{ key, label, render?, className?, headClass? }]
 * Put it in <Card flush> on its own, or pass `bleed` when it sits under a
 * CardTitle inside a normal padded Card (it then stretches to the card edges).
 * pageSize: show the rows a page at a time with a pagination bar underneath.
 * minWidth: Tailwind min-width class for the <table> (it scrolls sideways below that).
 */
const PAGE_SIZES = [10, 25, 50, 100];

/** Paging for any list (cards, lists, tables): const pg = usePaged(rows, 10); pg.rows … <Pager {...pg.pager} /> */
export function usePaged(rows, initialSize = 10, sizes = PAGE_SIZES) {
  const [size, setSize] = useState(initialSize);
  const [page, setPage] = useState(0);
  const count = rows?.length || 0;
  const pages = Math.max(1, Math.ceil(count / size));
  // A new filter gives a different list: back to the first page
  useEffect(() => setPage(0), [count, size]);
  const p = Math.min(page, pages - 1);
  return {
    rows: (rows || []).slice(p * size, p * size + size),
    show: count > Math.min(...sizes),
    pager: { page: p, pages, size, count, sizes, onPage: setPage, onSize: setSize },
  };
}
export function Table({ columns, rows, rowKey = "id", onRowClick, empty, dense, bleed = false, pageSize, minWidth = "min-w-[640px]" }) {
  const [size, setSize] = useState(pageSize || 0);
  const [page, setPage] = useState(0);
  const count = rows?.length || 0;
  const pages = size ? Math.max(1, Math.ceil(count / size)) : 1;
  // A new filter or search gives a different list: go back to the first page
  useEffect(() => setPage(0), [count, size]);
  if (!count) return empty || <Empty title="Nothing here yet" />;
  const p = Math.min(page, pages - 1);
  const shown = size ? rows.slice(p * size, p * size + size) : rows;
  return (
    <div className={cx(bleed && "-mx-5 -mb-5 sm:-mx-6 sm:-mb-6")}>
      <div className="scrollbar-thin overflow-x-auto">
        <table className={cx("w-full border-separate border-spacing-0 text-sm", minWidth)}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={cx("whitespace-nowrap border-b border-slate-200 bg-slate-50/60 px-4 py-2.5 text-left text-xs font-medium text-slate-500 first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6", c.headClass)}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="[&>tr:last-child>td]:border-b-0">
            {shown.map((r, i) => (
              <tr key={r[rowKey] ?? i} onClick={onRowClick ? () => onRowClick(r) : undefined} className={cx("transition-colors hover:bg-slate-50", onRowClick && "cursor-pointer")}>
                {columns.map((c) => (
                  <td key={c.key} className={cx("border-b border-slate-100 px-4 align-middle text-ink first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6", dense ? "py-2" : "py-3", c.className)}>
                    {c.render ? c.render(r) : r[c.key] ?? "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {size > 0 && count > PAGE_SIZES[0] && <Pager page={p} pages={pages} size={size} count={count} onPage={setPage} onSize={setSize} />}
    </div>
  );
}

export function Pager({ page, pages, size, count, onPage, onSize, sizes = PAGE_SIZES }) {
  // First, last, and the pages around the current one, with "…" for the gaps
  const nums = [...new Set([0, pages - 1, page - 1, page, page + 1])].filter((n) => n >= 0 && n < pages).sort((a, b) => a - b);
  const items = nums.flatMap((n, i) => (i && n - nums[i - 1] > 1 ? ["gap" + n, n] : [n]));
  const btn = "inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-sm font-medium transition disabled:pointer-events-none disabled:opacity-40";
  return (
    <div className="flex flex-col gap-3 border-t border-slate-100 px-5 py-3 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span>
          Showing <span className="font-medium text-ink">{page * size + 1}–{Math.min(count, page * size + size)}</span> of <span className="font-medium text-ink">{count}</span>
        </span>
        <label className="flex items-center gap-2">
          Rows per page
          <select value={size} onChange={(e) => onSize(Number(e.target.value))} className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-sm text-ink focus:border-brand focus:outline-none">
            {sizes.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
      <nav aria-label="Pages" className="flex items-center gap-1 self-end sm:self-auto">
        <button type="button" className={cx(btn, "text-slate-600 hover:bg-slate-100")} disabled={page === 0} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </button>
        {items.map((n) =>
          typeof n === "string" ? (
            <span key={n} className="px-1 text-slate-400">…</span>
          ) : (
            <button key={n} type="button" aria-current={n === page ? "page" : undefined} className={cx(btn, n === page ? "bg-navy text-white" : "text-slate-600 hover:bg-slate-100")} onClick={() => onPage(n)}>
              {n + 1}
            </button>
          )
        )}
        <button type="button" className={cx(btn, "text-slate-600 hover:bg-slate-100")} disabled={page >= pages - 1} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </button>
      </nav>
    </div>
  );
}

// ---- Data loading hook ------------------------------------------------------------------
export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null, version: 0 });
  const counter = useRef(0);
  const versions = useRef(0);
  // Changes during the render in which the deps change – so that render already
  // counts as loading (the fetch itself only starts in the effect afterwards)
  const version = useMemo(() => ++versions.current, deps); // eslint-disable-line react-hooks/exhaustive-deps
  const run = useCallback(async (silent) => {
    const n = ++counter.current;
    if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fn();
      if (n === counter.current) setState({ data, loading: false, error: null, version });
    } catch (error) {
      if (n === counter.current) setState((s) => ({ ...s, loading: false, error, version }));
    }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    run();
  }, [run]);
  const { version: loadedFor, ...rest } = state;
  return { ...rest, loading: rest.loading || loadedFor !== version, reload: run, setData: (data) => setState((s) => ({ ...s, data: typeof data === "function" ? data(s.data) : data })) };
}

export function Pill({ active, children, onClick }) {
  return (
    <button type="button" onClick={onClick} className={cx("rounded-lg px-3 py-1.5 text-sm font-medium transition", active ? "bg-navy text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:text-navy")}>
      {children}
    </button>
  );
}
