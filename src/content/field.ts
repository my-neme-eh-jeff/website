/** The `@keyframes` name in global.css that `.field` runs. */
export const FIELD_ANIMATION = "field-shift";

/**
 * Steps the field's drift 4 times a second. Chrome 155 (2026-10-17) can't run
 * a custom-property animation on the compositor, so left running it restyles
 * and repaints the viewport every frame. Re-measure: `node scripts/measure-idle.mjs`.
 *
 * Only an animation CSS left running is taken, so a stylesheet can still freeze
 * it on a keyframe.
 */
export const fieldScript = `(function(){
if(!document.getAnimations||typeof WeakSet!=="function")return;
var mine=new WeakSet();
setInterval(function(){var l=document.getAnimations();for(var i=0;i<l.length;i++){var a=l[i];
if(a.animationName!==${JSON.stringify(FIELD_ANIMATION)})continue;
if(!mine.has(a)){if(a.playState!=="running")continue;a.pause();mine.add(a)}
a.currentTime=performance.now()}},250)
})();`;
