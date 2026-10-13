#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""模块 12 · 三模式交付拼装 + 声音层档位。

依据：12 SKILL.md「按模式的拼装顺序」+ platform/03 + prompt/32

硬规则：
  · 音频段位次：镜头语言之后、风格/画质/约束之前（官方块顺序 AUDIO 在 STYLE 前，锁殿后）
  · 声音层档位：full（⑧⑨⑩全量，默认）/ no-bgm（⑩写 `NO BGM`，非省略）
  · 去配乐档零音乐 token（唯一例外是 `NO BGM` 本身）
  · 文生视频九层写全；首帧只写变化；首尾帧只写中段
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from .assets import AudioTracks

# ---------------------------------------------------------------- 模式

MODE_T2V = "t2v"
MODE_FIRST = "first_frame"
MODE_LAST = "last_frame"

MODE_LABELS = {
    MODE_T2V: "文生视频 T2V",
    MODE_FIRST: "首帧",
    MODE_LAST: "首尾帧",
}

# 各模式写哪几层（12 SKILL.md 拼装顺序）
MODE_LAYERS = {
    MODE_T2V:    ["aspect", "shot", "appearance", "action", "scene", "lighting",
                  "camera", "audio", "style", "quality", "negative"],
    MODE_FIRST:  ["aspect", "ref_first", "change", "camera", "audio", "constraint"],
    MODE_LAST:   ["aspect", "ref_pair", "transition", "camera", "audio", "constraint"],
}

# 音乐类 token（去配乐档必须零残留，唯一例外是 NO BGM 本身）
MUSIC_TOKENS = ["配乐", "BGM", "背景音乐", "插曲", "音乐", "原声带", "器乐", "铺底音轨", "环境音乐垫"]


# ---------------------------------------------------------------- 音频校验

def check_audio(tracks: AudioTracks) -> List[str]:
    """声音三轨与档位校验。返回问题列表。"""
    problems: List[str] = []

    if not tracks.ambient_required:
        problems.append("G7 违反：⑨背景音轨为空——该轨任何档位都不能为空")

    if tracks.profile == AudioTracks.PROFILE_NO_BGM:
        blob = f"{tracks.dialogue} {tracks.ambient}"
        # NO BGM 是规格句本身，不算残留
        hits = [t for t in MUSIC_TOKENS if t in blob and t != "BGM"]
        if "BGM" in blob and "NO BGM" not in blob:
            hits.append("BGM")
        if hits:
            problems.append(f"G9 违反：去配乐档残留音乐 token {hits}——会招来生成式配乐，破坏后期配乐前提")
    return problems


# 句末收尾符——遇到这些就不再补句号（引号已经收句了）
_CLOSERS = ("」", "』", "\"", "’", "）")


def join_sentences(parts: List[str]) -> str:
    """句号连接：不重复加句号，右引号收尾时不补。"""
    out: List[str] = []
    for p in parts:
        p = (p or "").strip()
        if not p:
            continue
        out.append(p[:-1] if p.endswith("。") else p)
    if not out:
        return ""
    s = ""
    for i, p in enumerate(out):
        s += p
        if i < len(out) - 1 and not p.endswith(_CLOSERS):
            s += "。"
    if not out[-1].endswith(_CLOSERS):
        s += "。"
    return s


def audio_segment(tracks: AudioTracks) -> str:
    """把三轨连缀成音频段（位于镜头语言之后、风格之前）。"""
    seg: List[str] = []
    if tracks.profile == AudioTracks.PROFILE_NO_BGM:
        if tracks.dialogue.strip():
            seg.append(tracks.dialogue.strip())
        if tracks.ambient.strip():
            seg.append(f"环境音：{tracks.ambient.strip()}")
        seg.append("NO BGM")
        return join_sentences(seg)
    if tracks.dialogue.strip():
        seg.append(tracks.dialogue.strip())
    if tracks.ambient.strip():
        seg.append(f"环境音：{tracks.ambient.strip()}")
    seg.append(f"BGM：{tracks.bgm.strip()}" if tracks.bgm.strip() else "NO BGM")
    return join_sentences(seg)


def is_inline_dialogue_ok(tracks: AudioTracks) -> bool:
    """内联法判定：单句对白、无音效编排、无上传音频时才可内联进动作段。"""
    has_ml = bool(re.search(r"@\d|@\s*\d", tracks.ambient))
    multi = len(re.findall(r"[。；;]", tracks.ambient)) >= 2
    return bool(tracks.dialogue.strip()) and not has_ml and not multi and not tracks.bgm.strip()


# ---------------------------------------------------------------- 交付文件

@dataclass
class Shot:
    """一个镜头（交付文件行）。"""
    id: str = ""
    duration: str = ""
    duration_basis: str = ""    # G4：API（5s/10s）或 UI（4–15s）
    render_spec: str = ""       # ①
    aspect: str = "16:9"        # ②
    quality: str = ""           # ②
    scene: str = ""             # ③
    appearance: str = ""        # ④
    action: str = ""            # ⑤
    camera: str = ""            # ⑥
    lighting: str = ""          # ⑦
    audio: AudioTracks = field(default_factory=AudioTracks)
    negative: List[str] = field(default_factory=list)
    per_second: List[str] = field(default_factory=list)   # 逐秒精细化说明
    ref_first: str = ""
    ref_pair: str = ""
    change: str = ""
    transition: str = ""
    constraint: str = ""
    mode: str = MODE_T2V


def assemble(shot: Shot, mode: str, tracks: Optional[AudioTracks] = None) -> str:
    """按模式拼装一条提示词。"""
    a = tracks or shot.audio
    a.profile = a.profile or AudioTracks.PROFILE_FULL
    pieces: List[str] = []

    if mode == MODE_T2V:
        head = " ".join(x for x in [shot.aspect, shot.camera.split("，")[0] if shot.camera else ""] if x.strip())
        if head:
            pieces.append(head)                                  # ②画幅 + ⑥景别 前置
        for x in (shot.appearance, shot.action, shot.scene, shot.lighting):
            if x.strip():
                pieces.append(x.strip())
        if shot.camera.strip():
            pieces.append(shot.camera.strip())                   # ⑥ 镜头（完整）
        pieces.append(audio_segment(a))                          # 音频段
        for x in (shot.render_spec, f"{shot.quality}".strip()):   # ① 风格 → ② 画质
            if x.strip():
                pieces.append(x.strip())

    elif mode == MODE_FIRST:
        pieces.append(f"以输入图作为第 1 帧。")
        if shot.change.strip():
            pieces.append(shot.change.strip())                   # 只写变化
        if shot.camera.strip():
            pieces.append(shot.camera.strip())
        pieces.append(audio_segment(a))
        if shot.constraint.strip():
            pieces.append(shot.constraint.strip())
        else:
            pieces.append("保持人物面部、发型与服装与输入图完全一致，无额外文字，无肢体畸变")

    elif mode == MODE_LAST:
        if shot.ref_pair.strip():
            pieces.append(shot.ref_pair.strip())
        else:
            pieces.append("以图1为第 1 帧，图2为最后 1 帧。")
        if shot.transition.strip():
            pieces.append(shot.transition.strip())               # 只写中段
        if shot.camera.strip():
            pieces.append(shot.camera.strip())
        pieces.append(audio_segment(a))
        if shot.constraint.strip():
            pieces.append(shot.constraint.strip())
        else:
            pieces.append("只写中段，不重复首尾帧画面；保持人物面部与服装与两端一致，无额外文字，无肢体畸变")
    else:
        raise ValueError(f"未知模式：{mode}（可用：{', '.join(MODE_LABELS)}）")

    body = join_sentences(pieces)
    if shot.negative:
        body += "避免：" + "、".join(shot.negative) + "。"
    return body


def assemble_delivery_file(shot: Shot, mode: str, tracks: Optional[AudioTracks] = None,
                           layout: str = "a") -> str:
    """交付文件行结构。

    layout="a"（A 版）：**每镜头一组完整十要素**，标签逐镜重复
    layout="b"（B 版）：**十要素标签只在开头出现一次**，此处每镜只按顺序填值
                        （要素顺序定义由批量器写在文件头）
    """
    a = tracks or shot.audio
    profile_label = "全量（对白 + 背景音 + BGM）" if a.profile != AudioTracks.PROFILE_NO_BGM \
        else "去配乐（对白 + 背景音；BGM 显式抑制）"

    values = [
        shot.render_spec,                                    # ①
        f"{shot.aspect}，{shot.quality}".strip("，"),          # ②
        shot.scene,                                          # ③
        shot.appearance,                                     # ④
        shot.action,                                         # ⑤
        shot.camera,                                         # ⑥
        shot.lighting,                                       # ⑦
        a.dialogue.strip() or "无对白",                        # ⑧
        a.ambient.strip() or "无环境音",                       # ⑨
        ("NO BGM" if a.profile == AudioTracks.PROFILE_NO_BGM
         else (a.bgm.strip() or "NO BGM")),                   # ⑩
    ]

    if layout == "b":
        # B 版：① ② ④ 是全片恒定要素，已在文件头声明一次；此处只写逐镜变量。
        # 头行带【画幅】是**元信息**（让每个镜块自足地知道成片画幅），不是重复 ② 要素。
        L = [f"【{shot.id}】{shot.duration} 秒　{mode_label(mode)}"
             f"　【画幅】{shot.aspect}"
             f"　【时长口径】{shot.duration_basis or 'API（5s / 10s）'}"
             f"　声音层：{profile_label}"]
        L += [
            f"③ 环境场景：{values[2]}",
            f"⑤ 人物动作：{values[4]}",
            f"⑥ 镜头运镜构图：{values[5]}",
            f"⑦ 光影色彩：{values[6]}",
            f"⑧ 对白：{values[7]}",
            f"⑨ 背景音：{values[8]}",
            f"⑩ BGM：{values[9]}",
            "",
            "## 逐秒精细化说明",
            *(shot.per_second or ["（待补）"]),
        ]
        if shot.negative:
            L += ["", "## 逐镜负面追加", "避免：" + "、".join(shot.negative) + "。"]
        return "\n".join(L)

    # A 版
    L = [
        f"【镜号】{shot.id}",
        f"【模式】{MODE_LABELS[mode]}",
        f"【时长】{shot.duration} 秒　【时长口径】{shot.duration_basis or 'API（5s / 10s）'}",
        f"【声音层】{profile_label}",
        "",
        f"① 渲染规格：{values[0]}",
        f"② 画幅画质：{values[1]}",
        f"③ 环境场景：{values[2]}",
        f"④ 人物外观状态：{values[3]}",
        f"⑤ 人物动作：{values[4]}",
        f"⑥ 镜头运镜构图：{values[5]}",
        f"⑦ 光影色彩：{values[6]}",
        f"⑧ 对白：{values[7]}",
        f"⑨ 背景音：{values[8]}",
        f"⑩ BGM：{values[9]}",
        "",
        "## 负面规避词表",
        "避免：" + "、".join(shot.negative) + "。" if shot.negative else "（无）",
        "",
        "## 逐秒精细化说明",
        *(shot.per_second or ["（待补）"]),
    ]
    return "\n".join(L)


def mode_label(mode: str) -> str:
    return MODE_LABELS.get(mode, mode)


# B 版：**全片恒定要素**——这三个跨镜头不变，只在文件头声明一次
CONST_SLOTS = ["①", "②", "④"]
CONST_SLOT_NAMES = {"①": "渲染规格", "②": "画幅画质", "④": "人物外观状态"}
# B 版：**逐镜变量要素**——每镜照常出现
PER_SHOT_SLOTS = ["③", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"]
PER_SHOT_NAMES = {"③": "环境场景", "⑤": "人物动作", "⑥": "镜头运镜构图",
                  "⑦": "光影色彩", "⑧": "对白", "⑨": "背景音", "⑩": "BGM"}


def const_block(shot: Shot, tracks: Optional[AudioTracks] = None) -> str:
    """B 版文件头：①②④ 声明一次。"""
    v = ten_elements(shot, tracks)
    return "\n".join([
        "【恒定要素 · 全片声明一次】（① ② ④ 跨镜头不变，以下各镜头不再重复）",
        f"① 渲染规格：{v[0]}",
        f"② 画幅画质：{v[1]}",
        f"④ 人物外观状态：{v[3]}",
    ])


def ten_elements(shot: Shot, tracks: Optional[AudioTracks] = None) -> list:
    """取十要素值（供 B 版与各模块复用）。"""
    a = tracks or shot.audio
    return [
        shot.render_spec,
        f"{shot.aspect}，{shot.quality}".strip("，"),
        shot.scene,
        shot.appearance,
        shot.action,
        shot.camera,
        shot.lighting,
        a.dialogue.strip() or "无对白",
        a.ambient.strip() or "无环境音",
        ("NO BGM" if a.profile == AudioTracks.PROFILE_NO_BGM else (a.bgm.strip() or "NO BGM")),
    ]


# ---------------------------------------------------------------- 音画分离检查

def check_no_audio_in_frame(text: str) -> List[str]:
    """单帧图不得含声音层。"""
    if re.search(r"(环境音|BGM|对白)\s*[:：]", text):
        return ["单帧图出现声音层字段——单帧图只取 ①–⑦，⑧⑨⑩ 属视频/交付文件层"]
    return []


def check_music_tokens(text: str, profile: str) -> List[str]:
    """去配乐档全文零音乐 token（NO BGM 本身除外）。"""
    if profile != AudioTracks.PROFILE_NO_BGM:
        return []
    # 先把规格句 NO BGM / 无 BGM 抠掉再扫
    stripped = re.sub(r"NO\s*BGM|无\s*BGM|不含配乐", "", text, flags=re.I)
    hits = [t for t in MUSIC_TOKENS if t in stripped]
    return [f"G9：去配乐档残留音乐 token {hits}"] if hits else []
