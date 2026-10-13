#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""mutation_test.py — mutation 抓捕率门（v38）。

补自 regression.py 第 6 步登记的缺件。防「声称≠实现」与回滚无人察觉：
把已知缺陷逐一注入金标准 E01 的**临时副本**，逐个跑 validate.py，
缺陷必须全部被机检捕获（退出码非 0）才算门过。

    python mutation_test.py            # 全部注入用例
    python mutation_test.py --json     # 输出 JSON 摘要

只依赖 Python 3.8+ 标准库；不改金标准原件。
"""
from __future__ import annotations

import argparse
import copy
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
GOLDEN = os.path.join(os.path.dirname(HERE), "examples", "E01_storyboard.json")


def run_validate(path: str):
    p = subprocess.run([sys.executable, os.path.join(HERE, "validate.py"), path],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    return p.returncode, (p.stdout or "") + (p.stderr or "")


# ---- 注入器：d=金标准深拷贝 dict；返回注入说明 ----

def m1_8s红线(d):
    d["shots"][0]["duration_s"] = 9.0
    return f"{d['shots'][0]['shot_id']} duration_s → 9.0（平台硬红线 8s）"


def m2_动镜无动机(d):
    for s in d["shots"]:
        if (s.get("camera_move") or {}).get("type") == "Static":
            s["camera_move"] = {"type": "Pan", "motive": None}
            return f"{s['shot_id']} camera_move Static→Pan 且 motive=None（法则九）"
    return None


def m3_资产引用悬空(d):
    for s in d["shots"]:
        if s.get("assets"):
            old = s["assets"][0]
            s["assets"][0] = "SC-999-X"
            return f"{s['shot_id']} assets {old}→SC-999-X（不在资产表）"
    return None


def m4_微表情编号非法(d):
    for s in d["shots"]:
        if s.get("shot_size") in ("CU", "ECU", "MCU"):
            s["micro_expr"] = "M99"
            return f"{s['shot_id']} micro_expr→M99（不在 M01–M96 库）"
    return None


def m5_微表情重复(d):
    src = next((s for s in d["shots"] if s.get("micro_expr")), None)
    if not src:
        return None
    for s in d["shots"]:
        if s is not src and s.get("shot_size") in ("CU", "ECU", "MCU") and not s.get("micro_expr"):
            s["micro_expr"] = src["micro_expr"]
            return f"{s['shot_id']} micro_expr 复用 {src['micro_expr']}（全集重复）"
    return None


def m6_非画外对白缺口型(d):
    for s in d["shots"]:
        if s.get("dialogue"):
            s["dialogue"].append({"who": "注入", "text": "缺陷注入台词。", "offscreen": False})
            return f"{s['shot_id']} 追加非画外对白且无 lip（⑫库三轨制）"
    d["shots"][0]["dialogue"] = [{"who": "注入", "text": "缺陷注入台词。", "offscreen": False}]
    return f"{d['shots'][0]['shot_id']} 注入非画外对白且无 lip"


def m7_转场引用非法(d):
    for s in d["shots"]:
        tr = s.get("transition_out") or {}
        if tr.get("type"):
            s["transition_out"] = {"type": "Fade", "ref": "T999"}
            return f"{s['shot_id']} transition_out→Fade/T999（非直切须引用库内 T 编号）"
    return None


def m8_口型A超额(d):
    n = 0
    for s in d["shots"]:
        if n < 5:
            s["lip_sync"] = "A"
            n += 1
    return "前 5 镜 lip_sync→A（⑫库口型A名额 ≤3）"


def m9_段边界断裂(d):
    segs = d.get("segments") or []
    if not segs or not segs[0].get("shots"):
        return None
    gone = segs[0]["shots"].pop()
    return f"segments[0] 摘除 {gone}（覆盖不连续）"


def m10_总时长偏差(d):
    tl = d.get("timeline", {})
    if tl.get("content_s") is None:
        return None
    tl["content_s"] = round(tl["content_s"] * 1.3, 1)
    return f"timeline.content_s→{tl['content_s']}（±5% 偏差超限）"


def m11_隔级切豁免删除(d):
    """v1.1.6 规则回归锁：删掉已豁免 pair 后者的 transition_note → 级差0/1 必须被抓。"""
    for s in d["shots"]:
        if s.get("transition_note"):
            gone = s.pop("transition_note")
            return f"{s['shot_id']} 摘除 transition_note（{gone[:14]}…）→ 隔级切无豁免必须 FAIL"
    return None


MUTATIONS = [
    ("8s红线", m1_8s红线), ("动镜无动机", m2_动镜无动机), ("资产引用悬空", m3_资产引用悬空),
    ("微表情编号非法", m4_微表情编号非法), ("微表情重复", m5_微表情重复),
    ("非画外对白缺口型", m6_非画外对白缺口型), ("转场引用非法", m7_转场引用非法),
    ("口型A超额", m8_口型A超额), ("段边界断裂", m9_段边界断裂),
    ("总时长偏差", m10_总时长偏差), ("隔级切豁免删除", m11_隔级切豁免删除),
]


def main() -> int:
    ap = argparse.ArgumentParser(description="mutation 抓捕率门（v38）：注入缺陷必须全部被机检捕获")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    if not os.path.isfile(GOLDEN):
        print(f"金标准缺失：{GOLDEN}", file=sys.stderr)
        return 1
    golden = json.load(open(GOLDEN, encoding="utf-8"))
    tmp = tempfile.mkdtemp(prefix="mutation_")
    results, leaks = [], 0
    try:
        for name, inj in MUTATIONS:
            d = copy.deepcopy(golden)
            desc = inj(d)
            if desc is None:
                results.append((name, "SKIP", "本集无可注入对象"))
                continue
            p = os.path.join(tmp, f"m_{name}.json")
            json.dump(d, open(p, "w", encoding="utf-8"), ensure_ascii=False)
            rc, out = run_validate(p)
            caught = rc != 0
            if not caught:
                leaks += 1
            results.append((name, "抓捕" if caught else "漏抓", desc))
            print(f"[{'PASS' if caught else 'LEAK'}] {name}：{desc}")
        total = sum(1 for r in results if r[1] != "SKIP")
        print(f"—— 抓捕率 {total - leaks}/{total}（漏抓 {leaks}）")
        if args.json:
            print(json.dumps({"total": total, "leaks": leaks,
                              "results": [{"name": n, "verdict": v, "desc": x} for n, v, x in results]},
                             ensure_ascii=False))
        return 0 if leaks == 0 else 1
    finally:
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
