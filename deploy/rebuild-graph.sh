#!/bin/bash
set -e

# Rebuilds the vault graph cache, then refreshes the semantic search index.
# Invoked by the pineapple-graph-rebuild systemd timer (nightly) and by the
# API's rebuild endpoint (via graph.ts).
DEPLOY_DIR=/opt/pineapple-api

cd "$DEPLOY_DIR"
node dist/graphBuild.js

# Vector ingest is deliberately non-fatal: the graph is the primary artifact and
# must not be reported as failed because embedding had a bad night. Only chunks
# whose content_hash changed are re-embedded, so a normal run is a few seconds.
# The heap cap matters — the unbounded default got this OOM-killed on the 2 vCPU
# VPS during the initial full build.
if ! node --max-old-space-size=2048 dist/vectorIngest.js; then
  echo "[rebuild-graph] vector ingest failed — graph is still current" >&2
fi
