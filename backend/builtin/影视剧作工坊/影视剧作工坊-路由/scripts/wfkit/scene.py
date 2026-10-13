#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""模块 04 · 场景线六维拼装机判。

依据（运行时从包内读出，读不到才用兜底）：
  · 04 SKILL.md 场景线执行流程 —— 六维拼装缺一不可、每维只选一个
  · 04 scenes/01 —— 六维① 渲染质感：真人实景/超写实3D/次世代/Arnold/国漫/UE5
  · 04 scenes/02 —— 六维② 场景类型；scenes/03 —— 六维③ 时段（13 种气候时段表）
  · 04 scenes/04 —— 六维④ 方位（镜头高度表）；scenes/05 —— 六维⑤ 元素
  · 04 人物线第 1 步 —— 目标平台为 Seedance/即梦：不支持上传写实真人脸部素材
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from .assets import Bundle, read_text

DIM_KEYS = ["风格通道", "场景类型", "时间天气", "空间方位", "建筑材质", "光影氛围"]


def _read(bundle: Bundle, rel: str) -> str:
    try:
        return read_text(bundle.file("04", rel))
    except FileNotFoundError:
        return ""


def load_channels(bundle: Bundle) -> List[str]:
    """scenes/01 的六维① 合法取值（A/B1–B5 标题）。"""
    t = _read(bundle, "scenes/01-场景风格通道.md")
    vals = []
    for m in re.finditer(r"^##\s+([A-Z]\d?)\.\s*(.+?)（", t, re.M):
        vals.append(m.group(2).strip())
    return vals or ["真人实景", "超写实 3D", "次世代", "Arnold", "国漫风", "UE5"]


def load_types(bundle: Bundle) -> List[str]:
    """scenes/02 的六维② 大类（一、二、三…标题）。"""
    t = _read(bundle, "scenes/02-场景类型库.md")
    vals = []
    for m in re.finditer(r"^##\s*[一二三四五六七八九十]+、\s*(\S+?)（", t, re.M):
        vals.append(m.group(1).strip())
    return vals


def load_times(bundle: Bundle) -> List[str]:
    """scenes/03 的六维③ 时段表（时段列）。"""
    t = _read(bundle, "scenes/03-全气候光照库.md")
    vals = []
    for m in re.finditer(r"^\|\s*([^|]+?)\s*\|\s*[^|]+\|\s*[^|]+\|\s*$", t, re.M):
        v = m.group(1).strip()
        if v in ("时段", "---") or set(v) <= {"-", " "} or v.startswith(":"):
            continue
        vals.append(v)
    return vals


def load_angles(bundle: Bundle) -> List[str]:
    """scenes/04 的六维④ 方位（中文写法列前半）。"""
    t = _read(bundle, "scenes/04-场景取景视角.md")
    vals = []
    for m in re.finditer(r"^\|\s*([^|]+?)\s*\|\s*([^|]+?)\|\s*[^|]+\|\s*[^|]+\|\s*$", t, re.M):
        v = m.group(1).strip()
        if v in ("方位", "---") or set(v) <= {"-", " "}:
            continue
        vals.append(v)
    return vals


@dataclass
class SceneReport:
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    ok: List[str] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return not self.errors

    def summary(self) -> str:
        L = ["结论：PASS · 六维拼装齐备" if self.passed else f"结论：FAIL（{len(self.errors)} 项）"]
        for x in self.ok:
            L.append("[PASS ] " + x)
        for x in self.warnings:
            L.append("[WARN ] " + x)
        for x in self.errors:
            L.append("[FAIL ] " + x)
        return "\n".join(L)


def check_scene(bundle: Bundle, scene: Dict[str, str], platform: str = "") -> SceneReport:
    """六维拼装校验。scene 键 = 六维名（风格通道/场景类型/时间天气/空间方位/建筑材质/光影氛围）。

    每维的值允许多个候选用「、」分隔——但六维规则是「每维只选一个」，多值即 FAIL。
    """
    rep = SceneReport()
    channels = load_channels(bundle)
    times = load_times(bundle)
    angles = load_angles(bundle)

    # 缺一不可
    for k in DIM_KEYS:
        if k not in scene or not str(scene.get(k, "")).strip():
            rep.errors.append(f"六维【{k}】缺值——场景线六维拼装缺一不可（04 SKILL.md）")
        elif "、" in str(scene[k]).strip() or "/" in str(scene[k]).strip():
            rep.errors.append(f"六维【{k}】填了多个值「{scene[k]}」——每维只选一个，不要堆砌")
        else:
            rep.ok.append(f"六维【{k}】={scene[k]}")

    # 词表命中校验（能对上词表的维做成员校验；对不上的不硬判）
    ch = str(scene.get("风格通道", "")).strip()
    if ch and channels and not any(ch in c or c in ch for c in channels):
        rep.errors.append(f"六维①风格通道「{ch}」不在 scenes/01 词表（{'、'.join(channels)}）")
    tm = str(scene.get("时间天气", "")).strip()
    if tm and times and not any(tm in t or t in tm for t in times):
        rep.warnings.append(f"六维③时间天气「{tm}」未精确命中 scenes/03 时段表——建议改用表内时段名")
    ang = str(scene.get("空间方位", "")).strip()
    if ang and angles and not any(ang in a or a.split("，")[0] in ang for a in angles):
        rep.warnings.append(f"六维④空间方位「{ang}」未命中 scenes/04 方位表")

    # 平台建议（04 人物线第 1 步）
    if re.search(r"即梦|seedance|jimeng", platform or "", re.I) and ch and "真人实景" in ch:
        rep.warnings.append(
            "目标平台为 Seedance/即梦：不支持上传写实真人脸部素材——优先选风格化通道（次世代/国漫），或走文生视频不传参考图")
    return rep
