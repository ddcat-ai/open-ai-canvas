"""Small persistent worker for the local ControlNet Aux lineart detector.

This worker only extracts a lineart control image. It does not load Stable
Diffusion or a ControlNet generation pipeline, so it stays suitable for a
CPU-only notebook. The Node Local Runtime owns the process and sends one JSON
request per line; stdout is reserved for that protocol.
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


MODEL_ID = os.environ.get("CANVAS_LINEART_MODEL_ID", "lllyasviel/Annotators")
MAX_INPUT_BYTES = 12 * 1024 * 1024
DATA_URL_PATTERN = re.compile(r"^data:(image/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=_-]+)$")
DETECTOR: Any = None


def emit(value: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def load_detector() -> Any:
    global DETECTOR
    if DETECTOR is not None:
        return DETECTOR

    try:
        from controlnet_aux import LineartDetector

        # The detector downloads only the lineart preprocessor weights from the
        # configured Hugging Face cache. It is intentionally not a diffusion
        # pipeline and never loads Stable Diffusion or ControlNet weights.
        with contextlib.redirect_stdout(sys.stderr):
            DETECTOR = LineartDetector.from_pretrained(MODEL_ID)
    except Exception as error:  # pragma: no cover - depends on local files
        raise RuntimeError("lineart_model_missing") from error
    return DETECTOR


def image_from_data_url(value: Any) -> Image.Image:
    if not isinstance(value, str):
        raise ValueError("lineart_input_invalid")
    match = DATA_URL_PATTERN.fullmatch(value)
    if not match:
        raise ValueError("lineart_input_invalid")
    try:
        raw = base64.urlsafe_b64decode(match.group(2) + "=" * (-len(match.group(2)) % 4))
    except Exception as error:
        raise ValueError("lineart_input_invalid") from error
    if not raw or len(raw) > MAX_INPUT_BYTES:
        raise ValueError("lineart_input_invalid")
    try:
        image = Image.open(io.BytesIO(raw)).convert("RGB")
        image.load()
        return image
    except Exception as error:
        raise ValueError("lineart_input_invalid") from error


def encode_png(image: Image.Image) -> str:
    output = io.BytesIO()
    image.save(output, format="PNG", optimize=True)
    return base64.b64encode(output.getvalue()).decode("ascii")


def handle(request: dict[str, Any]) -> dict[str, Any]:
    image = image_from_data_url(request.get("dataUrl"))
    try:
        lineart = load_detector()(image)
        if not isinstance(lineart, Image.Image):
            raise RuntimeError("lineart_inference_failed")
        return {
            "ok": True,
            "requestId": request.get("requestId"),
            "mimeType": "image/png",
            "width": lineart.width,
            "height": lineart.height,
            "modelId": MODEL_ID,
            "device": "cpu",
            "pngBase64": encode_png(lineart.convert("RGB")),
        }
    except RuntimeError:
        raise
    except Exception as error:  # pragma: no cover - depends on local runtime
        raise RuntimeError("lineart_inference_failed") from error


def main() -> None:
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

    for line in sys.stdin:
        # PowerShell and a few Windows launchers may prepend a UTF-8 BOM to
        # the first piped line. The Node runtime sends plain UTF-8, but
        # accepting the marker keeps the worker protocol tolerant for manual
        # diagnostics as well.
        line = line.lstrip("\ufeff").strip()
        if not line:
            continue
        request_id: Any = None
        try:
            request = json.loads(line)
            if not isinstance(request, dict):
                raise ValueError("lineart_input_invalid")
            request_id = request.get("requestId")
            emit(handle(request))
        except ValueError as error:
            emit({"ok": False, "requestId": request_id, "code": str(error) or "lineart_input_invalid", "message": "线稿转换输入无效"})
        except RuntimeError as error:
            code = str(error) or "lineart_inference_failed"
            message = "本地 AI 线稿模型或依赖尚未安装" if code == "lineart_model_missing" else "本地 AI 线稿推理失败"
            emit({"ok": False, "requestId": request_id, "code": code, "message": message})
        except Exception:
            emit({"ok": False, "requestId": request_id, "code": "lineart_inference_failed", "message": "本地 AI 线稿推理失败"})


if __name__ == "__main__":
    main()
