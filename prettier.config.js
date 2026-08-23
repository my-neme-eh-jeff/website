/**
 * Prettier config. Shape taken from the starter Qwik ships for Tailwind:
 *   node_modules/@qwik.dev/core/dist/starters/features/tailwind/prettier.config.js
 *
 * The Tailwind plugin sorts class strings into a canonical order. That is not
 * cosmetic here: without it, two edits that add the same class in different
 * positions produce different diffs, and `npm run fmt.check` in CI turns class
 * ordering into a build failure that is tedious to resolve by hand. Sorting
 * makes the order machine-decided so it never has to be argued about.
 *
 * @see https://prettier.io/docs/configuration
 * @type {import("prettier").Config}
 */
const config = {
  plugins: ["prettier-plugin-tailwindcss"],
};

export default config;
