/**
 * The light on the desk: one file that runs twice.
 *
 * In the page it is a classic <script>, injected by the shell's `qidle`
 * sync$ once the page is idle, so it never wakes Qwik. It hands a canvas to a
 * worker started from this same URL, and from then on only forwards what the
 * page knows: layout, theme, and what the shell is doing.
 *
 * In the worker it draws the desk with WebGL2, over the same grid the page
 * shipped as text (rasterize() in ./desk), so the switch moves no character.
 * Everything that animates is in the shader; the grid itself is static.
 *
 * Built by Vite as `?worker&url`: one file, content-hashed under /assets/.
 */
import { GRIDS, KIND, rasterize } from "./desk";

type Size = keyof typeof GRIDS;
type Rgb = [number, number, number];

type Msg =
  | { type: "init"; canvas: OffscreenCanvas }
  | { type: "atlas"; bitmap: ImageBitmap; cellW: number; cellH: number }
  | {
      type: "layout";
      w: number;
      h: number;
      dpr: number;
      size: Size;
      art: [number, number, number, number];
    }
  | { type: "colors"; fg: Rgb; muted: Rgb; accent: Rgb; dark: boolean }
  | { type: "state"; think?: boolean; flash?: boolean; clear?: boolean }
  | { type: "run"; on: boolean };

/** Printable ASCII, the atlas order: glyph index = char code - 32. */
const FIRST = 32;
const COUNT = 95;

if (typeof document === "undefined") worker();
else page();

/* ------------------------------------------------------------------ page */

function page() {
  const script = document.currentScript as HTMLScriptElement | null;
  const shell = document.querySelector<HTMLElement>("[data-shell]");
  if (!script || !shell) return;

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

  const w = new Worker(script.src);
  const post = (m: Msg, t: Transferable[] = []) => w.postMessage(m, t);
  post({ type: "init", canvas: off }, [off]);

  w.onmessage = (e: MessageEvent<string>) => {
    if (e.data === "drawn") shell.setAttribute("data-lit", "");
    if (e.data === "lost") {
      shell.removeAttribute("data-lit");
      canvas.remove();
      w.terminate();
    }
  };

  const visible = () =>
    [...shell.querySelectorAll<HTMLElement>("[data-desk-grid]")].find(
      (el) => el.offsetParent !== null,
    );

  let atlasKey = "";
  const layout = async () => {
    const pre = visible();
    if (!pre) return;
    const size = pre.dataset["deskGrid"] as Size;
    const { cols, rows } = GRIDS[size];
    const sr = shell.getBoundingClientRect();
    const pr = pre.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cellW = (pr.width / cols) * dpr;
    const cellH = (pr.height / rows) * dpr;
    const fontPx = parseFloat(getComputedStyle(pre).fontSize) * dpr;
    const key = `${cellW}x${cellH}`;
    if (key !== atlasKey) {
      atlasKey = key;
      const bitmap = await atlas(fontPx, cellW, cellH);
      post({ type: "atlas", bitmap, cellW, cellH }, [bitmap]);
    }
    post({
      type: "layout",
      w: sr.width,
      h: sr.height,
      dpr,
      size,
      art: [pr.left - sr.left, pr.top - sr.top, pr.width, pr.height],
    });
  };

  const colors = () => {
    const cs = getComputedStyle(document.documentElement);
    const rgb = (name: string): Rgb => {
      const n = parseInt(cs.getPropertyValue(name).trim().slice(1), 16);
      return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    };
    const [r, g, b] = rgb("--sem-bg");
    post({
      type: "colors",
      fg: rgb("--sem-text"),
      muted: rgb("--sem-muted"),
      accent: rgb("--sem-accent"),
      dark: 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5,
    });
  };

  /* The same condition the stylesheet clears the text desk on. */
  const IN_USE = ":has(#term-input:focus, [aria-live] > pre:nth-child(2))";
  const state = () => post({ type: "state", clear: shell.matches(IN_USE) });

  let busy = shell.hasAttribute("data-busy");
  new MutationObserver(() => {
    const now = shell.hasAttribute("data-busy");
    if (now !== busy) post({ type: "state", think: now, flash: busy && !now });
    busy = now;
    state();
  }).observe(shell, { attributes: true, subtree: true, childList: true });
  shell.addEventListener("focusin", state);
  shell.addEventListener("focusout", () => setTimeout(state, 0));

  let shown = true;
  let onScreen = true;
  const run = () => post({ type: "run", on: shown && onScreen });
  const io = new IntersectionObserver(([e]) => {
    // A client-side navigation away removes the shell; the next visit starts
    // its own light, so this one ends rather than idling in the background.
    if (!shell.isConnected) {
      io.disconnect();
      w.terminate();
      return;
    }
    onScreen = !!e?.isIntersecting;
    run();
  });
  io.observe(shell);
  document.addEventListener("visibilitychange", () => {
    shown = !document.hidden;
    run();
  });

  // Fired by src/content/theme.ts for a new palette or mode, and for the OS
  // switching light/dark while the visitor follows it.
  document.addEventListener("themechange", colors);
  new ResizeObserver(() => void layout()).observe(shell);

  colors();
  state();
  void document.fonts.load('16px "Fira Mono"').then(layout, layout);
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

/* ---------------------------------------------------------------- worker */

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform vec4 uArt;
uniform vec2 uCell;
uniform vec2 uGrid;
uniform vec2 uSlot;
uniform float uRadius;
uniform float uDpr;
uniform float uTime;
uniform float uClear;
uniform float uThink;
uniform float uFlash;
uniform float uHead;
uniform float uLed;
uniform float uDark;
uniform vec3 uFg;
uniform vec3 uMuted;
uniform vec3 uAccent;
uniform sampler2D uMask;
uniform sampler2D uGlow;
uniform sampler2D uAtlas;
out vec4 outColor;

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

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec4 col = vec4(0.0);

  vec2 q = (p - uArt.xy) / uCell;
  if (q.x >= 0.0 && q.y >= 0.0 && q.x < uGrid.x && q.y < uGrid.y) {
    vec2 cell = floor(q);
    vec2 f = fract(q);
    vec4 mk = texture(uMask, (cell + 0.5) / uGrid);
    float gi = floor(mk.r * 255.0 + 0.5);
    float kind = floor(mk.g * 255.0 + 0.5);
    float dens = mk.b;

    float n = vnoise(vec3(cell.x * 0.09, cell.y * 0.18, uTime * 0.35));
    float scan = (mod(uTime * 0.07, 1.6) - 0.3) * uGrid.x;
    float band = exp(-pow((cell.x - scan) * 0.5, 2.0) / 30.0);

    vec3 gc = uFg;
    float a = 1.0;
    if (kind == ${KIND.fill}.0) {
      float v = dens * (0.7 + 0.8 * n);
      gi = v > 0.33 ? 13.0 : v > 0.24 ? 26.0 : v > 0.14 ? 14.0 : 0.0;
      gc = uMuted;
    } else if (kind == ${KIND.steam}.0) {
      float s = vnoise(vec3(cell.x * 0.7, cell.y * 0.45 + uTime * 1.2, uTime * 0.4));
      gi = s > 0.62 ? 26.0 : s > 0.46 ? 14.0 : 0.0;
      gc = uMuted;
    } else if (kind == ${KIND.note}.0) {
      gc = uMuted;
    } else if (kind == ${KIND.led}.0) {
      gc = uAccent;
      a = 0.3 + 0.7 * uLed;
    }
    if (kind == ${KIND.line}.0 || kind == ${KIND.joint}.0) {
      gc = mix(gc, uAccent, smoothstep(0.3, 0.75, band));
    }

    float h = hash21(cell + 7.0);
    float crumble = 0.08 * min(1.0, uClear * 10.0);
    if (h < uClear) gi = 0.0;
    else if (h < uClear + crumble && gi > 0.0) { gi = 14.0; gc = uMuted; }

    vec2 gl2 = texture(uGlow, q / uGrid).rg * (1.0 - uClear);
    float glow = gl2.r * (0.35 + 0.65 * band) * (uDark > 0.5 ? 0.14 : 0.06)
      + gl2.g * uLed * (uDark > 0.5 ? 0.55 : 0.28);
    col = vec4(uAccent, 1.0) * clamp(glow, 0.0, 1.0);

    float ga = gi > 0.0 ? glyph(gi, f) * a : 0.0;
    col = vec4(gc, 1.0) * ga + col * (1.0 - ga);
  }

  vec2 size = uRes;
  float d = sdRoundBox(p - 0.5 * size, 0.5 * size - 0.75 * uDpr, uRadius);
  float s = perim(p, size);
  float along = s * 2.0 * (size.x + size.y) / uDpr;

  float ds = fract(s - uHead + 0.5) - 0.5;
  float comet = 0.5 * exp(-pow(ds / 0.012, 2.0));
  comet += ds < 0.0 ? 0.25 * exp(ds / 0.1) : 0.0;
  comet *= uThink;
  float lit = clamp(comet + 0.5 * uFlash, 0.0, 1.0);

  float wn = vnoise(vec3(along * 0.02, 0.0, uTime * 0.18));
  float halfW = (mix(0.3, 1.3, wn * wn) + lit * 0.25) * uDpr;
  float brk = mix(smoothstep(0.12, 0.2, vnoise(vec3(along * 0.045, 5.0, uTime * 0.12))), 1.0, lit);
  float line = (1.0 - smoothstep(halfW - 0.6, halfW + 0.6, abs(d))) * brk;

  float halo = exp(-abs(d) / (14.0 * uDpr)) * (comet + uFlash) * 0.15;
  float hA = clamp(halo * (uDark > 0.5 ? 0.55 : 0.3), 0.0, 1.0);
  col = vec4(uAccent, 1.0) * hA + col * (1.0 - hA);

  float fa = line * clamp((uDark > 0.5 ? 0.5 : 0.4) + lit, 0.0, 1.0);
  col = vec4(mix(uMuted, uAccent, lit), 1.0) * fa + col * (1.0 - fa);

  outColor = col;
}`;

function worker() {
  const scope = self as unknown as DedicatedWorkerGlobalScope;
  let gl: WebGL2RenderingContext | null = null;
  let canvas: OffscreenCanvas | null = null;
  let prog: WebGLProgram | null = null;
  const U = new Map<string, WebGLUniformLocation>();
  const tex: WebGLTexture[] = [];

  let layout: Extract<Msg, { type: "layout" }> | null = null;
  let cell: [number, number] = [0, 0];
  let slot: [number, number] = [0, 0];
  let hasAtlas = false;
  let colors: Extract<Msg, { type: "colors" }> | null = null;
  let builtFor = "";

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
    gl = c.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
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
    ["uMask", "uGlow", "uAtlas"].forEach((name, unit) => {
      const t = gl!.createTexture();
      gl!.activeTexture(gl!.TEXTURE0 + unit);
      gl!.bindTexture(gl!.TEXTURE_2D, t);
      const filter = unit === 0 ? gl!.NEAREST : gl!.LINEAR;
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, filter);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, filter);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
      gl!.uniform1i(U.get(name)!, unit);
      tex.push(t);
    });
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

  /** The mask and its glow, rebuilt only when the grid changes. */
  function build(size: Size) {
    const { cols, rows } = GRIDS[size];
    const desk = rasterize(cols, rows);
    const n = cols * rows;
    const mask = new Uint8Array(n * 4);
    const lit = new Float32Array(n);
    const led = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const k = desk.kind[i]!;
      mask[i * 4] = Math.max(0, desk.chars[i]!.charCodeAt(0) - FIRST);
      mask[i * 4 + 1] = k;
      mask[i * 4 + 2] = Math.round(desk.dens[i]! * 255);
      mask[i * 4 + 3] = 255;
      lit[i] = k === KIND.line || k === KIND.joint ? 0.8 : desk.dens[i]!;
      led[i] = k === KIND.led ? 1 : 0;
    }
    const a = blur(lit, cols, rows, 4, 2);
    const b = blur(led, cols, rows, 7, 3);
    const glow = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      glow[i * 4] = Math.min(255, Math.round(a[i]! * 1.6 * 255));
      glow[i * 4 + 1] = Math.min(255, Math.round(b[i]! * 6 * 255));
    }
    upload(0, cols, rows, mask);
    upload(1, cols, rows, glow);
  }

  function draw(now: number) {
    if (!gl || !prog || !layout || !colors || !hasAtlas || !canvas) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const time = (now - t0) / 1000;
    clear =
      clearTarget > clear
        ? Math.min(clearTarget, clear + dt / 0.45)
        : Math.max(clearTarget, clear - dt / 0.65);
    think += (thinkTarget - think) * Math.min(1, dt * 8);
    flash *= Math.exp(-dt / 0.45);
    head = (head + dt * 0.14) % 1;
    const breathe = 0.45 + 0.2 * Math.sin(time * 1.4);
    const blink = Math.sin(time * 16) > 0 ? 1 : 0.2;
    const led = Math.min(1, breathe * (1 - think) + blink * think + flash);

    const { dpr, art } = layout;
    const { cols, rows } = GRIDS[layout.size];
    const set1 = (n: string, v: number) => gl!.uniform1f(U.get(n) ?? null, v);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(U.get("uRes") ?? null, canvas.width, canvas.height);
    gl.uniform4f(
      U.get("uArt") ?? null,
      art[0] * dpr,
      art[1] * dpr,
      art[2] * dpr,
      art[3] * dpr,
    );
    gl.uniform2f(U.get("uCell") ?? null, cell[0], cell[1]);
    gl.uniform2f(U.get("uGrid") ?? null, cols, rows);
    gl.uniform2f(U.get("uSlot") ?? null, slot[0], slot[1]);
    set1("uRadius", 16 * dpr);
    set1("uDpr", dpr);
    set1("uTime", time);
    set1("uClear", clear);
    set1("uThink", think);
    set1("uFlash", flash);
    set1("uHead", head);
    set1("uLed", led);
    set1("uDark", colors.dark ? 1 : 0);
    gl.uniform3f(U.get("uFg") ?? null, ...colors.fg);
    gl.uniform3f(U.get("uMuted") ?? null, ...colors.muted);
    gl.uniform3f(U.get("uAccent") ?? null, ...colors.accent);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!drawn) {
      drawn = true;
      scope.postMessage("drawn");
    }
  }

  function loop(now: number) {
    if (!running) return;
    draw(now);
    frame(loop);
  }

  scope.onmessage = (e: MessageEvent<Msg>) => {
    const m = e.data;
    if (m.type === "init") init(m.canvas);
    else if (!gl) return;
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
      cell = [m.cellW, m.cellH];
      slot = [m.cellW / m.bitmap.width, m.cellH / m.bitmap.height];
      m.bitmap.close();
      hasAtlas = true;
    } else if (m.type === "layout") {
      layout = m;
      canvas!.width = Math.max(1, Math.round(m.w * m.dpr));
      canvas!.height = Math.max(1, Math.round(m.h * m.dpr));
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
      if (running && !was) {
        last = performance.now();
        frame(loop);
      }
    }
    if (!running) draw(performance.now());
  };
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
