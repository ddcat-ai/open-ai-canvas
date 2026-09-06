#!/usr/bin/env bash
# Local whisper.cpp server for timeline subtitle transcription.
# The Go backend calls {CANVAS_WHISPER_BASE_URL}/inference with a multipart
# wav upload and expects standard whisper verbose_json back (native protocol).
#
# Usage:
#   scripts/start-whisper-local.sh            # base model, port 8082
#   WHISPER_MODEL=ggml-small.bin scripts/start-whisper-local.sh
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

MODEL_NAME="${WHISPER_MODEL:-ggml-base.bin}"
MODEL_DIR="${ROOT}/.local/whisper-models"
MODEL_PATH="${MODEL_DIR}/${MODEL_NAME}"
HOST="${WHISPER_HOST:-127.0.0.1}"
PORT="${WHISPER_PORT:-8082}"
THREADS="${WHISPER_THREADS:-4}"

if ! command -v whisper-server >/dev/null 2>&1; then
  echo "whisper-server not found. Install with: brew install whisper-cpp" >&2
  exit 1
fi

mkdir -p "${MODEL_DIR}"

if [ ! -f "${MODEL_PATH}" ]; then
  echo "Model ${MODEL_NAME} not found at ${MODEL_PATH}" >&2
  echo "Download it first, e.g.:" >&2
  echo "  curl -fL -o ${MODEL_PATH} https://aifasthub.com/ggerganov/whisper.cpp/resolve/main/${MODEL_NAME}" >&2
  echo "(aifasthub mirrors huggingface.co/ggerganov/whisper.cpp for CN networks)" >&2
  exit 1
fi

echo "Starting whisper-server: model=${MODEL_NAME} host=${HOST} port=${PORT}"
exec whisper-server -m "${MODEL_PATH}" --host "${HOST}" --port "${PORT}" --threads "${THREADS}" -l auto
