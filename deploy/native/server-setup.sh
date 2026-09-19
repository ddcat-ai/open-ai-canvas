#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${REPO_DIR:-/root/open-ai-canvas}"
OPS_DIR="${OPS_DIR:-/root/open-ai-canvas-ops}"
APP_USER="openaicanvas"
APP_GROUP="openaicanvas"
APP_DOMAIN="${APP_DOMAIN:-canvas.yingpix.com}"
GO_VERSION="1.25.0"
BUN_VERSION="1.3.9"

[[ "${EUID}" == 0 ]] || { echo 'run as root' >&2; exit 1; }
[[ -d "$REPO_DIR/.git" ]] || { echo "missing repository: $REPO_DIR" >&2; exit 1; }
cd "$REPO_DIR"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl gcc git openssl pkg-config postgresql-client-16 unzip xz-utils

install -d -m 0755 /opt/open-ai-canvas/toolchains /opt/open-ai-canvas/releases
go_root="/opt/open-ai-canvas/toolchains/go${GO_VERSION}"
if [[ ! -x "$go_root/bin/go" ]]; then
    tmp_dir="$(mktemp -d)"
    curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" -o "$tmp_dir/go.tar.gz"
    rm -rf "$go_root"
    mkdir -p "$go_root"
    tar -xzf "$tmp_dir/go.tar.gz" -C "$tmp_dir"
    mv "$tmp_dir/go"/* "$go_root"/
    rm -rf "$tmp_dir"
fi

bun_bin="/opt/open-ai-canvas/toolchains/bun${BUN_VERSION}/bun"
if [[ ! -x "$bun_bin" ]]; then
    tmp_dir="$(mktemp -d)"
    curl -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-x64.zip" -o "$tmp_dir/bun.zip"
    unzip -q "$tmp_dir/bun.zip" -d "$tmp_dir"
    install -d -m 0755 "$(dirname "$bun_bin")"
    install -m 0755 "$tmp_dir/bun-linux-x64/bun" "$bun_bin"
    rm -rf "$tmp_dir"
fi

if ! getent group "$APP_GROUP" >/dev/null; then groupadd --system "$APP_GROUP"; fi
if ! id "$APP_USER" >/dev/null 2>&1; then useradd --system --gid "$APP_GROUP" --home-dir /var/lib/open-ai-canvas --shell /usr/sbin/nologin "$APP_USER"; fi
install -d -m 0755 /opt/open-ai-canvas/releases
install -d -m 0750 -o "$APP_USER" -g "$APP_GROUP" /var/lib/open-ai-canvas /var/lib/open-ai-canvas/data /var/lib/open-ai-canvas/data/uploads
install -d -m 0750 -o root -g "$APP_GROUP" /etc/open-ai-canvas
install -d -m 0700 /var/backups/open-ai-canvas

env_file=/etc/open-ai-canvas/production.env
if [[ ! -f "$env_file" ]]; then
    db_role=open_ai_canvas
    db_name=open_ai_canvas
    role_exists="$(runuser -u postgres -- psql -X -Atqc "SELECT 1 FROM pg_roles WHERE rolname='${db_role}'")"
    db_exists="$(runuser -u postgres -- psql -X -Atqc "SELECT 1 FROM pg_database WHERE datname='${db_name}'")"
    [[ -z "$role_exists" && -z "$db_exists" ]] || { echo 'database or role already exists without deployment env; refusing to guess credentials' >&2; exit 1; }
    db_password="$(openssl rand -hex 32)"
    runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -c "CREATE ROLE ${db_role} LOGIN PASSWORD '${db_password}'"
    runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${db_name} OWNER ${db_role}"
    runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -c "REVOKE CONNECT ON DATABASE ${db_name} FROM PUBLIC; GRANT CONNECT ON DATABASE ${db_name} TO ${db_role}"
    umask 077
    cat >"$env_file" <<EOF
APP_ENV=prod
CANVAS_DATABASE_DRIVER=postgres
DATABASE_URL=postgres://${db_role}:${db_password}@127.0.0.1:5432/${db_name}?sslmode=disable
CANVAS_BACKEND_ADDR=127.0.0.1:8080
CANVAS_BACKEND_DATA_DIR=/var/lib/open-ai-canvas/data
CANVAS_AUTO_MIGRATE=true
CANVAS_REGISTRATION_ENABLED=true
CANVAS_CORS_ORIGINS=https://${APP_DOMAIN}
CANVAS_PUBLIC_BASE_URL=https://${APP_DOMAIN}
CANVAS_ALLOW_PRIVATE_UPSTREAMS=false
CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS=
CANVAS_OFFICIAL_PLUGIN_DIR=/opt/open-ai-canvas/current/plugin-packages
EOF
    chown root:"$APP_GROUP" "$env_file"
    chmod 0640 "$env_file"
fi

install -m 0644 deploy/native/systemd/open-ai-canvas-backend.service /etc/systemd/system/open-ai-canvas-backend.service
install -m 0644 deploy/native/systemd/open-ai-canvas-web.service /etc/systemd/system/open-ai-canvas-web.service
install -d -m 0755 /etc/caddy/sites
caddy_site=/etc/caddy/sites/open-ai-canvas.caddy
if [[ -f "$caddy_site" ]]; then cp -p "$caddy_site" "${caddy_site}.bak-$(date -u +%Y%m%dT%H%M%SZ)"; fi
sed "s/canvas\.yingpix\.com/${APP_DOMAIN}/g" deploy/native/caddy/open-ai-canvas.caddy >"$caddy_site"
chmod 0644 "$caddy_site"
if ! grep -Fqx "import ${caddy_site}" /etc/caddy/Caddyfile; then printf '\nimport %s\n' "$caddy_site" >> /etc/caddy/Caddyfile; fi

install -d -m 0750 "$OPS_DIR"
install -m 0750 deploy/native/release.sh "$OPS_DIR/release.sh"
install -m 0750 deploy/native/rollback.sh "$OPS_DIR/rollback.sh"
install -m 0750 deploy/native/status.sh "$OPS_DIR/status.sh"
install -m 0640 deploy/native/README-OPS.md "$OPS_DIR/README.md"
cat >"$OPS_DIR/config" <<EOF
REPO_DIR=${REPO_DIR}
APP_DOMAIN=${APP_DOMAIN}
EOF
chown -R root:root "$OPS_DIR"

systemctl daemon-reload
systemctl enable open-ai-canvas-backend.service open-ai-canvas-web.service
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl reload caddy
printf 'Prepared %s and %s. Run %s/release.sh for the first build.\n' "$REPO_DIR" "$OPS_DIR" "$OPS_DIR"
