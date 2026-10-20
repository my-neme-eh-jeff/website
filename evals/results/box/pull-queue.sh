#!/usr/bin/env bash
# Pulls eval candidates one at a time, after the gemma4 pull already running.
while pgrep -f "ollama pull gemma4:26b-a4b-it-qat" >/dev/null; do sleep 15; done
echo "== $(date -u +%FT%TZ) gemma4:26b-a4b-it-qat pull ended"
for m in qwen3.6:27b-q4_K_M qwen3.6:35b-a3b-q4_K_M gemma4:31b-it-qat glm-4.7-flash:q4_K_M nemotron-3.5-lightning:30b; do
  echo "== $(date -u +%FT%TZ) $m"
  ollama pull "$m" 2>&1 | tr "\r" "\n" | grep -v -E "[0-9]+%" | tail -n 3
done
echo "== done $(date -u +%FT%TZ)"
