// ============================================================
// CHARTS – small, dependency-free SVG/HTML charts for the portal.
// Palette is validated (light surface): blue #2a78d6 / orange
// #eb6834 – the brand gold is too light for data marks (1.9:1).
// Rules: thin marks with 4px rounded data-ends, 2px gaps between
// stacked fills, recessive grid, hover tooltip on every chart,
// legend for >= 2 series, text in ink tokens (never series color).
// ============================================================
import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { cx } from "../ui/index.jsx";

export const SERIES = { blue: "#2a78d6", orange: "#eb6834", aqua: "#1baf7a" };
const GRID = "#eef0f3";
const AXIS_TEXT = "#94a3b8";

function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const niceMax = (v) => {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * pow;
};
const ticksFor = (max) => [0, max / 4, max / 2, (max * 3) / 4, max].map((t) => Math.round(t * 10) / 10);

// Rect with only the top (or right) corners rounded – the data-end
function barPath(x, y, w, h, r, dir = "up") {
  if (h <= 0 || w <= 0) return "";
  r = Math.min(r, dir === "up" ? w / 2 : h / 2, dir === "up" ? h : w);
  if (dir === "up") return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
}

export function Legend({ series, className }) {
  return (
    <div className={cx("flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600", className)}>
      {series.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

function Tooltip({ x, y, width, children }) {
  const ref = useRef(null);
  const [tw, setTw] = useState(140);
  useLayoutEffect(() => {
    if (ref.current) setTw(ref.current.offsetWidth);
  }, [x, y]);
  const left = Math.max(0, Math.min(width - tw, x - tw / 2));
  return (
    <div ref={ref} className="pointer-events-none absolute z-10 min-w-[120px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-[0_8px_24px_-8px_rgba(15,23,42,0.25)]" style={{ left, top: Math.max(0, y - 8), transform: "translateY(-100%)" }}>
      {children}
    </div>
  );
}

function TipRows({ title, rows }) {
  return (
    <>
      <p className="mb-1 font-semibold text-navy">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center justify-between gap-4 text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            {r.color && <span className="h-2 w-2 rounded-sm" style={{ background: r.color }} />}
            {r.label}
          </span>
          <span className="font-semibold tabular-nums text-ink">{r.value}</span>
        </p>
      ))}
    </>
  );
}

/**
 * Vertical columns, optionally stacked.
 * data: [{...}], series: [{key,label,color}], xLabel: (d)=>string, tipTitle: (d)=>string
 */
export function ColumnChart({ data, series, xLabel, tipTitle, height = 220, highlight }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const pad = { l: 28, r: 4, t: 10, b: 26 };
  const totals = data.map((d) => series.reduce((a, s) => a + (d[s.key] || 0), 0));
  const max = niceMax(Math.max(1, ...totals));
  const ticks = ticksFor(max);
  const iw = Math.max(0, width - pad.l - pad.r);
  const ih = height - pad.t - pad.b;
  const band = data.length ? iw / data.length : 0;
  const bw = Math.min(36, band * 0.56);
  const y = (v) => pad.t + ih - (v / max) * ih;

  return (
    <div ref={ref} className="relative w-full" style={{ height }} onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Column chart">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth="1" />
              <text x={pad.l - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize="11" fill={AXIS_TEXT}>
                {Number.isInteger(t) ? t : ""}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx0 = pad.l + band * i + band / 2;
            const x = cx0 - bw / 2;
            let acc = 0;
            const segs = series.map((s, si) => {
              const v = d[s.key] || 0;
              if (!v) return null;
              const top = y(acc + v);
              const bottom = y(acc);
              acc += v;
              const isTop = series.slice(si + 1).every((n) => !(d[n.key] || 0));
              const h = bottom - top - (si > 0 ? 2 : 0); // 2px surface gap between stacked fills
              return isTop ? <path key={s.key} d={barPath(x, top, bw, h, 4)} fill={s.color} /> : <rect key={s.key} x={x} y={top} width={bw} height={Math.max(0, h)} fill={s.color} />;
            });
            const dim = hover !== null && hover !== i;
            return (
              <g key={i} opacity={dim ? 0.45 : 1} style={{ transition: "opacity 120ms" }}>
                {hover === i && <rect x={pad.l + band * i + 2} y={pad.t} width={band - 4} height={ih} rx="6" fill="#f1f5f9" />}
                {segs}
                {!totals[i] && <rect x={x} y={y(0) - 2} width={bw} height="2" rx="1" fill="#e2e8f0" />}
                <text x={cx0} y={height - 8} textAnchor="middle" fontSize="11" fill={highlight?.(d) ? "#0a2d4a" : AXIS_TEXT} fontWeight={highlight?.(d) ? 600 : 400}>
                  {xLabel(d)}
                </text>
                <rect x={pad.l + band * i} y={pad.t} width={band} height={ih + pad.b} fill="transparent" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${tipTitle(d)}: ${series.map((s) => `${s.label} ${d[s.key] || 0}`).join(", ")}`} />
              </g>
            );
          })}
        </svg>
      )}
      {hover !== null && data[hover] && (
        <Tooltip x={pad.l + band * hover + band / 2} y={y(totals[hover])} width={width}>
          <TipRows title={tipTitle(data[hover])} rows={series.map((s) => ({ label: s.label, value: data[hover][s.key] || 0, color: series.length > 1 ? s.color : null }))} />
        </Tooltip>
      )}
    </div>
  );
}

/** Line chart with soft area under the first series and a crosshair tooltip. */
export function LineChart({ data, series, xLabel, tipTitle, height = 220, labelEvery = 2 }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const pad = { l: 28, r: 10, t: 12, b: 26 };
  const max = niceMax(Math.max(1, ...data.flatMap((d) => series.map((s) => d[s.key] || 0))));
  const ticks = ticksFor(max);
  const iw = Math.max(0, width - pad.l - pad.r);
  const ih = height - pad.t - pad.b;
  const x = (i) => pad.l + (data.length > 1 ? (i / (data.length - 1)) * iw : iw / 2);
  const y = (v) => pad.t + ih - (v / max) * ih;
  const lines = useMemo(() => series.map((s) => data.map((d, i) => `${i ? "L" : "M"}${x(i)},${y(d[s.key] || 0)}`).join("")), [data, series, width]); // eslint-disable-line react-hooks/exhaustive-deps
  const area = lines[0] ? `${lines[0]}L${x(data.length - 1)},${y(0)}L${x(0)},${y(0)}Z` : "";
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const i = Math.round(((px - pad.l) / iw) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  };

  return (
    <div ref={ref} className="relative w-full" style={{ height }} onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} onMouseMove={onMove} role="img" aria-label="Line chart">
          <defs>
            <linearGradient id="lc-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={series[0].color} stopOpacity="0.16" />
              <stop offset="100%" stopColor={series[0].color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke={GRID} />
              <text x={pad.l - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize="11" fill={AXIS_TEXT}>
                {Number.isInteger(t) ? t : ""}
              </text>
            </g>
          ))}
          {data.map((d, i) =>
            i % labelEvery === (data.length - 1) % labelEvery ? (
              <text key={i} x={x(i)} y={height - 8} textAnchor={i === data.length - 1 ? "end" : i === 0 ? "start" : "middle"} fontSize="11" fill={AXIS_TEXT}>
                {xLabel(d)}
              </text>
            ) : null
          )}
          <path d={area} fill="url(#lc-area)" />
          {lines.map((p, si) => (
            <path key={series[si].key} d={p} fill="none" stroke={series[si].color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke="#cbd5e1" strokeDasharray="3 3" />
              {series.map((s) => (
                <circle key={s.key} cx={x(hover)} cy={y(data[hover][s.key] || 0)} r="4.5" fill={s.color} stroke="#fff" strokeWidth="2" />
              ))}
            </g>
          )}
        </svg>
      )}
      {hover !== null && data[hover] && (
        <Tooltip x={x(hover)} y={y(Math.max(...series.map((s) => data[hover][s.key] || 0)))} width={width}>
          <TipRows title={tipTitle(data[hover])} rows={series.map((s) => ({ label: s.label, value: data[hover][s.key] || 0, color: series.length > 1 ? s.color : null }))} />
        </Tooltip>
      )}
    </div>
  );
}

/** Horizontal bars as an HTML list (label · bar · value), optional 2-series stack. */
export function BarList({ items, series, onClick, empty = "No data yet" }) {
  const [hover, setHover] = useState(null);
  if (!items.length) return <p className="py-6 text-center text-sm text-slate-400">{empty}</p>;
  const max = Math.max(1, ...items.map((it) => series.reduce((a, s) => a + (it[s.key] || 0), 0)));
  return (
    <ul className="space-y-3">
      {items.map((it, i) => {
        const total = series.reduce((a, s) => a + (it[s.key] || 0), 0);
        const Comp = onClick ? "button" : "div";
        return (
          <li key={it.id || it.label} className="relative" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <Comp type={onClick ? "button" : undefined} onClick={onClick ? () => onClick(it) : undefined} className={cx("block w-full text-left", onClick && "rounded-md focus-visible:outline-2")}>
              <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px]">
                <span className="min-w-0 truncate font-medium text-slate-700">{it.label}</span>
                <span className="shrink-0 tabular-nums text-slate-500">
                  <span className="font-semibold text-navy">{total}</span>
                  {it.suffix ? ` ${it.suffix}` : ""}
                </span>
              </div>
              <div className="flex h-2 w-full gap-[2px] overflow-hidden rounded-full bg-slate-100">
                {series.map((s) => {
                  const v = it[s.key] || 0;
                  if (!v) return null;
                  return <span key={s.key} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(v / max) * 100}%`, background: s.color, opacity: hover !== null && hover !== i ? 0.5 : 1, transition: "opacity 120ms" }} />;
                })}
              </div>
            </Comp>
            {hover === i && series.length > 1 && (
              <div className="pointer-events-none absolute right-0 top-0 z-10 -translate-y-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-[0_8px_24px_-8px_rgba(15,23,42,0.25)]">
                <TipRows title={it.label} rows={series.map((s) => ({ label: s.label, value: it[s.key] || 0, color: s.color }))} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Headline percentage with a progress meter. */
export function Meter({ label, value, total, hint, color = SERIES.blue }) {
  const pct = total ? Math.round((value / total) * 100) : null;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[13px] font-medium text-slate-500">{label}</p>
        <p className="text-xs tabular-nums text-slate-500">
          {value}/{total}
        </p>
      </div>
      <p className="mt-1 text-2xl font-bold tracking-tight text-navy">{pct === null ? "—" : `${pct}%`}</p>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? 0} aria-label={label}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct ?? 0}%`, background: color }} />
      </div>
      {hint && <p className="mt-1.5 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

/** Tiny trend line for stat tiles (no axes; tooltip via title). */
export function Sparkline({ values, color = SERIES.blue, width = 96, height = 32 }) {
  if (!values?.length) return null;
  const max = Math.max(1, ...values);
  const x = (i) => (values.length > 1 ? (i / (values.length - 1)) * (width - 4) + 2 : width / 2);
  const y = (v) => height - 3 - (v / max) * (height - 6);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join("");
  return (
    <svg width={width} height={height} aria-hidden="true">
      <path d={`${d}L${x(values.length - 1)},${height}L${x(0)},${height}Z`} fill={color} opacity="0.1" />
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r="2.5" fill={color} />
    </svg>
  );
}
