#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wfkit —— 影视剧作工坊链路的可执行实现。

模块映射：
  assets      → 包内资产解析（04 风格基准 / 06 景别 / 13 负面词）
  axis        → 01 四轴判定与 L1–L4 触发
  frame       → 04 单帧图组装（①–⑦ + 负面，不带声音层）
  delivery    → 12 三模式拼装 + 声音层档位
  compliance  → 13 合规判据 G/T/F/L
"""
from .assets import Bundle, Benchmark, ShotSize, AudioTracks, load  # noqa: F401
from .axis import FourAxis, TriggerPlan, default_chain              # noqa: F401
from .frame import (Appearance, FrameSpec, KeyframePair,            # noqa: F401
                    build_frame, build_keyframes, style_base, style_negative)

__version__ = "1.0.0"
__all__ = [
    "Bundle", "Benchmark", "ShotSize", "AudioTracks", "load",
    "FourAxis", "TriggerPlan", "default_chain",
    "Appearance", "FrameSpec", "KeyframePair", "build_frame", "build_keyframes",
    "style_base", "style_negative",
]
