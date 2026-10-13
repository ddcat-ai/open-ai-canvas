#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""影视剧作工坊 · 全链路 × 全风格压力测试。

    python stress.py --times 100              # 每用例 100 次（默认）
    python stress.py --times 100 --json report.json
    python stress.py --quick                  # 冒烟：每用例 5 次

测什么：
- 全部 25 个子命令的真实触发入口（wfkit.cli.main，不走内部分支捷径）；
- 01–13 每级机判 + 端到端 pipeline（13 级全触发）；
- 全风格：29 条基准 A–AC 逐一注入端到端 pipeline；
- 每条用例重复 N 次，校验两件事：
  ① 退出码稳定（0=通过 / 2=机判拒收，均合法；1=脚本错误即判失败）；
  ② 输出逐字节稳定（确定性——同输入必须同输出）。

只依赖 Python 3.8+ 标准库。
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import io
import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from wfkit import cli, assets as A  # noqa: E402

EX = Path(__file__).resolve().parent / "examples"


def run(argv):
    """跑一次真实 CLI 入口，返回 (rc, 输出文本)。SystemExit（如 找不到文件）收敛为 rc。"""
    buf, err = io.StringIO(), io.StringIO()
    try:
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(err):
            rc = cli.main(argv)
    except SystemExit as e:
        rc = e.code if isinstance(e.code, int) else 1
    out = buf.getvalue()
    if err.getvalue():
        out += "\n[stderr] " + err.getvalue()
    return rc, out


def run_py(argv):
    """子进程跑包内脚本（故事板线脚本），返回 (rc, 输出文本)。"""
    p = subprocess.run([sys.executable] + [str(a) for a in argv],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    out = (p.stdout or "") + (("[stderr] " + p.stderr) if p.stderr else "")
    return p.returncode, out


SB = Path(__file__).resolve().parent.parent.parent / "影视剧作工坊-故事板"


# ---------------------------------------------------------------- 用例构造

def build_cases(tmp: Path):
    """返回 [(组, 用例名, kind, argv, 必须过)]。kind='cli' 走 wfkit.cli，'py' 走包内脚本子进程。"""
    C = []

    def add(group, name, argv, must_pass=False, allow_rc=None):
        if allow_rc is None:
            allow_rc = (0,) if must_pass else (0, 2)
        C.append((group, name, "cli", [str(a) for a in argv], tuple(allow_rc)))

    def add_py(group, name, argv, must_pass=False):
        C.append((group, name, "py", [str(a) for a in argv], (0,) if must_pass else (0, 1)))

    # ---- 01 触发与任务识别（四轴 + L1–L4 计划）----
    for i, t in enumerate([
        "一键交付，文生视频", "首尾帧，即梦", "出一张角色设定图", "这段运镜怎么设计",
        "把这段剧本做成视频生成提示词，豆包", "渲染引擎：UE5 与 Arnold 都要",
    ]):
        add("01 触发", f"axis#{i}", ["axis", t], must_pass=True)
    for i, t in enumerate([
        "一键交付，文生视频", "只要分镜故事板", "先出人物，再出分镜", "交付前审一遍",
    ]):
        add("01 触发", f"plan#{i}", ["plan", t], must_pass=True)

    # ---- 02 影视风格（全基准 + 氛围路由）----
    add("02 风格", "bench速查", ["bench"], must_pass=True)
    bundle = A.load(None)
    for code in sorted(bundle.benchmarks):
        add("02 风格", f"bench {code}", ["bench", code], must_pass=True)
    for i, t in enumerate([
        "悬疑 夜戏 王家卫", "温馨 日光 是枝裕和", "战争 硬光 斯皮尔伯格", "科幻 冷调 维伦纽瓦",
        "宫廷 烛光 张艺谋", "青春 柔光 岩井俊二", "黑色电影 高对比", "",  # 空文本=中性缺省路径
    ]):
        add("02 风格", f"style#{i}", ["style", t], must_pass=True)

    # ---- 03 渲染表现 ----
    for i, (t, tr) in enumerate([
        ("次世代超写实 3D，Arnold", ["超写实", "次世代"]),
        ("电影实拍感，35mm 胶片", ["胶片颗粒"]),
        ("UE5 引擎渲染，实时画面", ["UE5"]),
        ("二维动画，赛璐璐", ["赛璐璐"]),
        ("水墨国风", ["水墨"]),
        ("，", []),  # 空意图兜底路径
    ]):
        argv = ["render", t]
        for x in tr:
            argv += ["--trait", x]
        add("03 渲染", f"render#{i}", argv, must_pass=True)

    # ---- 04 场景与人物（六维 / 单帧 / 首尾帧）----
    add("04 资产", "scene寝殿", ["scene", str(EX / "scene_寝殿.json")], must_pass=True)
    add("04 资产", "frame皇贵妃", ["frame", str(EX / "frame_皇贵妃.json")], must_pass=True)
    add("04 资产", "keyframes皇贵妃", ["keyframes", str(EX / "keyframes_皇贵妃.json")], must_pass=True)

    # ---- 05 人物表演 ----
    add("05 表演", "performance皇贵妃", ["performance", str(EX / "performance_皇贵妃.json")], must_pass=True)

    # ---- 06 景别构图机位灯光（焦距×景别对照）----
    for i, (f, s) in enumerate([
        ("85mm", "特写"), ("35mm", "中景"), ("14mm", "远景"), ("135mm", "大特写"),
        ("24mm", "全景"), ("50mm", "近景"), ("200mm", "特写"), ("中长焦", "中近景"),
        ("广角", "全景"), ("14mm", "面部特写"),  # 广角×人脸=禁止项，预期机判拒收
        ("35-50mm", "中景"), ("85mm", ""),
    ]):
        add("06 景别灯光", f"lens#{i}", ["lens", "--focal", f, "--shot-size", s])

    # ---- 07 分镜头设计 ----
    add("07 分镜", "shot_S01", ["shotlist", str(EX / "shot_S01.json")], must_pass=True)

    # ---- 08 运镜设计 ----
    for i, t in enumerate([
        "缓慢推近 dolly in，终结在她回眸的一瞬", "手持跟拍 handheld tracking，肩部微晃",
        "环绕 orbit 180 度，终止在正面", "固定机位，仅变焦 zoom in 至面部",
        "推拉摇移跟甩环绕升降全都要",
    ]):
        add("08 运镜", f"moves#{i}", ["moves", t])
    add("08 运镜", "moves查库", ["moves", "dolly in", "--lookup", "推"])

    # ---- 09 音效 ----
    add("09 音效", "audio_S01", ["audio", str(EX / "audio_S01.json")], must_pass=True)

    # ---- 10 剪辑与镜头组接（划分 + 人工锁定）----
    for dur in (5, 10, 15, 20, 30):
        for r in ("紧张", "温馨", "紧凑"):
            add("10 组接", f"split {dur}s {r}", ["split", dur, "--rhythm", r, "--mode", "b"], must_pass=True)
    add("10 组接", "split 30 通用档", ["split", 30, "--rhythm", "温馨", "--profile", "通用", "--mode", "b"], must_pass=True)
    add("10 组接", "split 30 单元10", ["split", 30, "--unit", 10, "--hero-unit", 2, "--rhythm", "紧张", "--mode", "b"], must_pass=True)
    add("10 组接", "split 30 单元5", ["split", 30, "--unit", 5, "--rhythm", "紧张", "--mode", "b"], must_pass=True)
    add("10 组接", "split 15 覆盖参数", ["split", 15, "--avg", 5.0, "--swing", 0.3, "--cuts", 3, "--mode", "b"], must_pass=True)
    add("10 组接", "cuts皇贵妃", ["cuts", str(EX / "cuts_皇贵妃30s.json"), "--mode", "b"], must_pass=True)
    add("10 组接", "cuts模式B示例", ["cuts", str(EX / "cuts_剪辑模式B示例.json"), "--mode", "b"], must_pass=True)
    add("10 组接", "formulas", ["formulas"], must_pass=True)

    # ---- 11 导演链路校验（返修路由）----
    findings = tmp / "findings.json"
    findings.write_text(json.dumps([
        {"code": "G1", "level": "FAIL", "msg": "含引擎名", "route_to": ""},
        {"code": "T3", "level": "WARN", "msg": "锚定段待比对", "route_to": ""},
    ], ensure_ascii=False), encoding="utf-8")
    add("11 校验", "review score16", ["review", str(findings), "--score", 16], must_pass=True)
    add("11 校验", "review score9", ["review", str(findings), "--score", 9], must_pass=True)
    hist = tmp / "fail_history.json"
    hist.write_text(json.dumps({"G1": 2}, ensure_ascii=False), encoding="utf-8")
    add("11 校验", "review 连续失败", ["review", str(findings), "--score", 12, "--history", str(hist)], must_pass=True)

    # ---- 12 技术语言转换（三模式交付 / 工程件 / 即梦生图）----
    dspec = str(EX / "delivery_皇贵妃_t2v_nobgm.json")
    out_txt = tmp / "out.txt"
    for mode in ("t2v", "first_frame", "last_frame"):
        for au in ("full", "no-bgm"):
            add("12 转换", f"delivery {mode} {au}",
                ["delivery", dspec, "--mode", mode, "--audio", au, "--out", str(out_txt)], must_pass=True)
    for layout in ("a", "b"):
        for au in ("full", "no-bgm"):
            add("12 转换", f"deliver-file {layout} {au}",
                ["deliver-file", str(EX / "工程交付-皇贵妃捏脚-30s.json"),
                 "--layout", layout, "--audio", au, "--out", str(tmp / f"工程{layout}.md")], must_pass=True)
    jimeng_cases = [
        ("jimeng_斗神堆叠版.txt", "auto"), ("jimeng_斗神堆叠版.txt", "stack"),
        ("jimeng_皇贵妃整段版.txt", "auto"), ("jimeng_皇贵妃整段版.txt", "prose"),
        ("jimeng_云上天宫.txt", "auto"), ("jimeng_云上天宫.txt", "prose"),
        ("jimeng_嫦娥伦勃朗.txt", "auto"), ("jimeng_商业街夜景人像.txt", "stack"),
        ("jimeng_科幻乌托邦巨构.txt", "auto"),
    ]
    for fn, sty in jimeng_cases:
        add("12 转换", f"jimeng {fn[:14]} {sty}", ["jimeng", str(EX / fn), "--style", sty])

    # ---- 13 交付文件审核（平台 × 体制）----
    add("13 审核", "check t2v 即梦", ["check", str(out_txt), "--mode", "t2v", "--audio", "no-bgm",
                                     "--spec", dspec, "--platform", "即梦", "--regime", "short"])
    add("13 审核", "check t2v 豆包block", ["check", str(out_txt), "--mode", "t2v", "--audio", "no-bgm",
                                          "--spec", dspec, "--platform", "豆包", "--regime", "block"])
    add("13 审核", "check 工程A版", ["check", str(tmp / "工程a.md"), "--mode", "t2v", "--audio", "full",
                                     "--platform", "豆包", "--regime", "block"])
    add("13 审核", "check 工程B版", ["check", str(tmp / "工程b.md"), "--mode", "t2v", "--audio", "full",
                                     "--platform", "豆包", "--regime", "block"])

    # ---- 端到端 pipeline（01→13，13 级全触发）----
    add("端到端", "pipeline 最小链", ["pipeline", str(EX / "pipeline.json")], must_pass=True)
    full = json.loads((EX / "pipeline_full.json").read_text(encoding="utf-8"))
    add("端到端", "pipeline 全要素 t2v", ["pipeline", str(EX / "pipeline_full.json")], must_pass=True)
    for mode in ("first_frame", "last_frame"):
        s = json.loads(json.dumps(full))
        s["delivery"]["mode"] = mode
        p = tmp / f"pipeline_{mode}.json"
        p.write_text(json.dumps(s, ensure_ascii=False), encoding="utf-8")
        add("端到端", f"pipeline 全要素 {mode}", ["pipeline", str(p)], must_pass=True)
    # 全风格：29 条基准 A–AC 逐一注入端到端
    for code in sorted(bundle.benchmarks):
        s = json.loads(json.dumps(full))
        s["frame"]["style"] = code
        s["delivery"]["platform"] = "即梦"
        p = tmp / f"pipeline_style_{code}.json"
        p.write_text(json.dumps(s, ensure_ascii=False), encoding="utf-8")
        add("端到端", f"pipeline 基准{code}", ["pipeline", str(p)], must_pass=True)

    # ---- 故事板线（链外技能，脚本层全量）----
    for e in ("E01", "E02", "E03", "E04", "E05"):
        add_py("故事板", f"validate {e}", [SB / "scripts" / "validate.py", SB / "examples" / f"{e}_storyboard.json"], must_pass=True)
        add_py("故事板", f"cnn {e}", [SB / "scripts" / "cnn_style_check.py", SB / "examples" / f"{e}_storyboard.json", "--json"], must_pass=True)
    add_py("故事板", "render E01", [SB / "scripts" / "render.py", SB / "examples" / "E01_storyboard.json", tmp / "sb_render"], must_pass=True)
    add_py("故事板", "check_segments E01", [SB / "scripts" / "check_segments.py", SB / "examples" / "E01_storyboard.json"], must_pass=True)
    add_py("故事板", "mutation_test", [SB / "scripts" / "mutation_test.py"], must_pass=True)
    add_py("故事板", "check_consistency", [SB / "scripts" / "check_consistency.py"], must_pass=True)
    add_py("故事板", "regression 全7步", [SB / "scripts" / "regression.py"], must_pass=True)

    # ---- 对抗组（边界/畸形输入：稳定收敛，允许机判拒收 rc=2 或干净报错 rc=1）----
    add("对抗", "axis 空文本", ["axis", ""])
    empty = tmp / "adv_empty.json"
    empty.write_text("{}", encoding="utf-8")
    add("对抗", "frame 空规格", ["frame", str(empty)])
    badtype = tmp / "adv_badtype.json"
    badtype.write_text(json.dumps({"appearance": "应为九层dict的字符串", "negative": "应为列表的字符串"},
                                  ensure_ascii=False), encoding="utf-8")
    add("对抗", "frame 类型错误", ["frame", str(badtype)], allow_rc=(0, 1, 2))
    nofile = tmp / "adv_不存在.json"
    add("对抗", "frame 文件不存在", ["frame", str(nofile)], allow_rc=(0, 1, 2))
    add("对抗", "split 3s 越下界", ["split", 3, "--mode", "b"], allow_rc=(0, 1, 2))
    add("对抗", "split 40s 越上界", ["split", 40, "--mode", "b"], allow_rc=(0, 1, 2))
    add("对抗", "split 单元不整除", ["split", 30, "--unit", 7, "--mode", "b"], allow_rc=(0, 1, 2))
    badcuts = tmp / "adv_cuts.json"
    _c = json.loads((EX / "cuts_皇贵妃30s.json").read_text(encoding="utf-8"))
    _c["total"] = 30.0
    for _x in _c.get("cuts", []):
        _x["duration"] = 2.0          # 加总 16s ≠ 30s → §1.4 精确加总必须 FAIL
    badcuts.write_text(json.dumps(_c, ensure_ascii=False), encoding="utf-8")
    add("对抗", "cuts 时长不闭合", ["cuts", str(badcuts), "--mode", "b"])
    findings_empty = tmp / "adv_findings_empty.json"
    findings_empty.write_text("[]", encoding="utf-8")
    add("对抗", "review 空 findings", ["review", str(findings_empty), "--score", 16], must_pass=True)
    add("对抗", "jimeng 口径错配", ["jimeng", str(EX / "jimeng_斗神堆叠版.txt"), "--style", "prose"])
    add("对抗", "deliver-file 不附词表", ["deliver-file", str(EX / "工程交付-皇贵妃捏脚-30s.json"),
                                          "--layout", "b", "--no-glossary", "--out", str(tmp / "adv_工程b.md")],
        must_pass=True)
    nobrief = tmp / "adv_pipeline_nobrief.json"
    s_nb = json.loads(json.dumps(full))
    s_nb.pop("brief", None)
    nobrief.write_text(json.dumps(s_nb, ensure_ascii=False), encoding="utf-8")
    add("对抗", "pipeline 无 brief", ["pipeline", str(nobrief)])
    add("对抗", "style 未映射氛围", ["style", "恐怖 恶心 蒸汽波"])
    return C


# ---------------------------------------------------------------- 执行器

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="影视剧作工坊 · 全链路 × 全风格压力测试")
    ap.add_argument("--times", type=int, default=100, help="每用例重复次数（默认 100）")
    ap.add_argument("--quick", action="store_true", help="冒烟模式：每用例 5 次")
    ap.add_argument("--json", dest="json_out", default=None, help="把报告写入 JSON 文件")
    args = ap.parse_args(argv)
    times = 5 if args.quick else max(1, args.times)

    tmp = Path(tempfile.mkdtemp(prefix="gongfang_stress_"))
    try:
        cases = build_cases(tmp)
        print(f"用例 {len(cases)} 条 × {times} 次 = {len(cases) * times} 次运行\n")
        results = []   # (group, name, n, ref_rc, stable, ms_total, first_fail_run)
        t_all0 = time.perf_counter()
        for gi, (group, name, kind, argv, allow_rc) in enumerate(cases, 1):
            ref_rc = ref_hash = ref_out = None
            done = bad_at = 0
            ms = 0.0
            runner = run if kind == "cli" else run_py
            for k in range(1, times + 1):
                t0 = time.perf_counter()
                rc, out = runner(argv)
                ms += time.perf_counter() - t0
                done = k
                h = hashlib.sha256(out.encode("utf-8", "replace")).hexdigest()
                if ref_rc is None:
                    ref_rc, ref_hash, ref_out = rc, h, out
                    if rc not in allow_rc or "Traceback" in out:
                        bad_at = k
                        break
                elif rc != ref_rc or h != ref_hash:
                    bad_at = k
                    break
            ok = (bad_at == 0)
            results.append((group, name, done, ref_rc if ref_rc is not None else -1, ok, ms, bad_at))
            if gi % 20 == 0 or gi == len(cases):
                print(f"  … {gi}/{len(cases)} 用例（累计 {time.perf_counter() - t_all0:.0f}s）")
        wall = time.perf_counter() - t_all0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    total = sum(1 for r in results if r[4])
    runs_total = sum(r[2] for r in results)
    print()
    print("═" * 62)
    verdict = "全部通过" if total == len(results) else f"{len(results) - total} 条失败"
    print(f"结论：{verdict} · {len(results)} 用例 · {runs_total} 次运行 · {wall:.1f}s")
    print("═" * 62)
    bad = [r for r in results if not r[4]]
    if bad:
        print(f"\n失败用例（{len(bad)} 条）：")
        for g, n, k, rc, _, ms, bad_at in bad:
            print(f"  ✗ [{g}] {n}：第 {bad_at} 次失稳/失败（rc={rc}，累计 {ms * 1000:.0f}ms）")
    slow = sorted(results, key=lambda r: -r[5] / max(r[2], 1))[:5]
    print("\n单次最慢 TOP5：")
    for g, n, k, rc, ok, ms, _ in slow:
        print(f"  [{g}] {n}：{ms / max(k, 1) * 1000:.1f}ms/次 rc={rc}")

    if args.json_out:
        rep = {
            "times_per_case": times, "cases": len(results), "runs": runs_total,
            "wall_seconds": round(wall, 1), "passed": total, "failed": len(results) - total,
            "results": [
                {"group": g, "name": n, "runs": k, "rc": rc, "ok": ok, "ms": round(ms, 1)}
                for g, n, k, rc, ok, ms, _ in results
            ],
        }
        Path(args.json_out).write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"\n报告已写入 {args.json_out}")
    return 0 if total == len(results) else 2


if __name__ == "__main__":
    sys.exit(main())
