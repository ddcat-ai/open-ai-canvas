#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""validate.py — ⑰库机检清单 + ⑲季账机读化 自动校验（唯一交稿闸门）
用法:
  python validate.py <storyboard.json>                      # 九项机检（含段边界/总时长）
  python validate.py <storyboard.json> --ledger <ledger.json>  # 追加季账三条：死人出场/知情时序/伏笔超期/上集钩子回应
退出码: 0=通过(FAIL=0) 1=有FAIL（逐条打印，WARN 不阻断）
字段协议: 以 examples/E01_storyboard.json 为准（prompt_ref/video_layers/micro_expr/dialogue[].lip/assets[]）
"""
import json, sys, os, re, argparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import seg_tiers  # noqa: E402  分段档位单一真源（15s默认/10s可选）

# ---- 常量（与 SKILL 第二章法则表/⑧库量化表/⑫库口型名额一致） ----
SIZE_ORDER = ["EWS", "WS", "FS", "MS", "MCU", "CU", "ECU"]  # INS 不计级
DUR_RANGE = {  # (min,max) 景别量化区间；骤停豁免上限但受 8s 红线
    "EWS": (3, 8), "WS": (3, 8), "FS": (3, 8), "MS": (2, 5),
    "MCU": (1, 3), "CU": (1, 3), "ECU": (0.5, 3), "INS": (0.5, 3)}
HARD_8 = 8.0            # 平台硬红线
A_LIP_CAP = 3           # ⑫库口型A方案全集名额
MAX_SAME_MODE = 8       # ⑧库连续同节奏模式上限
MAX_DURATION_MODE = 2   # 骤停镜全集上限
TOTAL_TOL = 0.05        # 总时长 ±5%
M_RE = re.compile(r"^M\d{2}$")
T_RE = re.compile(r"^T\d{1,3}$")
EP_RE = re.compile(r"^E(\d{1,3})$")
FO_OVERDUE = 5          # ⑲库伏笔超期预警阈值（距计划引爆集 >5 集未动作）
DIRECT_CUTS = ("Cut", "Jump Cut", "Smash Cut", "Match Cut")

# ---- ㊱导演风格库卡表（v41；卡数由 scripts/check_consistency.py 与库文件校对，勿单方增删） ----
# keys: style_base 命中任一关键词即视为挂载该卡；head/tail: ⑦段正向块首尾锚（head命中+tail缺失 = 风格块被改写/截断）
DIRECTOR_CARDS = {
    "卡一": {"name": "诺兰", "keys": ["诺兰", "Nolan", "卡一"],
             "head": "Nolan movie style", "tail": "ultra HD comic drama texture",
             "blacklist": ["二次元卡通", "动漫夸张滤镜", "马卡龙", "刺眼霓虹光", "画面惨白过亮", "快闪抖动镜头"]},
    "卡二": {"name": "陈凯歌", "keys": ["陈凯歌", "Chen Kaige", "卡二"],
             "head": "Chen Kaige epic cinema style", "tail": "melancholic grandeur",
             "blacklist": ["日式和风", "浮世绘", "和服", "樱花", "赛博霓虹", "玻璃幕墙", "古风厚涂", "舞台追光"]},
    "卡三": {"name": "张艺谋", "keys": ["张艺谋", "Zhang Yimou", "卡三"],
             "head": "Zhang Yimou color symbolism style", "tail": "ceremonial physicality",
             "blacklist": ["彩虹渐变", "糖果色", "赛博光污染", "玻璃幕墙", "日式配色"]},
    "卡四": {"name": "王家卫", "keys": ["王家卫", "Wong Kar-wai", "Wong Kar-wai", "卡四"],
             "head": "Wong Kar-wai urban romance style", "tail": "sense of missed timing",
             "blacklist": ["冷白医疗光", "三脚架", "日系小清新", "阳光明媚", "高清无噪点"]},
    "卡五": {"name": "维伦纽瓦", "keys": ["维伦纽瓦", "Villeneuve", "卡五"],
             "head": "Denis Villeneuve sci-fi style", "tail": "solemn silence",
             "blacklist": ["霓虹", "快剪", "手持晃动", "阳光明媚", "小清新"]},
    "卡六": {"name": "韦斯·安德森", "keys": ["韦斯", "Wes Anderson", "卡六"],
             "head": "Wes Anderson style", "tail": "whimsical melancholy",
             "blacklist": ["暗调", "写实血腥", "赛博", "恐怖元素", "破败脏乱"]},
    "卡七": {"name": "塔尔科夫斯基", "keys": ["塔尔科夫斯基", "Tarkovsky", "卡七"],
             "head": "Andrei Tarkovsky style", "tail": "9:16 vertical cinematic",
             "blacklist": ["高饱和", "卡通渲染", "赛博霓虹", "磨皮假脸",
                           "无来源光斑", "飘落羽毛", "焦点发虚", "快速剪辑"]},
}
# ---- 合规红线词表（㉜库§〇.3 血液视觉 / ㊲库合规红线） ----
CLOSE_SIZES = {"MCU", "CU", "ECU", "INS"}          # 近景/特写（INS=插入特写同列）
BLOOD_VISUAL = ["血迹", "鲜血", "流血", "血污", "喷血", "血腥", "血水", "血淋", "血肉"]
RELIGION_SYMBOLS = ["十字架", "圣经", "佛像", "诵经", "弥撒", "祭坛", "符咒"]
CHILD_WORDS = ["儿童", "小孩", "女童", "男童", "婴儿", "幼童"]
HARM_WORDS = ["伤害", "伤口", "虐待", "殴打", "勒颈", "刀伤", "血迹", "鲜血"]

# 内置默认编号范围（库文件缺失/未定位时的回退）
FALLBACK_M = {f"M{i:02d}" for i in range(1, 97)}
FALLBACK_T = {f"T{i:02d}" for i in range(1, 101)}

# ---- ㉖库参考图模式：强制锚定句与人物外形描述禁令（--strict-ref，模式C） ----
STRICT_ANCHOR_KEY = "人物外形严格锁定参考图"   # ㉖库§8.3 强制锚定句关键片段
# ㉖库§8.1 禁止描述清单：视频Prompt中绝对禁止出现的人物外形词
FORBIDDEN_LOOK_WORDS = (
    "大眼睛", "高鼻梁", "薄唇", "丹凤眼", "桃花眼", "杏眼",
    "冷白皮", "小麦色", "瓷白", "白皙", "苍白",
    "黑色长发", "长卷发", "卷发", "马尾", "短发", "寸头", "背头",
    "白色连衣裙", "西装", "古装", "汉服", "连衣裙", "长裙", "旗袍", "铠甲",
    "180cm", "185cm", "186cm", "瘦削", "纤细", "丰满", "魁梧",
    "耳环", "项链", "眼镜", "发簪", "步摇", "凤冠",
)

# ---- ㉗库Arnold渲染模式：引擎互斥术语校验（--render-engine arnold） ----
# 16a Arnold模式prompt中禁止出现的UE5术语
UE5_FORBIDDEN_IN_ARNOLD = ("UE5", "ue5", "Lumen", "lumen", "Nanite", "nanite",
                           "虚幻引擎", "虚幻5", "Unreal", "unreal", "Unity", "unity",
                           "实时渲染", "硬件光追", "时序超分", "TSSR")
# 16b Arnold模式prompt必须包含的锚点词（至少命中其一）
ARNOLD_ANCHORS = ("Arnold", "arnold", "阿诺德", "离线路径追踪", "路径追踪",
                  "蒙特卡洛", "ACEScg", "ACES", "XGen", "院线CG静帧")
# 16c Arnold模式负面词必须包含的互斥声明（至少命中其一）
ARNOLD_NEGATIVE_REQUIRED = ("UE5冷硬质感", "实时引擎干涩质感", "游戏质感")
# 16e Arnold采样参数硬锁定值（㉗库§1.2）
ARNOLD_SAMPLING_LOCK = {
    "camera_aa": 8, "diffuse": 6, "specular": 6, "transmission": 6,
    "shadow": 5, "sss": 7, "hair": 4, "indirect": 6,
}
# 16f Arnold色彩空间
ARNOLD_COLOR_SPACE = "ACEScg"
# UE5模式下反向禁止的Arnold术语（混用防线，双向）
ARNOLD_FORBIDDEN_IN_UE5 = ("Arnold", "arnold", "阿诺德", "离线路径追踪",
                           "蒙特卡洛", "XGen", "ACEScg")


def _lib_root():
    """脚本位于 <技能包>/scripts/ 下 → 返回技能包根目录；找不到返回 None。"""
    p = os.path.dirname(os.path.abspath(__file__))
    if os.path.basename(p) == "scripts":
        return os.path.dirname(p)
    return None


def load_m_set(root):
    """从 microexpression-library.md 解析合法 M 编号（动态跟随库版本）。"""
    if root:
        p = os.path.join(root, "microexpression-library.md")
        if os.path.exists(p):
            txt = open(p, encoding="utf-8").read()
            s = {m.group() for m in re.finditer(r"\bM\d{2}\b", txt)}
            if s:
                return s
    return set(FALLBACK_M)


def load_t_set(root):
    """从 transitions-library.md 解析合法 T 编号。"""
    if root:
        p = os.path.join(root, "transitions-library.md")
        if os.path.exists(p):
            txt = open(p, encoding="utf-8").read()
            s = {m.group() for m in re.finditer(r"\bT\d{1,3}\b", txt)}
            if s:
                return s
    return set(FALLBACK_T)


def ep_num(ep):
    m = EP_RE.match(ep or "")
    return int(m.group(1)) if m else None


def shot_video_text(s):
    """单镜「视频Prompt」作用域文本（㉖库§8.1/§8.3 的禁令与锚定句只针对视频prompt）。"""
    parts = []
    for k in ("video_prompt", "h3_video_prompt", "图生视频Prompt", "视频Prompt"):
        v = s.get(k)
        if isinstance(v, str):
            parts.append(v)
    vl = s.get("video_layers") or {}
    if isinstance(vl, dict):
        parts.extend(v for v in vl.values() if isinstance(v, str))
    return "\n".join(parts)


def strip_style_blocks(text):
    """从文本中剥离已识别的㊱导演风格卡块（⑦段正向块，head→tail 区间）。

    理由（v42）：融合卡的风格块同时出现 UE5 与 Arnold 词汇，是在描述"融合质感"，
    而非声明渲染引擎；16 系引擎混用机检应只扫真正的引擎指令文本，风格块豁免，
    否则挂载任何一张融合卡都会误判为引擎混用。引擎真身仍由 shared.render_engine 单一真源裁定。
    """
    if not text:
        return text
    out = text
    for c in DIRECTOR_CARDS.values():
        i = out.find(c["head"])
        if i >= 0 and c["tail"]:
            j = out.find(c["tail"], i)
            if j >= 0:
                out = out[:i] + out[j + len(c["tail"]):]
    return out


def shot_own_text(s):
    """单镜自有文本（不含 shared 继承前缀），用于逐镜术语扫描，避免与前缀重复报同一问题。"""
    parts = []
    for k in ("prompt", "img_prompt", "flat_prompt", "AI生图Prompt",
              "画面描述", "desc", "description"):
        v = s.get(k)
        if isinstance(v, str):
            parts.append(v)
    pr = s.get("prompt_ref") or {}
    if isinstance(pr, dict):
        for k in ("free", "lighting"):
            if isinstance(pr.get(k), str):
                parts.append(pr[k])
    parts.append(shot_video_text(s))
    return "\n".join(p for p in parts if p)


def shared_texts(d):
    """shared 层继承文本（⑰库前缀继承制：prefix_full 为每条prompt必含，是术语混用的首要藏身处）。"""
    sh = d.get("shared") or {}
    out = {}
    for k in ("prefix_full", "negative_global"):
        if isinstance(sh.get(k), str):
            out[k] = sh[k]
    return out


def main(path, ledger_path=None, ref_check=False, strict_ref=False, render_engine=None):
    if strict_ref:
        ref_check = True   # 模式C严格校验隐含模式B全部校验项（㉖库§七）
    d = json.load(open(path, encoding="utf-8"))
    errs, warns = [], []
    shots = d["shots"]
    assets = set(d.get("assets", {}).keys())
    root = _lib_root()
    m_set, t_set = load_m_set(root), load_t_set(root)

    def sid(s):
        return s["shot_id"]

    # ============ 镜头级检查 ============
    for i, s in enumerate(shots):
        sz = s["shot_size"]
        lo, hi = DUR_RANGE.get(sz, (0.5, 8))
        t = s["duration_s"]
        # 1 时长区间（骤停豁免上限；有 exemption 备注降为 WARN）
        if s.get("duration_mode") == "骤停":
            hi = HARD_8
        if not (lo <= t <= hi):
            (warns if s.get("exemption") else errs).append(
                f"{sid(s)} 时长{t}s 超出{sz}区间[{lo},{hi}]" + ("（已有豁免备注）" if s.get("exemption") else ""))
        # 2 8s 平台硬红线
        if t > HARD_8:
            errs.append(f"{sid(s)} 超过8秒平台红线（{t}s）")
        # 3 运动理由：非 Static 必须 motive（法则九）
        mv = s.get("camera_move", {})
        if mv.get("type") and mv["type"] != "Static" and not mv.get("motive"):
            errs.append(f"{sid(s)} 非Static({mv['type']})但无运动理由")
        # 4 资产引用存在（assets 引用 vs 资产表；角色/场景/道具）
        for a in s.get("assets", []):
            if a not in assets:
                errs.append(f"{sid(s)} 引用不存在资产 {a}")
        # 5 微表情：仅 CU/ECU/MCU 允许 + M 编号合法（库内存在）+ 格式
        me = s.get("micro_expr")
        if me:
            if sz not in ("CU", "ECU", "MCU"):
                warns.append(f"{sid(s)} {sz} 非特写挂微表情{me}（库仅强制特写必须引用，此为提示）")
            if not M_RE.match(me):
                errs.append(f"{sid(s)} M编号格式错 {me}")
            elif me not in m_set:
                errs.append(f"{sid(s)} M编号不在微表情库 {me}（合法: {len(m_set)}个）")
        # 6 动作峰值切镜标注（法则三）：有动作且含 cut_point 字段则必须非空
        if "cut_point" in s and not (s.get("cut_point") or "").strip():
            errs.append(f"{sid(s)} cut_point 字段为空（动作峰值切镜必须标注切点）")
        # 7 对白口型策略（⑫库三轨制）：非画外对白必须标口型方案
        for dl in s.get("dialogue", []):
            if not dl.get("lip") and not dl.get("offscreen"):
                errs.append(f"{sid(s)} 台词「{dl.get('text','')[:12]}」非画外但未标口型策略")
        # 8 转场：非直切必须引用 T 编号，且编号必须存在于转场库
        tr = s.get("transition_out") or {}
        if tr.get("type") and tr["type"] not in DIRECT_CUTS:
            if not tr.get("ref"):
                errs.append(f"{sid(s)} 非直切转场({tr['type']})未引用T编号")
            elif not T_RE.match(tr["ref"]):
                errs.append(f"{sid(s)} T编号格式错 {tr['ref']}")
            elif tr["ref"] not in t_set:
                errs.append(f"{sid(s)} T编号不在转场库 {tr['ref']}（合法: {len(t_set)}个）")

    # 9 微表情全集不重复（同一场/集内禁止复用同一条）
    ms = [x["micro_expr"] for x in shots if x.get("micro_expr")]
    for m in sorted(set(ms)):
        if ms.count(m) > 1:
            errs.append(f"微表情 {m} 全集重复 {ms.count(m)} 次")
    # 10 口型A名额 ≤3（⑫库）
    a_cnt = sum(1 for s in shots if s.get("lip_sync") == "A"
                or any(x.get("lip") == "A" for x in s.get("dialogue", [])))
    if a_cnt > A_LIP_CAP:
        errs.append(f"口型A方案 {a_cnt} 镜 > 上限{A_LIP_CAP}")
    # 11 景别级差＝隔级切（v1.1.3 改定唯一判据，editing/16 模式B；hard-constraints §189）：
    # 相邻同主体 gap=0/1 且无豁免 → FAIL；带豁免/transition_note → 降 WARN；gap≥2 合法；INS 不计级重置级差链
    prev = None
    for s in shots:
        if prev and s["shot_size"] != "INS" and prev["shot_size"] != "INS" \
           and set(s.get("roles", [])) & set(prev.get("roles", [])):
            note = s.get("transition_note") or s.get("豁免")
            try:
                gap = abs(SIZE_ORDER.index(s["shot_size"]) - SIZE_ORDER.index(prev["shot_size"]))
            except ValueError:
                gap = 0
            if gap <= 1:
                msg = (f"{prev['shot_id']}({prev['shot_size']})→{s['shot_id']}({s['shot_size']}) "
                       f"隔级切级差{gap}{'（同景别直切）' if gap == 0 else ''}——同主体相邻不相切（editing/16）")
                (warns if note else errs).append(msg if note else msg + "，须豁免理由（transition_note）或 INS/空镜缓冲")
        prev = s
    # 12 节奏模式：连续同模式≤8；骤停≤2
    modes = [s.get("duration_mode") for s in shots]
    run = 1
    for i in range(1, len(modes)):
        run = run + 1 if modes[i] == modes[i - 1] else 1
        if run > MAX_SAME_MODE:
            errs.append(f"{shots[i]['shot_id']} 连续同模式超{MAX_SAME_MODE}镜")
    if modes.count("骤停") > MAX_DURATION_MODE:
        errs.append(f"骤停镜 {modes.count('骤停')} > {MAX_DURATION_MODE}")

    # ============ 集级检查 ============
    # 13 总时长 ±5% 对齐 timeline.content_s（⑰库§四第9项）
    total = sum(x["duration_s"] for x in shots)
    tl = d.get("timeline", {}).get("content_s")
    if tl is not None:
        dev = abs(total - tl) / tl if tl else 0
        if dev > TOTAL_TOL:
            errs.append(f"内容总时长 sum={total}s vs timeline.content_s={tl}s 偏差{dev:.1%} > ±5%")
    # 14 段边界合法（分段模式）：segments 覆盖全部镜头、不重不漏、段内与全集序列连续
    segs = d.get("segments", [])
    if segs:
        ids_in_order = [x["shot_id"] for x in shots]
        seen = []
        for seg in segs:
            ss = seg["shots"]
            seen += ss
            if not seg.get("id"):
                errs.append("存在未命名段（缺 id）")
            try:
                pos = [ids_in_order.index(i) for i in ss]
            except ValueError as e:
                errs.append(f"{seg.get('id','?')} 段内引用不存在镜头 {e}")
                continue
            if pos != list(range(pos[0], pos[0] + len(pos))):
                errs.append(f"{seg.get('id','?')} 段内镜头与全集序列不连续（跨段跳取）")
        if sorted(seen) != sorted(ids_in_order):
            errs.append(f"分段与镜头总表不一致：漏/重 {set(ids_in_order) ^ set(seen)}")
        
        # 14e v22 切割规则：段边界必须落在镜头边界（禁止在镜头时长中间切段）
        # 检查方法：计算每个段的时间范围，确认段边界不在任何镜头的时间范围内
        if shots:
            by_id = {s["shot_id"]: s for s in shots}
            shot_times = []
            t_acc = 0.0
            for s in shots:
                shot_times.append((t_acc, t_acc + s["duration_s"], s["shot_id"]))
                t_acc += s["duration_s"]
            
            seg_boundaries = []
            t_acc = 0.0
            for seg in segs:
                seg_dur = sum(by_id[x]["duration_s"] for x in seg["shots"])
                seg_boundaries.append((seg.get("id"), t_acc, t_acc + seg_dur, seg.get("tail_exempt"), seg.get("short_exempt")))
                t_acc += seg_dur
            
            # 检查每个段边界是否落在某个镜头的中间
            for seg_id, seg_start, seg_end, tail_exempt, short_exempt in seg_boundaries:
                for shot_start, shot_end, shot_id in shot_times:
                    # 如果段边界在镜头时间范围内（允许极小误差），则违规
                    if shot_start < seg_end < shot_end - 0.01:
                        errs.append(f"{seg_id} 段边界{seg_end:.1f}s 落在{shot_id}镜头中间（{shot_start:.1f}-{shot_end:.1f}s），违反v22切割规则：段边界必须落在镜头边界")
                        break

            # 14f v22 回退方向校验（选项A：回退递减，audio-delivery.md §4.1 第2条）
            # 14e 只验「边界落在镜头边界上」，不验方向；本项补齐方向判定——
            # 若「段起点+目标段长」落点切在某镜头内部，段边界必须【回退】到该镜头起点
            #（即上一镜头结束处，段变短），不得【含整镜】（段变长）。
            # 缺此校验时，含整镜的旧行为同样满足14e，规则形同虚设（v22遗留缺口）。
            # v35：目标段长按档位取（15s档=15.0 / 10s档=10.0），不再硬编码。
            SEG_TARGET = seg_tiers.tier(d)["target"]
            content_total = shot_times[-1][1] if shot_times else 0.0
            for seg_id, seg_start, seg_end, tail_exempt, short_exempt in seg_boundaries:
                if tail_exempt:
                    continue                      # 尾段豁免（骤停余韵/集尾钩）
                target = seg_start + SEG_TARGET
                if target >= content_total - 0.01:
                    continue                      # 目标点已达/超全片末尾，属尾段情形
                for shot_start, shot_end, shot_id in shot_times:
                    if shot_start < target < shot_end - 0.01:
                        # 落点切在该镜头内部 → 段边界必须回退至 shot_start
                        if abs(seg_end - shot_start) > 0.01:
                            direction = ("含整镜/段变长（v22前的旧行为，已废止）"
                                         if seg_end > shot_start else "回退过度/段变短过头")
                            errs.append(
                                f"{seg_id} 违反v22回退递减规则：15s目标落点{target:.1f}s切在{shot_id}内部"
                                f"（{shot_start:.1f}-{shot_end:.1f}s），段边界应回退至{shot_start:.1f}s"
                                f"（上一镜头结束处），实际为{seg_end:.1f}s —— {direction}")
                        break

    # ============ 季账机读化（第二层，--ledger 时执行） ============
    if ledger_path:
        if not os.path.exists(ledger_path):
            errs.append(f"季账文件不存在: {ledger_path}")
        else:
            led = json.load(open(ledger_path, encoding="utf-8"))
            cur_ep = ep_num(d.get("episode"))
            cur_ep_str = d.get("episode")

            def since_num(v):
                """'一直'→0（始终知晓）；'E04'→4；None→None"""
                if v is None:
                    return None
                if isinstance(v, str) and v.strip() == "一直":
                    return 0
                return ep_num(str(v))

            # 14a 死人出场：死亡角色在本集任何镜头出现 → FAIL；flashback 标记豁免（⑲库§三）
            dead = {r["asset"] for r in led.get("life_ledger", []) if r.get("status") == "死亡"}
            for s in shots:
                hit = dead & set(s.get("assets", []))
                if hit and not s.get("flashback"):
                    errs.append(f"{sid(s)} 死亡角色再出场 {sorted(hit)}（非闪回，⑲库直接驳回）")
                elif hit and s.get("flashback"):
                    warns.append(f"{sid(s)} 死亡角色以闪回出现 {sorted(hit)}（须走⑳闪回解析规则）")
            # 14b 知情时序：本集台词/行为引用信息 → 引用者知晓集 ≤ 当前集（⑲库§二）
            known = {r["info"]: r.get("characters", {}) for r in led.get("knowledge_ledger", [])}
            for ref in d.get("info_refs", []):
                info, by = ref.get("info"), ref.get("by")
                if not info or not by:
                    errs.append(f"info_refs 条目缺 info/by: {ref}")
                    continue
                chars = known.get(info)
                if chars is None:
                    errs.append(f"info_refs 引用未在季账 knowledge_ledger 登记的信息「{info}」（⑲库：引用必先登记）")
                    continue
                if by not in chars:
                    errs.append(f"角色「{by}」引用信息「{info}」但未在知情账登记知晓集")
                    continue
                know = since_num(chars[by].get("since") if isinstance(chars[by], dict) else chars[by])
                if know is None:
                    errs.append(f"「{by}」对「{info}」的知晓集未登记")
                elif cur_ep is not None and know > cur_ep:
                    errs.append(f"「{by}」在{cur_ep_str}引用「{info}」，但其知晓集为E{know}（先知穿帮，⑲库驳回）")
            # 14c 伏笔超期：在途且已超计划引爆集 >5 集未动作 → 预警
            for f in led.get("foreshadow_ledger", []):
                plan = ep_num(str(f.get("plan_episode")))
                if f.get("status") == "在途" and not f.get("actual_episode") and plan is not None and cur_ep is not None:
                    if cur_ep - plan > FO_OVERDUE:
                        warns.append(f"伏笔{f.get('id')} 距计划引爆集E{plan}已超{cur_ep-plan}集未动作（> {FO_OVERDUE}，烂尾预警）")
            # 14d 上集钩子回应：上一集 S/A 级尾钩在本集必须已排回应位（⑲库§一）
            if cur_ep is not None:
                for h in led.get("hook_ledger", []):
                    h_ep = ep_num(str(h.get("episode")))
                    if h_ep == cur_ep - 1 and h.get("level") in ("S", "A") and not h.get("responded_in"):
                        errs.append(f"上集{h.get('episode')} {h.get('level')}级尾钩「{h.get('content','')[:16]}」本集未排回应位（不得进入Step 4）")

    # 15. 参考图文生视频人物一致性校验（㉖库，--ref-check 启用时）
    if ref_check:
        # 15a 检查每个镜头的 🔧资产ID 是否已登记
        for shot in shots:
            asset_ids = shot.get("🔧资产ID", [])
            for asset_id in asset_ids:
                if not asset_id.startswith(("M-", "F-")):
                    continue
                # 检查是否在⑪库定妆资产卡中登记
                # 这里需要读取外部文件，暂时简化为检查格式
                if not re.match(r"^[MF]-\d{2,3}$", asset_id):
                    errs.append(f"镜头{shot.get('镜号', '?')} 资产ID {asset_id} 格式错误（应为 M-XX 或 F-XX）")
                else:
                    # 格式正确，记录为警告（实际校验需要读取⑪库文件）
                    warns.append(f"镜头{shot.get('镜号', '?')} 资产ID {asset_id} 格式正确（需人工确认已在⑪库登记）")

        # 15b 检查多人同框镜头是否填写对位表
        for shot in shots:
            asset_ids = shot.get("🔧资产ID", [])
            character_ids = [aid for aid in asset_ids if aid.startswith(("M-", "F-"))]
            if len(character_ids) > 1:
                # 多人同框，检查是否有对位表标记
                if "🔧对位表" not in shot or not shot["🔧对位表"]:
                    warns.append(f"镜头{shot.get('镜号', '?')} 多人同框（{len(character_ids)}人）但未填写🔧对位表（⑪库要求）")

        # 15c 检查参考图权重是否达到最低阈值
        # 读取参考图权重规则（从⑱库或㉖库）
        shot_type_weight_map = {
            "CU": 70, "ECU": 70, "MCU": 70,  # 特写镜头最低70%
            "MS": 60,  # 中景最低60%
            "FS": 50, "WS": 50, "EWS": 50,  # 全景/远景最低50%
        }
        for shot in shots:
            shot_type = shot.get("景别", "")
            if shot_type in shot_type_weight_map:
                min_weight = shot_type_weight_map[shot_type]
                ref_weight = shot.get("🔧参考图权重")
                if ref_weight is None:
                    # 未设置参考图权重，仅在参考图模式下报错
                    if shot.get("视频模式") == "参考图":
                        errs.append(f"镜头{shot.get('镜号', '?')} 参考图模式但未设置🔧参考图权重")
                elif isinstance(ref_weight, (int, float)) and ref_weight < min_weight:
                    errs.append(f"镜头{shot.get('镜号', '?')} {shot_type}景别参考图权重{ref_weight}%低于最低阈值{min_weight}%（㉖库§三）")

    # 15d-15f. 模式C严格校验（㉖库§七§八，--strict-ref 启用时；隐含开启 ref_check 全部项）
    if strict_ref:
        # 模式C权重下限（㉖库§4.2）：比模式B更高
        strict_weight_map = {
            "CU": 95, "ECU": 95, "MCU": 95,
            "MS": 90, "FS": 90, "WS": 90, "EWS": 85, "INS": 80,
        }
        for shot in shots:
            tag = shot.get("镜号") or shot.get("shot_id") or "?"
            vtxt = shot_video_text(shot)
            # 15d 视频Prompt中禁止人物外形描述（㉖库§8.1）
            if vtxt:
                hit = [w for w in FORBIDDEN_LOOK_WORDS if w in vtxt]
                if hit:
                    errs.append(f"镜头{tag} 模式C视频Prompt含人物外形描述{sorted(set(hit))[:6]}"
                                f"（㉖库§8.1禁止清单，外形须由参考图锁定）")
            # 15e 强制锚定句必须存在（㉖库§8.3）
            if vtxt and STRICT_ANCHOR_KEY not in vtxt:
                errs.append(f"镜头{tag} 模式C缺少强制锚定句「{STRICT_ANCHOR_KEY}…」（㉖库§8.3必带）")
            # 15f 参考图权重须达模式C下限（90-100%）
            sz = shot.get("景别") or shot.get("shot_size") or ""
            rw = shot.get("🔧参考图权重")
            if sz in strict_weight_map:
                lo = strict_weight_map[sz]
                if rw is None:
                    errs.append(f"镜头{tag} 模式C未设置🔧参考图权重（{sz}须≥{lo}%）")
                elif isinstance(rw, (int, float)) and not (lo <= rw <= 100):
                    errs.append(f"镜头{tag} 模式C {sz}参考图权重{rw}%不在[{lo},100]区间（㉖库§4.2）")

    # 16. Arnold渲染引擎模式校验（㉗库§十一，--render-engine arnold 启用时）
    if render_engine:
        eng = str(render_engine).strip().lower()
        sh_txt = shared_texts(d)
        prefix = sh_txt.get("prefix_full", "")
        neg = sh_txt.get("negative_global", "")
        if eng not in ("arnold", "ue5"):
            errs.append(f"--render-engine 取值非法「{render_engine}」（仅支持 arnold / ue5）")
        elif eng == "arnold":
            # 16a-shared 前缀层扫描（⑰库前缀继承制：prefix_full 为每条prompt必含，
            #          是UE5术语混用的首要藏身处，必须单独校验且只报一次）
            if prefix:
                hit_p = [w for w in UE5_FORBIDDEN_IN_ARNOLD if w in strip_style_blocks(prefix)]
                if hit_p:
                    errs.append(f"16a Arnold模式 shared.prefix_full 含UE5术语{sorted(set(hit_p))[:6]}"
                                f"（㉗库§0.3 混用禁止FAIL级；前缀为每条prompt必含，须整体替换为㉗库§一Arnold专用前缀）")
                if not any(a in prefix for a in ARNOLD_ANCHORS):
                    errs.append("16b Arnold模式 shared.prefix_full 未命中任何Arnold锚点词"
                                "（须含「Arnold/离线路径追踪/蒙特卡洛/ACEScg/XGen」之一，见㉗库§一）")
            # 16d 全片渲染引擎模式唯一（不得中途切换）
            declared = {str(s.get("render_engine") or s.get("渲染引擎") or "").strip().lower()
                        for s in shots if (s.get("render_engine") or s.get("渲染引擎"))}
            declared.discard("")
            conflict = declared - {"arnold"}
            if conflict:
                errs.append(f"16d 全片渲染引擎不唯一：检测到 {sorted(conflict)}（㉗库§0.3 禁止中途切换/混用）")
            # 16a-shot / 16b-shot 单镜自有文本扫描（前缀问题已在上方统一报出，此处不重复）
            for shot in shots:
                tag = shot.get("镜号") or shot.get("shot_id") or "?"
                txt = shot_own_text(shot)
                if not txt:
                    continue
                hit_ue5 = [w for w in UE5_FORBIDDEN_IN_ARNOLD if w in txt]
                if hit_ue5:
                    errs.append(f"16a 镜头{tag} Arnold模式prompt含UE5术语{sorted(set(hit_ue5))[:5]}"
                                f"（㉗库§0.3 混用禁止，FAIL级）")
            # 16c 负面词必须含互斥声明
            if neg and not any(n in neg for n in ARNOLD_NEGATIVE_REQUIRED):
                errs.append("16c Arnold模式 shared.negative_global 未含「UE5冷硬质感/实时引擎干涩质感/游戏质感」任一互斥声明（㉗库§八）")
            # 16e 采样参数若填写则必须等于硬锁定值
            arn = (d.get("shared") or {}).get("arnold") or d.get("arnold") or {}
            samp = arn.get("sampling") or {}
            for k, want in ARNOLD_SAMPLING_LOCK.items():
                if k in samp and samp[k] != want:
                    errs.append(f"16e Arnold采样 {k}={samp[k]} ≠ 硬锁定值{want}（㉗库§1.2 不得微调）")
            # 16f 色彩空间必须为 ACEScg
            cs = str(arn.get("color_space") or "").strip()
            if cs and ARNOLD_COLOR_SPACE.lower() not in cs.lower():
                warns.append(f"16f Arnold色彩空间「{cs}」非 {ARNOLD_COLOR_SPACE}（㉗库§1.4 建议ACEScg 1.2）")
        else:  # ue5 模式：反向防线，禁止Arnold术语混入
            if prefix:
                hit_p = [w for w in ARNOLD_FORBIDDEN_IN_UE5 if w in strip_style_blocks(prefix)]
                if hit_p:
                    errs.append(f"16a-r UE5模式 shared.prefix_full 含Arnold术语{sorted(set(hit_p))[:6]}"
                                f"（㉗库§0.3 混用禁止FAIL级）")
            for shot in shots:
                tag = shot.get("镜号") or shot.get("shot_id") or "?"
                txt = shot_own_text(shot)
                if not txt:
                    continue
                hit_arn = [w for w in ARNOLD_FORBIDDEN_IN_UE5 if w in txt]
                if hit_arn:
                    errs.append(f"16a-r 镜头{tag} UE5模式prompt含Arnold术语{sorted(set(hit_arn))[:5]}"
                                f"（㉗库§0.3 混用禁止，FAIL级）")

    # 17. 道具服装资产与群戏校验（㉞㉟库，schema v2；与16系一致采用"字段存在才检查"的按需策略）
    shot_id_set = {s["shot_id"] for s in shots}
    prop_assets = {k: v for k, v in d.get("assets", {}).items() if str(k).startswith("PROP-")}
    # 17a 道具引用闭环（FAIL）：shots[].props 引用的 PROP-ID 必须在 assets 登记（㉞库§一）
    for s in shots:
        for pid in s.get("props", []):
            if pid not in assets:
                errs.append(f"17a {sid(s)} 引用未登记道具 {pid}（㉞库：道具必须先登记再引用，贯穿/仪式道具还须建视觉卡）")
    # 17b 状态账时序（WARN）：state_ledger 引用的镜头必须存在（㉞库§一.1）
    for pid, pa in prop_assets.items():
        for ent in pa.get("state_ledger") or []:
            shot_ref = ent.get("shot")
            if shot_ref and shot_ref not in shot_id_set:
                warns.append(f"17b 道具{pid} 状态账引用不存在镜头 {shot_ref}（㉞库状态账：变化镜头必须真实存在）")
    # 17c 换装邻接（FAIL）：同段内同一角色服装变化必须挂在换装镜上（㉞库§一.2 换装账）
    ward_groups = [seg["shots"] for seg in segs] if segs else [[s["shot_id"] for s in shots]]
    by_id_map = {s["shot_id"]: s for s in shots}
    for grp in ward_groups:
        last_ward = {}
        for sid_ in grp:
            s = by_id_map.get(sid_)
            if s is None:
                continue
            ward = s.get("wardrobe") or {}
            if not isinstance(ward, dict):
                continue
            for role, wid in ward.items():
                if role in last_ward and last_ward[role] != wid and not s.get("costume_change"):
                    errs.append(f"17c {sid_} 角色{role} 服装由{last_ward[role]}变为{wid} 但未标 costume_change 换装镜"
                                f"（㉞库换装账：换装必建新卡+换装首镜显式标记，同段换装后禁现旧套）")
                last_ward[role] = wid
    # 17d 视觉锁定道具特写锚定句（WARN）：visual_lock 道具的 INS/ECU 镜头 prompt 必含锚定句（㉞库§一.1）
    for s in shots:
        if s.get("shot_size") in ("INS", "ECU"):
            for pid in s.get("props", []):
                pa = prop_assets.get(pid) or {}
                if pa.get("visual_lock") and "道具参考图" not in shot_own_text(s):
                    warns.append(f"17d {sid(s)} {pid}（视觉锁定{pa.get('importance','')}）特写镜头prompt缺"
                                 f"「严格匹配道具参考图」锚定句（㉞库：定妆道具特写必须锚定）")
    # 17e 群戏视线焦点（WARN）：同框≥3人必须填 gaze_focus（㉟库§三）
    for s in shots:
        chars = set(s.get("roles", [])) | {a for a in s.get("assets", []) if str(a).startswith("CHR")}
        if len(chars) >= 3 and not (s.get("gaze_focus") or "").strip():
            warns.append(f"17e {sid(s)} 同框{len(chars)}人（≥3）但缺 gaze_focus（㉟库视线接力：单焦点必填，目标=角色ID或画外方向）")

    # 18. 导演风格卡校验（㊱库 v41：互斥铁律 §八·0 / 风格块逐字注入 / 黑名单漂移）
    shd = d.get("shared") or {}
    style_base = str(shd.get("style_base") or "")
    prefix_full = str(shared_texts(d).get("prefix_full") or "")
    matched = [k for k, c in DIRECTOR_CARDS.items() if any(kw in style_base for kw in c["keys"])]
    # 18a 双卡叠加（FAIL）
    if len(matched) >= 2 and not (("主" in style_base) and ("副" in style_base)):
        errs.append(f"18a style_base 同时命中 {len(matched)} 张导演卡 {matched}"
                    f"（㊱库§八·0 互斥铁律：一次只挂一张卡；确需融合须标注主/副卡与借用项）")
    # 18b 未标注导演卡（WARN）：仅在 prefix_full 确实含某卡风格块首锚时才报（避免误伤未挂卡的普通分镜）
    if not matched and any(c["head"] in prefix_full for c in DIRECTOR_CARDS.values()):
        warns.append("18b shared.prefix_full 已注入风格块但 style_base 未标注导演卡"
                     "（㊱库：须标注「⑤基准X + ㊱卡N」，否则风格来源不可追溯）")
    if len(matched) == 1:
        ck, card = matched[0], DIRECTOR_CARDS[matched[0]]
        # 18c 风格块逐字一致（FAIL）：首锚命中但尾锚缺失 = 被改写/截断/节选
        if card["head"] in prefix_full and card["tail"] not in prefix_full:
            errs.append(f"18c {ck}({card['name']}) 风格块被改写或截断（首锚命中、尾锚缺失）"
                        f"（㊱库：⑦段提示词块逐字注入，禁改写/节选/同义替换）")
        # 18d 风格冲突词（FAIL）：本卡黑名单特有词出现在逐镜 prompt
        for s in shots:
            txt = shot_own_text(s)
            if not txt:
                continue
            hit_bl = [w for w in card["blacklist"] if w in txt]
            if hit_bl:
                errs.append(f"18d {sid(s)} prompt 含 {ck}({card['name']}) 黑名单词{sorted(set(hit_bl))[:4]}"
                            f"（㊱库风格漂移：按㉝库处方处置并回写 shared）")

    # 19. 合规红线校验（㉜库§〇.3 血液视觉 / ㊲库合规红线 —— 脚本兜底，此前全靠模型自觉）
    for s in shots:
        txt = shot_own_text(s)
        if not txt:
            continue
        sz = s.get("shot_size") or ""
        hit_blood = [w for w in BLOOD_VISUAL if w in txt]
        if hit_blood and sz in CLOSE_SIZES:
            errs.append(f"19a {sid(s)} {sz} 近景/特写出现血液视觉词{sorted(set(hit_blood))[:4]}"
                        f"（㉜库§〇.3 强制：血液视觉近景/特写不得呈现，改用动作衰减表现伤害）")
        hit_rel = [w for w in RELIGION_SYMBOLS if w in txt]
        if hit_rel:
            warns.append(f"19b {sid(s)} 出现宗教符号{sorted(set(hit_rel))[:3]}"
                         f"（㊲库合规红线：须去宗教化转译，不得作为崇拜对象呈现）")
        hit_child = [w for w in CHILD_WORDS if w in txt]
        hit_harm = [w for w in HARM_WORDS if w in txt]
        if hit_child and hit_harm:
            errs.append(f"19c {sid(s)} 儿童形象与伤害要素同镜（child={sorted(set(hit_child))[:2]} "
                        f"harm={sorted(set(hit_harm))[:2]}；㊲库合规红线：诡异儿童形象不得与伤害画面同现）")

    # 20. 竖屏构图校验（㊳库 v42；与17系同策略：字段存在才检查。20b/20c 未落地，见库§三）
    for s in shots:
        if str(s.get("frame_layout") or "").strip() == "横排":
            chars = set(s.get("roles", [])) | {a for a in s.get("assets", []) if str(a).startswith("CHR")}
            if len(chars) >= 3:
                warns.append(f"20a {sid(s)} 同框{len(chars)}人（≥3）但 frame_layout=横排"
                             f"（㊳库法则8：竖屏同框≥3人禁止横排，改纵向阶梯站位或斜向队列）")

    # ---- 汇总 ----
    print(f"镜数={len(shots)} 内容总时长={total}s"
          + (f" 季账={'已载入' if ledger_path and os.path.exists(ledger_path) else '未载入'}" if ledger_path else ""))
    for w in warns:
        print("[WARN]", w)
    for e in errs:
        print("[FAIL]", e)
    print("RESULT:", "PASS" if not errs else f"FAIL({len(errs)})")
    return 0 if not errs else 1


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description="⑰机检+⑲季账校验+㉖参考图人物一致性校验+㉗渲染引擎互斥校验")
    ap.add_argument("storyboard")
    ap.add_argument("--ledger", default=None, help="series_ledger.json 路径（季账机读化）")
    ap.add_argument("--ref-check", action="store_true", help="启用参考图文生视频人物一致性校验（㉖库模式B）")
    ap.add_argument("--strict-ref", action="store_true", help="启用模式C严格校验（㉖库：外形描述禁令+强制锚定句+权重90-100%%），隐含 --ref-check")
    ap.add_argument("--render-engine", default=None, choices=["arnold", "ue5"],
                    help="渲染引擎模式校验（㉗库：arnold=禁UE5术语+Arnold锚点+采样锁值；ue5=禁Arnold术语）")
    args = ap.parse_args()
    sys.exit(main(args.storyboard, args.ledger, args.ref_check, args.strict_ref, args.render_engine))
