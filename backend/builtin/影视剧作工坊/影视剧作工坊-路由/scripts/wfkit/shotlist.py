#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""模块 07 · 分镜字段机判。

依据（运行时从包内读出，读不到才用兜底）：
  · 07 shotlist/03 —— 分镜 11 必填字段模板（快切镜头也不允许省略）
  · 07 SKILL.md 铁律 1 —— 一镜一信息（叙事功能只填一个）
  · 07 shotlist/03 —— 光影字段必须覆盖 6 项中至少 4 项
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from .assets import Bundle, read_text

REQUIRED_FIELDS = ["焦段", "光圈", "景深与焦点锁", "机位", "构图", "运镜",
                   "主体动作表情", "台词与语气", "光影", "限制", "下一段衔接"]

LIGHT_SIX = ["光源来源", "主光", "辅光", "亮区", "暗区", "轮廓", "色温", "反差"]
NARRATIVE_FUNCTIONS = ["动作", "情绪", "环境", "细节"]


def load_fields(bundle: Bundle) -> List[str]:
    """从 shotlist/03 模板解析 11 必填字段名（解析不到用内置表）。"""
    try:
        t = read_text(bundle.file("07", "shotlist/03-剧本创作工作室·精华提炼.md"))
    except FileNotFoundError:
        return list(REQUIRED_FIELDS)
    names = re.findall(r"^([焦光景机构运主台台限下][^：:]{0,7})：", t, re.M)
    got = [n.strip() for n in names if n.strip() in
           ("焦段", "光圈", "景深与焦点锁", "机位", "构图", "运镜",
            "主体动作/表情", "主体动作表情", "台词与语气", "光影", "限制", "下一段衔接")]
    got = [g.replace("主体动作/表情", "主体动作表情") for g in got]
    return got or list(REQUIRED_FIELDS)


@dataclass
class ShotReport:
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    ok: List[str] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return not self.errors

    def summary(self) -> str:
        L = ["结论：PASS · 分镜字段齐备" if self.passed else f"结论：FAIL（{len(self.errors)} 项）"]
        for x in self.ok:
            L.append("[PASS ] " + x)
        for x in self.warnings:
            L.append("[WARN ] " + x)
        for x in self.errors:
            L.append("[FAIL ] " + x)
        return "\n".join(L)


def check_shot(bundle: Bundle, shot: Dict[str, str]) -> ShotReport:
    """校验单个分镜的 11 必填字段 + 一镜一信息 + 光影 6 项覆盖。

    shot 键 = 11 字段名（主体动作表情 / 主体动作/表情 均可），另可带：
    shot_type —— 主镜头 / 辅助镜头 / 快切镜头（快切同样必须 11 字段全）
    叙事功能  —— 动作/情绪/环境/细节，只允许填一个（铁律 1）
    """
    rep = ShotReport()
    fields = load_fields(bundle)
    st = str(shot.get("shot_type", "主镜头"))

    missing = [f for f in fields if not str(shot.get(f, "")).strip()]
    if missing:
        kind = "快切镜头也不允许因快省略" if "快切" in st else "11 必填字段缺一不可"
        rep.errors.append(f"缺字段：{'、'.join(missing)}（{kind}——shotlist/03）")
    else:
        rep.ok.append(f"11 必填字段齐备（{st}）")

    nf = str(shot.get("叙事功能", "")).strip()
    if not nf:
        rep.warnings.append("未填「叙事功能」——建议标注（动作/情绪/环境/细节 单选）")
    else:
        hits = [f for f in NARRATIVE_FUNCTIONS if f in nf]
        if len(hits) > 1:
            rep.errors.append(f"叙事功能填了多个（{('、'.join(hits))}）——铁律 1「一镜一信息」，多重信息必须拆镜")
        elif len(hits) == 1:
            rep.ok.append(f"一镜一信息：叙事功能={hits[0]}")
        else:
            rep.warnings.append(f"叙事功能「{nf}」不在四类（动作/情绪/环境/细节）内")

    # 06 焦距库：焦段 × 景别对照（从机位文本提取景别）
    focal = str(shot.get("焦段", "")).strip()
    cam_text = str(shot.get("机位", "")) + " " + str(shot.get("构图", ""))
    msz = re.search(r"景别为\[([^\]]+)\]|(远景|全景|中景|近景|特写|超特写)", cam_text)
    if focal and msz:
        from .lens import check_focal
        lr = check_focal(bundle=bundle, focal_text=focal, shot_size=msz.group(1) or msz.group(2) or "")
        for x in lr.ok:
            rep.ok.append("焦距 " + x)
        for x in lr.warnings:
            rep.warnings.append("焦距 " + x)
        for x in lr.errors:
            rep.errors.append("焦距 " + x)

    light = str(shot.get("光影", "")).strip()
    if light:
        covered = sum(1 for k in LIGHT_SIX if k in light)
        if covered < 4:
            rep.errors.append(f"光影字段只覆盖 {covered}/6 项（{covered} < 4）——shotlist/03 要求至少覆盖 6 项中 4 项")
        else:
            rep.ok.append(f"光影字段覆盖 {covered}/6 项")
    return rep
