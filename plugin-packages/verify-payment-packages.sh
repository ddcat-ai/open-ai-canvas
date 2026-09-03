#!/bin/sh
set -eu

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
expected_goos=${1:-}
expected_goarch=${2:-}

if [ "$expected_goos" != "linux" ]; then
  echo "payment package verification currently requires expected GOOS linux" >&2
  exit 2
fi

case "$expected_goarch" in
  amd64) expected_machine=3e00 ;;
  arm64) expected_machine=b700 ;;
  *)
    echo "unsupported payment package architecture: $expected_goarch" >&2
    exit 2
    ;;
esac

temporary_dir=$(mktemp -d)
trap 'rm -rf "$temporary_dir"' EXIT HUP INT TERM

for package_id in official-payment-wechat-native official-payment-alipay-page; do
  provider="$root_dir/$package_id/backend/provider"
  package_file="$root_dir/$package_id.yingce-plugin"
  archived_provider="$temporary_dir/$package_id-provider"

  test -f "$provider"
  if [ "$(uname -s)" = "Linux" ]; then
    test -x "$provider"
  fi
  test -f "$package_file"

  magic=$(od -An -tx1 -N4 "$provider" | tr -d '[:space:]')
  if [ "$magic" != "7f454c46" ]; then
    echo "$package_id provider is not an ELF executable (magic=$magic)" >&2
    exit 1
  fi

  class=$(od -An -tx1 -j4 -N1 "$provider" | tr -d '[:space:]')
  byte_order=$(od -An -tx1 -j5 -N1 "$provider" | tr -d '[:space:]')
  if [ "$class" != "02" ] || [ "$byte_order" != "01" ]; then
    echo "$package_id provider is not a 64-bit little-endian ELF executable" >&2
    exit 1
  fi

  machine=$(od -An -tx1 -j18 -N2 "$provider" | tr -d '[:space:]')
  if [ "$machine" != "$expected_machine" ]; then
    echo "$package_id provider architecture does not match linux/$expected_goarch (ELF machine=$machine)" >&2
    exit 1
  fi

  unzip -p "$package_file" backend/provider >"$archived_provider"
  if ! cmp -s "$provider" "$archived_provider"; then
    echo "$package_id directory provider and packaged provider differ" >&2
    exit 1
  fi

  if [ "${PAYMENT_PLUGIN_SMOKE_TEST:-0}" = "1" ]; then
    response=$(printf 'invalid-json\n' | "$provider")
    printf '%s\n' "$response" | grep -F '"code":"invalid_request"' >/dev/null
  fi
done
