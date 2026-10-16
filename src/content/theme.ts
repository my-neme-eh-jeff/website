import {
  DEFAULT_PALETTE,
  MODE_KEY,
  PALETTES,
  THEME_KEY,
  type Mode,
  type ModeChoice,
} from "./palettes";

/**
 * Applies the saved palette before first paint, and is the only place a
 * palette is changed from. It runs inline in <head>, after the theme-color
 * tags it rewrites. On <html> it sets `data-palette` (absent for the default),
 * `data-mode` (absent for "auto"), `data-js`, which shows the footer picker,
 * and `data-scheme` and `data-one-mode`, which label the shell's light/dark
 * button.
 *
 * Every control calls `window.siteTheme`: the footer's from a sync$ handler,
 * which can't import anything, and the shell's, which also calls `preview`.
 * Every change fires `themechange` on document, with `preview: true` for a
 * preview.
 *
 * A stored name is checked against the palette list before it touches the
 * DOM, so a hand-edited value can't reach a selector.
 */

export type SiteTheme = {
  get(): { name: string; mode: ModeChoice; scheme: Mode };
  /** `undefined` leaves that half as it is. */
  set(name?: string, mode?: ModeChoice): void;
  /** Paints without saving. `set()` with no arguments paints the saved one. */
  preview(name: string, mode: ModeChoice): void;
};

declare global {
  interface Window {
    siteTheme?: SiteTheme;
  }
}

/** Read before paint too, so CSS can label the shell's mute button. */
export const MUTED_KEY = "shell:muted";

const GROUNDS = Object.fromEntries(
  PALETTES.map((p) => [
    p.id,
    {
      ...(p.light ? { l: p.light.bg } : {}),
      ...(p.dark ? { d: p.dark.bg } : {}),
    },
  ]),
);

export const themeScript = `(function(){
var P=${JSON.stringify(GROUNDS)},D=${JSON.stringify(DEFAULT_PALETTE)},K=${JSON.stringify(THEME_KEY)},M=${JSON.stringify(MODE_KEY)};
var r=document.documentElement,q=matchMedia("(prefers-color-scheme: dark)"),mem={};
function get(k){try{return localStorage.getItem(k)}catch(e){return mem[k]||null}}
function put(k,v){mem[k]=v;try{v===null?localStorage.removeItem(k):localStorage.setItem(k,v)}catch(e){}}
function has(n){return Object.prototype.hasOwnProperty.call(P,n)}
function state(){var n=get(K),m=get(M);if(!has(n))n=D;if(m!=="light"&&m!=="dark")m="auto";return{name:n,mode:m}}
function scheme(s){var p=P[s.name];if(!p.d)return"light";if(!p.l)return"dark";return s.mode==="auto"?(q.matches?"dark":"light"):s.mode}
function paint(o){var s=o||state(),c=scheme(s),t=document.querySelectorAll('meta[name="theme-color"]');
if(s.name===D)r.removeAttribute("data-palette");else r.setAttribute("data-palette",s.name);
if(s.mode==="auto")r.removeAttribute("data-mode");else r.setAttribute("data-mode",s.mode);
r.setAttribute("data-scheme",c);if(P[s.name].l&&P[s.name].d)r.removeAttribute("data-one-mode");else r.setAttribute("data-one-mode","");
for(var i=0;i<t.length;i++)t[i].setAttribute("content",P[s.name][c==="dark"?"d":"l"]);
document.dispatchEvent(new CustomEvent("themechange",{detail:{name:s.name,mode:s.mode,scheme:c,preview:!!o}}))}
window.siteTheme={get:function(){var s=state();s.scheme=scheme(s);return s},
set:function(n,m){if(n!==undefined)put(K,n===D||!has(n)?null:n);if(m!==undefined)put(M,m==="light"||m==="dark"?m:null);paint()},
preview:function(n,m){paint({name:has(n)?n:D,mode:m==="light"||m==="dark"?m:"auto"})}};
r.setAttribute("data-js","");if(get(${JSON.stringify(MUTED_KEY)})==="1")r.setAttribute("data-muted","");paint();q.addEventListener("change",function(){paint()});
addEventListener("storage",function(e){if(e.key===K||e.key===M||e.key===null)paint()})
})();`;
