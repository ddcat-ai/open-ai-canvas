#!/usr/bin/env bash
# 从品牌画布生成 Tauri 图标集。
#
# 源图必须是 1024×1024 的方形 PNG：Tauri 的图标生成器不接受矢量图。
# 生成的 src-tauri/icons/ 是提交进仓库的构建输入（Tauri 项目的常规做法），
# 替换正式图标时改 icon-source.svg 后重跑本脚本即可。
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
desktop_dir="$(cd "${script_dir}/.." && pwd)"

hero_svg="${desktop_dir}/icon-source.svg"
hero_png="${desktop_dir}/icon-source.png"

if [[ ! -f "${hero_svg}" ]]; then
  echo "缺少图标源文件：${hero_svg}" >&2
  exit 1
fi

echo "== 矢量转 1024 方形 PNG =="
if command -v rsvg-convert >/dev/null 2>&1; then
  rsvg-convert -w 1024 -h 1024 "${hero_svg}" -o "${hero_png}"
else
  # macOS 自带的 Quick Look 缩略图可作为无第三方依赖时的退路。
  tmp_dir="$(mktemp -d)"
  qlmanage -t -s 1024 -o "${tmp_dir}" "${hero_svg}" >/dev/null
  cp "${tmp_dir}/$(basename "${hero_svg}").png" "${hero_png}"
  rm -rf "${tmp_dir}"
fi

echo "== 生成 Tauri 图标集 =="
# 必须走 bun 运行时：@tauri-apps/cli 的原生绑定在 node 下加载失败（MODULE_NOT_FOUND），
# 而本目录的依赖与锁文件都是 bun 管理的，`bunx --bun` 是唯一验证可用的调用方式。
(cd "${desktop_dir}" && bunx --bun tauri icon "${hero_png}" --output src-tauri/icons)

echo "完成：src-tauri/icons/"
