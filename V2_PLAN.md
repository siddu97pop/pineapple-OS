# Pineapple OS — v2 Roadmap

> Research session: 2026-05-11
> Scope: Evolve from VPS control panel → personal agentic OS

---

## What v1 Delivered

- Browser terminal (xterm.js + WebSocket PTY)
- Live sessions.md feed (SSE)
- CLAUDE.md viewer/editor
- Status bar: clock, uptime, Syncthing
- Supabase auth

---

## v2 Design Principles

1. **Co-planning** — human + agent jointly scope work, not just human → terminal
2. **Action guards** — high-stakes actions get surfaced for approval
3. **Memory control** — see, edit, and validate what agents remember

---

## Phases

---

### Phase 1 — Layout & Terminal Power-Up

**Goal:** Fix the #1 daily friction point (single terminal) and lay the foundation for a flexible multi-panel layout.

#### 1A — Tabbed Multi-PTY Terminals
- Replace single full-width terminal with a tabbed PTY manager
- Each tab = independent `/bin/bash` shell session
- Tab features:
  - Editable name (e.g. "Mission Control build", "IBKR scrape")
  - Working directory indicator in tab label
  - Close button per tab (sends SIGHUP, cleans up session)
  - New tab button (+ icon)
  - Max tabs: 5 (same as existing `MAX_PTY_SESSIONS`)
- Backend: already supports multiple PTY sessions — just needs frontend tab management
- Keyboard: `Ctrl+T` new tab, `Ctrl+W` close tab, `Ctrl+1–5` switch tabs

#### 1B — Resizable Panel Layout
- Replace fixed 3-panel layout with a resizable split system
- Draggable divider between terminal block and right sidebar
- Right sidebar panels individually collapsible (sessions feed, editor)
- Persist panel widths in `localStorage`

#### 1C — Widget Row (Status Expansion)
- Replace thin status bar with a widget row below the nav
- Widgets:
  - **Clock** — date + time (existing, promoted)
  - **Uptime** — VPS uptime + hostname (existing, promoted)
  - **Sync Status** — Syncthing with last-sync timestamp (richer than current dot)
  - **Load Sparkline** — rolling 5-minute load average (small SVG sparkline)
  - **Active Sessions** — count of open PTY tabs
- Backend: extend `/api/status` to return load history (last 5 readings, polled every 30s)

---

### Phase 2 — Vault File Browser

**Goal:** Replace the clunky "terminal → vim" workflow for vault edits with a native UI.

#### 2A — File Tree Sidebar
- Collapsible sidebar panel showing `/data/obsidian` directory tree
- Folders: expandable/collapsible, lazy-loaded
- Files: click to open in editor panel
- Shows: file name, modification time on hover
- Highlights: currently open file
- Backend: new `GET /api/vault/tree` endpoint — returns directory tree JSON
  - Depth-limited to 3 levels by default (expand on demand)
  - Filters: exclude `.git`, `node_modules`, `.obsidian`

#### 2B — General-Purpose Vault Editor
- Extend ClaudeMdEditor into a multi-file editor
- Currently open file shown in tab bar above textarea
- Unsaved indicator (blue dot) per open file
- Save shortcut: `Cmd/Ctrl+S`
- Read-only mode for non-markdown files (show raw content)
- Backend: extend file read/write endpoints to accept arbitrary vault paths
  - Validate paths are within `/data/obsidian` (prevent path traversal)

#### 2C — Memory Quick-Access Cards
- Fixed shortcut buttons for the most-used memory files:
  - `memory/projects.md`
  - `memory/decisions.md`
  - `_system/context.md`
  - `logs/sessions.md`
- Click opens file instantly in the editor panel (no tree navigation needed)

---

### Phase 3 — Agent Awareness & Checkpoints

**Goal:** The "agentic OS" leap — see what agents are doing and let them surface decisions to you.

#### 3A — Agent Process Monitor
- Panel showing all active Claude Code / agent processes on the VPS
- Detection: poll `/proc` for processes matching `claude`, `python`, `node` with known working dirs
- Per-agent card shows:
  - Process name + PID
  - Working directory (maps to project name)
  - Status: `running`, `waiting`, `idle`
  - CPU + memory usage
  - Runtime duration
  - Kill button (sends SIGTERM, with confirmation dialog)
- Backend: new `GET /api/agents` endpoint — reads `/proc`, filters by pattern, returns structured data
- Poll interval: 10 seconds

#### 3B — Human-in-the-Loop Checkpoint Queue
- Agents write structured JSON to a watched file: `_system/checkpoints.json`
- Checkpoint schema:
  ```json
  {
    "id": "uuid",
    "ts": "ISO timestamp",
    "agent": "session name or PID",
    "action": "push to Vercel",
    "context": "built mission-control-v2, all tests pass",
    "risk": "high | medium | low",
    "status": "pending | approved | denied"
  }
  ```
- UI panel: queue of pending checkpoints, each with **Approve / Deny** buttons
- On decision: UI writes back to `_system/checkpoints.json` with updated status
- Agent polls the file (or uses chokidar watch) and proceeds/aborts accordingly
- Backend: new SSE endpoint `GET /api/checkpoints/stream` — broadcasts file changes
- Notification: browser title shows `[N]` badge when checkpoints are pending

#### 3C — Agent Context Inspector (stretch goal for Phase 3)
- For any agent card (3A), click "Inspect" to see:
  - The CLAUDE.md context it's operating with
  - Recent stdout/stderr tail (if process is known to Pineapple)
  - Last log entry written to sessions.md by that agent

---

### Phase 4 — Mobile & Polish

**Goal:** Make Pineapple useful as a read-only status dashboard from a phone, and add push notifications for checkpoints.

#### 4A — Mobile Responsive Layout
- Breakpoint `< 768px`: hide terminal tabs, show status-only view
- Mobile view includes:
  - Widget row (status cards stacked)
  - Sessions feed (full width)
  - Checkpoint queue (approve/deny from phone)
  - Agent monitor (read-only, no kill controls on mobile)
- Desktop layout unchanged

#### 4B — Push Notifications (Checkpoint Alerts)
- Browser push notification when a new checkpoint arrives in the queue
- Requires: `PushManager` + service worker registration
- Notification payload: `"[Pineapple OS] Action required: push to Vercel"`
- Click notification → opens Pineapple, scrolls to checkpoint queue
- Only fires when browser tab is not focused

#### 4C — Visual Polish Pass
- Smooth panel resize animations
- Tab switching transitions (fade)
- Checkpoint approval: confetti micro-animation on approve, shake on deny
- Load sparkline: animated path draw on first render
- Agent cards: pulsing dot for `running` state

---

## Architecture Changes Summary

| Layer | v1 | v2 |
|---|---|---|
| Terminal | 1 PTY, full width | Tabbed multi-PTY (Phase 1) |
| Layout | Fixed 3-panel | Resizable + collapsible (Phase 1) |
| Status bar | Thin bar (clock, uptime, sync dot) | Widget row with sparkline (Phase 1) |
| File access | CLAUDE.md only | Full vault tree browser (Phase 2) |
| Editor | Single-file (CLAUDE.md) | Multi-file tabbed editor (Phase 2) |
| Agent visibility | None | Process monitor + status (Phase 3) |
| Checkpoints | None | Approval queue + SSE stream (Phase 3) |
| Mobile | No | Responsive status view + push notifs (Phase 4) |

---

## New Backend Endpoints (v2)

| Method | Path | Phase | Description |
|---|---|---|---|
| GET | `/api/status` (extended) | 1C | Add load history array |
| GET | `/api/vault/tree` | 2A | Directory tree JSON |
| GET | `/api/vault/file?path=...` | 2B | Read arbitrary vault file |
| POST | `/api/vault/file` | 2B | Write arbitrary vault file |
| GET | `/api/agents` | 3A | Active process list |
| GET | `/api/checkpoints/stream` | 3B | SSE stream for checkpoint queue |
| GET | `/api/checkpoints` | 3B | Current checkpoint queue |
| POST | `/api/checkpoints/:id` | 3B | Approve / deny a checkpoint |

---

## Out of Scope for v2

- Autonomous agent scheduling (v3)
- Code editor (use Cursor / terminal)
- AI chat sidebar
- Multi-user support

---

*Last updated: 2026-05-11*
