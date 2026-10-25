/**
 * The eval round that picked the desk model, as the shell's model tells
 * visitors. Copy it from the write-up when a round changes `DESK_MODEL`;
 * verify checks every field against evals/results/.
 */
export const deskPick = {
  /** In evals/results/. */
  writeup: "2026-10-22-desk-model-finalists.md",
  /** In evals/results/runs/; `tried` counts the desk models up to this run. */
  run: "20261022T050412",
  /** The models in `run`, which asked each of them every question. */
  finalists: 2,
  model: "gemma4:26b-a4b-it-qat",
  month: "October 2026",
  tried: 7,
  questions: 184,
  reps: 3,
  /** The write-up's accurate share for `model`. */
  accurate: "86%",
};
