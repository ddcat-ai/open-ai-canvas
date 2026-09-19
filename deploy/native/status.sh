#!/usr/bin/env bash
set -euo pipefail
systemctl --no-pager --full status open-ai-canvas-backend.service open-ai-canvas-web.service || true
curl --fail --silent http://127.0.0.1:8080/api/health
printf '\n'
curl --fail --silent http://127.0.0.1:3000/healthz
printf '\n'
