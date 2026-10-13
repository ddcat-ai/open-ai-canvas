#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""模块 03 · 视觉意图四维解析 → SHOT_RENDER_PROFILE 机判。

依据（运行时从包内读出，读不到才用兜底）：
  · 03 render/01 —— 组合解析表（用户说法 → A/B/C/D）+ 三条约束（只有说出口的维度才落值；推导值必须标记）
  · 03 render/02 —— 路径别名表（虚幻五/阿诺德/国漫3D/好莱坞级）+ 兼容原则七条（Medium/Realism 同轴互斥）
  · 03 render/10 —— 七组冲突（应自动减权；主导+点缀；不静默删除）
  · 03 render/07 —— 质感组件剂量 2–4
  · 03 SKILL.md —— SHOT_RENDER_PROFILE 是 12 选通道的唯一依据；二次元/赛璐璐不走渲染通道
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from .assets import Bundle, read_text

DIM_NAMES = {"A": "生产体系", "B": "写实度", "C": "渲染策略", "D": "渲染器"}


# ---------------------------------------------------------------- 解析

def load_resolution_table(bundle: Bundle) -> List[tuple]:
    """render/01 组合解析表：(用户说法, 解析结果原文)。"""
    out: List[tuple] = []
    try:
        t = read_text(bundle.file("03", "render/01-视觉意图四维本体.md"))
    except FileNotFoundError:
        return out
    sec = re.search(r"#\s*一、组合解析(.*?)(?=#\s*二、|\Z)", t, re.S)
    if not sec:
        return out
    for m in re.finditer(r"^\|\s*[“\"]([^”\"]+)[”\"]\s*\|\s*([^|]+?)\s*\|\s*$", sec.group(1), re.M):
        out.append((m.group(1).strip(), m.group(2).strip()))
    return out



def lookup_dna(bundle: Bundle, name: str) -> dict:
    """render/08（15 位导演）+ render/09（15 风格 + 12 流派）DNA 锚点检索。
    落地规则：导演名只做锚点不进最终提示词，至少拆 3–5 个 DNA 参数（render/08 用法）。"""
    out = {"found": False, "source": "", "row": "", "note": "导演名只做锚点，不写进最终提示词；至少拆 3–5 个 DNA 参数再进提示词"}
    key = (name or "").strip()
    if not key:
        return out
    for mod, rel, src in (("03", "render/08-导演视觉DNA库.md", "render/08 导演DNA"),
                          ("03", "render/09-视觉风格DNA库.md", "render/09 风格/流派DNA")):
        try:
            t = read_text(bundle.file(mod, rel))
        except FileNotFoundError:
            continue
        for m in re.finditer(r"^\|\s*([^|\n]+?)\s*\|\s*([^|\n]+?)\s*\|", t, re.M):
            head, body = m.group(1).strip(), m.group(2).strip()
            if key in (head + " " + body) and head not in ("---",) and not set(head) <= {"-", " "}:
                out.update(found=True, source=src, row=head + "｜" + body)
                return out
    return out

def load_aliases(bundle: Bundle) -> Dict[str, str]:
    """render/02 路径别名表：惯用名 → 对应组合原文。"""
    out: Dict[str, str] = {}
    try:
        t = read_text(bundle.file("03", "render/02-风格组合矩阵.md"))
    except FileNotFoundError:
        return out
    sec = re.search(r"##\s*路径别名（[^）]*）(.*?)(?=\n# |\Z)", t, re.S)
    body = sec.group(1) if sec else t
    for m in re.finditer(r"^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$", body, re.M):
        k, v = m.group(1).strip(), m.group(2).strip()
        if k in ("惯用路径名", "---") or set(k) <= {"-", " "}:
            continue
        out[k] = v
    return out


def load_conflict_groups(bundle: Bundle) -> Dict[str, tuple]:
    """render/10 七组冲突：冲突名 → (端A, 端B)。"""
    out: Dict[str, tuple] = {}
    try:
        t = read_text(bundle.file("03", "render/10-风格融合与冲突检测.md"))
    except FileNotFoundError:
        return out
    for m in re.finditer(r"^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*↔\s*([^|]+?)\s*\|\s*$", t, re.M):
        k = m.group(1).strip()
        if k in ("冲突", "---") or set(k) <= {"-", " "}:
            continue
        out[k] = (m.group(2).strip(), m.group(3).strip())
    return out


# ---------------------------------------------------------------- 四维解析

def _apply_resolution(text: str, table: List[tuple], prof: "RenderProfile") -> None:
    """按组合解析表落值：只有说出口的维度才落值（locked）。"""
    low = text.lower()
    for phrase, result in sorted(table, key=lambda x: -len(x[0])):
        if phrase.lower() in low:
            prof.locked_sources.append(phrase)
            for dm in re.finditer(r"([ABCD])\s*(?=≠|=|不自动|保持|倾向)?[^；;A-D]*?[=＝]\s*([^；;]+)", result):
                dim, val = dm.group(1), dm.group(2).strip()
                val = re.sub(r"\*\*", "", val)
                if val and val not in ("不自动指定", "保持未指定"):
                    prof.set(dim, val, locked=True)
            for dm in re.finditer(r"([ABCD])\s*[=＝]\s*([^；;]+)", result):
                dim, val = dm.group(1), dm.group(2).strip()
                if val and val not in ("不自动指定", "保持未指定"):
                    prof.set(dim, val, locked=True)


@dataclass
class RenderProfile:
    """SHOT_RENDER_PROFILE：locked（用户锁定）与 derived（推导补齐）分离。"""
    values: Dict[str, str] = field(default_factory=dict)          # dim -> value
    locked: Dict[str, bool] = field(default_factory=dict)         # dim -> 是否 Human Lock
    locked_sources: List[str] = field(default_factory=list)
    channel: str = ""                                             # ue5 / arnold / stylized（供 12 选通道）
    warnings: List[str] = field(default_factory=list)
    conflicts: List[str] = field(default_factory=list)

    def set(self, dim: str, val: str, locked: bool) -> None:
        self.values[dim] = val
        self.locked[dim] = locked

    def describe(self) -> str:
        rows = [f"  {dim} {DIM_NAMES[dim]}：{self.values.get(dim, '（未指定）')}"
                f"{'（用户锁定）' if self.locked.get(dim) else '（推导值）'}"
                for dim in "ABCD"]
        rows.append(f"  转换通道：{self.channel or '（未定）'}")
        for c in self.conflicts:
            rows.append("  ⚠ 冲突：" + c)
        for w in self.warnings:
            rows.append("  ⚠ " + w)
        return "\n".join(rows)

    def to_dict(self) -> dict:
        return {"values": dict(self.values), "locked": dict(self.locked),
                "locked_sources": list(self.locked_sources), "channel": self.channel,
                "conflicts": list(self.conflicts), "warnings": list(self.warnings)}


def build_profile(bundle: Bundle, intent_text: str = "",
                  style_traits: Optional[List[str]] = None) -> RenderProfile:
    """从用户的视觉意图说法生成 SHOT_RENDER_PROFILE。

    style_traits：质感/风格组件清单（供剂量 2–4 与七组冲突检测用）。
    """
    prof = RenderProfile()
    table = load_resolution_table(bundle)
    _apply_resolution(intent_text or "", table, prof)

    aliases = load_aliases(bundle)
    low = (intent_text or "").lower()
    for alias, combo in aliases.items():
        if alias.lower() in low:
            prof.locked_sources.append(f"别名[{alias}]")
            m = re.search(r"渲染策略\s*`?([A-Z_0-9]+)`?", combo)
            if m and "C" not in prof.values:
                prof.set("C", m.group(1), locked=True)
            m = re.search(r"渲染器\s*`?([A-Z_0-9]+)`?", combo)
            if m and "D" not in prof.values:
                prof.set("D", m.group(1), locked=True)
            m = re.search(r"美术方向\s*`?([A-Z_0-9]+)`?", combo)
            if m and "A" not in prof.values:
                prof.set("A", m.group(1), locked=True)
            break

    # 三条约束②：渲染器不反向改写写实度；推导值标记
    if "D" in prof.values and "B" not in prof.values:
        prof.set("B", "写实档继承项目默认", locked=False)
        prof.warnings.append("写实度未由用户指定——已按项目默认补齐并标记为推导值（render/01 约束③）")
    for dim in "ABC":
        if dim not in prof.values:
            defaults = {"A": "写实 3D", "C": "HIGH_QUALITY_REALTIME"}
            if dim in defaults:
                prof.set(dim, defaults[dim], locked=False)
    # D 未指定 → 默认 UE5（01 四轴的渲染引擎轴默认），标推导
    if "D" not in prof.values:
        prof.set("D", "UE5", locked=False)

    # 通道选择（12 选通道的唯一依据）：二次元/赛璐璐不走渲染通道
    d = prof.values.get("D", "")
    if re.search(r"二次元|赛璐璐|cel", intent_text or "", re.I):
        prof.channel = "stylized"
    elif "ARNOLD" in d.upper() or "阿诺德" in (intent_text or ""):
        prof.channel = "arnold"
    else:
        prof.channel = "ue5"

    # 七组冲突检测（render/10）：只报 + 判决提示，不静默删除
    conflicts = load_conflict_groups(bundle)
    for name, (a, b) in conflicts.items():
        wa = a.split("←→")[0]
        if style_traits:
            hit_a = any(w in t for t in style_traits for w in re.split(r"[，、/；;]", a) if w and w in t)
            hit_b = any(w in t for t in style_traits for w in re.split(r"[，、/；;]", b) if w and w in t)
            if hit_a and hit_b:
                prof.conflicts.append(
                    f"【{name}】{a} ↔ {b} 两端同时出现——按判决规则①选一个主导系统，其余作局部点缀并标注比例；不得静默删除")

    # 剂量纪律（render/07）：质感组件 2–4 个
    if style_traits is not None and len(style_traits) > 4:
        prof.warnings.append(
            f"质感组件 {len(style_traits)} 个超过剂量上限 4（render/07 剂量纪律 2–4 个）——过度堆叠会互相打架，请裁到 4 个以内")
    return prof
