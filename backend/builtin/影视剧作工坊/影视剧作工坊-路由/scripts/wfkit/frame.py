#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""模块 04 · 单帧图组装。

规则（04 SKILL.md + characters/19）：
  · 唯一入口：单帧图触发流程；产出永远是单帧图
  · 单帧图 = ①–⑦ 七要素 + 负面约束（**不带声音层**）
  · 链内三实例：常规单帧图 / 首帧图 / 尾帧图
  · 取景由 06 景别决定，本模块不自设出图形态
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from .assets import Bundle, split_cn_list

# ---------------------------------------------------------------- ④ 九层

APPEARANCE_LAYERS = [
    ("identity",  "身份"),
    ("age",       "年龄段"),
    ("build",     "体型体态"),
    ("skin",      "皮肤质感"),
    ("face",      "面部识别点"),
    ("hair",      "发型"),
    ("headwear",  "头饰"),
    ("costume",   "服装"),
    ("marks",     "辨识标记"),
]

# 违禁抽象词（04：全具象，禁抽象形容）
BANNED_ABSTRACT = [
    "美丽", "漂亮", "帅气", "英俊", "忧郁", "气质出众", "有气质", "迷人",
    "绝美", "惊艳", "仙气", "高级感", "氛围感拉满", "美到爆",
]


@dataclass
class Appearance:
    """④ 人物外观状态的内部九层。"""
    identity: str = ""
    age: str = ""
    build: str = ""
    skin: str = ""
    face: str = ""
    hair: str = ""
    headwear: str = ""
    costume: str = ""
    marks: str = ""

    def layers(self) -> List[Tuple[str, str]]:
        return [(label, getattr(self, key).strip())
                for key, label in APPEARANCE_LAYERS if getattr(self, key).strip()]

    def render(self) -> str:
        return "，".join(v for _, v in self.layers())

    def missing_layers(self) -> List[str]:
        return [label for label, key in
                [(lbl, k) for k, lbl in APPEARANCE_LAYERS] if not getattr(self, key).strip()]

    def abstract_hits(self) -> List[str]:
        blob = self.render()
        return [w for w in BANNED_ABSTRACT if w in blob]

    def anchor(self) -> str:
        """稳定锚定段：跨帧逐字复用的部分（身份→面部→发型→服装）。"""
        keys = ("identity", "age", "build", "skin", "face", "hair", "headwear", "costume", "marks")
        return "，".join(getattr(self, k).strip() for k in keys if getattr(self, k).strip())

    @classmethod
    def from_dict(cls, d: Dict[str, str]) -> "Appearance":
        known = {k for k, _ in APPEARANCE_LAYERS}
        return cls(**{k: v for k, v in (d or {}).items() if k in known})


# ---------------------------------------------------------------- 单帧图

@dataclass
class FrameSpec:
    """一张单帧图的完整定义（①–⑦ + 负面）。"""
    render_spec: str = ""      # ① 渲染规格（风格基底）
    aspect: str = "16:9"       # ② 画幅
    quality: str = ""          # ② 画质
    scene: str = ""            # ③ 环境场景
    appearance: Appearance = field(default_factory=Appearance)   # ④
    action: str = ""           # ⑤ 人物动作（含微表情与呼吸）
    camera: str = ""           # ⑥ 镜头运镜构图
    lighting: str = ""         # ⑦ 光影色彩（六条）
    negative: List[str] = field(default_factory=list)
    shot_size: str = ""        # 景别（取自 06，非本模块自设）
    frame_role: str = "single" # single | first | last
    id: str = ""

    # ---- 负面积累 ----
    def add_negative(self, *words: str) -> "FrameSpec":
        for w in words:
            for x in split_cn_list(w) if ("，" in w or "、" in w) else [w]:
                x = x.strip()
                if x and x not in self.negative:
                    self.negative.append(x)
        return self

    def negative_line(self) -> str:
        return "避免：" + "、".join(self.negative) + "。" if self.negative else ""

    # ---- 渲染 ----
    def render(self) -> str:
        """形态：连缀成段（用户给的格式；无声音层）。"""
        parts: List[str] = []
        head = " ".join(x for x in [self.aspect, self.shot_size] if x.strip())
        if head:
            parts.append(head)
        if self.appearance.render():
            parts.append(self.appearance.render())
        for x in (self.action, self.scene, self.lighting, self.camera,
                  self.render_spec, self.quality):
            if x and x.strip():
                parts.append(x.strip())
        body = "。".join(p.rstrip("。") for p in parts) + "。"
        if self.negative:
            body += self.negative_line()
        return body

    def render_block(self) -> str:
        """形态：①–⑦ 字段化（工程交付文件）。"""
        L = [f"【镜号】{self.id or '（未编号）'}",
             f"【类型】单帧图 · {self.frame_role}",
             "",
             f"① 渲染规格：{self.render_spec}",
             f"② 画幅画质：{self.aspect}，{self.quality}",
             f"③ 环境场景：{self.scene}",
             "④ 人物外观状态："]
        for label, v in self.appearance.layers():
            L.append(f"    · {label}：{v}")
        L += [f"⑤ 人物动作：{self.action}",
              f"⑥ 镜头运镜构图：{self.shot_size}，{self.camera}",
              f"⑦ 光影色彩：{self.lighting}",
              "",
              "## 负面约束",
              "、".join(self.negative)]
        return "\n".join(L)

    # ---- 校验 ----
    def check(self) -> List[str]:
        errors: List[str] = []
        if re.search(r"(环境音|BGM|对白)\s*[:：]", self.render()):
            errors.append("单帧图里出现声音层——单帧图不带 ⑧⑨⑩")
        for w in self.appearance.abstract_hits():
            errors.append(f"④ 出现抽象形容「{w}」——须全具象")
        return errors


# ---------------------------------------------------------------- 首尾帧

@dataclass
class KeyframePair:
    """首帧图 + 尾帧图（三条硬性衔接条件）。"""
    first: FrameSpec
    last: FrameSpec

    def validate(self) -> List[str]:
        """返回问题列表；空 = 通过三条硬性衔接条件。"""
        problems: List[str] = []

        # 条件 1：同一画幅比例
        if self.first.aspect.strip() != self.last.aspect.strip():
            problems.append(
                f"条件1 违反：两图画幅不一致（{self.first.aspect} vs {self.last.aspect}）"
                "——比例不一致在视频提交阶段直接失败")

        # 条件 3：人物/场景锚定段逐字一致
        a1, a2 = self.first.appearance.anchor(), self.last.appearance.anchor()
        if a1 != a2:
            problems.append("条件3 违反：两图人物锚定段不逐字一致——两端人物会对不上")
        if self.first.scene.strip() != self.last.scene.strip():
            problems.append("条件3 违反：两图场景描述不一致")

        # 条件 2：同一连续动作的起止状态（无法机判，标为人工确认）
        if not self.first.action.strip() or not self.last.action.strip():
            problems.append("条件2 待确认：起止状态需各自写清动作，当前有一条为空")
        else:
            problems.append("条件2 人工确认：两图须为同一连续动作的起止状态（机判不了，逐条核对）")
        return problems

    def render(self) -> str:
        return "\n\n".join([
            "── 首帧图 ──\n" + self.first.render(),
            "── 尾帧图 ──\n" + self.last.render(),
        ])


# ---------------------------------------------------------------- 组装

def style_base(bundle: Bundle, code: str, mixing: Optional[str] = None) -> str:
    """① 渲染规格：取基准关键词块；mixing 形如 '+E' 表示混合。"""
    codes = [code.strip().upper()]
    if mixing:
        codes += [c.strip().upper() for c in re.findall(r"[A-Z]{1,2}", mixing)]
    outs = []
    for c in codes:
        b = bundle.benchmark(c)
        outs.append(b.keywords or f"基准{c}：{b.title}")
    return "，".join(x for x in outs if x)


def style_conflicts(bundle: Bundle, code: str, mixing: Optional[str] = None,
                    spec_costume: str = "") -> List[str]:
    """混合基准的冲突提示——**对着当前角色实际穿的服装**比。

    基准关键词块是**整块拼接**的；混合时不同基准的服装/配饰/发型词会互相打架
    （例：当前角色穿「青绿色薄纱衫」，而基准E 的关键词块带「羽毛大氅」「鎏金凤冠」）。
    真正的逐轴裁决归 03 render/14 的「Style Composition Matrix 5.0 · 兼容原则 + 冲突检测」，
    本函数只把冲突**点出来**，不替它裁决。
    """
    codes = [code.strip().upper()]
    if mixing:
        codes += [c.strip().upper() for c in re.findall(r"[A-Z]{1,2}", mixing)]
    if len(codes) < 2:
        return []

    AXES = {
        "服装": ["襦裙", "大氅", "铠甲", "西装", "礼服", "纱衫", "汉服", "战甲", "秀禾", "长裙"],
        "配饰": ["凤冠", "步摇", "耳坠", "腕表", "项链", "花冠", "披风", "铠甲"],
        "发型": ["高发髻", "披肩", "马尾", "长卷发", "束发", "垂瀑"],
    }
    warns: List[str] = []
    cost = spec_costume or ""

    for axis, words in AXES.items():
        present: Dict[str, List[str]] = {}
        for c in codes:
            kw = bundle.benchmark(c).keywords
            hit = [w for w in words if w in kw]
            if hit:
                present[c] = hit
        # 混合基准之间打架
        if len(present) >= 2:
            detail = "；".join(f"基准{c}={'/'.join(h)}" for c, h in present.items())
            warns.append(f"混合基准在【{axis}】上各有取值（{detail}）——关键词块整块拼接会打架，"
                         f"须按 03 render/14 的兼容原则逐轴裁决，只留一套")
            continue
        # 基准与当前角色实际服装打架
        for c, hit in present.items():
            if cost and not any(w in cost for w in hit):
                warns.append(
                    f"基准{c} 的关键词块带【{axis}】词「{'/'.join(hit)}」，"
                    f"但当前角色的{axis}是「{cost[:24]}…」——两者不匹配，"
                    f"须裁决：改角色造型，或从 ①渲染规格 里剔除这几个词")
    return warns


def style_negative(bundle: Bundle, code: str, mixing: Optional[str] = None) -> List[str]:
    """该风格基准（含混合）的负面词追加。"""
    codes = [code.strip().upper()]
    if mixing:
        codes += [c.strip().upper() for c in re.findall(r"[A-Z]{1,2}", mixing)]
    out: List[str] = []
    for c in codes:
        for w in bundle.benchmark(c).negatives:
            if w not in out:
                out.append(w)
    return out


def slot_negative(bundle: Bundle, slot_char: str) -> List[str]:
    """①–⑦ 某个要素的负面约束词（13 review/16）。"""
    for k, v in bundle.negative_by_slot().items():
        if k.startswith(slot_char):
            return v
    return []


def build_frame(bundle: Bundle, spec: dict) -> FrameSpec:
    """从 dict 构建 FrameSpec，并自动补齐风格负面词与画质默认。"""
    role = spec.get("frame_role", "single")
    ap = spec.get("appearance", {})
    if not isinstance(ap, dict):
        raise ValueError("frame.appearance 须为九层 dict（identity/age/build/skin/face/hair/headwear/costume/marks），"
                         "整段文本请并入 action 或 scene")
    neg = spec.get("negative", [])
    if not isinstance(neg, list):
        raise ValueError("frame.negative 须为字符串列表")
    f = FrameSpec(
        render_spec=spec.get("render_spec", ""),
        aspect=spec.get("aspect", "16:9"),
        quality=spec.get("quality", "8K超高清，细节丰富，纹理清晰，画面流畅"),
        scene=spec.get("scene", ""),
        appearance=Appearance.from_dict(ap),
        action=spec.get("action", ""),
        camera=spec.get("camera", ""),
        lighting=spec.get("lighting", ""),
        shot_size=spec.get("shot_size", ""),
        frame_role=role,
        id=spec.get("id", ""),
    )
    code = spec.get("style")
    if code:
        f.render_spec = f.render_spec or style_base(bundle, code, spec.get("style_mix"))
        f.add_negative(*style_negative(bundle, code, spec.get("style_mix")))
    if spec.get("use_global_negative", True):
        for ch in "①②③④⑤⑥⑦":
            f.add_negative(*slot_negative(bundle, ch))
    for w in spec.get("negative", []):
        f.add_negative(w)
    return f


def build_keyframes(bundle: Bundle, spec: dict) -> KeyframePair:
    """从 dict 构建首尾帧对（共用锚定段，只有动作/姿态不同）。"""
    base = spec.get("base", {})
    ov = spec.get("overrides", {})

    def mk(role: str) -> FrameSpec:
        merged = dict(base)
        merged.update(ov.get(role, {}))
        merged["frame_role"] = role
        return build_frame(bundle, merged)

    first, last = mk("first"), mk("last")
    # 条件 3：锚定段强制逐字一致——以首帧为准覆盖尾帧
    for key in ("identity", "age", "build", "skin", "face", "hair", "headwear", "costume", "marks"):
        setattr(last.appearance, key, getattr(first.appearance, key))
    return KeyframePair(first=first, last=last)
