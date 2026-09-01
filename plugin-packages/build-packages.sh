#!/bin/sh
set -eu

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

node "$root_dir/embed-documentation.mjs"

for manifest in "$root_dir"/*/manifest.json; do
  package_dir=${manifest%/manifest.json}
  package_id=${package_dir##*/}
  output_file="$root_dir/$package_id.yingce-plugin"
  temporary_file="$root_dir/.$package_id.yingce-plugin.tmp"
  rm -f "$temporary_file"
  (
    cd "$package_dir"
    find manifest.json README.md docs assets web LICENSE -type f 2>/dev/null | LC_ALL=C sort | zip -X -q "$temporary_file" -@
  )
  mv "$temporary_file" "$output_file"
done
