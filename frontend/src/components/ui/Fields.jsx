import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Globe, Search } from "lucide-react";
import "react-phone-input-2/lib/style.css"; // flag sprite used by <Flag />
import { countries, POPULAR_COUNTRIES } from "../../data/countries";
import { labelClass } from "./styles";

// Label + control wrapper
export const Field = ({ label, htmlFor, className = "", children }) => (
  <div className={className}>
    {label && (
      <label htmlFor={htmlFor} className={labelClass}>
        {label}
      </label>
    )}
    {children}
  </div>
);

// ============================================================
// FLOATING-LABEL FIELDS (used in the Book-a-demo / Join-as-tutor forms)
// Soft grey filled boxes; the label sits inside the box and
// floats to the top once the field is focused or filled.
// ============================================================

const floatBox =
  "peer block h-12 w-full rounded-xl border border-transparent bg-slate-100/80 pb-1 pl-11 pr-4 pt-[18px] text-[15px] text-ink " +
  "outline-none transition placeholder:text-transparent hover:bg-slate-100 focus:border-brand focus:bg-white focus:ring-[3px] focus:ring-brand/20";

const floatIcon =
  "pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400 transition peer-focus:text-brand-hover";

// "small at the top" is the default; the empty state centers it
const floatLabelBase =
  "pointer-events-none absolute left-11 top-1.5 text-[10px] font-medium text-slate-500 transition-all duration-150 " +
  "peer-focus:top-1.5 peer-focus:translate-y-0 peer-focus:text-[10px] peer-focus:text-brand-hover";

export const FloatInput = ({ id, label, Icon, className = "", ...props }) => (
  <div className={`relative ${className}`}>
    <input id={id} placeholder=" " className={floatBox} {...props} />
    <label
      htmlFor={id}
      className={`${floatLabelBase} peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:text-[15px] peer-placeholder-shown:text-slate-400`}
    >
      {label}
    </label>
    {Icon && <Icon className={floatIcon} />}
  </div>
);

// ============================================================
// FLAG – reuses the sprite shipped with react-phone-input-2
// ============================================================

export const Flag = ({ code, className = "" }) => (
  <span aria-hidden="true" className={`react-tel-input !inline-flex !w-auto shrink-0 ${className}`}>
    <span className={`flag ${code} rounded-[2px] shadow-[0_0_0_1px_rgba(15,23,42,0.08)]`} />
  </span>
);

// ============================================================
// COUNTRY PICKER – custom dropdown (no native <select>)
// Search, popular countries first, flags, full keyboard support.
// A visually hidden input carries the value, so the form's
// FormData, `required` validation and reset() keep working.
// ============================================================

const byCode = Object.fromEntries(countries.map((c) => [c.code, c]));
const POPULAR = POPULAR_COUNTRIES.map((code) => byCode[code]).filter(Boolean);
const OTHERS = countries.filter((c) => !POPULAR_COUNTRIES.includes(c.code));

export const CountrySelect = ({ id, name, label = "Country", required, className = "" }) => {
  const [value, setValue] = useState(null);
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const searchRef = useRef(null);
  const listRef = useRef(null);
  const hiddenRef = useRef(null);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [...POPULAR, ...OTHERS];
    const starts = countries.filter((c) => c.name.toLowerCase().startsWith(q));
    const contains = countries.filter((c) => !c.name.toLowerCase().startsWith(q) && c.name.toLowerCase().includes(q));
    return [...starts, ...contains];
  }, [query]);
  const showGroups = !query.trim();

  // Close when clicking outside
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => !rootRef.current?.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Clear when the parent form is reset
  useEffect(() => {
    const form = hiddenRef.current?.form;
    if (!form) return;
    const onReset = () => setValue(null);
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, []);

  // Keep the highlighted option in view
  useEffect(() => {
    if (open) listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const openMenu = () => {
    const r = buttonRef.current.getBoundingClientRect();
    setDropUp(window.innerHeight - r.bottom < 340 && r.top > 340);
    setQuery("");
    setActive(value ? Math.max(0, [...POPULAR, ...OTHERS].findIndex((c) => c.code === value.code)) : 0);
    setOpen(true);
    requestAnimationFrame(() => searchRef.current?.focus());
  };

  const choose = (c) => {
    setValue(c);
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onSearchKey = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (items[active]) choose(items[active]);
    } else if (e.key === "Escape" || e.key === "Tab") {
      setOpen(false);
      if (e.key === "Escape") buttonRef.current?.focus();
    }
  };

  const listId = `${id}-list`;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      {/* Carries the value for FormData + native required validation */}
      <input
        ref={hiddenRef}
        tabIndex={-1}
        aria-hidden="true"
        name={name}
        value={value?.name || ""}
        required={required}
        onChange={() => {}}
        onInvalid={() => buttonRef.current?.focus()}
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px w-full opacity-0"
      />

      <button
        ref={buttonRef}
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(e) => {
          if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key) && !open) {
            e.preventDefault();
            openMenu();
          }
        }}
        className={`group relative flex h-12 w-full items-center rounded-xl border pl-11 pr-10 text-left outline-none transition ${
          open
            ? "border-brand bg-white ring-[3px] ring-brand/20"
            : "border-transparent bg-slate-100/80 hover:bg-slate-100 focus-visible:border-brand focus-visible:bg-white focus-visible:ring-[3px] focus-visible:ring-brand/20"
        }`}
      >
        {value ? (
          <>
            <span className="absolute left-[15px] top-1/2 flex -translate-y-1/2">
              <Flag code={value.code} />
            </span>
            <span className="absolute left-11 top-1.5 text-[10px] font-medium text-slate-500">{label}</span>
            <span className="block truncate pt-3 text-[15px] text-ink">{value.name}</span>
          </>
        ) : (
          <>
            <Globe className={`absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 ${open ? "text-brand-hover" : "text-slate-400"}`} />
            <span className="text-[15px] text-slate-400">{label}</span>
          </>
        )}
        <ChevronDown
          className={`absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          className={`animate-modalIn absolute inset-x-0 z-40 overflow-hidden rounded-2xl bg-white p-2 shadow-[0_20px_50px_-12px_rgba(15,23,42,0.35)] ring-1 ring-line ${
            dropUp ? "bottom-full mb-2" : "top-full mt-2"
          }`}
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onSearchKey}
              placeholder="Search country"
              aria-label="Search country"
              aria-controls={listId}
              aria-activedescendant={items[active] ? `${id}-opt-${items[active].code}` : undefined}
              className="h-10 w-full rounded-lg bg-slate-100 pl-9 pr-3 text-sm text-ink outline-none placeholder:text-slate-400 focus:bg-slate-50"
            />
          </div>

          <ul ref={listRef} id={listId} role="listbox" aria-label={label} className="scrollbar-thin mt-2 max-h-64 overflow-y-auto overscroll-contain">
            {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-400">No country found</li>}
            {items.map((c, i) => {
              const selected = value?.code === c.code;
              return (
                <React.Fragment key={c.code}>
                  {showGroups && i === 0 && <GroupLabel>Popular</GroupLabel>}
                  {showGroups && i === POPULAR.length && <GroupLabel divider>All countries</GroupLabel>}
                  <li
                    id={`${id}-opt-${c.code}`}
                    data-i={i}
                    role="option"
                    aria-selected={selected}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(c)}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                      i === active ? "bg-surface" : ""
                    } ${selected ? "font-semibold text-navy" : "text-slate-700"}`}
                  >
                    <Flag code={c.code} />
                    <span className="flex-1 truncate">{c.name}</span>
                    {selected && <Check className="h-4 w-4 text-brand-hover" strokeWidth={3} />}
                  </li>
                </React.Fragment>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
};

const GroupLabel = ({ children, divider }) => (
  <li
    role="presentation"
    className={`px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 ${divider ? "mt-1 border-t border-line pt-3" : ""}`}
  >
    {children}
  </li>
);

// ============================================================
// CHIPS – pick one, backed by real radio inputs
// (so form data / reset / required still work)
// ============================================================

export const ChipGroup = ({ name, label, options, required, className = "" }) => (
  <fieldset className={className}>
    <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</legend>
    <div className="flex flex-wrap gap-1.5">
      {options.map((o, i) => {
        const value = typeof o === "string" ? o : o.value;
        const text = typeof o === "string" ? o : o.label;
        return (
          <label key={value} className="relative">
            <input
              type="radio"
              name={name}
              value={value}
              required={required && i === 0}
              className="peer absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-full outline-none"
            />
            <span
              className="pointer-events-none flex h-7 min-w-7 items-center justify-center rounded-full border border-line bg-white px-2.5 text-xs font-medium text-slate-600 transition
                         peer-hover:border-slate-300 peer-checked:border-navy peer-checked:bg-navy peer-checked:text-white
                         peer-focus-visible:ring-[3px] peer-focus-visible:ring-brand/30"
            >
              {text}
            </span>
          </label>
        );
      })}
    </div>
  </fieldset>
);
