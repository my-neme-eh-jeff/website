/**
 * The desk's revisions for `k rollout history desk`: the commits that changed
 * what a visitor sees of it, oldest first, in their own words. Re-list them
 * with `git log --reverse --format='%h %ad %s' --date=short -- src/components/desk`.
 */
export const DESK_REVISIONS: readonly {
  hash: string;
  date: string;
  cause: string;
}[] = [
  {
    hash: "132075e",
    date: "2026-10-16",
    cause:
      "Make the shell the home page's first screen, with the desk drawn inside it",
  },
  {
    hash: "3cab96b",
    date: "2026-10-16",
    cause:
      "Light the desk with WebGL, off the main thread, without waking Qwik",
  },
  {
    hash: "38d3d8b",
    date: "2026-10-17",
    cause:
      "Put a lamp on the desk, run the chat down its cable, and step the light down on weak devices",
  },
  {
    hash: "a7da1ef",
    date: "2026-10-18",
    cause: "Carry the first answer down the desk's cable, then break the desk",
  },
  {
    hash: "e777642",
    date: "2026-10-18",
    cause: "Ground the lamp's shadows on the things that cast them",
  },
  {
    hash: "4fdf3b3",
    date: "2026-10-19",
    cause: "Redraw the home page desk, and title the shell AI Builder",
  },
  {
    hash: "d02fcb0",
    date: "2026-10-20",
    cause:
      "Float the desk's notes with short ticks, label the books, and say agents",
  },
  {
    hash: "1ecbd8c",
    date: "2026-10-20",
    cause: "Let the prompt grow to six lines, and the lamp follow its caret",
  },
  {
    hash: "95a2086",
    date: "2026-10-26",
    cause:
      "Hold the desk light, drift and circle still once nobody is using the page",
  },
];
