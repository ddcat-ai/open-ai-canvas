#!/usr/bin/env bash
# 暂存打包输入：web 构建产物、Go 单文件 sidecar、pi 运行时压缩包。
#
# 产物落在 src-tauri/ 下（binaries/、resources/），这两个目录不提交；
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

echo "== 暂存 pi 运行时压缩包 =="
pi_dir="${repo_dir}/backend/agent-runtime/pi"
if [[ ! -f "${pi_dir}/agent-runtime.mjs" ]]; then
  echo "backend/agent-runtime/pi/agent-runtime.mjs 不存在：先执行 (cd backend/agent-runtime/pi && npm install)" >&2
  exit 1
fi
# 内容平铺打包（不带头层目录）：后端按 strip=0 解包，根目录必须直接是 agent-runtime.mjs。
echo "== 暂存官方协议插件包 =="
# 后端起不来的一种硬失败：官方 plugin-packages 目录解析不到就直接退出。
# 后端只读该目录下的 *.yingce-plugin 文件，源码目录一并复制只会白占体积。
plugin_src="${repo_dir}/plugin-packages"
plugin_dst="${desktop_dir}/src-tauri/resources/plugin-packages"
rm -rf "${plugin_dst}"
mkdir -p "${plugin_dst}"
if compgen -G "${plugin_src}/*.yingce-plugin" > /dev/null; then
  cp "${plugin_src}"/*.yingce-plugin "${plugin_dst}/"
else
  echo "plugin-packages 下没有 *.yingce-plugin：后端会因找不到官方插件目录而启动失败" >&2
  exit 1
fi

archive="${desktop_dir}/src-tauri/resources/pi-runtime.tar.gz"
rm -f "${archive}"
tar -C "${pi_dir}" -czf "${archive}" .

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
echo "  官方协议插件  src-tauri/resources/plugin-packages（$(ls "${plugin_dst}" | wc -l | tr -d ' ') 个包，$(du -sh "${plugin_dst}" | cut -f1)）"
echo "  本地服务  src-tauri/binaries/canvas-server-${triple}"
echo "  智能体运行时  src-tauri/resources/pi-runtime.tar.gz（$(du -h "${desktop_dir}/src-tauri/resources/pi-runtime.tar.gz" | cut -f1)）"
echo "下一步：bun run tauri build"
