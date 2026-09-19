#!/bin/sh
set -eu

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
require_all=false

if [ "${1:-}" = "--all" ]; then
  require_all=true
  shift
fi

expected_goos=${1:-}
expected_goarch=${2:-}

if [ -z "$expected_goos" ] || [ -z "$expected_goarch" ]; then
  echo "usage: $0 [--all] <goos> <goarch>" >&2
  exit 2
fi

case "$expected_goos" in
  linux|darwin|windows) ;;
  *)
    echo "unsupported payment package OS: $expected_goos" >&2
    exit 2
    ;;
esac

case "$expected_goarch" in
  amd64|arm64) ;;
  *)
    echo "unsupported payment package architecture: $expected_goarch" >&2
    exit 2
    ;;
esac

temporary_dir=$(mktemp -d)
trap 'rm -rf "$temporary_dir"' EXIT HUP INT TERM

file_magic() {
  od -An -tx1 -N4 "$1" | tr -d '[:space:]'
}

payment_artifact_name() {
  goos=$1
  goarch=$2
  if [ "$goos" = "windows" ]; then
    printf 'provider-%s-%s.exe\n' "$goos" "$goarch"
  else
    printf 'provider-%s-%s\n' "$goos" "$goarch"
  fi
}

verify_platform_magic() {
  path=$1
  goos=$2
  goarch=$3
  magic=$(file_magic "$path")
  case "$goos" in
    linux)
      if [ "$magic" != "7f454c46" ]; then
        echo "$path is not an ELF executable (magic=$magic)" >&2
        return 1
      fi
      class=$(od -An -tx1 -j4 -N1 "$path" | tr -d '[:space:]')
      byte_order=$(od -An -tx1 -j5 -N1 "$path" | tr -d '[:space:]')
      if [ "$class" != "02" ] || [ "$byte_order" != "01" ]; then
        echo "$path is not a 64-bit little-endian ELF executable" >&2
        return 1
      fi
      expected_machine=3e00
      if [ "$goarch" = "arm64" ]; then
        expected_machine=b700
      fi
      machine=$(od -An -tx1 -j18 -N2 "$path" | tr -d '[:space:]')
      if [ "$machine" != "$expected_machine" ]; then
        echo "$path architecture does not match linux/$goarch (ELF machine=$machine)" >&2
        return 1
      fi
      ;;
    darwin)
      case "$magic" in
        cffaedfe|cefaedfe|feedfacf|feedface|cafebabe|bebafeca) ;;
        *)
          echo "$path is not a Mach-O executable (magic=$magic)" >&2
          return 1
          ;;
      esac
      ;;
    windows)
      mz=$(od -An -tx1 -N2 "$path" | tr -d '[:space:]')
      if [ "$mz" != "4d5a" ]; then
        echo "$path is not a Windows PE executable (magic=$mz)" >&2
        return 1
      fi
      ;;
  esac
}

verify_packaged_file() {
  package_file=$1
  relative_path=$2
  source_file=$3
  archived_file=$4
  unzip -p "$package_file" "$relative_path" >"$archived_file"
  if ! cmp -s "$source_file" "$archived_file"; then
    echo "$relative_path in $package_file differs from the directory file" >&2
    return 1
  fi
}

all_targets="linux/amd64 linux/arm64 darwin/amd64 darwin/arm64 windows/amd64 windows/arm64"
verify_targets="$expected_goos/$expected_goarch"
if [ "$require_all" = true ]; then
  verify_targets="$all_targets"
  if [ "$expected_goos/$expected_goarch" != "linux/amd64" ]; then
    echo "--all currently expects canonical linux/amd64 as the host verification target" >&2
    exit 2
  fi
fi

for package_id in official-payment-wechat-native official-payment-alipay-page official-payment-xunhupay official-payment-zhifufm; do
  backend_dir="$root_dir/$package_id/backend"
  provider="$backend_dir/provider"
  package_file="$root_dir/$package_id.yingce-plugin"
  expected_artifact=$(payment_artifact_name "$expected_goos" "$expected_goarch")

  test -f "$provider"
  test -f "$package_file"
  if [ "$(uname -s)" = "Linux" ] || [ "$(uname -s)" = "Darwin" ]; then
    test -x "$provider"
  fi

  verify_platform_magic "$provider" "$expected_goos" "$expected_goarch"
  verify_packaged_file "$package_file" backend/provider "$provider" "$temporary_dir/$package_id-provider"

  test -f "$backend_dir/$expected_artifact"
  if ! cmp -s "$provider" "$backend_dir/$expected_artifact"; then
    echo "$package_id backend/provider does not match $expected_artifact" >&2
    exit 1
  fi
  verify_packaged_file "$package_file" "backend/$expected_artifact" "$backend_dir/$expected_artifact" "$temporary_dir/$package_id-$expected_artifact"

  for target in $verify_targets; do
    target_goos=${target%/*}
    target_goarch=${target#*/}
    artifact_name=$(payment_artifact_name "$target_goos" "$target_goarch")
    artifact_path="$backend_dir/$artifact_name"
    test -f "$artifact_path"
    verify_platform_magic "$artifact_path" "$target_goos" "$target_goarch"
    verify_packaged_file "$package_file" "backend/$artifact_name" "$artifact_path" "$temporary_dir/$package_id-$artifact_name"
  done

  if [ "${PAYMENT_PLUGIN_SMOKE_TEST:-0}" = "1" ]; then
    current_sys=$(uname -s)
    can_smoke=0
    if [ "$expected_goos" = "linux" ] && [ "$current_sys" = "Linux" ]; then
      can_smoke=1
    fi
    if [ "$expected_goos" = "darwin" ] && [ "$current_sys" = "Darwin" ]; then
      can_smoke=1
    fi
    if [ "$can_smoke" = "1" ]; then
      response=$(printf 'invalid-json\n' | "$provider")
      printf '%s\n' "$response" | grep -F '"code":"invalid_request"' >/dev/null
    fi
  fi
done
