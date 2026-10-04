#!/usr/bin/env bash
# 暂存打包输入：web 构建产物与 Go 单文件 sidecar。
#
# 产物落在 src-tauri/ 下（binaries/、resources/web），这两个目录不提交；
# 缺任何一项，tauri build 都会在打包阶段失败，因此这个脚本是打包的第一步。
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
desktop_dir="$(cd "${script_dir}/.." && pwd)"
repo_dir="$(cd "${desktop_dir}/../.." && pwd)"

skip_web=0
skip_go=0
for arg in "$@"; do
  case "${arg}" in
    --skip-web) skip_web=1 ;;
    --skip-go) skip_go=1 ;;
    *) echo "未知参数：${arg}" >&2; exit 2 ;;
  esac
done

triple="$(rustc -vV | awk '/^host:/{print $2}')"
if [[ -z "${triple}" ]]; then
  echo "无法从 rustc -vV 读取目标三元组" >&2
  exit 1
fi

# sidecar 必须 CGO_ENABLED=1：后端 SQLite 走 mattn/go-sqlite3，是 cgo 实现，
# CGO_ENABLED=0 的产物启动即报 stub 错误、建不了库，健康门永远到不了 200。
# 代价是 cgo 不能凭空交叉编译：目标平台与当前系统不一致时直接失败，
# 而不是产出一个能"构建成功"却起不来的二进制。
case "$(uname -s)" in
  Darwin) host_plat="apple-darwin" ;;
  Linux) host_plat="unknown-linux" ;;
  MINGW*|MSYS*|CYGWIN*) host_plat="pc-windows" ;;
  *) host_plat="" ;;
esac
if [[ -n "${host_plat}" && "${triple}" != *"${host_plat}"* ]]; then
  echo "目标三元组 ${triple} 与当前系统不匹配：cgo 交叉编译需要目标平台的 C 工具链" >&2
  echo "（Windows 需在 Windows 上构建或备好 mingw-w64），请在目标平台上运行本脚本" >&2
  exit 1
fi

if [[ "${skip_web}" -eq 0 ]]; then
  echo "== 构建前端（web/dist） =="
  (cd "${repo_dir}/web" && bun run build)
fi
if [[ ! -f "${repo_dir}/web/dist/index.html" ]]; then
  echo "web/dist/index.html 不存在，先运行不带 --skip-web 的同名脚本" >&2
  exit 1
fi

echo "== 暂存前端资源 =="
rm -rf "${desktop_dir}/src-tauri/resources/web"
mkdir -p "${desktop_dir}/src-tauri/resources/web"
cp -R "${repo_dir}/web/dist/." "${desktop_dir}/src-tauri/resources/web/"

if [[ "${skip_go}" -eq 0 ]]; then
  echo "== 构建 Go sidecar（${triple}） =="
  mkdir -p "${desktop_dir}/src-tauri/binaries"
  (cd "${repo_dir}/backend" && CGO_ENABLED=1 go build -trimpath -ldflags "-s -w" \
    -o "${desktop_dir}/src-tauri/binaries/canvas-server-${triple}" ./cmd/server)
fi

if [[ ! -x "${desktop_dir}/src-tauri/binaries/canvas-server-${triple}" ]]; then
  echo "binaries/canvas-server-${triple} 不存在，先运行不带 --skip-go 的同名脚本" >&2
  exit 1
fi

echo "暂存完成："
echo "  前端资源  src-tauri/resources/web"
echo "  本地服务  src-tauri/binaries/canvas-server-${triple}"
echo "下一步：bun run tauri build"
