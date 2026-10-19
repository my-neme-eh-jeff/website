/**
 * One file that runs twice: as a module <script> in the page, which starts a
 * worker from its own URL, and in that worker, which draws the desk's grid
 * with WebGL2 cell for cell over the text the page shipped.
 */
import {
  CABLE_END,
  GRIDS,
  KIND,
  MAT,
  SCENE,
  VIEW,
  lampBase,
  lampRest,
  occupancy,
  rasterize,
  standing,
  traceLines,
  type Pt,
} from "./desk";
import { AIM, decay, Rig } from "./lamp";
import { xray } from "./xray";

type Size = keyof typeof GRIDS;
type Rgb = [number, number, number];

type Msg =
  | { type: "init"; canvas: OffscreenCanvas; coarse: boolean; calm: boolean }
  | { type: "atlas"; bitmap: ImageBitmap; cellW: number; cellH: number }
  | {
      type: "layout";
      w: number;
      h: number;
      dpr: number;
      size: Size;
      art: [number, number, number, number];
      /** The top of the shell's middle: the desk scrolls up out of sight there. */
      clip: number;
      /** Scrolled by hand: the desk goes where the log is, without easing. */
      snap: boolean;
      /** The prompt's box and its corner radius, which the lamp's light catches; zero while hidden. */
      box: [number, number, number, number, number];
    }
  | {
      type: "colors";
      fg: Rgb;
      muted: Rgb;
      accent: Rgb;
      alt: Rgb;
      warm: Rgb;
      dark: boolean;
    }
  | { type: "state"; think?: boolean; flash?: boolean; clear?: boolean }
  | { type: "run"; on: boolean }
  | { type: "aim"; at: Pt | null }
  | { type: "lamp"; on: boolean }
  | { type: "hover"; on: boolean }
  | { type: "send" }
  | { type: "token" }
  | { type: "online"; on: boolean };

type Switch = { type: "switch"; size: Size; row: number; col: number; at: Pt };
type Out = "drawn" | "lost" | "calm" | "text" | Switch;

/** Printable ASCII, the atlas order: glyph index = char code - 32. */
const FIRST = 32;
const COUNT = 95;
/**
 * The calm level, once this device needed it, is remembered for a week. Text
 * is not: a weak visit starts calm and steps down again, so two unlucky loads
 * can't keep a device on text.
 */
const LEVEL = "desk:level";
/** A token's pulse runs the cable's length in this long, and its words fly out of the end. */
const DOWN_S = 0.95;
/** At most this often a pulse; the shader draws eight at once. */
const TOKEN_MS = 120;
/** The most light a shadow thrown from clear of the wall takes: it thins the pool, never blacks it out. */
const STAND_SHADE = 0.6;

declare global {
  interface Window {
    /** Set by the first run; a module runs once, so later visits call this. */
    deskLight?: () => void;
  }
}

if (typeof document === "undefined") worker();
else {
  window.deskLight = page;
  page();
}

function page() {
  const shell = document.querySelector<HTMLElement>("[data-shell]");
  if (!shell || shell.querySelector(".desk-light")) return;

  const canvas = document.createElement("canvas");
  canvas.className = "desk-light";
  canvas.setAttribute("aria-hidden", "true");
  let off: OffscreenCanvas;
  try {
    off = canvas.transferControlToOffscreen();
  } catch {
    return;
  }
  shell.append(canvas);

  let calm = false;
  try {
    const v = JSON.parse(localStorage.getItem(LEVEL) ?? "null") as {
      level: string;
      at: number;
    } | null;
    calm = v?.level === "calm" && Date.now() - v.at < 7 * 864e5;
  } catch {
    // No storage: start at the full level.
  }
  const coarse = matchMedia("(pointer: coarse)").matches;

  const w = new Worker(import.meta.url, { type: "module" });
  const post = (m: Msg, t: Transferable[] = []) => w.postMessage(m, t);
  post({ type: "init", canvas: off, coarse, calm }, [off]);

  const sw = shell.querySelector<HTMLButtonElement>(".lamp-switch");
  const composer = shell.querySelector<HTMLElement>(".term-composer");
  let switchAt: Switch | null = null;

  const stop = () => {
    io.disconnect();
    mo.disconnect();
    ro.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
    document.removeEventListener("themechange", colors);
    shell.removeEventListener("pointermove", onMove);
    shell.removeEventListener("pointerleave", onLeave);
    clearTimeout(flush);
    cancelAnimationFrame(flyFrame);
    flyers.clear();
    CSS.highlights?.delete("desk-coming");
    for (const f of shell.querySelectorAll(".desk-fly")) f.remove();
    w.terminate();
  };
  const lost = () => {
    shell.removeAttribute("data-lit");
    canvas.remove();
    stop();
  };
  // Stepping down to text after it has shown, the light fades out over the text.
  const dim = () => {
    if (!shell.hasAttribute("data-lit")) return lost();
    shell.setAttribute("data-dimming", "");
    shell.removeAttribute("data-lit");
    setTimeout(() => {
      lost();
      shell.removeAttribute("data-dimming");
    }, 600);
  };
  w.onmessage = (e: MessageEvent<Out>) => {
    const m = e.data;
    if (m === "drawn") {
      shell.setAttribute("data-lit", "");
      placeSwitch();
    } else if (m === "lost") lost();
    else if (m === "calm") {
      try {
        localStorage.setItem(
          LEVEL,
          JSON.stringify({ level: m, at: Date.now() }),
        );
      } catch {
        // Not remembered: the next visit steps down on its own.
      }
    } else if (m === "text") dim();
    else {
      switchAt = m;
      placeSwitch();
    }
  };
  w.onerror = lost;

  const visible = () =>
    [...shell.querySelectorAll<HTMLElement>("[data-desk-grid]")].find(
      (el) => el.offsetParent !== null,
    );

  /** The switch's button covers its three cells, and is never under 32x28. */
  const placeSwitch = () => {
    const pre = visible();
    // Its parent, not offsetParent: hidden until the desk is lit, it has none.
    const box = sw?.parentElement?.getBoundingClientRect();
    const at = switchAt;
    if (!sw || !pre || !box || !at || pre.dataset["deskGrid"] !== at.size)
      return;
    const { cols, rows } = GRIDS[at.size];
    const pr = pre.getBoundingClientRect();
    const cw = pr.width / cols;
    const ch = pr.height / rows;
    const bw = Math.max(32, 3 * cw + 8);
    const bh = Math.max(28, ch + 10);
    sw.style.left = `${pr.left - box.left + (at.col + 1.5) * cw - bw / 2}px`;
    sw.style.top = `${pr.top - box.top + (at.row + 0.5) * ch - bh / 2}px`;
    sw.style.width = `${bw}px`;
    sw.style.height = `${bh}px`;
  };

  let atlasKey = "";
  let atlasTimer = 0;
  const layout = () => {
    const pre = visible();
    if (!pre) return;
    const size = pre.dataset["deskGrid"] as Size;
    const { cols, rows } = GRIDS[size];
    const sr = shell.getBoundingClientRect();
    const pr = pre.getBoundingClientRect();
    if (!pr.width || !pr.height) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const mid = shell.querySelector(".desk-slot")?.parentElement;
    const log = shell.querySelector(".term-log");
    const cr = composer?.getBoundingClientRect();
    post({
      type: "layout",
      w: sr.width,
      h: sr.height,
      dpr,
      size,
      art: [pr.left - sr.left, pr.top - sr.top, pr.width, pr.height],
      clip: mid ? mid.getBoundingClientRect().top - sr.top : 0,
      // Following the newest line, the desk steps back smoothly; anywhere else, it was scrolled.
      snap: !!log && log.scrollHeight - log.scrollTop - log.clientHeight > 32,
      box:
        composer && cr?.width
          ? [
              cr.left - sr.left,
              cr.top - sr.top,
              cr.width,
              cr.height,
              parseFloat(getComputedStyle(composer).borderTopLeftRadius) || 0,
            ]
          : [0, 0, 0, 0, 0],
    });
    placeSwitch();
    const cellW = (pr.width / cols) * dpr;
    const cellH = (pr.height / rows) * dpr;
    const key = `${cellW.toFixed(1)}x${cellH.toFixed(1)}`;
    if (key === atlasKey) return;
    // While the desk steps back for the log, the worker stretches the old atlas;
    // a new one is drawn once it settles.
    clearTimeout(atlasTimer);
    atlasTimer = window.setTimeout(
      async () => {
        atlasKey = key;
        const fontPx = parseFloat(getComputedStyle(pre).fontSize) * dpr;
        const bitmap = await atlas(fontPx, cellW, cellH);
        post({ type: "atlas", bitmap, cellW, cellH }, [bitmap]);
      },
      atlasKey ? 160 : 0,
    );
  };

  const colors = () => {
    const cs = getComputedStyle(document.documentElement);
    const rgb = (name: string): Rgb => {
      const n = parseInt(cs.getPropertyValue(name).trim().slice(1), 16);
      return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    };
    const [r, g, b] = rgb("--sem-bg");
    const fg = rgb("--sem-text");
    post({
      type: "colors",
      fg,
      muted: rgb("--sem-muted"),
      accent: rgb("--sem-accent"),
      alt: rgb("--sem-alt"),
      warm: warmth(
        fg,
        ["--sem-cta", "--sem-accent", "--sem-alt", "--sem-danger"].map(rgb),
      ),
      dark: 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5,
    });
  };

  const state = () =>
    post({ type: "state", clear: shell.hasAttribute("data-desk-broken") });

  /*
   * A question goes up the cable. The answer comes down it a few words at a
   * time, and each piece drops from its end into its place in the line; until
   * it lands, a highlight paints its text transparent, so the terminal's DOM
   * is never touched. Once the first answer is in and has landed, the desk
   * breaks for the rest of the visit.
   */
  const live = shell.querySelector("[aria-live]");
  const hl = CSS.highlights ? new Highlight() : null;
  if (hl) CSS.highlights.set("desk-coming", hl);
  const lastAnswer = () => {
    const ai = live?.querySelectorAll('pre[data-kind="ai"]');
    return ai?.[ai.length - 1];
  };
  let asked = live?.querySelectorAll('pre[data-kind="in"]').length ?? 0;
  let answers = live?.querySelectorAll('pre[data-kind="ai"]').length ?? 0;
  let said = lastAnswer()?.textContent?.length ?? 0;
  let landed = said;
  let flying = 0;
  let tokenAt = 0;
  let flush = 0;
  let broken = shell.hasAttribute("data-desk-broken");
  const carrying = () => !!hl && !broken && shell.hasAttribute("data-lit");

  /** From character `i` of an element's text; null at or past its end. */
  const rangeAt = (el: Element, i: number) => {
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let t = walk.nextNode(); t; t = walk.nextNode()) {
      const n = (t as Text).length;
      if (i < n) {
        const r = document.createRange();
        r.setStart(t, i);
        return r;
      }
      i -= n;
    }
    return null;
  };
  const hide = () => {
    hl?.clear();
    const pre = lastAnswer();
    const r = pre && carrying() ? rangeAt(pre, landed) : null;
    if (!hl || !pre || !r) return;
    r.setEnd(pre, pre.childNodes.length);
    hl.add(r);
  };
  const breakDesk = () => {
    const len = lastAnswer()?.textContent?.length ?? 0;
    if (broken || flying || len > said || !shell.hasAttribute("data-answered"))
      return;
    broken = true;
    hide();
    setTimeout(() => shell.setAttribute("data-desk-broken", ""), 400);
  };
  const landWord = (gen: number, end: number) => {
    flying--;
    if (gen === answers) landed = Math.max(landed, end);
    hide();
    breakDesk();
  };
  /*
   * Each word heads for its character wherever that is now: new lines push the
   * log up while words are in the air, and a token can end mid-word, so the
   * rest of the word rewraps.
   */
  type Flyer = {
    el: HTMLElement;
    gen: number;
    at: number;
    end: number;
    t0: number;
    w: number;
  };
  const FLY_MS = 560;
  const flyers = new Set<Flyer>();
  let flyFrame = 0;
  const step = (now: number) => {
    flyFrame = 0;
    const pre = lastAnswer();
    const sr = shell.getBoundingClientRect();
    const pr = visible()?.getBoundingClientRect();
    for (const f of flyers) {
      const t = (now - f.t0) / FLY_MS;
      const at =
        pre && f.gen === answers && carrying() ? rangeAt(pre, f.at) : null;
      if (!at || !pr || t >= 1) {
        f.el.remove();
        flyers.delete(f);
        landWord(f.gen, f.end);
        continue;
      }
      at.setEnd(at.startContainer, at.startOffset + 1);
      const to = at.getBoundingClientRect();
      // Out of the cable's end, but never past the shell's right edge.
      const x0 = Math.min(
        pr.left - sr.left + ((CABLE_END[0] - VIEW.x) / VIEW.w) * pr.width,
        sr.width - f.w - 16,
      );
      const y0 =
        pr.top -
        sr.top +
        ((CABLE_END[1] - VIEW.y) / VIEW.h) * pr.height -
        to.height;
      const x1 = to.left - sr.left;
      const y1 = to.top - sr.top;
      const cx = x0 + (x1 - x0) * 0.3;
      const cy = Math.min(y0, y1) - 40;
      const k = Math.max(0, t);
      const p = k * k * (3 - 2 * k);
      const q = 1 - p;
      const x = q * q * x0 + 2 * q * p * cx + p * p * x1;
      const y = q * q * y0 + 2 * q * p * cy + p * p * y1;
      const s = k < 0.35 ? 0.5 + k : 0.85 + (0.15 * (k - 0.35)) / 0.65;
      f.el.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
      f.el.style.opacity = String(Math.min(1, k / 0.35));
    }
    if (flyers.size) flyFrame = requestAnimationFrame(step);
  };
  const fly = (gen: number, from: number, to: number) => {
    const pre = lastAnswer();
    const words = [
      ...(pre?.textContent?.slice(from, to) ?? "").matchAll(/\S+/g),
    ];
    if (!pre || !visible() || !words.length || gen !== answers || !carrying())
      return landWord(gen, to);
    flying += words.length - 1;
    const cs = getComputedStyle(pre);
    // Spread under TOKEN_MS, so words still land in order.
    const gap = 90 / words.length;
    const now = performance.now();
    words.forEach((m, i) => {
      const el = document.createElement("span");
      el.className = "desk-fly";
      el.setAttribute("aria-hidden", "true");
      el.textContent = m[0];
      el.style.fontFamily = cs.fontFamily;
      el.style.fontSize = cs.fontSize;
      el.style.lineHeight = cs.lineHeight;
      el.style.opacity = "0";
      shell.append(el);
      const next = words[i + 1];
      flyers.add({
        el,
        gen,
        at: from + m.index,
        end: next ? from + next.index : to,
        t0: now + i * gap,
        w: el.offsetWidth,
      });
    });
    if (!flyFrame) flyFrame = requestAnimationFrame(step);
  };
  const send = (len: number) => {
    clearTimeout(flush);
    tokenAt = performance.now();
    post({ type: "token" });
    const from = said;
    said = len;
    if (!carrying()) {
      landed = len;
      return;
    }
    flying++;
    const gen = answers;
    setTimeout(() => fly(gen, from, len), DOWN_S * 1020);
  };
  const watchChat = () => {
    if (!live) return;
    const n = live.querySelectorAll('pre[data-kind="in"]').length;
    if (n > asked && !broken) post({ type: "send" });
    asked = n;
    const count = live.querySelectorAll('pre[data-kind="ai"]').length;
    if (count !== answers) {
      answers = count;
      said = 0;
      landed = 0;
    }
    const len = lastAnswer()?.textContent?.length ?? 0;
    if (len > said && !broken) {
      const wait = TOKEN_MS - (performance.now() - tokenAt);
      clearTimeout(flush);
      if (wait <= 0) send(len);
      else flush = window.setTimeout(watchChat, wait);
    } else if (len < said) said = landed = len;
    hide();
    breakDesk();
  };

  let down = shell.hasAttribute("data-desk-down");
  if (down) post({ type: "online", on: false });
  let busy = shell.hasAttribute("data-busy");
  let up = shell.style.getPropertyValue("--desk-up");
  const mo = new MutationObserver(() => {
    const now = shell.hasAttribute("data-busy");
    if (now !== busy) post({ type: "state", think: now, flash: busy && !now });
    busy = now;
    const d = shell.hasAttribute("data-desk-down");
    if (d !== down) post({ type: "online", on: !d });
    down = d;
    // The desk scrolled up with the log: the light draws it where it now is.
    const u = shell.style.getPropertyValue("--desk-up");
    if (u !== up) {
      up = u;
      layout();
    }
    watchChat();
    state();
  });
  mo.observe(shell, {
    attributes: true,
    subtree: true,
    childList: true,
    characterData: true,
  });

  const toDrawing = (x: number, y: number): Pt | null => {
    const pre = visible();
    if (!pre) return null;
    const r = pre.getBoundingClientRect();
    return [
      VIEW.x + ((x - r.left) / r.width) * VIEW.w,
      VIEW.y + ((y - r.top) / r.height) * VIEW.h,
    ];
  };
  let held = false;
  const hold = (on: boolean) => {
    if (on === held) return;
    held = on;
    post({ type: "hover", on });
  };
  /*
   * To its right the lamp would turn its back to follow the pointer, so there
   * it lets go as if the pointer had left: seen from its pivot, from 68deg
   * above the horizon round to 28deg past straight down. Once let go, the
   * pointer comes back 6deg further before the lamp picks it up again.
   */
  let away = false;
  const behind = (P: Pt) => {
    if (!switchAt) return false;
    const [x, y] = switchAt.at;
    const pivotY = y - VIEW.h / GRIDS[switchAt.size].rows;
    const deg = (Math.atan2(P[1] - pivotY, P[0] - x) * 180) / Math.PI;
    const m = away ? 6 : 0;
    return deg > -68 - m && deg < 118 + m;
  };
  // Near its switch the lamp holds still, so the switch stays where you reach for it.
  const onMove = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    const P = toDrawing(e.clientX, e.clientY);
    if (!P) return;
    const near =
      !!switchAt &&
      Math.abs(P[0] - switchAt.at[0]) < 30 &&
      Math.abs(P[1] - switchAt.at[1]) < 20;
    hold(near);
    if (near) return;
    const was = away;
    away = behind(P);
    if (!away) post({ type: "aim", at: P });
    else if (!was) post({ type: "aim", at: null });
  };
  const onLeave = () => {
    hold(false);
    away = false;
    post({ type: "aim", at: null });
  };
  shell.addEventListener("pointermove", onMove, { passive: true });
  shell.addEventListener("pointerleave", onLeave, { passive: true });

  if (sw) {
    let on = true;
    let keys: Pt = [...AIM];
    sw.addEventListener("click", () => {
      on = !on;
      sw.setAttribute("aria-pressed", String(on));
      post({ type: "lamp", on });
    });
    sw.addEventListener("focus", () => hold(true));
    sw.addEventListener("blur", onLeave);
    sw.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 48 : 20;
      const m = (
        {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, -step],
          ArrowDown: [0, step],
        } as Record<string, Pt>
      )[e.key];
      if (!m) return;
      e.preventDefault();
      keys = [
        Math.min(VIEW.x + VIEW.w, Math.max(VIEW.x, keys[0] + m[0])),
        Math.min(VIEW.y + VIEW.h, Math.max(VIEW.y, keys[1] + m[1])),
      ];
      post({ type: "aim", at: keys });
    });
  }

  let shown = !document.hidden;
  let onScreen = true;
  const run = () => post({ type: "run", on: shown && onScreen });
  const io = new IntersectionObserver(([e]) => {
    // Gone after a client-side navigation away; the next visit starts its own.
    if (!shell.isConnected) return stop();
    onScreen = !!e?.isIntersecting;
    run();
  });
  io.observe(shell);
  const onVisibility = () => {
    shown = !document.hidden;
    run();
  };
  document.addEventListener("visibilitychange", onVisibility);

  document.addEventListener("themechange", colors);
  const ro = new ResizeObserver(() => layout());
  ro.observe(shell);
  const slot = shell.querySelector(".desk-slot");
  if (slot) ro.observe(slot);
  // It grows when the intro folds away, which moves where the desk is clipped.
  if (slot?.parentElement) ro.observe(slot.parentElement);
  // The prompt's box can move or hide while the shell keeps its size.
  if (composer) ro.observe(composer);

  colors();
  state();
  void document.fonts.load('16px "Fira Mono"').then(layout, layout);
}

/** The light's colour: the warmest of the palette's inks, half mixed into the text. */
function warmth(fg: Rgb, inks: Rgb[]): Rgb {
  let best: Rgb | null = null;
  let bestD = 36;
  for (const [r, g, b] of inks) {
    const mx = Math.max(r, g, b);
    const d = mx - Math.min(r, g, b);
    if (d < 40 / 255) continue;
    const h =
      mx === r
        ? ((g - b) / d) % 6
        : mx === g
          ? (b - r) / d + 2
          : (r - g) / d + 4;
    const hue = (h * 60 + 360) % 360;
    const dist = Math.min(Math.abs(hue - 42), 360 - Math.abs(hue - 42));
    if (dist < bestD) {
      bestD = dist;
      best = [r, g, b];
    }
  }
  return best
    ? ([0, 1, 2].map((k) => fg[k]! * 0.45 + best![k]! * 0.55) as Rgb)
    : fg;
}

/** Each glyph drawn where the page's text would put it in its cell. */
async function atlas(fontPx: number, cellW: number, cellH: number) {
  await document.fonts.load(`${fontPx}px "Fira Mono"`).catch(() => {});
  const c = document.createElement("canvas");
  c.width = Math.ceil(cellW * COUNT);
  c.height = Math.ceil(cellH);
  const g = c.getContext("2d")!;
  g.font = `${fontPx}px "Fira Mono", ui-monospace, monospace`;
  g.fillStyle = "#fff";
  g.textBaseline = "alphabetic";
  const m = g.measureText("M");
  const ascent = m.fontBoundingBoxAscent;
  const descent = m.fontBoundingBoxDescent;
  const baseline = (cellH - (ascent + descent)) / 2 + ascent;
  for (let i = 0; i < COUNT; i++) {
    g.fillText(String.fromCharCode(FIRST + i), i * cellW, baseline);
  }
  return createImageBitmap(c);
}

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 uRes;
uniform vec4 uArt;
uniform vec2 uCell;
uniform vec2 uGrid;
uniform vec2 uSlot;
uniform float uRadius;
uniform float uClip;
uniform float uDpr;
uniform float uTime;
uniform float uClear;
uniform float uThink;
uniform float uFlash;
uniform float uHead;
uniform float uLed;
uniform float uDark;
uniform float uCalm;
uniform vec3 uFg;
uniform vec3 uMuted;
uniform vec3 uAccent;
uniform vec3 uAlt;
uniform vec3 uWarm;
uniform vec2 uBulb;
uniform vec2 uDir;
uniform float uPower;
uniform vec2 uSwitch;
uniform float uSwitchGlow;
uniform vec4 uBox;
uniform float uBoxR;
uniform vec4 uPulse[8];
uniform float uLc;
uniform float uFan;
uniform float uLoad;
uniform float uMeters;
uniform sampler2D uMask;
uniform sampler2D uGlow;
uniform sampler2D uAtlas;
uniform sampler2D uAux;
uniform sampler2D uOver;
uniform sampler2D uShadow;
uniform vec4 uSView;
// Per cell: R its material, so the mug's ceramic stays smooth.
uniform sampler2D uExtra;
// Whether the desk's model answers, eased: the LED is lit only while it does.
uniform float uOnline;
// Things standing clear of the wall: back and front as fractions of the way
// to the bulb, the most light their shadow takes, and 1 if there are any.
uniform vec4 uStand;
// The book title's middle, and 1 if there is one: it reads as a whole, lit as its middle is.
uniform vec3 uTitle;
out vec4 outColor;

const vec4 VIEW = vec4(${VIEW.x}.0, ${VIEW.y}.0, ${VIEW.w}.0, ${VIEW.h}.0);
const float COS_IN = ${Math.cos((19 * Math.PI) / 180)};
const float COS_OUT = ${Math.cos((31 * Math.PI) / 180)};
const float COS_WIDE = ${Math.cos((52 * Math.PI) / 180)};
const float DEPTH = 34.0 / 64.0;
const float BAYER[16] = float[16](0.03125, 0.53125, 0.15625, 0.65625, 0.78125, 0.28125, 0.90625, 0.40625, 0.21875, 0.71875, 0.09375, 0.59375, 0.96875, 0.46875, 0.84375, 0.34375);
const float FAN[4] = float[4](92.0, 15.0, 13.0, 60.0);

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float hash31(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash31(i), hash31(i + vec3(1, 0, 0)), u.x),
        mix(hash31(i + vec3(0, 1, 0)), hash31(i + vec3(1, 1, 0)), u.x), u.y),
    mix(mix(hash31(i + vec3(0, 0, 1)), hash31(i + vec3(1, 0, 1)), u.x),
        mix(hash31(i + vec3(0, 1, 1)), hash31(i + vec3(1, 1, 1)), u.x), u.y),
    u.z);
}
float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
float perim(vec2 p, vec2 size) {
  float w = size.x, h = size.y;
  float dl = p.x, dr = w - p.x, dt = p.y, db = h - p.y;
  float m = min(min(dl, dr), min(dt, db));
  float s;
  if (m == dt) s = clamp(p.x, 0.0, w);
  else if (m == dr) s = w + clamp(p.y, 0.0, h);
  else if (m == db) s = w + h + (w - clamp(p.x, 0.0, w));
  else s = 2.0 * w + h + (h - clamp(p.y, 0.0, h));
  return s / (2.0 * (w + h));
}
float glyph(float gi, vec2 f) {
  return texture(uAtlas, vec2((gi + f.x) * uSlot.x, f.y * uSlot.y)).a;
}
vec3 inkOf(float k) {
  return k < 0.5 ? uFg : k < 1.5 ? uMuted : k < 2.5 ? uAccent : k < 3.5 ? uAlt : uWarm;
}
// Signed distance to the nearest solid thing, in drawing units, negative inside.
float sdAt(vec2 d) {
  return texture(uShadow, (d - uSView.xy) / uSView.zw).r * 80.0 - 24.0;
}
// Soft shadow from d toward the bulb, as far as tMax drawing units: sphere
// traced on the distance field, so thin legs aren't stepped over, and the
// penumbra widens with the distance from d to whatever blocks (k is the
// lamp's apparent size). Returns how much light is blocked, 0 to 1, and in
// tHit how far from d the blocker is.
float castShadow(vec2 d, float tMax, float k, int steps, out float tHit) {
  vec2 toB = uBulb - d;
  float len = length(toB);
  vec2 dir = toB / max(len, 1e-3);
  tMax = min(tMax, len - 4.0);
  float res = 1.0;
  float t = 1.5;
  tHit = tMax;
  for (int i = 0; i < 16; i++) {
    if (i >= steps || t >= tMax) break;
    float h = sdAt(d + dir * t);
    float r = h / (k * t);
    if (r < res) { res = r; tHit = t; }
    if (res < -1.0) break;
    t += clamp(h, 1.0 + 0.5 * k * t, 40.0);
  }
  res = max(res, -1.0);
  return 1.0 - 0.25 * (1.0 + res) * (1.0 + res) * (2.0 - res);
}
float sdStand(vec2 d) {
  return texture(uShadow, (d - uSView.xy) / uSView.zw).g * 80.0 - 24.0;
}
// The same trace against what stands clear of the wall, over only the stretch
// of the ray at its depth. A high bulb's ray is already above it there, so its
// shadow falls on the desk top; a low one's passes through it, onto the wall.
float standShadow(vec2 d, float k, int steps, out float tHit) {
  vec2 toB = uBulb - d;
  float len = length(toB);
  vec2 dir = toB / max(len, 1e-3);
  float t = max(1.5, uStand.x * len);
  float tMax = min(uStand.y * len, len - 4.0);
  float res = 1.0;
  tHit = tMax;
  for (int i = 0; i < 16; i++) {
    if (i >= steps || t >= tMax) break;
    float h = sdStand(d + dir * t);
    float r = h / (k * t);
    if (r < res) { res = r; tHit = t; }
    if (res < -1.0) break;
    t += clamp(h, 1.0 + 0.5 * k * t, 40.0);
  }
  res = max(res, -1.0);
  return 1.0 - 0.25 * (1.0 + res) * (1.0 + res) * (2.0 - res);
}
// How much of a wall cell's light the solid things take: each fills the space
// from the wall out to its face, so the shadow starts at its feet, sharp there
// and softer further out, and thrown far it fills with the room's light.
float grounded(vec2 d) {
  float tHit;
  // Calm takes fewer steps, but enough to reach the desk top from under it.
  float s = castShadow(d, DEPTH * length(uBulb - d), 0.12, uCalm > 0.5 ? 6 : 10, tHit);
  s *= 1.0 - 0.55 * smoothstep(50.0, 200.0, tHit);
  if (uStand.w > 0.5) {
    float f = standShadow(d, 0.12, uCalm > 0.5 ? 4 : 8, tHit) * uStand.z;
    f *= 1.0 - 0.55 * smoothstep(50.0, 200.0, tHit);
    s = 1.0 - (1.0 - s) * (1.0 - f);
  }
  return s;
}
float cone(vec2 d) {
  vec2 v = d - uBulb;
  float dist = length(v) + 1e-3;
  float k = dist / 165.0;
  return smoothstep(COS_OUT, COS_IN, dot(v, uDir) / dist) * uPower / (1.0 + k * k);
}
// Wider and softer than the cone, so the light carries to the far side of the shell.
float spill(vec2 d) {
  vec2 v = d - uBulb;
  float dist = length(v) + 1e-3;
  float k = dist / 300.0;
  return smoothstep(COS_WIDE, COS_IN, dot(v, uDir) / dist) * 0.27 * uPower / (1.0 + k * k);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec4 col = vec4(0.0);
  vec2 size = uRes;
  float frame = sdRoundBox(p - 0.5 * size, 0.5 * size - 0.75 * uDpr, uRadius);
  float dark = uDark > 0.5 ? 1.0 : 0.0;
  float keep = 1.0 - uClear;

  vec2 q = (p - uArt.xy) / uCell;
  // The lamp lights the whole shell, on the drawing and off it, in the drawing's units.
  vec2 dp = VIEW.xy + q * VIEW.zw / uGrid;
  bool on = keep > 0.001 && uPower > 0.01;
  float reach = on ? cone(dp) + spill(dp) : 0.0;
  // Shadowed per pixel as well, with a short trace, so a shadow reads as a
  // shape across the wall, the floor and the prompt, not only as missing dots.
  if (uCalm < 0.999 && reach * mix(0.054, 0.14, dark) > 0.002) {
    float wall = smoothstep(0.0, 3.0, sdAt(dp)) * (1.0 - uCalm);
    if (wall > 0.0) {
      float hh;
      float sh = castShadow(dp, DEPTH * length(uBulb - dp), 0.16, 5, hh);
      if (uStand.w > 0.5) {
        float f = standShadow(dp, 0.16, 4, hh) * uStand.z * smoothstep(0.0, 3.0, sdStand(dp));
        sh = 1.0 - (1.0 - sh) * (1.0 - f);
      }
      reach *= 1.0 - 0.85 * wall * sh;
    }
  }
  float haze = 0.0;
  // The bulb's own glow goes with the lamp when it scrolls up out of sight; its light stays.
  if (on && uCalm < 0.999)
    haze = (1.0 - uCalm) * clamp((reach * mix(0.054, 0.14, dark)
        + exp(-length(dp - uBulb) / 9.0) * uPower * mix(0.36, 0.8, dark)
          * smoothstep(uClip, uClip + 20.0 * uDpr, p.y)) * keep, 0.0, 1.0)
      * (1.0 - smoothstep(-0.5 * uDpr, 0.5 * uDpr, frame));
  // The pool's dither thins out toward the drawing's bottom, so it has no edge there.
  float low = smoothstep(uGrid.y, uGrid.y - 5.0, q.y);

  // Fully broken, the desk has nothing left to draw. Scrolled up, it fades out at the clip.
  if (uClear < 0.999 && p.y > uClip
      && q.x >= 0.0 && q.y >= 0.0 && q.x < uGrid.x && q.y < uGrid.y) {
    vec2 cell = floor(q);
    vec2 f = fract(q);
    vec2 uv = (cell + 0.5) / uGrid;
    vec4 mk = texture(uMask, uv);
    vec4 ax = texture(uAux, uv);
    vec4 ov = texture(uOver, uv);
    float mat = floor(texture(uExtra, uv).r * 255.0 + 0.5);
    float gi = floor(mk.r * 255.0 + 0.5);
    float kind = floor(mk.g * 255.0 + 0.5);
    float dens = mk.b;
    float along = floor(mk.a * 255.0 + 0.5);
    vec2 d = VIEW.xy + (cell + 0.5) * VIEW.zw / uGrid;

    // The lamp: a cone from the bulb, and a wall cell's shadow.
    float L = 0.0;
    float shade = 0.0;
    if (uPower > 0.01) {
      L = cone(d);
      if (L < 0.012) L = 0.0;
      else if (kind == 0.0 && ax.r < 0.5) {
        float s = grounded(d);
        shade = L * s;
        L *= 1.0 - s;
      }
    }
    // Lit, the room shows around the lamp's pool; off, the LED and not much else.
    float ambient = mix(mix(0.5, 0.4, dark), mix(0.74, 0.66, dark), uPower);
    float th = BAYER[(int(cell.y) & 3) * 4 + (int(cell.x) & 3)];

    float n = vnoise(vec3(cell.x * 0.09, cell.y * 0.18, uTime * 0.35));
    float scan = (mod(uTime * 0.07, 1.6) - 0.3) * uGrid.x;
    float band = exp(-pow((cell.x - scan) * 0.5, 2.0) / 30.0);

    vec3 gc = uFg;
    float a = 1.0;
    if (kind == ${KIND.fill}.0) {
      float v = dens * (0.7 + 0.8 * n) * (1.0 + 1.2 * L);
      gi = v > 0.33 ? 13.0 : v > 0.24 ? 26.0 : v > 0.14 ? 14.0 : 0.0;
      // Ceramic stays smooth: dots, never dashes.
      if (mat == ${MAT.ceramic}.0) gi = v > 0.24 ? 26.0 : v > 0.14 ? 14.0 : 0.0;
      gc = mix(uMuted, uWarm, L * 0.8);
      a = min(1.0, ambient + L * 1.2);
    } else if (kind == ${KIND.steam}.0) {
      // Wisps: ( and ) swap a row at a time going up, so the steam rises; it thins as it goes.
      float ph = cell.y + uTime * 1.6 + floor(cell.x * 0.5) * 0.5;
      float w = vnoise(vec3(cell.x * 0.9, cell.y * 0.6 + uTime * 1.1, uTime * 0.3));
      gi = mod(floor(ph), 2.0) < 1.0 ? 8.0 : 9.0;
      if (w < 0.32) gi = w < 0.22 ? 0.0 : 14.0;
      gc = mix(uMuted, uWarm, L);
      a = min(1.0, (ambient * 0.85 + L * 1.6) * (0.55 + 0.45 * w));
    } else if (kind == ${KIND.note}.0) {
      gc = uMuted;
      a = ambient + (1.0 - ambient) * clamp(L * 1.7, 0.0, 1.0);
    } else if (kind == ${KIND.led}.0) {
      // Online it breathes in the accent; offline it's a dull dot.
      gc = mix(uMuted, uAccent, uOnline);
      a = mix(0.32, 0.3 + 0.7 * uLed, uOnline);
    } else if (kind == ${KIND.line}.0 || kind == ${KIND.joint}.0) {
      gc = mix(mix(uFg, uAccent, smoothstep(0.3, 0.75, band)), uWarm, clamp(L * 1.3, 0.0, 0.9));
      a = ambient + (1.0 - ambient) * clamp(L * 1.7, 0.0, 1.0);
    } else if (dark > 0.5 && L * low * 1.15 > th && ax.r < 0.5) {
      // Ordered dither, so the pool of light reads as a gradient, not noise.
      // A solid thing's face isn't wall: the pool stops at its outline.
      gi = L * low * 1.15 > th + 0.55 ? 26.0 : 14.0;
      gc = uWarm;
      a = 0.14 + L * 0.7;
    } else if (dark < 0.5 && shade * 1.5 > th) {
      // On paper the light is the clean page, and shadow is hatched.
      gi = 15.0;
      gc = uMuted;
      a = 0.25 + shade * 0.6;
    }
    if (kind == 0.0 && gi == 0.0 && uCalm < 0.5 && L > 0.07
        && hash21(cell + floor(uTime * 0.8) * 7.31) > 0.985) {
      // Dust, only where the light falls on it.
      gi = hash21(cell * 1.7) > 0.6 ? 10.0 : 14.0;
      gc = uWarm;
      a = min(1.0, L * 2.4);
    }
    if (ax.a > 0.5) gi = 0.0;

    // The cable: each pulse a bright head and a fading tail along it.
    if (along < 254.5) {
      float s = along / 254.0 * uLc;
      float I = 0.0;
      for (int k = 0; k < 8; k++) {
        vec4 P = uPulse[k];
        if (P.z <= 0.0) continue;
        float dd = (s - P.x) * P.y;
        I += P.z * (dd > 0.0 ? exp(-(dd / 6.0) * (dd / 6.0)) : exp(dd / P.w));
      }
      I = min(I, 1.2);
      if (I > 0.04) {
        gi = I > 0.85 ? 32.0 : I > 0.5 ? 10.0 : I > 0.3 ? 79.0 : gi;
        gc = uAccent;
        a = min(1.0, 0.35 + I);
      }
    }

    // Inside the box, where the light is strong enough to see through.
    float xg = floor(ax.g * 255.0 + 0.5);
    int xb = int(floor(ax.b * 255.0 + 0.5));
    // A title on a spine (ink 5) fades in and out as a whole with the light on
    // its middle, where the x-ray dithers in cell by cell: half a word reads as cut off.
    bool title = xg > 1.5 && (xb & 7) == 5;
    bool seen = !title && xg > 0.5 && smoothstep(0.08, 0.22, L) > th;
    vec2 gf = f;
    if (title) {
      // Half a row low, midway between the spine's edges; its lower half is drawn by the row below.
      gf.y = f.y - 0.5;
      float Lt = uPower > 0.01 ? cone(uTitle.xy) : 0.0;
      float k = smoothstep(0.04, 0.16, Lt);
      if (k > 0.02) {
        gi = xg - 2.0;
        gc = mix(uFg, uWarm, Lt * 0.5);
        a = k * min(1.0, 0.45 + Lt * 1.6);
      }
    } else if (seen) {
      if (xg < 1.5) gi = 0.0;
      else {
        gi = xg - 2.0;
        gc = inkOf(float(xb & 7));
        if ((xb & 8) != 0) gi = FAN[int(floor(uFan + cell.x * 0.37)) & 3];
        if ((xb & 16) != 0) {
          bool on = float(xb >> 5) < floor(uLoad * uMeters + 0.5);
          gi = on ? 29.0 : 13.0;
          gc = on ? uAlt : uMuted;
        }
        gc = mix(gc, uWarm, L * 0.5);
        a = min(1.0, 0.45 + L * 1.6);
      }
    }

    // The lamp itself, the panel's trace and the heat, drawn by the worker.
    // Flags: 1 takes the lamp's light, 2 gives way to the inside of the box.
    float og = floor(ov.r * 255.0 + 0.5);
    float of = floor(ov.a * 255.0 + 0.5);
    if (og > 0.5 && !(seen && of > 1.5)) {
      gi = og - 1.0;
      gc = inkOf(floor(ov.g * 255.0 + 0.5));
      if (mod(of, 2.0) > 0.5) gc = mix(gc, uWarm, clamp(L * 0.6, 0.0, 0.6));
      a = ov.b;
    }

    float h = hash21(cell + 7.0);
    float crumble = 0.08 * min(1.0, uClear * 10.0);
    if (h < uClear) gi = 0.0;
    else if (h < uClear + crumble && gi > 0.0) { gi = 14.0; gc = uMuted; }

    if (uCalm < 0.999) {
      vec2 gl2 = texture(uGlow, q / uGrid).rg * keep * (1.0 - uCalm);
      // The LED's halo stays under the scan band's, and goes out with the desk.
      float glow = gl2.r * (0.35 + 0.65 * band) * mix(0.06, 0.14, dark) * ambient
        + gl2.g * uLed * uOnline * mix(0.1, 0.16, dark);
      col = vec4(uAccent, 1.0) * clamp(glow, 0.0, 1.0);
      if (uSwitchGlow > 0.0) {
        float sg = clamp(exp(-length((dp - uSwitch) * vec2(1.0, 1.6)) / 7.0) * uSwitchGlow * keep * (1.0 - uCalm), 0.0, 1.0);
        col = vec4(uAccent, 1.0) * sg + col * (1.0 - sg);
      }
    }

    float ga = gi > 0.0 && gf.y >= 0.0 ? glyph(gi, gf) * a : 0.0;
    col = vec4(gc, 1.0) * ga + col * (1.0 - ga);
    if (uTitle.z > 0.5 && uPower > 0.01 && f.y < 0.5) {
      vec4 au = texture(uAux, (cell + vec2(0.5, -0.5)) / uGrid);
      float ug = floor(au.g * 255.0 + 0.5);
      if (ug > 1.5 && (int(floor(au.b * 255.0 + 0.5)) & 7) == 5) {
        float Lt = cone(uTitle.xy);
        float ta = glyph(ug - 2.0, vec2(f.x, f.y + 0.5)) * smoothstep(0.04, 0.16, Lt) * min(1.0, 0.45 + Lt * 1.6);
        col = vec4(mix(uFg, uWarm, Lt * 0.5), 1.0) * ta + col * (1.0 - ta);
      }
    }
    col *= smoothstep(uClip, uClip + 20.0 * uDpr, p.y);
  } else if (reach > 0.0 && p.y > uClip && q.y >= 0.0 && q.y < uGrid.y) {
    // Either side of the drawing the wall carries on, its pool and shadows with it.
    vec2 cell = floor(q);
    vec2 cd = VIEW.xy + (cell + 0.5) * VIEW.zw / uGrid;
    float L = cone(cd) * smoothstep(12.0 * uDpr, 40.0 * uDpr, min(p.x, uRes.x - p.x));
    if (L >= 0.012 && hash21(cell + 7.0) >= uClear) {
      float s = grounded(cd);
      float shade = L * s;
      L *= 1.0 - s;
      // Offset, so the Bayer index never comes from a negative cell.
      ivec2 ci = ivec2(cell) + 4096;
      float th = BAYER[(ci.y & 3) * 4 + (ci.x & 3)];
      if (dark > 0.5 && L * low * 1.15 > th)
        col = vec4(uWarm, 1.0) * glyph(L * low * 1.15 > th + 0.55 ? 26.0 : 14.0, fract(q))
          * (0.14 + L * 0.7);
      else if (dark < 0.5 && shade * 1.5 > th)
        col = vec4(uMuted, 1.0) * glyph(15.0, fract(q)) * (0.25 + shade * 0.6);
    }
  }
  // Under all of it, the lamp's haze.
  col += vec4(uWarm, 1.0) * haze * (1.0 - col.a);

  // The prompt's box catches the light on its border.
  if (dark > 0.5 && uBox.z > 0.0 && reach > 0.0) {
    float db = sdRoundBox(p - uBox.xy - 0.5 * uBox.zw, 0.5 * uBox.zw - 0.5 * uDpr,
      max(uBoxR - 0.5 * uDpr, 0.0));
    float ba = (1.0 - smoothstep(0.4 * uDpr, 1.2 * uDpr, abs(db)))
      * clamp(reach * 2.4, 0.0, 0.85) * keep;
    col = vec4(uWarm, 1.0) * ba + col * (1.0 - ba);
  }

  // So does the shell's frame: warmer there, and whole.
  float caught = clamp(reach * 2.4, 0.0, 1.0) * keep;
  float s = perim(p, size);
  float along = s * 2.0 * (size.x + size.y) / uDpr;

  float ds = fract(s - uHead + 0.5) - 0.5;
  float comet = 0.5 * exp(-pow(ds / 0.012, 2.0));
  comet += ds < 0.0 ? 0.25 * exp(ds / 0.1) : 0.0;
  comet *= uThink;
  float lit = clamp(comet + 0.5 * uFlash, 0.0, 1.0);

  float wn = vnoise(vec3(along * 0.02, 0.0, uTime * 0.18));
  float halfW = (mix(0.3, 1.3, wn * wn) + lit * 0.25 + caught * 0.35) * uDpr;
  float brk = mix(smoothstep(0.12, 0.2, vnoise(vec3(along * 0.045, 5.0, uTime * 0.12))), 1.0, max(lit, caught));
  float line = (1.0 - smoothstep(halfW - 0.6, halfW + 0.6, abs(frame))) * brk;

  float halo = exp(-abs(frame) / (14.0 * uDpr)) * (comet + uFlash) * 0.15;
  float hA = clamp(halo * (uDark > 0.5 ? 0.55 : 0.3), 0.0, 1.0);
  col = vec4(uAccent, 1.0) * hA + col * (1.0 - hA);

  float fa = line * clamp((uDark > 0.5 ? 0.5 : 0.4) + lit + 0.5 * caught, 0.0, 1.0);
  col = vec4(mix(mix(uMuted, uWarm, caught), uAccent, lit), 1.0) * fa + col * (1.0 - fa);

  outColor = col;
}`;

/** Inks, as the shader numbers them. */
const INK = { text: 0, muted: 1, accent: 2, alt: 3, warm: 4 } as const;
/** The panel's trace, low to high. */
const TRACE = [95, 46, 45, 126, 39];

const fract = (x: number) => x - Math.floor(x);
function hash31(x: number, y: number, z: number) {
  let px = fract(x * 0.1031);
  let py = fract(y * 0.103);
  let pz = fract(z * 0.0973);
  const d = px * (py + 33.33) + py * (px + 33.33) + pz * (pz + 33.33);
  px += d;
  py += d;
  pz += d;
  return fract((px + py) * pz);
}
function vnoise(x: number, y: number, z: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const s = (t: number) => t * t * (3 - 2 * t);
  const ux = s(x - ix);
  const uy = s(y - iy);
  const uz = s(z - iz);
  const h = (a: number, b: number, c: number) => hash31(ix + a, iy + b, iz + c);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(l(h(0, 0, 0), h(1, 0, 0), ux), l(h(0, 1, 0), h(1, 1, 0), ux), uy),
    l(l(h(0, 0, 1), h(1, 0, 1), ux), l(h(0, 1, 1), h(1, 1, 1), ux), uy),
    uz,
  );
}

function worker() {
  const scope = self as unknown as DedicatedWorkerGlobalScope;
  let gl: WebGL2RenderingContext | null = null;
  let canvas: OffscreenCanvas | null = null;
  let prog: WebGLProgram | null = null;
  const U = new Map<string, WebGLUniformLocation>();
  const tex: WebGLTexture[] = [];

  let layout: Extract<Msg, { type: "layout" }> | null = null;
  let slot: [number, number] = [0, 0];
  let hasAtlas = false;
  let colors: Extract<Msg, { type: "colors" }> | null = null;
  let builtFor = "";
  /** Eases toward the layout's rect, so the desk steps back smoothly as the log grows. */
  const art = [0, 0, 0, 0];

  let running = false;
  let drawn = false;
  let clearTarget = 0;
  let clear = 0;
  let thinkTarget = 0;
  let think = 0;
  let flash = 0;
  let head = 0;
  let last = 0;
  const t0 = performance.now();
  /** The shader's time. */
  let clock = 0;

  let coarse = false;
  let calm = false;
  let rig: Rig | null = null;
  let aim: Pt | null = null;
  let lastAim: Pt | null = null;
  /**
   * Picking the pointer up or letting it go, the lamp's target eases over from
   * where it was, [dx, dy, vx, vy], instead of jumping.
   */
  const hand = [0, 0, 0, 0];
  let aimed = false;
  let target: Pt | null = null;
  let lampOn = true;
  let power = 1;
  /** Whether the desk's model answers, as far as the page knows; only the LED shows it. */
  let online = true;
  let onlineMix = 1;
  /** Scrolled out of sight with the log, the lamp's light goes out with it. */
  let seen = 1;
  let hover = false;
  let pulses: { s: number; v: number; k: number; tail: number }[] = [];
  let spikes: number[] = [];
  let tokenAt = -9;
  let ledFlick = 0;
  let heat = 0;
  let load = 0.06;
  let fan = 0;
  let seed = 5;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  type Grid = {
    cols: number;
    rows: number;
    kind: Uint8Array;
    base: ReturnType<typeof lampBase>;
    Lc: number;
    panel: number[][];
    boxTop: number;
    boxC: [number, number];
    meters: number;
    over: Uint8Array;
    /** How far clear of the wall the standing things are, if there are any. */
    stand: [number, number] | null;
    /** The book title's middle, if there is one. */
    title: Pt | null;
  };
  let G: Grid | null = null;

  /**
   * What a frame may cost before the light shows, CPU and GPU together: full
   * holds 60 fps with the GPU at most 70% busy, calm its 30. Measured
   * (2026-10-18, Chrome 155, M4, repeated draws standing in for slower GPUs):
   * at 13 ms full still moved at 60 fps; at 26 ms frames queued and the lamp
   * trailed the pointer by 150 ms.
   */
  const FULL_MS = 12;
  const CALM_MS = 22;
  /**
   * A frame this long from drawn to done means the GPU has fallen behind:
   * keeping up, it took two ticks, and falling behind, five or more.
   */
  const LAG_TICKS = 3.5;
  /** The calm look, eased, so a step down mid-visit fades in. */
  let calmMix = 0;
  /** A frame's measured cost per canvas pixel, which paces the drawing. */
  let perPx = 0;
  /** Each drawn frame's fence, oldest first, until the GPU has finished it. */
  const fences: { s: WebGLSync; at: number }[] = [];
  let quietTill = 0;
  let windowFrom = 0;
  let done = 0;
  let late = 0;
  let strikes = 0;
  /** The time between ticks, eased. */
  let tick = 16.7;
  let prevRaf = 0;
  /** Stepped down to text: nothing more to draw. */
  let out = false;

  const frame: (cb: (t: number) => void) => void =
    typeof requestAnimationFrame === "function"
      ? (cb) => requestAnimationFrame(cb)
      : (cb) => setTimeout(() => cb(performance.now()), 16);

  const fail = () => {
    running = false;
    scope.postMessage("lost");
  };

  function init(c: OffscreenCanvas) {
    canvas = c;
    c.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      fail();
    });
    // Software rendering is a slower page, not a lit desk: the text stays.
    gl = c.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      failIfMajorPerformanceCaveat: true,
    });
    if (!gl) return fail();
    const compile = (type: number, src: string) => {
      const sh = gl!.createShader(type)!;
      gl!.shaderSource(sh, src);
      gl!.compileShader(sh);
      if (!gl!.getShaderParameter(sh, gl!.COMPILE_STATUS))
        throw new Error(gl!.getShaderInfoLog(sh) ?? "");
      return sh;
    };
    try {
      const p = gl.createProgram();
      gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, FRAG));
      gl.bindAttribLocation(p, 0, "aPos");
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS))
        throw new Error(gl.getProgramInfoLog(p) ?? "");
      prog = p;
    } catch {
      return fail();
    }
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    for (
      let i = 0, n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
      i < n;
      i++
    ) {
      const name = gl.getActiveUniform(prog, i)!.name;
      U.set(name, gl.getUniformLocation(prog, name)!);
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    // The glow, the atlas and the shadows' distance field are smooth between cells.
    ["uMask", "uGlow", "uAtlas", "uAux", "uOver", "uShadow", "uExtra"].forEach(
      (name, unit) => {
        const t = gl!.createTexture();
        gl!.activeTexture(gl!.TEXTURE0 + unit);
        gl!.bindTexture(gl!.TEXTURE_2D, t);
        const filter =
          unit === 1 || unit === 2 || unit === 5 ? gl!.LINEAR : gl!.NEAREST;
        gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, filter);
        gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, filter);
        gl!.texParameteri(
          gl!.TEXTURE_2D,
          gl!.TEXTURE_WRAP_S,
          gl!.CLAMP_TO_EDGE,
        );
        gl!.texParameteri(
          gl!.TEXTURE_2D,
          gl!.TEXTURE_WRAP_T,
          gl!.CLAMP_TO_EDGE,
        );
        gl!.uniform1i(U.get(name)!, unit);
        tex.push(t);
      },
    );
    gl.uniform4f(
      U.get("uSView") ?? null,
      VIEW.x - VIEW.w / 2,
      VIEW.y - VIEW.h / 2,
      VIEW.w * 2,
      VIEW.h * 2,
    );
  }

  function upload(unit: number, w: number, h: number, data: Uint8Array) {
    gl!.activeTexture(gl!.TEXTURE0 + unit);
    gl!.bindTexture(gl!.TEXTURE_2D, tex[unit]!);
    gl!.texImage2D(
      gl!.TEXTURE_2D,
      0,
      gl!.RGBA,
      w,
      h,
      0,
      gl!.RGBA,
      gl!.UNSIGNED_BYTE,
      data,
    );
  }

  /** The masks, glow, cable, inside of the box and the lamp's base, rebuilt only when the grid changes. */
  function build(size: Size) {
    const { cols, rows } = GRIDS[size];
    const desk = rasterize(cols, rows, { lamp: false });
    const { owner, along, roles } = desk;
    const n = cols * rows;
    const cw = VIEW.w / cols;
    const ch = VIEW.h / rows;
    const occ = occupancy(cols, rows);
    const stand = standing(cols, rows);
    const inside = xray(desk, SCENE.xray.rect);
    // The book's title, shown where the light is; ink 5 marks it, so it fades in as a whole.
    let tx = 0;
    let ty = 0;
    let tn = 0;
    for (let i = 0; i < n; i++) {
      if (!desk.reveal[i] || inside.glyph[i]) continue;
      inside.glyph[i] = desk.reveal[i]! - FIRST + 2;
      inside.ink[i] = 5;
      tx += VIEW.x + ((i % cols) + 0.5) * cw;
      ty += VIEW.y + (Math.floor(i / cols) + 0.5) * ch;
      tn++;
    }
    const isCable = (i: number) =>
      owner[i] === roles.cable &&
      (desk.kind[i] === KIND.line || desk.kind[i] === KIND.joint);
    let Lc = 1;
    for (let i = 0; i < n; i++) if (isCable(i)) Lc = Math.max(Lc, along[i]!);

    const mask = new Uint8Array(n * 4);
    const aux = new Uint8Array(n * 4);
    const extra = new Uint8Array(n * 4);
    const lit = new Float32Array(n);
    const led = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const k = desk.kind[i]!;
      mask[i * 4] = Math.max(0, desk.chars[i]!.charCodeAt(0) - FIRST);
      mask[i * 4 + 1] = k;
      mask[i * 4 + 2] = Math.round(desk.dens[i]! * 255);
      mask[i * 4 + 3] = isCable(i) ? Math.round((along[i]! / Lc) * 254) : 255;
      aux[i * 4] = occ[i] || stand?.occ[i] ? 255 : 0;
      aux[i * 4 + 1] = inside.glyph[i]!;
      aux[i * 4 + 2] = inside.ink[i]!;
      aux[i * 4 + 3] = roles.wave >= 0 && owner[i] === roles.wave ? 255 : 0;
      extra[i * 4] = desk.mat[i]!;
      lit[i] = k === KIND.line || k === KIND.joint ? 0.8 : desk.dens[i]!;
      led[i] = k === KIND.led ? 1 : 0;
    }
    const a = blur(lit, cols, rows, 4, 2);
    // A status light's halo is a cell or two, not a bloom.
    const b = blur(led, cols, rows, 3, 1);
    const glow = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      glow[i * 4] = Math.min(255, Math.round(a[i]! * 1.6 * 255));
      glow[i * 4 + 1] = Math.min(255, Math.round(b[i]! * 4 * 255));
    }

    // The panel's inside, row by row, where its trace runs.
    const quad: Pt[] =
      (Array.isArray(SCENE.panel) ? SCENE.panel : SCENE.panel?.[size]) ?? [];
    const byRow = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
      const c = i % cols;
      const r = (i - c) / cols;
      const x = VIEW.x + (c + 0.5) * cw;
      const y = VIEW.y + (r + 0.5) * ch;
      if (!inPoly(quad, x, y)) continue;
      const k = desk.kind[i];
      const outline = owner[i] === roles.panel && k !== KIND.fill;
      if (
        outline ||
        !(k === KIND.empty || k === KIND.fill || owner[i] === roles.wave)
      )
        continue;
      byRow.set(r, [...(byRow.get(r) ?? []), i]);
    }

    const over = new Uint8Array(n * 4);
    upload(0, cols, rows, mask);
    upload(1, cols, rows, glow);
    upload(3, cols, rows, aux);
    upload(4, cols, rows, over);
    upload(6, cols, rows, extra);
    const sdf = distanceField(occ, cols, rows);
    if (stand) distanceField(stand.occ, cols, rows, sdf.data, 1);
    else for (let k = 1; k < sdf.data.length; k += 4) sdf.data[k] = 255;
    upload(5, sdf.W, sdf.H, sdf.data);
    const base = lampBase(cols, rows);
    const heat = SCENE.heat;
    G = {
      cols,
      rows,
      kind: desk.kind,
      base,
      Lc,
      panel: [...byRow.entries()].sort((x, y) => x[0] - y[0]).map(([, c]) => c),
      boxTop: Math.floor((heat.top - VIEW.y) / ch),
      boxC: [
        Math.ceil((heat.x0 - VIEW.x) / cw),
        Math.floor((heat.x1 - VIEW.x) / cw),
      ],
      meters: inside.meters,
      over,
      stand: stand?.depth ?? null,
      title: tn ? [tx / tn, ty / tn] : null,
    };
    const was = rig;
    rig = new Rig(base.S);
    const rest = lampRest(base.S);
    rig.from(rest.E, rest.H, rest.dir);
    // A new size keeps the lamp's pose; the first one starts from the text's.
    if (was?.q) {
      rig.q = was.q;
      rig.v = was.v;
    }
    const out: Switch = {
      type: "switch",
      size,
      row: base.row,
      col: base.sw,
      at: [VIEW.x + (base.sw + 1.5) * cw, VIEW.y + (base.row + 0.5) * ch],
    };
    scope.postMessage(out);
  }

  /** What the worker draws over the mask: the lamp, the panel's trace and heat off the box. */
  function overlay(time: number) {
    const g = G!;
    const { cols, rows, kind, over, base } = g;
    const n = cols * rows;
    over.fill(0);
    const put = (i: number, code: number, ink: number, a: number, lit = 0) => {
      if (i < 0 || i >= n) return;
      over[i * 4] = code - FIRST + 1;
      over[i * 4 + 1] = ink;
      over[i * 4 + 2] = Math.round(Math.min(1, Math.max(0, a)) * 255);
      over[i * 4 + 3] = lit;
    };
    const cellAt = ([x, y]: Pt) => {
      const c = Math.floor(((x - VIEW.x) * cols) / VIEW.w);
      const r = Math.floor(((y - VIEW.y) * rows) / VIEW.h);
      return c < 0 || r < 0 || c >= cols || r >= rows ? -1 : r * cols + c;
    };

    if (calmMix < 0.5 && heat > 0.02) {
      for (let k = 1; k <= 9; k++) {
        const r = g.boxTop - k;
        if (r < 0) break;
        for (let c = g.boxC[0]; c <= g.boxC[1]; c++) {
          const i = r * cols + c;
          if (kind[i]) continue;
          const nz = vnoise(c * 0.42, r * 0.8 + time * 3.2, time * 0.7);
          const thr = 0.5 + k * 0.045 - heat * 0.16;
          if (nz > thr)
            put(
              i,
              nz > thr + 0.1 ? 126 : 39,
              INK.muted,
              heat * (1 - k / 10) * 0.85,
            );
        }
      }
    }

    const rowsP = g.panel;
    if (rowsP.length) {
      const m = Math.max(...rowsP.map((r) => r.length));
      const levels = rowsP.length >= 2 ? 10 : 5;
      for (let k = 0; k < m; k++) {
        let y =
          think > 0.5
            ? 0.5 + (vnoise(k * 0.9, time * 9, 3) - 0.5) * 1.4
            : 0.5 + 0.22 * Math.sin(k * 0.75 - time * 2.2);
        for (const s0 of spikes) {
          const x = m - 1 - (time - s0) * 14;
          y += 0.5 * Math.exp(-(((k - x) / 0.7) ** 2));
        }
        y = Math.min(0.999, Math.max(0, y));
        const lv = Math.floor(y * levels);
        const top = rowsP.length >= 2 && lv >= 5;
        const row =
          rowsP.length >= 2 ? rowsP[rowsP.length - (top ? 2 : 1)]! : rowsP[0]!;
        const cell =
          row[
            Math.min(
              row.length - 1,
              Math.round((k / Math.max(1, m - 1)) * (row.length - 1)),
            )
          ]!;
        put(
          cell,
          TRACE[top ? lv - 5 : Math.min(4, lv)]!,
          INK.alt,
          think > 0.5 ? 0.6 + 0.4 * rnd() : 0.9,
          2,
        );
      }
    }

    const pose = rig!.pose();
    const on = power;
    const lines = traceLines(
      [
        [{ pts: [pose.S, pose.E, pose.H], closed: false }],
        [{ pts: pose.shade, closed: true }],
        [{ pts: pose.neck, closed: false }],
      ],
      cols,
      rows,
    );
    const xs = pose.shade.map((v) => v[0]);
    const ys = pose.shade.map((v) => v[1]);
    const c0 = Math.max(
      0,
      Math.floor(((Math.min(...xs) - VIEW.x) * cols) / VIEW.w),
    );
    const c1 = Math.min(
      cols - 1,
      Math.ceil(((Math.max(...xs) - VIEW.x) * cols) / VIEW.w),
    );
    const r0 = Math.max(
      0,
      Math.floor(((Math.min(...ys) - VIEW.y) * rows) / VIEW.h),
    );
    const r1 = Math.min(
      rows - 1,
      Math.ceil(((Math.max(...ys) - VIEW.y) * rows) / VIEW.h),
    );
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const x = VIEW.x + ((c + 0.5) * VIEW.w) / cols;
        const y = VIEW.y + ((r + 0.5) * VIEW.h) / rows;
        if (inPoly(pose.shade, x, y))
          put(r * cols + c, 58, INK.muted, 0.35 + 0.4 * on);
      }
    for (let i = 0; i < n; i++)
      if (lines[i])
        put(i, lines[i]!.charCodeAt(0), INK.text, 0.55 + 0.45 * on, 1);

    const breathe = 0.6 + 0.4 * Math.sin(time * 2.4);
    [...base.text].forEach((chr, k) => {
      const i = base.row * cols + base.start + k;
      if (chr !== "[" && chr !== "I" && chr !== "]")
        return put(i, chr.charCodeAt(0), INK.text, 0.5 + 0.3 * on);
      const code = chr === "I" && !lampOn ? 79 : chr.charCodeAt(0);
      if (lampOn) put(i, code, INK.warm, hover ? 1 : 0.85);
      else put(i, code, INK.accent, 0.5 + 0.5 * (hover ? 1 : breathe));
    });
    put(base.pivot, 111, INK.text, 0.6 + 0.4 * on);
    put(cellAt(pose.E), 111, INK.text, 0.6 + 0.4 * on);
    if (on > 0.05) put(cellAt(pose.bulb), 64, INK.warm, on);
    return { pose, breathe };
  }

  /**
   * The first frame waits on the frames that decide the level, drawn while the
   * canvas is still hidden: a device past FULL_MS is calm, and one whose calm
   * frame is past CALM_MS keeps the text without the light ever showing. They
   * wait for the desk to be on screen in a shown tab, which a browser doesn't
   * slow down.
   */
  function draw(now: number) {
    if (out) return false;
    if (drawn) return paint(now) ?? false;
    if (!running) return false;
    let c = cost();
    if (c === null) return false;
    if (!calm && c > FULL_MS) {
      calm = true;
      calmMix = 1;
      scope.postMessage("calm");
      c = cost()!;
    }
    if (calm && c > CALM_MS) {
      running = false;
      out = true;
      scope.postMessage("text");
      return false;
    }
    perPx = c / (canvas!.width * canvas!.height);
    drawn = true;
    quiet(now);
    scope.postMessage("drawn");
    return paint(now) ?? false;
  }

  /**
   * A frame's cost, timed to a 1x1 readback, which waits for the GPU to finish,
   * less a readback alone. The first two frames compile and upload, so the
   * median of the next five. Null while there's nothing to draw yet.
   */
  function cost() {
    const px = new Uint8Array(4);
    const read = () =>
      gl!.readPixels(0, 0, 1, 1, gl!.RGBA, gl!.UNSIGNED_BYTE, px);
    const t: number[] = [];
    for (let k = 0; k < 7; k++) {
      const a = performance.now();
      read();
      const b = performance.now();
      if (paint(b) === null) return null;
      read();
      if (k < 2) continue;
      t.push(performance.now() - b - (b - a));
      // Far past either level: no need to keep the worker waiting on more.
      if (t.at(-1)! > CALM_MS * 6) return t.at(-1)!;
    }
    return t.sort((x, y) => x - y)[2]!;
  }

  function paint(now: number) {
    if (
      !gl ||
      !prog ||
      !layout ||
      !colors ||
      !hasAtlas ||
      !canvas ||
      !G ||
      !rig
    )
      return null;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const time = (now - t0) / 1000;
    calmMix = calm ? Math.min(1, calmMix + dt / 0.6) : 0;
    clear =
      clearTarget > clear
        ? Math.min(clearTarget, clear + dt / 0.45)
        : Math.max(clearTarget, clear - dt / 0.65);
    think += (thinkTarget - think) * Math.min(1, dt * 8);
    flash *= Math.exp(-dt / 0.45);
    ledFlick *= Math.exp(-dt / 0.12);
    head = (head + dt * 0.14) % 1;
    const breathe = 0.45 + 0.2 * Math.sin(time * 1.4);
    const blink = Math.sin(time * 16) > 0 ? 1 : 0.2;
    const led = Math.min(
      1,
      breathe * (1 - think) + blink * think + flash + ledFlick,
    );

    const want = layout.art;
    const ka = 1 - Math.exp(-dt / 0.09);
    let easing = false;
    for (let k = 0; k < 4; k++) {
      art[k] = art[k]! + (want[k]! - art[k]!) * ka;
      if (Math.abs(want[k]! - art[k]!) < 0.25) art[k] = want[k]!;
      else easing = true;
    }
    // Only drawn frames move it on, so an outline held still picks up where it stopped.
    clock += dt;

    const { dpr } = layout;
    const { cols, rows } = G;
    const set1 = (n: string, v: number) => gl!.uniform1f(U.get(n) ?? null, v);
    const set2 = (n: string, v: Pt) =>
      gl!.uniform2f(U.get(n) ?? null, v[0], v[1]);
    const set3 = (n: string, v: Rgb) => gl!.uniform3f(U.get(n) ?? null, ...v);
    gl.viewport(0, 0, canvas.width, canvas.height);
    set2("uRes", [canvas.width, canvas.height]);
    set1("uRadius", 16 * dpr);
    set1("uDpr", dpr);
    set1("uTime", clock);
    set1("uClear", clear);
    set1("uClip", layout.clip * dpr);
    set1("uThink", think);
    set1("uFlash", flash);
    set1("uHead", head);
    set1("uDark", colors.dark ? 1 : 0);
    set3("uMuted", colors.muted);
    set3("uAccent", colors.accent);

    // Once the desk has broken, the shell's outline is all that's left to draw.
    const gone = clearTarget === 1 && clear >= 1;
    const seenTo = art[1]! + art[3]! > layout.clip ? 1 : 0;
    if (!gone) {
      // Idle, the lamp drifts over the box; touch screens have no pointer to follow.
      const on = !coarse && !!aim;
      const src: Pt = on
        ? aim!
        : [
            AIM[0] + 22 * Math.sin(time * 0.37),
            AIM[1] - 6 + 12 * Math.sin(time * 0.53),
          ];
      // Let go, it eases back from where the pointer last was: 0.25 s, and 0.12 s to pick it up.
      if (target && on !== aimed) {
        const from = !on && lastAim ? lastAim : target;
        hand.splice(0, 4, from[0] - src[0], from[1] - src[1], 0, 0);
      }
      aimed = on;
      const h = on ? 0.12 : 0.25;
      const ease = () => {
        [hand[0], hand[2]] = decay(hand[0]!, hand[2]!, h, dt / 2);
        [hand[1], hand[3]] = decay(hand[1]!, hand[3]!, h, dt / 2);
      };
      // The joints step the whole frame toward one goal: the blend at its middle.
      ease();
      const P: Pt = [src[0] + hand[0]!, src[1] + hand[1]!];
      ease();
      target = P;
      rig.step(rig.goal(P, dt), dt, false);
      power += ((lampOn ? 1 : 0) - power) * (1 - Math.exp(-dt * 9));
      onlineMix += ((online ? 1 : 0) - onlineMix) * (1 - Math.exp(-dt * 6));
      seen += (seenTo - seen) * (1 - Math.exp(-dt * 9));

      for (const p of pulses) p.s += p.v * dt;
      pulses = pulses.filter((p) => p.s > -40 && p.s < G!.Lc + 40);
      spikes = spikes.filter((s0) => time - s0 < 3);
      const streaming = time - tokenAt < 0.8;
      const heatTo =
        think > 0.5 ? 0.85 : streaming ? 1 : pulses.length ? 0.15 : 0;
      heat +=
        (heatTo - heat) * (1 - Math.exp(-dt * (heatTo > heat ? 1.6 : 0.45)));
      const busy = think > 0.5 || streaming;
      const loadTo = busy ? 0.82 + 0.16 * vnoise(time * 3, 1, 2) : 0.06;
      load += (loadTo - load) * (1 - Math.exp(-dt * (busy ? 2.2 : 0.8)));
      fan += dt * (0.9 + load * 4.2) * 4;

      const { pose, breathe: sb } = overlay(time);
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, tex[4]!);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        G.cols,
        G.rows,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        G.over,
      );

      gl.uniform4f(
        U.get("uArt") ?? null,
        art[0]! * dpr,
        art[1]! * dpr,
        art[2]! * dpr,
        art[3]! * dpr,
      );
      set2("uCell", [(art[2]! * dpr) / cols, (art[3]! * dpr) / rows]);
      set2("uGrid", [cols, rows]);
      set2("uSlot", slot);
      set1("uLed", led);
      set1("uCalm", calmMix);
      set3("uFg", colors.fg);
      set3("uAlt", colors.alt);
      set3("uWarm", colors.warm);
      set2("uBulb", pose.bulb);
      set2("uDir", pose.dir);
      set1("uPower", power * seen);
      const box = layout.box;
      gl.uniform4f(
        U.get("uBox") ?? null,
        box[0] * dpr,
        box[1] * dpr,
        box[2] * dpr,
        box[3] * dpr,
      );
      set1("uBoxR", box[4] * dpr);
      set2("uSwitch", [
        VIEW.x + ((G.base.sw + 1.5) * VIEW.w) / cols,
        VIEW.y + ((G.base.row + 0.5) * VIEW.h) / rows,
      ]);
      set1(
        "uSwitchGlow",
        (1 - power) * sb * (colors.dark ? 0.7 : 0.3) + (hover ? 0.25 : 0),
      );
      const pu = new Float32Array(32);
      pulses
        .slice(-8)
        .forEach((p, k) => pu.set([p.s, Math.sign(p.v), p.k, p.tail], k * 4));
      gl.uniform4fv(U.get("uPulse[0]") ?? null, pu);
      set1("uLc", G.Lc);
      set1("uFan", fan);
      set1("uLoad", load);
      set1("uMeters", G.meters);
      set1("uOnline", onlineMix);
      const sd = G.stand;
      gl.uniform4f(
        U.get("uStand") ?? null,
        sd?.[0] ?? 0,
        sd?.[1] ?? 0,
        sd ? STAND_SHADE : 0,
        sd ? 1 : 0,
      );
      const tt = G.title;
      gl.uniform3f(
        U.get("uTitle") ?? null,
        tt?.[0] ?? 0,
        tt?.[1] ?? 0,
        tt ? 1 : 0,
      );
    }
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const f =
      drawn &&
      fences.length < 16 &&
      gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (f) fences.push({ s: f, at: now });
    if (gone) return easing;
    const swing =
      rig.v.some((v) => Math.abs(v) > 0.15) ||
      rig.settling ||
      Math.hypot(hand[0]!, hand[1]!) > 0.5 ||
      Math.abs(seen - seenTo) > 0.01;
    return (
      easing ||
      swing ||
      pulses.length > 0 ||
      Math.abs(power - (lampOn ? 1 : 0)) > 0.01 ||
      Math.abs(onlineMix - (online ? 1 : 0)) > 0.01
    );
  }

  /**
   * After it shows, a device that falls behind steps down a level, once per
   * visit: half the frames it finished in a 2 s window took longer than
   * LAG_TICKS ticks (and 100 ms), two windows in a row. A capped frame rate or
   * a fast screen leaves the GPU idle, so neither counts.
   */
  function watch(now: number) {
    const lag = Math.max(100, tick * LAG_TICKS);
    while (
      fences.length &&
      gl!.getSyncParameter(fences[0]!.s, gl!.SYNC_STATUS) === gl!.SIGNALED
    ) {
      const f = fences.shift()!;
      gl!.deleteSync(f.s);
      if (now < quietTill) continue;
      done++;
      if (now - f.at > lag) late++;
    }
    // Hidden or stalled, what was in flight says nothing about the device.
    if (!drawn || now - prevRaf > 250) return quiet(now);
    tick += (now - prevRaf - tick) * 0.05;
    if (now < quietTill || now - windowFrom < 2000) return;
    strikes = done >= 8 && late >= done / 2 ? strikes + 1 : 0;
    windowFrom = now;
    done = late = 0;
    if (strikes < 2) return;
    quiet(now);
    if (!calm) {
      calm = true;
      scope.postMessage("calm");
    } else {
      running = false;
      out = true;
      scope.postMessage("text");
    }
  }
  function quiet(now: number) {
    quietTill = windowFrom = now + 2000;
    done = late = strikes = 0;
  }

  /** Full rate while something moves; the idle drift and breath hold up at 30 fps. */
  let active = true;
  function loop(now: number) {
    if (!running) return;
    watch(now);
    prevRaf = now;
    const easing =
      active ||
      thinkTarget > 0 ||
      think > 0.01 ||
      flash > 0.01 ||
      ledFlick > 0.01 ||
      clear !== clearTarget;
    // Calm, with the desk broken: the outline holds still until the comet runs again.
    const still = calm && clearTarget === 1 && clear >= 1 && !easing;
    // The GPU gets at most 70% of the time, so near its limit a device draws
    // less often instead of falling behind.
    const pace = canvas ? (perPx * canvas.width * canvas.height) / 0.7 - 2 : 0;
    const gap = Math.max(easing && !calm ? 0 : 29, pace);
    if (!still && now - last >= gap) active = draw(now);
    frame(loop);
  }

  scope.onmessage = (e: MessageEvent<Msg>) => {
    const m = e.data;
    if (m.type === "init") {
      coarse = m.coarse;
      calm = m.calm;
      calmMix = calm ? 1 : 0;
      init(m.canvas);
    } else if (!gl) return;
    else if (m.type === "atlas") {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, tex[2]!);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        m.bitmap,
      );
      slot = [m.cellW / m.bitmap.width, m.cellH / m.bitmap.height];
      m.bitmap.close();
      hasAtlas = true;
    } else if (m.type === "layout") {
      const first = !layout || layout.size !== m.size;
      layout = m;
      if (first || m.snap) art.splice(0, 4, ...m.art);
      const w = Math.max(1, Math.round(m.w * m.dpr));
      const h = Math.max(1, Math.round(m.h * m.dpr));
      // The frames in flight were drawn at the old size.
      if (w !== canvas!.width || h !== canvas!.height) quiet(performance.now());
      canvas!.width = w;
      canvas!.height = h;
      if (builtFor !== m.size) {
        builtFor = m.size;
        build(m.size);
      }
    } else if (m.type === "colors") colors = m;
    else if (m.type === "state") {
      if (m.clear !== undefined) clearTarget = m.clear ? 1 : 0;
      if (m.think !== undefined) thinkTarget = m.think ? 1 : 0;
      if (m.flash) flash = 1;
    } else if (m.type === "run") {
      const was = running;
      running = m.on;
      quiet(performance.now());
      if (running && !was) {
        last = performance.now();
        frame(loop);
      }
    } else if (m.type === "aim") {
      aim = m.at;
      if (m.at) lastAim = m.at;
    } else if (m.type === "lamp") lampOn = m.on;
    else if (m.type === "hover") hover = m.on;
    else if (m.type === "online") online = m.on;
    else if (m.type === "send" && G)
      pulses.push({ s: G.Lc + 8, v: -G.Lc / 1.25, k: 1, tail: 26 });
    else if (m.type === "token" && G) {
      const time = (performance.now() - t0) / 1000;
      pulses.push({ s: -6, v: G.Lc / DOWN_S, k: 0.62, tail: 9 });
      spikes.push(time);
      tokenAt = time;
      ledFlick = 1;
    }
    active = true;
    if (!running) draw(performance.now());
  };
}

function inPoly(poly: Pt[], x: number, y: number) {
  let inn = false;
  for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
    const [xa, ya] = poly[a]!;
    const [xb, yb] = poly[b]!;
    if (ya > y !== yb > y && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa)
      inn = !inn;
  }
  return inn;
}

/**
 * What the shadows trace: per cell, over the drawing and half a drawing round
 * it, the signed distance from the cell's centre to the nearest solid cell's
 * edge in drawing units (negative inside), as (sd + 24) / 80 in R. Nothing
 * outside the drawing is solid.
 */
/** Into channel `chan` of `out`: R for things against the wall, G for things clear of it. */
function distanceField(
  occ: Uint8Array,
  cols: number,
  rows: number,
  out = new Uint8Array(cols * 2 * rows * 2 * 4),
  chan = 0,
) {
  const W = cols * 2;
  const H = rows * 2;
  const ox = cols / 2;
  const oy = rows / 2;
  const cw = VIEW.w / cols;
  const ch = VIEW.h / rows;
  const LO = -24;
  const HI = 56;
  const at = (x: number, y: number) => {
    const c = x - ox;
    const r = y - oy;
    return c >= 0 && r >= 0 && c < cols && r < rows ? occ[r * cols + c]! : 0;
  };
  const rx = Math.ceil(HI / cw) + 1;
  const ry = Math.ceil(HI / ch) + 1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const inside = at(x, y);
      // The nearest cell of the other kind, measured to its edge.
      let best = HI;
      for (let dy = -ry; dy <= ry; dy++) {
        const ey = Math.max(0, Math.abs(dy) * ch - ch / 2);
        if (ey >= best) continue;
        for (let dx = -rx; dx <= rx; dx++) {
          if (at(x + dx, y + dy) === inside) continue;
          const e = Math.hypot(Math.max(0, Math.abs(dx) * cw - cw / 2), ey);
          if (e < best) best = e;
        }
      }
      const sd = inside ? -best : best;
      out[(y * W + x) * 4 + chan] = Math.round(
        ((Math.min(HI, Math.max(LO, sd)) - LO) / (HI - LO)) * 255,
      );
    }
  return { W, H, data: out };
}

function blur(src: Float32Array, w: number, h: number, rx: number, ry: number) {
  let a = Float32Array.from(src);
  const b = new Float32Array(w * h);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        let n = 0;
        for (let k = -rx; k <= rx; k++) {
          const xx = x + k;
          if (xx >= 0 && xx < w) {
            s += a[y * w + xx]!;
            n++;
          }
        }
        b[y * w + x] = s / n;
      }
    }
    const c = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        let n = 0;
        for (let k = -ry; k <= ry; k++) {
          const yy = y + k;
          if (yy >= 0 && yy < h) {
            s += b[yy * w + x]!;
            n++;
          }
        }
        c[y * w + x] = s / n;
      }
    }
    a = c;
  }
  return a;
}
