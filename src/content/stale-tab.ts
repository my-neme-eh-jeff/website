/**
 * Rescues a tab opened before the latest deploy. A text-only change renamed
 * 51 of 105 files in `/build/` (2026-10-17), and Workers serves only the
 * current deploy's files, so the page's next lazy import 404s. A <Link> has
 * already cancelled the browser's navigation by then, so the click does
 * nothing. Re-verify: `curl -I` a `/build/` file named in an old deploy's HTML.
 *
 * Only a failure within 10s of a click or Enter acts, so a stale tab is never
 * reloaded under someone reading it. A link click becomes a full page load of
 * that link; anything else reloads, at most once per 10s.
 */
export const staleTabScript = `(function(){
var link="",at=0,done=false;
addEventListener("click",function(e){
var a=e.target.closest&&e.target.closest("a[href]");
if(e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey){at=0;return}
link=a&&a.origin===location.origin&&!a.target&&!a.hasAttribute("download")&&a.pathname!==location.pathname?a.href:"";
at=Date.now()},true);
addEventListener("keydown",function(e){if(e.key==="Enter"||e.key===" ")at=Date.now()},true);
function recover(err){
if(done||Date.now()-at>10000||!/dynamically imported module|Importing a module script failed/.test(String(err&&err.message||err)))return;
done=true;
if(link){location.assign(link);return}
try{var k="stale:reload",t=Number(sessionStorage.getItem(k))||0;if(Date.now()-t>10000){sessionStorage.setItem(k,String(Date.now()));location.reload()}}catch(e){}}
document.addEventListener("qerror",function(e){recover(e.detail&&e.detail.error)});
addEventListener("unhandledrejection",function(e){recover(e.reason)})
})();`;
