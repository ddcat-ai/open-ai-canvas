#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""模块 06 · 焦距库机判（景别 ↔ 焦距区间）。

依据（运行时从包内读出，读不到才用兜底）：
  · 06 shotlang/06-焦距库.md —— 焦距分类总览（超广角 10–24mm … 超长焦 200mm+）
    与各焦段的「禁止」项（如超广角禁止人物面部特写、边缘放置人脸）
  · 06 shotlang/01 —— 10 种景别（配合 assets.shot_sizes）
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from .assets import Bundle, read_text


def load_focal_table(bundle: Bundle) -> List[Tuple[str, float, float]]:
    """焦距分类总览：[(类别名, 下限mm, 上限mm), ...]。200mm+ 上限取 10000。"""
    out: List[Tuple[str, float, float]] = []
    try:
        t = read_text(bundle.file("06", "shotlang/06-焦距库.md"))
    except FileNotFoundError:
        return out
    sec = re.search(r"##\s*焦距分类总览(.*?)(?=\n## |\Z)", t, re.S)
    body = sec.group(1) if sec else t
    for m in re.finditer(r"^-\s*([^：:]+)：\s*(\d+)\s*mm?\s*~\s*(\d+)(mm\+)?", body, re.M):
        name, lo, hi = m.group(1).strip(), float(m.group(2)), float(m.group(3))
        out.append((name, lo, hi if m.group(4) else hi))
    for m in re.finditer(r"^-\s*([^：:]+)：\s*(\d+)\s*mm\s*/\s*(\d+)\s*mm\s*$", body, re.M):
        out.append((m.group(1).strip(), float(m.group(2)), float(m.group(3))))
    for m in re.finditer(r"^-\s*([^：:]+)：\s*(\d+)\s*mm\+\s*$", body, re.M):
        out.append((m.group(1).strip(), float(m.group(2)), 10000.0))
    for m in re.finditer(r"^-\s*([^：:]+)：\s*(\d+)\s*mm\s*$", body, re.M):
        name, v = m.group(1).strip(), float(m.group(2))
        out.append((name, v, v))
    return out


def load_focal_bans(bundle: Bundle) -> Dict[str, List[str]]:
    """各焦段章节的「禁止」行：类别名 → [禁止项, ...]。"""
    out: Dict[str, List[str]] = {}
    try:
        t = read_text(bundle.file("06", "shotlang/06-焦距库.md"))
    except FileNotFoundError:
        return out
    cur = ""
    for ln in t.splitlines():
        m = re.match(r"^##\s*[一二三四五六七八九十]+、\s*(\S+?)\s*\d+mm", ln)
        if m:
            cur = m.group(1)
            out.setdefault(cur, [])
            continue
        if cur and ln.strip().startswith(("禁止", "- 禁止")):
            out[cur].append(ln.strip().lstrip("- ").replace("禁止：", "").strip())
    return out


@dataclass
class LensReport:
    category: str = ""
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    ok: List[str] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return not self.errors

    def summary(self) -> str:
        L = [f"焦距判定：{self.category or '（未识别）'}"]
        for x in self.ok:
            L.append("[PASS ] " + x)
        for x in self.warnings:
            L.append("[WARN ] " + x)
        for x in self.errors:
            L.append("[FAIL ] " + x)
        return "\n".join(L)


def check_focal(bundle: Bundle, focal_text: str, shot_size: str = "") -> LensReport:
    """焦距 ↔ 景别机判。

    focal_text : 焦段描述（"85mm" / "中长焦 85-100mm" / "35-50mm"）
    shot_size  : 该镜景别（06 景别表；用于对照各焦段的「禁止」项）
    """
    rep = LensReport()
    table = load_focal_table(bundle)
    bans = load_focal_bans(bundle)
    if not table:
        rep.warnings.append("焦距分类总览解析失败——跳过机判（人工核对 shotlang/06）")
        return rep

    m = re.search(r"(\d{2,4})\s*mm", focal_text or "")
    if not m:
        # 允许写类别名（"中长焦"）
        for name, lo, hi in table:
            if name and name in (focal_text or ""):
                rep.category = name
                break
        if not rep.category:
            rep.warnings.append(f"焦段「{focal_text}」无法解析出 mm 数或类别——shotlang/06 分类："
                                + "、".join(n for n, *_ in table))
            return rep
    else:
        mm = float(m.group(1))
        hit = [(n, lo, hi) for n, lo, hi in table if lo <= mm <= hi]
        if not hit:
            rep.warnings.append(f"{mm:g}mm 不在任何分类区间——shotlang/06 分类：" + "、".join(n for n, *_ in table))
            return rep
        rep.category = hit[0][0]
        rep.ok.append(f"{mm:g}mm ∈ {rep.category}（{hit[0][1]:g}–{hit[0][2]:g}mm）")

    # 类别「禁止」项 × 景别对照
    sz = shot_size or ""
    for ban in bans.get(rep.category.split()[0], []) + bans.get(rep.category, []):
        if sz and any(k in ban for k in ("特写", "人脸", "面部")) and any(k in sz for k in ("特写", "近景")):
            rep.errors.append(f"{rep.category} 的禁止项「{ban}」与该镜景别「{sz}」冲突——shotlang/06")
        elif sz and sz and any(k in ban for k in ("人物面部", "边缘放置")):
            rep.warnings.append(f"{rep.category} 提示：{ban}（当前景别 {sz}，请核对构图）")
    return rep
