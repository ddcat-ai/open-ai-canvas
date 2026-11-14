#!/usr/bin/env bash
# PeekReel Lite 更新发布流水线：
#   ./release.sh sync —— 同步 yingce 官方最新代码（经 HK 服务器镜像中继）
#   ./release.sh ship —— 签名构建 Lite 安装包并发布 Lite 更新源（不暂存、提交或推送 Git）
# ship 依赖代码签名环境变量与 desktop/scripts/.release-credentials.json；sync 依赖 peekreel-hk 镜像主机。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP="$ROOT/desktop"
SERVER="peekreel-hk"
MIRROR="/opt/peekreel/repos/mirror-upstream.git"

case "${1:-}" in
  sync)
    echo ">>> 服务器镜像拉取 yingce 官方最新"
    ssh "$SERVER" "git -C $MIRROR fetch https://github.com/ddcat-ai/open-ai-canvas.git '+refs/heads/*:refs/heads/*' '+refs/tags/*:refs/tags/*'"
    echo ">>> 本地从镜像拉取"
    git -C "$ROOT" fetch yingce --tags
    # 官方仓库已无 commercial 分支，主线即发布线（v1.7.x 起从 main 打 tag 发版）。
    git -C "$ROOT" merge yingce/main --no-edit
    echo ">>> 已对齐官方 main（有冲突请手工解决后重跑 ship）"
    ;;

  ship)
    if [ -z "${CSC_LINK:-}" ] && [ -z "${WIN_CSC_LINK:-}" ]; then
      echo "缺少代码签名证书：请配置 CSC_LINK 或 WIN_CSC_LINK 后再发布 Lite 安装包" >&2
      exit 1
    fi
    echo ">>> 构建安装包"
    ( cd "$DESKTOP" && ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/" \
        npm run dist:lite )
    echo ">>> 发布到更新源"
    python "$DESKTOP/scripts/publish-update.py" --edition lite
    echo ">>> Lite 更新源发布完成；代码提交与分支推送需单独走仓库推送验证"
    ;;

  *)
    echo "用法：$0 sync | ship"
    exit 1
    ;;
esac
