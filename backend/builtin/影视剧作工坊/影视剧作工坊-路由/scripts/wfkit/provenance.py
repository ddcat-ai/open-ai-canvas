#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""原始文档出处工具：引文扫描 / 出处包构建 / 母源检索。只读母源，不写回。

三个动作：
  · scan   —— 扫描包内全部「来源/落位说明」引文（出处清单）
  · build  —— 收集已登记母源里的原始文档（去重）+ MANIFEST 引文对照 → 打 zip
  · check  —— 校验一个已打好的出处包（MANIFEST 在位、覆盖统计）
  · find   —— 在已登记母源里检索关键词（文件/行号/上下文）

检索源登记：包根 `sources.json`（name → 本地用户配置的路径）；默认不绑定任何机器目录。
"""
from __future__ import annotations

import hashlib, json, os, re, time, zipfile
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from .assets import Bundle

SKIP_EXT = {".pyc", ".pyo", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".mp4", ".mov",
            ".zip", ".exe", ".dll", ".bin"}
MAX_FILE = 20 * 1024 * 1024

DEFAULT_ROOTS = []

CITE_RE = re.compile(r"来源：([^\n]+)|来源压缩包：([^\n]+)|来源技能包：([^\n]+)")


# ---------------------------------------------------------------- 登记表

def load_roots(bundle: Bundle, extra: Optional[List[str]] = None) -> List[Tuple[str, str]]:
    """检索源登记：优先读取包根 sources.json；未配置时无默认源。extra 为追加目录。"""
    roots: List[Tuple[str, str]] = []
    cfg = Path(bundle.root) / "sources.json"
    if cfg.is_file():
        data = json.loads(cfg.read_text(encoding="utf-8"))
        for item in (data.get("sources") or []):
            roots.append((item.get("name", "?"), item.get("path", "")))
    else:
        roots = list(DEFAULT_ROOTS)
    for p in (extra or []):
        roots.append((f"临时源-{os.path.basename(p.rstrip(chr(92)))}", p))
    return [(n, p) for n, p in roots if os.path.isdir(p)]


# ---------------------------------------------------------------- 引文扫描

def scan_citations(bundle: Bundle) -> Dict[str, List[str]]:
    """扫描包内全部 .md 的「来源/来源压缩包/来源技能包」引文。返回 来源 → 引用文件列表。"""
    cites: Dict[str, List[str]] = {}
    root = Path(bundle.root)
    for dp, dn, fn in os.walk(root):
        dn[:] = [d for d in dn if d != "__pycache__"]
        for f in fn:
            if not f.endswith(".md"): continue
            fp = os.path.join(dp, f)
            rel = os.path.relpath(fp, root).replace("\\", "/")
            try: t = open(fp, encoding="utf-8", errors="ignore").read()
            except OSError: continue
            for m in CITE_RE.finditer(t):
                s = (m.group(1) or m.group(2) or m.group(3)).strip().rstrip("。")
                s = re.sub(r"^[ `>*]+", "", s)[:80]
                if s and "Niagara" not in s and not s.startswith("C:\\"):
                    cites.setdefault(s, []).append(rel)
    return cites


# ---------------------------------------------------------------- 母源检索（find）

def find_text(roots: List[Tuple[str, str]], needle: str, book: str = "",
              max_hits: int = 20) -> List[dict]:
    """在已登记母源里检索关键词。返回 [{source, file, line, context}, ...]。"""
    out: List[dict] = []
    low = needle.lower()
    for tag, root in roots:
        for dp, dn, fn in os.walk(root):
            dn[:] = [d for d in dn if d != "__pycache__"]
            for f in fn:
                if os.path.splitext(f)[1].lower() not in (".md", ".txt", ".json", ".yaml"): continue
                if book and book.lower() not in f.lower() and book.lower() not in dp.lower(): continue
                fp = os.path.join(dp, f)
                try:
                    if os.path.getsize(fp) > MAX_FILE: continue
                    t = open(fp, encoding="utf-8", errors="ignore").read()
                except OSError: continue
                if low not in t.lower(): continue
                for i, ln in enumerate(t.splitlines(), 1):
                    if low in ln.lower():
                        out.append({"source": tag, "file": os.path.relpath(fp, root),
                                    "line": i, "context": ln.strip()[:160]})
                        if len(out) >= max_hits:
                            return out
    return out


# ---------------------------------------------------------------- 出处包构建

def _find_match(cite: str, collected: List[Tuple[str, str, int]]) -> List[str]:
    names = re.findall(r"[`“”\"]([\w\-\u4e00-\u9fff]+\.[a-z]{2,4})", cite)
    hits: List[str] = []
    for nm in names:
        hits += [p for _, p, _ in collected if p.endswith(nm) or ("/" + nm) in p]
    if hits: return hits[:3]
    key = re.sub(r"[ `*／/].*$", "", cite)[:16]
    if len(key) < 4: key = cite[:12]
    hits = [p for _, p, _ in collected if key in p]
    if not hits:
        hits = [p for _, p, _ in collected if cite[:10] in p]
    return hits[:3]


def build(bundle: Bundle, out_zip: str, roots: Optional[List[Tuple[str, str]]] = None,
          stage_dir: Optional[str] = None) -> dict:
    """收集母源原始文档（去重）→ MANIFEST 引文对照 → 打 zip。返回统计。"""
    roots = roots or load_roots(bundle)
    stage = stage_dir or os.path.join(os.environ.get("TEMP", "/tmp"), "_provenance_stage")
    if os.path.isdir(stage): shutil.rmtree(stage, ignore_errors=True)

    cites = scan_citations(bundle)
    seen: Dict[str, bool] = {}
    collected: List[Tuple[str, str, int]] = []
    dup = 0
    for tag, root in roots:
        for dp, dn, fn in os.walk(root):
            for f in fn:
                if os.path.splitext(f)[1].lower() in SKIP_EXT: continue
                fp = os.path.join(dp, f)
                try:
                    if os.path.getsize(fp) > MAX_FILE: continue
                    data = open(fp, "rb").read()
                except OSError: continue
                h = hashlib.md5(data).hexdigest()
                if h in seen: dup += 1; continue
                seen[h] = True
                rel_in_root = os.path.relpath(fp, root)
                dst = os.path.join(stage, tag, rel_in_root)
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                open(dst, "wb").write(data)
                collected.append((tag, os.path.join(tag, rel_in_root).replace("\\", "/"), len(data)))
    total_mb = sum(s for _, _, s in collected) / 1048576

    lines = ["# 影视剧作工坊 · 原始文档出处包 MANIFEST", "",
             f"- 打包时间：{time.strftime('%Y-%m-%d %H:%M')}",
             f"- 对应技能包版本：见 PKG_VERSION.json",
             f"- 收集文件：{len(collected)} 个唯一文件，{total_mb:.1f} MB（同内容去重 {dup} 个副本）", "",
             "## 检索根（原始位置）", ""]
    for tag, root in roots:
        lines.append(f"- **{tag}**：`{root}`")
    lines += ["", f"## 引文 → 收集文件对照（包内 {len(cites)} 个来源）", ""]
    covered = 0
    for cite in sorted(cites):
        hits = _find_match(cite, collected)
        users = sorted(cites[cite])
        if hits: covered += 1
        lines.append(f"- **{cite[:70]}**")
        lines.append(f"  - 引用处：{'、'.join(users[:3])}{'…' if len(users) > 3 else ''}")
        lines.append(f"  - 收集命中：{'；'.join(h[:70] for h in hits) if hits else '未命中（上游内部引用/母书章节名/用户测试图）'}")
    lines += ["", f"## 覆盖统计：{covered}/{len(cites)} 条引文命中收集文件", "", "## 文件清单", ""]
    for tag, p, s in sorted(collected):
        lines.append(f"- {p}（{s:,} B）")
    open(os.path.join(stage, "MANIFEST.md"), "w", encoding="utf-8", newline="").write("\n".join(lines))

    if os.path.exists(out_zip): os.remove(out_zip)
    zout = zipfile.ZipFile(out_zip, "w", zipfile.ZIP_DEFLATED)
    n = 0
    for dp, dn, fn in os.walk(stage):
        for f in sorted(fn):
            fp = os.path.join(dp, f)
            zout.write(fp, os.path.relpath(fp, stage).replace("\\", "/"))
            n += 1
    zout.close()
    return {"files": len(collected), "dups": dup, "citations": len(cites),
            "covered": covered, "zip_entries": n, "size_mb": round(os.path.getsize(out_zip) / 1048576, 1),
            "out": out_zip}


def check(zip_path: str) -> dict:
    """校验一个出处包：MANIFEST 在位、条目数、覆盖统计复述。"""
    z = zipfile.ZipFile(zip_path)
    names = z.namelist()
    ok = "MANIFEST.md" in names
    cov = ""
    if ok:
        man = z.read("MANIFEST.md").decode("utf-8")
        m = re.search(r"覆盖统计：(\d+)/(\d+)", man)
        if m: cov = f"引文命中 {m.group(1)}/{m.group(2)}"
    bad = z.testzip()
    return {"entries": len(names), "manifest": ok, "coverage": cov,
            "integrity": "OK" if bad is None else f"损坏:{bad}"}
