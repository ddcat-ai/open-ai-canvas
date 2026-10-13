#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""regression.py — E01 回归协议（可执行）：修订规则后重跑 validate+render 与基线做 diff
用法:
  python regression.py                 # 校验+渲染+与基线 diff（差异≠0 则退出码1）
  python regression.py --rebuild       # 以本次输出刷新基线（规则修订确认为预期时使用）
  python regression.py --ledger        # 追加季账校验（validate --ledger series_ledger_E01.json）
产物: 基线目录 = examples/E01_render_out/（validate 结果为文本回显，不落基线）
"""
import argparse
import filecmp
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import seg_tiers  # noqa: E402  分段档位单一真源（15s默认/10s可选）
ROOT = os.path.dirname(HERE)                       # 技能包根
SB = os.path.join(ROOT, "examples", "E01_storyboard.json")
LEDGER = os.path.join(ROOT, "examples", "series_ledger_E01.json")
BASELINE = os.path.join(ROOT, "examples", "E01_render_out")
# v38 多题材金标准：E02战斗/E03群戏/E04换装道具（紧凑fixture，仅机检门；
# E01 仍承担完整 render+diff+交付完整性门）
FIXTURES = [os.path.join(ROOT, "examples", f"{e}_storyboard.json")
            for e in ("E02", "E03", "E04", "E05")]
# v21/v22 起 render.py 额外产出「E集-P段号-15s交付.md」与「E集-索引汇总.md」，
# 段号随分段变化，故不再硬编码清单，改为动态发现两侧目录的全部渲染产物取并集，
# 确保新交付文件同样处于回归保护范围内（漏检=新产物渲染错误无人发现）。
RENDER_FILES_LEGACY = ["flat_prompts.txt", "flat_video.txt", "storyboard_table.md",
                       "segments/all.md", "index.md"]


def discover_render_files(*dirs):
    """收集若干目录下全部相对文件路径的并集（按相对路径排序，保证 diff 稳定可比）。"""
    rels = set()
    for d in dirs:
        if not os.path.isdir(d):
            continue
        for root, _sub, files in os.walk(d):
            for fn in files:
                rels.add(os.path.relpath(os.path.join(root, fn), d).replace(os.sep, "/"))
    return sorted(rels)


def run(args, cwd=ROOT):
    # 用 sys.executable 而非裸 "python"：避免 PATH 中 WindowsApps 空壳 python 导致 9009
    r = subprocess.run([sys.executable] + args, cwd=cwd, capture_output=True, text=True, encoding="utf-8")
    return r.returncode, (r.stdout or "") + (r.stderr or "")


def check_delivery(tmp):
    """[4/4] v30 交付完整性门：每个交付包必须全功能自包含。
    强制项：①每条生图prompt含全局渲染条款+扩展负面词；②每个分段交付文件含十章结构
    （v46新序：§3黑白故事板九格、§10渲染风格与工具适配）；③九格章节含黑白色彩边界声明；
    ④十章顺序必须为 1段头卡→2分镜表→3黑白故事板→…→10渲染风格与工具适配。
    v35：交付文件名后缀按档位（15s/10s）动态匹配，不再硬编码 -15s交付.md。"""
    errs = []
    # 所有档位的交付文件后缀（如 15s交付 / 10s交付），任一匹配即为分段交付文件
    seg_suffixes = tuple(f"-{t['suffix']}.md" for t in seg_tiers.SEG_TIERS.values())
    fp = os.path.join(tmp, "flat_prompts.txt")
    if os.path.exists(fp):
        for i, line in enumerate(open(fp, encoding="utf-8"), 1):
            line = line.strip()
            if not line:
                continue
            if "全局渲染" not in line:
                errs.append(f"flat_prompts.txt 第{i}行缺全局渲染强制条款")
            if "皮克斯风格" not in line:
                errs.append(f"flat_prompts.txt 第{i}行缺扩展负面词（防卡通漂移）")
    else:
        errs.append("缺 flat_prompts.txt")
    seg_dir = os.path.join(tmp, "segments")
    if os.path.isdir(seg_dir):
        n_seg = 0
        for fn in sorted(os.listdir(seg_dir)):
            if not fn.endswith(seg_suffixes):
                continue
            n_seg += 1
            txt = open(os.path.join(seg_dir, fn), encoding="utf-8").read()
            for sec, label in (("## 3. 黑白故事板·九格", "§3黑白故事板九格"),
                               ("## 10. 渲染风格与工具适配", "§10渲染风格与工具适配"),
                               ("全局渲染", "全局渲染条款"),
                               ("Seedream", "豆包参数"),
                               ("Seedance", "即梦参数"),
                               ("纯黑白单色阶", "黑白色彩边界声明")):
                if sec not in txt:
                    errs.append(f"{fn} 缺{label}")
            # v46：十章顺序硬校验（黑白故事板提到第3章，渲染风格与工具适配顺延为第10章）
            order_keys = ["## 1. 段头卡", "## 2. 分镜表", "## 3. 黑白故事板·九格",
                          "## 4. 段Reel时间轴", "## 5. 生图Prompt集", "## 6. 图生视频Prompt集",
                          "## 7. 配音台本+BGM Cue表", "## 8. 本段资产清单", "## 9. 本段自检清单",
                          "## 10. 渲染风格与工具适配"]
            pos = [txt.find(k) for k in order_keys]
            if any(p < 0 for p in pos) or pos != sorted(pos):
                errs.append(f"{fn} 十章结构顺序错误（应为1段头卡→2分镜表→3黑白故事板→…→10渲染风格与工具适配）")
        if n_seg == 0:
            errs.append("segments/ 下无15秒交付文件")
    else:
        errs.append("缺 segments/ 目录")
    return errs


def diff_trees(bl, new):
    diffs = []
    for rel in discover_render_files(bl, new):
        a, b = os.path.join(bl, rel), os.path.join(new, rel)
        if not os.path.exists(b):
            diffs.append(f"NEW 缺失基线 {rel}")
            continue
        if not os.path.exists(a):
            diffs.append(f"基线缺失新产物 {rel}（--rebuild 收录）")
            continue
        if not filecmp.cmp(a, b, shallow=False):
            diffs.append(f"DIFF {rel}")
    return diffs


def main():
    ap = argparse.ArgumentParser(description="E01 回归协议（validate+render vs 基线）")
    ap.add_argument("--rebuild", action="store_true", help="以本次输出刷新基线")
    ap.add_argument("--ledger", action="store_true", help="追加季账校验")
    args = ap.parse_args()

    print("== [1/7] validate E01 ==")
    vc, vout = run([os.path.join(HERE, "validate.py"), SB] +
                   (["--ledger", LEDGER] if args.ledger else []))
    print(vout, end="")
    if vc != 0:
        print("回归中止：validate FAIL")
        return 2

    print("== [2/7] render ==")
    tmp = tempfile.mkdtemp(prefix="e01_reg_")
    rc, rout = run([os.path.join(HERE, "render.py"), SB, tmp])
    print(rout.replace(tmp, "（回归临时目录）"), end="")   # 抹掉随机路径，保证输出逐次确定
    if rc != 0:
        print("回归中止：render 失败")
        shutil.rmtree(tmp, ignore_errors=True)
        return 2

    print("== [3/7] diff vs baseline ==")
    if not os.path.exists(BASELINE):
        shutil.copytree(tmp, BASELINE)
        print(f"无基线，已建立: {BASELINE}")
        shutil.rmtree(tmp, ignore_errors=True)
        return 0
    diffs = diff_trees(BASELINE, tmp)
    if diffs and not args.rebuild:
        print("\n".join(f"[DIFF] {x}" for x in diffs))
        print("回归未通过：与基线存在差异。确认差异为预期规则变更后用 --rebuild 刷新基线。")
        shutil.rmtree(tmp, ignore_errors=True)
        return 1
    if diffs and args.rebuild:
        print("\n".join(f"[DIFF] {x}" for x in diffs))

    print("== [4/7] 交付完整性门（v30）==")
    derr = check_delivery(tmp)
    if derr:
        print("\n".join(f"[FAIL] {x}" for x in derr))
        print("回归中止：交付包不全功能自包含")
        shutil.rmtree(tmp, ignore_errors=True)
        return 1
    print("交付完整性 PASS：全局渲染条款+十章结构+九格黑白故事板 全数就位")

    # v38 多题材金标准机检门：E02战斗/E03群戏/E04换装道具（v43 每例追加卷积校验评分门）
    print("== [5/7] 多题材金标准机检+卷积校验（E02战斗/E03群戏/E04换装道具/E05合规正例）==")
    fx_fail = 0
    for fx in FIXTURES:
        fc, fout = run([os.path.join(HERE, "validate.py"), fx])
        tail = [l for l in (fout or "").splitlines() if l.startswith("RESULT")]
        print(f"  {os.path.basename(fx)}: {tail[-1] if tail else f'exit={fc}'}")
        if fc != 0:
            fx_fail += 1
            continue
        # v43 卷积校验（㊴库文本规则仿真）：金标准风格评分必须达放行线（默认90）
        cc, cout = run([os.path.join(HERE, "cnn_style_check.py"), fx, "--json"])
        try:
            rep = json.loads(cout)
            print(f"    卷积校验: 得分 {rep['episode_score']} 判定 {rep['verdict']}")
        except Exception:
            print(cout, end="")
        if cc != 0:
            fx_fail += 1
    if fx_fail:
        print("回归中止：多题材金标准机检/卷积校验 FAIL（返修查㉝库处方）")
        shutil.rmtree(tmp, ignore_errors=True)
        return 1
    print("多题材金标准 PASS：战斗/群戏/换装道具/合规正例四线机检+卷积评分全部达标")

    # v38 mutation 抓捕率门：注入缺陷必须全部被机检捕获（防"声称≠实现"与回滚无人察觉）
    print("== [6/7] mutation 抓捕率门（v38）==")
    mc, mout = run([os.path.join(HERE, "mutation_test.py")])
    print(mout, end="")
    if mc != 0:
        print("回归中止：存在漏抓用例")
        shutil.rmtree(tmp, ignore_errors=True)
        return 1

    # v42 元数据一致性门：库总数/库文件/库编号/导演卡数等手工同步点必须机检一致
    print("== [7/7] 元数据一致性门（v42 check_consistency）==")
    cc, cout = run([os.path.join(HERE, "check_consistency.py")])
    print(cout, end="")
    if cc != 0:
        print("回归中止：技能包元数据不一致（加库/加卡后漏改同步点，详见 C1-C6 提示）")
        shutil.rmtree(tmp, ignore_errors=True)
        return 1

    if diffs and args.rebuild:
        shutil.rmtree(BASELINE)
        shutil.copytree(tmp, BASELINE)
        print("--rebuild：基线已刷新")
    elif not diffs:
        print("回归通过：validate PASS 且 render 输出与基线完全一致。")
    shutil.rmtree(tmp, ignore_errors=True)
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
