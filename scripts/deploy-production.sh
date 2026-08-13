#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
SERVICE_NAME="${SERVICE_NAME:-moyi}"
PORT="${PORT:-3000}"
RUN_TESTS="${RUN_TESTS:-true}"
RUN_GIT_PULL="${RUN_GIT_PULL:-true}"
NODE_ENV="${NODE_ENV:-production}"
READY_TIMEOUT_SECONDS="${READY_TIMEOUT_SECONDS:-60}"

log() {
  printf '\n[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

fail() {
  printf '\nDeployment failed: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required but not installed."
}

cd "$APP_DIR" || fail "Cannot open app directory: $APP_DIR"

require_command node
require_command npm

log "Deploying Moyi-CMO from $APP_DIR"

if [ ! -f ".env" ]; then
  fail ".env is missing in $APP_DIR"
fi

if [ "$RUN_GIT_PULL" = "true" ] && [ -d ".git" ]; then
  require_command git
  log "Updating code with git pull --ff-only"
  git fetch origin
  current_branch="$(git rev-parse --abbrev-ref HEAD)"
  git pull --ff-only origin "$current_branch"
fi

log "Installing dependencies for build and validation"
if [ -f "package-lock.json" ]; then
  npm ci
else
  npm install
fi

log "Building distribution adapters"
npm run build:distribution

log "Validating production runtime configuration"
NODE_ENV=production node -e "require('./config/env').assertRuntimeConfig(); console.log('Runtime configuration is valid.');"

storage_path="$(NODE_ENV=production node -e "console.log(require('./config/env').contentImageStoragePath)")"
log "Preparing content image storage at $storage_path"
mkdir -p "$storage_path"

if [ "$(id -u)" -eq 0 ]; then
  service_user="${SERVICE_USER:-$(stat -c '%U' "$APP_DIR")}"
  service_group="${SERVICE_GROUP:-$(stat -c '%G' "$APP_DIR")}"
  chown -R "$service_user:$service_group" "$(dirname "$storage_path")"
else
  service_user="$(id -un)"
  service_group="$(id -gn)"
fi

chmod -R 755 "$(dirname "$storage_path")"
NODE_ENV=production node - <<'NODE'
const fs = require('fs');
const path = require('path');
const env = require('./config/env');
const testFile = path.join(env.contentImageStoragePath, `.moyi-write-test-${Date.now()}`);
fs.writeFileSync(testFile, 'ok');
fs.unlinkSync(testFile);
console.log('Content image storage is writable.');
NODE

if [ "$RUN_TESTS" = "true" ]; then
  log "Running test suite"
  npm test
fi

log "Pruning development dependencies for production runtime"
npm prune --omit=dev

if command -v systemctl >/dev/null 2>&1 && [ "$(id -u)" -eq 0 ]; then
  log "Installing or updating systemd service: $SERVICE_NAME"
  cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Moyi-CMO Web and Worker
After=network.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
Environment=PORT=${PORT}
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
User=${service_user}
Group=${service_group}

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME"
  systemctl restart "$SERVICE_NAME"
  sleep 3
  systemctl --no-pager --full status "$SERVICE_NAME" || true
else
  log "systemd root access not available; starting app in the current shell"
  exec npm start
fi

log "Checking local readiness"
ready_url="http://127.0.0.1:${PORT}/readyz"
ready_deadline=$((SECONDS + READY_TIMEOUT_SECONDS))
ready_response=""

while [ "$SECONDS" -lt "$ready_deadline" ]; do
  if ready_response="$(curl -fsS "$ready_url" 2>/dev/null)"; then
    if printf '%s' "$ready_response" | grep -q '"status":"ready"'; then
      log "Readiness confirmed on $ready_url"
      log "Moyi-CMO deployment complete and ready."
      exit 0
    fi
  else
    ready_response="Waiting for web server to accept connections on $ready_url"
  fi

  sleep 2
done

if ! printf '%s' "$ready_response" | grep -q '"status":"ready"'; then
  printf '%s\n' "$ready_response"
  if command -v systemctl >/dev/null 2>&1 && [ "$(id -u)" -eq 0 ]; then
    systemctl --no-pager --full status "$SERVICE_NAME" || true
    journalctl -u "$SERVICE_NAME" --no-pager -n 80 || true
  fi
  fail "Moyi did not report ready on http://127.0.0.1:${PORT}/readyz"
fi

log "Moyi-CMO deployment complete and ready."
