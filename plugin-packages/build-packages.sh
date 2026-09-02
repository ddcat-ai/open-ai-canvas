#!/bin/sh
set -eu

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

node "$root_dir/embed-documentation.mjs"

# Payment backends are executable plugin payloads. They are compiled outside
# the host binary and then included under backend/provider in the package.
repo_dir=$(CDPATH= cd -- "$root_dir/.." && pwd)
for payment_plugin in official-payment-wechat-native official-payment-alipay-page; do
  mkdir -p "$root_dir/$payment_plugin/backend"
done
(cd "$repo_dir/backend" && go build -trimpath -ldflags='-s -w' -o "$root_dir/official-payment-wechat-native/backend/provider" ./cmd/payment-wechat)
(cd "$repo_dir/backend" && go build -trimpath -ldflags='-s -w' -o "$root_dir/official-payment-alipay-page/backend/provider" ./cmd/payment-alipay)

for manifest in "$root_dir"/*/manifest.json; do
  package_dir=${manifest%/manifest.json}
  package_id=${package_dir##*/}
  output_file="$root_dir/$package_id.yingce-plugin"
  temporary_file="$root_dir/.$package_id.yingce-plugin.tmp"
  rm -f "$temporary_file"
  (
    cd "$package_dir"
    find manifest.json README.md docs assets web backend LICENSE -type f 2>/dev/null | LC_ALL=C sort | zip -X -q "$temporary_file" -@
  )
  mv "$temporary_file" "$output_file"
done
