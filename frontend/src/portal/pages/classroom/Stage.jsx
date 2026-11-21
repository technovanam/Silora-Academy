// ============================================================
// Live class: the video area – tiles and layouts (auto, tiled,
// spotlight, sidebar), pinning and the presentation (screen or
// whiteboard).
// ============================================================
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Hand, MicOff, MoreVertical, Pin, PinOff, Presentation } from "lucide-react";
import { Menu, cx } from "../../ui/index.jsx";
import { VideoView, useSpeaking } from "./media.jsx";

const AVATAR_COLORS = ["#1a73e8", "#e8710a", "#188038", "#d93025", "#9334e6", "#12a4af", "#c5221f", "#b06000", "#1967d2", "#e52592", "#0b8043", "#7b1fa2"];
export const colorFor = (name = "") => {
  let h = 5381;
  for (const c of name) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
};
export const initial = (name = "") => (name.trim().charAt(0) || "?").toUpperCase();

export function BigAvatar({ name, className }) {
  return (
    <span className={cx("flex aspect-square items-center justify-center rounded-full font-medium text-white", className)} style={{ background: colorFor(name) }}>
      {initial(name)}
    </span>
  );
}

const isTouch = () => typeof window !== "undefined" && window.matchMedia?.("(hover: none)").matches;

function useSize(ref) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

// The column count that gives the biggest 16:9 tiles in the space
function bestGrid(n, w, h, gap = 8) {
  let best = { cols: 1, rows: n, tw: 0, th: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    let tw = (w - gap * (cols - 1)) / cols;
    let th = tw * (9 / 16);
    if (th * rows + gap * (rows - 1) > h) {
      th = (h - gap * (rows - 1)) / rows;
      tw = th * (16 / 9);
    }
    if (tw > best.tw) best = { cols, rows, tw, th };
  }
  return best;
}

function SpeakingBars() {
  return (
    <span className="flex h-6 w-6 items-center justify-center gap-[2px] rounded-full bg-[#1a73e8]">
      {[0, 1, 2].map((i) => (
        <span key={i} className="live-bar w-[3px] rounded-full bg-white" style={{ animationDelay: `${i * 0.15}s` }} />
      ))}
    </span>
  );
}

/** One person (or the presentation). */
export function Tile({ t, pinned, onPin, menu, className, style, compact }) {
  const speaking = useSpeaking(t.audio, t.micOn !== false);
  useEffect(() => {
    if (speaking && t.kind !== "present") window.dispatchEvent(new CustomEvent("live:speaking", { detail: t.key }));
  }, [speaking, t.key, t.kind]);
  const items = [
    onPin && { label: pinned ? "Unpin" : "Pin to the screen", icon: pinned ? PinOff : Pin, onClick: () => onPin(pinned ? null : t.key) },
    ...(menu || []),
  ].filter(Boolean);
  return (
    <div
      style={style}
      className={cx(
        "group relative flex items-center justify-center overflow-hidden rounded-xl bg-[#3c4043] transition-shadow",
        speaking && "shadow-[inset_0_0_0_3px_#8ab4f8]",
        className
      )}
    >
      {t.kind === "present" ? (
        t.renderPresent?.()
      ) : t.video ? (
        <VideoView stream={t.video.stream} track={t.video.track} mirror={t.video.mirror} fit={t.video.fit} />
      ) : (
        <BigAvatar name={t.name} className={compact ? "w-[34%] max-w-[64px] text-xl" : "w-[26%] min-w-[44px] max-w-[132px] text-[clamp(1.25rem,4vw,3.25rem)]"} />
      )}

      {t.hand && (
        <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-xs font-semibold text-[#202124] shadow">
          <Hand className="h-3.5 w-3.5 text-[#e37400]" /> {compact ? "" : "Hand raised"}
        </span>
      )}
      <span className="absolute right-2 top-2 flex items-center gap-1">
        {t.micOn === false && t.kind !== "present" && (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black/50" title="Microphone off">
            <MicOff className="h-3.5 w-3.5 text-white" />
          </span>
        )}
        {speaking && t.micOn !== false && <SpeakingBars />}
      </span>
      {items.length > 0 && !(compact && isTouch()) && (
        <span className={cx("absolute right-2 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100", t.kind === "present" ? "bottom-2" : "top-10")}>
          <Menu
            trigger={
              <button type="button" aria-label={`Options for ${t.name}`} className="flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70">
                <MoreVertical className="h-4 w-4" />
              </button>
            }
            items={items}
          />
        </span>
      )}
      <span className={cx("absolute bottom-2 left-2 flex max-w-[calc(100%-56px)] items-center gap-1.5 truncate font-medium text-white [text-shadow:0_1px_2px_rgba(0,0,0,.8)]", compact ? "text-xs" : "text-sm", t.kind === "present" && "rounded-full bg-[#202124]/80 px-2.5 py-1 [text-shadow:none]")}>
        {pinned && <Pin className="h-3.5 w-3.5 shrink-0" />}
        {t.kind === "present" && <Presentation className="h-4 w-4 shrink-0" />}
        <span className="truncate">{t.label || t.name}</span>
      </span>
      {t.conn && <span className="absolute inset-x-0 bottom-8 mx-auto w-fit rounded-full bg-black/60 px-2.5 py-1 text-xs text-white">{t.conn}</span>}
    </div>
  );
}

function MoreTile({ count, names, onClick, compact }) {
  return (
    <button type="button" onClick={onClick} className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-xl bg-[#3c4043] text-white hover:bg-[#45494d]">
      <span className="flex -space-x-2">
        {names.slice(0, 2).map((n) => (
          <BigAvatar key={n} name={n} className={cx("ring-2 ring-[#3c4043]", compact ? "w-8 text-sm" : "w-12 text-lg")} />
        ))}
      </span>
      <span className={compact ? "text-xs" : "text-sm"}>{count} more</span>
    </button>
  );
}

/** Lay out the tiles for the chosen layout. */
export function Stage({ tiles, present, layout, pinned, onPin, maxTiles, menuFor, activeKey, onShowPeople }) {
  const box = useRef(null);
  const { w, h } = useSize(box);
  const mobile = w > 0 && w < 640;
  const all = present ? [present, ...tiles] : tiles;
  const pinnedTile = all.find((t) => t.key === pinned);
  let main = pinnedTile || null;
  if (!main && present && layout !== "tiled") main = present;
  if (!main && layout === "spotlight") main = tiles.find((t) => t.key === activeKey) || tiles.find((t) => t.isTeacher) || tiles[0];
  if (!main && layout === "sidebar" && tiles.length > 1) main = tiles.find((t) => t.key === activeKey) || tiles.find((t) => t.isTeacher) || tiles[0];

  const tileProps = (t, compact) => ({ t, compact, pinned: pinned === t.key, onPin, menu: menuFor?.(t) });

  if (main) {
    const rest = layout === "spotlight" ? [] : all.filter((t) => t !== main);
    const stripMax = mobile ? 3 : Math.max(1, Math.floor((h + 8) / (140 + 8)));
    const shown = rest.length > stripMax ? rest.slice(0, stripMax - 1) : rest;
    const hidden = rest.slice(shown.length);
    return (
      <div ref={box} className={cx("flex h-full min-h-0 w-full gap-2", mobile ? "flex-col" : "flex-row")}>
        <Tile {...tileProps(main)} className="min-h-0 min-w-0 flex-1" />
        {rest.length > 0 && (
          <div className={cx("flex shrink-0 gap-2", mobile ? "h-24 flex-row" : "w-56 flex-col xl:w-64")}>
            {shown.map((t) => (
              <Tile key={t.key} {...tileProps(t, true)} className={mobile ? "h-full w-32 shrink-0" : "aspect-video w-full shrink-0"} />
            ))}
            {hidden.length > 0 && (
              <div className={mobile ? "h-full w-32 shrink-0" : "aspect-video w-full shrink-0"}>
                <MoreTile count={hidden.length} names={hidden.map((t) => t.name)} onClick={onShowPeople} compact />
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  const limit = Math.max(1, mobile ? Math.min(maxTiles, 6) : maxTiles);
  const shown = all.length > limit ? all.slice(0, limit - 1) : all;
  const hidden = all.slice(shown.length);
  const n = shown.length + (hidden.length ? 1 : 0);
  const g = bestGrid(n, w, h);
  return (
    <div ref={box} className="flex h-full min-h-0 w-full items-center justify-center">
      {w > 0 && (
        <div className="grid justify-center gap-2" style={{ gridTemplateColumns: `repeat(${g.cols}, ${g.tw}px)`, gridAutoRows: `${g.th}px` }}>
          {shown.map((t) => (
            <Tile key={t.key} {...tileProps(t, g.tw < 260)} />
          ))}
          {hidden.length > 0 && <MoreTile count={hidden.length} names={hidden.map((t) => t.name)} onClick={onShowPeople} compact={g.tw < 260} />}
        </div>
      )}
    </div>
  );
}

/** The person talking the most recently (for spotlight / sidebar). */
export function useActiveSpeaker() {
  const [active, setActive] = useState(null);
  useEffect(() => {
    const on = (e) => setActive(e.detail);
    window.addEventListener("live:speaking", on);
    return () => window.removeEventListener("live:speaking", on);
  }, []);
  return active;
}
