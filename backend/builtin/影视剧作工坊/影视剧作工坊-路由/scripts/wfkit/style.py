#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""模块 02 · 影视风格机判。

依据（全部运行时从包内读出，读不到才用兜底）：
  · 02 style/01-电影风格条目.md —— 电影类型 Genre 表（灯光默认/色彩倾向/运动风格）
  · 02 style/06-导演风格库.md —— D0xx 导演卡（一次只挂一张，光影逻辑互斥）
  · 02 SKILL.md 执行流程 —— 氛围比对 → 导演挂卡 → 中性缺省
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from .assets import Bundle, read_text


# ---------------------------------------------------------------- 数据

@dataclass
class Genre:
    name: str = ""
    lighting: str = ""
    color: str = ""
    motion: str = ""


@dataclass
class DirectorCard:
    code: str = ""
    name: str = ""
    body: str = ""
    keywords: List[str] = field(default_factory=list)


@dataclass
class StyleDecision:
    genre: Optional[Genre] = None
    cards: List[DirectorCard] = field(default_factory=list)
    color_mood: str = ""            # style/03 调色情绪命中
    palette: str = ""               # style/02 调色板建议
    fallback: bool = False          # 中性缺省
    warnings: List[str] = field(default_factory=list)
    hits: List[str] = field(default_factory=list)

    def describe(self) -> str:
        parts: List[str] = []
        if self.genre:
            parts.append(f"影调档：{self.genre.name}（灯光={self.genre.lighting}｜色彩={self.genre.color}｜运动={self.genre.motion}）")
        if self.cards:
            parts.append("导演挂卡：" + "、".join(f"{c.code} {c.name}" for c in self.cards))
        if self.color_mood:
            parts.append(f"调色情绪：{self.color_mood}")
        if self.palette:
            parts.append(f"调色板建议：{self.palette}")
        if self.fallback:
            parts.append("中性缺省（未命中氛围词与导演卡——02 硬规则：无命中不硬挂）")
        for w in self.warnings:
            parts.append("  ⚠ " + w)
        return "\n".join(parts) or "（无风格判定）"

    def to_dict(self) -> dict:
        return {
            "genre": None if not self.genre else vars(self.genre),
            "cards": [{"code": c.code, "name": c.name} for c in self.cards],
            "color_mood": self.color_mood,
            "palette": self.palette,
            "fallback": self.fallback,
            "warnings": list(self.warnings),
            "hits": list(self.hits),
        }


# ---------------------------------------------------------------- 解析

def load_genres(bundle: Bundle) -> Dict[str, Genre]:
    """style/01 的 Cinema Studio 2.5 表：类型 | 灯光默认 | 色彩倾向 | 运动风格。"""
    out: Dict[str, Genre] = {}
    try:
        t = read_text(bundle.file("02", "style/01-电影风格条目.md"))
    except FileNotFoundError:
        return out
    for m in re.finditer(r"^\s*([^\n|｜]+?)\s*[|｜]\s*([^|｜]+)[|｜]\s*([^|｜]+)[|｜]\s*([^|｜]+?)\s*$", t, re.M):
        name = m.group(1).strip().strip("　").strip()
        if name in ("类型", "---", "") or set(name) <= {"－", "-", "　"}:
            continue
        g = Genre(name=name, lighting=m.group(2).strip().strip("　"),
                  color=m.group(3).strip().strip("　"), motion=m.group(4).strip().strip("　"))
        out[name] = g
    # Cinema Studio 3.0/3.5 专属类型（Noir/Drama/Epic）：母源只给名字、无属性行——按名路由，如实标注
    m30 = re.search(r"Cinema Studio 3\.0 / 3\.5 版（7 个）：(.{0,220}?)⚠", t, re.S)
    if m30:
        for pair in re.findall(r"([A-Za-z]+) ([一-鿿]{2,6})", m30.group(1)):
            en, zh = pair
            if not any(zh in k for k in out):
                out[f"{en} {zh}"] = Genre(name=f"{en} {zh}", lighting="（3.0 版无属性行）",
                                          color="（3.0 版无属性行）", motion="（3.0 版无属性行）")
    return out



def check_film_single(bundle: Bundle, text: str) -> list:
    """style/04 调色纪律：胶片模拟一次只用一种，不叠加两种胶片名（返回告警列表）。"""
    out = []
    try:
        t = read_text(bundle.file("02", "style/04-胶片模拟与调色一致性.md"))
    except FileNotFoundError:
        return out
    films = []
    for m in re.finditer(r"^\|\s*([^|\n]+?)\s*\|", t, re.M):
        w = m.group(1).strip()
        if w and w not in ("胶片", "---") and not set(w) <= {"-", " "} and len(w) >= 2:
            films.append(w)
    low = (text or "").lower()
    hits = []
    for w in films or []:
        if w.lower() in low or any(tok.lower() in low for tok in w.split() if len(tok) >= 5 and tok.isalpha()):
            hits.append(w)
    if len(hits) > 1:
        out.append("胶片模拟声明了多种（" + "、".join(hits) + "）——style/04：一次只用一种，不要叠加两种胶片名")
    return out

def load_palettes(bundle: Bundle) -> Dict[str, str]:
    """style/02 的 8 个调色板：名称（中文名）→ 用途描述。"""
    out: Dict[str, str] = {}
    try:
        t = read_text(bundle.file("02", "style/02-调色板.md"))
    except FileNotFoundError:
        return out
    blocks = re.split(r"^\s*\d+\.\s*", t, flags=re.M)[1:]
    for blk in blocks:
        lines = [x.strip() for x in blk.splitlines() if x.strip()]
        if not lines:
            continue
        out[lines[0]] = lines[1] if len(lines) > 1 else ""
    return out


def load_color_moods(bundle: Bundle) -> Dict[str, str]:
    """style/03 的 11 种调色情绪：情绪氛围 → 调色描述。"""
    out: Dict[str, str] = {}
    try:
        t = read_text(bundle.file("02", "style/03-调色情绪.md"))
    except FileNotFoundError:
        return out
    for m in re.finditer(r"^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$", t, re.M):
        k, v = m.group(1).strip(), m.group(2).strip()
        if k in ("情绪氛围", "---") or set(k) <= {"-", " "}:
            continue
        out[k] = v
    return out


def check_color_ratio(text: str) -> Optional[str]:
    """60/30/10 色彩规则声明检查（02 硬规则速记）。返回提示或 None。"""
    if re.search(r"60[/／%].{0,6}30[/／%].{0,6}10|60\s*[-–—]\s*30\s*[-–—]\s*10", text or ""):
        return None
    return "未见 60/30/10 色彩比例声明——02 硬规则：整片级调色须声明主色 60%、辅色 30%、点缀 10%"


def load_director_cards(bundle: Bundle) -> Dict[str, DirectorCard]:
    """style/06 的【D0xx 名称】卡块。"""
    out: Dict[str, DirectorCard] = {}
    try:
        t = read_text(bundle.file("02", "style/06-导演风格库.md"))
    except FileNotFoundError:
        return out
    blocks = re.split(r"【(D\d{3})\s*([^】]*)】", t)
    for i in range(1, len(blocks) - 1, 3):
        code, name, body = blocks[i], blocks[i + 1].strip(), blocks[i + 2]
        c = DirectorCard(code=code, name=name, body=body)
        kws = re.findall(r"「([^」]{2,8})」|『([^』]{2,8})』", body)
        c.keywords = [a or b for a, b in kws][:12]
        out[code] = c
    return out


# ---------------------------------------------------------------- 路由

def decide(bundle: Bundle, mood_text: str) -> StyleDecision:
    """氛围比对 → 导演挂卡 → 中性缺省（02 执行流程的机判版）。"""
    d = StyleDecision()
    low = (mood_text or "").lower()

    genres = load_genres(bundle)
    for name, g in genres.items():
        zh = re.sub(r"[A-Za-z /]+", "", name).strip() or name.split()[0]
        token = zh if zh and zh in low else (name.split()[0].lower() if name.split() and name.split()[0].lower() in low else None)
        if token:
            d.genre = g
            d.hits.append(name)
            break

    cards = load_director_cards(bundle)
    for code, c in cards.items():
        if code.lower() in low or c.name in (mood_text or ""):
            d.cards.append(c)
            d.hits.append(f"{code} {c.name}")
            continue
        for kw in c.keywords:
            if kw in (mood_text or ""):
                d.cards.append(c)
                d.hits.append(f"{code} {c.name}（词「{kw}」）")
                break

    if len(d.cards) > 1:
        d.warnings.append(
            f"命中 {len(d.cards)} 张导演卡（{'、'.join(c.code for c in d.cards)}）——"
            "02 硬规则：一次只挂一张卡，光影逻辑互斥；请按主氛围裁到一张，或声明主次（主卡+点缀比例）")

    # 调色情绪路由（style/03，11 种）
    moods = load_color_moods(bundle)
    for name, desc in moods.items():
        if name in (mood_text or ""):
            d.color_mood = f"{name}：{desc}"
            d.hits.append(f"调色情绪[{name}]")
            break
    # 调色板建议（style/02，8 个）
    palettes = load_palettes(bundle)
    for name, desc in palettes.items():
        token = re.sub(r"（[^）]*）", "", name)
        if any(w in (mood_text or "") for w in token.split() if len(w) >= 2):
            d.palette = f"{name}——{desc}"
            break
    # 60/30/10 声明检查
    ratio = check_color_ratio(mood_text or "")
    if ratio and (d.genre or d.cards or d.color_mood):
        d.warnings.append(ratio)
    if d.genre is None and not d.cards:
        d.fallback = True
    return d
