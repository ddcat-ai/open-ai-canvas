#!/usr/bin/env python3
"""Estimate storyboard duration and route it to one of two production formats.

Input JSON:
{
  "shots": [
    {
      "id": "1-01",
      "dialogue": "台词",
      "action_class": "simple",
      "action_seconds": 2.5,
      "shot_type": "dialogue",
      "breath_seconds": 0.5,
      "transition_seconds": 0
    }
  ]
}
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path
from typing import Any


ACTION_DEFAULTS = {
    "none": 0.0,
    "simple": 2.5,
    "medium": 4.0,
    "complex": 6.5,
    "establishing": 3.0,
    "reaction": 3.0,
}

SHOT_MINIMUMS = {
    "default": 2.0,
    "dialogue": 2.0,
    "action": 2.0,
    "establishing": 2.0,
    "reaction": 3.0,
    "emotional_closeup": 4.0,
}


def effective_character_count(text: str) -> int:
    """Count CJK characters plus letters and digits; ignore punctuation/space."""
    return len(re.findall(r"[\u3400-\u4dbf\u4e00-\u9fffA-Za-z0-9]", text or ""))


def ceil_tenth(value: float) -> float:
    return math.ceil(value * 10 - 1e-9) / 10


def number(value: Any, *, default: float = 0.0, field: str = "value") -> float:
    if value is None:
        return default
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field} must be numeric") from exc
    if result < 0:
        raise ValueError(f"{field} cannot be negative")
    return result


def estimate_shot(shot: dict[str, Any], chars_per_second: float) -> dict[str, Any]:
    shot_id = str(shot.get("id") or "").strip()
    if not shot_id:
        raise ValueError("every shot requires a non-empty id")

    dialogue = str(shot.get("dialogue") or "")
    char_count = effective_character_count(dialogue)
    dialogue_seconds = char_count / chars_per_second if char_count else 0.0
    breath_default = 0.5 if char_count else 0.0
    breath_seconds = number(
        shot.get("breath_seconds"), default=breath_default, field="breath_seconds"
    )
    if dialogue_seconds:
        dialogue_seconds += breath_seconds

    action_class = str(shot.get("action_class") or "none")
    if action_class not in ACTION_DEFAULTS:
        allowed = ", ".join(ACTION_DEFAULTS)
        raise ValueError(f"unknown action_class '{action_class}'; use one of: {allowed}")
    action_seconds = number(
        shot.get("action_seconds"),
        default=ACTION_DEFAULTS[action_class],
        field="action_seconds",
    )

    shot_type = str(shot.get("shot_type") or "default")
    if shot_type not in SHOT_MINIMUMS:
        allowed = ", ".join(SHOT_MINIMUMS)
        raise ValueError(f"unknown shot_type '{shot_type}'; use one of: {allowed}")
    minimum_seconds = number(
        shot.get("minimum_seconds"),
        default=SHOT_MINIMUMS[shot_type],
        field="minimum_seconds",
    )
    transition_seconds = number(
        shot.get("transition_seconds"), default=0.0, field="transition_seconds"
    )

    base_seconds = max(dialogue_seconds, action_seconds, minimum_seconds)
    duration_seconds = ceil_tenth(base_seconds + transition_seconds)
    return {
        "id": shot_id,
        "characters": char_count,
        "dialogue_seconds": ceil_tenth(dialogue_seconds),
        "action_seconds": ceil_tenth(action_seconds),
        "minimum_seconds": ceil_tenth(minimum_seconds),
        "transition_seconds": ceil_tenth(transition_seconds),
        "duration_seconds": duration_seconds,
    }


def episode_plan(
    total_seconds: float,
    production_format: str,
    minimum_seconds: float,
    target_seconds: float,
    maximum_seconds: float,
) -> dict[str, Any]:
    if production_format == "horizontal-premium":
        return {
            "production_format": production_format,
            "aspect_ratio": "16:9",
            "content_split": False,
            "recommended_episodes": 1,
            "note": "横屏中长精品剧固定不拆集；必要的输出批次不等于剧集",
        }
    if production_format != "vertical-short":
        raise ValueError(
            "production_format must be 'horizontal-premium' or 'vertical-short'"
        )

    minimum_count = max(1, math.ceil(total_seconds / maximum_seconds))
    maximum_count = max(1, math.floor(total_seconds / minimum_seconds))
    duration_based = max(1, math.floor(total_seconds / target_seconds + 0.5))
    if minimum_count <= maximum_count:
        recommended = min(max(duration_based, minimum_count), maximum_count)
    else:
        recommended = duration_based
    average_seconds = ceil_tenth(total_seconds / recommended)
    return {
        "production_format": production_format,
        "aspect_ratio": "9:16",
        "content_split": recommended > 1,
        "episode_seconds_range": [minimum_seconds, maximum_seconds],
        "calculation_midpoint_seconds": target_seconds,
        "duration_based_episode_range": [minimum_count, maximum_count],
        "recommended_episodes": recommended,
        "average_seconds_at_recommendation": average_seconds,
        "boundary_adjustment_required": not (
            minimum_seconds <= average_seconds <= maximum_seconds
        ),
        "note": "集数先按时长估算，最终必须按完整情节节点调整",
    }


def estimate(
    payload: dict[str, Any],
    chars_per_second: float,
    production_format: str,
    minimum_seconds: float,
    target_seconds: float,
    maximum_seconds: float,
) -> dict[str, Any]:
    shots = payload.get("shots")
    if not isinstance(shots, list) or not shots:
        raise ValueError("input JSON must contain a non-empty 'shots' array")
    results = [estimate_shot(shot, chars_per_second) for shot in shots]
    total = ceil_tenth(sum(item["duration_seconds"] for item in results))
    plan = episode_plan(
        total,
        production_format,
        minimum_seconds,
        target_seconds,
        maximum_seconds,
    )
    return {
        "shots": results,
        "summary": {
            "shot_count": len(results),
            "total_seconds": total,
            "total_minutes": round(total / 60, 2),
            "chars_per_second": chars_per_second,
            **plan,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="UTF-8 JSON file containing shots")
    parser.add_argument("--chars-per-second", type=float, default=4.0)
    parser.add_argument(
        "--production-format",
        choices=("horizontal-premium", "vertical-short"),
        default="vertical-short",
    )
    parser.add_argument("--minimum-episode-seconds", type=float, default=90.0)
    parser.add_argument("--target-episode-seconds", type=float, default=105.0)
    parser.add_argument("--maximum-episode-seconds", type=float, default=120.0)
    parser.add_argument("--compact", action="store_true", help="emit compact JSON")
    args = parser.parse_args()

    if args.chars_per_second <= 0:
        parser.error("rate must be positive")
    if not (
        0
        < args.minimum_episode_seconds
        <= args.target_episode_seconds
        <= args.maximum_episode_seconds
    ):
        parser.error("episode duration must satisfy 0 < minimum <= target <= maximum")

    try:
        payload = json.loads(args.input.read_text(encoding="utf-8-sig"))
        result = estimate(
            payload,
            args.chars_per_second,
            args.production_format,
            args.minimum_episode_seconds,
            args.target_episode_seconds,
            args.maximum_episode_seconds,
        )
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    if args.compact:
        print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    else:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
