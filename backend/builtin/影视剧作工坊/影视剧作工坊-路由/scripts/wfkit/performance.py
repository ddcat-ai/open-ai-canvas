#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""模块 05 · 人物表演区块机判。

依据（运行时从包内读出，读不到才用兜底）：
  · 04 characters/17 —— 微表情基准 M01–M100（可用范围 M01–M100）
  · 04 SKILL.md 硬规则 —— 表情从 05 的微表情/FACS 库选，禁止自造
  · 04 characters/19 交付前自检 —— ⑤ 微表情须是具名项；含呼吸或身体微节拍
  · 05 performance/04 —— 表演约束与质量控制
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from .assets import Bundle, read_text

VAGUE_EMOTION = ["微微悲伤", "有些开心", "显得忧郁", "很有戏", "情绪到位", "眼神有戏",
                 "悲伤", "开心", "愤怒", "开心极了", "非常悲伤"]



def load_au_codes(bundle: Bundle) -> set:
    """performance/03 的 FACS AU 编码库（AU1–AU9x，从原文提取）。"""
    codes = set()
    try:
        t = read_text(bundle.file("05", "performance/03-面部肌肉控制.md"))
    except FileNotFoundError:
        return codes
    for m in re.finditer(r"\bAU(\d{1,2})\b", t):
        codes.add("AU" + m.group(1))
    return codes

def load_micro_ids(bundle: Bundle) -> Dict[str, str]:
    """characters/17 的 M01–M100 微表情库：编号 → 名称。"""
    out: Dict[str, str] = {}
    try:
        t = read_text(bundle.file("04", "characters/17-微表情基准-100组面部表情.md"))
    except FileNotFoundError:
        return out
    for m in re.finditer(r"\*\*(M\d{2,3})[.．]\s*([^*]+)\*\*", t):
        out[m.group(1).upper()] = m.group(2).strip()
    return out


@dataclass
class PerfReport:
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    ok: List[str] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return not self.errors

    def summary(self) -> str:
        L = ["结论：PASS · 表演区块合规" if self.passed else f"结论：FAIL（{len(self.errors)} 项）"]
        for x in self.ok:
            L.append("[PASS ] " + x)
        for x in self.warnings:
            L.append("[WARN ] " + x)
        for x in self.errors:
            L.append("[FAIL ] " + x)
        return "\n".join(L)


def check_performance(bundle: Bundle, block: Dict[str, str]) -> PerfReport:
    """校验表演区块。block 字段：
    identity_anchor —— 角色稳定锚定段（逐字复用）
    action          —— 可见动作/表演描述
    micro           —— 微表情，形如「M23 克制心痛」或「M23」（多个用「、」分隔）
    """
    rep = PerfReport()
    lib = load_micro_ids(bundle)

    anchor = str(block.get("identity_anchor", "")).strip()
    action = str(block.get("action", "")).strip()
    micro = str(block.get("micro", "")).strip()

    # 身份锚定段在场
    if anchor:
        rep.ok.append(f"身份锚定段在场（{len(anchor)} 字，跨镜逐字复用）")
    else:
        rep.errors.append("缺 identity_anchor——身份一致性是表演层的前置（05 执行规范→身份一致性）")

    # 呼吸/身体微节拍（characters/19 自检项）
    if action:
        if re.search(r"呼吸|气息|微节拍|肩线|胸口|起伏", action):
            rep.ok.append("动作层含呼吸/身体微节拍")
        else:
            rep.errors.append("动作层缺呼吸或身体微节拍（肩线/胸口起伏）——characters/19 自检必过项")
    else:
        rep.errors.append("缺 action——表演区块必须给可见动作")

    # 微表情：具名编号 ∈ 库，禁自造
    if not micro:
        rep.warnings.append("未指定微表情——情绪镜头建议从 M01–M100 取具名项")
    else:
        codes = re.findall(r"M\d{2,3}", micro.upper())
        if not codes:
            rep.errors.append(f"微表情「{micro}」不是具名编号——表情禁止自造，须从 characters/17 的 M01–M100 取")
        for c in codes:
            if lib and c not in lib:
                rep.errors.append(f"微表情编号 {c} 不在库内（库范围 M01–M100）——禁止自造")
            elif lib:
                rep.ok.append(f"微表情 {c} {lib[c]}（库内具名项）")

    # 自造情绪词启发式
    blob = action + " " + micro

    # FACS AU 编码校验（performance/03：AU 写进提示词 = 分辨率最高的面部控制）
    au_hits = re.findall(r"\bAU\d{1,2}\b", blob.upper())
    if au_hits:
        lib_au = load_au_codes(bundle)
        unknown = sorted({a for a in au_hits if lib_au and a not in lib_au})
        if unknown:
            rep.errors.append("AU 编码不在库内：" + "、".join(unknown) + "（performance/03 面部肌肉控制）")
        else:
            rep.ok.append("AU 编码全部在库（" + "、".join(sorted(set(au_hits))) + "）")

    for w in VAGUE_EMOTION:
        if w in blob and not re.search(r"M\d{2,3}", micro):
            rep.warnings.append(f"出现情绪形容「{w}」而非具名微表情——05 硬规则：表情从库选，禁止自造")
            break
    return rep
