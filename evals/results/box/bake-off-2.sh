#!/usr/bin/env bash
# Asks each candidate every dev wording once, judged, in this order, from a
# frozen copy of the eval code (commit 95f81f3, production prompt 328344d1a43e).
# Relaunched, it skips a candidate whose run finished and resumes one that was
# cut off, going by the lines it leaves in bake-off.log.
set -u
cd ~/portfolio-evals-bakeoff || exit 1
set -a; . ~/.config/llm/env; set +a
node=$(ls -d ~/.config/nvm/versions/node/v*/bin/node | sort -V | tail -1)
DIR=~/.local/share/portfolio-evals
RUNS=$DIR/runs
LOG=$DIR/bake-off.log
# Busy means a node process running the eval, not a shell whose text names it.
busy() { pgrep -f '^[^ ]*node evals/run[.]mjs' >/dev/null; }
idle() { for i in 1 2 3; do busy && return 1; sleep 60; done; return 0; }
for m in gemma4:26b-a4b-it-qat qwen3.6:35b-a3b-q4_K_M qwen3.6:27b-q4_K_M glm-4.7-flash:q4_K_M nemotron-3.5-lightning:30b gemma4:31b-it-qat; do
  grep -qF " $m finished with exit 0" "$LOG" && continue
  until ollama list | awk '{print $1}' | grep -qxF "$m"; do
    if grep -qF " $m pull failed" "$DIR/pulls.log"; then
      echo "== $(date -u +%FT%TZ) $m skipped: its pull failed"
      continue 2
    fi
    sleep 60
  done
  until idle; do sleep 30; done
  run=$(grep -F " $m -> run " "$LOG" | tail -1 | awk '{print $NF}')
  run=${run:-$(date -u +%Y%m%dT%H%M%S)}
  echo "== $(date -u +%FT%TZ) $m -> run $run"
  EVAL_OUT=$RUNS "$node" evals/run.mjs --sha 95f81f3 --run "$run" --target "desk:$m" --think false \
    --extra '{"options":{"num_ctx":8192,"num_predict":2000}}' \
    --set dev --reps 1 --judge --judge-reps 1 --budget-usd 1 >> "$RUNS/$run.log" 2>&1
  echo "== $(date -u +%FT%TZ) $m finished with exit $?"
done
echo "== all done $(date -u +%FT%TZ)"
