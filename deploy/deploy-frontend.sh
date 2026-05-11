#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "==> Deploying frontend to Vercel..."
cd "$PROJECT_DIR/frontend"
vercel --prod
echo "Done! Check https://pineapple.lexitools.tech"
