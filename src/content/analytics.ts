/**
 * Cloudflare Web Analytics, loaded by us rather than injected at the edge.
 *
 * Edge injection can't be opted out of: the tag is added to the HTML after it
 * leaves this build. Loading it here means every condition below is ours.
 * The beacon sets no cookies and uses no storage; the only thing this file
 * stores is the visitor's own opt-out, which `/privacy/` sets.
 *
 * It never loads when:
 *   - the visitor opted out on /privacy/ (localStorage `analytics:off` = "1"),
 *   - the browser sends Global Privacy Control or Do Not Track,
 *   - the visitor is in the EU/EEA, the UK or Switzerland, or the location is
 *     unknown. Location comes from Cloudflare's own `/cdn-cgi/trace` on this
 *     origin, so it fails closed anywhere that isn't Cloudflare (local dev,
 *     CI's Lighthouse run).
 * And it waits for the page's load event plus an idle slot, so it can't
 * delay rendering.
 */

/** Public by design — the same value sits in the page of every site using it. */
export const ANALYTICS_TOKEN = "5e177114d6d442dc9f5714fdbc721deb";

export const OPT_OUT_KEY = "analytics:off";

/** EU 27 + EEA (IS, LI, NO) + UK + CH, and Cloudflare's Tor/unknown codes. */
export const NO_ANALYTICS_REGIONS = [
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
  "IS",
  "LI",
  "NO",
  "GB",
  "CH",
  "T1",
  "XX",
];

export const analyticsLoader = `(function(){
var X=${JSON.stringify(NO_ANALYTICS_REGIONS)};
function go(){
try{if(localStorage.getItem(${JSON.stringify(OPT_OUT_KEY)})==="1")return}catch(e){}
var n=navigator;if(n.globalPrivacyControl===true||n.doNotTrack==="1"||window.doNotTrack==="1")return;
fetch("/cdn-cgi/trace").then(function(r){return r.ok?r.text():""}).then(function(t){
var m=/^loc=([A-Z0-9]{2})$/m.exec(t);if(!m||X.indexOf(m[1])>=0)return;
var s=document.createElement("script");s.defer=true;
s.src="https://static.cloudflareinsights.com/beacon.min.js";
s.setAttribute("data-cf-beacon",${JSON.stringify(JSON.stringify({ token: ANALYTICS_TOKEN }))});
document.head.appendChild(s)}).catch(function(){})}
function idle(){(window.requestIdleCallback||setTimeout)(go)}
if(document.readyState==="complete")idle();else addEventListener("load",idle)
})();`;
