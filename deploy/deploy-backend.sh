#!/bin/bash
set -e

# Run directly on VPS (we ARE the VPS)
DEPLOY_DIR=/opt/pineapple-api
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "==> Building TypeScript..."
cd "$PROJECT_DIR/backend"
npm ci
npx tsc -p tsconfig.json

echo "==> Copying dist to $DEPLOY_DIR..."
sudo mkdir -p "$DEPLOY_DIR"
sudo rsync -av --delete dist/ "$DEPLOY_DIR/dist/"
sudo cp package.json package-lock.json "$DEPLOY_DIR/"

echo "==> Installing production deps..."
cd "$DEPLOY_DIR"
sudo npm ci --omit=dev

echo "==> Copying .env..."
sudo cp "$PROJECT_DIR/backend/.env" "$DEPLOY_DIR/.env"

echo "==> Restarting service..."
sudo systemctl restart pineapple-api
sleep 2
sudo systemctl status pineapple-api --no-pager -l

echo "==> Health check..."
curl -sf http://localhost:3456/health && echo " OK"

echo "Done!"
