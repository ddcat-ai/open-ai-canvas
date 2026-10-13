#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""模块 01 · 四轴判定与 L1–L4 触发机制。

依据：影视剧作工坊-01-触发与任务识别/spec/01-四轴判定与触发机制.md §3–§4
固定解析顺序：工作模式 → 视频模式 → 渲染引擎 → 输出模型（后轴不覆盖前轴）
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional

# ---------------------------------------------------------------- 轴值

WORK_MODES = {
    "single":   "🎯 单镜 Prompt",
    "styling":  "🎨 角色定妆",
    "fragment": "🎬 片段分镜（≤5 镜）",
    "full":     "📽️ 完整分镜（默认）",
    "batch":    "📦 全量交付",
}

VIDEO_MODES = {
    "t2v":     "文生视频 T2V（默认）",
    "i2v":     "图生视频 I2V",
    "hybrid":  "混合 Hybrid",
}

# 即梦平台侧的子模式（视频模式轴的下一层粒度）
VIDEO_SUBMODES = {
    "t2v":         "文生视频",
    "first_frame": "首帧",
    "last_frame":  "首尾帧",
}

ENGINES = {
    "ue5":    "UE5 实时（默认）",
    "arnold": "Arnold 离线光追",
}

MODELS = {
    "jimeng": "即梦（默认，v1.1.0 作者授权）",
    "doubao": "豆包",
    "h3mini": "H3 Mini（海螺）",
}

# ---------------------------------------------------------------- 简写触发词（v1.1.0 作者授权）
# 口语短名 → 交付形态落点；命中即路由，不再展开判定。表本体在 01 SKILL.md §简写触发词表。
SHORTHANDS = [
    ("工程A模式", "工程交付 A 版（每镜头一组完整十要素）→ 路由 deliver-file --layout a"),
    ("工程B模式", "工程交付 B 版（十要素标签开头出现一次）→ 路由 deliver-file --layout b"),
    ("通用模式", "通用交付（平台无关母版）→ 12 platform/12"),
    ("角色图", "04 单帧图·人物向（characters/19 十槽位）"),
    ("场景图", "04 单帧图·场景向（scenes/11）"),
    ("分镜故事板", "分镜故事板（九格黑白 9grid）→ 影视剧作工坊-故事板"),
    ("剪辑模式B", "剪辑 B 通道·实拍学派组接（隔级切/动接动/轴线视线/Murch 裁决）→ 10 editing/15/16，cuts/split --mode b（唯一组接判据，缺省即此）"),
    ("剪辑B模式", "剪辑 B 通道·实拍学派组接（「剪辑模式B」别名）→ 10 editing/15/16，cuts/split --mode b（唯一组接判据，缺省即此）"),
]

# ---------------------------------------------------------------- 触发词表
# 依据 spec §3.1–§3.4 的「触发条件 / 触发声明」列

_TRIGGERS = {
    "work_mode": [
        ("batch",    ["全部生成交付文件", "一键交付", "跑流水线", "全量交付"]),
        ("single",   ["出一张图", "写个 prompt", "写个提示词", "单镜"]),
        ("styling",  ["设计角色", "出设定图", "定妆", "建个角色", "人设"]),
        ("fragment", ["拆这段戏", "片段分镜"]),
    ],
    "video_mode": [
        ("hybrid", ["混合", "先出人物参考图"]),
        ("i2v",    ["图生视频", "参考图生视频", "首帧", "首尾帧", "以图生视频"]),
        ("t2v",    ["文生视频", "纯文本生视频", "text to video"]),
    ],
    "engine": [
        ("arnold", ["arnold", "阿诺德", "离线渲染", "物理光追", "电影cg静帧"]),
        ("ue5",    ["ue5", "虚幻", "实时渲染", "lumen"]),
    ],
    "model": [
        ("jimeng", ["即梦", "jimeng", "seedance"]),
        ("h3mini", ["h3 mini", "minimax", "海螺", "h3"]),
        ("doubao", ["豆包", "doubao", "seedream"]),
    ],
}

# 工作模式只能向前升级
_WORK_ORDER = ["single", "styling", "fragment", "full", "batch"]

# 渲染引擎互斥；输出模型三选一互斥
MUTEX = {
    "engine": {"ue5": ["arnold"], "arnold": ["ue5"]},
    "model": {"doubao": ["jimeng", "h3mini"], "jimeng": ["doubao", "h3mini"], "h3mini": ["doubao", "jimeng"]},
}


# ---------------------------------------------------------------- 四轴

@dataclass
class FourAxis:
    work_mode: str = "full"
    video_mode: str = "t2v"
    video_submode: str = "t2v"        # 即梦平台侧：t2v / first_frame / last_frame
    engine: str = "ue5"
    model: str = "jimeng"
    explicit: Dict[str, bool] = field(default_factory=dict)
    hits: Dict[str, List[str]] = field(default_factory=dict)
    declared_values: Dict[str, List[str]] = field(default_factory=dict)   # 同轴多声明检测用

    # ---- 判定 ----
    @classmethod
    def resolve(cls, text: str) -> "FourAxis":
        """从用户话语判定四轴。未声明即取默认值。"""
        low = (text or "").lower()
        ax = cls()
        ax.explicit = {k: False for k in _TRIGGERS}
        ax.hits = {k: [] for k in _TRIGGERS}

        for axis, table in _TRIGGERS.items():
            for value, words in table:
                hit = [w for w in words if w in low]
                if hit:
                    if axis == "work_mode":
                        # 显式声明优先于默认值；「只能向前升级」只在多个显式声明之间比
                        # （否则默认的 full 会吞掉 single/styling/fragment 的显式声明）
                        if not ax.explicit[axis]:
                            ax.work_mode = value
                        elif _WORK_ORDER.index(value) > _WORK_ORDER.index(ax.work_mode):
                            ax.work_mode = value
                        ax.declared_values.setdefault("work_mode", []).append(value)
                    else:
                        setattr(ax, axis, value)
                        ax.declared_values.setdefault(axis, []).append(value)
                    ax.explicit[axis] = True
                    ax.hits[axis].extend(hit)

        # 平台侧子模式：从「首帧 / 首尾帧 / 文生视频」细化
        if "首尾帧" in low:
            ax.video_submode = "last_frame"
            ax.video_mode = "i2v"
        elif "首帧" in low:
            ax.video_submode = "first_frame"
            ax.video_mode = "i2v"
        elif ax.video_mode == "t2v":
            ax.video_submode = "t2v"
        else:
            ax.video_submode = "first_frame" if ax.video_mode == "i2v" else "t2v"

        ax.check_mutex()
        return ax

    # ---- 互斥校验 ----
    def check_mutex(self) -> List[str]:
        """互斥违反检测 + 同轴双声明告警。返回问题列表（空 = 通过）。"""
        problems: List[str] = []
        if self.engine not in ENGINES:
            problems.append(f"未知渲染引擎：{self.engine}")
        if self.model not in MODELS:
            problems.append(f"未知输出模型：{self.model}")
        # 同轴双声明：词表命中了同轴的多个不同取值——静默后者覆盖，须告警
        axis_names = {"work_mode": ("工作模式", WORK_MODES), "video_mode": ("视频模式", VIDEO_MODES),
                      "engine": ("渲染引擎", ENGINES), "model": ("输出模型", MODELS)}
        declared = getattr(self, "declared_values", None) or {}
        for axis, (label, table) in axis_names.items():
            vals = declared.get(axis, [])
            if len(vals) > 1:
                names = "、".join(table.get(v, v) for v in vals)
                problems.append(f"{label}轴声明了多个值（{names}）——同轴互斥，按声明顺序后者覆盖，请只保留一个")
        return problems

    # ---- 派生 ----
    @property
    def needs_frame(self) -> bool:
        """是否需要 04 先出单帧图（首帧 / 首尾帧模式）。"""
        return self.video_submode in ("first_frame", "last_frame")

    @property
    def frame_count(self) -> int:
        return {"t2v": 0, "first_frame": 1, "last_frame": 2}.get(self.video_submode, 0)

    @property
    def is_cg_still(self) -> bool:
        """㉚ 甲骨文/文物特例：唯一允许 Arnold + UE5 受控混合。"""
        return self.engine == "arnold"

    @property
    def defaults_equivalent(self) -> bool:
        """显式声明四个默认值 ≡ 什么都不声明。"""
        return not any(self.explicit.values())

    def describe(self) -> str:
        head = " + ".join([
            WORK_MODES[self.work_mode],
            VIDEO_MODES[self.video_mode],
            ENGINES[self.engine],
            MODELS[self.model],
        ])
        if self.video_mode == "i2v":
            head += f"［{VIDEO_SUBMODES[self.video_submode]}］"
        return head

    def to_dict(self) -> dict:
        return {
            "work_mode": self.work_mode,
            "work_mode_label": WORK_MODES[self.work_mode],
            "video_mode": self.video_mode,
            "video_mode_label": VIDEO_MODES[self.video_mode],
            "video_submode": self.video_submode,
            "video_submode_label": VIDEO_SUBMODES[self.video_submode],
            "engine": self.engine,
            "engine_label": ENGINES[self.engine],
            "model": self.model,
            "model_label": MODELS[self.model],
            "needs_frame": self.needs_frame,
            "frame_count": self.frame_count,
            "explicit": dict(self.explicit),
            "hits": {k: list(v) for k, v in self.hits.items()},
            "defaults_equivalent": not any(self.explicit.values()),
        }


# ---------------------------------------------------------------- L1–L4

@dataclass
class TriggerPlan:
    """L1–L4 触发结果。"""
    axes: FourAxis
    l2_deliverables: List[str] = field(default_factory=list)
    l3_engine_conditions: List[str] = field(default_factory=list)
    l4_libraries: List[str] = field(default_factory=list)
    chain: List[str] = field(default_factory=list)

    L2_WORDS = {
        "自检文件": ["文件c", "自检", "qc"],
        "模块化子输出": ["只要", "单独出", "仅出"],
        "全量交付": ["一键交付", "全量交付", "全部生成"],
        "十秒档": ["十秒", "10秒", "十s"],
    }

    @classmethod
    def plan(cls, text: str) -> "TriggerPlan":
        ax = FourAxis.resolve(text)
        low = (text or "").lower()
        tp = cls(axes=ax)

        for name, words in cls.L2_WORDS.items():
            if any(w in low for w in words):
                tp.l2_deliverables.append(name)

        if ax.engine == "arnold":
            tp.l3_engine_conditions.append("读 ㉗ Arnold 渲染库，替代 ⑤ UE5 灯光库的人物光影部分")
        if ax.is_cg_still:
            tp.l3_engine_conditions.append("㉛㉜ 物理阈值两分支通用；仅 ㉚ 甲骨文/文物特例允许 Arnold+UE5 受控混合")
        if ax.model == "h3mini":
            tp.l3_engine_conditions.append("H3 Mini 七段编写逻辑（主体→场景→运镜景别焦距→光影风格→画幅时长→环境音→配乐）")

        tp.chain = default_chain(ax)
        low2 = low or ""
        tp.shorthands = [f"{name} → {target}" for name, target in SHORTHANDS if name in (text or "")]
        return tp

    def describe(self) -> str:
        L = [f"【L1 四轴】{self.axes.describe()}"]
        if getattr(self, "shorthands", None):
            L.append("【简写命中】")
            L += [f"        {s}" for s in self.shorthands]
        if self.axes.needs_frame:
            L.append(f"        → 需 04 先出 {self.axes.frame_count} 张单帧图（{VIDEO_SUBMODES[self.axes.video_submode]}）")
        if self.l2_deliverables:
            L.append("【L2 触发式交付】" + "、".join(self.l2_deliverables))
        for c in self.l3_engine_conditions:
            L.append("【L3 引擎条件】" + c)
        L.append("【链路】" + " → ".join(self.chain))
        return "\n".join(L)


def default_chain(ax: FourAxis) -> List[str]:
    """按四轴给出默认链路（模块号序列）。"""
    if ax.work_mode == "single":
        return ["12"]
    if ax.work_mode == "styling":
        return ["04", "12"]
    base = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13"]
    if ax.work_mode == "fragment":
        return base[:9] + ["12", "13"]
    if ax.work_mode == "batch":
        return base
    return base


def is_equivalent_to_default(text: str) -> bool:
    """显式声明四个默认 ≡ 什么都不声明。"""
    return not any(FourAxis.resolve(text).explicit.values())
