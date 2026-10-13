#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""模块 11 · 导演链路校验机判（返修路由决策）。

依据（运行时从包内读出，读不到才用兜底）：
  · 11 review/01 —— 结论等级四档（18–20 可进入剪辑 / 15–17 局部返修 /
    11–14 简化或拆镜 / 0–10 回到项目硬锁重新设计）；
    返修输出格式（失败类别/可见证据/保持不变/只修改/重写/复检标准）；
    「返修 Prompt 必须冻结所有 2 分字段，只改 0–1 分字段」
  · 11 review/01 —— 「连续两次同类失败时缩短动作或拆镜，但新镜头仍需保留原动作接点」
  · 11 SKILL.md —— 判定「返修回哪一级」；13 compliance 的每条判据自带退回路由
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from .assets import Bundle, read_text

LEVEL_BANDS = [
    (18, 20, "可进入剪辑"),
    (15, 17, "局部返修，不重生合格部分"),
    (11, 14, "镜头结构需要简化或拆镜"),
    (0, 10, "回到项目硬锁和场景连续性重新设计"),
]

# 13 判据前缀 → 退回模块（与 compliance.py 的 route_to 一致的聚合视图）
CODE_PREFIX_ROUTES = [
    ("G", "12 技术语言转换"),
    ("T", "12 技术语言转换"),
    ("F", "04 场景与人物设计"),
    ("L", "04 场景与人物设计（首尾帧）"),
]


def load_bands(bundle: Bundle) -> List[tuple]:
    """review/01 结论等级四档原文。"""
    try:
        t = read_text(bundle.file("11", "review/01-导演复检评分rubric.md"))
    except FileNotFoundError:
        return list(LEVEL_BANDS)
    out = []
    for m in re.finditer(r"-\s*(\d+)\s*[–\-]\s*(\d+)：(.+)", t):
        out.append((int(m.group(1)), int(m.group(2)), m.group(3).strip()))
    return out or list(LEVEL_BANDS)


@dataclass
class RepairPlan:
    score: Optional[int] = None
    verdict: str = ""
    routes: Dict[str, List[str]] = field(default_factory=dict)   # 退回模块 → 判据列表
    loop_rules: List[str] = field(default_factory=list)

    def describe(self) -> str:
        L = []
        if self.score is not None:
            L.append(f"复检得分：{self.score} → {self.verdict}")
        else:
            L.append(f"复检结论：{self.verdict}")
        if self.routes:
            L.append("返修路由（回哪一级）：")
            for mod, codes in self.routes.items():
                L.append(f"  → {mod}：{'、'.join(codes)}")
        else:
            L.append("无 FAIL 项——不触发返修")
        for r in self.loop_rules:
            L.append("  ⚠ " + r)
        return "\n".join(L)

    def to_dict(self) -> dict:
        return {"score": self.score, "verdict": self.verdict, "routes": self.routes,
                "loop_rules": list(self.loop_rules)}


def plan_repair(bundle: Bundle, findings: List[dict], score: Optional[int] = None,
                fail_history: Optional[Dict[str, int]] = None) -> RepairPlan:
    """从 13 的 findings（[{code, level, route_to, msg}]）产出返修路由。

    findings 每条至少含 code/level；route_to 缺省时按判据前缀推断。
    fail_history：{code: 连续失败次数}——连续两次同类失败触发 Loop 纪律。
    """
    plan = RepairPlan(score=score)
    bands = load_bands(bundle)
    if score is not None:
        for lo, hi, verdict in bands:
            if lo <= score <= hi:
                plan.verdict = verdict
                break
    elif not findings:
        plan.verdict = bands[0][2] if bands else "可进入剪辑"

    for f in findings:
        code = str(f.get("code", "?"))
        level = str(f.get("level", "FAIL")).upper()
        if level not in ("FAIL",):
            continue
        route = str(f.get("route_to", "")).strip()
        if not route:
            route = next((m for p, m in CODE_PREFIX_ROUTES if code.startswith(p)), "12 技术语言转换")
        plan.routes.setdefault(route, []).append(code)

    if fail_history:
        for code, n in fail_history.items():
            if n >= 2:
                plan.loop_rules.append(
                    f"判据 {code} 已连续失败 {n} 次——连续两次同类失败：缩短动作或拆镜，"
                    "但新镜头仍需保留原动作接点与停止构图（review/01 返修输出格式）")
    if plan.routes and score is None:
        plan.verdict = "局部返修，不重生合格部分"
    return plan


def load_findings(path: str) -> List[dict]:
    """findings 文件：JSON 数组，或 compliance Report 的 {'findings': [...]}。"""
    data = json.load(open(path, encoding="utf-8"))
    if isinstance(data, list):
        return data
    return data.get("findings", data.get("results", []))
