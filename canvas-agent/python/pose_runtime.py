"""Persistent CPU pose preprocessor for the local media conversion node.

The first notebook-friendly implementation uses the body-only OpenPose
preprocessor from ControlNet Aux. It produces a colored skeleton map and a
small list of normalized keypoints; it does not load a diffusion model.
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


MODEL_ID = os.environ.get("CANVAS_POSE_MODEL_ID", "lllyasviel/Annotators")
MAX_INPUT_BYTES = 12 * 1024 * 1024
DETECT_RESOLUTION = max(256, min(1024, int(os.environ.get("CANVAS_POSE_DETECT_RESOLUTION", "512"))))
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
        import numpy as np
        from controlnet_aux.open_pose.body import Body
        from huggingface_hub import hf_hub_download

        cache_dir = os.environ.get("HF_HUB_CACHE") or None
        with contextlib.redirect_stdout(sys.stderr):
            model_path = hf_hub_download(
                repo_id=MODEL_ID,
                filename="body_pose_model.pth",
                cache_dir=cache_dir,
                local_files_only=True,
            )
            DETECTOR = (Body(model_path), np)
    except Exception as error:  # pragma: no cover - depends on local model files
        raise RuntimeError("pose_model_missing") from error
    return DETECTOR


def image_from_data_url(value: Any) -> Image.Image:
    if not isinstance(value, str):
        raise ValueError("pose_input_invalid")
    match = DATA_URL_PATTERN.fullmatch(value)
    if not match:
        raise ValueError("pose_input_invalid")
    try:
        raw = base64.urlsafe_b64decode(match.group(2) + "=" * (-len(match.group(2)) % 4))
    except Exception as error:
        raise ValueError("pose_input_invalid") from error
    if not raw or len(raw) > MAX_INPUT_BYTES:
        raise ValueError("pose_input_invalid")
    try:
        image = Image.open(io.BytesIO(raw)).convert("RGB")
        image.load()
        return image
    except Exception as error:
        raise ValueError("pose_input_invalid") from error


def encode_png(image: Image.Image) -> str:
    output = io.BytesIO()
    image.save(output, format="PNG", optimize=True)
    return base64.b64encode(output.getvalue()).decode("ascii")


def normalize_people(bodies: list[Any], width: int, height: int) -> list[dict[str, Any]]:
    people: list[dict[str, Any]] = []
    for body in bodies:
        keypoints = []
        visible = []
        for keypoint in body.keypoints:
            if keypoint is None:
                keypoints.append(None)
            else:
                normalized_x = max(0.0, min(1.0, float(keypoint.x) / float(width)))
                normalized_y = max(0.0, min(1.0, float(keypoint.y) / float(height)))
                keypoints.append({
                    "x": normalized_x,
                    "y": normalized_y,
                    "score": float(keypoint.score),
                })
                visible.append((normalized_x, normalized_y, float(keypoint.score)))
        if visible:
            xs = [point[0] for point in visible]
            ys = [point[1] for point in visible]
            confidence = sum(point[2] for point in visible) / len(visible)
            box = {"x": min(xs), "y": min(ys), "width": max(xs) - min(xs), "height": max(ys) - min(ys)}
        else:
            confidence = 0.0
            box = {"x": 0.0, "y": 0.0, "width": 0.0, "height": 0.0}
        people.append({
            "keypoints": keypoints,
            "score": float(body.total_score),
            "confidence": confidence,
            "box": box,
            "parts": int(body.total_parts),
        })
    return people


def handle(request: dict[str, Any]) -> dict[str, Any]:
    image = image_from_data_url(request.get("dataUrl"))
    try:
        import cv2
        import numpy as np
        from controlnet_aux.open_pose.util import draw_bodypose
        from controlnet_aux.util import HWC3, resize_image

        detector, _ = load_detector()
        source = HWC3(np.asarray(image, dtype=np.uint8))
        detected = resize_image(source, DETECT_RESOLUTION)
        candidate, subset = detector(detected[:, :, ::-1].copy())
        bodies = detector.format_body_result(candidate, subset)
        if not bodies:
            raise RuntimeError("pose_no_person")

        height, width = detected.shape[:2]
        people = normalize_people(bodies, width, height)
        canvas = np.zeros_like(detected, dtype=np.uint8)
        for body in bodies:
            normalized = [
                None if keypoint is None else type(keypoint)(
                    x=float(keypoint.x) / float(width),
                    y=float(keypoint.y) / float(height),
                    score=keypoint.score,
                    id=keypoint.id,
                )
                for keypoint in body.keypoints
            ]
            draw_bodypose(canvas, normalized)

        output = cv2.resize(canvas, (image.width, image.height), interpolation=cv2.INTER_LINEAR)
        output_image = Image.fromarray(output.astype(np.uint8), mode="RGB")
        return {
            "ok": True,
            "requestId": request.get("requestId"),
            "mimeType": "image/png",
            "width": image.width,
            "height": image.height,
            "modelId": MODEL_ID,
            "device": "cpu",
            "backend": "openpose-body",
            "personCount": len(bodies),
            "people": people,
            "pngBase64": encode_png(output_image),
        }
    except RuntimeError:
        raise
    except Exception as error:  # pragma: no cover - depends on local runtime
        raise RuntimeError("pose_inference_failed") from error


def main() -> None:
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

    for line in sys.stdin:
        line = line.lstrip("\ufeff").strip()
        if not line:
            continue
        request_id: Any = None
        try:
            request = json.loads(line)
            if not isinstance(request, dict):
                raise ValueError("pose_input_invalid")
            request_id = request.get("requestId")
            emit(handle(request))
        except ValueError as error:
            emit({"ok": False, "requestId": request_id, "code": str(error) or "pose_input_invalid", "message": "姿态转换输入无效"})
        except RuntimeError as error:
            code = str(error) or "pose_inference_failed"
            if code == "pose_model_missing":
                message = "本地姿态模型或依赖尚未安装"
            elif code == "pose_no_person":
                message = "未检测到可用人物姿态"
            else:
                message = "本地姿态推理失败"
            emit({"ok": False, "requestId": request_id, "code": code, "message": message})
        except Exception:
            emit({"ok": False, "requestId": request_id, "code": "pose_inference_failed", "message": "本地姿态推理失败"})


if __name__ == "__main__":
    main()
