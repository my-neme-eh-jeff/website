import {
  DEFAULT_PALETTE,
  MODE_KEY,
  PALETTES,
  THEME_KEY,
  type Mode,
  type ModeChoice,
} from "./palettes";

/**
 * Applies the visitor's saved palette before first paint, and is the one
 * place a palette is ever changed from.
 *
 * It runs inline in <head>, after the theme-color tags it rewrites, so a
 * returning visitor never sees the default flash first. It sets two attributes
 * on <html> that the token stylesheet keys on (`paletteCss`):
 *   - `data-palette`, absent for the default palette,
 *   - `data-mode`, absent for "follow the system".
 * and `data-js`, which shows the footer picker: without this script its
 * radios could change nothing.
 * Client-side navigation keeps <html>, so the attributes outlive it.
 *
 * Both controls call `window.siteTheme.set`: the footer picker from a sync$
 * handler, which is serialised into the HTML and so cannot import anything,
 * and the shell after `theme`. Every change fires `themechange` on document,
 * which the desk's WebGL light listens for.
 *
 * The stored name is checked against the palette list before it touches the
 * DOM, so a hand-edited value cannot reach a selector.
 */

export type SiteTheme = {
  get(): { name: string; mode: ModeChoice; scheme: Mode };
  /** `undefined` leaves that half as it is. */
  set(name?: string, mode?: ModeChoice): void;
};

declare global {
  interface Window {
    siteTheme?: SiteTheme;
  }
}

/** Each palette's page colour per mode it has, for the theme-color tags. */
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
function paint(){var s=state(),c=scheme(s),t=document.querySelectorAll('meta[name="theme-color"]');
if(s.name===D)r.removeAttribute("data-palette");else r.setAttribute("data-palette",s.name);
if(s.mode==="auto")r.removeAttribute("data-mode");else r.setAttribute("data-mode",s.mode);
for(var i=0;i<t.length;i++)t[i].setAttribute("content",P[s.name][c==="dark"?"d":"l"]);
document.dispatchEvent(new CustomEvent("themechange",{detail:{name:s.name,mode:s.mode,scheme:c}}))}
window.siteTheme={get:function(){var s=state();s.scheme=scheme(s);return s},
set:function(n,m){if(n!==undefined)put(K,n===D||!has(n)?null:n);if(m!==undefined)put(M,m==="light"||m==="dark"?m:null);paint()}};
r.setAttribute("data-js","");paint();q.addEventListener("change",paint);
addEventListener("storage",function(e){if(e.key===K||e.key===M||e.key===null)paint()})
})();`;
