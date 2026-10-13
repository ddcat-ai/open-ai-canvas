#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""模块 08 · 运镜机判（命名预设资产层）。

依据（运行时从包内读出，读不到才用兜底）：
  · 08 moves/09 —— 镜头运动预设库：CL 定语法、CM 定资产名；
    生成层写成哪个英文预设名（如 "Camera Dolly In toward her face"）在本库查
  · 08 SKILL.md —— 运镜五条规则 / 运动语言五支柱 / 运镜四维编码
  · 08 moves/03 —— 运镜纪律（一镜一运动、具名运动+终止条件）
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from .assets import Bundle, read_text


def load_presets(bundle: Bundle) -> List[str]:
    """moves/09 的英文命名预设（引号内的 Camera/推拉摇移短语）。"""
    out: List[str] = []
    seen = set()
    try:
        t = read_text(bundle.file("08", "moves/09-镜头运动预设库.md"))
    except FileNotFoundError:
        return out
    for m in re.finditer(r"[“\"]([A-Z][A-Za-z0-9 ,\-']{5,60})[”\"]", t):
        name = m.group(1).strip()
        key = name.lower()
        if key not in seen and not name.endswith(("：", ":")):
            seen.add(key)
            out.append(name)
    return out


def load_cm_rules(bundle: Bundle) -> Dict[str, str]:
    """CM 规则编号 → 规则原文首句（组合合法性判据索引）。"""
    out: Dict[str, str] = {}
    try:
        t = read_text(bundle.file("08", "moves/09-镜头运动预设库.md"))
    except FileNotFoundError:
        return out
    for m in re.finditer(r"^\*\*(?:规则\s*)?(CM-[\w\-]+)\*\*[：:]?\s*(.+)$", t, re.M):
        out[m.group(1)] = m.group(2).strip()[:120]
    return out


@dataclass
class MovesReport:
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    ok: List[str] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return not self.errors

    def summary(self) -> str:
        L = ["结论：PASS · 运镜合规" if self.passed else f"结论：FAIL（{len(self.errors)} 项）"]
        for x in self.ok:
            L.append("[PASS ] " + x)
        for x in self.warnings:
            L.append("[WARN ] " + x)
        for x in self.errors:
            L.append("[FAIL ] " + x)
        return "\n".join(L)


def check_camera_text(bundle: Bundle, camera_text: str) -> MovesReport:
    """校验镜头/交付件 camera 字段：具名预设 ∈ moves/09 词表；一镜一运动。"""
    rep = MovesReport()
    presets = load_presets(bundle)
    text = camera_text or ""
    if not text.strip():
        rep.errors.append("camera 字段为空")
        return rep

    # 具名预设命中
    named = [p for p in presets if p.lower() in text.lower()]
    if named:
        rep.ok.append("具名预设命中：" + "、".join(named[:4]) + ("…" if len(named) > 4 else ""))
    else:
        rep.warnings.append("未命中 moves/09 英文命名预设——建议查库取精确预设名与提示词短语")

    # 运镜纪律：一镜一运动（moves/03）
    moves = [w for w in ("推", "拉", "摇", "移", "跟", "甩", "环绕", "升降", "手持") if w in text]
    en_moves = [w for w in ("Dolly", "Pan", "Tilt", "Crane", "Orbit", "Zoom", "Tracking", "Handheld", "Whip")
                if w.lower() in text.lower()]
    if len(moves) + len(en_moves) > 3:
        rep.warnings.append(f"疑似多运动叠加（{len(moves) + len(en_moves)} 个运动词）——"
                            "一镜一运动（moves/03 运镜纪律），组合运动须查 CM 组合规则")
    else:
        rep.ok.append("运动词密度符合一镜一运动纪律")

    # 终止条件（characters/19 自检：具名终止条件）
    if not re.search(r"终结|终止|停在|定住|收在|直到", text):
        rep.warnings.append("未见具名终止条件（『终结在她眼波定住的一瞬』式）——characters/19 ⑥ 自检项")
    else:
        rep.ok.append("含具名终止条件")
    return rep
