#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""模块 12 · 即梦文生图机判（platform/10-即梦生图提示词规格）。

依据（判据归属地，读不到不兜底虚构——词表为内置常量，出处见 docstring）：
  · 12 platform/10-即梦生图提示词规格.md —— 两口径（工坊整段版 / 堆叠式炫技版）
    + 硬约束（≤800 字 / 禁词内比例参数 / 负面词不单独成段）
  · 04 references/jimeng-seedream-adaptation.md §1 —— 整段版纪律（质量乞讨词禁止、
    比例界面选、锚定段段首）
  · 12 platform/09-即梦交付拼装规格.md §三 —— 负面词三法（句内否定 ≤2）

判据族 J（即梦生图，独立于 13 的 G/T/F/L 视频族）：
  J1  长度 >800 字                       两口径均 FAIL（平台硬顶）
  J2  词内比例参数（9:16 / --ar / 16:9）  两口径均 FAIL（比例界面选）
  J3  负面词单独成段                     两口径均 FAIL（三法融入）
  J4  句内否定 >2 处                     两口径均 WARN（多了互相打架）
  J5  质量乞讨词                         整段版 FAIL / 堆叠式 WARN
  J6  引擎名残留（虚幻引擎/UE5/Lumen…）  两口径均 WARN（风格联想词无害，交付口径须转画面词）
  J7  抽象形容词（炫酷/唯美/高级感…）    整段版 WARN / 堆叠式 INFO
  J8  锚定段未放段首（--anchor 给出时）  两口径均 FAIL（逐字比对）
  J9  景别冲突 / 景别堆叠                整段版 WARN（影视镜景别应单一）/ 堆叠式 INFO（≤3 段赌平台调和）
  J10 重复词段（同段出现 ≥2 次）          两口径均 WARN
  J11 随机声明（随机动作/随机背景/自由视角） 整段版 WARN（弃锚定）/ 堆叠式 INFO（显式声明）
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import List, Optional

HARD_LIMIT = 800          # platform/03 §3.4：即梦 ≤800 字硬上限（视频口径，生图沿用工程纪律）

# —— 平台硬事实 ——
RATIO_RE = re.compile(r"(?<![\d:])(\d{1,2}:\d{1,2})(?![\d:])|--ar\b|--aspect")
NEG_HEADING_RE = re.compile(
    r"^\s*(负面词|负面提示词|负面|negative\s*prompt|提示词（负面）|避免)[:：]", re.M)

# 句内否定启发式：显式否定词 +「非X / 无X」短语
NEG_EXPLICIT = ["不要", "不得", "不能", "禁止", "避免", "切勿", "别让", "拒绝"]
NEG_IMPLICIT_RE = re.compile(r"[^\u4e00-\u9fff]?(非|无)[\u4e00-\u9fff]{1,6}")

# —— 乞讨词（jimeng-seedream-adaptation §1.5：masterpiece/best quality 及中文等价物）——
BEGGING = ["masterpiece", "best quality", "bestQuality", "trending", "award-winning",
           "award winning", "大师杰作", "大师级别的作品", "大师级作品", "最佳质量",
           "完美品质", "高质量", "极致画质", "顶级质量", "神级", "杰作", "大师级"]
# 风格描述词白名单（adaptation §0：「电影级质感/8K超高清」这类可以留）
QUALITY_OK = ["8k", "超高清", "超清", "高清", "电影级", "电影质感", "细节丰富", "极致细节",
              "纹理清晰", "画面流畅"]

# —— 引擎名（12 交付禁词族；PBR/SSS/次表面散射属材质风格词不在其列，锚定段照用）——
ENGINE_WORDS = ["虚幻引擎", "unreal", "ue5", "ue4", "lumen", "nanite", "arnold",
                "octane", "redshift", "v-ray", "vray", "cycles", "blender", "zbrush",
                "substance"]

# —— 抽象形容词（characters/19 铁律「全具象，零抽象」；堆叠式档为社区惯例）——
ABSTRACT = ["炫酷", "帅气", "霸气", "威武", "唯美", "高级感", "氛围感", "意境", "精致",
            "绝美", "漂亮", "美丽", "气质出众", "震撼", "宿命感", "梦幻感", "张力十足",
            "压迫感", "大气", "华丽", "完美"]

# —— 景别族（06 shotlang/01 景别口径）——
SIZE_NEAR = ["大特写", "特写", "近景", "中景", "半身", "侧面特写", "面部特写"]
SIZE_FAR = ["全景", "全身", "远景", "大远景", "广角", "超广角", "中全景"]

# —— 随机声明（platform/10 §堆叠式：放弃锚定的显式声明）——
RANDOM_DECL = ["随机动作", "随机背景", "随机姿势", "随机姿态", "自由视角", "随机构图"]

SEG_SPLIT_RE = re.compile(r"[，。,．；;、\n]+")


@dataclass
class Finding:
    code: str
    level: str          # FAIL / WARN / INFO / PASS
    msg: str


@dataclass
class T2IReport:
    style_used: str = ""        # prose / stack
    style_detected: bool = True  # --style 显式给过 = False
    length: int = 0
    segments: int = 0
    findings: List[Finding] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return not any(f.level == "FAIL" for f in self.findings)

    def summary(self) -> str:
        mode = {"prose": "工坊整段版", "stack": "堆叠式炫技版"}.get(self.style_used, self.style_used)
        head = (f"口径：{mode}"
                + ("" if self.style_detected else "（--style 指定）")
                + f"　长度：{self.length} 字 / {self.segments} 段　"
                + ("结论：PASS" if self.passed else "结论：FAIL"))
        L = [head]
        for f in self.findings:
            mark = {"FAIL": "✗", "WARN": "⚠", "INFO": "·", "PASS": "✓"}.get(f.level, "·")
            L.append(f"  {mark} {f.code} {f.msg}")
        return "\n".join(L)

    def to_dict(self) -> dict:
        return {"style": self.style_used, "length": self.length,
                "segments": self.segments, "passed": self.passed,
                "findings": [vars(f) for f in self.findings]}


def detect_style(text: str) -> str:
    """堆叠式启发式：词段多（≥25）且段均长短（≤6 字）→ stack；否则 prose。"""
    segs = [s for s in SEG_SPLIT_RE.split(text) if s.strip()]
    if len(segs) >= 25 and segs and sum(len(s.strip()) for s in segs) / len(segs) <= 6:
        return "stack"
    return "prose"


def _count_negative(text: str) -> int:
    n = sum(text.count(w) for w in NEG_EXPLICIT)
    n += len(NEG_IMPLICIT_RE.findall(text))
    return n


def _dup_segments(text: str) -> List[str]:
    seen, dups = {}, []
    for s in SEG_SPLIT_RE.split(text):
        k = s.strip()
        if len(k) < 2:
            continue
        seen[k] = seen.get(k, 0) + 1
    for k, v in seen.items():
        if v >= 2:
            dups.append(f"{k}×{v}")
    return dups


def check(text: str, style: str = "auto", anchors: Optional[List[str]] = None) -> T2IReport:
    rep = T2IReport()
    rep.length = len(re.sub(r"\s", "", text))
    rep.segments = len([s for s in SEG_SPLIT_RE.split(text) if s.strip()])
    if style == "auto":
        rep.style_used = detect_style(text)
    else:
        rep.style_used, rep.style_detected = style, False
    stack = rep.style_used == "stack"
    low = text.lower()

    # J1 长度
    if rep.length > HARD_LIMIT:
        rep.findings.append(Finding("J1", "FAIL",
            f"{rep.length} 字 > {HARD_LIMIT} 字硬上限——越顶连提交都不成立（platform/03 §3.4）"))
    else:
        rep.findings.append(Finding("J1", "PASS", f"{rep.length} 字 ≤ {HARD_LIMIT}"))

    # J2 词内比例参数
    ratios = RATIO_RE.findall(text)
    if ratios:
        rep.findings.append(Finding("J2", "FAIL",
            f"词内比例参数 {ratios}——比例在界面选，词里写构图描述（「竖版构图」「横版宽幅」）"))
    else:
        rep.findings.append(Finding("J2", "PASS", "无词内比例参数"))

    # J3 负面词单独成段
    neg_heads = NEG_HEADING_RE.findall(text)
    if neg_heads:
        rep.findings.append(Finding("J3", "FAIL",
            f"负面词单独成段（{neg_heads}）——即梦无独立负面框，按三法融入正文（platform/09 §三）"))
    else:
        rep.findings.append(Finding("J3", "PASS", "无独立负面词段"))

    # J4 句内否定
    n_neg = _count_negative(text)
    if n_neg > 2:
        rep.findings.append(Finding("J4", "WARN",
            f"句内否定 {n_neg} 处 > 2——多了互相打架；优先正向融合"))
    else:
        rep.findings.append(Finding("J4", "PASS", f"句内否定 {n_neg} 处 ≤2"))

    # J5 质量乞讨词
    begs = sorted({w for w in BEGGING if w.lower() in low})
    if begs:
        rep.findings.append(Finding("J5", "WARN" if stack else "FAIL",
            f"质量乞讨词 {len(begs)} 个：{'、'.join(begs)}"
            + ("——堆叠式社区惯例可保留，工坊口径以具体风格词替代（「金属光泽」「体积雾」式）"
               if stack else
               "——整段版禁止（adaptation §1.5），以白名单风格描述词替代：8K超高清/电影级质感/细节丰富")))
    else:
        rep.findings.append(Finding("J5", "PASS", "无质量乞讨词"))

    # J6 引擎名
    engines = sorted({w for w in ENGINE_WORDS if w.lower() in low})
    if engines:
        rep.findings.append(Finding("J6", "WARN",
            f"引擎名 {engines}——作为风格联想词无害（adaptation §1.6 同「器材型号词」）；"
            "走工程交付口径时须转画面词（「虚幻引擎渲染」→「实时光追级真实感渲染」）"))
    else:
        rep.findings.append(Finding("J6", "PASS", "无引擎名"))

    # J7 抽象形容词
    abstracts = sorted({w for w in ABSTRACT if w in text})
    if abstracts:
        rep.findings.append(Finding("J7", "INFO" if stack else "WARN",
            f"抽象形容词 {len(abstracts)} 个：{'、'.join(abstracts)}"
            + ("——堆叠式档为社区惯例，信息量靠具象词承担" if stack else
               "——④人物层铁律「全具象，零抽象」；翻成肌肉词/画面词（「霸气」→「肩宽压人、下颌抬 15°」）")))
    else:
        rep.findings.append(Finding("J7", "PASS", "无抽象形容词"))

    # J8 锚定段段首（给了 --anchor 才判）
    if anchors:
        norm = re.sub(r"[\s，,]", "", text)
        for a in anchors:
            an = re.sub(r"[\s，,]", "", a)
            if an and not norm.startswith(an):
                rep.findings.append(Finding("J8", "FAIL",
                    f"锚定段未逐字放段首：「{a[:24]}…」——段首漂移即一致性漂移（adaptation §1.1）"))
                break
        else:
            rep.findings.append(Finding("J8", "PASS", "锚定段逐字在段首"))

    # J9 景别冲突 / 堆叠
    nears = [w for w in SIZE_NEAR if w in text]
    fars = [w for w in SIZE_FAR if w in text]
    if nears and fars:
        rep.findings.append(Finding("J9", "INFO" if stack else "WARN",
            f"景别共现：近族 {nears} × 远族 {fars}"
            + ("——堆叠式档视为多视角暗示，允许 ≤3 段，赌平台调和出张力构图；要可控就删到单一主景别"
               if stack else
               "——影视镜景别必须单一（06 景别表），删到该镜唯一景别")))
    else:
        rep.findings.append(Finding("J9", "PASS", "景别单一"))

    # J10 重复词段
    dups = _dup_segments(text)
    if dups:
        rep.findings.append(Finding("J10", "WARN",
            f"重复词段 {len(dups)} 个：{'、'.join(dups[:8])}——重复不增益注意力，删并"))
    else:
        rep.findings.append(Finding("J10", "PASS", "无重复词段"))

    # J11 随机声明
    rnds = [w for w in RANDOM_DECL if w in text]
    if rnds:
        rep.findings.append(Finding("J11", "INFO" if stack else "WARN",
            f"随机声明 {rnds}——显式放弃锚定：单张炫技成立，进链路/要一致性绝不用"))
    else:
        rep.findings.append(Finding("J11", "PASS", "无随机声明"))

    return rep
