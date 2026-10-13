#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""模块 13 · 交付合规判据。

依据：13 review/14-交付规格与合规判据.md
  通用 G1–G9 · 文生视频 T1–T5 · 首帧 F1–F6 · 首尾帧 L1–L7
每条判据给 PASS / FAIL / WARN / MANUAL(人工确认)，FAIL 阻断并按判据号退回。
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence

from .assets import AudioTracks

FAIL, WARN, PASS, MANUAL = "FAIL", "WARN", "PASS", "MANUAL"

# G1 引擎名/工程术语
ENGINE_TERMS = ["Lumen", "Nanite", "Arnold", "UE5", "PBR", "SSS", "ACES",
                "85mm", "f/1.4", "3200K", "拓扑", "LOD", "虚幻引擎"]
# G3 帧数写法（注意排除「第 1 帧」这类指涉句——那是帧位，不是时长）
FRAME_NUM = re.compile(r"(\b121\b|\b241\b|(?<!第)\d+\s*帧|24\s*fps\s*帧)")


def frame_violation(text: str) -> Optional[str]:
    """找真正的帧数写法；「第 N 帧」指涉句不算。"""
    for m in re.finditer(r"\d+\s*帧", text):
        # 指涉子句整体豁免：以图N为第 N 帧 / 图2为最后 N 帧 / 作为第 N 帧
        # （拼装器自带的「以图1为第 1 帧，图2为最后 1 帧。」两句都是帧位指涉）
        if _REF_CLAUSE.search(_clause_of(text, m.start(), m.end())):
            continue
        start = max(0, m.start() - 3)
        if "第" in text[start:m.start()]:
            continue
        return m.group(0)
    for m in re.finditer(r"\b(121|241)\b|24\s*fps\s*帧", text):
        return m.group(0)
    return None


_REF_CLAUSE = re.compile(r"为第|为最后|作为第|以输入图|以图\d")


def _clause_of(text: str, start: int, end: int) -> str:
    """取 match 所在子句（以中英标点为界）。"""
    left = max(re.finditer(r"[。；;，,\n]", text[:start]), key=lambda m: m.start(), default=None)
    right = min(re.finditer(r"[。；;，,\n]", text[end:]), key=lambda m: m.start(), default=None)
    lo = left.end() if left else 0
    hi = end + (right.start() if right else 0)
    return text[lo:hi]


# F1/L1 扫描前剥离的**包内标准样板**——这些不是对画面的复述：
#   · 音频轨标子句（环境音：… / BGM：… / 对白标签 / NO BGM）——声音轨不是画面内容
#   · 一致性约束子句（保持…一致 / 无额外文字 / 无肢体畸变 / 只写中段）——约束不是描写
#   · 首尾帧指涉子句（以输入图作为第 1 帧… / 以图1为第 1 帧，图2为最后 1 帧。）
_BOILER_CLAUSE = re.compile(
    r"^(?:环境音|背景音|BGM|声音|旁白|画外音|对白|⑧|⑨|⑩|NO\s*BGM)"
    r"|^保持.*|^无额外文字|^无肢体畸变|^只写中段"
    r"|^以.*帧$|^以图\d|^图\d为"
)


def content_text(text: str) -> str:
    """剥离标准样板子句后的正文——F1/L1 的扫描对象。"""
    out = []
    for cl in re.split(r"[。；;，,\n]", text):
        c = cl.strip()
        if not c or _BOILER_CLAUSE.match(c):
            continue
        out.append(c)
    return "，".join(out)
# G5 负面词违规语法
NEG_SYNTAX = re.compile(r"(negative\s*[:：]|不要\s*[:：]|禁用\s*[:：])")
ASPECTS = ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"]
# F3 静态名词短语粗判（有场景/外貌描写即视为复述）
SCENE_CUES = ["背景", "环境", "场景", "房间", "街道", "殿", "窗", "墙", "桌", "床"]
LOOK_CUES = ["皮肤", "发", "服装", "身", "脸", "眼", "唇", "体态"]
MOTION_CUES = ["抬", "转", "走", "推", "拉", "移动", "变化", "起伏", "闪烁",
               "飘", "落", "进入", "离开", "呼吸", "眨", "点头", "摇头"]
# 运镜具名（F4）
CAMERA_NAMES = ["Dolly", "Crane", "Orbit", "Zoom", "Follow", "Static", "Pan", "Tilt",
                "Handheld", "Steadicam", "推镜", "拉镜", "摇镜", "移镜", "跟拍",
                "环绕", "升降", "固定", "手持", "斯坦尼康", "俯仰", "横移",
                "Camera Dolly In", "Camera Dolly Out", "lock off", "locked-off",
                "静止", "缓慢推近", "缓慢拉远"]


# G2 长度上限——**按体制与平台分**
# 依据 12 prompt/12 §「两种体制，不是矛盾」：
#   短句单镜头用 MCSLA 公式与字数区间；多镜头、重参考、高控制的生产工作用**块状脚手架**
#   —— 那里**结构取代字数上限**（prompt/13 HARD RULE 8 的豁免条款）。
REGIME_LIMITS = {
    # 体制       平台          上限(字符)   出处
    # ⚠️ **平台硬顶优先于体制**：即梦「越过 800 字连提交都不成立」→ 块状脚手架也压到 800；
    #    影院工作室 512 同理。只有 Seedance 走块状脚手架时才放宽到 1800（prompt/14 中文硬上限）。
    "short": {"jimeng": 800, "seedance": 2000, "cinema": 512, "_": 800},
    "block": {"jimeng": 800, "seedance": 1800, "cinema": 512, "_": 1800},
}
REGIME_DESC = {
    "short": "短句单镜头体制（MCSLA）——字数有上限",
    "block": "块状脚手架体制（多镜头生产）——**结构取代字数上限**，只受平台硬顶",
}


def length_limit(regime: str = "short", platform: str = "") -> Tuple[int, str]:
    """返回 (字符上限, 依据说明)。"""
    reg = REGIME_LIMITS.get(regime, REGIME_LIMITS["short"])
    plat = (platform or "").strip().lower()
    key = "jimeng" if ("即梦" in plat or "jimeng" in plat) else \
          "seedance" if "seedance" in plat else \
          "cinema" if ("影院" in plat or "cinema" in plat) else "_"
    lim = reg[key]
    src = {
        "short": "12 platform/03（即梦 ≤800 字）/ prompt/20（Seedance ≤2000 字符）/ platform/01（影院工作室 512）",
        "block": "12 prompt/12「块状脚手架——结构取代字数上限」+ prompt/14（中文 1800 字符硬上限）",
    }[regime if regime in REGIME_DESC else "short"]
    return lim, src


@dataclass
class Finding:
    code: str
    level: str
    msg: str
    route_to: str = ""

    def __str__(self) -> str:
        r = f"  退→{self.route_to}" if self.route_to and self.level != PASS else ""
        return f"[{self.level:6}] {self.code}  {self.msg}{r}"


# 交付文件的字段标签行——G2 量长度、G9 扫音乐 token 时都要先剔除
_LABEL_PREFIXES = ("【", "① ", "② ", "③ ", "④ ", "⑤ ", "⑥ ", "⑦ ",
                   "⑧ ", "⑨ ", "⑩ ", "## ", "> ")


def prompt_body(text: str) -> str:
    """从交付文件里剥出**提示词正文**（去掉字段标签与说明行）。

    G2（≤800 字）与 G9（零音乐 token）量的都是**正文**：
      · 【声音层】去配乐（…）里的「配乐」是标签，不是正文里的音乐 token
      · ⑩ BGM：NO BGM。里的「BGM」是槽号标签，不是残留
    """
    out: List[str] = []
    for ln in text.split("\n"):
        s = ln.rstrip()
        if not s.strip():
            continue
        if s.lstrip().startswith(_LABEL_PREFIXES):
            # 保留槽位行的**值**（标签去掉），其余整行丢弃
            m = re.match(r"^[①-⑩]\s*[^：:]*[：:]\s*(.*)$", s.lstrip())
            if m and m.group(1).strip():
                out.append(m.group(1).strip())
            continue
        out.append(s.strip())
    return "\n".join(out)


@dataclass
class Report:
    mode: str
    findings: List[Finding] = field(default_factory=list)

    def add(self, code: str, level: str, msg: str, route_to: str = ""):
        self.findings.append(Finding(code, level, msg, route_to))
        return self

    @property
    def failed(self) -> List[Finding]:
        return [f for f in self.findings if f.level == FAIL]

    @property
    def warned(self) -> List[Finding]:
        return [f for f in self.findings if f.level == WARN]

    @property
    def manual(self) -> List[Finding]:
        return [f for f in self.findings if f.level == MANUAL]

    @property
    def passed(self) -> bool:
        return not self.failed

    def summary(self) -> str:
        L = [f"模式：{self.mode}",
             f"结论：{'PASS · 放行' if self.passed else 'FAIL · 阻断放行（' + str(len(self.failed)) + ' 项）'}"]
        for f in self.findings:
            L.append(str(f))
        if self.manual:
            L.append(f"⚠ 需人工确认 {len(self.manual)} 项")
        return "\n".join(L)


# ---------------------------------------------------------------- 通用

def _g(text: str, header: str, mode: str, tracks: Optional[AudioTracks],
       anchors: Sequence[str] = (), regime: str = "short",
       platform: str = "") -> Report:
    r = Report(mode)
    body = prompt_body(text)          # 正文：G2 量长度、G9 扫 token 都只用它

    # G1（扫全文：渲染规格里的引擎名藏在正文，标签里不会有）
    hits = [t for t in ENGINE_TERMS if t.lower() in text.lower()]
    if hits:
        r.add("G1", FAIL, f"含引擎名/工程术语：{hits}", "12")
    else:
        r.add("G1", PASS, "无引擎名与工程术语")

    # G2（量正文；上限按体制与平台分）
    lim, src = length_limit(regime, platform)
    n = len(body)
    if n > lim:
        r.add("G2", FAIL, f"提示词正文 {n} 字符 > {lim}（{REGIME_DESC.get(regime, regime)}）", "12")
    elif regime == "short" and 300 <= n <= lim and not (380 <= n <= 420):
        r.add("G2", WARN, f"正文 {n} 字符（{lim} 以内，远离 400 更稳）")
    else:
        r.add("G2", PASS, f"正文 {n} 字符（上限 {lim} · {REGIME_DESC.get(regime, regime)}）")

    # G3（「第 N 帧」指涉句不算帧数）
    fv = frame_violation(text)
    if fv:
        r.add("G3", FAIL, f"出现帧数写法「{fv}」——时长须按秒写", "12")
    else:
        r.add("G3", PASS, "时长按秒写，无帧数")

    # G4
    if re.search(r"API|UI|5s|10s|4[-–]15", header):
        r.add("G4", PASS, "已声明走 API 或 UI")
    else:
        r.add("G4", FAIL, "文件头未声明走 API（5s/10s）还是 UI（4–15s）", "12")

    # G5
    if NEG_SYNTAX.search(text):
        r.add("G5", FAIL, "负面词用了 negative:/不要: 语法——须为正向约束语句", "12")
    elif re.search(r"(避免|禁止|无|不含)", text):
        r.add("G5", PASS, "负面规避词为正向约束语句")
    else:
        r.add("G5", FAIL, "缺失负面规避词", "12")

    # G6
    if mode and mode in text:
        r.add("G6", PASS, "模式已声明")
    else:
        r.add("G6", WARN, "正文未见模式声明（以文件头【模式】为准）")

    # G8 / G7 / G9
    if tracks is None:
        r.add("G8", FAIL, "未提供声音层档位——无法判定 G7/G9", "09")
    else:
        r.add("G8", PASS, f"声音层档位：{tracks.profile}")
        if not tracks.ambient_required:
            r.add("G7", FAIL, "⑨背景音轨为空", "09")
        elif tracks.profile == AudioTracks.PROFILE_NO_BGM:
            if re.search(r"NO\s*BGM", text, re.I):
                r.add("G7", PASS, "去配乐档：⑩ 为 NO BGM")
            else:
                r.add("G7", FAIL, "去配乐档但未见 NO BGM 规格句——省略 ≠ 抑制", "09")
            stripped = re.sub(r"NO\s*BGM|无\s*BGM", "", body, flags=re.I)
            mus = [t for t in ("配乐", "BGM", "背景音乐", "插曲", "音乐") if t in stripped]
            if mus:
                r.add("G9", FAIL, f"去配乐档正文残留音乐 token：{mus}", "09")
            else:
                r.add("G9", PASS, "去配乐档正文零音乐 token")
        else:
            ok = bool(tracks.dialogue.strip() or "无对白" in text) and bool(tracks.bgm.strip() or "NO BGM" in text)
            r.add("G7", PASS if ok else FAIL,
                  "全量档三轨齐备" if ok else "全量档缺对白或 BGM 轨", "09")

    # G10 —— **即梦专用**：负面词不得单独成段（13 review/15 §四 的「三法」）
    if "即梦" in (platform or "") or "jimeng" in (platform or "").lower():
        standalone = re.findall(r"(?:^|\n)\s*(?:避免|负面(?:提示词|规避词表)?|Negative)\s*[:：]", text)
        if standalone:
            r.add("G10", FAIL,
                  f"即梦平台负面词**单独成段**（{len(standalone)} 处）——即梦没有独立负面词输入框，"
                  f"须按三法融入：正向融合（首选）/ 句内否定（≤2 处）/ 转自查清单（兜底）", "12")
        else:
            neg_phrases = len(re.findall(r"(无|不要|非|不含)[^，。；]{0,12}", body))
            if neg_phrases > 2:
                r.add("G10", FAIL,
                      f"即梦平台句内否定 {neg_phrases} 处 > 2——多了互相打架", "12")
            else:
                r.add("G10", PASS, f"即梦负面词已融入正文（句内否定 {neg_phrases} 处 ≤2）")

    # 锚定段逐字（T3/T4/L4 共用）
    for i, a in enumerate(anchors):
        if a and a not in text:
            r.add(f"ANCHOR{i + 1}", FAIL, "锚定段未逐字出现——措辞漂移即观感漂移", "04/05")
    return r


# ---------------------------------------------------------------- T2V

def check_t2v(text: str, header: str = "", tracks: Optional[AudioTracks] = None,
              anchors: Sequence[str] = (), regime: str = "short",
              platform: str = "") -> Report:
    r = _g(text, header, "文生视频 T2V", tracks, anchors, regime, platform)

    # T1 八要素
    # ① A 版工程件（每镜自带 ①–⑩ 槽）→ **判槽位在不在、空不空**
    # ② B 版工程件（标签只在开头一次）→ **判镜头头行下是否恰好 10 行值**
    # ③ 自由连缀提示词（无槽）→ 退回关键词启发式
    SLOTS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"]
    NAMES = {"①": "渲染规格", "②": "画幅画质", "③": "环境场景", "④": "人物外观状态",
             "⑤": "人物动作", "⑥": "镜头运镜构图", "⑦": "光影色彩",
             "⑧": "对白", "⑨": "背景音", "⑩": "BGM"}
    slot_vals = {}
    for ln in text.split("\n"):
        m = re.match(r"^\s*([①②③④⑤⑥⑦⑧⑨⑩])\s*[^：:]*[：:]\s*(.*)$", ln)
        if m:
            slot_vals.setdefault(m.group(1), m.group(2).strip())

    lines = [l.rstrip() for l in text.split("\n")]
    b_head = next((i for i, l in enumerate(lines)
                   if re.match(r"^\s*【[^】]+】[^】]*\d+(?:\.\d+)?\s*秒", l)), None)

    if len(slot_vals) >= 8:
        # A 版
        empty = [NAMES[k] for k in SLOTS if k in slot_vals and not slot_vals[k]]
        missing = [NAMES[k] for k in SLOTS if k not in slot_vals]
        if missing or empty:
            r.add("T1", FAIL,
                  f"十要素不齐——缺槽 {missing or '无'}／空槽 {empty or '无'}"
                  f"（每个镜头都必须有完整十要素）", "12")
        else:
            r.add("T1", PASS, "十要素齐备（A 版：①–⑩ 全有值，7 视觉 + 声音三轨）")
    elif b_head is not None or (4 <= len(slot_vals) <= 7):
        # B 版：①②④ 已在文件头声明一次，此处应恰好是逐镜变量 ③⑤⑥⑦⑧⑨⑩ 七槽
        B_SLOTS = ["③", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"]
        B_NAMES = {"③": "环境场景", "⑤": "人物动作", "⑥": "镜头运镜构图",
                   "⑦": "光影色彩", "⑧": "对白", "⑨": "背景音", "⑩": "BGM"}
        empty_b = [B_NAMES[k] for k in B_SLOTS if k in slot_vals and not slot_vals[k]]
        missing_b = [B_NAMES[k] for k in B_SLOTS if k not in slot_vals]
        leaked = [k for k in ("①", "②", "④") if k in slot_vals]
        if missing_b or empty_b or leaked:
            r.add("T1", FAIL,
                  f"B 版要素不齐——缺槽 {missing_b or '无'}／空槽 {empty_b or '无'}"
                  f"／本不该在镜内重复的 {leaked or '无'}"
                  f"（①②④ 属全片恒定，只在文件头声明一次）", "12")
        else:
            r.add("T1", PASS,
                  "十要素齐备（B 版：文件头 ①②④ 恒定声明 + 本镜 ③⑤⑥⑦⑧⑨⑩ 七槽）")
    else:
        # 自由连缀提示词：**声音层是织进段落的，不能靠"对白/环境音/BGM"这几个字找**。
        # 改为按三轨各自的**内容特征**判，≥2 轨可辨即算声音层在。
        DLG = ["「", "」", "“", "”", "说", "道：", "喊", "低语", "气声", "无对白", "无人说话", "无台词"]
        SFX = ["轻响", "响声", "摩擦", "窸窣", "声垫", "响一声", "噼啪", "沙沙", "回荡", "呼吸声"]
        BGM = ["弦乐", "配乐", "音乐", "BGM", "管乐", "钢琴", "鼓点", "铺开", "单音"]
        tracks_seen = sum(1 for g in (DLG, SFX, BGM) if any(c in text for c in g))
        need = {
            "渲染规格": ["电影质感", "UE5", "3D", "写实", "国漫", "风格"],
            "画幅画质": ASPECTS + ["8K", "4K", "超高清"],
            "环境场景": SCENE_CUES,
            "人物外观状态": LOOK_CUES,
            "人物动作": MOTION_CUES,
            "镜头运镜构图": CAMERA_NAMES,
            "光影色彩": ["光", "影", "色", "调"],
        }
        miss = [k for k, cues in need.items() if not any(c in text for c in cues)]
        if tracks_seen < 2:
            miss.append(f"声音层（只辨出 {tracks_seen}/3 轨：对白/音效/BGM）")
        if miss:
            r.add("T1", FAIL, f"八要素缺失：{miss}", "12")
        else:
            r.add("T1", PASS, f"八要素齐备（声音层辨出 {tracks_seen}/3 轨，已织入段落）")

    # T2 画幅
    found = [x for x in ASPECTS if x in text]
    if found:
        r.add("T2", PASS, f"画幅已指定：{found[0]}")
    else:
        r.add("T2", FAIL, "未指定画幅——T2V 是唯一能指定画幅的模式", "12")

    # T5 风格前缀只声明一次
    for cue in ("电影质感", "国漫", "超写实", "次世代"):
        if text.count(cue) > 1:
            r.add("T5", FAIL, f"风格前缀「{cue}」出现 {text.count(cue)} 次——只声明一次", "12")
    return r


# ---------------------------------------------------------------- 首帧

def check_first(text: str, header: str = "", tracks: Optional[AudioTracks] = None,
                anchors: Sequence[str] = (), input_aspect: str = "",
                target_aspect: str = "", regime: str = "short",
                platform: str = "") -> Report:
    r = _g(text, header, "首帧", tracks, anchors, regime, platform)

    # F1 未复述输入图（最高优先级）——扫描对象为剥离标准样板后的正文
    _scan = content_text(text)
    scene_hit = [c for c in SCENE_CUES if c in _scan]
    look_hit = [c for c in LOOK_CUES if c in _scan]
    if scene_hit or look_hit:
        r.add("F1", FAIL,
              f"复述了输入图中已有的内容（环境{scene_hit} / 外貌{look_hit}）——本模式最高优先级硬项",
              "12")
    else:
        r.add("F1", PASS, "未复述环境与静态外貌")

    # F2 指涉句
    if re.search(r"(以.*作为第\s*1\s*帧|以输入图为第\s*1\s*帧|作为第 ?1 ?帧|以图.*为第 ?1 ?帧)", text):
        r.add("F2", PASS, "有明确的首帧指涉句")
    else:
        r.add("F2", FAIL, "缺首帧指涉句——模型不知从哪起", "12")

    # F3 只写会动/会变
    motion = sum(text.count(c) for c in MOTION_CUES)
    static = len(scene_hit) + len(look_hit)
    if motion == 0:
        r.add("F3", FAIL, "无任何会动/会变的内容", "12")
    elif static > motion:
        r.add("F3", FAIL, f"静态名词短语偏多（动 {motion} / 静 {static}）", "12")
    else:
        r.add("F3", PASS, f"以动态描述为主（动 {motion} / 静 {static}）")

    # F4 运镜点名
    cam = [c for c in CAMERA_NAMES if c in text]
    if cam:
        r.add("F4", PASS, f"运镜已点名：{cam[0]}")
    else:
        r.add("F4", FAIL, "运镜未点名——这是「图生视频几乎不动」的头号成因", "08")

    # F5 画幅匹配
    if input_aspect and target_aspect:
        if input_aspect == target_aspect:
            r.add("F5", PASS, f"输入图画幅（{input_aspect}）= 目标成片画幅")
        else:
            r.add("F5", FAIL, f"输入图 {input_aspect} ≠ 目标 {target_aspect}——aspect_ratio 不生效", "04")
    else:
        r.add("F5", MANUAL, "请人工确认：输入图画幅 = 目标成片画幅（图生视频按输入图匹配）")

    # F6 图片合规（需元数据）
    r.add("F6", MANUAL, "请人工确认图片合规：JPEG/PNG、≤4.7MB、≤4096×4096、最短边≥320、长短边比≤3")
    return r


# ---------------------------------------------------------------- 首尾帧

def check_last(text: str, header: str = "", tracks: Optional[AudioTracks] = None,
               anchors: Sequence[str] = (), first_frame_prompt: str = "",
               last_frame_prompt: str = "", first_aspect: str = "", last_aspect: str = "",
               keyframe_pair_problems: Optional[List[str]] = None,
               regime: str = "short", platform: str = "") -> Report:
    r = _g(text, header, "首尾帧", tracks, anchors, regime, platform)

    # L1 只写中段——扫描对象为剥离标准样板后的正文
    _scan = content_text(text)
    scene_hit = [c for c in SCENE_CUES if c in _scan]
    look_hit = [c for c in LOOK_CUES if c in _scan]
    if scene_hit or look_hit:
        r.add("L1", FAIL, f"复述了首帧或尾帧内容（环境{scene_hit} / 外貌{look_hit}）", "12")
    else:
        r.add("L1", PASS, "只写中段")

    # L2 两图提示词已附
    if first_frame_prompt and last_frame_prompt:
        r.add("L2", PASS, "首帧图与尾帧图提示词均已附上")
    else:
        missing = [n for n, v in (("首帧图", first_frame_prompt), ("尾帧图", last_frame_prompt)) if not v]
        r.add("L2", FAIL, f"缺 {'、'.join(missing)} 提示词——先生图，才谈得上首尾帧", "04")

    # L3 同画幅
    if first_aspect and last_aspect:
        if first_aspect == last_aspect:
            r.add("L3", PASS, f"两图同一画幅：{first_aspect}")
        else:
            r.add("L3", FAIL, f"两图画幅不一致（{first_aspect} vs {last_aspect}）——提交阶段直接失败", "04")
    else:
        r.add("L3", MANUAL, "请人工确认：两张图同一画幅比例（出图阶段就定死，此处不可补救）")

    # L4 锚定段逐字
    if anchors:
        bad = [a for a in anchors if a and a not in text]
        r.add("L4", PASS if not bad else FAIL,
              "两图锚定段逐字一致" if not bad else f"锚定段不一致：{len(bad)} 段", "04")
    else:
        r.add("L4", MANUAL, "请人工确认：两张图的角色/场景锚定段逐字一致")

    # L5 同一连续动作的起止状态
    r.add("L5", MANUAL, "请人工看图确认：两张图是同一连续动作的起止状态（逐字比对判不了）")

    # 由 KeyframePair 传入的机检结论
    for p in (keyframe_pair_problems or []):
        if "起止" in p and "人工" in p:
            continue
        r.add("L3/L4", FAIL, p, "04")

    # L6 中段可推出（WARN）
    r.add("L6", WARN, "中段描述能否从起止两端推出——需人读一遍确认逻辑必然")

    # L7
    r.add("L7", MANUAL, "请人工确认两张图的图片合规（同 F6），各查一遍")
    return r


# ---------------------------------------------------------------- 调度

ROUTER = {
    "G1": "12", "G2": "12", "G3": "12", "G4": "12", "G5": "12", "G6": "12",
    "G7": "09", "G8": "09", "G9": "09",
    "T1": "12", "T2": "12", "T3": "04/05", "T4": "04/06", "T5": "12",
    "F1": "12", "F2": "12", "F3": "12", "F4": "08", "F5": "04", "F6": "04",
    "L1": "12", "L2": "04", "L3": "04", "L4": "04", "L5": "04", "L6": "12", "L7": "04",
}


def check(mode: str, text: str, **kw) -> Report:
    """统一入口。mode ∈ {t2v, first_frame, last_frame}。"""
    key = mode.strip().lower()
    if key in ("t2v", "文生视频"):
        return check_t2v(text, **kw)
    if key in ("first_frame", "first", "首帧"):
        return check_first(text, **kw)
    if key in ("last_frame", "last", "首尾帧"):
        return check_last(text, **kw)
    raise ValueError(f"未知模式：{mode}")
