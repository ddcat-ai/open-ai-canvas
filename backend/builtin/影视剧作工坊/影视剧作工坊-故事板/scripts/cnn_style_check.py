#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""cnn_style_check.py — 卷积校验评分门（v43，㊴库文本规则仿真）。

补自 regression.py 第 5 步登记的缺件。母源规则：13 `review/16-负面约束总集.md`
所引 conv-validation-library.md 三张禁止特征表（文档 34–36），加 validate.py
18d 同一张导演卡黑名单表做「导演卡允许清单优先」语境豁免。

    python cnn_style_check.py <storyboard.json> [--json] [--line 90]

评分 0–100，≥放行线（默认 90）判「放行」退出码 0，否则「返修」退出码 1。
--json 输出 {"episode_score", "verdict", "line", "card", "deductions"}（regression 消费）。
文本规则仿真，非神经网络：锚点词表全部来自包内文档，只读不写。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE) if os.path.basename(HERE) == "scripts" else HERE

# ---- 禁止特征锚点表（13 review/16 文档 34–36 原文转录；每类命中扣 3 分）----
BAN_TABLES = [
    ("卡通二次元/描边勾线/塑胶假脸/过度磨皮/色带（文档34）", [
        ["卡通", "二次元", "动漫风", "赛璐璐"],
        ["描边", "勾线", "粗黑轮廓"],
        ["塑胶", "蜡像", "塑料感", "硅胶"],
        ["磨皮", "瓷肌", "无毛孔", "水光肌"],
        ["色带", "断层", "banding"],
    ]),
    ("高饱和/霓虹/死黑/过曝/渐变断裂（文档35）", [
        ["高饱和", "浓艳", "饱和度过高", "荧光"],
        ["霓虹", "赛博", "镭射"],                      # 卡四（王家卫）语境豁免
        ["死黑", "纯黑一片", "暗部无细节"],
        ["过曝", "死白", "高光溢出"],
        ["色彩断层", "渐变断裂"],
    ]),
    ("构图失衡/夸张表演（文档36）", [
        ["构图混乱", "倾斜失控"],
        ["嘶吼", "疯笑", "狰狞"],
    ]),
]
BAN_COST = 3            # 每类每锚点组命中扣分（同类多次命中不叠加）
BLACKLIST_COST = 8      # 挂卡黑名单词命中扣分（同 validate.py 18d 同源）

# 与 validate.py DIRECTOR_CARDS 同一张卡表（语境豁免与黑名单共用）
DIRECTOR_CARDS = {
    "卡四": {"name": "王家卫", "keys": ["王家卫", "Wong Kar-wai", "卡四"],
             "allow_neon": True},
    "卡一": {"name": "诺兰", "keys": ["诺兰", "Nolan", "卡一"]},
    "卡二": {"name": "陈凯歌", "keys": ["陈凯歌", "Chen Kaige", "卡二"]},
    "卡三": {"name": "张艺谋", "keys": ["张艺谋", "Zhang Yimou", "卡三"]},
    "卡五": {"name": "维伦纽瓦", "keys": ["维伦纽瓦", "Villeneuve", "卡五"]},
    "卡六": {"name": "韦斯·安德森", "keys": ["韦斯", "Wes Anderson", "卡六"]},
    "卡七": {"name": "塔尔科夫斯基", "keys": ["塔尔科夫斯基", "Tarkovsky", "卡七"]},
}


def load_card(style_base: str, prefix_full: str) -> str:
    """从 shared.style_base（回退 prefix_full）确定当前挂卡——语境豁免的判定前提。"""
    hay = f"{style_base or ''} {prefix_full or ''}"
    for ck, c in DIRECTOR_CARDS.items():
        if any(k in hay for k in c["keys"]):
            return ck
    return ""


def shot_text(s: dict) -> str:
    """单镜正向描述文本（不含负面词表——负面词声明禁令不是违规）。"""
    parts: list = []
    vl = s.get("visual_layers") or {}
    parts += [vl.get(k) or "" for k in ("fg", "mg", "bg")]
    for k in ("silhouette", "vo", "action_note", "motive_note"):
        if s.get(k):
            parts.append(str(s[k]))
    cm = s.get("camera_move") or {}
    if cm.get("motive"):
        parts.append(str(cm["motive"]))
    for dl in s.get("dialogue", []) or []:
        parts.append(str(dl.get("text", "")))
    for k in ("sfx", "props"):
        parts += [str(x) for x in (s.get(k) or [])]
    return " ".join(parts)


def main() -> int:
    ap = argparse.ArgumentParser(description="卷积校验评分门（㊴库文本规则仿真，v43）")
    ap.add_argument("storyboard")
    ap.add_argument("--json", action="store_true", help="输出 JSON（regression 消费）")
    ap.add_argument("--line", type=int, default=90, help="放行线（默认 90）")
    args = ap.parse_args()

    if not os.path.isfile(args.storyboard):
        print(f"找不到文件：{args.storyboard}", file=sys.stderr)
        return 1
    d = json.load(open(args.storyboard, encoding="utf-8"))
    sh = d.get("shared", {})
    card = load_card(str(sh.get("style_base") or ""), str(sh.get("prefix_full") or ""))

    # 扫描面：shared 正向声明 + 逐镜正向描述（排除 negative_global——那是禁令清单本身）
    base_text = " ".join(str(sh.get(k) or "") for k in ("prefix_full", "lighting_ratio", "style_base"))
    texts = [base_text] + [shot_text(s) for s in d.get("shots", [])]
    full = " ".join(texts)
    full_l = full.lower()

    deductions: list = []
    score = 100

    # ① 禁止特征锚点（每锚点组命中一次扣 BAN_COST；卡四豁免霓虹类——王家卫卡合法风格词）
    for table, groups in BAN_TABLES:
        for anchors in groups:
            hit = None
            for a in anchors:
                if a in full or a.lower() in full_l:
                    # 卡四语境豁免（文档35：「霓虹」非王家卫卡语境才禁）
                    if card == "卡四" and anchors is BAN_TABLES[1][1]:
                        continue
                    hit = a
                    break
            if hit:
                deductions.append(f"-{BAN_COST} 「{table}」命中锚点「{hit}」")
                score -= BAN_COST

    # ② 挂卡黑名单（validate.py 18d 同源词表；在卡语境下这些词就是冲突）
    ck = None
    for k, c in DIRECTOR_CARDS.items():
        if any(w in f"{sh.get('style_base') or ''}" for w in c["keys"]):
            ck = k
            break
    if ck:
        sys.path.insert(0, HERE)
        try:
            from validate import DIRECTOR_CARDS as _DC
            bl = _DC[ck]["blacklist"]
        except Exception:
            bl = []
        for w in bl:
            if w in full:
                deductions.append(f"-{BLACKLIST_COST} 挂卡{ck}（{DIRECTOR_CARDS[ck]['name']}）黑名单词「{w}」")
                score -= BLACKLIST_COST

    # ③ 符号堆砌需 ㊲ 符号库（未随包）——如实标注跳过，不假装能判
    symbol_note = "符号堆砌判据需㊲符号库（未随包），跳过"

    score = max(0, score)
    verdict = "放行" if score >= args.line else "返修"
    ep = d.get("episode", "?")
    if args.json:
        print(json.dumps({"episode": ep, "episode_score": score, "verdict": verdict,
                          "line": args.line, "card": card or "无挂卡",
                          "deductions": deductions, "note": symbol_note},
                         ensure_ascii=False))
    else:
        print(f"卷积校验（㊴库文本规则仿真）{ep}：挂卡 {card or '无'}，放行线 {args.line}")
        for x in deductions:
            print("  " + x)
        print("  " + symbol_note)
        print(f"得分 {score} → {verdict}")
    return 0 if score >= args.line else 1


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
