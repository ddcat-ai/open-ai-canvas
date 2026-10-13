#!/usr/bin/env python3
"""Analyze plain-text source size for 分镜剧本 intake routing."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


EFFECTIVE_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fffA-Za-z0-9]")
CHAPTER_RE = re.compile(
    r"(?m)^\s*(?:第\s*[0-9一二三四五六七八九十百千万零〇两]+\s*[章节回集卷幕]|chapter\s+\d+)\b",
    re.IGNORECASE,
)


def classify(effective_chars: int, chapters: int) -> dict[str, object]:
    if effective_chars > 50_000 or chapters >= 50:
        return {
            "level": "project_map_required",
            "message": "先建立项目总纲、人物关系与事件时间线，再按完整情节节点分批处理；处理批次不等于拆集",
            "recommended_batch_chars": "8000-12000",
            "recommended_chapters_per_batch": "2-5",
        }
    if effective_chars > 20_000:
        return {
            "level": "episode_map_first",
            "message": "先做全局诊断、故事总纲和情节地图，再分批详细处理；是否拆集由后续制作制式决定",
            "recommended_batch_chars": "8000-12000",
            "recommended_chapters_per_batch": "2-5",
        }
    if effective_chars > 12_000:
        return {
            "level": "split_recommended",
            "message": "可以处理，详细输出应按完整戏剧节点分批；横屏仍可保持不拆集",
            "recommended_batch_chars": "不超过20000",
            "recommended_chapters_per_batch": "按完整戏剧节点",
        }
    if effective_chars >= 3_000:
        return {
            "level": "ideal_detail_range",
            "message": "适合单批详细改编",
            "recommended_batch_chars": "3000-12000",
            "recommended_chapters_per_batch": "按完整戏剧节点",
        }
    return {
        "level": "short_source",
        "message": "可直接进入单集或单段详细改编",
        "recommended_batch_chars": "当前全文",
        "recommended_chapters_per_batch": "当前全文",
    }


def analyze(text: str) -> dict[str, object]:
    effective_chars = len(EFFECTIVE_RE.findall(text))
    chapters = len(CHAPTER_RE.findall(text))
    result: dict[str, object] = {
        "effective_characters": effective_chars,
        "source_characters": len(text),
        "detected_chapters": chapters,
    }
    result.update(classify(effective_chars, chapters))
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", nargs="?", type=Path, help="UTF-8 text/Markdown file; omit to read stdin")
    parser.add_argument("--compact", action="store_true", help="emit compact JSON")
    args = parser.parse_args()

    try:
        text = args.input.read_text(encoding="utf-8-sig") if args.input else sys.stdin.read()
    except OSError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    output = analyze(text)
    print(json.dumps(output, ensure_ascii=False, separators=(",", ":") if args.compact else None, indent=None if args.compact else 2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
