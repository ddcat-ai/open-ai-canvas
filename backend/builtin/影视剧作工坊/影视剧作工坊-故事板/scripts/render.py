#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""render.py — ⑰库 JSON真源 → 全部视图一键渲染（分段独立交付模式，支持15s/10s档位）
用法: python render.py <storyboard.json> <out_dir>
产物:
  flat_prompts.txt        每行一镜完整生图 prompt（直接喂生图工具）
  flat_video.txt          每行一镜图生视频 prompt
  storyboard_table.md     完整 Markdown 分镜表（人读主视图，含 prompt 全文与🔧字段）
  E集-P段号-{档位}交付.md  每个段落独立交付文件（十章全功能自包含）
                          档位由 JSON 的 segment_tier/segment_duration 决定：15s（默认）/10s
  E集-索引汇总.md         集索引汇总文件（段落目录+整集时间轴+全片级输出）
字段协议: 以 examples/E01_storyboard.json 为准（prompt_ref/video_layers/tier/amplitude）
"""
import json, sys, os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import seg_tiers  # noqa: E402  分段档位单一真源（15s默认/10s可选）

LOCK = "面部五官、发型、服装与首帧保持完全一致，表情变化自然细腻"
STABLE = "画面稳定，无闪烁，无跳帧，人物肢体比例正常"
FLOAT = "脚步落地有声，与地面接触真实"
WALK_KW = ("走", "迈", "跑", "奔", "跪", "追")

# ---- v30 全局渲染强制条款（修复「配角不渲染/主角不真实」缺陷）----
# 背景人物/次要角色必须与主角同等精度渲染，禁止剪影化、简笔化、无脸化。
GLOBAL_RENDER = ("全局渲染：背景人物、次要角色与主角同等精度同等超写实质感渲染，"
                 "背景人物具备完整五官、皮肤毛孔肌理、发丝与服装织物细节，"
                 "禁止剪影人、简笔人、无脸人、低模背景人物；"
                 "全画面前景中景背景统一渲染精度，禁止前景精细背景粗糙")
# 扩展负面词：针对豆包/即梦默认偏3D动画风的漂移，以及背景人物简化问题
EXTRA_NEG = ("背景人物简化，剪影人物，无脸背景人物，低模背景人物，背景人物省略，前景精细背景粗糙，"
             "皮克斯风格，迪士尼风格，3D动画风格，动画电影风格，玩具质感，手办质感，游戏CG质感，塑料人偶质感，"
             "大眼卡通比例，磨皮假脸，五官过度光滑")

# ---- v30 九格黑白故事板（㉙库色彩边界铁律：故事板纯黑白）----
SB_PREFIX = ("好莱坞院线级超写实CG分镜头故事板，影视Previs预演标准，纯黑白单色阶，0饱和度无任何杂色，"
             "灰阶层次丰富明暗对比电影级，")
SB_SUFFIX = ("三点式电影布光主光45度侧前方补光35%亮度侧后方轮廓光，180度快门角度，"
             "电影级浅景深焦点锁定人物眼睛，8K超高清竖屏9:16")


# ---- 渲染引擎推断（锚点词与 validate.py 16b 保持同源，避免两处判定不一致）----
ARNOLD_ANCHORS = ("Arnold", "arnold", "阿诺德", "离线路径追踪", "路径追踪",
                  "蒙特卡洛", "ACEScg", "ACES", "XGen", "院线CG静帧")


def detect_engine(d):
    """推断全片渲染引擎分支。

    优先级：显式 render_engine 字段 > shared.prefix_full 锚点词 > 默认 ue5。
    Arnold 真源通常只靠⑰库前缀继承制体现（shared.prefix_full 每条prompt必含），
    不另设 render_engine 字段；若不从前缀推断，Arnold 真源会被误判为 ue5，
    导致第9章画风铁律与第10章九格灰阶质感（㉙库§8.3）输出错误的引擎描述。
    """
    shared = d.get("shared") or {}
    explicit = str(d.get("render_engine") or shared.get("render_engine") or "").strip().lower()
    if explicit in ("arnold", "ue5"):
        return explicit
    prefix = str(shared.get("prefix_full") or "")
    if any(w in prefix for w in ARNOLD_ANCHORS):
        return "arnold"
    return "ue5"


def branch_texture(engine):
    """㉙库§8.3：黑白稿的双分支灰阶质感区分"""
    if engine == "arnold":
        return "Arnold离线路径追踪质感，明暗过渡丝滑，软阴影层次丰富，灰阶柔和细腻，"
    return "UE5硬件光追质感，硬边清晰，明暗对比紧致，灰阶分明，"


def build_sb_prompt(s, engine):
    """㉙库§11.2：九格黑白故事板单格prompt（纯黑白，色彩留待资产阶段恢复）"""
    vl = s.get("visual_layers", {}) or {}
    space = f"前{vl.get('fg') or '—'}中{vl.get('mg') or '—'}背{vl.get('bg') or '—'}三层纵深"
    mv = (s.get("camera_move") or {}).get("type", "Static")
    return (f"{SB_PREFIX}{branch_texture(engine)}{s['shot_size']}景别，"
            f"{s.get('camera_angle') or 'Eye Level'}机位，{space}，"
            f"人物姿态与肢体语言清晰，明暗光影逻辑完整，运镜{mv}，{SB_SUFFIX}")


def build_prompt(s, shared, assets):
    """按前缀继承制拼装：prefix_full + 镜头库引用 + 资产desc_block逐字注入 + free + 全局渲染条款 + 负面词
    v30：强制注入 GLOBAL_RENDER 全局渲染条款与 EXTRA_NEG 扩展负面词（每条prompt必含，不可省略）"""
    pr = s.get("prompt_ref", {})
    body = ("镜" + str(pr.get("lib")) + "，" if pr.get("lib") else "")
    for aid in pr.get("asset_copy", []):
        blk = assets.get(aid, {}).get("desc_block") or assets.get(aid, {}).get("env_block") or ""
        body += blk + "，"
    body += pr.get("free", "")
    if pr.get("lighting"):
        body = (body.rstrip("，") + "，" if body else "") + pr["lighting"]
    return (f"{shared['prefix_full']}{body}。{GLOBAL_RENDER}。"
            f"画面干净无文字。负面：{shared['negative_global']}，{EXTRA_NEG}")


def build_video(s):
    """⑩库动点四层拼装：①主体动作 ②次级动态 ③运镜 ④环境氛围；①③全静→静帧定格"""
    L = s.get("video_layers", {}) or {}
    if not any(L.get(k) for k in ("L1", "L3")):
        return f"{s['shot_id']}：静帧定格（①③全静，不生成视频）"
    v = f"镜头{'完全静止' if L.get('L3', '静') == '静' else L['L3']}。"
    v += (L.get("L1") or "主体保持静止") + "。"
    if L.get("L2"):
        v += L["L2"] + "。"
    if L.get("L4"):
        v += L["L4"] + "。"
    amp = s.get("amplitude")
    if amp in ("极小", "小"):
        v += f"动作幅度{amp}，速度缓慢。"
    sz = s["shot_size"]
    if sz in ("CU", "ECU", "MCU") and s.get("roles"):
        v += LOCK + "。"
    if any(k in (L.get("L1") or "") for k in WALK_KW):
        v += FLOAT + "。"
    v += STABLE + "。"
    # v33（仅旁白闭唇，按方案A不注入任何朝向条款）：
    # 缺陷根因——A方案口型句原先无条件注入，只看 lip_sync=="A"，不看镜头有无画内台词。
    # 纯画外旁白(VO)镜头若标了 lip_sync="A"，会被主动要求「口型随台词自然开合」，
    # 导致旁白被画内角色说出来（用户实证缺陷）。故：A方案口型句仅跟随画内 dialogue。
    has_dlg = bool(s.get("dialogue"))
    has_vo = bool(str(s.get("vo") or "").strip())
    if has_dlg and s.get("lip_sync") == "A":
        v = "口型随台词自然开合（A方案，配音先行）。" + v
    if has_vo and not has_dlg:
        # 纯VO镜头：明确闭唇，禁止画内人物替旁白对口型
        v += ("本镜人声为画外旁白（VO），由旁白声线朗读，画内人物嘴唇保持自然闭合，"
              "禁止对口型、禁止张嘴说话、禁止口型开合。")
    elif has_vo and has_dlg:
        # VO与画内台词并存：旁白部分不对口型，仅画内台词按口型方案开合
        v += "画外旁白部分画内人物不对口型，仅画内台词按口型方案开合。"
    return f"{s['shot_id']}（{s.get('tier', '?')}）：{v}"


def render(d, out):
    os.makedirs(out, exist_ok=True)
    shared = d["shared"]
    assets = d["assets"]
    shots = d["shots"]
    ep = d.get("episode", "E00")

    fp = [build_prompt(s, shared, assets) for s in shots]
    fv = [build_video(s) for s in shots]
    open(os.path.join(out, "flat_prompts.txt"), "w", encoding="utf-8").write("\n".join(fp) + "\n")
    open(os.path.join(out, "flat_video.txt"), "w", encoding="utf-8").write("\n".join(fv) + "\n")

    # ---------- 完整 Markdown 分镜表 ----------
    HDR = ["镜号", "时长", "景别", "机位", "镜头运动(理由)", "角色/朝向", "画面描述(三层+剪影)",
           "角色/动作/微表情", "对白/旁白/音效", "转场", "叙事功能", "资产ID", "AI生图Prompt",
           "图生视频Prompt", "画面备注"]
    rows = []
    for s in shots:
        mv = s.get("camera_move", {})
        mv_s = mv.get("type", "-") + (f"（{mv['motive']}）" if mv.get("motive") else "")
        vl = s.get("visual_layers", {})
        vis = f"前:{vl.get('fg') or '—'}｜中:{vl.get('mg') or '—'}｜背:{vl.get('bg') or '—'}"
        if s.get("silhouette"):
            vis += f"｜剪影:{s['silhouette']}"
        roles = "、".join(s.get("roles", [])) or "—"
        me = f" {s['micro_expr']}" if s.get("micro_expr") else ""
        act = roles + me
        au = []
        for dl in s.get("dialogue", []):
            off = "（画外）" if dl.get("offscreen") else ""
            au.append(f"{dl.get('who','')}:{dl.get('text','')}{off}[口型{dl.get('lip','?')}]")
        if s.get("vo"):
            au.append(f"VO:{s['vo']}")
        for sfx in s.get("sfx", []):
            au.append(f"SFX:{sfx}")
        tr = s.get("transition_out") or {}
        tr_s = tr.get("type", "-") + (f"@{tr['ref']}" if tr.get("ref") else "")
        cp = s.get("cut_point")
        note = s.get("notes") or ""
        if cp:
            note = (note + "；" if note else "") + f"切点:{cp}"
        if s.get("exemption"):
            note = (note + "；" if note else "") + f"豁免:{s['exemption']}"
        if s.get("transition_note"):
            note = (note + "；" if note else "") + f"跳级理由:{s['transition_note']}"
        rows.append([s["shot_id"], f"{s['duration_s']}s", s["shot_size"],
                     s.get("camera_angle") or "-", mv_s, f"{s.get('blocking_facing') or '—'} {s.get('move_arrow') or ''}",
                     vis, act, "；".join(au) or "—", tr_s, s.get("narrative_func") or "-",
                     "、".join(s.get("assets", [])) or "—", build_prompt(s, shared, assets),
                     build_video(s), note or "—"])
    tbl = ["| " + " | ".join(HDR) + " |", "|" + "---|" * len(HDR)]
    for r in rows:
        tbl.append("| " + " | ".join(str(c).replace("|", "\\|").replace("\n", " ") for c in r) + " |")
    open(os.path.join(out, "storyboard_table.md"), "w", encoding="utf-8").write("\n".join(tbl) + "\n")

    # ---------- 分段独立交付文件（档位由 seg_tiers 决定：15s默认/10s可选）----------
    by_id = {s["shot_id"]: s for s in shots}
    seg_docs, rows_idx = {}, []
    tl_acc = 0.0
    time_rows = []
    seg_dir = os.path.join(out, "segments")
    os.makedirs(seg_dir, exist_ok=True)
    SEG_LO, SEG_HI, SEG_TAIL_MAX, SEG_TARGET, SEG_SUFFIX = seg_tiers.bounds(d)
    SEG_TIER_KEY = seg_tiers.resolve_tier(d)
    SEG_TIER_LABEL = seg_tiers.tier(d)["label"]

    for i, seg in enumerate(d.get("segments", []), start=1):
        ss = [by_id[x] for x in seg["shots"]]
        dur = sum(x["duration_s"] for x in ss)
        seg_id = seg.get("id", f"P{i:02d}")
        filename = seg_tiers.seg_filename(ep, seg_id, d)
        
        # 构建十章交付内容
        lines = [f"# {ep} {seg_id} {SEG_TIER_LABEL}交付文件", ""]
        
        # 1. 段头卡
        lines += ["## 1. 段头卡", f"- 段落编号：{ep}-{seg_id}", 
                  f"- 时间范围：{tl_acc:.1f}s-{tl_acc+dur:.1f}s",
                  f"- 核心功能：{seg.get('hook', '情节推进')}",
                  f"- 关键资产：{', '.join(sorted(set(a for s in ss for a in s.get('assets', []))))}", ""]
        
        # 2. 分镜表
        lines += ["## 2. 分镜表", "| " + " | ".join(HDR) + " |", "|" + "---|" * len(HDR)]
        for s in ss:
            mv = s.get("camera_move", {})
            mv_s = mv.get("type", "-") + (f"（{mv['motive']}）" if mv.get("motive") else "")
            vl = s.get("visual_layers", {})
            vis = f"前:{vl.get('fg') or '—'}｜中:{vl.get('mg') or '—'}｜背:{vl.get('bg') or '—'}"
            if s.get("silhouette"):
                vis += f"｜剪影:{s['silhouette']}"
            roles = "、".join(s.get("roles", [])) or "—"
            me = f" {s['micro_expr']}" if s.get("micro_expr") else ""
            act = roles + me
            au = []
            for dl in s.get("dialogue", []):
                off = "（画外）" if dl.get("offscreen") else ""
                au.append(f"{dl.get('who','')}:{dl.get('text','')}{off}[口型{dl.get('lip','?')}]")
            if s.get("vo"):
                au.append(f"VO:{s['vo']}")
            for sfx in s.get("sfx", []):
                au.append(f"SFX:{sfx}")
            tr = s.get("transition_out") or {}
            tr_s = tr.get("type", "-") + (f"@{tr['ref']}" if tr.get("ref") else "")
            cp = s.get("cut_point")
            note = s.get("notes") or ""
            if cp:
                note = (note + "；" if note else "") + f"切点:{cp}"
            if s.get("exemption"):
                note = (note + "；" if note else "") + f"豁免:{s['exemption']}"
            if s.get("transition_note"):
                note = (note + "；" if note else "") + f"跳级理由:{s['transition_note']}"
            row = [s["shot_id"], f"{s['duration_s']}s", s["shot_size"],
                   s.get("camera_angle") or "-", mv_s, f"{s.get('blocking_facing') or '—'} {s.get('move_arrow') or ''}",
                   vis, act, "；".join(au) or "—", tr_s, s.get("narrative_func") or "-",
                   "、".join(s.get("assets", [])) or "—", build_prompt(s, shared, assets),
                   build_video(s), note or "—"]
            lines.append("| " + " | ".join(str(c).replace("|", "\\|").replace("\n", " ") for c in row) + " |")
        lines.append("")
        
        # 3. 黑白故事板（九格）（v46：应用户要求从第10章提至第3章·㉙库色彩边界铁律：仅故事板黑白）
        engine = detect_engine(d)   # v32：从前缀推断，Arnold真源不再被误判为ue5
        lines += ["## 3. 黑白故事板·九格（㉙库·纯黑白0饱和度，直接投喂生图工具）", ""]
        lines += ["> 色彩边界铁律：本表为全片**唯一黑白产出**；定妆图/场景资产/生图静帧/视频/成片一律彩色。"]
        lines += ["> 本表只锁定明暗光影逻辑+空间结构+构图+姿态+节奏；色彩在资产生成阶段恢复。", ""]
        n_shots = len(ss)
        for gi, s in enumerate(ss, start=1):
            lines += [f"**格{gi}｜{s['shot_id']}｜{s.get('narrative_func','')}**"]
            lines += ["```" + build_sb_prompt(s, engine) + "```", ""]
        if n_shots < 9:
            lines += [f"> 本段{n_shots}镜，占用九格前{n_shots}格；第{n_shots+1}-9格留白静帧（黑白纯灰底，无内容），"
                      f"保持九宫格版式完整。"]
        lines += [""]

        # 4. 段Reel时间轴
        lines += ["## 4. 段Reel时间轴", "```"]
        seg_tl = 0.0
        for s in ss:
            bar = "▓" * max(1, round(s["duration_s"] * 2))
            lines.append(f"{seg_tl:05.1f}-{seg_tl+s['duration_s']:05.1f}  {s['shot_id']}  {s['shot_size']}  {s['duration_s']}s  {bar}  {s.get('narrative_func','')}")
            seg_tl += s["duration_s"]
        lines += [f"```", f"总时长：{dur:.1f}s", ""]
        
        # 5. 生图Prompt集
        lines += ["## 5. 生图Prompt集"]
        for s in ss:
            lines.append(f"**{s['shot_id']}**：")
            lines.append(f"```{build_prompt(s, shared, assets)}```")
        lines.append("")
        
        # 6. 图生视频Prompt集
        lines += ["## 6. 图生视频Prompt集"]
        for s in ss:
            lines.append(f"**{s['shot_id']}**：{build_video(s)}")
        lines.append("")
        
        # 7. 配音台本+BGM Cue表
        lines += ["## 7. 配音台本+BGM Cue表"]
        for s in ss:
            for dl in s.get("dialogue", []):
                off = "（画外）" if dl.get("offscreen") else ""
                lines.append(f"- {s['shot_id']} {dl.get('who','')}{off}：{dl.get('text','')} [口型{dl.get('lip','?')}]")
            if s.get("vo"):
                # v33：VO 明确标注为画外旁白，由旁白声线朗读，画内人物不对口型
                lines.append(f"- {s['shot_id']} VO（画外旁白·旁白声线朗读·画内人物不对口型、嘴唇闭合）：{s['vo']}")
            for sfx in s.get("sfx", []):
                lines.append(f"- {s['shot_id']} SFX：{sfx}")
        lines.append("")
        
        # 8. 本段资产清单
        lines += ["## 8. 本段资产清单"]
        seg_assets = set(a for s in ss for a in s.get("assets", []))
        for aid in sorted(seg_assets):
            aname = assets.get(aid, {}).get("name", "未命名")
            lines.append(f"- {aid}：{aname}")
        lines.append("")
        
        # 9. 本段自检清单（v30：追加全局渲染与风格锚定检查）
        lines += ["## 9. 本段自检清单",
                  "- [ ] A层叙事自检：本段是否通过剪影测试/三问自检/一镜一信息",
                  "- [ ] B层镜头语法自检：本段是否遵守轴线/景别过渡/三层纵深",
                  "- [ ] C层风格自检：本段Prompt是否完整/微表情引用/转场引用",
                  "- [ ] D层声音自检：本段台词长度反检/声画同步",
                  f"- [ ] 段长合规（{SEG_TIER_LABEL}档·目标{SEG_TARGET:g}s）：{seg_tiers.tolerance_text(d)}",
                  "- [ ] v22切割规则：段边界是否落在镜头边界（未切在镜头中间）",
                  "- [ ] **全局渲染（v30强制）**：每条生图prompt是否含「全局渲染」条款（背景人物同等精度）",
                  "- [ ] **扩展负面词（v30强制）**：是否含皮克斯/迪士尼/3D动画/剪影人/无脸背景人物等禁词",
                  "- [ ] **渲染分支一致**：本段渲染引擎与全剧锁定分支一致（未混用UE5/Arnold）",
                  "- [ ] **黑白边界（㉙库）**：故事板为纯黑白；本段生图/视频产出为彩色（未误设黑白）", ""]

        # 10. 渲染风格与工具适配（v30新增：主程序条款全量内嵌，交付包自包含；v46 顺延为第10章）
        style_law = (
            "Arnold 7.3离线物理路径追踪超写实（蒙特卡洛采样+ACEScg 1.2+三层SSS生物皮肤+XGen毛发+"
            "100%物理软阴影+Film Grain 0.025），禁止卡通/二次元/皮克斯/迪士尼/3D动画风/玩具手办质感，"
            "禁止UE5冷硬质感/实时引擎干涩质感/游戏质感"
            if engine == "arnold" else
            "UE5次世代超写实（Lumen GI+Nanite+PBR+SSS皮肤+实体发丝），"
            "禁止卡通/二次元/皮克斯/迪士尼/3D动画风/玩具手办质感"
        )
        lines += ["## 10. 渲染风格与工具适配（自包含·直接照抄执行）", ""]
        lines += ["### 10.1 渲染引擎与风格锚定（主程序强制条款）"]
        lines += [f"- 渲染引擎分支：**{engine}**（全剧唯一，禁止中途切换/混用）"]
        lines += [f"- 统一基础前缀（每条生图prompt必含，一字不改）：`{shared.get('prefix_full','')}`"]
        lines += [f"- 全局渲染强制条款（v30·每条prompt必含）：{GLOBAL_RENDER}"]
        lines += [f"- 扩展负面词（v30·每条prompt必含）：{EXTRA_NEG}"]
        lines += [f"- 风格基准：{shared.get('style_base', '（见⑤库29种基准A-AC）')}"]
        lines += [f"- 画风铁律：{style_law}"]
        lines += [""]
        lines += ["### 10.2 豆包生图参数（⑱库实测档 2026-09，开工前复核）"]
        lines += ["- 模型：**Seedream 5.0 Pro**（写实人物与材质增强）；量产场景帧可用 5.0"]
        lines += ["- 画幅：**9:16 竖屏**（2K档 2160×3840，1080p交付用1080×1920后放大）"]
        lines += ["- 参考图：角色定妆图挂「参考图」位，**权重60-70%**（过高僵硬/过低跑偏）"]
        lines += ["- 投喂方式：负面词单独放「不想要」栏；无栏则前置「禁止：」并入尾部"]
        lines += ["- 执行协议：**串行+单条+失败登记**（禁止并发批量，实测并发4条1成3败）"]
        lines += ["- 预算：静图3-5张选1（复杂镜头8-10）；返修优先**局部重绘**>微调prompt>换seed>换工具"]
        lines += ["- 长prompt遵循变差时：场景信息置后、前缀+主体置前"]
        lines += [""]
        lines += ["### 10.3 即梦视频参数（⑱库实测档 2026-09，开工前复核）"]
        lines += ["- 模型：**Seedance 2.0 / Pro**（图片基座 Seedream 5.0 Lite）"]
        lines += ["- 时长档：5s主档 / 10s档 / >10s首尾帧拆段（建议8s内/段）"]
        lines += ["- 首尾帧：同比例同分辨率、主体位置对齐、禁用完全相同图；建议时长≤10s"]
        lines += ["- 运镜：专业运镜指令（推/拉/摇/移）+速度档；标准模式=慢动作，流畅模式=高动态"]
        lines += ["- 口型：需真口型镜头用2.0原生音视频同步（配音先行）；全集A方案≤3个"]
        lines += ["- 多参考：最多12个参考文件复刻运镜与角色"]
        lines += ["- 全剧锁死：画幅9:16 / 24或30fps二选一 / 交付1080×1920"]
        lines += [""]

        seg_docs[filename] = "\n".join(lines)
        rows_idx.append(f"| {seg_id} | {dur:.1f}s | {len(ss)}镜 | {seg.get('hook', '')} | "
                        f"{'✓' if SEG_LO <= dur <= SEG_HI or seg.get('tail_exempt') or seg.get('short_exempt') else '⚠️复核'} |")
        for x in ss:
            time_rows.append((tl_acc, tl_acc + x["duration_s"], x))
            tl_acc += x["duration_s"]
    
    # 写入独立的分段交付文件（文件名按档位）
    for fname, content in seg_docs.items():
        with open(os.path.join(seg_dir, fname), "w", encoding="utf-8") as f:
            f.write(content)
    
    # 同时保留 all.md 作为合并视图（向后兼容）
    if seg_docs:
        with open(os.path.join(seg_dir, "all.md"), "w", encoding="utf-8") as f:
            for k in sorted(seg_docs):
                f.write(seg_docs[k] + "\n\n---\n\n")

    # ---------- v21: 集索引汇总文件（E集-索引汇总.md） ----------
    idx = [f"# {d['series']} {ep} 集索引汇总（render.py 自动生成）",
           f"内容总时长 {sum(x['duration_s'] for x in shots):.1f}s ｜ 镜头 {len(shots)} ｜ 分段 {len(d.get('segments', []))}", ""]
    
    # 段落目录
    if d.get("segments"):
        idx += ["## 段落目录", "| 段号 | 段长 | 镜数 | 段钩 | 容差 |", "|---|---|---|---|---|"] + rows_idx + [""]
    
    # 整集时间轴
    idx += ["## 整集时间轴（Reel 模拟）", "```"]
    for st, en, x in time_rows:
        bar = "▓" * max(1, round((en - st) * 2))
        idx.append(f"{st:05.1f}-{en:05.1f}  {x['shot_id']}  {x['shot_size']}  {x['duration_s']}s  {bar}  {x.get('narrative_func','')}")
    idx.append("```")
    
    # 全片级输出占位（需人工填写）
    idx += ["", "## 全片级输出", 
            "- 卡点表：（需人工填写，参考⑬库）",
            "- 世界观宪法：（架空题材需人工填写，参考⑭库）",
            "- 季账四表回填：（需人工填写，参考⑲库）", ""]
    
    # 整集资产清单
    idx += ["## 整集资产清单"]
    all_assets = set(a for s in shots for a in s.get("assets", []))
    for aid in sorted(all_assets):
        aname = assets.get(aid, {}).get("name", "未命名")
        idx.append(f"- {aid}：{aname}")
    idx.append("")
    
    # 整集体检表占位（需人工填写）
    idx += ["## 整集体检表", "- 六维评分矩阵：（需人工填写，参考⑮库）",
            "- 均分：（需人工填写）", "- 返工清单：（需人工填写）", ""]
    
    # 生效库版本清单
    idx += ["## 本次生效库版本清单", "- ⑤库风格基准：29种（A-AC）",
            "- ㉕库角色资产：214个（M-01~M-100, F-01~F-114·含14个扩展样本）",
            "- 其他库版本：（需人工填写）", ""]
    
    idx_filename = f"{ep}-索引汇总.md"
    open(os.path.join(out, idx_filename), "w", encoding="utf-8").write("\n".join(idx) + "\n")
    
    # 同时保留 index.md 作为向后兼容
    open(os.path.join(out, "index.md"), "w", encoding="utf-8").write("\n".join(idx) + "\n")

    print(f"OK -> {out}: flat_prompts.txt({len(fp)}) flat_video.txt({len(fv)}) "
          f"storyboard_table.md({len(rows)}行) segments/{len(seg_docs)}个独立交付文件 {idx_filename}")


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    render(json.load(open(sys.argv[1], encoding="utf-8")), sys.argv[2])
