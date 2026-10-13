#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""模块 09 · 音频机判。

依据（运行时从包内读出，读不到才用兜底）：
  · 09 audio/04 —— 口型同步规则：对白片段 3–8 秒为准确率最佳区间；
    超 8 秒准确率劣化；15 秒是技术上限；头/脸运动词与口型引擎争抢；
    口型优先时不放环境声/音乐词（招来生成式音频覆盖对白）
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from .assets import Bundle, read_text

HEAD_FACE_MOTION = ["nodding", "turning head", "looking around", "点头", "转头", "四处张望"]


def load_lipsync_rules(bundle: Bundle) -> Dict[str, object]:
    """从 audio/04 原文解析阈值；解析不到用内置兜底。"""
    out: Dict[str, object] = {"best_lo": 3, "best_hi": 8, "hard_max": 15,
                              "motion_words": list(HEAD_FACE_MOTION)}
    try:
        t = read_text(bundle.file("09", "audio/04-口型对白匹配.md"))
    except FileNotFoundError:
        return out
    m = re.search(r"对白片段保持\s*(\d+)\s*[–\-—~]\s*(\d+)\s*秒", t)
    if m:
        out["best_lo"], out["best_hi"] = int(m.group(1)), int(m.group(2))
    m = re.search(r"不要用\s*(\d+)\s*秒片段做口型同步", t)
    if m:
        out["hard_max"] = int(m.group(1))
    words = re.findall(r"`(\w+(?:\s+\w+)?)`（[^）]*）", t)
    if words:
        out["motion_words"] = sorted(set(words) | {"点头", "转头", "四处张望"})
    return out


@dataclass
class AudioReport:
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    ok: List[str] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return not self.errors

    def summary(self) -> str:
        L = ["结论：PASS · 音频合规" if self.passed else f"结论：FAIL（{len(self.errors)} 项）"]
        for x in self.ok:
            L.append("[PASS ] " + x)
        for x in self.warnings:
            L.append("[WARN ] " + x)
        for x in self.errors:
            L.append("[FAIL ] " + x)
        return "\n".join(L)


def check_audio(bundle: Bundle, dialogue: str = "", duration: float = 0.0,
                lip_sync_priority: bool = False, text: str = "") -> AudioReport:
    """音频轨机判。

    dialogue        —— 对白原文（含说话者/语气标注可）
    duration        —— 对白时长（秒）
    lip_sync_priority —— 口型同步是否首要目标
    text            —— 该镜提示词正文（查头/脸运动词与环境/音乐词）
    """
    rep = AudioReport()
    rules = load_lipsync_rules(bundle)
    lo, hi = int(rules["best_lo"]), int(rules["best_hi"])
    hard = int(rules["hard_max"])

    if not dialogue:
        rep.ok.append("无对白轨——跳过口型类检查")
    else:
        if duration <= 0:
            rep.warnings.append("对白未声明时长——建议标注秒数（口型区间判据需要）")
        elif duration < lo:
            rep.warnings.append(f"对白 {duration}s 短于最佳区间下限 {lo}s——口型准确率最佳区间 {lo}–{hi}s")
        elif duration <= hi:
            rep.ok.append(f"对白 {duration}s 落在最佳区间 {lo}–{hi}s")
        elif duration <= hard:
            rep.warnings.append(f"对白 {duration}s 超过 {hi}s——口型准确率开始劣化（>{hi}s 劣化，{hard}s 技术上限）")
        else:
            rep.errors.append(f"对白 {duration}s 超过技术上限 {hard}s——不要用 {hard}s 片段做口型同步（audio/04）")

    body = text or dialogue
    if lip_sync_priority and body:
        hits = [w for w in rules["motion_words"] if w.lower() in body.lower()]
        if hits:
            rep.errors.append(f"口型优先但正文含头/脸运动词：{'、'.join(hits)}——会与口型引擎争抢导致失同步（audio/04）")
        else:
            rep.ok.append("口型优先：正文无头/脸运动词")
        music = [w for w in ("BGM", "配乐", "背景音乐", "音乐", "插曲") if w in body]
        if music:
            rep.warnings.append(f"口型优先时正文含音乐词（{'、'.join(music)}）——会招来生成式音频覆盖对白，建议 NO BGM")
    return rep
