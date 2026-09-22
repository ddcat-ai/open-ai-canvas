#!/usr/bin/env bash
set -euo pipefail

: "${IMAGE:?}" "${GITHUB_SHA:?}" "${GITHUB_REF:?}" "${DIGEST_DIR:?}" "${EXPECTED_DIGESTS:?}"
[[ "$GITHUB_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "Invalid commit SHA" >&2; exit 1; }
shopt -s nullglob
files=("$DIGEST_DIR"/*)
[[ ${#files[@]} -eq "$EXPECTED_DIGESTS" ]] || { echo "Incomplete image digest set" >&2; exit 1; }
sources=()
for file in "${files[@]}"; do
  digest=${file##*/}
  [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || { echo "Invalid image digest" >&2; exit 1; }
  sources+=("$IMAGE@sha256:$digest")
done

tags=(--tag "$IMAGE:sha-$GITHUB_SHA" --tag "$IMAGE:sha-${GITHUB_SHA:0:7}")
if [[ "$GITHUB_REF" == refs/tags/v* ]]; then
  [[ "${VERSION_TAG:?}" =~ ^[0-9]+\.[0-9]+\.[0-9]+(\.[0-9]+)?([.-][0-9A-Za-z.-]+)?$ ]] || { echo "Invalid version image tag" >&2; exit 1; }
  tags+=(--tag "$IMAGE:$VERSION_TAG")
elif [[ "$GITHUB_REF" == refs/heads/main ]]; then
  current_sha=$(gh api "repos/${GITHUB_REPOSITORY:?}/git/ref/heads/main" --jq '.object.sha')
  [[ "$current_sha" =~ ^[0-9a-f]{40}$ ]] || { echo "Invalid main branch SHA" >&2; exit 1; }
  if [[ "$current_sha" == "$GITHUB_SHA" ]]; then
    tags+=(--tag "$IMAGE:latest")
  else
    echo 'A newer main commit exists; leaving latest unchanged.'
  fi
fi

docker buildx imagetools create "${tags[@]}" "${sources[@]}"
