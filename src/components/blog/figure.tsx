import { component$, Slot } from "@qwik.dev/core";

export const Figure = component$<{ caption: string }>(({ caption }) => (
  <figure class="my-10">
    <div class="border-line bg-surface rounded-2xl border p-3 sm:p-5">
      <Slot />
    </div>
    <figcaption class="text-muted max-w-measure mt-3 text-sm leading-relaxed">
      {caption}
    </figcaption>
  </figure>
));
