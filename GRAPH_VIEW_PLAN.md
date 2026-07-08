---
tags:
  - pineapple-os
---
# Pineapple OS — Vault Graph View (Graphify)

**Status:** Shipped 2026-07-08 (wikilink-parser fallback; graphifyy pending an Anthropic API key) · Planned 2026-07-07
**Goal:** An Obsidian-style interactive graph view of the vault inside Pineapple OS — a visual "second AI brain."
**Powered by:** [Graphify](https://github.com/Graphify-Labs/graphify) (PyPI `graphifyy`) — CLI that turns a folder of markdown into a knowledge graph (`graph.json` + report). Reference: [Chase AI video](https://www.youtube.com/watch?v=HRw-vP0j8OM).

---

## Decisions

| Question | Decision |
|---|---|
| Rendering | Custom React graph (`react-force-graph-2d`) themed to Pineapple's navy/electric aesthetic — not an iframe of Graphify's HTML |
| Layout | **Both**: full-width Graph view toggled from the NavBar + a 4th sidebar tab with a mini *local graph* of the open note |
| AI query box | Not in scope — visual graph only (questions stay in the terminal / Claude Code) |
| Refresh | Nightly cron on the VPS + manual "Rebuild" button (Graphify's markdown pass costs LLM tokens, so no auto-rebuild on file change) |

## Architecture

```
VPS (76.13.223.10)
├── /data/obsidian ──────── vault (source)
├── graphifyy CLI ────────► graph.json  (nightly systemd timer + manual trigger)
├── pineapple-api :3456 ──► GET /api/vault/graph   (serves transformed nodes/edges)
│                           POST /api/vault/graph/rebuild + GET .../status
└── Traefik → pineapple-api.lexitools.tech

Vercel
└── pineapple.lexitools.tech ── GraphView tab (react-force-graph-2d, authFetch + Supabase JWT)
```

Graph output lives at `/opt/pineapple-api/graph-cache/` — **not inside the vault** (avoids Syncthing churn).

---

## Phase 0 — Evaluate Graphify on the VPS (de-risk)

- [x] Install on VPS: `uv tool install graphifyy` (or `pipx install graphifyy`) — neither uv nor pipx installed; used `pip3 install --user --break-system-packages graphifyy` (v0.9.9, binary is `graphify` in `~/.local/bin`)
- [ ] Run against **scoped vault content only**: `wiki/`, `raw/`, `memory/`, `logs/`, and markdown under `projects/` — exclude `node_modules`, `dist`, `.git`, `.trash`, code-heavy dirs (keeps token cost sane) — *not run: `graphify extract` hard-requires `ANTHROPIC_API_KEY`*
- [ ] Configure its LLM provider with the Anthropic API key — *no Anthropic API key exists anywhere on the VPS (checked `~/.claude/settings.json`, environment, backend `.env`, `secrets/master.env`)*
- [ ] Inspect `graph.json` schema — confirm notes become nodes and `[[wikilinks]]` become edges
- [x] **Fallback if wikilinks aren't first-class:** add a deterministic wikilink/frontmatter parser in the backend (free, no LLM) and merge those edges in, tagged `source: 'wikilink'` alongside Graphify's `EXTRACTED`/`INFERRED` confidence tags — *full fallback path taken (`backend/src/graphBuild.ts`); all edges are `sourceType: 'wikilink'`, communities = top-level folder*
- [x] Record build time, token cost per rebuild, and output size — this locks the node/edge transform for Phase 1 — *288 nodes, 33 edges, ~86–144 ms, 0 LLM tokens (deterministic), 64.7 KB graph.json*

**Verify:** `graph.json` exists, opens, and its nodes/edges map sensibly to real vault notes.

## Phase 1 — Backend: graph pipeline + API

- [x] New `backend/src/graph.ts` (mirror the structure of `memory.ts`):
  - `GET /api/vault/graph` → `{ nodes, edges, meta: { builtAt, nodeCount, edgeCount, communities } }` from the cached `graph.json` — nodes: `id, label, folder, community, degree`; edges: `source, target, confidence`
  - `POST /api/vault/graph/rebuild` → spawns the Graphify CLI (child process, non-blocking, single-flight lock) — *spawns `dist/graphBuild.js` (fallback parser) instead of the Graphify CLI*
  - `GET /api/vault/graph/status` → rebuild job state for polling
- [x] Register routes in `backend/src/index.ts` behind `requireAuth` (keep the fail-closed email allowlist)
- [x] Rebuild script in `deploy/` + systemd timer for the nightly build (same pattern as `pineapple-api.service`) — *`deploy/rebuild-graph.sh` + `pineapple-graph-rebuild.service/.timer` (files written, timer not yet enabled)*

**Verify:** authenticated `curl` to all three endpoints returns correct data; rebuild lock prevents concurrent runs.

## Phase 2 — Frontend: full-width Graph view

- [x] Add `react-force-graph-2d` (canvas-based, smooth at 1k+ nodes, d3-force layout)
- [x] New `frontend/src/components/GraphView.tsx`; new `getVaultGraph()` / `rebuildVaultGraph()` / `getGraphStatus()` in `frontend/src/lib/api.ts` via `authFetch`
- [x] NavBar view toggle (`Terminal ⇄ Graph`); `viewMode` state in `Dashboard.tsx`, persisted to localStorage (same pattern as `pineapple-sidebar-tab`), swaps the whole main area
- [x] Obsidian-style interactions:
  - Hover → dim non-neighbors, highlight 1-hop neighborhood
  - Click node → switch to Files sidebar tab and open the note in `VaultEditor`
  - Drag / zoom / pan; search box to filter and center on a node
  - Node color by Leiden community (theme-consistent hues); node size by degree
- [x] Theming via CSS variables (`--c-accent` etc.) so it follows the Indigo/Brass toggle; dark canvas matching the mission-control aesthetic
- [x] Mobile (`MobileDashboard`): read-only pan/zoom graph, or a "view on desktop" card — decide by feel — *read-only pan/zoom graph as a third mobile tab (`MobileGraphView.tsx`)*

**Verify:** local `npm run dev` against the live API — graph loads, hover/click/search behave, both themes look right.

## Phase 3 — Sidebar mini local-graph

- [x] Extend `SidebarTab` union in `Dashboard.tsx` with `'graph'`; add to the tab array, `loadSidebarTab()` allowlist, and render block
- [x] New `frontend/src/components/LocalGraph.tsx`: client-side filter of the already-fetched graph to the open note's 1–2 hop neighborhood; click a neighbor → open it in the editor
- [x] Empty state when no note is open

**Verify:** opening different notes updates the local graph; navigation via node click works.

## Phase 4 — Refresh UX + deploy

- [x] "Rebuild graph" button in GraphView with progress state (poll `/status`)
- [x] "Built X hours ago" staleness indicator from `meta.builtAt`
- [x] Enable the nightly systemd timer — *enabled 2026-07-08, next run 03:30 UTC; test-fired clean (289 nodes / 33 edges, 120ms)*
- [x] Deploy **backend first** (`deploy/deploy-backend.sh`, wait for health check), **then** frontend (`deploy/deploy-frontend.sh` — `cd` into the project dir first) — *both live 2026-07-08*

**Verify:** end-to-end on `pineapple.lexitools.tech` — graph renders, rebuild button works, next-morning graph reflects yesterday's vault edits.

---

## Files touched

| Area | Files |
|---|---|
| Backend | `backend/src/graph.ts` (new), `backend/src/index.ts` |
| Deploy | `deploy/` rebuild script + systemd timer (new) |
| Frontend | `components/GraphView.tsx`, `components/LocalGraph.tsx` (new); `lib/api.ts`, `pages/Dashboard.tsx`, `components/NavBar.tsx`, `components/MobileDashboard.tsx`, `package.json` |

## Out of scope (future ideas)

- AI query panel over the graph (Graphify query modes) — deliberately deferred
- Cross-project graphs / merging multiple corpora
- Graph-diff view showing what a session changed
