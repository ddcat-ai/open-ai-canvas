#!/bin/sh
set -eu

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$root_dir/.." && pwd)
payment_plugins="official-payment-wechat-native official-payment-alipay-page"
payments_only=false

if [ "${1:-}" = "--payments-only" ]; then
  payments_only=true
  shift
fi
if [ "$#" -ne 0 ]; then
  echo "usage: $0 [--payments-only]" >&2
  exit 2
fi

if [ "$payments_only" = true ]; then
  node "$root_dir/embed-documentation.mjs" $payment_plugins
else
  node "$root_dir/embed-documentation.mjs"
fi

# Payment backends are executable plugin payloads. They are compiled outside
# the host binary and then included under backend/provider in the package.
payment_goos=${PAYMENT_PLUGIN_GOOS:-$(go env GOOS)}
payment_goarch=${PAYMENT_PLUGIN_GOARCH:-$(go env GOARCH)}
payment_cgo=${PAYMENT_PLUGIN_CGO_ENABLED:-0}

case "$payment_cgo" in
  0|1) ;;
  *)
    echo "PAYMENT_PLUGIN_CGO_ENABLED must be 0 or 1" >&2
    exit 2
    ;;
esac

build_payment_provider() {
  package_id=$1
  command_path=$2
  output_file="$root_dir/$package_id/backend/provider"
  temporary_file="$output_file.tmp"

  mkdir -p "$(dirname -- "$output_file")"
  rm -f "$temporary_file"
  (
    cd "$repo_dir/backend"
    CGO_ENABLED="$payment_cgo" \
      GOOS="$payment_goos" \
      GOARCH="$payment_goarch" \
      go build -trimpath -ldflags='-s -w' -o "$temporary_file" "$command_path"
  )
  mv "$temporary_file" "$output_file"
  chmod 0755 "$output_file"

  build_info=$(go version -m "$output_file")
  printf '%s\n' "$build_info" | grep -F "GOOS=$payment_goos" >/dev/null
  printf '%s\n' "$build_info" | grep -F "GOARCH=$payment_goarch" >/dev/null
  printf '%s\n' "$build_info" | grep -F "CGO_ENABLED=$payment_cgo" >/dev/null
}

build_payment_provider official-payment-wechat-native ./cmd/payment-wechat
build_payment_provider official-payment-alipay-page ./cmd/payment-alipay

package_plugin() {
  package_id=$1
  package_dir="$root_dir/$package_id"
  output_file="$root_dir/$package_id.yingce-plugin"
  temporary_file="$root_dir/.$package_id.yingce-plugin.tmp"
  rm -f "$temporary_file"
  (
    cd "$package_dir"
    find manifest.json README.md docs assets web backend LICENSE -type f 2>/dev/null | LC_ALL=C sort | zip -X -q "$temporary_file" -@
  )
  mv "$temporary_file" "$output_file"
}

if [ "$payments_only" = true ]; then
  for payment_plugin in $payment_plugins; do
    package_plugin "$payment_plugin"
  done
  exit 0
fi

for payment_plugin in $payment_plugins; do
  mkdir -p "$root_dir/$payment_plugin/backend"
done

for manifest in "$root_dir"/*/manifest.json; do
  package_dir=${manifest%/manifest.json}
  package_id=${package_dir##*/}
  package_plugin "$package_id"
done
