#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""check_consistency.py — 元数据一致性门（v42，C1–C6）。

补自 regression.py 第 7 步登记的缺件。技能包的「手工同步点」必须机检一致：
加库/加卡/改判据后漏改同步点，由本门拦截。

    python check_consistency.py        # C1–C6 全跑
    python check_consistency.py --json

六项：
  C1 库文件在位        microexpression-library.md / transitions-library.md 存在且可解析出非空编号集
  C2 库编号连续无缺重  M01–M96 / T01–T100 逐号齐全、无重号
  C3 库与回退集等价    库解析集 == validate.py FALLBACK_M/FALLBACK_T（库件在位后机判行为不变）
  C4 机检清单编号齐    storyboard-schema.md §四 机检清单 1–15 项编号齐全
  C5 金标准与账本一致  examples E01–E05 + series_ledger_E01.json 在位、episode 编号互认、渲染基线目录在位
  C6 regression 依赖在位  regression.py 运行期引用的全部脚本实存（防再次缺件）

只依赖 Python 3.8+ 标准库；只读。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE) if os.path.basename(HERE) == "scripts" else HERE

sys.path.insert(0, HERE)
from validate import FALLBACK_M, FALLBACK_T, load_m_set, load_t_set  # noqa: E402


def parse_ids(path: str, pattern: str) -> dict:
    """从库文件表格逐行解析编号出现次数（取捕获组=编号本身）。"""
    cnt: dict = {}
    txt = open(path, encoding="utf-8").read()
    for m in re.finditer(pattern, txt):
        key = m.group(1)
        cnt[key] = cnt.get(key, 0) + 1
    return cnt


def main() -> int:
    ap = argparse.ArgumentParser(description="元数据一致性门（v42，C1–C6）")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    problems: list = []
    lines: list = []

    def check(cid: str, ok: bool, msg: str):
        lines.append(f"[{'PASS' if ok else 'FAIL'}] {cid} {msg}")
        if not ok:
            problems.append(f"{cid} {msg}")

    # C1 库文件在位
    m_path = os.path.join(ROOT, "microexpression-library.md")
    t_path = os.path.join(ROOT, "transitions-library.md")
    m_set, t_set = load_m_set(ROOT), load_t_set(ROOT)
    check("C1", os.path.isfile(m_path) and len(m_set) > 0,
          f"microexpression-library.md 在位（解析 {len(m_set)} 个 M 编号）")
    check("C1", os.path.isfile(t_path) and len(t_set) > 0,
          f"transitions-library.md 在位（解析 {len(t_set)} 个 T 编号）")

    # C2 编号连续无缺重（按库文件表格行解析，排除正文散提）
    m_cnt = parse_ids(m_path, r"(?m)^\|\s*(M\d{2})\s*\|") if os.path.isfile(m_path) else {}
    t_cnt = parse_ids(t_path, r"(?m)^\|\s*(T\d{1,3})\s*\|") if os.path.isfile(t_path) else {}
    for name, cnt, fb in (("M", m_cnt, FALLBACK_M), ("T", t_cnt, FALLBACK_T)):
        miss = sorted(fb - set(cnt))
        dup = sorted(k for k, v in cnt.items() if v > 1)
        extra = sorted(set(cnt) - fb)
        check("C2", not miss and not dup and not extra,
              f"{name} 库：{len(cnt)}/{len(fb)} 编号"
              + (f"；缺 {miss[:6]}" if miss else "")
              + (f"；重 {dup[:6]}" if dup else "")
              + (f"；超集 {extra[:6]}" if extra else ""))

    # C3 与回退集等价（库件引入不改变机判行为）
    check("C3", m_set == FALLBACK_M, f"M 解析集 == FALLBACK_M（{len(m_set)} 个）")
    check("C3", t_set == FALLBACK_T, f"T 解析集 == FALLBACK_T（{len(t_set)} 个）")

    # C4 机检清单编号齐（schema §四 表格 1–15 项）
    schema = os.path.join(ROOT, "storyboard-schema.md")
    if os.path.isfile(schema):
        txt = open(schema, encoding="utf-8").read()
        sec = txt.split("## 四、机检清单", 1)
        body = sec[1].split("## 五、", 1)[0] if len(sec) > 1 else ""
        rows = set(int(x) for x in re.findall(r"(?m)^\|\s*(\d{1,2})\s*\|", body))
        miss = sorted(set(range(1, 16)) - rows)
        check("C4", not miss, f"schema 机检清单 1–15 项{('；缺 ' + str(miss)) if miss else ' 齐全'}")
    else:
        check("C4", False, "storyboard-schema.md 缺失")

    # C5 金标准与账本
    ex = os.path.join(ROOT, "examples")
    e_files = [f"E{i:02d}_storyboard.json" for i in range(1, 6)]
    miss = [f for f in e_files if not os.path.isfile(os.path.join(ex, f))]
    check("C5", not miss, "E01–E05 金标准在位" + (f"；缺 {miss}" if miss else ""))
    ledger = os.path.join(ex, "series_ledger_E01.json")
    e01 = os.path.join(ex, "E01_storyboard.json")
    if os.path.isfile(ledger) and os.path.isfile(e01):
        led = json.load(open(ledger, encoding="utf-8"))
        # 账本 schema：顶层 updated_episode = 本账更新到的集；hook_ledger[].episode 为逐条集号
        le = led.get("updated_episode")
        hooks = [h.get("episode") for h in led.get("hook_ledger", []) if h.get("episode")]
        se = json.load(open(e01, encoding="utf-8")).get("episode")
        ok = (le == se) and (not hooks or all(h == se for h in hooks))
        check("C5", ok, f"账本 updated_episode({le}) 与 hook 条目集号 == E01 episode({se})")
    else:
        check("C5", False, "series_ledger_E01.json 或 E01_storyboard.json 缺失")
    baseline = os.path.join(ex, "E01_render_out")
    check("C5", os.path.isdir(baseline), "E01 渲染基线目录（regression diff 依赖）在位")

    # C6 regression.py 运行期引用的脚本实存（防再次缺件——v1.1.5 实测教训）
    reg = os.path.join(HERE, "regression.py")
    refs = sorted(set(re.findall(r"os\.path\.join\(HERE,\s*[\"']([\w\-]+\.py)[\"']", open(reg, encoding="utf-8").read())))
    for r in refs:
        check("C6", os.path.isfile(os.path.join(HERE, r)), f"regression 依赖 scripts/{r} 在位")
    if not refs:
        check("C6", False, "regression.py 未解析到脚本引用（引用写法变更，请人工核对）")

    if args.json:
        print(json.dumps({"problems": problems, "checks": lines}, ensure_ascii=False, indent=1))
    else:
        print("\n".join(lines))
        print("结论：" + ("PASS · 元数据一致" if not problems else f"FAIL（{len(problems)} 项）——加库/加卡后漏改同步点"))
    return 0 if not problems else 1


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
