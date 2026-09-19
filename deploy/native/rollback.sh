#!/usr/bin/env bash
set -euo pipefail
target="$(readlink -f /opt/open-ai-canvas/previous 2>/dev/null || true)"
current="$(readlink -f /opt/open-ai-canvas/current 2>/dev/null || true)"
[[ -n "$target" && -x "$target/open-ai-canvas-backend" ]] || { echo 'no previous release' >&2; exit 1; }
ln -sfn "$target" /opt/open-ai-canvas/current.next
mv -Tf /opt/open-ai-canvas/current.next /opt/open-ai-canvas/current
systemctl restart open-ai-canvas-backend.service open-ai-canvas-web.service
if curl --fail --silent --max-time 5 http://127.0.0.1:8080/api/health >/dev/null && curl --fail --silent --max-time 5 http://127.0.0.1:3000/healthz >/dev/null; then
    ln -sfn "$current" /opt/open-ai-canvas/previous
    echo 'rollback complete'
else
    ln -sfn "$current" /opt/open-ai-canvas/current.next
    mv -Tf /opt/open-ai-canvas/current.next /opt/open-ai-canvas/current
    systemctl restart open-ai-canvas-backend.service open-ai-canvas-web.service || true
    exit 1
fi
