#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""资产层：从 影视剧作工坊-skill 包内真实解析资产。

不硬编码任何词表——所有内容都从包内文件读出，包改了脚本跟着变。
依赖：Python 3.8+ 标准库。
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional

# ---------------------------------------------------------------- 路径

_HERE = Path(__file__).resolve()
SCRIPTS_DIR = _HERE.parent.parent                    # .../影视剧作工坊-路由/scripts
ROUTER_DIR = SCRIPTS_DIR.parent                      # .../影视剧作工坊-路由
DEFAULT_BUNDLE = ROUTER_DIR.parent                   # .../影视剧作工坊-skill


def bundle_root(root: Optional[str | Path] = None) -> Path:
    """定位包根。显式传入优先，否则用默认相对位置。"""
    p = Path(root).resolve() if root else DEFAULT_BUNDLE
    if not p.is_dir():
        raise FileNotFoundError(f"找不到包根：{p}")
    return p


# ---------------------------------------------------------------- 小工具

_CJK = re.compile(r"[\u3000-\u9fff\uff00-\uffef]")


def norm(s: str) -> str:
    """归一化：全角转半角、去空白。用于比对。"""
    s = unicodedata.normalize("NFKC", s or "")
    return re.sub(r"\s+", "", s)


def read_text(p: Path) -> str:
    return p.read_text(encoding="utf-8-sig").replace("\r\n", "\n")


def iter_blocks(text: str, head_re: str):
    """按标题切段，yield (标题行, 正文)。"""
    rx = re.compile(head_re)
    lines = text.split("\n")
    title, buf = None, []
    for ln in lines:
        if rx.match(ln):
            if title is not None:
                yield title, "\n".join(buf)
            title, buf = ln, []
        elif title is not None:
            buf.append(ln)
    if title is not None:
        yield title, "\n".join(buf)


def backtick_value(block: str, label: str) -> Optional[str]:
    """取 `**label**：\\`值\\`` 里的值。"""
    m = re.search(r"\*\*" + re.escape(label) + r"[^*]*\*\*(?:（[^）]*）)?\s*[:：]\s*(?:`([^`]+)`|```[^\n]*\n([^`]+)```)", block)
    return (m.group(1) or m.group(2)).strip() if m else None


def bold_value(block: str, label: str) -> Optional[str]:
    """取 `**label**：值`（到行尾）。"""
    m = re.search(r"\*\*" + re.escape(label) + r"[^*]*\*\*\s*[:：]\s*(.+)", block)
    return m.group(1).strip() if m else None


def split_cn_list(s: str) -> List[str]:
    """中文逗号 / 顿号 / 分号分隔的清单。"""
    if not s:
        return []
    return [x.strip() for x in re.split(r"[，,、;；]", s) if x.strip()]


# ---------------------------------------------------------------- 数据类

@dataclass
class Benchmark:
    """角色风格基准（04 characters/15 的 A–AC）。"""
    code: str
    title: str
    applicable: str = ""
    dims: Dict[str, str] = field(default_factory=dict)
    keywords: str = ""
    negatives: List[str] = field(default_factory=list)
    transcribe_note: str = ""

    @property
    def keyword_list(self) -> List[str]:
        return split_cn_list(self.keywords)

    def __str__(self) -> str:
        return f"基准{self.code}：{self.title}"


@dataclass
class ShotSize:
    """景别（06 shotlang/01）。"""
    name: str
    content: str = ""
    keywords: str = ""
    best_for: str = ""


@dataclass
class AudioTracks:
    """声音三轨（⑧⑨⑩）。"""
    dialogue: str = ""
    ambient: str = ""
    bgm: str = ""
    profile: str = "full"          # full | no-bgm

    PROFILE_FULL = "full"
    PROFILE_NO_BGM = "no-bgm"

    def lines(self) -> List[str]:
        """⑧对白 / ⑨背景音 / ⑩BGM 三轨（独立槽号）。"""
        out = [f"⑧ 对白：{self.dialogue}" if self.dialogue.strip() else "⑧ 对白：无对白"]
        out.append(f"⑨ 背景音：{self.ambient}" if self.ambient.strip() else "⑨ 背景音：无环境音")
        if self.profile == self.PROFILE_NO_BGM:
            out.append("⑩ BGM：NO BGM。")
        else:
            out.append(f"⑩ BGM：{self.bgm}" if self.bgm.strip() else "⑩ BGM：NO BGM。")
        return out

    @property
    def ambient_required(self) -> bool:
        """⑨背景音任何档位都不能为空。"""
        return bool(self.ambient.strip())


# ---------------------------------------------------------------- 包

class Bundle:
    """包内资产读取器。"""

    def __init__(self, root: Optional[str | Path] = None):
        self.root = bundle_root(root)
        self._bench_cache: Optional[Dict[str, Benchmark]] = None
        self._shot_cache: Optional[List[ShotSize]] = None

    # ---- 路径助手 ----
    def mod(self, prefix: str) -> Path:
        """按模块号取模块目录，如 mod('04')。"""
        hits = [p for p in self.root.iterdir()
                if p.is_dir() and f"-{prefix}-" in p.name]
        if not hits:
            raise FileNotFoundError(f"找不到模块 {prefix}")
        return hits[0]

    def file(self, module_prefix: str, rel: str) -> Path:
        p = self.mod(module_prefix) / rel
        if not p.is_file():
            raise FileNotFoundError(f"找不到文件：{p}")
        return p

    # ---- 角色风格基准 ----
    STYLE_LIB = "characters/15-风格基准库.md"

    @property
    def benchmarks(self) -> Dict[str, Benchmark]:
        if self._bench_cache is None:
            text = read_text(self.file("04", self.STYLE_LIB))
            out: Dict[str, Benchmark] = {}
            # 兼容 `### 基准A：` 与 `### 基准 Y：` 两种写法
            for title, body in iter_blocks(text, r"^###\s*基准\s*[A-Z]{1,2}\s*[：:]"):
                m = re.match(r"^###\s*基准\s*([A-Z]{1,2})\s*[：:]\s*(.+)$", title)
                if not m:
                    continue
                code, name = m.group(1), m.group(2).strip()
                note = ""
                nm = re.search(r"→\s*\*\*(.+?)\*\*", name)
                if nm:
                    note = nm.group(1)
                    name = name[: nm.start()].strip()
                b = Benchmark(code=code, title=name, transcribe_note=note)
                b.applicable = bold_value(body, "适用") or ""
                for dm in re.finditer(r"^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$", body, re.M):
                    k, v = dm.group(1).strip(), dm.group(2).strip()
                    if k in ("维度", "------", "") or k.startswith("-"):
                        continue
                    b.dims[k] = v
                kw = backtick_value(body, "质感关键词")
                if kw:
                    b.keywords = kw
                ng = backtick_value(body, "负面词追加")
                if ng:
                    b.negatives = split_cn_list(ng)
                out[code] = b
            self._bench_cache = out
        return self._bench_cache

    def benchmark(self, code: str) -> Benchmark:
        code = code.strip().upper()
        b = self.benchmarks.get(code)
        if not b:
            raise KeyError(f"没有基准 {code}；可用：{', '.join(sorted(self.benchmarks))}")
        return b

    def benchmark_routes(self) -> Dict[str, str]:
        """基准选择速查：题材 → 主基准。"""
        text = read_text(self.file("04", self.STYLE_LIB))
        out: Dict[str, str] = {}
        started = False
        for ln in text.split("\n"):
            if "基准选择速查" in ln:
                started = True
                continue
            if started:
                if ln.startswith("###") or ln.startswith("## "):
                    break
                m = re.match(r"^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$", ln)
                if m and m.group(1).strip() not in ("剧情题材", "---------"):
                    out[m.group(1).strip()] = m.group(2).strip()
        return out

    # ---- 景别 ----
    @property
    def shot_sizes(self) -> List[ShotSize]:
        if self._shot_cache is None:
            text = read_text(self.file("06", "shotlang/01-景别.md"))
            out: List[ShotSize] = []
            for ln in text.split("\n"):
                m = re.match(r"^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$", ln)
                if not m:
                    continue
                name = m.group(1).strip()
                if name in ("景别", "------") or name.startswith("-"):
                    continue
                out.append(ShotSize(name=name, content=m.group(2).strip(),
                                    keywords=m.group(3).strip(), best_for=m.group(4).strip()))
            self._shot_cache = out
        return self._shot_cache

    def shot_size(self, name: str) -> Optional[ShotSize]:
        key = norm(name)
        for s in self.shot_sizes:
            if key and (key in norm(s.name) or norm(s.name) in key):
                return s
        return None

    # ---- 负面约束 ----
    NEG_LIB = "review/16-负面约束总集.md"

    def negative_by_slot(self) -> Dict[str, List[str]]:
        """①–⑦ 每个要素的负面约束词（13 review/16）。"""
        text = read_text(self.file("13", self.NEG_LIB))
        out: Dict[str, List[str]] = {}
        rx = re.compile(r"^\|?\s*[>＞]?\s*[①②③④⑤⑥⑦]\s*([^|｜]+?)\s*[|｜]\s*(.+?)\s*[|｜]?\s*$")
        for ln in text.split("\n"):
            m = rx.match(ln.strip())
            if not m:
                continue
            slot = f"{ln.strip().lstrip('＞> ')[0]}{m.group(1).strip()}"
            words = [w.strip() for w in re.split(r"[，,、;；]", m.group(2)) if w.strip()]
            if words:
                out.setdefault(slot, [])
                for w in words:
                    if w not in out[slot]:
                        out[slot].append(w)
        return out

    def negative_base(self) -> List[str]:
        """全局底座负面词（13 review/16 的固定句库段）。"""
        text = read_text(self.file("13", self.NEG_LIB))
        out: List[str] = []
        for block in re.findall(r"```([\s\S]*?)```", text):
            for ln in block.split("\n"):
                ln = ln.strip().strip(",，")
                if not ln or len(ln) > 40:
                    continue
                if "：" in ln or ":" in ln or ln.startswith("#"):
                    continue
                out.extend(split_cn_list(ln))
        seen, uniq = set(), []
        for w in out:
            if w and w not in seen:
                seen.add(w)
                uniq.append(w)
        return uniq

    def negative_global_style(self) -> List[str]:
        """从 15-风格基准库 汇总所有基准的负面词追加（去重）。"""
        seen, out = set(), []
        for b in self.benchmarks.values():
            for w in b.negatives:
                if w not in seen:
                    seen.add(w)
                    out.append(w)
        return out

    # ---- 场景 ----
    def scene_dimensions(self) -> Dict[str, str]:
        """场景六维（04 scenes 的六个文件）。"""
        d = self.mod("04") / "scenes"
        out = {}
        for f in sorted(d.glob("*.md")):
            m = re.match(r"^(\d+)-(.+?)\.md$", f.name)
            if not m:
                continue
            out[m.group(1)] = m.group(2)
        return out

    # ---- 交付判据 ----
    def compliance_criteria(self) -> Dict[str, str]:
        """从 13 review/14 抽判据号 → 描述。"""
        text = read_text(self.file("13", "review/14-交付规格与合规判据.md"))
        out: Dict[str, str] = {}
        for ln in text.split("\n"):
            m = re.match(r"^\|\s*\*{0,2}([GTFL]\d+)\*{0,2}\s*\|\s*(.+?)\s*\|", ln)
            if m:
                out[m.group(1)] = m.group(2).strip()
        return out


@lru_cache(maxsize=4)
def load(root: Optional[str] = None) -> Bundle:
    return Bundle(root)
