# desk/

What runs on Aman's desk for the shell's chat. Nothing here is built or
deployed with the site; it is copied to the desk by hand.

```
visitor -> Worker (/api/chat) -> Workers VPC -> Cloudflare Tunnel
        -> chat-log-proxy.mjs (127.0.0.1:11500) -> Ollama (127.0.0.1:11434)
```

- `chat-log-proxy.mjs` forwards only `POST /api/chat`, streams the answer
  through unchanged, and appends each exchange to
  `~/.local/share/portfolio-chat/chats-YYYY-MM-DD.jsonl` (one file per UTC day).
  Before forwarding it asks Ollama's `/api/ps` what is loaded and answers at
  once: `x-desk-model: warm` if the chat's model is, `cold` if not (the shell's
  "cold start" note). If another model is in use, such as an eval, a question
  would queue behind it, so the proxy returns 503 `busy` without asking Ollama,
  and the Worker asks Poe. "In use" means the model's `expires_at` moved within
  the last 2 minutes: Ollama moves it as each request finishes. The proxy
  reads `/api/ps` every 10s to time those moves. A model left loaded but idle
  doesn't count; Ollama swaps it out for a cold start. If Ollama doesn't
  answer, the proxy returns 502.
- **Retention is 30 days.** The proxy deletes a day file once that day began
  more than 30 days ago, at startup and hourly. `/privacy/` promises this; change
  `RETENTION_DAYS` and that page together.
- `chatlog.mjs` prints that log. Its options are in the comment at its top.
- `portfolio-chat-proxy.service` keeps the proxy running as a user unit.

## What one log line holds

Written by the proxy, so it can only contain what reaches the desk:

| Field                              | From                                                                                                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ts`, `id`                         | the proxy                                                                                                                                                                    |
| `question`, `history`              | the conversation the browser sent (up to 8 turns)                                                                                                                            |
| `answer`, `reasoning`              | Ollama's stream: the reply, suggested questions and hidden notes                                                                                                             |
| `stats`, `firstTokenMs`, `totalMs` | Ollama's timings and the proxy's clock                                                                                                                                       |
| `outcome`                          | `ok`, `cancelled` (the visitor hung up, or the Worker gave up waiting and asked Poe), `busy` (another model was in use, so the Worker asked Poe), `error`, `upstream_<code>` |
| `systemPrompt`                     | a 12-character hash: which prompt version answered                                                                                                                           |
| `country`                          | the one visitor fact the Worker forwards (Cloudflare's geo)                                                                                                                  |

Nothing else about the visitor is stored: no IP address, user agent, request
id or session id. The desk never sees them, because the Worker forwards only the
country.

## Install or update on the desk

Update the desk before pushing a Worker that relies on the change: verify
checks the repo's copy, and nothing checks the copy on the desk.

From the repo root on a machine that can `ssh box`:

```sh
ssh box 'mkdir -p ~/.local/lib/portfolio-desk ~/.config/systemd/user'
scp desk/chat-log-proxy.mjs desk/chatlog.mjs box:.local/lib/portfolio-desk/
scp desk/portfolio-chat-proxy.service box:.config/systemd/user/
ssh box 'systemctl --user daemon-reload && systemctl --user enable --now portfolio-chat-proxy && systemctl --user restart portfolio-chat-proxy'
```

`~/.local/bin/chatlog` on the desk is a two-line wrapper that runs
`chatlog.mjs` with the same Node as the unit. A non-interactive `ssh box`
has no `~/.local/bin` on its PATH, so call it by that full path there.

The VPC service must point at the proxy's port, not Ollama's. Check with
`wrangler vpc service get <service_id>` on the desk (the id is in
`wrangler.jsonc`).
