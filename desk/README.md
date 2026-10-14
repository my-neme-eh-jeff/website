# desk/

What runs on Aman's desk for the shell's chat. Nothing here is built or
deployed with the site; it is copied to the desk by hand.

```
visitor -> Worker (/api/chat) -> Workers VPC -> Cloudflare Tunnel
        -> chat-log-proxy.mjs (127.0.0.1:11500) -> Ollama (127.0.0.1:11434)
```

- `chat-log-proxy.mjs` forwards only `POST /api/chat`, streams the answer
  through unchanged, and appends each exchange to
  `~/.local/share/portfolio-chat/chats-YYYY-MM.jsonl`.
- `chatlog.mjs` prints that log. Its options are in the comment at its top.
- `portfolio-chat-proxy.service` keeps the proxy running as a user unit.

## What one log line holds

Written by the proxy, so it can only contain what reaches the desk:

| Field                                            | From                                                             |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| `ts`, `id`                                       | the proxy                                                        |
| `question`, `history`                            | the conversation the browser sent (up to 8 turns)                |
| `answer`, `reasoning`                            | Ollama's stream: the visible answer and the model's hidden notes |
| `stats`, `firstTokenMs`, `totalMs`               | Ollama's timings and the proxy's clock                           |
| `outcome`                                        | `ok`, `cancelled` (visitor hung up), `error`, `upstream_<code>`  |
| `systemPrompt`                                   | a 12-character hash: which prompt version answered               |
| `session`, `country`, `colo`, `ray`, `userAgent` | headers the Worker adds; `null` until it does                    |

No IP address is stored: the desk never sees one, and the Worker does not
forward it.

## Install or update on the desk

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
