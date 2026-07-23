#!/usr/bin/env bash

set -Eeuo pipefail

REPOSITORY_REF="${REPOSITORY_REF:-main}"
INSTALL_DIR="${INSTALL_DIR:-/opt/open-ai-canvas}"
CANVAS_HTTP_PORT="${CANVAS_HTTP_PORT:-3000}"
CANVAS_IMAGE_TAG="${CANVAS_IMAGE_TAG:-latest}"
COMPOSE_FILE="docker-compose.deploy.yml"
COMPOSE_URL="${COMPOSE_URL:-https://raw.githubusercontent.com/ddcat-ai/open-ai-canvas/${REPOSITORY_REF}/${COMPOSE_FILE}}"

step() {
    printf '\n==> %s\n' "$1"
}

fail() {
    printf '\n安装失败：%s\n' "$1" >&2
    exit 1
}

require_root() {
    if [[ "${EUID}" -ne 0 ]]; then
        fail "请使用 README 中带 sudo 的一键安装命令"
    fi
    [[ "$(uname -s)" == "Linux" ]] || fail "一键部署脚本仅支持 Linux 服务器"
    [[ "$CANVAS_HTTP_PORT" =~ ^[0-9]+$ ]] || fail "CANVAS_HTTP_PORT 必须是 1 到 65535 的数字"
    ((CANVAS_HTTP_PORT >= 1 && CANVAS_HTTP_PORT <= 65535)) || fail "CANVAS_HTTP_PORT 必须是 1 到 65535 的数字"
    [[ "$CANVAS_IMAGE_TAG" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] || fail "CANVAS_IMAGE_TAG 不是有效的 Docker 镜像标签"
}

install_packages() {
    local packages=(ca-certificates curl openssl)

    if command -v apt-get >/dev/null 2>&1; then
        apt-get update
        DEBIAN_FRONTEND=noninteractive apt-get install -y "${packages[@]}"
    elif command -v dnf >/dev/null 2>&1; then
        dnf install -y "${packages[@]}"
    elif command -v yum >/dev/null 2>&1; then
        yum install -y "${packages[@]}"
    else
        fail "暂不支持当前 Linux 发行版，请先手动安装 Docker、curl 和 OpenSSL"
    fi
}

install_docker() {
    if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
        return
    fi

    step "安装 Docker 和 Docker Compose"
    local installer
    installer="$(mktemp)"
    curl -fsSL https://get.docker.com -o "$installer"
    sh "$installer"
    rm -f "$installer"

    if command -v systemctl >/dev/null 2>&1; then
        systemctl enable --now docker
    elif command -v service >/dev/null 2>&1; then
        service docker start
    fi

    docker compose version >/dev/null 2>&1 || fail "Docker Compose 安装失败"
}

login_ghcr() {
    if [[ -n "${GHCR_USERNAME:-}" || -n "${GHCR_TOKEN:-}" ]]; then
        [[ -n "${GHCR_USERNAME:-}" && -n "${GHCR_TOKEN:-}" ]] || fail "GHCR_USERNAME 和 GHCR_TOKEN 必须同时配置"
        step "登录 GitHub Container Registry"
        # token 只通过 stdin 交给 Docker，避免出现在命令参数和进程列表中。
        printf '%s' "$GHCR_TOKEN" | docker login ghcr.io --username "$GHCR_USERNAME" --password-stdin
    fi
}

prepare_environment() {
    mkdir -p "$INSTALL_DIR"
    cd "$INSTALL_DIR"

    if [[ -f .env ]]; then
        grep -Eq '^POSTGRES_PASSWORD=.+$' .env || fail "现有 .env 缺少 POSTGRES_PASSWORD"
        grep -Eq '^DATABASE_URL=.+$' .env || fail "现有 .env 缺少 DATABASE_URL"

        local configured_http_port
        configured_http_port="$(sed -n 's/^CANVAS_HTTP_PORT=//p' .env | tail -n 1)"
        if [[ -n "$configured_http_port" ]]; then
            [[ "$configured_http_port" =~ ^[0-9]+$ ]] || fail ".env 中的 CANVAS_HTTP_PORT 无效"
            ((configured_http_port >= 1 && configured_http_port <= 65535)) || fail ".env 中的 CANVAS_HTTP_PORT 无效"
            CANVAS_HTTP_PORT="$configured_http_port"
        fi

        local configured_image_tag
        configured_image_tag="$(sed -n 's/^CANVAS_IMAGE_TAG=//p' .env | tail -n 1)"
        if [[ -n "$configured_image_tag" ]]; then
            [[ "$configured_image_tag" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] || fail ".env 中的 CANVAS_IMAGE_TAG 无效"
            CANVAS_IMAGE_TAG="$configured_image_tag"
        fi
        return
    fi

    step "生成 PostgreSQL 随机密码和部署配置"
    local database_password
    database_password="$(openssl rand -hex 32)"
    umask 077
    cat >.env <<EOF
POSTGRES_DB=open_ai_canvas
POSTGRES_USER=open_ai_canvas
POSTGRES_PASSWORD=${database_password}
DATABASE_URL=postgresql://open_ai_canvas:${database_password}@postgres:5432/open_ai_canvas?sslmode=disable
CANVAS_HTTP_PORT=${CANVAS_HTTP_PORT}
CANVAS_IMAGE_TAG=${CANVAS_IMAGE_TAG}
CANVAS_REGISTRATION_ENABLED=false
CANVAS_ALLOW_PRIVATE_UPSTREAMS=false
CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS=
CANVAS_CORS_ORIGINS=
EOF
}

download_compose() {
    step "下载 GHCR 镜像部署配置"
    local temporary_file
    temporary_file="$(mktemp "${INSTALL_DIR}/.docker-compose.deploy.XXXXXX")"
    curl -fsSL "$COMPOSE_URL" -o "$temporary_file"
    mv "$temporary_file" "$COMPOSE_FILE"
}

start_services() {
    step "拉取并启动 GHCR 网页与后端镜像"
    docker compose --env-file .env -f "$COMPOSE_FILE" pull
    docker compose --env-file .env -f "$COMPOSE_FILE" up -d --remove-orphans --wait --wait-timeout 600
}

print_result() {
    local local_ip
    local_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
    [[ -n "$local_ip" ]] || local_ip="服务器IP"

    printf '\n部署完成。\n'
    printf '访问地址：http://%s:%s\n' "$local_ip" "$CANVAS_HTTP_PORT"
    printf '安装目录：%s\n' "$INSTALL_DIR"
    printf '查看状态：cd %q && docker compose --env-file .env -f %s ps\n' "$INSTALL_DIR" "$COMPOSE_FILE"
    printf '\n首次打开后注册的第一个账号会自动成为管理员。公网长期使用前请配置 HTTPS。\n'
}

main() {
    require_root
    step "安装服务器基础工具"
    install_packages
    install_docker
    login_ghcr
    prepare_environment
    download_compose
    start_services
    print_result
}

main "$@"
