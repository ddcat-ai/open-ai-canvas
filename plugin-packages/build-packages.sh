#!/bin/sh
set -eu

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$root_dir/.." && pwd)
payment_plugins="official-payment-wechat-native official-payment-alipay-page official-payment-xunhupay"
payments_only=false
default_payment_targets="linux/amd64 linux/arm64 darwin/amd64 darwin/arm64 windows/amd64 windows/arm64"

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

# Payment backends are executable plugin payloads. Unset PAYMENT_PLUGIN_GOOS
# builds every supported host platform into the package. Docker image builds
# set PAYMENT_PLUGIN_GOOS/GOARCH to the image TARGETOS/TARGETARCH only.
payment_cgo=${PAYMENT_PLUGIN_CGO_ENABLED:-0}

case "$payment_cgo" in
  0|1) ;;
  *)
    echo "PAYMENT_PLUGIN_CGO_ENABLED must be 0 or 1" >&2
    exit 2
    ;;
esac

if [ -n "${PAYMENT_PLUGIN_GOOS:-}" ]; then
  if [ -z "${PAYMENT_PLUGIN_GOARCH:-}" ]; then
    echo "PAYMENT_PLUGIN_GOARCH is required when PAYMENT_PLUGIN_GOOS is set" >&2
    exit 2
  fi
  payment_targets="${PAYMENT_PLUGIN_GOOS}/${PAYMENT_PLUGIN_GOARCH}"
  canonical_target="$payment_targets"
else
  payment_targets="$default_payment_targets"
  canonical_target="linux/amd64"
fi

payment_artifact_name() {
  goos=$1
  goarch=$2
  if [ "$goos" = "windows" ]; then
    printf 'provider-%s-%s.exe\n' "$goos" "$goarch"
  else
    printf 'provider-%s-%s\n' "$goos" "$goarch"
  fi
}

clean_payment_backends() {
  package_id=$1
  backend_dir="$root_dir/$package_id/backend"
  mkdir -p "$backend_dir"
  rm -f \
    "$backend_dir/provider" \
    "$backend_dir"/provider-linux-* \
    "$backend_dir"/provider-darwin-* \
    "$backend_dir"/provider-windows-*.exe
  rm -rf \
    "$backend_dir/linux-amd64" \
    "$backend_dir/linux-arm64" \
    "$backend_dir/darwin-amd64" \
    "$backend_dir/darwin-arm64" \
    "$backend_dir/windows-amd64" \
    "$backend_dir/windows-arm64"
}

build_payment_provider() {
  package_id=$1
  command_path=$2
  goos=$3
  goarch=$4
  backend_dir="$root_dir/$package_id/backend"
  artifact_name=$(payment_artifact_name "$goos" "$goarch")
  output_file="$backend_dir/$artifact_name"
  temporary_file="$output_file.tmp"

  mkdir -p "$backend_dir"
  rm -f "$temporary_file"
  (
    cd "$repo_dir/backend"
    CGO_ENABLED="$payment_cgo" \
      GOOS="$goos" \
      GOARCH="$goarch" \
      go build -trimpath -ldflags='-s -w' -o "$temporary_file" "$command_path"
  )
  mv "$temporary_file" "$output_file"
  chmod 0755 "$output_file"

  build_info=$(go version -m "$output_file")
  printf '%s\n' "$build_info" | grep -F "GOOS=$goos" >/dev/null
  printf '%s\n' "$build_info" | grep -F "GOARCH=$goarch" >/dev/null
  printf '%s\n' "$build_info" | grep -F "CGO_ENABLED=$payment_cgo" >/dev/null

  if [ "$goos/$goarch" = "$canonical_target" ]; then
    cp "$output_file" "$backend_dir/provider"
    chmod 0755 "$backend_dir/provider"
  fi
}

for payment_plugin in $payment_plugins; do
  clean_payment_backends "$payment_plugin"
done

for target in $payment_targets; do
  target_goos=${target%/*}
  target_goarch=${target#*/}
  build_payment_provider official-payment-wechat-native ./cmd/payment-wechat "$target_goos" "$target_goarch"
  build_payment_provider official-payment-alipay-page ./cmd/payment-alipay "$target_goos" "$target_goarch"
  build_payment_provider official-payment-xunhupay ./cmd/payment-xunhupay "$target_goos" "$target_goarch"
done

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
