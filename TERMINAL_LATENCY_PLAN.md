---
tags:
  - project
  - pineapple-os
  - performance
project: Pineapple OS
created: 2026-08-19
---

# Pineapple OS — Terminal Latency Optimization Plan

## Current diagnosis

The current production typing path is falling back to HTTP. Live `pineapple-api`
logs on 2026-08-17 and 2026-08-19 show:

1. WebSocket JWT verification succeeds.
2. A PTY is spawned.
3. The WebSocket closes with code `1006` immediately.
4. The frontend starts an `[HTTP-PTY]` session roughly one second later.

The fallback sends input through an authenticated HTTP POST and receives PTY echo
through a separate long-poll response. Its input requests are intentionally
serialized so fast typing cannot arrive out of order. That protects correctness,
but creates head-of-line blocking when several characters are typed within one
network round trip. The WebSocket path remains the highest-value fix: it verifies
the JWT once, keeps one connection open, and sends input/output as frames.

The exact browser-side cause of the immediate `1006` is not yet proven. The
backend does not currently record whether the socket opened, whether the first
PTY frame was delivered, or whether the close came from the browser, proxy, or a
frontend teardown. The historical Traefik idle-timeout issue is separately
mitigated by 30-second server pings, and cannot explain an immediate close.

## What has already been tried

| Date | Attempt | Result |
|---|---|---|
| 2026-05-11 | Disabled WebSocket compression, guarded zero-size resize, switched PTY output to binary frames, wrapped `onopen`, suppressed PTY output, removed side panels | No change; browser still closed with `1006` immediately |
| 2026-05-11 | Added HTTP PTY start/poll/input/resize/stop fallback | Made the terminal usable in production |
| 2026-05-12 | Added a 10-minute HTTP session idle reaper | Fixed leaked HTTP PTYs exhausting the five-session limit |
| 2026-05-21 | Retried WebSockets | Failed again with persistent `1006`; reverted |
| 2026-05-21 | Removed the 8 ms HTTP input debounce and added xterm WebGL rendering | Reduced the known artificial delay; user confirmed the HTTP path worked |
| 2026-06-10 | Added 30-second WS ping/pong keepalive for Traefik's 60-second read timeout; restored WS-primary with HTTP fallback; serialized fallback input | Direct Node and browser tests held WS idle for about 100 seconds and echoed correctly |
| 2026-07-03 | Made terminal mount initialization one-shot, added callback refs and an overlapping-connect guard, and used normal close code `1000` for intentional teardown | Deployed as the reconnect-churn fix; a logged-in production pass was not possible in that session |
| 2026-07-07 | Added node-pty error listeners and an ErrorBoundary | Fixed tab-close crashes; not a typing-latency fix |

## Optimization phases

### Phase 0 — Instrument the actual production path

Add temporary, privacy-safe timing telemetry. Never log JWTs or input text.

- Browser: record WebSocket construction, `onopen`, first message, `onerror`,
  `onclose` code/reason, fallback start, selected transport, and terminal/tab id.
- Backend: record upgrade-to-connection time, first PTY output, first client
  message/pong, close code/reason, and session lifetime.
- HTTP: record endpoint duration and status for `start`, `poll`, `input`,
  `resize`, and `stop`; sample or aggregate rather than logging every character
  permanently.
- Test one fresh tab, a second tab, refresh, 15 minutes idle, and bursts of
  typing in the same logged-in Chrome session. Capture a HAR and console errors.

Exit criteria: identify whether the socket closes before `onopen`, after
`onopen` but before first output, or during xterm/frontend teardown. Also record
WS success rate and p50/p95 key-to-echo latency.

### Phase 1 — Restore WebSocket as the normal transport

Fix the measured failure rather than changing transports speculatively.

- If the browser closes before `onopen`, inspect the cross-subdomain/proxy path
  and the browser's Network/Console reason. Validate Traefik's WebSocket route
  and TLS path with a current authenticated probe.
- If it opens and then closes, audit `Terminal.tsx` cleanup, stale socket
  ownership, tab switching, React StrictMode behaviour, xterm/WebGL activation,
  and the first PTY frame separately.
- Give every connection attempt an id and make handlers ignore stale sockets.
  Ensure fallback closes/invalidates the failed socket before starting HTTP.
- Keep the 30-second ping/pong. Only add a Pineapple-specific Traefik timeout
  override if an idle test proves the proxy is still involved; do not loosen the
  global entrypoint timeout.

Exit criteria: at least 99% of normal production sessions use WS; one PTY stays
open through 15 minutes idle plus typing; no immediate `1006` storm; p95 key-to-
echo latency is within one measured RTT plus 10 ms.

### Phase 2 — Make fallback tolerable when WebSockets are unavailable

Treat this as a compatibility path, not the primary performance solution.

- Replace repeated long-poll output with an authenticated SSE output stream and
  heartbeat. This removes poll request churn while retaining a simple HTTP input
  endpoint.
- Consider a short-lived, random, user-scoped terminal capability issued by the
  authenticated `start` call. Use expiry, idle revocation, and session binding
  so every keystroke does not require a full ES256 JWT verification. Review this
  as a security change before implementation.
- Keep input ordering explicit. First measure the current serializer; if it is
  the dominant cost, use a small frame/batch window or sequence-numbered server
  queue rather than allowing unordered HTTP writes.
- Keep the current idle reaper and add cleanup on browser `pagehide` as a best
  effort, without relying on it for correctness.

Exit criteria: fallback p95 latency is measured and bounded, fast typing never
transposes characters, no more than one HTTP PTY exists per terminal tab, and
session cleanup is observable.

### Phase 3 — Profile xterm and multi-tab rendering

Only pursue this after Phase 1 confirms the transport is stable.

- Use Chrome performance profiling while the active terminal receives heavy
  Claude output and while typing.
- Combine adjacent PTY events before `term.write` where safe.
- Do not parse/render output for hidden terminal tabs in real time; buffer a
  bounded amount and flush when a tab becomes active. All PTYs can remain alive.
- Verify WebGL context-loss handling and measure with WebGL enabled and fallback
  canvas rendering. Reduce scrollback only if memory or parser work is proven to
  matter.

Exit criteria: no long main-thread tasks during typing, hidden tabs do not affect
active-tab echo latency, and xterm rendering is not the limiting stage.

### Phase 4 — Isolate PTY workloads from the API process

The VPS had a global OOM event on 2026-08-16. Kernel records show large
Chromium/OpenClaw/Python workloads; the current Pineapple systemd cgroup also
contains PTY descendants and their child tools. This is a reliability risk even
though the Node process itself is currently about 66 MB RSS.

- Measure memory by API process, PTY shell, and descendants separately.
- Prevent a large Claude/Codex/browser child launched from a Pineapple PTY from
  taking down the API process and every terminal. Evaluate a transient systemd
  scope or a separate PTY broker with per-session limits.
- Keep global host/OOM work separate from terminal transport work; do not claim
  the Aug-16 event was a Node memory leak without process-level evidence.

Exit criteria: an agent workload cannot kill the API control plane, and a
resource incident leaves a clear per-session log rather than silently dropping
all terminal connections.

## Implementation status — 2026-08-19

- Phase 0/1: added browser and backend WS lifecycle timing, stale-attempt
  invalidation, normal timeout teardown, and first-output/first-message metrics.
- Phase 2: added a persistent SSE output stream with heartbeats and a random,
  hashed per-terminal capability issued after the initial JWT-authenticated
  start. JWT compatibility remains for older bundles during rollout.
- Phase 3: hidden terminal tabs now buffer bounded output until activation,
  avoiding continuous xterm parsing/rendering in inactive tabs.
- Phase 4: Linux PTYs now run inside transient systemd scopes with configurable
  `PTY_MEMORY_MAX` and `PTY_TASKS_MAX` limits. The scope behavior was verified
  with an interactive node-pty smoke test.

The full authenticated browser canary remains the final user-facing check after
deployment because this session does not have Sid's login credentials.

## Recommended execution order

1. Phase 0 instrumentation and one authenticated browser reproduction.
2. Phase 1 WebSocket fix, with a production canary and rollback.
3. Phase 3 hidden-tab/rendering profile if typing is still slow on WS.
4. Phase 2 SSE/capability-token fallback for networks where WS genuinely cannot
   work.
5. Phase 4 PTY resource isolation as a separate reliability project.

The implementation is ready for backend-first deployment and a logged-in
browser check. No unrelated application areas were changed.
