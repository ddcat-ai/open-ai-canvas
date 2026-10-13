#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""全包完整性自检（打包纪律的机判层）。

检查面：
  1. 模块目录：01–13 数字模块连续 + 引擎 + 故事板 + 路由 三件支撑层
  2. SKILL.md：每模块存在、frontmatter 含 name/description
  3. 基础引擎：02–11 各模块 engine/E0X 存在；条目数对照路由表声明（计数为启发式，偏差标 WARN）
  4. 机判词表源文件：脚本运行时读取的包内文件全部在位
  5. 导入冒烟：wfkit 全模块可导入
"""
from __future__ import annotations

import importlib
import json
import re
from dataclasses import dataclass, field
import sys
from pathlib import Path
from typing import List, Optional

from .assets import Bundle

REQUIRED_DIRS = [f"影视剧作工坊-{i:02d}-" for i in range(1, 14)] + \
                ["影视剧作工坊-引擎", "影视剧作工坊-故事板", "影视剧作工坊-路由"]

WORDLIST_FILES = [
    ("02", "style/01-电影风格条目.md"), ("02", "style/02-调色板.md"),
    ("02", "style/03-调色情绪.md"), ("02", "style/06-导演风格库.md"),
    ("03", "render/01-视觉意图四维本体.md"), ("03", "render/02-风格组合矩阵.md"),
    ("03", "render/10-风格融合与冲突检测.md"),
    ("04", "characters/15-风格基准库.md"), ("04", "characters/17-微表情基准-100组面部表情.md"),
    ("04", "characters/19-标准角色提示词输出模板.md"),
    ("04", "scenes/01-场景风格通道.md"), ("04", "scenes/03-全气候光照库.md"),
    ("06", "shotlang/01-景别.md"), ("06", "shotlang/06-焦距库.md"),
    ("07", "shotlist/03-剧本创作工作室·精华提炼.md"),
    ("08", "moves/09-镜头运动预设库.md"),
    ("09", "audio/04-口型对白匹配.md"),
    ("10", "editing/01-规划层-连通分镜清单.md"), ("10", "editing/02-提示词层-单条内部组接.md"),
    ("11", "review/01-导演复检评分rubric.md"),
    ("13", "review/14-交付规格与合规判据.md"),
    ("13", "review/16-负面约束总集.md"),
    ("12", "prompt/20-seedance2.0-prompt-skill本体.md"), ("12", "platform/03-即梦视频生成模式与提示词规格.md"),
    ("12", "platform/10-即梦生图提示词规格.md"),
    ("04", "references/jimeng-seedream-adaptation.md"),
    ("12", "platform/11-即梦生图风格基准库.md"),
    ("12", "platform/12-通用交付规格.md"),
    ("12", "platform/13-通用交付模板库.md"),
]

WFKIT_MODULES = ["assets", "axis", "style", "render", "scene", "frame", "performance",
                 "shotlist", "shots", "lens", "moves", "audio", "delivery", "compliance",
                 "review", "jimeng_t2i", "cli"]

ENGINE_CLAIMS = {"02": 57, "03": 12, "04": 42, "05": 44, "06": 64,
                 "07": 48, "08": 60, "09": 20, "10": 41, "11": 66}


@dataclass
class IntegrityReport:
    ok: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return not self.errors

    def summary(self) -> str:
        L = ["结论：PASS · 全包完整" if self.passed else f"结论：FAIL（{len(self.errors)} 项）"]
        L += ["[PASS ] " + x for x in self.ok]
        L += ["[WARN ] " + x for x in self.warnings]
        L += ["[FAIL ] " + x for x in self.errors]
        return "\n".join(L)


def run(bundle: Optional[Bundle] = None) -> IntegrityReport:
    rep = IntegrityReport()
    b = bundle or Bundle()
    root = b.root

    # 0. 运行环境（影响执行的前置项）
    if sys.version_info < (3, 8):
        rep.errors.append(f"Python {sys.version_info.major}.{sys.version_info.minor} 过旧——脚本要求 3.8+")
    else:
        rep.ok.append(f"Python {sys.version_info.major}.{sys.version_info.minor}（要求 3.8+）")
    enc = getattr(sys.stdout, "encoding", "") or ""
    if enc.lower().replace("-", "") != "utf8":
        rep.warnings.append(f"stdout 编码为 {enc}（非 UTF-8）——cli.main 已强制 reconfigure，"  
                            "绕过 cli.main 直调各模块时中文符号可能崩，建议 PYTHONIOENCODING=utf-8")

    # 0.5 包版本戳
    pv = Path(root) / "PKG_VERSION.json"
    if pv.is_file():
        try:
            meta = json.loads(pv.read_text(encoding="utf-8"))
            rep.ok.append(f"包版本 {meta.get('version')}（{meta.get('built')}，{meta.get('name')}）")
        except Exception as e:
            rep.errors.append(f"PKG_VERSION.json 解析失败：{e}")
    else:
        rep.errors.append("包根缺 PKG_VERSION.json——版本未统一")

    # 1. 模块目录
    dirs = [d.name for d in Path(root).iterdir() if d.is_dir()]
    for req in REQUIRED_DIRS:
        hit = next((d for d in dirs if d.startswith(req)), None)
        if hit:
            rep.ok.append(f"模块目录在位：{hit}")
        else:
            rep.errors.append(f"缺模块目录：{req}*")

    # 2. SKILL.md + frontmatter
    for d in sorted(dirs):
        sk = Path(root) / d / "SKILL.md"
        if not sk.is_file():
            rep.errors.append(f"{d}/SKILL.md 缺失")
            continue
        head = sk.read_text(encoding="utf-8", errors="replace")[:600]
        if re.match(r"^---\s*\n", head) and "name:" in head and "description:" in head:
            rep.ok.append(f"{d} frontmatter 齐备")
        else:
            rep.errors.append(f"{d} SKILL.md frontmatter 不完整（缺 name/description）")

    # 3. 引擎层 02–11
    for mod, claim in ENGINE_CLAIMS.items():
        mod_dir = next((dd for dd in dirs if f"-{mod}-" in dd), None)
        eng = None
        if mod_dir:
            cands = sorted((Path(root) / mod_dir / "engine").glob("E%s-*.md" % mod))
            eng = cands[0] if cands else None
        if not eng:
            rep.errors.append(f"模块 {mod} 缺 engine/E{mod}")
            continue
        t = eng.read_text(encoding="utf-8", errors="replace")
        n = len(re.findall(r"^###\s", t, re.M)) or len(re.findall(r"^\d+[.、]", t, re.M))
        if n == 0:
            rep.warnings.append(f"模块 {mod} 引擎条目计数失败（启发式不匹配）——人工核对 {eng.name}")
        elif abs(n - claim) <= max(2, claim * 0.1):
            rep.ok.append(f"模块 {mod} 引擎条目 ≈{n}（路由表声明 {claim}，偏差在容差内）")
        else:
            rep.warnings.append(f"模块 {mod} 引擎条目计数 {n} 与路由表声明 {claim} 偏差较大——"
                                "计数为启发式，请人工核对（引擎文件与路由表版本是否同步）")

    # 4. 词表源文件
    for mod, rel in WORDLIST_FILES:
        try:
            b.file(mod, rel)
            rep.ok.append(f"词表在位：{mod}/{rel}")
        except FileNotFoundError:
            rep.errors.append(f"机判词表缺失：模块 {mod} 的 {rel}")

    # 5. 导入冒烟
    for m in WFKIT_MODULES:
        try:
            importlib.import_module("wfkit." + m)
            rep.ok.append(f"wfkit.{m} 导入 OK")
        except Exception as e:  # noqa: BLE001
            rep.errors.append(f"wfkit.{m} 导入失败：{e}")
    return rep
