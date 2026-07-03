---
tags:
  - plan
  - security
project: Pineapple OS
created: 2026-07-03
---

# Pineapple OS — Security Hardening + Input-Lag Plan

Author: Claude (Fable 5, planning). Execution: Sonnet 5 subagents, one per phase.
Trigger: Sid asked to "find security flaws and improve input lag, break into phases,
execute with Sonnet 5, update logs after each phase, commit + push."

> **Scope note:** This plan **commits and pushes** each phase to `origin/main`. It does
> **not** redeploy. Deployment is a separate step gated behind the phrase
> *"deploy the new pineapple os"* (see `logs/2026/06/2026-06-19-pineapple-agentic-os-v2.md`
> DEPLOY RUNBOOK). Nothing here reaches production until that runbook is run.

---

## Findings (why this plan exists)

### Security

| # | Sev | Where | Flaw |
|---|-----|-------|------|
| S1 | **Critical** | `backend/src/auth.ts`, `index.ts` (WS upgrade) | Auth accepts **any** validly-signed Supabase JWT from the project. No user allowlist. Supabase signup is open (project shared with Mission Control), so anyone who registers gets a full `/bin/bash` PTY in `/data/obsidian`, read/write of every vault file, and `SIGTERM` of any PID. Effective public RCE. |
| S2 | **High** | `backend/src/terminal.ts`, `terminalHttp.ts` | PTY spawns with `env: process.env` → shell exposes `SUPABASE_JWT_SECRET`, `SYNCTHING_API_KEY`, and can read other projects' `.env` (Mission Control service-role key). |
| S3 | Medium | `backend/src/index.ts` | CORS falls back to `origin: '*'` when `ALLOWED_ORIGINS` is unset. |
| S4 | Low | `backend/src/vault.ts` | `resolveVaultPath` blocks `..` but does not `realpath`; a symlink inside the vault can escape the root. |
| S5 | Low | `backend/src/auth.ts`, `index.ts` | JWT verified for signature only — no `aud === 'authenticated'` / role check. |

### Input lag

Live `pineapple-api` logs (2026-07-03 ~04:46–04:56) show a **reconnect storm**: ~70 WS
connections, each `[PTY] spawned` then `[WS] close code 1006` **in the same second**, on a
~7s cadence. This is not the old Traefik idle-timeout (fixed 2026-06-10 via ping keepalive) —
those closures were 60s apart. This is connection **churn**: the terminal keeps tearing down
and reconnecting, which the user experiences as lag / "Connecting…" flicker. Suspected cause:
`Terminal.tsx` mount effect depends on six callbacks + overlapping `connect()` calls, amplified
by React `StrictMode` double-invoke; an opened socket is immediately closed by a second
`connect()`'s `disconnectWs()`, firing the 3s reconnect countdown in a loop.

---

## Phase 1 — Critical & high security fixes (backend)

**Goal:** Close the public-RCE hole and stop secret leakage. Backend only.

1. **User allowlist (fixes S1).**
   - New env var `ALLOWED_USER_EMAILS` (comma-separated, lowercased). Add to `backend/.env.example`
     with a comment; real value goes in `backend/.env` on the VPS (default to `siddu97pop@gmail.com`
     if the var is present locally — do **not** commit the real `.env`).
   - In `auth.ts`, after `jwt.verify`, extract `email` (and `sub`) from the decoded token and reject
     with `403` if the email is not in the allowlist. Export a shared `isAllowedUser(decoded)` helper.
   - In `index.ts` WS `upgrade` handler, apply the same allowlist check after `jwt.verify` and reject
     with `403` (do not upgrade) when not allowed.
   - **Fail closed:** if `ALLOWED_USER_EMAILS` is empty/unset, reject everyone (log a clear warning
     once at startup). This guarantees the deployed service is never wide-open.

2. **Verify `aud`/`role` (fixes S5).** Pass `audience: 'authenticated'` to `jwt.verify` in both
   `auth.ts` and the WS handler (Supabase user tokens carry `aud: "authenticated"`).

3. **Sanitize PTY env (fixes S2).** Add a `buildPtyEnv()` helper (shared or duplicated in
   `terminal.ts` + `terminalHttp.ts`) that clones `process.env` minus a denylist:
   `SUPABASE_JWT_SECRET`, `SUPABASE_JWT_PUBLIC_KEY`, `SYNCTHING_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   (and any `*_SECRET` / `*_SERVICE_ROLE*` / `*_JWT*` by pattern). Spawn PTYs with the sanitized env.

4. **CORS default-closed (fixes S3).** If `ALLOWED_ORIGINS` is unset, use the known prod origin
   `https://pineapple.lexitools.tech` rather than `*`.

**Verify:** `cd backend && npx tsc --noEmit` clean. Add a tiny node smoke check that a non-allowlisted
decoded token is rejected by `isAllowedUser` and an allowlisted one passes (inline script, no test
framework needed). Do **not** restart/redeploy the live service.

**Out of scope for Phase 1:** frontend changes, S4 (moved to Phase 2).

---

## Phase 2 — Path hardening + input-lag / connection stability

**Goal:** Stop the reconnect churn (primary lag symptom) and close the symlink escape.

1. **Symlink containment (fixes S4).** In `vault.ts`, after resolving, `fs.realpath` the target
   (and its parent dir for writes to not-yet-existing files) and re-assert it is within
   `realpath(VAULT_ROOT)`. Reject with `400` otherwise. Keep behaviour identical for legitimate paths.

2. **Terminal lifecycle (input lag).**
   - Collapse the mount `useEffect` in `Terminal.tsx` so it runs **once** (`[]` deps) using refs for
     the callbacks it calls, instead of listing six changing callbacks — this stops full teardown +
     PTY respawn on incidental re-renders.
   - Add a `connectingRef` guard so overlapping `connect()` calls can't close a socket that a prior
     call just opened (the 1006-in-the-same-second signature).
   - Make `disconnectWs()` close with a normal code (1000) so intentional teardowns aren't logged as
     abnormal, and so the server can distinguish user-close from transport-drop.
   - Leave the WS-primary / HTTP-fallback design intact (per-keystroke single-frame is already optimal);
     this phase removes churn, it does not change the transport.

**Verify:** `cd frontend && npm run build` passes. Then a real-browser pass with `agent-browser`:
log into `pineapple.lexitools.tech` **is not required** (no deploy yet) — instead run `npm run preview`
locally, load it, open the terminal, and confirm in the backend dev log (or a local run) that a single
PTY is spawned and stays open with **no 1006 storm** over ~90s idle + typing. If a full local backend
run isn't feasible, document the expected log signature to check post-deploy.

---

## Per-phase ritual (both phases)

1. Sonnet executes the phase (surgical edits only, match existing style).
2. Build/verify as specified above.
3. Fable updates logs: one 2–3 line entry in `logs/sessions.md` + a detailed file
   `logs/2026/07/2026-07-03-pineapple-<phase>.md`.
4. Commit staged phase files only (do not sweep unrelated uncommitted work) and `git push` to
   `origin/main` over SSH (`git@github.com:siddu97pop/pineapple-OS.git`).

## After both phases

- Update `memory/projects.md` Pineapple OS block with a security note + "not yet deployed".
- Remind Sid: to go live, add `ALLOWED_USER_EMAILS` to the VPS `backend/.env` **and** disable open
  signup in Supabase, then run the DEPLOY RUNBOOK (backend first). Until deployed, prod is still open.
