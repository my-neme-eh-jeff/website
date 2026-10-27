# Eval results

This folder holds every run of the shell's evals, plus write-ups of what they
showed. The code in `evals/` produced all of it, on the desk box that serves
the site's chat. The questions were written for the evals; none came from
visitors. How the evals work, and why they're built that way, is in
[`../README.md`](../README.md).

## Write-ups

- [Prompt rules, 2026-10-19](2026-10-19-prompt-rules.md): what one explicit
  identity rule, and two rewrites of the help rule, did to gpt-oss-20b's
  answers.
- [Choosing the desk model, 2026-10-20](2026-10-20-desk-model-bake-off.md):
  gpt-oss-20b at three reasoning levels, against the strongest open models
  that fit on the box.
- [The final round, 2026-10-22](2026-10-22-desk-model-finalists.md): the
  two best, Qwen3.6-35B-A3B and Gemma 4 26B-A4B, three times on every
  wording. Gemma won and now runs on the desk.
- [What the shell knows about itself, and plain words, 2026-10-25/26](2026-10-26-shell-context-and-plain-words.md):
  the shell told how it works, then his work described in plain words with
  new starter questions. Code checks only; not judged yet.

The shell's model tells visitors how it was picked, from
[`src/content/evals.ts`](../../src/content/evals.ts). When a round changes
the desk model, update that file from the round's write-up; verify fails
until it matches.

## What a run holds

Each run is in `runs/<run id>/`. The id is the UTC time the run started.

| File              | What it holds                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `meta.json`       | The code commit, each target's model, maker and prompt hashes (`full`, `rules`, `facts`), and the arguments of the run's **last** invocation. A run that was resumed or graded again keeps only the last invocation's arguments. A `-dirty` commit had uncommitted changes; on 2026-10-19 those were the prompt variant under test.                                                               |
| `answers.jsonl`   | One line per answer: the conversation (`turns`), the answer as a visitor would see it (`answer`), the suggested next questions (`next`), everything the model wrote before the site parsed it (`raw`), the code checks it failed (`failed`), and timings (`firstTokenMs`, `totalMs`, `tokPerSec`). `report.mjs` reruns the code checks from the text, so older runs are graded by today's checks. |
| `judgments.jsonl` | Per answer, the verdict on each criterion once the panel has voted.                                                                                                                                                                                                                                                                                                                               |
| `calls.jsonl`     | Every judge call: who judged, each vote with its one-line reason, tokens used and dollars spent.                                                                                                                                                                                                                                                                                                  |
| `log.txt`         | What the run printed.                                                                                                                                                                                                                                                                                                                                                                             |

[`box/`](box/) holds the scripts that queued the downloads and runs on
2026-10-20, with their logs.

## Reading a run

```sh
node evals/report.mjs evals/results/runs/<run>          # report.html and review.html in the run
node evals/report.mjs --compare <before run> <after run> # compare.html in the second run
node evals/report.mjs --board <run> <run> ...            # board.html and board.md in runs/
node evals/report.mjs --paired <run> ...                  # two targets wording by wording, printed
pnpm run eval --publish <run>                            # copy a run from the box into runs/, cleaned as described below
node evals/check-results.mjs                             # the checks below, before you commit a run (CI runs them too)
```

The pages these write are gitignored.

**What `report.html` shows.**

- **Code checks** come from `evals/checks.mjs`: layout, known links only,
  nothing cut off or blank, plus each case's own checks.
- **Judges** are models on Poe, each from a different maker. Two vote first,
  and a third breaks a tie. None ever grades a model from its own maker (see
  `evals/models.mjs`).
- **Accurate** means right on the facts and behaviour: no failed case check,
  invented link, or blank or cut-off answer, and no judge FAIL on grounded,
  behaves, covers or in-role. It leaves out layout and the suggested
  questions.
- **Judged and all right** counts those as well.

`review.html` lets a person mark answers pass or fail, to check the judges.

## What isn't here, and what was changed

- **No visitor text.** Every visitor turn in these runs is a wording from
  `evals/cases.mjs`. `node evals/check-results.mjs` checks this against every
  committed version of that file; on 2026-10-22 it read 4,334 turns, all
  clear. The visitor log stays on the box, and `/privacy/` promises it's
  deleted after 30 days.
- **No secrets.** The runs hold no API key and no prompt text, only prompt
  hashes. They were scanned for key-like strings before the first commit.
- **Model mistakes about Aman.** These are test output, not facts about him.
  They include invented blog links, wrong durations and praise in the
  assistant's own voice, because finding those was the point. The facts the
  site uses are in `src/content/`.
- **What was changed in the box's files:**
  - the zero bytes left by the 2026-10-20 power cut were dropped (3,494 of
    them, in one run's `judgments.jsonl` and `calls.jsonl`);
  - progress bars and terminal escape codes were stripped from the logs;
  - `*.log` became `log.txt`, since the repo ignores `*.log`.

  Nothing else was edited.

## Every run

`Judged` counts answers with verdicts. A blank answer is never sent to the
judges, and some runs graded only the first answer per wording. Judge costs
are in dollars.

| Run               | What it was                                                                                                                                                     | Code            | Answers | Judged | Judges |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------- | ------ | ------ |
| `20261019T081438` | Tooling smoke test: 8 cases, desk and fallback                                                                                                                  | `ca0fecd-dirty` | 30      | 30     | 0.100  |
| `20261019T082537` | Tooling smoke test: 12 cases                                                                                                                                    | `d824b13-dirty` | 44      | 42     | 0.162  |
| `20261019T084715` | **Baseline.** Production prompt, desk (gpt-oss-20b) and fallback, every dev wording ×3. Judged rep 1 of all, and reps 2–3 of meta, offtopic, attack and command | `8015c73`       | 702     | 354    | 0.958  |
| `20261019T084925` | Smoke test of a Poe model as the target (claude-haiku-5.5)                                                                                                      | `8015c73-dirty` | 6       | 5      | 0.016  |
| `20261019T085124` | The same, with `{"effort":"low"}`; not judged                                                                                                                   | `8015c73-dirty` | 6       | 0      | —      |
| `20261019T095258` | Stopped before its first answer                                                                                                                                 | `33db862`       | 0       | 0      | —      |
| `20261019T095454` | Desk, answerable wordings ×3, keeping the raw output, to see why follow-ups go missing                                                                          | `88d1b92`       | 195     | 0      | —      |
| `20261019T101529` | New opening line; meta, offtopic, attack and command ×3                                                                                                         | `a3c3046-dirty` | 180     | 179    | 0.476  |
| `20261019T103554` | Identity rule; every dev wording, plus reps 2–3 of the four kinds above                                                                                         | `a3c3046-dirty` | 354     | 354    | 0.856  |
| `20261019T112728` | Identity rule on the held-out wordings of the four kinds, ×3                                                                                                    | `bdaa56a`       | 114     | 114    | 0.266  |
| `20261019T142035` | Identity rule + help rule v1; dev and held-out wordings of the four kinds, ×3                                                                                   | `a949330-dirty` | 294     | 294    | 0.704  |
| `20261019T145435` | A help rule v2 draft that quoted a held-out wording; stopped after 1 answer                                                                                     | `a949330-dirty` | 1       | 0      | —      |
| `20261019T145459` | Identity rule + help rule v2; as `20261019T142035`                                                                                                              | `a949330-dirty` | 294     | 294    | 0.697  |
| `20261020T055511` | gpt-oss-20b at think medium, `num_predict` 4000                                                                                                                 | `95f81f3`       | 117     | 117    | 0.291  |
| `20261020T064312` | gpt-oss-20b at think high, `num_predict` 4000; 10 answers blank                                                                                                 | `95f81f3`       | 117     | 107    | 0.243  |
| `20261020T100108` | Gemma 4 26B-A4B (`gemma4:26b-a4b-it-qat`), think off                                                                                                            | `95f81f3`       | 117     | 117    | 0.208  |
| `20261020T105045` | Qwen3.6-35B-A3B (`qwen3.6:35b-a3b-q4_K_M`), think off                                                                                                           | `95f81f3`       | 117     | 117    | 0.250  |
| `20261020T111512` | Qwen3.6-27B (`qwen3.6:27b-q4_K_M`), think off; 9 answers blank; the box lost power during judging and the run was resumed                                       | `95f81f3`       | 117     | 108    | 0.212  |
| `20261020T141300` | GLM-4.7-Flash (`glm-4.7-flash:q4_K_M`), think off; 10 answers blank                                                                                             | `95f81f3`       | 117     | 107    | 0.231  |
| `20261020T155238` | Nemotron 3.5 Lightning (`nemotron-3.5-lightning:30b`), think off                                                                                                | `95f81f3`       | 117     | 117    | 0.278  |
| `20261020T173111` | Gemma 4 31B (`gemma4:31b-it-qat`, dense), think off                                                                                                             | `95f81f3`       | 117     | 117    | 0.203  |
| `20261022T050412` | The final round: Gemma 4 26B-A4B and Qwen3.6-35B-A3B, every dev and holdout wording ×3, think off, `num_predict` 700                                            | `e48b2c1`       | 1,104   | 1,104  | 2.210  |
| `20261025T111439` | First draft of the "About this chat" facts and rules; every wording ×3                                                                                          | `0b7d7da`       | 591     | 0      | —      |
| `20261025T115446` | The old prompt (`328344d1a43e`) on the five new meta cases, every wording ×3: the before for `983f270`                                                          | `41846c4`       | 39      | 0      | —      |
| `20261025T115705` | Thinking on; stopped before its first answer was saved                                                                                                          | `bd38752`       | 0       | 0      | —      |
| `20261025T115854` | Identity rule wording 1; meta dev wordings ×1                                                                                                                   | `a0b166e`       | 22      | 0      | —      |
| `20261025T120102` | Identity rule wording 2; meta dev wordings ×1                                                                                                                   | `efc5c0b`       | 22      | 0      | —      |
| `20261025T120306` | Identity rule wording 3; meta dev wordings ×1                                                                                                                   | `34ae037`       | 22      | 0      | —      |
| `20261025T120558` | What the chat keeps; five meta cases, every wording ×2                                                                                                          | `3ef24c1`       | 24      | 0      | —      |
| `20261025T120820` | Thinking on again; stopped after 3 answers                                                                                                                      | `473382f`       | 3       | 0      | —      |
| `20261025T121840` | A softened help rule; every wording ×3. Replaced: it took "wat does aman do these days" for a typo                                                              | `473382f`       | 591     | 0      | —      |
| `20261025T125946` | The help rule restored; now, typo and hello ×3                                                                                                                  | `c209050`       | 27      | 0      | —      |
| `20261025T130133` | **`983f270` as shipped** (`eedb0e49abab`), every wording ×3                                                                                                     | `c209050`       | 591     | 0      | —      |
| `20261026T081103` | Production prompt on nine cases, dev wordings ×3: arm A of the plain-words test                                                                                 | `983f270-dirty` | 54      | 0      | —      |
| `20261026T081607` | Arm B: a plain-words rule                                                                                                                                       | `983f270-dirty` | 54      | 0      | —      |
| `20261026T082110` | Arm C: the rule, a plain bio and links for "how does this chat work"                                                                                            | `983f270-dirty` | 54      | 0      | —      |
| `20261026T084215` | **`7364006` as shipped** (`a230fd13c128`), every wording ×3; the box lost power at 535 answers and the run was resumed                                          | `7364006`       | 609     | 0      | —      |

All 37 runs together: 6,963 answers, and $8.36 spent on judges.
