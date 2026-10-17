import type { JSXChildren } from "@qwik.dev/core";

/**
 * Not a component$: @qwik.dev/core rc.3 (2026-10-17) serialises a slotted
 * component's props, which put every caption into the post's qwik/state.
 */
export const Figure = (props: { caption: string; children?: JSXChildren }) => (
  <figure class="my-10">
    <div class="border-line bg-surface rounded-2xl border p-3 sm:p-5">
      {props.children}
    </div>
    <figcaption class="text-muted max-w-measure mt-3 text-sm leading-relaxed">
      {props.caption}
    </figcaption>
  </figure>
);
