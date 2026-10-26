import { REST_MS, TOUCH_EVENTS } from "./rest.ts";

/** The `@keyframes` name in global.css that `.field` runs. */
export const FIELD_ANIMATION = "field-shift";
/** The `@keyframes` name in global.css that redraws the "say hi" circle. */
export const INK_AGAIN = "ink-again";

/**
 * Chrome 156 (2026-10-26) restyles every frame of a running custom-property or
 * stroke-dashoffset animation, even across keyframes that hold one value.
 * Re-measure: `node scripts/measure-idle.mjs`. So this steps the field's drift
 * once a second, and plays the circle's redraw only for the part of each loop
 * that moves, holding it drawn in between.
 *
 * Hidden or untouched for REST_MS, the field holds and carries on from there,
 * and the circle skips its redraw. Only an animation CSS left running is
 * taken, so a stylesheet can still freeze either on a keyframe, and a circle
 * whose keyframes don't read as a move then a hold keeps its CSS loop.
 */
export const motionScript = `(function(){
if(!document.getAnimations||typeof WeakSet!=="function")return;
var mine=new WeakSet(),took=false,last=performance.now(),touched=last,held=0,ink=null;
function touch(){touched=performance.now()}
${JSON.stringify(TOUCH_EVENTS)}.forEach(function(t){addEventListener(t,touch,{capture:true,passive:true})});
document.addEventListener("visibilitychange",touch);
function away(){return document.hidden||performance.now()-touched>${REST_MS}}
function redraw(a){
var t=a.effect.getTiming(),D=t.duration,d=t.delay,f=a.effect.getKeyframes(),v=f[f.length-1].strokeDashoffset,e=1;
for(var i=f.length-1;i>=0&&f[i].strokeDashoffset===v;i--)e=f[i].offset;
if(typeof v!=="string"||!(e>0&&e<1))return;
var hold=e*D+50;
function next(){if(ink!==a)return;if(a.playState==="idle"){ink=null;return}
var p=a.currentTime-d;if(p<0){setTimeout(next,-p);return}
var k=Math.floor(p/D),q=p-k*D;
if(q<hold&&a.playState==="running"){setTimeout(next,hold-q+1);return}
a.pause();a.currentTime=d+k*D+hold;
setTimeout(function(){if(ink!==a)return;
if(away())a.currentTime=d+(k+1)*D+hold;else{a.currentTime=d+(k+1)*D;a.play()}
next()},D-hold)}
next()}
function step(){var now=performance.now();
if(away()){if(took)held+=now-last;last=now;return}
last=now;var l=document.getAnimations();for(var i=0;i<l.length;i++){var a=l[i];
if(a.animationName===${JSON.stringify(INK_AGAIN)}){if(a!==ink&&a.playState==="running"){ink=a;redraw(a)}continue}
if(a.animationName!==${JSON.stringify(FIELD_ANIMATION)})continue;
if(!mine.has(a)){if(a.playState!=="running")continue;a.pause();mine.add(a);took=true}
a.currentTime=now-held}}
setTimeout(step,250);setInterval(step,1000)
})();`;
