#!/bin/bash
set -e

# Rebuilds the vault graph cache. Invoked by the pineapple-graph-rebuild
# systemd timer (nightly) and by the API's rebuild endpoint (via graph.ts).
DEPLOY_DIR=/opt/pineapple-api

cd "$DEPLOY_DIR"
node dist/graphBuild.js
