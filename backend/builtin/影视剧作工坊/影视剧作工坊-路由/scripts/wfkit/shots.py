#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""镜头划分引擎 —— 按模块 10「剪辑与镜头组接」的方法论划分镜头。

**所有规则从包内实时读出，不写死标准。**四份依据：

  1. **10 editing/01 §1.4 序列节奏预算** → 剪切数的算法与对照档位
       「按每剪切约 4–6 秒的平均值折算总时长，得到这部片子能承载的剪切数，
        并为最值钱的时刻预留一个刻意更长的主打长镜（6–8 秒）」
       「写明的剪切时长必须精确加总等于所要求的总时长」
  2. **10 editing/01 §1.3 15 秒信封与密度法则** → 每镜承载内容量（时长阶梯）
  3. **10 editing/01 §1.5 单调审计** → 相邻三镜不得同景别且同镜头运动
  4. **10 editing/02 §2.1–§2.2** → 默认单镜头 / 时长算术三处一致 / 信封归并（每 4–5 镜头行一条提示词）

节奏型（紧张 / 温馨 / 紧凑…）**不另立标准**：它去匹配 **12 prompt/20** 六套剪辑公式速查表的
「适合」列（该表本身是技能内容），决定 **§1.4 那个 4–6 秒区间里取哪个点**。
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Tuple

from .assets import Bundle, read_text

MIN_TOTAL, MAX_TOTAL = 5.0, 30.0


# ================================================================ 规则解析

@dataclass
class EditingRules:
    """从编辑/组接层读出的规则。"""
    # §1.4
    avg_lo: float = 4.0
    avg_hi: float = 6.0
    hero_lo: float = 6.0
    hero_hi: float = 8.0
    cut_table: List[Tuple[str, int]] = field(default_factory=list)   # (档位标签, 剪切数)
    # §1.3
    steps: List[Tuple[float, float, str]] = field(default_factory=list)  # (lo, hi, 承载内容)
    # §1.5
    audit_rule: str = ""
    # §2.2
    lines_per_prompt: Tuple[int, int] = (4, 5)
    merge_heuristic: str = ""
    # §2.1
    default_single: str = ""

    def table_cuts(self, total: float) -> Optional[int]:
        """§1.4 的粗略档位对照值（不是主算法，主算法是 total / avg）。"""
        best = None
        for label, cuts in self.cut_table:
            nums = re.findall(r"(\d+(?:\.\d+)?)", label)
            if not nums:
                continue
            n = float(nums[0])
            if ("≤" in label or "以下" in label) and total <= n:
                return cuts
            if ("约" in label or "以上" in label) and total <= n * 1.15:
                best = cuts
        return best

    def load_of(self, dur: float) -> str:
        """按 §1.3 的时长阶梯给出这一镜能承载什么。"""
        for lo, hi, label in self.steps:
            if lo <= dur <= hi:
                return label
        if dur < (self.steps[0][0] if self.steps else 4):
            return "插入 / 定格（纯节奏拍，不承载独立内容）"
        return "2–3 个简单节拍以上（考虑拆镜）"


def load_editing_rules(bundle: Optional[Bundle] = None) -> EditingRules:
    """从 10 editing/01 与 editing/02 读出规则。读不到才用兜底。"""
    b = bundle or Bundle()
    r = EditingRules()
    try:
        t1 = read_text(b.file("10", "editing/01-规划层-连通分镜清单.md"))
    except FileNotFoundError:
        t1 = ""
    try:
        t2 = read_text(b.file("10", "editing/02-提示词层-单条内部组接.md"))
    except FileNotFoundError:
        t2 = ""

    # §1.4 均值与主打长镜
    m = re.search(r"每剪切约\s*(\d+)\s*[–\-~]\s*(\d+)\s*秒", t1)
    if m:
        r.avg_lo, r.avg_hi = float(m.group(1)), float(m.group(2))
    m = re.search(r"主打长镜[（(]?\s*(\d+)\s*[–\-~]\s*(\d+)\s*秒", t1)
    if m:
        r.hero_lo, r.hero_hi = float(m.group(1)), float(m.group(2))

    # §1.4 档位表（兼容「约 3 个」「4–5 个」「9–11 个」三种写法）
    for ln in t1.split("\n"):
        c = re.match(r"^\|\s*([^|]+?)\s*\|\s*约?\s*(\d+)(?:\s*[–\-~]\s*(\d+))?\s*个\s*\|\s*$", ln.strip())
        if c:
            lo = int(c.group(2))
            hi = int(c.group(3)) if c.group(3) else lo
            r.cut_table.append((c.group(1).strip(), round((lo + hi) / 2)))

    # §1.3 时长阶梯
    for m in re.finditer(r"(\d+)\s*[–\-~]\s*(\d+)\s*秒\s*=\s*([^·。\n]+)", t1):
        r.steps.append((float(m.group(1)), float(m.group(2)), m.group(3).strip()))
    r.steps.sort(key=lambda x: x[0])

    # §1.5 单调审计（截到分号/句号/加粗标记）
    m = re.search(r"(不允许连续三个[^；;。\n*]+)", t1)
    if m:
        r.audit_rule = m.group(1).strip()

    # §2.2 归并启发式
    m = re.search(r"大约每\s*(\d+)\s*[-–]\s*(\d+)\s*个镜头行一条提示词", t2)
    if m:
        r.lines_per_prompt = (int(m.group(1)), int(m.group(2)))
    m = re.search(r"(把多个镜头行归并进一条提示词的起始启发式[^。\n]*)", t2)
    if m:
        r.merge_heuristic = m.group(1).strip()

    # §2.1 默认单镜头
    m = re.search(r"(\*\*默认是单镜头。\*\*[^。\n]*)", t2)
    if m:
        r.default_single = m.group(1).replace("**", "").strip()

    return r


# ================================================================ 素材档位

@dataclass
class MaterialProfile:
    """素材档位——决定 §1.4 那个均切长区间取哪一档。"""
    key: str
    label: str
    avg_lo: float
    avg_hi: float
    hero_lo: float
    hero_hi: float
    min_shot: float = 0.3
    basis: List[str] = field(default_factory=list)


def load_profiles(bundle: Optional[Bundle] = None) -> Dict[str, MaterialProfile]:
    """从包内读素材档位。**漫剧档不是我的假设，是包内两条规则**：

      · 10 editing/05「多条次微切片组装」——逐条浏览每个条次，挑出其最好的 1–3 秒
      · 12 prompt/20「AI 素材五大专属对策」④——0.3-1s 的快切遮掩 AI 微妙畸变
    """
    b = bundle or Bundle()
    r = load_editing_rules(b)

    # 从包内抓两个关键数字
    micro = (1.0, 3.0)
    fast = (0.3, 1.0)
    basis_micro = "10 editing/05 多条次微切片组装"
    basis_fast = "12 prompt/20 AI 素材专属对策④"
    try:
        t5 = read_text(b.file("10", "editing/05-剪辑与连续性词汇.md"))
        m = re.search(r"最好的\s*(\d+)\s*[–\-~]\s*(\d+)\s*秒", t5)
        if m:
            micro = (float(m.group(1)), float(m.group(2)))
        mm = re.search(r"(多条次微切片组装)(——|[-–—]{2})?([^。\n]{0,40})", t5)
        if mm:
            tail = (mm.group(3) or "").split("—")[0].strip("，,、 ")
            basis_micro = "10 editing/05「多条次微切片组装」" + (f"：{tail}" if tail else "")
    except FileNotFoundError:
        pass
    try:
        t20 = read_text(b.file("12", "prompt/20-seedance2.0-prompt-skill本体.md"))
        m = re.search(r"(\d+(?:\.\d+)?)\s*[-–~]\s*(\d+(?:\.\d+)?)\s*s\s*的快切", t20)
        if m:
            fast = (float(m.group(1)), float(m.group(2)))
            mm = re.search(r"(\*\*AI 微妙畸变用快节奏遮掩\*\*[^）)]*）?)", t20)
            if mm:
                basis_fast = "12 prompt/20：" + mm.group(1).replace("**", "").strip()
    except FileNotFoundError:
        pass

    general = MaterialProfile(
        key="general", label="通用档（§1.4 基准）",
        avg_lo=r.avg_lo, avg_hi=r.avg_hi, hero_lo=r.hero_lo, hero_hi=r.hero_hi,
        min_shot=0.3,
        basis=[f"10 editing/01 §1.4：每剪切约 {r.avg_lo:g}–{r.avg_hi:g} 秒",
               f"　主打长镜 {r.hero_lo:g}–{r.hero_hi:g} 秒"],
    )
    # 漫剧档：均切长整体下移一档到「微切片带」之上——比通用档 4–6s 紧，但不等于单条微切片
    manju_lo, manju_hi = 2.5, 4.0
    manju = MaterialProfile(
        key="manju", label="漫剧档（微切片组装）",
        avg_lo=manju_lo, avg_hi=manju_hi,
        hero_lo=r.hero_lo, hero_hi=r.hero_hi,
        min_shot=fast[0],
        basis=[basis_micro,
               f"　→ 单条微切片带 {micro[0]:g}–{micro[1]:g} 秒；**均切长整体下移一档取 "
               f"{manju_lo:g}–{manju_hi:g} 秒**（紧于通用档 {r.avg_lo:g}–{r.avg_hi:g} 秒）",
               basis_fast,
               f"　→ 短促拍下限 {fast[0]:g}s（快切遮掩畸变）",
               f"主打长镜仍按 §1.4 保留 {r.hero_lo:g}–{r.hero_hi:g} 秒（长短对比是节奏来源）"],
    )
    return {"manju": manju, "general": general}


def resolve_profile(word: str, profiles: Dict[str, MaterialProfile]) -> MaterialProfile:
    w = (word or "").strip()
    if w in profiles:
        return profiles[w]
    if any(k in w for k in ("漫剧", "动态漫", "条次", "微切片", "AI素材", "ai素材")):
        return profiles["manju"]
    if any(k in w for k in ("通用", "实拍", "影视", "真人")):
        return profiles["general"]
    raise ValueError(f"认不出素材档位「{word}」；可用：漫剧 / 通用")

@dataclass
class CutFormula:
    mark: str        # ①
    label: str       # 呼吸式
    pattern: str     # 快快快～慢……
    best_for: str    # 80% 日常视频都能用
    difficulty: str = ""


def load_formulas(bundle: Optional[Bundle] = None) -> List[CutFormula]:
    """从 12 prompt/20 的速查表读六套剪辑公式（原文，不转述）。"""
    b = bundle or Bundle()
    try:
        t = read_text(b.file("12", "prompt/20-seedance2.0-prompt-skill本体.md"))
    except FileNotFoundError:
        return []
    out: List[CutFormula] = []
    for ln in t.split("\n"):
        c = re.match(r"^\|\s*([①②③④⑤⑥])\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*$", ln)
        if c:
            out.append(CutFormula(c.group(1), c.group(2).strip(), c.group(3).strip(),
                                  c.group(4).strip(), c.group(5).strip()))
    return out


# 检索别名：把口语节奏词**路由到速查表「适合」列里已有的词**。
# ⚠️ 这不是标准——标准在 12 prompt/20 的表里；本表只负责让口语词能检索到那一行。
# 表里没有的语义，就老实报"未匹配"，让调用方改用表里的词或 --formula 直指。
SEARCH_ALIASES: Dict[str, str] = {
    "温馨": "情感故事", "温暖": "情感故事", "治愈": "情感故事", "抒情": "情感故事",
    "感动": "情感故事", "煽情": "情感故事",
    "紧凑": "快闪", "快节奏": "快闪", "混剪": "快闪", "广告": "大促", "带货": "大促",
    "大片": "高潮", "爆点": "高潮", "反转": "高潮", "揭晓": "高潮",
    "压抑": "恐怖", "惊悚": "恐怖", "高级": "奢侈品", "文艺": "先锋艺术", "艺术": "先锋艺术",
    "日常": "日常视频", "通用": "日常视频", "常规": "日常视频",
    "危机": "紧张", "追逐": "运动", "打斗": "运动", "动作": "运动",
}


def match_formula(word: str, formulas: Sequence[CutFormula]) -> Optional[CutFormula]:
    """用「适合」列匹配节奏词——映射来自技能表本身。口语词先过一遍检索别名。"""
    w = (word or "").strip()
    if not w:
        return None
    probe = SEARCH_ALIASES.get(w, w)
    # 先按公式名匹配
    for f in formulas:
        if f.label and f.label in probe:
            return f
    # 再按「适合」列匹配
    for f in formulas:
        for kw in re.split(r"[、,，/]", f.best_for):
            kw = kw.strip()
            if kw and (kw in probe or kw in w):
                return f
    return None


def available_rhythm_words(formulas: Sequence[CutFormula]) -> List[str]:
    """速查表「适合」列里的全部词——这是唯一合法的节奏词来源。"""
    out: List[str] = []
    for f in formulas:
        for kw in re.split(r"[、,，/]", f.best_for):
            kw = kw.strip()
            if kw and kw not in out:
                out.append(kw)
    return out


# 节奏型 → 在 §1.4 的 4–6 秒区间里取点（引擎参数，可用 CLI 覆盖）
# 依据是匹配到的公式「节奏图」的物理含义：短促交替取短端，递进回落取长端
RHYTHM_TUNING: Dict[str, Tuple[float, float]] = {
    #                      取点系数(0=avg_lo,1=avg_hi)   摆动幅度(±比例)
    "心跳式":   (0.10, 0.40),   # 短促与停顿交替 → 偏短端，摆幅大
    "脉冲式":   (0.00, 0.15),   # 密集快切 → 最短端，摆幅小
    "海浪式":   (1.00, 0.25),   # 递进后回落 → 最长端，摆幅中
    "呼吸式":   (0.50, 0.20),   # 通用
    "子弹时间": (0.55, 0.60),   # 中段拉长 → 摆幅很大
    "静默锤击": (0.90, 0.55),   # 长静默配极短冲击 → 偏长端，摆幅大
}
DEFAULT_TUNING = (0.50, 0.20)

# 节奏型 → 主打长镜落位（0=首 1=末）。依据各公式「节奏图」里最值钱那一拍的位置：
#   海浪式「更大浪」在第 3 拍 → 0.66；心跳式停顿在中后段 → 0.66；
#   脉冲式「轰！」在末 → 1.0；子弹时间「慢动作」在中 → 0.5
HERO_POS: Dict[str, float] = {
    "心跳式":   0.66,
    "脉冲式":   1.00,
    "海浪式":   0.66,
    "呼吸式":   1.00,
    "子弹时间": 0.50,
    "静默锤击": 0.50,
}


# ================================================================ 景别与运动（06 / 08）

def load_motions(bundle: Optional[Bundle] = None) -> List[str]:
    """从 08 moves 读镜头运动清单。"""
    b = bundle or Bundle()
    out: List[str] = []
    try:
        t = read_text(b.file("08", "moves/14-全镜头转换·镜头运动.md"))
        for w in re.findall(r"([\u4e00-\u9fff]{2,4})的定义是", t):
            if w not in out:
                out.append(w)
    except FileNotFoundError:
        pass
    if "固定" not in out:
        out.insert(0, "固定")
    return out


# ================================================================ 划分

@dataclass
class Shot:
    index: int
    duration: float
    start: float
    end: float
    size: str = ""          # 景别（06）
    move: str = ""          # 镜头运动（08）
    load: str = ""          # 承载内容（§1.3 时长阶梯）
    hero: bool = False      # 是否为刻意预留的主打长镜
    envelope: int = 0       # 归入第几条提示词信封（§2.2）

    @property
    def tc(self) -> str:
        return f"{self.start:.1f}–{self.end:.1f}s"

    def row(self) -> str:
        tag = " ★主打长镜" if self.hero else ""
        return (f"| {self.index} | {self.tc} | **{self.duration:.1f}s** | {self.size} | {self.move} "
                f"| {self.load}{tag} | {self.envelope} |")


@dataclass
class ShotPlan:
    total: float
    rhythm_word: str
    formula: Optional[CutFormula]
    rules: EditingRules
    profile: Optional[MaterialProfile] = None
    shots: List[Shot] = field(default_factory=list)
    notes: List[str] = field(default_factory=list)

    # ---- 算法回溯 ----
    @property
    def cuts(self) -> int:
        return len(self.shots)

    @property
    def avg(self) -> float:
        return round(self.total / self.cuts, 2) if self.shots else 0.0

    @property
    def sum_duration(self) -> float:
        return round(sum(s.duration for s in self.shots), 2)

    @property
    def envelopes(self) -> int:
        return max((s.envelope for s in self.shots), default=0)

    def derivation(self) -> List[str]:
        r = self.rules
        p = self.profile or MaterialProfile("general", "通用", r.avg_lo, r.avg_hi, r.hero_lo, r.hero_hi)
        L = [f"素材档位：**{p.label}**（均切长 {p.avg_lo:g}–{p.avg_hi:g}s）",
             f"§1.4 算法：每剪切约 {p.avg_lo:g}–{p.avg_hi:g} 秒 → {self.total:g} ÷ 均切长 = 剪切数",
             f"　本片均切长 {self.avg:g}s ⇒ 剪切数 **{self.cuts}**"]
        tc = r.table_cuts(self.total)
        if tc is not None:
            diff = "" if tc == self.cuts else f"（差 {self.cuts - tc:+d}，属算法与粗略档位的正常浮动）"
            L.append(f"　§1.4 粗略档位对照（通用档）：{self.total:g}s → 约 {tc} 个 {diff}")
        hero = [s for s in self.shots if s.hero]
        if hero:
            L.append(f"　主打长镜：第 {hero[0].index} 镜 {hero[0].duration:.1f}s"
                     f"（§1.4：为最值钱的时刻预留 {p.hero_lo:g}–{p.hero_hi:g}s）")
        L.append(f"　精确加总：{self.sum_duration:g}s ＝ 要求 {self.total:g}s（§1.4 硬要求）")
        return L

    # ---- 校验 ----
    def checks(self) -> List[str]:
        out: List[str] = []
        d = round(self.sum_duration - self.total, 2)
        if abs(d) > 0.01:
            out.append(f"✗ §1.4 加总不平：{self.sum_duration:g}s ≠ {self.total:g}s（差 {d:+.2f}s）"
                       f"——加不平的预算会交付出死时间或一个不可能的剪切")
        else:
            out.append(f"✓ §1.4 加总精确：{self.sum_duration:g}s ＝ {self.total:g}s")

        # §1.5 单调审计
        bad = []
        for i in range(len(self.shots) - 2):
            a, b_, c = self.shots[i], self.shots[i + 1], self.shots[i + 2]
            if a.size == b_.size == c.size and a.move == b_.move == c.move:
                bad.append(f"第 {a.index}–{c.index} 镜")
        if bad:
            out.append(f"✗ §1.5 单调审计不过：{'、'.join(bad)} 连续三镜同为「景别+运动」——"
                       f"要变的是镜头的功能与尺度，不只是时长")
        else:
            out.append("✓ §1.5 单调审计通过：无连续三镜共享同一景别且同一镜头运动")

        # §1.3 复杂度
        over = [s for s in self.shots if s.duration > 15]
        if over:
            out.append(f"✗ §1.3 超信封：第 {over[0].index} 镜 {over[0].duration:.1f}s > 15s")
        else:
            out.append("✓ §1.3 逐镜均在 15s 信封内")

        # §1.1 短镜可读性
        tiny = [s for s in self.shots if s.duration < 0.3]
        if tiny:
            out.append(f"⚠ 第 {tiny[0].index} 镜 {tiny[0].duration:.1f}s 低于可读阈值")
        return out

    def envelope_plan(self) -> List[str]:
        """§2.2 信封归并。"""
        r = self.rules
        out = [f"§2.2 归并启发式：{r.merge_heuristic or '大约每 4–5 个镜头行一条提示词'}",
               f"　⇒ 共 {self.cuts} 个镜头行 → **{self.envelopes} 条提示词**"]
        for e in range(1, self.envelopes + 1):
            g = [s for s in self.shots if s.envelope == e]
            if g:
                out.append(f"　信封 {e}：镜头 {g[0].index}–{g[-1].index}，"
                           f"{g[0].start:.1f}–{g[-1].end:.1f}s（{sum(x.duration for x in g):.1f}s）")
        out.append("§2.2 时长算术三处必须一致：标题行 / `**Duration:** Xs` / 逐镜头时序标签")
        return out

    def table(self) -> str:
        head = ("| # | 时间码 | 时长 | 景别（06） | 镜头运动（08） | 承载内容（§1.3） | 信封 |\n"
                "|---|--------|------|-----------|---------------|------------------|------|\n")
        return head + "\n".join(s.row() for s in self.shots)

    def render(self) -> str:
        f = self.formula
        p = self.profile
        head = f"目标时长：**{self.total:g}s**"
        if p:
            head += f"　素材档位：**{p.label}**"
        if f:
            head += f"　节奏型：**{f.mark} {f.label}**（{f.pattern}）· 适合：{f.best_for}"
        elif self.rhythm_word:
            head += f"　节奏型：**{self.rhythm_word}**"
        L = [head, "",
             "**§1.4 推算过程**："]
        L += ["  " + x for x in self.derivation()]
        if p and p.basis:
            L.append("  **本档依据**（包内原文）：")
            L += ["    · " + x for x in p.basis]
        L += ["", self.table(), ""]
        L.append("**§1.5 单调审计与加总校验**：")
        L += ["  " + c for c in self.checks()]
        L += ["", "**§2.2 信封归并**："]
        L += ["  " + c for c in self.envelope_plan()]
        if self.notes:
            L += ["", "**注**："] + ["  · " + n for n in self.notes]
        return "\n".join(L)


# ---------------------------------------------------------------- 分配

def _plan_durations(total: float, cuts: int, r: EditingRules,
                    hero_len: float, hero_idx: int, swing: float,
                    min_shot: float = 0.3) -> List[float]:
    """主打长镜占一镜；其余围绕本档均切长做长短摆动。精确加总到 total。"""
    if cuts <= 1:
        return [total]

    rest_total = total - hero_len
    # hero_len == 0 时没有主打长镜，其余镜数就是 cuts，不能减 1
    rest_n = (cuts - 1) if hero_len > 0 else cuts
    base = rest_total / rest_n if rest_n else 0.0

    pattern = []
    for i in range(rest_n):
        sign = 1 if i % 2 == 0 else -1
        pattern.append(max(min_shot, base * (1 + sign * swing)))
    s = sum(pattern)
    rest = [x * rest_total / s for x in pattern] if s else [base] * rest_n

    if hero_len > 0:
        idx = max(0, min(rest_n, hero_idx))
        d = rest[:idx] + [hero_len] + rest[idx:]
    else:
        d = list(rest)

    # §1.4 硬要求：写明的剪切时长必须精确加总等于所要求的总时长
    d = [round(x, 1) for x in d]
    residual = round(total - sum(d), 1)
    if abs(residual) >= 0.05:
        i = max(range(len(d)), key=lambda k: d[k])
        d[i] = round(d[i] + residual, 1)
    return d


def _assign_grammar(shots: List[Shot], sizes: List[str], motions: List[str]) -> None:
    """按 §1.3 的「承载内容」分配景别与运动，再过 §1.5 单调审计。

    景别不是按镜长排序发的——**镜头的功能决定尺度**：
      · 首镜 = 定场 → 大远景 / 全景
      · 主打长镜 = 情绪高点 → 中近景 / 特写（不是大远景）
      · 快切拍 → 特写 / 大特写 / 微距 / 中景（插入与细节）
    06 的景别表本来就是「大远景 → 微距」由宽到紧排的，按其索引分档。
    """
    if not sizes or not motions:
        return
    n = len(sizes)
    wide = [i for i in range(n) if i <= 1]                 # 定场级
    mid = [i for i in range(n) if 2 <= i <= 4]             # 中景级
    tight = [i for i in range(n) if i >= max(5, n - 5)]    # 特写级

    hero_i = next((i for i, s in enumerate(shots) if s.hero), None)
    chosen: Dict[int, int] = {}          # 镜头下标 → 景别下标（**不是景别名**）

    # ① 首镜定场
    if shots:
        chosen[0] = wide[0]
    # ② 主打长镜 = 情绪高点 → 中近景 / 特写（宁可偏紧，不要大全景）
    if hero_i is not None and hero_i != 0:
        chosen[hero_i] = tight[len(tight) // 3] if tight else n - 1

    used = set(chosen.values())
    # ③ 其余：短的给特写级（插入/细节），长的给中景级
    rest = [i for i in range(len(shots)) if i not in chosen]
    rest.sort(key=lambda i: shots[i].duration)
    pool = [i for i in (tight + mid) if i not in used]
    if not pool:
        pool = list(range(n))
    for k, i in enumerate(rest):
        chosen[i] = pool[k % len(pool)]

    for i, si in chosen.items():
        shots[i].size = sizes[si]

    # 运动：首镜与主打长镜偏稳，快切拍偏动
    for i, s in enumerate(shots):
        if i == 0 or s.hero:
            s.move = "固定" if "固定" in motions else motions[0]
        elif s.duration <= 2.0:
            s.move = motions[(i * 2 + 1) % len(motions)]
        else:
            s.move = motions[(i * 3) % len(motions)]

    # §1.5 单调审计修正
    for _ in range(6):
        changed = False
        for i in range(len(shots) - 2):
            a, b_, c = shots[i], shots[i + 1], shots[i + 2]
            if a.size == b_.size == c.size and a.move == b_.move == c.move:
                cur = motions.index(c.move) if c.move in motions else 0
                c.move = motions[(cur + 1) % len(motions)]
                changed = True
        if not changed:
            break


def split(total: float, rhythm: str = "", bundle: Optional[Bundle] = None,
          avg: Optional[float] = None, swing: Optional[float] = None,
          cuts: Optional[int] = None, profile: str = "漫剧") -> ShotPlan:
    """按模块 10 的组接方法论划分镜头。

    total  : 5–30 秒（自由选择）
    rhythm : 紧张 / 温馨 / 紧凑 …（去匹配 12 prompt/20 的「适合」列）
    profile: 素材档位——**漫剧（默认）** / 通用
             漫剧档依据 10 editing/05 的微切片组装（1–3 秒）与 12 prompt/20 对策④（0.3-1s 快切）
    avg / swing / cuts : 覆盖引擎参数
    """
    if not (MIN_TOTAL - 1e-9 <= total <= MAX_TOTAL + 1e-9):
        raise ValueError(f"总时长 {total:g}s 超出 {MIN_TOTAL:g}–{MAX_TOTAL:g}s 区间")

    b = bundle or Bundle()
    r = load_editing_rules(b)
    prof = resolve_profile(profile, load_profiles(b))
    formulas = load_formulas(b)
    f = match_formula(rhythm, formulas)

    t = RHYTHM_TUNING.get(f.label if f else "", DEFAULT_TUNING)
    if avg is not None:
        prof = MaterialProfile(prof.key, prof.label, avg, max(avg, prof.avg_hi),
                               prof.hero_lo, prof.hero_hi, prof.min_shot, prof.basis)
    if swing is None:
        swing = t[1]

    # §1.4：均切长必须落在本档区间内 ⇒ 剪切数被总时长卡成一个窗口
    lo_cuts = max(1, int(math.ceil(total / prof.avg_hi)))
    hi_cuts = max(1, int(math.floor(total / prof.avg_lo)))
    if hi_cuts < lo_cuts:
        hi_cuts = lo_cuts

    if cuts is None:
        if hi_cuts == lo_cuts:
            cuts = lo_cuts
        else:
            cuts = int(round(lo_cuts + (hi_cuts - lo_cuts) * (1 - t[0])))
            cuts = max(lo_cuts, min(hi_cuts, cuts))
    window = (lo_cuts, hi_cuts)

    # 主打长镜（§1.4）：须让其余镜仍满足本档均切长下限；不够就逐镜减，减到 lo_cuts 为止
    hero_pos = HERO_POS.get(f.label if f else "", 0.66)
    hero_len = 0.0
    while cuts >= 2:
        max_hero = total - (cuts - 1) * prof.avg_lo
        if max_hero >= prof.hero_lo - 1e-9:
            hero_len = min(prof.hero_hi, max_hero)
            break
        if cuts <= lo_cuts:
            break
        cuts -= 1
    hero_idx = max(0, min(cuts - 1, int(round(cuts * hero_pos)))) if cuts > 1 else 0

    durs = _plan_durations(total, cuts, r, hero_len, hero_idx, swing, prof.min_shot)

    sizes = [x.name for x in b.shot_sizes] or ["中景"]
    motions = load_motions(b)

    shots: List[Shot] = []
    acc = 0.0
    for i, d in enumerate(durs):
        shots.append(Shot(index=i + 1, duration=round(d, 1), start=round(acc, 1),
                          end=round(acc + d, 1), load=r.load_of(d)))
        acc += d
    # 主打长镜标记：最长的一镜
    if shots and hero_len:
        max(shots, key=lambda s: s.duration).hero = True
    _assign_grammar(shots, sizes, motions)

    # §2.2 信封归并
    per = r.lines_per_prompt[1] or 5
    for i, s in enumerate(shots):
        s.envelope = i // per + 1

    notes: List[str] = []
    if f:
        notes.append(f"节奏型「{rhythm}」匹配到 {f.mark} {f.label}"
                     f"——依据该公式在速查表「适合」列的适用场景")
    elif rhythm:
        avail = available_rhythm_words(formulas)
        notes.append(f"⚠ 「{rhythm}」**未匹配到任何公式的「适合」列**——"
                     f"当前取默认取点 + 默认摆动，属于**无依据的兜底**")
        notes.append(f"　速查表里合法的节奏词：{'、'.join(avail)}")
    notes.append(f"§1.4 剪切数窗口：{window[0]}–{window[1]} 个（总时长 ÷ 均切长必须落在 "
                 f"{prof.avg_lo:g}–{prof.avg_hi:g}s）→ 本片取 **{cuts}**")
    if f:
        notes.append(f"节奏形状依据：公式「节奏图」`{f.pattern}`")
    notes.append(f"引擎参数（非技能规定，可覆盖）：取点 {t[0]:.2f}"
                 f"（0=短端高频，1=长端低频）· 摆动 ±{swing:.0%} · 主打长镜落位 {hero_idx + 1}/{cuts}"
                 f"　可用 `--avg / --swing / --cuts / --profile` 覆盖")
    if r.default_single:
        notes.append("§2.1 提醒：" + r.default_single)
    if total < 2 * prof.avg_lo:
        notes.append(f"总时长 {total:g}s 短于本档一个整拍（{prof.avg_lo:g}s×2）——"
                     f"按 §1.3「宁可信封更短」，建议压到 1–2 镜而不是硬凑剪切数")

    return ShotPlan(total=total, rhythm_word=rhythm, formula=f, rules=r,
                    profile=prof, shots=shots, notes=notes)


def split_by_units(total: float, unit: float, rhythm: str = "",
                   bundle: Optional[Bundle] = None, profile: str = "漫剧",
                   hero_unit: Optional[int] = None, **kw) -> List[ShotPlan]:
    """**按生成单元切**——每个单元各自划分 CUT，单元内加总精确，单元边界落在整点上。

    依据 10 editing/01 §1.3：「每条提示词以 15 秒为目标（**生成模型产定长片段**——
    把剪切设计得填满它）」。**信封 = 生成单元**，所以平台单元时长就是信封上限。

    即梦（12 platform/03 §3.2）：
      · **API 口径**：只有 **5s / 10s** 两档（帧数 121 / 241）→ 30s = 3×10s 或 6×5s
      · **UI 口径**：4–15s 连续 → 30s 可 2×15s 等

    hero_unit：**主打长镜落在第几个单元**（1-based）。§1.4 的 6–8s 主打长镜是**全片级**的，
    不该每单元各来一个——10s 单元装不下「3 个 CUT + 6–8s 长镜」。指定该单元后，
    它按 2 个 CUT 切，长镜才放得下。
    """
    if unit <= 0:
        raise ValueError("单元时长须为正数")
    n = int(round(total / unit))
    if n < 1:
        raise ValueError(f"总时长 {total:g}s 装不下一个 {unit:g}s 单元")
    if abs(n * unit - total) > 0.05:
        raise ValueError(f"{total:g}s 不是 {unit:g}s 的整数倍（{n}×{unit:g}={n * unit:g}）——"
                         f"API 只有 5s / 10s 两档，单元边界必须落在整点上")

    plans: List[ShotPlan] = []
    acc = 0.0
    for i in range(n):
        local = dict(kw)
        is_hero = (hero_unit == i + 1)
        if is_hero:
            local["cuts"] = 2          # 两个 CUT，长镜才放得下
        p = split(unit, rhythm, bundle, profile=profile, **local)
        for k, s in enumerate(p.shots, 1):
            s.index = k
            s.start = round(s.start + acc, 1)
            s.end = round(s.end + acc, 1)
            s.envelope = i + 1
        acc += unit
        p.total = unit
        tag = "　★ **本单元承载全片主打长镜**" if is_hero else ""
        p.notes.insert(0, f"**生成单元 {i + 1}/{n}**：{acc - unit:.1f}–{acc:.1f}s"
                          f"（单元时长 {unit:g}s）{tag}")
        plans.append(p)

    # **跨单元去单调**：§1.5 只管「连续三镜」，管不到「两个单元序列完全相同」。
    # 各单元独立切时会长出一模一样的景别+运动序列——按 §1.5 的精神（"要变的是镜头的功能与尺度"）打散。
    motions = load_motions(bundle or Bundle())
    for i in range(1, len(plans)):
        a = [(s.size, s.move) for s in plans[i - 1].shots]
        b = [(s.size, s.move) for s in plans[i].shots]
        if a == b:
            for s in plans[i].shots:
                cur = motions.index(s.move) if s.move in motions else 0
                s.move = motions[(cur + 1) % len(motions)]
            plans[i].notes.append(
                "⚠ 跨单元去单调：本单元原与前单元序列完全相同，运动已轮转一位"
                "（§1.5 只管连续三镜，序列级重复要另行打散）")
    return plans


def unit_table(plans: List[ShotPlan]) -> str:
    """把多个生成单元汇成一张总表。"""
    head = ("| 单元 | 生成单元时长 | # | 时间码 | 时长 | 景别 | 运动 | 承载（§1.3） |\n"
            "|------|-------------|---|--------|------|------|------|-------------|\n")
    rows = []
    for i, p in enumerate(plans, 1):
        for k, s in enumerate(p.shots):
            u = f"**{i}**" if k == 0 else ""
            ud = f"**{p.total:g}s**" if k == 0 else ""
            rows.append(f"| {u} | {ud} | {s.index} | {s.tc} | **{s.duration:.1f}s** | "
                        f"{s.size} | {s.move} | {s.load} |")
    return head + "\n".join(rows)


def catalog(bundle: Optional[Bundle] = None) -> str:
    """列出从包内读出的全部规则与六套公式。"""
    b = bundle or Bundle()
    r = load_editing_rules(b)
    fs = load_formulas(b)
    L = ["**素材档位**（决定均切长取哪一档）：", ""]
    for k, p in load_profiles(b).items():
        L.append(f"  · **{p.label}**（`{k}`）均切长 {p.avg_lo:g}–{p.avg_hi:g}s"
                 f"　主打长镜 {p.hero_lo:g}–{p.hero_hi:g}s　短拍下限 {p.min_shot:g}s")
        for x in p.basis:
            L.append(f"      依据：{x}")
    L += ["", "**§1.4 序列节奏预算**（10 editing/01 实时读出）：",
          f"  · 均切长区间：{r.avg_lo:g}–{r.avg_hi:g} 秒",
          f"  · 主打长镜：{r.hero_lo:g}–{r.hero_hi:g} 秒（给最值钱的时刻）",
          "  · 粗略档位对照："]
    for label, n in r.cut_table:
        L.append(f"      {label} → 约 {n} 个")
    L += ["", "**§1.3 时长阶梯**（每镜能承载什么）："]
    for lo, hi, lab in r.steps:
        L.append(f"  · {lo:g}–{hi:g} 秒 = {lab}")
    L += ["", "**§1.5 单调审计**：",
          f"  · {r.audit_rule or '不允许连续三个剪切共享同一景别且同一镜头运动'}",
          "", "**§2.2 信封归并**：",
          f"  · {r.merge_heuristic or '大约每 4–5 个镜头行一条提示词'}",
          "  · 时长算术三处必须一致：标题行 / `**Duration:** Xs` / 逐镜头时序标签",
          "", "**六套剪辑公式**（12 prompt/20 原文，用于匹配节奏词）：", "",
          "| | 公式 | 节奏图 | 适合 | 难度 |",
          "|---|------|--------|------|------|"]
    for f in fs:
        L.append(f"| {f.mark} | {f.label} | {f.pattern} | {f.best_for} | {f.difficulty} |")
    L += ["", f"**总时长区间**：{MIN_TOTAL:g}–{MAX_TOTAL:g} 秒",
          f"**速查表里合法的节奏词（唯一依据）**：{'、'.join(available_rhythm_words(fs))}",
          f"**检索别名（只做路由，不是标准）**：{'、'.join(SEARCH_ALIASES)}",
          "**可覆盖参数**：`--avg` 均切长 · `--swing` 摆动幅度 · `--cuts` 直接指定剪切数"]
    return "\n".join(L)


# ================================================================ 人工锁定组接（HARD HUMAN LOCK）

@dataclass
class CutsReport:
    """人工指定镜头组接的校验报告。脚本只校**纪律**（加总/单调/信封/预算），
    不校创作（选哪个景别、讲什么信息）——按 06 的优先级链，人工组接是 HARD HUMAN LOCK。"""
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    ok: List[str] = field(default_factory=list)
    table: List[str] = field(default_factory=list)
    locked: bool = False

    @property
    def passed(self) -> bool:
        return not self.errors

    def summary(self) -> str:
        head = ("结论：PASS · 人工组接已锁定（HARD HUMAN LOCK）" if self.passed
                else f"结论：FAIL · 人工组接违反复核纪律（{len(self.errors)} 项）")
        L = [head]
        L += self.table
        for x in self.ok:
            L.append("[PASS ] " + x)
        for x in self.warnings:
            L.append("[WARN ] " + x)
        for x in self.errors:
            L.append("[FAIL ] " + x)
        return "\n".join(L)


def _cuts_level(sizes: List[str], name: str) -> Optional[int]:
    """模式B：景别 → 06 景别表级序（文档序即级序：大远景→…→微距）。"""
    if not name:
        return None
    for idx, s in enumerate(sizes):
        if name in s or s in name:
            return idx
    return None


def _cuts_is_bridge(parsed: list, meta: list, k: int) -> bool:
    """模式B：INS/空镜为桥镜——不计级，级差链在其处重置（editing/16 §一）。"""
    kind = meta[k]["kind"].upper()
    if kind in ("INS", "INSERT", "空镜", "空镜头", "插入"):
        return True
    size = parsed[k][2]
    return bool(size) and ("插入" in size or "空镜" in size or "INSERT" in size.upper())


def validate_cuts(bundle: Optional[Bundle] = None, spec: dict = None) -> CutsReport:
    """校验人工指定的镜头组接。

    spec 字段：
      total        总时长（缺省取 cuts 时长加总）
      editing_mode 组接判据：唯一通道＝模式B 实拍学派（v1.1.3 起级差≤1 旧判据废除）
                   （隔级切「远全中近特相邻不相切」＋动接动＋轴线视线＋切点正因，10 editing/15/16）
      cuts         [{id, duration, shot_size, motion, 叙事功能?, jump_cut?,
                   主体?, kind?, 豁免?/transition_note?, 朝向?, 切点?}, ...]
                   shot_size 取 06 景别表；motion 取 08 运镜词汇（自由文本）
                   模式B 新字段：主体=同主体隔级切判；kind="INS"/"空镜"=桥镜不计级；
                   豁免=违例降 WARN；朝向=越轴缓冲检查；切点=正因统计
    校验依据：10 editing/01 §1.3/§1.4/§1.5、editing/02 §2.2、
             07 shotlist/03（同景别直切须声明 jump cut）、06 景别表；
             模式B 依据 10 editing/15/16（v1.1.1 剪辑双通道）
    """
    b = bundle or Bundle()
    rep = CutsReport()
    r = load_editing_rules(b)
    cuts = list((spec or {}).get("cuts") or [])
    if not cuts:
        rep.errors.append("未提供 cuts 镜头列表")
        return rep

    # v1.1.3：级差≤1 判据废除（作者指令），模式B 实拍学派为唯一组接判据
    mode_b = True
    rep.table.append("剪辑判据：模式B·实拍学派（隔级切/动接动/轴线视线/切点正因，真源 10 editing/15/16）——唯一组接判据")

    sizes = [s.name for s in b.shot_sizes]
    parsed = []
    meta = []
    for i, c in enumerate(cuts, 1):
        try:
            dur = float(c.get("duration", 0))
        except (TypeError, ValueError):
            dur = 0.0
        parsed.append((i, dur, str(c.get("shot_size", "")).strip(),
                       str(c.get("motion", "")).strip(),
                       str(c.get("叙事功能", "")).strip(),
                       bool(c.get("jump_cut", False))))
        meta.append({
            "subject": str(c.get("主体", c.get("subject", ""))).strip(),
            "kind": str(c.get("kind", c.get("类型", ""))).strip(),
            "exempt": str(c.get("豁免", c.get("transition_note", ""))).strip(),
            "axis": str(c.get("朝向", c.get("axis", ""))).strip(),
            "reason": str(c.get("切点", "")).strip(),
        })
    total_declared = (spec or {}).get("total")
    total = float(total_declared) if total_declared else sum(d for _, d, *_ in parsed)
    smin, smax = min(d for _, d, *_ in parsed), max(d for _, d, *_ in parsed)

    # §1.4 精确加总
    s = sum(d for _, d, *_ in parsed)
    if abs(s - total) > 0.01:
        rep.errors.append(f"§1.4 加总不平：{s:g}s ≠ {total:g}s（差 {s-total:+.2f}s）——"
                          "写明的剪切时长必须精确加总等于所要求的总时长")
    else:
        rep.ok.append(f"§1.4 加总精确：{s:g}s ＝ {total:g}s（{len(parsed)} 镜）")

    # §1.4 主打长镜（总时长足够时，预留 6–8s 给最值钱的时刻）
    if total >= 20:
        hero = [(i, d) for i, d, *_ in parsed if 6.0 <= d <= 8.0]
        if hero:
            rep.ok.append(f"§1.4 主打长镜在第 {hero[0][0]} 镜（{hero[0][1]:g}s，6–8s 区间）")
        else:
            rep.warnings.append("§1.4 未见 6–8s 主打长镜——总时长 ≥20s 时建议为最值钱的时刻保留一个刻意更长的镜头")

    # §1.4 剪切数预算对照（人工锁定优先，偏差只提示）
    budget = r.table_cuts(total)
    if budget and len(parsed) != budget:
        rep.warnings.append(f"§1.4 预算对照：{len(parsed)} 刀 vs 预算约 {budget} 刀——"
                            "人工锁定可偏离预算（HARD HUMAN LOCK > DIRECTOR DECISION），此处仅提示")

    # §1.5 单调审计
    bad = []
    for i in range(len(parsed) - 2):
        a, c1, c2 = parsed[i], parsed[i + 1], parsed[i + 2]
        if a[2] == c1[2] == c2[2] and a[3] == c1[3] == c2[3] and a[2] and a[3]:
            bad.append(f"第 {a[0]}–{c2[0]} 镜")
    if bad:
        rep.errors.append("§1.5 单调审计不过：" + "、".join(bad) +
                          " 连续三镜同为「景别+运动」——要变的是镜头的功能与尺度，不只是时长")
    else:
        rep.ok.append("§1.5 单调审计通过：无连续三镜共享同一景别且同一镜头运动")

    # §1.3 信封与可读阈值 + 承载内容标注
    over = [(i, d) for i, d, *_ in parsed if d > 15]
    if over:
        rep.errors.append(f"§1.3 超信封：第 {over[0][0]} 镜 {over[0][1]:g}s > 15s")
    tiny = [(i, d) for i, d, *_ in parsed if 0 < d < 0.3]
    if tiny:
        rep.warnings.append(f"第 {tiny[0][0]} 镜 {tiny[0][1]:g}s 低于 0.3s 可读阈值")
    rep.table.append("  #   时长   景别（06）      运动（08）        承载内容（§1.3）")
    for i, d, size, move, nf, jc in parsed:
        load = r.load_of(d)
        tag = f"{'（jump cut 已声明）' if jc else ''}"
        rep.table.append(f"  {i:>2}  {d:>5.1f}s  {size or '（未填）':<8} {move or '（未填）':<10} {load}{tag}")

    # 07 同景别直切（相邻同景别 → 须声明 jump cut 焦虑感）
    # 模式B：级差=0 升级为 FAIL（豁免/jump_cut 声明/INS 桥镜可降 WARN）
    for k in range(len(parsed) - 1):
        a, c1 = parsed[k], parsed[k + 1]
        if a[2] and a[2] == c1[2] and not c1[5] and not a[5]:
            msg = (f"第 {a[0]}→{c1[0]} 镜同景别「{a[2]}」直切——"
                   "07：同景别连切须声明 jump cut（焦虑感），否则调整景别跳级")
            if mode_b and not (meta[k + 1]["exempt"] or _cuts_is_bridge(parsed, meta, k + 1)):
                rep.errors.append(f"模式B 隔级切（级差=0）：" + msg.split("——")[0] +
                                  "——同景别直切禁（editing/16 §一）：插 INS/空镜缓冲或带豁免")
            else:
                rep.warnings.append(msg)

    # 模式B（实拍学派，10 editing/15/16）：隔级切级差判 + 越轴缓冲 + 切点正因
    if mode_b:
        chain_pos = None      # 级差链锚点：上一非桥镜位置
        skipped_sizes = set()
        for k in range(len(parsed)):
            if _cuts_is_bridge(parsed, meta, k):
                rep.ok.append(f"模式B 桥镜：第 {parsed[k][0]} 镜（{parsed[k][2] or '未命名'}）不计级，级差链重置")
                chain_pos = None
                continue
            lvl = _cuts_level(sizes, parsed[k][2])
            subj = meta[k]["subject"]
            if subj and lvl is None and parsed[k][2] and parsed[k][2] not in skipped_sizes:
                skipped_sizes.add(parsed[k][2])
                rep.warnings.append(f"模式B 隔级切：景别「{parsed[k][2]}」不在 06 级序，该镜级差判跳过（请核对 06 景别表）")
            if chain_pos is not None and subj and subj == meta[chain_pos]["subject"] and lvl is not None:
                p_lvl = _cuts_level(sizes, parsed[chain_pos][2])
                if p_lvl is not None:
                    diff = abs(lvl - p_lvl)
                    i0, i1 = parsed[chain_pos][0], parsed[k][0]
                    s0, s1 = parsed[chain_pos][2], parsed[k][2]
                    if diff == 1 and not meta[k]["exempt"]:
                        rep.errors.append(f"模式B 隔级切：第 {i0}→{i1} 镜同主体相邻景别「{s0}→{s1}」级差=1——"
                                          "远全中近特相邻不相切（editing/16 §一）：隔级直切，或补豁免理由")
                    elif diff == 1:
                        rep.warnings.append(f"模式B 隔级切豁免：第 {i0}→{i1} 镜相邻景别「{s0}→{s1}」"
                                            f"（豁免：{meta[k]['exempt']}）——如实记录")
                    elif diff >= 2:
                        rep.ok.append(f"模式B 隔级切：第 {i0}→{i1} 镜同主体级差 {diff} 级（{s0}→{s1}），隔级合法")
            if lvl is not None:
                chain_pos = k
        # 越轴缓冲：同主体朝向反转且无桥镜/豁免
        for k in range(len(parsed) - 1):
            ax0, ax1 = meta[k]["axis"], meta[k + 1]["axis"]
            if (ax0 and ax1 and ax0 != ax1 and meta[k]["subject"]
                    and meta[k]["subject"] == meta[k + 1]["subject"]
                    and not meta[k + 1]["exempt"] and not _cuts_is_bridge(parsed, meta, k + 1)):
                rep.warnings.append(f"模式B 越轴缓冲：第 {parsed[k][0]}→{parsed[k + 1][0]} 镜同主体朝向「{ax0}→{ax1}」反转——"
                                    "180° 轴线越轴须中性镜/运动越轴/切出再入缓冲（editing/16 §三）")
        # 切点正因（Dmytryk 法则一）
        no_reason = [parsed[k][0] for k in range(len(parsed))
                     if not (meta[k]["reason"] or meta[k]["exempt"] or parsed[k][4] or parsed[k][5])]
        if len(parsed) >= 3 and len(no_reason) * 2 > len(parsed):
            rep.warnings.append(f"模式B 切点正因：{len(no_reason)}/{len(parsed)} 镜无「切点/叙事功能/豁免」任何理由——"
                                "切必有正因（Dmytryk 法则一，editing/16 §二）")

    # 08 运动词表校验（load_motions 从包内实时读出）
    motions = load_motions(b)
    if motions:
        unknown_m = sorted({p3 for _, _, _, p3, _, _ in parsed
                            if p3 and not any(p3 in mv or mv in p3 for mv in motions)})
        if unknown_m:
            rep.warnings.append("运动「" + "、".join(unknown_m) + "」未命中 08 运动词汇表——"
                                "请核对是否为具名运动预设（08 moves/09 镜头运动预设库）")

    # 06 景别合法性
    if sizes:
        unknown = sorted({p[2] for p in parsed if p[2] and not any(p[2] in sz or sz in p[2] for sz in sizes)})
        if unknown:
            rep.warnings.append(f"景别「{'、'.join(unknown)}」不在 06 景别表（{'、'.join(sizes)}）——请核对")

    rep.locked = rep.passed
    return rep
