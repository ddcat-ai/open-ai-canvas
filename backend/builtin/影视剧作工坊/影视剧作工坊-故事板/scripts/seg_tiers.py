#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""seg_tiers.py — 分段交付档位表（单一真源）

15秒档为默认（v21起）；10秒档为 v35 新增可选档，由用户声明「十秒输出交付」激活。
render.py / validate.py / check_segments.py / regression.py 全部从本模块取参数，
避免段长容差、尾段豁免上限、文件名后缀在四个脚本里各自硬编码而口径漂移。

档位解析优先级：JSON 的 segment_tier > segment_duration > 默认 15s。
"""

# 档位表：target=目标段长, tol=容差(±), tail_max=尾段豁免上限,
#         suffix=交付文件名后缀（ASCII+中文，用于文件名）, label=文档标题中文标签
SEG_TIERS = {
    "15s": {"target": 15.0, "tol": 1.5, "tail_max": 18.0, "suffix": "15s交付", "label": "15秒"},
    "10s": {"target": 10.0, "tol": 1.0, "tail_max": 12.0, "suffix": "10s交付", "label": "10秒"},
}
DEFAULT_TIER = "15s"

# 用户口头声明 → 档位键（SKILL.md 触发词与 audio-delivery.md §4.1 同源）
TIER_ALIASES = {
    "15s": "15s", "15": "15s", 15: "15s", 15.0: "15s",
    "10s": "10s", "10": "10s", 10: "10s", 10.0: "10s",
}


def resolve_tier(d):
    """从 storyboard JSON 解析档位键，未声明则回默认档。"""
    raw = (d or {}).get("segment_tier")
    if raw is None:
        raw = (d or {}).get("segment_duration")
    if raw is None:
        return DEFAULT_TIER
    key = TIER_ALIASES.get(raw) or TIER_ALIASES.get(str(raw).strip().lower())
    return key if key in SEG_TIERS else DEFAULT_TIER


def tier(d):
    """返回档位参数字典（target/tol/tail_max/suffix）。"""
    return SEG_TIERS[resolve_tier(d)]


def bounds(d):
    """返回 (lo, hi, tail_max, target, suffix)。"""
    t = tier(d)
    return t["target"] - t["tol"], t["target"] + t["tol"], t["tail_max"], t["target"], t["suffix"]


def seg_filename(episode, seg_id, d):
    """交付文件名：E集-P段号-{档位}交付.md"""
    return f"{episode}-{seg_id}-{tier(d)['suffix']}.md"


def tolerance_text(d):
    """人读容差描述，用于交付文件自检清单。"""
    lo, hi, tail_max, target, _ = bounds(d)
    return f"{lo:g}s-{hi:g}s（或{tail_max:g}s骤停豁免/short_exempt短段豁免）"
