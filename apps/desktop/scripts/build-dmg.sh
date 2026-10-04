#!/usr/bin/env bash
# macOS 打包：tauri build → 签名 → DMG → 公证 → 装订。
#
# 与 Linux/Windows 无关；跨平台签名各自处理，不在这里分支。
# 前置条件：
#   1. 已运行 scripts/stage-assets.sh（sidecar 与前端资源就位）
#   2. 签名：环境变量 APPLE_SIGNING_IDENTITY（如 "Developer ID Application: Xxx (TEAMID)"）
#   3. 公证：xcrun notarytool 可用（需要完整版 Xcode，只有 Command Line Tools 时不可用）
#      凭据二选一：APPLE_ID + APPLE_TEAM_ID + APPLE_PASSWORD（App 专用密码），
#      或预先存好的钥匙串配置 NOTARY_PROFILE。
# 用法：
#   APPLE_SIGNING_IDENTITY="..." scripts/build-dmg.sh            # Developer ID 签名 + DMG + 公证
#   scripts/build-dmg.sh --skip-sign                            # 无 Developer ID：ad-hoc 签名 + DMG
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
desktop_dir="$(cd "${script_dir}/.." && pwd)"
target_dir="${desktop_dir}/src-tauri/target/release"
app_path="${target_dir}/bundle/macos/影策.app"
dmg_path="${target_dir}/bundle/dmg/影策.dmg"

skip_sign=0
for arg in "$@"; do
  case "${arg}" in
    --skip-sign) skip_sign=1 ;;
    *) echo "未知参数：${arg}" >&2; exit 2 ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "此脚本只用于 macOS" >&2
  exit 1
fi

echo "== tauri build（app bundle） =="
# 必须走 bun 运行时：CLI 原生绑定在 node 下加载失败，见 scripts/generate-icons.sh 的说明。
(cd "${desktop_dir}" && bunx --bun tauri build --bundles app)
if [[ ! -d "${app_path}" ]]; then
  echo "未找到产物：${app_path}" >&2
  exit 1
fi

# ad-hoc 签名：tauri build 直接产出的 bundle 只有链接期签名（linker-signed），
# 装到 /Applications 后会报「已损坏，无法打开」。先签嵌套可执行文件、再签外层，
# 得到完整的 ad-hoc bundle 签名，本地使用不必再手工 codesign。
sign_adhoc() {
  echo "== ad-hoc 签名嵌套可执行文件 =="
  while IFS= read -r -d '' nested; do
    echo "  sign ${nested}"
    codesign --force --sign - "${nested}"
  done < <(find "${app_path}/Contents/MacOS" -type f -perm -u+x -print0)

  echo "== ad-hoc 签名 app =="
  codesign --force --deep --sign - "${app_path}"
  codesign --verify --deep --strict --verbose=2 "${app_path}"
}

# DMG 布局：根下同时放 .app 与 /Applications 的软链，挂载后可以直接把 app 拖进去安装。
make_dmg() {
  local stage
  stage="$(mktemp -d)"
  cp -R "${app_path}" "${stage}/"
  ln -s /Applications "${stage}/Applications"

  mkdir -p "$(dirname "${dmg_path}")"
  rm -f "${dmg_path}"
  hdiutil create -volname "影策" -srcfolder "${stage}" -ov -format UDZO "${dmg_path}"
  rm -rf "${stage}"
}

if [[ "${skip_sign}" -eq 1 ]]; then
  echo "== 无 Developer ID：ad-hoc 签名 =="
  sign_adhoc

  echo "== 生成 DMG =="
  make_dmg
  echo "ad-hoc 签名 DMG：${dmg_path}"
  exit 0
fi

identity="${APPLE_SIGNING_IDENTITY:-}"
if [[ -z "${identity}" ]]; then
  echo "缺少 APPLE_SIGNING_IDENTITY；只想本地安装请用 --skip-sign" >&2
  exit 1
fi

# sidecar 是嵌套的独立可执行文件：必须先签它，再签外层 app，否则外层签名无效。
echo "== 签名嵌套可执行文件 =="
while IFS= read -r -d '' nested; do
  echo "  sign ${nested}"
  codesign --force --options runtime --timestamp --sign "${identity}" "${nested}"
done < <(find "${app_path}/Contents/MacOS" -type f -perm -u+x -print0)

echo "== 签名 app =="
codesign --force --options runtime --timestamp \
  --entitlements "${desktop_dir}/src-tauri/entitlements.plist" \
  --sign "${identity}" "${app_path}"
codesign --verify --deep --strict --verbose=2 "${app_path}"

echo "== 生成 DMG =="
make_dmg
codesign --force --timestamp --sign "${identity}" "${dmg_path}"

echo "== 公证 =="
if ! xcrun --find notarytool >/dev/null 2>&1; then
  echo "xcrun notarytool 不可用：公证需要完整版 Xcode（xcode-select -p 指向 Xcode.app）" >&2
  exit 1
fi

if [[ -n "${NOTARY_PROFILE:-}" ]]; then
  xcrun notarytool submit "${dmg_path}" --keychain-profile "${NOTARY_PROFILE}" --wait
else
  : "${APPLE_ID:?缺少 APPLE_ID（或设置 NOTARY_PROFILE）}"
  : "${APPLE_TEAM_ID:?缺少 APPLE_TEAM_ID}"
  : "${APPLE_PASSWORD:?缺少 APPLE_PASSWORD（App 专用密码）}"
  xcrun notarytool submit "${dmg_path}" \
    --apple-id "${APPLE_ID}" --team-id "${APPLE_TEAM_ID}" --password "${APPLE_PASSWORD}" --wait
fi

echo "== 装订与校验 =="
xcrun stapler staple "${dmg_path}"
spctl --assess --type open --context context:primary-signature -vv "${dmg_path}"

echo "完成：${dmg_path}"
