#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wfkit 命令行。

用法示例：
  python chain.py assets
  python chain.py bench Q
  python chain.py axis "首尾帧，即梦，出一段宫廷夜戏"
  python chain.py plan "一键交付，文生视频"
  python chain.py frame spec.json
  python chain.py keyframes pair.json
  python chain.py delivery spec.json --mode t2v --audio no-bgm
  python chain.py check out.txt --mode t2v --audio full
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import assets as A
from . import axis as AX
from . import compliance as CP
from . import delivery as DL
from . import frame as FR
from . import style as ST
from . import render as RD
from . import scene as SC
from . import performance as PF
from . import shotlist as SL
from . import audio as AU
from . import review as RV
from . import moves as MV
from . import provenance as PV
from . import shots as SH
from . import jimeng_t2i as JT
from . import lens as LN
from .assets import AudioTracks


# ---------------------------------------------------------------- helpers

def _load_json(p: str) -> dict:
    path = Path(p)
    if not path.is_file():
        raise SystemExit(f"找不到文件：{p}")
    return json.loads(path.read_text(encoding="utf-8-sig"))


def _tracks(spec: dict, mode_arg: str) -> AudioTracks:
    t = AudioTracks(
        dialogue=spec.get("dialogue", ""),
        ambient=spec.get("ambient", ""),
        bgm=spec.get("bgm", ""),
        profile=AudioTracks.PROFILE_NO_BGM if mode_arg == "no-bgm" else AudioTracks.PROFILE_FULL,
    )
    return t


def _parse_seconds(v) -> float:
    """把 '5s' / '5秒' / '3.5' / 5 统一成秒数；解析不了返回 0。"""
    if isinstance(v, (int, float)):
        return float(v)
    m = __import__("re").search(r"(\d+(?:\.\d+)?)", str(v or ""))
    return float(m.group(1)) if m else 0.0


# ---------------------------------------------------------------- 命令

def cmd_assets(args) -> int:
    b = A.load(args.root)
    print(f"包根：{b.root}")
    print(f"角色风格基准：{len(b.benchmarks)} 条  {', '.join(sorted(b.benchmarks))}")
    print(f"景别：{len(b.shot_sizes)} 种  {', '.join(s.name.split('（')[0] for s in b.shot_sizes)}")
    nb = b.negative_by_slot()
    print(f"分要素负面词：{len(nb)} 组  " + "  ".join(f"{k}({len(v)})" for k, v in list(nb.items())[:7]))
    print(f"全局底座负面词：{len(b.negative_base())} 条")
    print(f"风格负面词追加（汇总）：{len(b.negative_global_style())} 条")
    print(f"场景层文件：{len(b.scene_dimensions())} 个")
    crit = b.compliance_criteria()
    print(f"合规判据：{len(crit)} 条  {', '.join(crit)}")
    return 0


def cmd_bench(args) -> int:
    b = A.load(args.root)
    if not args.code:
        routes = b.benchmark_routes()
        print("基准选择速查（题材 → 主基准）：")
        for k, v in routes.items():
            print(f"  {k}  →  {v}")
        return 0
    bm = b.benchmark(args.code)
    print(bm)
    if bm.applicable:
        print(f"适用：{bm.applicable}")
    if bm.transcribe_note:
        print(f"转写提示：{bm.transcribe_note}")
    for k, v in bm.dims.items():
        print(f"  {k}：{v}")
    if bm.keywords:
        print(f"质感关键词：{bm.keywords}")
    if bm.negatives:
        print("负面词追加：" + "、".join(bm.negatives))
    return 0


def cmd_axis(args) -> int:
    ax = AX.FourAxis.resolve(args.text)
    print(ax.describe())
    probs = ax.check_mutex()
    for p in probs:
        print("  ⚠ " + p)
    if ax.defaults_equivalent:
        print("  （四轴全默认 ≡ 什么都没声明）")
    if ax.needs_frame:
        print(f"  → 需 04 先出 {ax.frame_count} 张单帧图（{AX.VIDEO_SUBMODES[ax.video_submode]}）")
    if args.json:
        print(json.dumps(ax.to_dict(), ensure_ascii=False, indent=2))
    return 0


def cmd_plan(args) -> int:
    tp = AX.TriggerPlan.plan(args.text)
    print(tp.describe())
    return 0


def cmd_frame(args) -> int:
    b = A.load(args.root)
    spec = _load_json(args.spec)
    f = FR.build_frame(b, spec)
    print("── 单帧图（连缀形态）──")
    print(f.render())
    print()
    print("── 单帧图（字段形态）──")
    print(f.render_block())
    errs = f.check()
    warns = FR.style_conflicts(b, spec.get("style", ""), spec.get("style_mix"),
                               spec.get("appearance", {}).get("costume", "")) \
        if spec.get("style") else []
    if errs or warns or f.appearance.missing_layers():
        print()
        if errs:
            print("自检：")
            for e in errs:
                print("  ✗ " + e)
        for w in warns:
            print("  ⚠ " + w)
        if f.appearance.missing_layers():
            print("  ⚠ ④ 缺失层：" + "、".join(f.appearance.missing_layers()))
    return 1 if errs else 0


def cmd_keyframes(args) -> int:
    b = A.load(args.root)
    spec = _load_json(args.spec)
    pair = FR.build_keyframes(b, spec)
    print("── 首帧图 ──")
    print(pair.first.render())
    print()
    print("── 尾帧图 ──")
    print(pair.last.render())
    print()
    print("── 三条硬性衔接条件 ──")
    for p in pair.validate():
        print("  · " + p)
    return 0


def cmd_delivery(args) -> int:
    b = A.load(args.root)
    spec = _load_json(args.spec)
    tracks = _tracks(spec, args.audio)
    shot = DL.Shot(
        id=spec.get("id", ""), duration=spec.get("duration", ""),
        duration_basis=spec.get("duration_basis", ""),
        render_spec=spec.get("render_spec", ""), aspect=spec.get("aspect", "16:9"),
        quality=spec.get("quality", ""), scene=spec.get("scene", ""),
        appearance=spec.get("appearance_text", ""), action=spec.get("action", ""),
        camera=spec.get("camera", ""), lighting=spec.get("lighting", ""),
        audio=tracks, negative=spec.get("negative", []),
        per_second=spec.get("per_second", []),
        ref_first=spec.get("ref_first", ""), ref_pair=spec.get("ref_pair", ""),
        change=spec.get("change", ""), transition=spec.get("transition", ""),
        constraint=spec.get("constraint", ""), mode=args.mode,
    )
    print("── 提示词（连缀）──")
    print(DL.assemble(shot, args.mode, tracks))
    print()
    print("── 交付文件（字段）──")
    doc = DL.assemble_delivery_file(shot, args.mode, tracks)
    print(doc)
    if args.out:
        Path(args.out).write_text(doc, encoding="utf-8", newline="\n")
        print(f"\n（交付文件已写入 {args.out}）")
    probs = DL.check_audio(tracks)
    if probs:
        print()
        print("声音层自检：")
        for p in probs:
            print("  ✗ " + p)
    print()
    print(f"内联法可用：{DL.is_inline_dialogue_ok(tracks)}")
    txt = DL.assemble(shot, args.mode, tracks)
    return 1 if probs or DL.check_music_tokens(txt, tracks.profile) else 0


def cmd_check(args) -> int:
    p = Path(args.file)
    if not p.is_file():
        raise SystemExit(f"找不到文件：{args.file}")
    text = p.read_text(encoding="utf-8-sig")
    header = "\n".join(text.split("\n")[:8])
    spec = _load_json(args.spec) if args.spec else {}
    tracks = _tracks(spec, args.audio)      # 无 --spec 也能从 --audio 建轨
    anchors = [a for a in (args.anchor or []) if a]

    kw: dict = {"header": header, "tracks": tracks, "anchors": anchors,
                "regime": args.regime, "platform": args.platform}
    if args.mode in ("first_frame", "first", "首帧"):
        kw.update(input_aspect=spec.get("input_aspect", ""),
                  target_aspect=spec.get("target_aspect", ""))
    if args.mode in ("last_frame", "last", "首尾帧"):
        kw.update(first_frame_prompt=spec.get("first_frame_prompt", ""),
                  last_frame_prompt=spec.get("last_frame_prompt", ""),
                  first_aspect=spec.get("first_aspect", ""),
                  last_aspect=spec.get("last_aspect", ""))
    rep = CP.check(args.mode, text, **kw)
    print(rep.summary())
    return 0 if rep.passed else 2


def cmd_jimeng(args) -> int:
    """12 platform/10 · 即梦文生图机判（两口径：工坊整段版 / 堆叠式炫技版）。"""
    if args.source == "-":
        text = sys.stdin.read()
    else:
        p = Path(args.source)
        if not p.is_file():
            raise SystemExit(f"找不到文件：{args.source}")
        text = p.read_text(encoding="utf-8-sig")
    rep = JT.check(text, style=args.style, anchors=[a for a in (args.anchor or []) if a])
    if args.json:
        print(json.dumps(rep.to_dict(), ensure_ascii=False, indent=2))
    else:
        print(rep.summary())
    return 0 if rep.passed else 2


def cmd_formulas(args) -> int:
    from . import shots as SH
    print(SH.catalog(A.load(args.root)))
    return 0


def cmd_split(args) -> int:
    from . import shots as SH
    b = A.load(args.root)
    # v1.1.3：唯一判据＝模式B，划分档位缺省通用档（微切片组装为可覆盖项）
    profile = args.profile
    if profile == "漫剧":
        profile = "通用"
    try:
        if args.unit:
            plans = SH.split_by_units(args.total, args.unit, args.rhythm, b,
                                      profile=profile, avg=args.avg,
                                      swing=args.swing, cuts=args.cuts,
                                      hero_unit=args.hero_unit)
            if args.json:
                print(json.dumps({
                    "total": args.total, "unit": args.unit, "units": len(plans),
                    "profile": plans[0].profile.label if plans[0].profile else "",
                    "formula": (plans[0].formula.label if plans[0].formula else ""),
                    "shots": [{"unit": i + 1, "index": s.index, "start": s.start, "end": s.end,
                               "duration": s.duration, "size": s.size, "move": s.move,
                               "load": s.load, "hero": s.hero}
                              for i, p in enumerate(plans) for s in p.shots],
                    "sum": round(sum(s.duration for p in plans for s in p.shots), 2),
                }, ensure_ascii=False, indent=2))
            else:
                print(f"目标时长：**{args.total:g}s**　生成单元：**{args.unit:g}s × {len(plans)}**"
                      f"　素材档位：**{plans[0].profile.label}**")
                print(f"节奏型：**{plans[0].formula.label if plans[0].formula else args.rhythm}**"
                      f"（{plans[0].formula.pattern if plans[0].formula else ''}）")
                print()
                print(SH.unit_table(plans))
                print()
                total_cuts = sum(len(p.shots) for p in plans)
                print(f"**合计** {total_cuts} 个 CUT，加总 "
                      f"{sum(s.duration for p in plans for s in p.shots):g}s ＝ {args.total:g}s")
                for i, p in enumerate(plans, 1):
                    print(f"  单元 {i}（{p.total:g}s）：" + " / ".join(
                        f"{s.size.split('（')[0]} {s.duration:.1f}s" for s in p.shots))
            return 0

        plan = SH.split(args.total, args.rhythm, b,
                        avg=args.avg, swing=args.swing, cuts=args.cuts,
                        profile=profile)
    except ValueError as e:
        print(f"错误：{e}", file=sys.stderr)
        return 1
    if not args.json:
        print("【剪辑模式 B · 实拍学派｜唯一判据】真源 10 editing/15/16——档位缺省通用档（--profile 可覆盖）")
        print()
    if args.json:
        print(json.dumps({
            "total": plan.total, "rhythm": plan.rhythm_word,
            "profile": (plan.profile.label if plan.profile else ""),
            "formula": (plan.formula.label if plan.formula else ""),
            "pattern": (plan.formula.pattern if plan.formula else ""),
            "cuts": plan.cuts, "avg": plan.avg, "envelopes": plan.envelopes,
            "shots": [{"index": s.index, "start": s.start, "end": s.end,
                       "duration": s.duration, "size": s.size, "move": s.move,
                       "load": s.load, "hero": s.hero, "envelope": s.envelope}
                      for s in plan.shots],
            "sum": plan.sum_duration, "checks": plan.checks(),
        }, ensure_ascii=False, indent=2))
    else:
        print(plan.render())
    bad = [c for c in plan.checks() if c.startswith("✗")]
    return 2 if bad else 0


def _shot_from(d: dict, shared: dict, tracks: "AudioTracks") -> "DL.Shot":
    g = lambda k, dv="": d.get(k, shared.get(k, dv))
    return DL.Shot(
        id=d.get("id", ""), duration=d.get("duration", ""),
        duration_basis=d.get("duration_basis", shared.get("duration_basis", "API（5s / 10s）")),
        render_spec=g("render_spec"), aspect=g("aspect", "16:9"),
        quality=g("quality"), scene=g("scene"),
        appearance=g("appearance_text"), action=d.get("action", ""),
        camera=d.get("camera", ""), lighting=g("lighting"),
        audio=AudioTracks(dialogue=d.get("dialogue", ""),
                          ambient=d.get("ambient", ""),
                          bgm=d.get("bgm", ""), profile=tracks.profile),
        negative=d.get("negative", shared.get("negative", [])),
        per_second=d.get("per_second", []),
        ref_first=d.get("ref_first", ""), ref_pair=d.get("ref_pair", ""),
        change=d.get("change", ""), transition=d.get("transition", ""),
        constraint=d.get("constraint", ""), mode=d.get("mode", "t2v"),
    )


def cmd_deliver_file(args) -> int:
    """批量出**工程交付文件**：每镜头 ①–⑩ + 负面规避词表 + 逐秒精细化说明。"""
    spec = _load_json(args.spec)
    shared = spec.get("shared", {})
    shots_raw = spec.get("shots", [])
    if not shots_raw:
        print("错误：spec 里没有 shots", file=sys.stderr)
        return 1
    layout = args.layout
    profile = AudioTracks.PROFILE_NO_BGM if args.audio == "no-bgm" else AudioTracks.PROFILE_FULL
    probe = AudioTracks(profile=profile)

    head = [
        f"# 工程交付文件 · {spec.get('title', '（未命名）')}",
        "",
        f"【版本】{'A 版（每镜头一组完整十要素）' if layout == 'a' else 'B 版（①②④ 全片声明一次，③⑤⑥⑦⑧⑨⑩ 逐镜出现）'}",
        f"【交付形态】工程交付文件（每镜头十要素）",
        f"【目标平台】{spec.get('platform', '即梦')}",
        f"【模式】{DL.MODE_LABELS.get(spec.get('mode', 't2v'), spec.get('mode', 't2v'))}",
        f"【画幅】{shared.get('aspect', '16:9')}",
        f"【时长】{sum(float(s.get('duration', 0) or 0) for s in shots_raw):g} 秒"
        f"　【时长口径】{shared.get('duration_basis', 'API（5s / 10s）')}",
        f"【声音层】{'全量（⑧对白 + ⑨背景音 + ⑩BGM）' if profile != AudioTracks.PROFILE_NO_BGM else '去配乐（⑧⑨；⑩ 写 NO BGM）'}",
        f"【镜头数】{len(shots_raw)}",
    ]
    if layout == "b" and shots_raw:
        head.append("")
        # ①②④ 取第一镜的共享值（全片恒定）
        head.append(DL.const_block(_shot_from(shots_raw[0], shared, probe), probe))
    head += ["", "---", ""]

    out = list(head)
    allneg: list = []
    for s in shots_raw:
        sh = _shot_from(s, shared, probe)
        out.append(DL.assemble_delivery_file(sh, s.get("mode", spec.get("mode", "t2v")),
                                             sh.audio, layout=layout))
        out.append("")
        out.append("---")
        out.append("")
        for n in sh.negative:
            if n not in allneg:
                allneg.append(n)
    if not args.no_glossary:
        out += ["## 全片负面规避词表（汇总）", "避免：" + "、".join(allneg) + "。", ""]
    doc = "\n".join(out)
    if args.out:
        Path(args.out).write_text(doc, encoding="utf-8", newline="\n")
        print(f"（已写入 {args.out}）")
    else:
        print(doc)
    return 0



def cmd_moves(args):
    b = A.load(args.root)
    rep = MV.check_camera_text(b, args.text)
    print(rep.summary())
    if args.lookup:
        presets = MV.load_presets(b)
        hits = [p for p in presets if args.lookup.lower() in p.lower()]
        print("预设查库（" + str(len(hits)) + "/" + str(len(presets)) + "）：")
        for p in hits[:12]:
            print("  ", p)
    return 0 if rep.passed else 2


def cmd_integrity(args):
    b = A.load(args.root)
    from .integrity import run
    rep = run(b)
    print(rep.summary())
    return 0 if rep.passed else 2


def cmd_find(args):
    b = A.load(args.root)
    roots = PV.load_roots(b, extra=[args.root_dir] if args.root_dir else None)
    if args.list:
        print("已登记检索源：")
        for n, p in roots:
            print(f"  {n}：{p}")
        return 0
    hits = PV.find_text(roots, args.needle, book=args.book or "")
    if not hits:
        print("未命中（检索源见 chain.py find --list）")
        return 0
    for h in hits:
        print(f"[{h['source']}] {h['file']}:{h['line']}")
        print(f"    {h['context']}")
    print(f"—— 共 {len(hits)} 处（上限 20）")
    return 0


def cmd_provenance(args):
    b = A.load(args.root)
    if args.action == "scan":
        cites = PV.scan_citations(b)
        print(f"包内引文：{len(cites)} 个来源，{sum(len(v) for v in cites.values())} 条引用")
        for k in sorted(cites):
            print(f"  {k[:70]}  ← {len(cites[k])} 处")
        return 0
    if args.action == "build":
        out = args.out or os.path.join(os.getcwd(), "影视剧作工坊_原始文档出处包.zip")
        stat = PV.build(b, out, extra_roots=[args.root_dir] if args.root_dir else None)
        print(json.dumps(stat, ensure_ascii=False, indent=1))
        return 0
    if args.action == "check":
        if not args.zip_path:
            print("错误：provenance check 需要 --zip-path 指向出处包 zip", file=sys.stderr)
            return 1
        stat = PV.check(args.zip_path)
        print(json.dumps(stat, ensure_ascii=False, indent=1))
        return 0 if stat["integrity"] == "OK" and stat["manifest"] else 2
    return 1

def cmd_cuts(args):
    b = A.load(args.root)
    spec = _load_json(args.spec)
    if getattr(args, "mode", "a") != "a":
        spec = dict(spec)
        spec["editing_mode"] = args.mode
    rep = SH.validate_cuts(b, spec)
    print(rep.summary())
    if args.json:
        print(json.dumps({"editing_mode": getattr(args, "mode", "b"), "passed": rep.passed, "locked": rep.locked,
                          "errors": rep.errors, "warnings": rep.warnings}, ensure_ascii=False, indent=2))
    return 0 if rep.passed else 2


def cmd_lens(args):
    b = A.load(args.root)
    from .lens import check_focal
    rep = check_focal(b, args.focal, shot_size=args.shot_size or "")
    print(rep.summary())
    return 0 if rep.passed else 2


def cmd_style(args):
    b = A.load(args.root)
    d = ST.decide(b, args.text)
    print(d.describe())
    if args.json:
        print(json.dumps(d.to_dict(), ensure_ascii=False, indent=2))
    return 0


def cmd_render(args):
    b = A.load(args.root)
    prof = RD.build_profile(b, args.text, style_traits=args.trait or None)
    print("SHOT_RENDER_PROFILE：")
    print(prof.describe())
    if args.json:
        print(json.dumps(prof.to_dict(), ensure_ascii=False, indent=2))
    return 0


def cmd_scene(args):
    b = A.load(args.root)
    spec = _load_json(args.spec)
    rep = SC.check_scene(b, spec.get("scene", spec), platform=spec.get("platform", ""))
    print(rep.summary())
    return 0 if rep.passed else 2


def cmd_performance(args):
    b = A.load(args.root)
    spec = _load_json(args.spec)
    rep = PF.check_performance(b, spec)
    print(rep.summary())
    return 0 if rep.passed else 2


def cmd_shotlist(args):
    b = A.load(args.root)
    spec = _load_json(args.spec)
    rep = SL.check_shot(b, spec)
    print(rep.summary())
    return 0 if rep.passed else 2


def cmd_audio(args):
    b = A.load(args.root)
    spec = _load_json(args.spec)
    rep = AU.check_audio(b, dialogue=spec.get("dialogue", ""), duration=spec.get("duration", 0),
                         lip_sync_priority=spec.get("lip_sync_priority", False),
                         text=spec.get("text", ""))
    print(rep.summary())
    return 0 if rep.passed else 2


def cmd_review(args):
    b = A.load(args.root)
    findings = RV.load_findings(args.file)
    plan = RV.plan_repair(b, findings, score=args.score,
                          fail_history=_load_json(args.history) if args.history else None)
    print(plan.describe())
    if args.json:
        print(json.dumps(plan.to_dict(), ensure_ascii=False, indent=2))
    return 0

def cmd_pipeline(args):
    """端到端全链路：01 四轴 → 02 风格 → 03 渲染档案 → 04 场景+单帧图 → 05 表演 → 06 焦距机判 → 07 分镜字段 → 08 运镜机判 → 09 音频机判 → 10 划分 → 12 交付 → 13 合规 → 11 返修路由。"""
    _fout = None
    if getattr(args, "out", None):
        class _Tee:
            def __init__(self, *streams):
                self.streams = streams
            def write(self, s):
                for x in self.streams:
                    x.write(s)
                return len(s)
            def flush(self):
                for x in self.streams:
                    x.flush()
        _fout = open(args.out, "w", encoding="utf-8")
        sys.stdout = _Tee(sys.stdout, _fout)
    try:
        return _pipeline_body(args)
    finally:
        if _fout is not None:
            sys.stdout = sys.__stdout__
            _fout.close()

def _pipeline_body(args) -> int:
    b = A.load(args.root)
    spec = _load_json(args.spec)
    brief = spec.get("brief", "")
    exit_code = 0
    dspec = spec.get("delivery", {})

    print("═══ L1 四轴判定（01）═══")
    tp = AX.TriggerPlan.plan(brief)
    print(tp.describe())

    if spec.get("mood"):
        print()
        print("═══ 影调与导演卡（02）═══")
        sd = ST.decide(b, spec["mood"])
        print(sd.describe())

    if spec.get("intent"):
        print()
        print("═══ SHOT_RENDER_PROFILE（03）═══")
        rp = RD.build_profile(b, spec["intent"], style_traits=spec.get("traits"))
        print(rp.describe())

    if spec.get("scene"):
        print()
        print("═══ 场景线六维拼装（04）═══")
        _sc_in = spec["scene"]
        _sc = _sc_in if "风格通道" in _sc_in else _sc_in.get("scene", _sc_in)
        sc = SC.check_scene(b, _sc, platform=spec.get("platform", ""))
        print(sc.summary())
        exit_code = max(exit_code, 0 if sc.passed else 2)

    print()
    print("═══ 04 单帧图 ═══")
    frame_spec = spec.get("frame")
    if frame_spec:
        f = FR.build_frame(b, frame_spec)
        print(f.render())
        for e in f.check():
            print("  ✗ " + e)
            exit_code = max(exit_code, 2)
    else:
        print("（spec 未提供 frame）")

    if spec.get("performance"):
        print()
        print("═══ 表演区块（05）═══")
        pr = PF.check_performance(b, spec["performance"])
        print(pr.summary())
        exit_code = max(exit_code, 0 if pr.passed else 2)

    print()
    print("═══ 焦距×景别机判（06）═══")
    _lens_cfg = spec.get("lens") or {}
    _focal = _lens_cfg.get("focal", "")
    _size = _lens_cfg.get("shot_size", "") or (frame_spec or {}).get("shot_size", "")
    if _focal:
        lr = LN.check_focal(b, _focal, shot_size=_size)
        print(lr.summary())
        exit_code = max(exit_code, 0 if lr.passed else 2)
    else:
        print("（spec 未提供 lens.focal——06 只做焦距×景别机判，画面坐标系决策仍归 06 模块）")

    if spec.get("shot"):
        print()
        print("═══ 分镜字段（07）═══")
        sr = SL.check_shot(b, spec["shot"])
        print(sr.summary())
        exit_code = max(exit_code, 0 if sr.passed else 2)

    print()
    print("═══ 运镜机判（08）═══")
    _camera_text = str(spec.get("camera_text", "") or dspec.get("camera", "") or "")
    if _camera_text.strip():
        mr = MV.check_camera_text(b, str(_camera_text))
        print(mr.summary())
        exit_code = max(exit_code, 0 if mr.passed else 2)
    else:
        print("（spec 未提供 camera_text / delivery.camera——08 运镜决策仍归 08 模块）")

    print()
    print("═══ 音频机判（09）═══")
    _a_tracks = _tracks(spec.get("audio_spec", {}) or {}, dspec.get("audio", "full"))
    _a_body = " ".join(x for x in (_a_tracks.dialogue, dspec.get("action", ""),
                                   dspec.get("camera", ""), dspec.get("lighting", "")) if x)
    if _a_tracks.dialogue.strip() or dspec.get("lip_sync_priority"):
        _a_dur = _parse_seconds(dspec.get("duration", 0)) or spec.get("audio_spec", {}).get("duration", 0.0)
        ar = AU.check_audio(b, dialogue=_a_tracks.dialogue, duration=float(_a_dur or 0.0),
                            lip_sync_priority=bool(dspec.get("lip_sync_priority")),
                            text=_a_body)
        print(ar.summary())
        exit_code = max(exit_code, 0 if ar.passed else 2)
    else:
        print("（无对白轨且未声明口型优先——跳过 09 口型类机判）")

    if spec.get("cuts"):
        print()
        _cm = str(spec["cuts"].get("editing_mode", spec["cuts"].get("剪辑模式", "b"))).lower()
        print("═══ 人工镜头组接校验（10 · HARD HUMAN LOCK"
              + (" · 剪辑模式B 实拍学派）═══" if _cm == "b" else "）═══"))
        cr = SH.validate_cuts(b, spec["cuts"])
        print(cr.summary())
        if not cr.passed:
            return 2
        print("　→ 人工组接已锁定，跳过自动划分（优先级：HARD HUMAN LOCK > DIRECTOR DECISION > MODEL DEFAULT）")
    elif spec.get("split"):
        print()
        print("═══ 镜头划分（10）═══")
        _sp = spec["split"]
        _prof = _sp.get("profile") or "通用"
        _sh = SH.split(float(_sp.get("total", 15)), rhythm=_sp.get("rhythm", ""),
                       bundle=b, profile=_prof)
        print(_sh.render())

    print()
    print("═══ 12 三模式交付 ═══")
    mode = dspec.get("mode", tp.axes.video_submode)
    tracks = _tracks(dspec, dspec.get("audio", "full"))
    shot = DL.Shot(id=dspec.get("id", ""), duration=dspec.get("duration", ""),
                   render_spec=dspec.get("render_spec", ""),
                   aspect=dspec.get("aspect", "16:9"),
                   quality=dspec.get("quality", ""), scene=dspec.get("scene", ""),
                   appearance=dspec.get("appearance_text", ""),
                   action=dspec.get("action", ""), camera=dspec.get("camera", ""),
                   lighting=dspec.get("lighting", ""), audio=tracks,
                   negative=dspec.get("negative", []),
                   per_second=dspec.get("per_second", []),
                   ref_first=dspec.get("ref_first", ""), ref_pair=dspec.get("ref_pair", ""),
                   change=dspec.get("change", ""), transition=dspec.get("transition", ""),
                   constraint=dspec.get("constraint", ""), mode=mode)
    out = DL.assemble(shot, mode, tracks)
    print(out)

    print()
    print("═══ 13 合规判定 ═══")
    # 审**可投喂提示词**（DL.assemble 产物，与 delivery --out → check 的真实链路一致）；
    # 工程交付文件（十要素）按 T1 槽位判据走 deliver-file → check 通道，F1–F3 的
    # 「不复述输入图」判据面向投喂件，对工程件必然误报。
    _ck: dict = dict(header=f"【模式】{mode}\nAPI 5s", tracks=tracks,
                     anchors=dspec.get("anchors", []),
                     regime=dspec.get("regime", "short"),
                     platform=dspec.get("platform", ""))
    if mode == "first_frame":
        _ck.update(input_aspect=dspec.get("input_aspect", ""),
                   target_aspect=dspec.get("target_aspect", ""))
    if mode == "last_frame":
        _ck.update(first_frame_prompt=dspec.get("first_frame_prompt", ""),
                   last_frame_prompt=dspec.get("last_frame_prompt", ""),
                   first_aspect=dspec.get("first_aspect", ""),
                   last_aspect=dspec.get("last_aspect", ""))
    rep = CP.check(mode, out, **_ck)
    print(rep.summary())
    exit_code = max(exit_code, 0 if rep.passed else 2)

    print()
    print("═══ 返修路由（11）═══")
    findings = []
    for x in list(getattr(rep, "findings", [])) + list(getattr(rep, "warned", [])):
        findings.append(vars(x) if hasattr(x, "__dict__") else dict(x))
    plan = RV.plan_repair(b, findings, fail_history=spec.get("fail_history"))
    print(plan.describe())
    return exit_code


# ---------------------------------------------------------------- parser

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="chain.py", description="影视剧作工坊链路脚本")
    p.add_argument("--root", default=None, help="包根目录（默认脚本位置推导）")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("assets", help="列出包内可用资产").set_defaults(fn=cmd_assets)

    q = sub.add_parser("bench", help="查角色风格基准 / 基准选择速查")
    q.add_argument("code", nargs="?", help="基准号 A–AC；省略则打印题材速查")
    q.set_defaults(fn=cmd_bench)

    q = sub.add_parser("axis", help="01 四轴判定")
    q.add_argument("text")
    q.add_argument("--json", action="store_true")
    q.set_defaults(fn=cmd_axis)

    q = sub.add_parser("plan", help="01 L1–L4 触发计划")
    q.add_argument("text")
    q.set_defaults(fn=cmd_plan)

    q = sub.add_parser("frame", help="04 单帧图（①–⑦ + 负面，不带声音层）")
    q.add_argument("spec", help="JSON 规格文件")
    q.set_defaults(fn=cmd_frame)

    q = sub.add_parser("keyframes", help="04 首帧图 + 尾帧图（三条件校验）")
    q.add_argument("spec")
    q.set_defaults(fn=cmd_keyframes)

    q = sub.add_parser("delivery", help="12 三模式拼装 + 声音层档位")
    q.add_argument("spec")
    q.add_argument("--mode", default="t2v", choices=["t2v", "first_frame", "last_frame"])
    q.add_argument("--audio", default="full", choices=["full", "no-bgm"])
    q.add_argument("--out", default=None, help="把交付文件写入该路径（供 check 审）")
    q.set_defaults(fn=cmd_delivery)

    q = sub.add_parser("check", help="13 合规判据 G/T/F/L")
    q.add_argument("file")
    q.add_argument("--mode", default="t2v", choices=["t2v", "first_frame", "last_frame"])
    q.add_argument("--audio", default="full", choices=["full", "no-bgm"])
    q.add_argument("--spec", default=None, help="附带元数据的 JSON")
    q.add_argument("--anchor", action="append", help="锚定段（可多次），逐字比对")
    q.add_argument("--regime", default="short", choices=["short", "block"],
                   help="体制：short=短句单镜头（800 字上限）/ block=块状脚手架（结构取代字数上限，中文 1800 字符）")
    q.add_argument("--platform", default="", help="平台：即梦 / seedance / cinema / 豆包")
    q.set_defaults(fn=cmd_check)

    q = sub.add_parser("jimeng", help="12 即梦文生图机判（J1–J11；口径 auto/prose/stack）")
    q.add_argument("source", help="提示词文本文件；- 读 stdin")
    q.add_argument("--style", default="auto", choices=["auto", "prose", "stack"],
                   help="prose=工坊整段版 / stack=堆叠式炫技版 / auto=按段均长自判")
    q.add_argument("--anchor", action="append", help="风格锚定段（可多次），逐字比对段首")
    q.add_argument("--json", action="store_true")
    q.set_defaults(fn=cmd_jimeng)

    q = sub.add_parser("formulas", help="列出六套剪辑公式与镜头时长区间")
    q.set_defaults(fn=cmd_formulas)

    q = sub.add_parser("split", help="按模块 10 组接方法论划分镜头（5–30s）；--mode b 切实拍学派（默认通用档）")
    q.add_argument("total", type=float, help="总时长（秒），5–30 自由选择")
    q.add_argument("--mode", default="b", choices=["b"],
                   help="剪辑判据：唯一通道 b=模式B 实拍学派（10 editing/15/16）")
    q.add_argument("--rhythm", default="", help="节奏词（紧张 / 温馨 / 紧凑 / 悬疑 / 情感 / 预告 …）")
    q.add_argument("--unit", type=float, default=None,
                   help="**按生成单元切**（即梦 API: 5 或 10；UI: 4–15）。给出后每单元各自划分 CUT")
    q.add_argument("--hero-unit", type=int, default=None,
                   help="主打长镜落在第几个单元（1-based）——§1.4 的 6–8s 长镜是全片级的")
    q.add_argument("--avg", type=float, default=None, help="覆盖均切长（§1.4 区间 4–6s）")
    q.add_argument("--swing", type=float, default=None, help="覆盖摆动幅度（0–0.6）")
    q.add_argument("--cuts", type=int, default=None, help="直接指定剪切数")
    q.add_argument("--profile", default="漫剧", help="素材档位：通用（缺省，v1.1.3）/ 漫剧（微切片组装，可覆盖）")
    q.add_argument("--json", action="store_true")
    q.set_defaults(fn=cmd_split)

    q = sub.add_parser("deliver-file", help="批量出**工程交付文件**（每镜头 ①–⑩ + 负面词表 + 逐秒说明）")
    q.add_argument("spec", help="JSON：{title, platform, mode, shared{…}, shots[…]}")
    q.add_argument("--audio", default="full", choices=["full", "no-bgm"])
    q.add_argument("--layout", default="a", choices=["a", "b"],
                   help="A 版=每镜头一组完整十要素（默认）；B 版=十要素标签只在开头出现一次")
    q.add_argument("--out", default=None, help="写入路径；省略则打到 stdout")
    q.add_argument("--no-glossary", action="store_true", help="不附全片负面词汇总")
    q.set_defaults(fn=cmd_deliver_file)

    q = sub.add_parser("pipeline", help="端到端全链路：01 四轴 → 02 风格 → 03 渲染档案 → 04 场景+单帧图 → 05 表演 → 06 焦距机判 → 07 分镜字段 → 08 运镜机判 → 09 音频机判 → 10 划分 → 12 交付 → 13 合规 → 11 返修路由")
    q.add_argument("spec")
    q.set_defaults(fn=cmd_pipeline)
    q.add_argument("--out", default=None, help="把全链路报告与最终交付文本写入该文件")

    q = sub.add_parser("cuts", help="10 人工镜头组接校验（加总/单调/信封/预算/同景别直切；--mode b 切实拍学派隔级切）")
    q.add_argument("spec", help='{"total": 30, "cuts": [{duration, shot_size, motion, jump_cut?, 主体?, kind?, 豁免?, 朝向?, 切点?}, ...]}')
    q.add_argument("--mode", default="b", choices=["b"],
                   help="剪辑判据：唯一通道 b=模式B 实拍学派（10 editing/15/16）")
    q.add_argument("--json", action="store_true")
    q.set_defaults(fn=cmd_cuts)

    q = sub.add_parser("find", help="母源检索：在 sources.json 登记的原始文档库里搜关键词")
    q.add_argument("needle", nargs="?", default="", help="关键词（--list 时可省）")
    q.add_argument("--book", default="", help="限定文件名/目录含此串（如 book02）")
    q.add_argument("--root-dir", default="", help="临时追加检索根")
    q.add_argument("--list", action="store_true", help="只列出已登记检索源")
    q.set_defaults(fn=cmd_find)

    q = sub.add_parser("provenance", help="原始文档出处包：scan 引文 / build 打包 / check 校验")
    q.add_argument("action", choices=["scan", "build", "check"])
    q.add_argument("--out", default=None, help="build：输出的 zip 路径")
    q.add_argument("--zip-path", default=None, help="check：待校验的出处包")
    q.add_argument("--root-dir", default=None, help="build：临时追加检索根")
    q.set_defaults(fn=cmd_provenance)

    q = sub.add_parser("moves", help="08 运镜机判（具名预设词表/一镜一运动/终止条件）")
    q.add_argument("text", help="camera 字段文本")
    q.add_argument("--lookup", default="", help="按关键词查 moves/09 英文预设名")
    q.set_defaults(fn=cmd_moves)

    q = sub.add_parser("integrity", help="全包完整性自检（目录/引擎/词表/导入）")
    q.set_defaults(fn=cmd_integrity)

    q = sub.add_parser("lens", help="06 焦距库机判（焦段分类 + 景别禁止项对照）")
    q.add_argument("--focal", required=True, help="焦段描述，如：85mm / 中长焦 / 35-50mm")
    q.add_argument("--shot-size", default="", help="该镜景别（06 景别表）")
    q.set_defaults(fn=cmd_lens)

    q = sub.add_parser("style", help="02 影调/导演卡路由（氛围比对→挂卡→中性缺省）")
    q.add_argument("text", help="氛围描述，如：悬疑 夜戏 王家卫")
    q.add_argument("--json", action="store_true")
    q.set_defaults(fn=cmd_style)

    q = sub.add_parser("render", help="03 视觉意图四维解析 → SHOT_RENDER_PROFILE")
    q.add_argument("text", help="如：次世代超写实 3D，Arnold")
    q.add_argument("--trait", action="append", help="质感/风格组件（可多次，供剂量与冲突检测）")
    q.add_argument("--json", action="store_true")
    q.set_defaults(fn=cmd_render)

    q = sub.add_parser("scene", help="04 场景线六维拼装校验")
    q.add_argument("spec")
    q.set_defaults(fn=cmd_scene)

    q = sub.add_parser("performance", help="05 表演区块校验（微表情库/呼吸微节拍/锚定段）")
    q.add_argument("spec")
    q.set_defaults(fn=cmd_performance)

    q = sub.add_parser("shotlist", help="07 分镜 11 必填字段 + 一镜一信息校验")
    q.add_argument("spec")
    q.set_defaults(fn=cmd_shotlist)

    q = sub.add_parser("audio", help="09 音频机判（口型区间/头脸运动词/音乐词）")
    q.add_argument("spec")
    q.set_defaults(fn=cmd_audio)

    q = sub.add_parser("review", help="11 返修路由决策（findings → 回哪一级）")
    q.add_argument("file", help="findings JSON（13 的判据结果）")
    q.add_argument("--score", type=int, default=None, help="复检得分 0–20（review/01 四档）")
    q.add_argument("--history", default=None, help="连续失败次数 JSON（{code: n}）")
    q.add_argument("--json", action="store_true")
    q.set_defaults(fn=cmd_review)

    return p


def _force_utf8_stdio() -> None:
    """GBK 控制台下 🎯/═/⚠ 等字符会让命令直接崩——输出流强制 UTF-8（error 端 replace）。"""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

def main(argv=None) -> int:
    _force_utf8_stdio()
    args = build_parser().parse_args(argv)
    try:
        return args.fn(args)
    except (FileNotFoundError, KeyError, ValueError) as e:
        print(f"错误：{e}", file=sys.stderr)
        return 1
    except Exception as e:  # 未知异常也收敛为 rc=1，不暴露裸 traceback
        print(f"脚本内部错误：{type(e).__name__}: {e}", file=sys.stderr)
        return 1
