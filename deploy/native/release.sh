#!/usr/bin/env bash
set -euo pipefail

OPS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$OPS_DIR/config" ]]; then source "$OPS_DIR/config"; fi
REPO_DIR="${REPO_DIR:-/root/open-ai-canvas}"
LOCK_FILE=/var/lock/open-ai-canvas-deploy.lock
GO_BIN="/opt/open-ai-canvas/toolchains/go1.25.0/bin/go"
BUN_BIN="/opt/open-ai-canvas/toolchains/bun1.3.9/bun"

[[ "${EUID}" == 0 ]] || { echo 'run as root' >&2; exit 1; }
cd "$REPO_DIR"
exec 9>"$LOCK_FILE"
flock -n 9 || { echo 'another deployment is running' >&2; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo 'refusing to deploy a dirty checkout' >&2; exit 1; }
[[ "$(git branch --show-current)" == main ]] || { echo 'deployment checkout must be on main' >&2; exit 1; }
git pull --ff-only origin main
revision="$(git rev-parse HEAD)"
short_revision="${revision:0:12}"
release="/opt/open-ai-canvas/releases/$(date -u +%Y%m%dT%H%M%SZ)-${short_revision}"
previous="$(readlink -f /opt/open-ai-canvas/current 2>/dev/null || true)"
build_dir="$(mktemp -d /tmp/open-ai-canvas-build.XXXXXX)"
trap 'rm -rf "$build_dir"' EXIT

[[ -x "$GO_BIN" && -x "$BUN_BIN" ]] || { echo 'toolchain missing; run server-setup.sh first' >&2; exit 1; }
export PATH="$(dirname "$GO_BIN"):$(dirname "$BUN_BIN"):$PATH"
export CGO_ENABLED=1

cd "$REPO_DIR/web"
"$BUN_BIN" install --frozen-lockfile
CANVAS_BUILD_VERSION="$revision" "$BUN_BIN" run build
cd "$REPO_DIR/backend"
"$GO_BIN" test ./...
"$GO_BIN" build -trimpath -ldflags "-s -w -X infinite-canvas/backend/internal/buildinfo.Version=${revision} -X infinite-canvas/backend/internal/buildinfo.Commit=${revision} -X infinite-canvas/backend/internal/buildinfo.BuildTime=$(date -u +%FT%TZ)" -o "$build_dir/open-ai-canvas-backend" ./cmd/server
cd "$REPO_DIR/deploy/native/web-server"
"$GO_BIN" build -trimpath -ldflags "-s -w" -o "$build_dir/open-ai-canvas-web" .

install -d -m 0755 "$release"
install -m 0755 "$build_dir/open-ai-canvas-backend" "$release/open-ai-canvas-backend"
install -m 0755 "$build_dir/open-ai-canvas-web" "$release/open-ai-canvas-web"
cp -a "$REPO_DIR/web/dist" "$release/dist"
cp -a "$REPO_DIR/plugin-packages" "$release/plugin-packages"
printf '%s\n' "$revision" >"$release/REVISION"
chmod -R a+rX "$release"

umask 077
backup="/var/backups/open-ai-canvas/pre-${short_revision}-$(date -u +%Y%m%dT%H%M%SZ).dump"
runuser -u postgres -- pg_dump -Fc -d open_ai_canvas >"$backup"
[[ -s "$backup" ]] || { echo 'database backup failed' >&2; exit 1; }

ln -sfn "$release" /opt/open-ai-canvas/current.next
mv -Tf /opt/open-ai-canvas/current.next /opt/open-ai-canvas/current
systemctl restart open-ai-canvas-backend.service
systemctl restart open-ai-canvas-web.service
ready=false
for attempt in $(seq 1 60); do
    if curl --fail --silent --max-time 3 http://127.0.0.1:8080/api/health >/dev/null && curl --fail --silent --max-time 3 http://127.0.0.1:3000/healthz >/dev/null; then ready=true; break; fi
    sleep 1
done
if [[ "$ready" != true ]]; then
    if [[ -n "$previous" && -x "$previous/open-ai-canvas-backend" ]]; then
        ln -sfn "$previous" /opt/open-ai-canvas/current.next
        mv -Tf /opt/open-ai-canvas/current.next /opt/open-ai-canvas/current
        systemctl restart open-ai-canvas-backend.service open-ai-canvas-web.service || true
    fi
    echo 'health check failed; previous release restored when available' >&2
    exit 1
fi
if [[ -n "$previous" ]]; then ln -sfn "$previous" /opt/open-ai-canvas/previous; fi
printf '%s %s %s\n' "$(date -u +%FT%TZ)" "$revision" "$release" >> /var/lib/open-ai-canvas/releases.log
printf 'deployed %s\n' "$revision"
