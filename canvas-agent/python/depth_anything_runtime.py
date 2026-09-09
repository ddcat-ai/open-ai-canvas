"""Small persistent worker for the local Depth Anything V2 Small model.

The Node Local Runtime owns the process and sends one JSON request per line.
Keeping the pipeline alive avoids loading the model for every canvas conversion.
The worker is deliberately offline-only: the model must already exist in the
configured Hugging Face cache.
"""

from __future__ import annotations

import base64
import contextlib
import io
import json
import os
import re
import sys
from typing import Any

from PIL import Image


MODEL_ID = os.environ.get("CANVAS_DEPTH_MODEL_ID", "depth-anything/Depth-Anything-V2-Small-hf")
MAX_INPUT_BYTES = 12 * 1024 * 1024
DATA_URL_PATTERN = re.compile(r"^data:(image/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=_-]+)$")
PIPELINE: Any = None


def emit(value: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def load_pipeline() -> Any:
    global PIPELINE
    if PIPELINE is not None:
        return PIPELINE

    try:
        from transformers import pipeline
        from transformers.utils import logging as transformers_logging

        transformers_logging.set_verbosity_error()
        # Transformers/tqdm can write progress text while loading weights.
        # Keep stdout reserved for the JSON-lines protocol.
        with contextlib.redirect_stdout(sys.stderr):
            PIPELINE = pipeline(
                "depth-estimation",
                model=MODEL_ID,
                device=-1,
                local_files_only=True,
            )
    except Exception as error:  # pragma: no cover - depends on local model files
        raise RuntimeError("depth_model_missing") from error
    return PIPELINE


def image_from_data_url(value: Any) -> Image.Image:
    if not isinstance(value, str):
        raise ValueError("depth_input_invalid")
    match = DATA_URL_PATTERN.fullmatch(value)
    if not match:
        raise ValueError("depth_input_invalid")
    try:
        raw = base64.urlsafe_b64decode(match.group(2) + "=" * (-len(match.group(2)) % 4))
    except Exception as error:
        raise ValueError("depth_input_invalid") from error
    if not raw or len(raw) > MAX_INPUT_BYTES:
        raise ValueError("depth_input_invalid")
    try:
        image = Image.open(io.BytesIO(raw)).convert("RGB")
        image.load()
        return image
    except Exception as error:
        raise ValueError("depth_input_invalid") from error


def encode_png(image: Image.Image) -> str:
    output = io.BytesIO()
    image.save(output, format="PNG", optimize=True)
    return base64.b64encode(output.getvalue()).decode("ascii")


def handle(request: dict[str, Any]) -> dict[str, Any]:
    image = image_from_data_url(request.get("dataUrl"))
    try:
        result = load_pipeline()(image)
        depth = result.get("depth") if isinstance(result, dict) else None
        if not isinstance(depth, Image.Image):
            raise RuntimeError("depth_inference_failed")
        return {
            "ok": True,
            "requestId": request.get("requestId"),
            "mimeType": "image/png",
            "width": depth.width,
            "height": depth.height,
            "modelId": MODEL_ID,
            "device": "cpu",
            "pngBase64": encode_png(depth),
        }
    except RuntimeError:
        raise
    except Exception as error:  # pragma: no cover - depends on local runtime
        raise RuntimeError("depth_inference_failed") from error


def main() -> None:
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request_id: Any = None
        try:
            request = json.loads(line)
            if not isinstance(request, dict):
                raise ValueError("depth_input_invalid")
            request_id = request.get("requestId")
            emit(handle(request))
        except ValueError as error:
            emit({"ok": False, "requestId": request_id, "code": str(error) or "depth_input_invalid", "message": "深度转换输入无效"})
        except RuntimeError as error:
            code = str(error) or "depth_inference_failed"
            emit({"ok": False, "requestId": request_id, "code": code, "message": "本机深度模型不可用" if code == "depth_model_missing" else "本机深度推理失败"})
        except Exception:
            emit({"ok": False, "requestId": request_id, "code": "depth_inference_failed", "message": "本机深度推理失败"})


if __name__ == "__main__":
    main()
