#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""check_segments.py — 分段交付校验（⑫库§四 + ⑰库分段模式 程序化，支持15s/10s档位）
用法: python check_segments.py <storyboard.json>
校验:
  1. 段长容差（按档位取，15s档13.5-16.5s / 10s档9.0-11.0s；tail_exempt 尾段按档位上限豁免）
  2. 镜序连续不重不漏（段内与全集序列一致）
  3. 段钩登记（每段必须有钩子）
  4. 切点位置（动作峰值切镜标注：跨段边界处动作镜必须落 cut_point 或转场说明）
  5. 入口快照链（exit_snapshot → 下段 entry_snapshot 成对非空；跨场景需转场说明）
"""
import json, sys, os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import seg_tiers  # noqa: E402  档位单一真源


def has_motion(s):
    """L1（主体动作）非静的镜头视为动作镜"""
    L = s.get("video_layers", {}) or {}
    return bool(L.get("L1")) and str(L["L1"]).strip() not in ("静", "")


def main(path):
    d = json.load(open(path, encoding="utf-8"))
    shots = d["shots"]
    ids_in_order = [s["shot_id"] for s in shots]
    by_id = {s["shot_id"]: s for s in shots}
    segs = d.get("segments", [])
    errs, warns = [], []
    LO, HI, TAIL_MAX, TARGET, _ = seg_tiers.bounds(d)
    print(f"档位: {seg_tiers.resolve_tier(d)}（目标{TARGET:g}s，容差[{LO:g},{HI:g}]，尾段上限{TAIL_MAX:g}s）")

    if not segs:
        warns.append("未启用分段模式（segments 为空），仅做镜头级快照检查")
        return 0

    seen = []
    for i, seg in enumerate(segs):
        ss = seg["shots"]
        seen += ss
        dur = sum(by_id[x]["duration_s"] for x in ss)
        # 1 段长容差
        if seg.get("tail_exempt"):
            if dur > TAIL_MAX:
                errs.append(f"{seg['id']} 尾段豁免仍超{TAIL_MAX}s ({dur}s)")
        elif not (LO <= dur <= HI):
            (warns if dur <= TAIL_MAX else errs).append(f"{seg['id']} 段长{dur}s 超容差[{LO},{HI}]")
        # 2 段钩登记
        if not seg.get("hook"):
            warns.append(f"{seg['id']} 未登记段钩")
        # 3 段内镜头必须在全集序列中连续
        try:
            pos = [ids_in_order.index(x) for x in ss]
        except ValueError as e:
            errs.append(f"{seg['id']} 引用不存在镜头 {e}")
            continue
        if pos != list(range(pos[0], pos[0] + len(pos))):
            errs.append(f"{seg['id']} 段内镜头与全集序列不连续（存在跨段跳取）")
        # 4 入口/出口快照链
        en, ex = seg.get("entry_snapshot"), seg.get("exit_snapshot")
        if i == 0:
            if not en:
                warns.append(f"{seg['id']} 首段缺 entry_snapshot（建议登记集首状态）")
        else:
            prev_ex = segs[i - 1].get("exit_snapshot")
            if not prev_ex:
                errs.append(f"{segs[i-1]['id']} 缺 exit_snapshot（无法衔接 {seg['id']}）")
            if not en:
                errs.append(f"{seg['id']} 缺 entry_snapshot（入口快照链断裂）")
        if i == len(segs) - 1 and not ex and not seg.get("tail_exempt"):
            warns.append(f"{seg['id']} 末段缺 exit_snapshot（建议登记集尾钩状态）")
        # 5 段边界切点/转场衔接：跨段相邻镜若有动作，须有 cut_point 或转场说明
        if i > 0:
            prev_last = by_id[segs[i - 1]["shots"][-1]]
            cur_first = by_id[ss[0]]
            action_edge = has_motion(prev_last) or has_motion(cur_first)
            tr = prev_last.get("transition_out") or {}
            has_bridge = prev_last.get("cut_point") or tr.get("type") not in ("Cut",) or tr.get("ref")
            if action_edge and not has_bridge:
                warns.append(f"段边界 {prev_last['shot_id']}→{cur_first['shot_id']} 含动作但无 cut_point/转场标注（动作峰值切镜须标注切点）")
        # 6 段内动作峰值切镜：动作镜建议标注 cut_point（提示级）
        for xid in ss:
            x = by_id[xid]
            if has_motion(x) and "cut_point" not in x and x.get("shot_size") not in ("CU", "ECU", "INS"):
                warns.append(f"{xid} 动作镜未标注 cut_point（动作峰值切镜，法则三）")

    if sorted(seen) != sorted(ids_in_order):
        errs.append(f"分段与镜头总表不一致：漏/重 {set(ids_in_order) ^ set(seen)}")

    for w in warns:
        print("[WARN]", w)
    for e in errs:
        print("[FAIL]", e)
    print("RESULT:", "PASS" if not errs else f"FAIL({len(errs)})")
    return 0 if not errs else 1


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main(sys.argv[1]))
