# 分镜数据结构库（JSON Sidecar 与 Prompt 装配协议）

> 定位：把 Markdown 分镜表升级为「人读 + 机读」双层交付。每集分镜表旁挂一个 `E集_storyboard.json`（sidecar），前缀继承、字段校验、资产引用检查全部程序化，解决量产时 1.2 万字/集的膨胀与人工核对失误。
> 原则：**Markdown 表是视图，JSON 是真源**；两者内容冲突时以 JSON 重渲染 Markdown。
> **工具化状态：v1 已落地可跑**——`scripts/` 下 validate / render / check_segments / regression 四个脚本，金标准集 `examples/E01_storyboard.json`（20 镜）全链 PASS（见 §七 回归协议）。

---

## 一、单镜 Schema（v1，字段协议与实现一致）

> 字段以 `examples/E01_storyboard.json` 为真源（脚本按此实现）。**新增镜头一律按本表填写，不得另起一套字段名。**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `shot_id` | str | ✅ | 场景号-镜头号（S01-015） |
| `seq` | int | ✅ | 全集顺序 |
| `duration_s` | float | ✅ | 秒；须落景别区间且 ≤8s |
| `duration_mode` | str | ✅ | 慢/中/快/骤停（⑧库四模式） |
| `shot_size` | str | ✅ | EWS/WS/FS/MS/MCU/CU/ECU/INS |
| `camera_angle` | str | 建议 | Eye Level / High / Low / OTS 等 |
| `camera_move` | obj | ✅ | `{type, motive}`；非 Static 必须 motive |
| `visual_layers` | obj | ✅ | `{fg, mg, bg}` 三层纵深 |
| `silhouette` | str | ✅ | 剪影可读性说明 |
| `roles` | str[] | ✅ | 入画角色资产ID列表 |
| `micro_expr` | str\|null | 特写 | M 编号（M01-M96 区间，库内动态校验） |
| `props` | str[] | 可选 | 道具资产ID |
| `assets` | str[] | ✅ | 本镜全部资产引用（角色/场景/道具） |
| `dialogue` | obj[] | 可选 | `{who, text, offscreen?, lip?}`；lip=口型方案 A/B |
| `vo` | str\|null | 可选 | 旁白 |
| `sfx` | str[] | 可选 | 音效记法 `事件@秒` |
| `lip_sync` | str\|null | A镜 | 口型A方案标记（配音先行） |
| `transition_out` | obj | ✅ | `{type, ref}`；非直切必须 ref=T编号 |
| `transition_note` | str | 跳级时 | 景别跳级豁免理由（法则四） |
| `exemption` | str | 超区间时 | 时长超景别区间豁免备注（降为WARN） |
| `cut_point` | str | 动作峰值 | 动作峰值切镜切点标注（法则三） |
| `narrative_func` | str | ✅ | 建立/推进/转折/悬念/调剂/尾钩（**只能一个**） |
| `prompt_ref` | obj | ✅ | `{lib?, asset_copy[], free, lighting?}` 前缀继承装配 |
| `video_layers` | obj | ✅ | `{L1主体动作, L2次级动态, L3运镜, L4环境}` 动点四层 |
| `tier` | str | ✅ | 视频时长档位（5s/10s段/裁切） |
| `amplitude` | str | ✅ | 极小/小/中/大（CU/ECU 锁极小） |
| `flashback` | bool | 闪回镜 | 死亡角色以闪回出场时必须标 true |
| `notes` | str | 可选 | 技术备注 |

单镜 JSON 示例（字段级真源样例见 `examples/E01_storyboard.json`）：

```json
{
  "shot_id": "S01-015",
  "seq": 15,
  "duration_s": 3.0,
  "duration_mode": "中",
  "shot_size": "MS",
  "camera_angle": "Eye Level",
  "camera_move": {"type": "Static", "motive": null},
  "visual_layers": {"fg": "陈婶枯手抬起", "mg": "递罐双手", "bg": "冷蓝门光"},
  "silhouette": "两手相递强可读",
  "roles": ["CHR-0001-V1", "CHR-0002-V1"],
  "micro_expr": null,
  "props": ["PROP-001"],
  "assets": ["PROP-001", "CHR-0001-V1", "CHR-0002-V1"],
  "dialogue": [],
  "vo": "算了。人冻死了，东西也是死的。",
  "sfx": ["罐盖崩开@0.6s"],
  "lip_sync": null,
  "transition_out": {"type": "Cut", "ref": null},
  "narrative_func": "推进",
  "cut_point": "罐盖崩开瞬间",
  "prompt_ref": {"lib": "31", "asset_copy": [], "free": "…", "lighting": null},
  "video_layers": {"L1": "撬盖掰半递出", "L2": "热气升腾", "L3": "静", "L4": "门缝冷风使烛焰拉长"},
  "tier": "10s段1升格",
  "amplitude": "中",
  "notes": "泄压阀镜（⑨库）"
}
```

## 二、文件级结构

```json
{
  "episode": "E01",
  "series": "冰域纪元",
  "schema_ver": 1,
  "lib_ver": "19库/2026-09",
  "segment_mode": true,
  "shared": {"prefix_full": "…", "negative_global": "…", "lighting_ratio": "6:1", "style_base": "A混E"},
  "assets": {"CHR-0001-V1": {"name": "沈夜", "desc_block": "…"}, "SC-001-N": {"name": "…", "env_block": "…"}},
  "segments": [{"id": "P01", "shots": ["S01-001", "…"], "hook": "…", "entry_snapshot": "…", "exit_snapshot": "…"}],
  "info_refs": [{"info": "门外「它们」闻热气", "by": "沈夜", "shot": "S01-019"}],
  "shots": ["…每镜对象…"],
  "timeline": {"content_s": 53.5, "reel_check": "通过"}
}
```

- `assets` 内嵌资产表（角色/场景/道具 + `desc_block`/`env_block` 权威描述块）；第 2 集起亦可引用外部 `E集_assets.json`（⑪库集资产清单）
- `segments[].entry_snapshot` / `exit_snapshot`：段入口/出口状态快照，驱动 `check_segments.py` 入口快照链校验（§五）
- `info_refs`：本集台词/行为引用的信息登记（⑲库知情时序判定的输入，§六）

## 三、前缀继承与装配协议

1. prompt 在 JSON 中只存 `prompt_ref` 引用（`lib` 镜头库编号 / `asset_copy` 资产ID列表 / `free` 自由段），`prefix_full` 与 `negative_global` 只存一份于 `shared`——**Markdown 表里印全文（给人直接复制），JSON 里禁止冗余存储**
2. `asset_copy` 装配时从 `assets[].desc_block`/`env_block` 逐字注入——**逐字一致铁律由数据结构强制**，不再靠自觉
3. 装配产物：`flat_prompts.txt`（每行一镜完整 prompt）+ `flat_video.txt` + `storyboard_table.md`（完整分镜表）+ 分段文档 + 集索引

## 四、机检清单（validate.py 逐项自动跑，FAIL=0 才准交稿）

> `python scripts/validate.py <E集_storyboard.json> [--ledger <series_ledger.json>]`

| # | 检查项 | 违规等级 | 豁免/降级 |
|---|--------|---------|----------|
| 1 | duration_s 落在 shot_size 区间（⑧库量化表） | FAIL | `exemption` 备注 → WARN；骤停豁免区间上限（仍受8s红线） |
| 2 | 单镜 ≤8s 平台硬红线 | FAIL | 无 |
| 3 | camera_move 非 Static 必须 motive（法则九） | FAIL | 无 |
| 4 | assets 引用必须存在于资产表 | FAIL | 无 |
| 5 | micro_expr 仅 CU/ECU/MCU 允许 | WARN | 库仅强制特写必须引用 |
| 6 | micro_expr 格式 M## 且存在于微表情库（动态解析） | FAIL | 库文件缺失时回退 M01-M96 |
| 7 | micro_expr 本集不重复 | FAIL | 无 |
| 8 | 非画外对白必须标口型策略 lip | FAIL | 无 |
| 9 | 口型A方案全集 ≤3（⑫库） | FAIL | 无 |
| 10 | 相邻同主体景别级差 =0/1 且无豁免（INS 不计级；v1.1.3 改定＝editing/16 模式B 隔级切） | FAIL | `transition_note` 理由 → 豁免 |
| 11 | 连续同节奏模式 ≤8；骤停 ≤2 | FAIL | 无 |
| 12 | 非直切转场必须 ref=T 编号，且编号存在于转场库（动态解析） | FAIL | 无 |
| 13 | 内容总时长 vs timeline.content_s 偏差 ≤±5% | FAIL | 无 |
| 14 | 段边界合法：segments 覆盖全部镜头、不重不漏、段内与全集序列连续 | FAIL | 无 |
| 15 | 季账（--ledger 时）：死人出场 / 知情时序 / 伏笔超期 / 上集钩子回应 | FAIL/WARN | flashback 豁免死人出场；超期为 WARN |

**豁免登记格式**（人肉判断的合法例外必须机读留痕）：
- 时长超景别区间 → `"exemption": "理由"`（降为 WARN）
- 景别跳级 → `"transition_note": "揭示镜/主体变更/动作节拍打断对话节拍 + 过渡方式"`（降为 WARN）
- **v1.1.3**：第 10 项唯一口径＝10 `editing/16` 模式B 隔级切（旧级差≤1 口径废除）
- 骤停镜自动豁免区间上限（仍受8s红线）；集尾短段 `"tail_exempt": true`
- 非特写景别挂 M 编号 = WARN（库规则只强制特写必须引用，不禁止引用）

## 五、分段校验（check_segments.py）

> `python scripts/check_segments.py <E集_storyboard.json>`

1. 段长容差 13.5-16.5s（`tail_exempt` 尾段 ≤18s）
2. 镜序连续不重不漏（段内与全集序列一致）
3. 段钩登记（每段必须有钩子）
4. 切点位置：动作峰值切镜标注 `cut_point`；段边界含动作必须有 cut_point/转场衔接（提示级 WARN）
5. 入口快照链：`exit_snapshot → 下段 entry_snapshot` 成对非空，断链 FAIL

## 六、季账机读化（series_ledger.json，第二层）

> 四张账从 md 表格升级为机读 JSON（schema 见 `season-continuity.md` §七），由 `validate.py --ledger` 程序判定三条穿帮高发项：
> - **死人出场**：`life_ledger` 中 status=死亡 的角色在本集镜头出现 → FAIL（`flashback: true` 豁免）
> - **知情时序**：本集 `info_refs` 引用的信息，引用者知晓集 ≤ 当前集 → 否则 FAIL（先知穿帮）
> - **伏笔超期**：在途伏笔距计划引爆集 >5 集未动作 → WARN（烂尾预警）
> - **上集钩子回应**：上一集 S/A 级尾钩在本集无回应位 → FAIL（不得进入 Step 4）
>
> 金标准：`examples/series_ledger_E01.json`（四账 + 关系轴，全链 PASS；反例已实测可抓 FAIL）

## 七、E01 回归协议（可执行）

> `python scripts/regression.py [--ledger] [--rebuild]`

- **每次修订规则后**（改 validate/render/任一库 → 影响渲染或校验的变更）必须重跑：`validate + render` 输出与基线 `examples/E01_render_out/` 做 diff
- 差异=0 → PASS（退出码0）；有差异 → 打印 DIFF 清单并退出码1，确认差异为**预期规则变更**后 `--rebuild` 刷新基线，禁止未确认直接吞掉差异
- `--ledger` 追加季账校验（金标准季账一起回归）

## 八、与交付的关系
- Step 4 先填 JSON（真源），由 render.py 渲染 Markdown 分镜表（视图）与分镜卡
- Step 5 Reel 时间轴可由 JSON 直接生成（seq+duration 累加，render 输出 index.md 时间轴）
- ⑮质量闭环的评分/失败卡/seed 回填全部写回对应 shot 对象的扩展字段，单集资产可整体版本化（git 或快照）
- 量产轻模式：标准对话场可只填 JSON 跳过部分 Markdown 复述
- 参照实现：`examples/E01_storyboard.json`（金标准集真源，v14 全链 PASS）

## 九、Schema v2 增量（㉞道具服装资产库 + ㉟群戏调度库，v38 落地机检）

> `schema_ver: 2`。v1 全部字段不变；以下为**新增字段**，全部遵循"字段存在才检查"的按需策略——不填不触发，填错必拦截。

### 9.1 道具卡升级（assets 中的 PROP-* 条目）

```json
"PROP-002": {
  "name": "银壳旧怀表",
  "importance": "贯穿道具",          // 贯穿道具/仪式道具/一次性道具 三级
  "prop_block": "银壳怀表，壳面氧化发乌带细密划痕……",   // 视觉逐字块（注意：不叫 desc_block——该键被 render.py 用于角色prompt注入，道具一律用 prop_block，特写镜头才整块引用）
  "visual_lock": true,               // 已出定妆图的视觉锁定道具
  "state_ledger": [                  // 状态账：每次可见变化登记（17b 校验 shot 必须真实存在）
    {"episode": "E01", "state": "指针停走", "shot": "S01-004", "note": "P01段钩"}
  ]
}
```

### 9.2 服装卡（assets 中的 WARD-* 条目）与镜头 wardrobe 字段

```json
"WARD-0001-V1-01": {"name": "灾变日常套", "role": "CHR-0001-V1", "episodes": ["E01","E02"]},
"WARD-0001-V1-02": {"name": "入城冬装套", "role": "CHR-0001-V1", "episodes": ["E05"]}
```
镜头侧：`"wardrobe": {"CHR-0001-V1": "WARD-0001-V1-01"}`；换装首镜必须 `"costume_change": true`。
**渲染中立**：WARD 卡与 wardrobe 字段均不被 render.py 消费（desc_block/env_block/name 之外的键不注入 prompt），加卡不改渲染基线。

### 9.3 群戏视线焦点（镜头字段）

`"gaze_focus": "CHR-0002-V1"` 或 `"画外：铁门方向"` —— 同框 ≥3 人（roles ∪ assets 中 CHR-* 计数）必须填写（17e WARN）。

### 9.4 新增机检项（validate.py 第 17 组，字段存在才检查）

| 项 | 级别 | 判据 | 处方 |
|----|------|------|------|
| 17a 道具引用闭环 | FAIL | shots[].props 引用的 PROP-ID 未在 assets 登记 | ㉝库§二表 → 先登记再引用 |
| 17b 状态账时序 | WARN | state_ledger 引用不存在的 shot | 修正状态账镜头号 |
| 17c 换装邻接 | FAIL | 同段内同角色 WARD 变化且该镜无 costume_change | 补换装镜标记或改回原套 |
| 17d 锁定道具锚定句 | WARN | visual_lock 道具的 INS/ECU 镜头 prompt 缺「严格匹配道具参考图」 | ㉝库§四模板 |
| 17e 群戏视线焦点 | WARN | 同框≥3人缺 gaze_focus | ㉟库§三视线接力 |

金标准：`examples/E04_storyboard.json`（道具/服装/换装/状态账全覆盖）；反例由 `scripts/mutation_test.py` 自动注入并验证抓捕。
