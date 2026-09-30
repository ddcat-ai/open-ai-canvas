#!/bin/sh
set -eu

release_dir=${CANVAS_WEB_RELEASE_DIR:-/opt/canvas-release}
html_dir=${CANVAS_WEB_HTML_DIR:-/usr/share/nginx/html}
retention_days=${CANVAS_WEB_ASSET_RETENTION_DAYS:-7}
case "$retention_days" in ''|*[!0-9]*|0) echo 'Invalid asset retention days' >&2; exit 1;; esac
test -s "$release_dir/index.html"

mkdir -p "$html_dir"
# One writer per volume; do not serve a partial publication after a copy error.
lock="$html_dir/.canvas-publish-lock"
mkdir "$lock" || { echo 'Another publication is active; inspect the publication lock' >&2; exit 1; }
stage=''
cleanup() { test -z "$stage" || rm -rf "$stage"; rmdir "$lock"; }
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
stage=$(mktemp -d "$html_dir/.canvas-stage.XXXXXX")
cp -R "$release_dir/." "$stage/"
test -d "$stage/assets"
(cd "$stage" && find assets -type f | LC_ALL=C sort) > "$stage/.canvas-assets"

# Publish complete files by rename on the same filesystem. HTML is switched last.
find "$stage" -type f ! -path "$stage/index.html" ! -path "$stage/.canvas-assets" | while IFS= read -r file; do
    relative=${file#"$stage/"}
    mkdir -p "$html_dir/$(dirname "$relative")"
    if test -f "$html_dir/$relative" && cmp -s "$file" "$html_dir/$relative"; then
        touch "$html_dir/$relative"
    else
        mv -f "$file" "$html_dir/$relative"
        touch "$html_dir/$relative"
    fi
done
if test -f "$html_dir/.canvas-assets-current" && ! cmp -s "$stage/.canvas-assets" "$html_dir/.canvas-assets-current"; then
    cp "$html_dir/.canvas-assets-current" "$html_dir/.canvas-assets-previous"
fi
mv -f "$stage/index.html" "$html_dir/index.html"
mv -f "$stage/.canvas-assets" "$html_dir/.canvas-assets-current"

# Retain current + previous builds unconditionally, and older chunks for 7 days.
# Only prune hashed assets, never application data or non-asset public files.
find "$html_dir/assets" -type f -mtime +"$retention_days" | while IFS= read -r file; do
    relative=${file#"$html_dir/"}
    if grep -Fxq "$relative" "$html_dir/.canvas-assets-current" || { test -f "$html_dir/.canvas-assets-previous" && grep -Fxq "$relative" "$html_dir/.canvas-assets-previous"; }; then
        continue
    fi
    rm -f "$file"
done
cleanup
trap - EXIT HUP INT TERM

exec nginx -g 'daemon off;'
