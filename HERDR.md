---
tags:
  - project
  - pineapple-os
---

# herdr hub: exact commands

Hub: `ai-mac-mini` (user `lexi`). Plan: [[03-AGENT-MESH-HERDR]]. Set up on 2026-09-28.

## Install
```sh
curl -fsSL https://herdr.dev/install.sh -o herdr-install.sh   # read it first: fetches one binary, verifies its SHA-256 against herdr.dev/latest.json, no sudo
sh herdr-install.sh                                            # → ~/.local/bin/herdr (v0.9.1)
npm i -g @mariozechner/pi-coding-agent@0.73.1                  # → /opt/homebrew/bin/pi
```
Pi config (`~/.pi/agent/models.json`): an `ollama` provider at `http://localhost:11434/v1`, api `openai-completions`, `compat.supportsDeveloperRole/ReasoningEffort: false`, models `gemma4:12b-mlx`, `gemma4:e4b-mlx`. `~/.pi/agent/settings.json` defaults to `ollama` / `gemma4:12b-mlx`.

## Autostart
LaunchAgent `~/Library/LaunchAgents/tech.lexitools.herdr.plist` runs `herdr server` in `/data/obsidian` with a clean env (RunAtLoad, restart on crash, log `~/.config/herdr/launchd.log`). It's a user-domain agent, not a daemon, because there's no passwordless sudo. Auto-login (`lexi`) starts it at boot.
- Restart: `launchctl kickstart -k gui/$(id -u)/tech.lexitools.herdr`
- After a restart the layout is restored and Claude resumes its session. **Codex and Pi come back as plain shells.** Run `herdr agent start codex --kind codex --pane w2:p2` and `herdr agent start pi --kind pi --pane w2:p4` (check pane IDs with `herdr pane list --workspace w2`).

## Pineapple `Herdr` tab: removed 2026-09-28
Sid didn't want herdr inside Pineapple, so the Herdr tab (`924f769`) was reverted the same day. Pineapple's Terminal now has **`+ VPS` / `+ Mac`** buttons instead. Mac tabs open a plain shell on the Mac Mini through `pineapple-api-mac.lexitools.tech` (Vercel env `VITE_MAC_API_BASE_URL` / `VITE_MAC_API_WS_URL`; the old `VITE_HERDR_API_*` vars are deleted). To use herdr, run `herdr` in a Mac terminal tab or over SSH. The hub itself is unchanged.

## Start the server manually (clean env)
Launching from inside a Claude Code session leaks `CLAUDE_CODE_CHILD_SESSION` into every pane, which turns off transcript saving. Always start it with a clean environment:
```sh
cd /data/obsidian && env -i HOME="$HOME" USER="$USER" LOGNAME="$USER" SHELL=/bin/zsh LANG=en_US.UTF-8 TERM=xterm-256color \
  PATH="$HOME/.local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
  nohup herdr server >/dev/null 2>&1 & disown
herdr status server
```
The socket `~/.config/herdr/herdr.sock` is mode 600, local only, and never exposed. **There's no autostart yet.** A reboot means rerunning the above (TODO: a LaunchAgent).

## Layout
```sh
W=$(herdr workspace create --cwd /data/obsidian --label vault --no-focus)
P1=$(echo "$W" | jq -r .result.root_pane.pane_id)
P2=$(herdr pane split "$P1" --direction right --cwd /data/obsidian --no-focus | jq -r .result.pane.pane_id)
P3=$(herdr pane split "$P2" --direction down  --cwd /data/obsidian --no-focus | jq -r .result.pane.pane_id)
herdr agent start claude --kind claude --pane "$P1"
herdr agent start codex  --kind codex  --pane "$P2"   # first run: update prompt (Skip) + trust-dir prompt (Yes)
herdr agent start pi     --kind pi     --pane "$P3"
herdr agent list
```
Attach interactively: `herdr` (or `herdr session attach default`).

## Agent-to-agent
From any pane inside herdr (`HERDR_ENV=1`):
```sh
herdr agent prompt codex "Reply with only the word PINEAPPLE-ACK" --wait --timeout 120000
herdr agent read codex --source recent-unwrapped --lines 60
```
Verified 2026-09-28: the Claude pane prompted Codex this way and reported `PINEAPPLE-ACK`.

## Verification results (2026-09-28)
| Check | Result |
|---|---|
| Agent-to-agent (claude → codex) | Pass |
| `blocked` state | Pass: a Claude permission prompt (default mode) showed `blocked`. Claude's non-permission dialogs (e.g. the auto-mode onboarding) read as `idle` |
| Persistence | Pass: agents stayed idle after a client was killed. The headless server is independent of clients |
| Pi → Ollama | **Pass after fix**: 112 corrupt blobs deleted and re-pulled onto the SSD, both models run, Pi pane answers via herdr. Original failure: `mlx: [read] Unable to read from file` for both models. Root cause (rechecked): **disk I/O errors (`Errno 5`) on the LLM-SSD**. 96 of the e4b blobs and 14 of the 12b blobs can't be read, while the APFS metadata verifies OK. It's a drive or USB fault, not a permission problem |

## Hook integrations
Installed by Sid on 2026-09-28: `herdr integration install claude|codex|pi`, all current. Agents must be restarted to load them. On first start, Codex asks to trust the new SessionStart hook (reviewed: it only reports the session ID to the local herdr socket). Choose "Trust all".

## Remote machines
`herdr machine add <ssh-target> --label <label>` installs/starts herdr on the remote over SSH (so yes, the remote needs herdr; `add` prepares it). Then `herdr --machine <label> agent list`. The MacBook Pro gets added this way when it arrives.

## Not yet done
- LaunchAgent for `herdr server`.
- Pineapple `Herdr` tab (plan Phase 5), vault write rule (Phase 6).
