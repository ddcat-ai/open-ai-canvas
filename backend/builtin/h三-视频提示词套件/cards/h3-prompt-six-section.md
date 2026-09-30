---
name: h3-prompt-six-section
description: 当用户说"写 H3 提示词 / 编译官方六段 / translator / 时间轴不对 / 段数超了"时调用。关键触发：写 H3 提示词、编译官方六段式/三段式、时间轴不对、段数超了。工位边界：本技能只做H3 官方六段式编译，不产出完整分镜表与成片流程；后者由上游市场技能『叙事短片导演分镜』等负责，两者接力不抢戏。
source_book: MiniMax H3 官方文档（base-en.md / ref-en.md，2026-08 入库 prompts 向量库核验）
source_chapter: "VIDEO_PROMPT_WRITING_GUIDE_base_en / ref_en（六段式 Full-Reference Mode）"
tags: [h3, prompt-engineering, video-gen, 六段公式, 三段式, translator, 时间轴, AI生成友好]
layer_confidence: "candidate"
pack: MiniMax H3 提示词规范
core_stance: "H3 提示词不是自由散文，而是官方六段式(ref-en)/三段式(base-en)的确定性结构；中间态结构化录入 + prompt_translator 编译，杜绝自创骨架错配官方规范。"
skill_type: "framework"
consult_tier: "B（琥珀区·公开官方文档方法论）"
verify_state: raw
card_type: book
publish_tier: tier-attrib
source_repo: "MiniMax H3 官方技能文档（即梦 Dreamina 官方 skills 语料，raw-materials/MiniMax-H3-skills）"
source_license: "规范要点整理自 MiniMax 公开文档（功能事实整理，非表达复制）"
upstream_defer: ["叙事短片导演分镜"]
first_seen: 2026-08-14
source_card: MiniMax H3 提示词规范/h3-prompt-six-section
evidence: E4

---

## S — 规范要点 (Spec Summary)

> 本节为 MiniMax H3 公开文档的功能事实整理（字段名/参数/规则属公共技术事实，非表达复制）；官方原始措辞以 MiniMax 文档为准。

H3 是接受文字、图片、视频、音频四类素材的视频生成模型，官方定义四种输入模式：T2VA 走纯文本；I2VA 走图片，可带首尾帧（first_frame/last_frame）；FL2VA 为首尾帧叠加参考；L2VA 挂参考图/视频/音频（reference_image/reference_video/reference_audio）。首尾帧与参考素材是两条互斥的输入通道——同一个请求只能选其一。

提示词靠别名链引用素材：`<Subject N>` 指可见主体，`<Picture N>` 指参考图锚，`<Video N>` / `<Audio N>` 同理。

官方规范给出两套提示词骨架：

- **三段式**：integrated_multimodal_description、overall_soundscape、non_diegetic_music 三段；人物以内联标签写进正文，没有独立的 subject_definitions 段。面向 T2VA / I2VA 这类无参考素材的场景。
- **六段式（Full-Reference Mode）**：subject_definitions、summary、retention_analysis、detailed_description、overall_soundscape、non_diegetic_music 六段；面向带参考素材的复杂镜头。

时长取 4–15 的整数秒；单个镜头的分段建议不超过四段。

## I — 方法论骨架 (Interpretation)

**六段式字段（ref-en.md，每段职责单一）：**
1. **subject_definitions**：给每份素材起别名+角色。`<Subject N>` 是可见可复用内容，`<Picture N>` 是参考图锚；`character_anchor` 的 `<Subject N>` **内联引用** `<Picture K>`，`set_anchor`/`first_frame`/`keyframe`/`last_frame` 的 `<Picture K>` **单独成行**。
2. **summary**：方括号任务前缀（ref-en §3）——`[reference generation]` / `[keyframe completion]` / `[video editing + audio reuse]` / `[audio reuse]` + 一句话说明本片目标与素材关系。
3. **retention_analysis**：声明跨镜头须保持的视觉/音频要素，用**固定标记**：视觉 `fully_preserved`/`partially_preserved`/`attribute_transfer`/`weak_reference`；音频 `fully_copy`/`partially_copy`/`reference`/`weak_reference`。
4. **detailed_description**：连续段落。首镜 `[Shot 1]` 无时间戳，后续 `[Shot N] At MM:SS.mmm`（base-en §2.2）；动作按序；**运镜写三段自然句**（motion type + amplitude + speed，base-en §4.3，13 类 motion：pan/zoom(dolly)/track/follow/orbit/tilt/pedestal/crane/jib/handheld/static/arc/compound），不写官方未列短 tag。
5. **overall_soundscape**：全片 1–4 句概括现场声，**去时间轴**。
6. **non_diegetic_music**：1–3 句（乐器/速度/节奏/动态），**去时间轴**。

**对白铁律（ref-en §4.4/§5.4 强制）**：`<Subject N> (S1) says with <voice>: <d>[Language] 原文</d>`——**必须保留原文语言**，翻译只进 scene_note 元数据，绝不进 prompt 主体。

## A1 — 书中的应用 (Past Application)

- **高光镜（夏云掐麦）**：六段齐全，summary=`[reference generation]`，retention `<Subject 1>` fully_preserved 跨 [Shot 1][Shot 2]，detailed_description 三镜带 `At 00:03.000`/`At 00:07.000`，对白 `<d>[Chinese] 别念了。</d>` 零中文主体。经 `prompt_translator` 编译 + `validate_official` 校验全绿。
- **反面例**：自创"六字段骨架"（素材定义/保留关系/分镜时间轴/台词/环境声/配乐）与官方两套格式全错配 → H3 忽略参考关系退化为纯文本 → 必须走 translator 编译。

## A2 — 触发场景 (Future Trigger)

- 阶 ⑨ H3 提示词工厂：分镜面板结构化录入中间态 → 一键「编译为官方提示词」按钮（调 prompt_translator）。
- 会审放行（阶 ⑩）可执行性轴：六段/三段齐全、summary 前缀、retention 固定标记、时间戳、对白 `<d>[Lang]` 合规（validate_official）。
- 语言信号："写 H3 提示词 / 编译官方六段 / 时间轴不对 / 段数超了"。

## E — 可执行步骤 (Execution)

1. **定参数**：duration（4–15 整数）、aspect_ratio、seed、negative_prompt、style 先落。
   *完成标准*：四参数齐全。
2. **填中间态（结构化，不手写六段）**：subjects（character_anchor/set_anchor+ref_image）/ retention（marker 固定值）/ segments（s,e,desc,camera 短 tag）/ dialogue（t,e,subject,voice,line 原文,lang）/ ambience / score / scene_note（中文审读）。
   *完成标准*：每个素材有唯一 label，retention marker 取自固定白名单。
3. **编译**：`python _engine/cli_runner.py h3_translate <中间态.json> --out <dir>`（或分镜面板按钮）→ 产出官方六段式/三段式英文 prompt。
   *完成标准*：输出含六段 + `[reference generation]` + `<d>[Language] 原文</d>` + `At MM:SS.mmm` + 运镜三维度句。
4. **校验**：`validate_official(prompt, mode, duration, segments)` —— 六段/三段齐全、summary 前缀、retention 固定标记、时间戳、对白格式。
   *完成标准*：零 issue。
5. **自检**：负面词含变形/穿帮/违和项；与分镜表该镜逐字段比对；事实不与账本冲突。
   *完成标准*：过会审可执行性轴。

## O — 官方底本召回 + Translator 编译 (Official Source Recall)

本卡方法源自 MiniMax H3 官方文档（已入库 prompts 向量库，Tier B）。写某镜前，先用提示词库召回官方原文片段补「字段级精确语法」；正式产出走 **prompt_translator 确定性编译**，不手写六段。

召回命令（系统级，零脚本）：
```
python _engine/cli_runner.py prompt_recall "<本镜需求关键词>"
```
例：`prompt_recall "首尾帧与参考素材不得混用"` / `prompt_recall "reference_image 绑定写法"` / `prompt_recall "运镜动词 手持跟踪"`

编译命令：
```
python _engine/cli_runner.py h3_translate <中间态.json> --out <导出目录>
```

**Tier B 边界（铁律）**：字段名/前缀/固定标记/格式为官方公开 spec，可引用；**不得整段照搬官方示例散文**。授权以官方 QA-about-License 为准（B 类可在授权地区商用，仅借技法）。

重点召回补强项：
- 四种输入模式 `T2VA / I2VA / FL2VA / L2VA` 的参数写法与适用场景；
- `reference_image / reference_video / reference_audio` 绑定格式（reference-to-video）；
- 首尾帧（`first_frame`/`last_frame`）与参考素材两类输入**不得混在同一请求**；
- `summary` 方括号前缀表（ref-en §3）、`retention_analysis` 固定标记；
- 运镜三段自然句（motion type + amplitude + speed，base-en §4.3，13 类 motion）。

---

## ⚠️ 气口衔接 / 气闸（airlock）模式 · 已原生支持（2026-08-24 主人裁定走 B）

主人设计本 translator **即为长视频拼接服务**，故已集成 `segment_role` 编译模式，气闸段可由本卡直接产出官方六段式（格式层），无需借阶6.5 生产线的 `compile_h3_prompt` 重写格式。

**中间态加 `segment_role` 字段**：
- `"segment_role": "main"`（默认）→ 主戏段，按原六段式编译（带 `[Shot N] At` 时间戳、可有对白、允许 last_frame 锚）。
- `"segment_role": "airlock"` → 气闸段，编译时强制遵守蓝图红线纪律：

| 纪律（蓝图红线） | translator airlock 模式行为 |
|---|---|
| 红线1/5 气闸禁时间码 | `detailed_description` **不写 `[Shot N] At MM:SS.mmm`**，整段拼成持续状态描述（无时间戳） |
| 红线5 气闸无对白 | 即便中间态误填 dialogue，airlock 模式**自动忽略对白**，不渲染 `says`/`[Language]` |
| §6 first_frame 禁用 | `<Picture K>` 标 `first_frame` 时**跳过+warning**；仅留 `last_frame` 锚（文案改钉住上一镜尾帧） |
| 红线5 微动作防冻结 | 不强制内容，但 `segments.desc` 仍由上游填写（建议含呼吸/重心微移类微动作） |
| duration 放宽 | airlock 段允许 1–15s（默认 4–15 主戏） |

**气闸段编译示例（中间态 → 官方六段式）**：
```json
{
  "shot_id": "EP01-C02-AIRLOCK",
  "segment_role": "airlock",
  "mode": "reference",
  "duration": 2,
  "subjects": [
    {"label": "<Picture 1>", "ref_role": "last_frame", "ref_image": "prev_end.png",
     "traits": "Xiaoyun holding the same posture in the cramped live-room, duct-taped AR glasses, reddish subtitle afterglow"}
  ],
  "segments": [{"s":0,"e":2,"desc":"Xiaoyun holds the identical posture as the pinned frame, breathing slowly, a faint shift of weight to avoid freezing","camera":"static close"}],
  "dialogue": [], "ambience": ["faint room tone, distant hallway wind"], "score": ["none"]
}
```
→ `validate_official(..., segment_role="airlock")` 走 airlock 纪律分支：**不要求 `[Shot 1]` 时间戳、不要求对白、不要求首帧锚**，仅校验六段齐全+中文不进主体+last_frame 钉住表述。

**与阶6.5 生产线的职责切分（不重复、不冲突）**：
- **translator（本卡）** = 单镜官方格式编译器，现支持 main / airlock 两种段角色 → 出每段合规的 H3 prompt JSON。
- **阶6.5 生产线 `compile_h3_prompt`** = 序列编排层，负责把多段 prompt 接成镜头序列：统一 `+offset` 时间码编译、级联失效复核、clip schema 的 `airlock_prompt`/`main_action_prompt`/`continuity_note`、ComfyUI 段间引导（默认 22 帧钉尾运动+音频）机制调用。
- 即：translator 出「每一段长什么样」，生产线出「段与段怎么拼、接缝怎么钉」。两者上下游分工，气闸纪律在 translator 层（格式）与生产线层（序列）各管一段，互不覆盖但也不冲突。

**🔗 已桥接阶6.5 生产线（2026-08-24 · Task #204–205）**：生产线 `engine.py` 新增 `compile_airlock_via_translator(clip)`，当 clip 含结构化中间态 `airlock_spec`（与 translator 同构字段：subjects/ambience/score/style/duration）时，自动调 `translate(segment_role="airlock")` 把气闸段编译成官方六段式写回 `clip["airlock_prompt"]`；无 `airlock_spec` 时降级返回现有纯文本（兼容 LLM 直出）。分镜切割室 UI 气闸编辑区加「🪄 用 translator 编译官方六段式」按钮一键调用。→ 气闸段现可在生产线内直接产出官方格式，无需人工粘贴 translator 输出。

---

## 📝 官方写作技巧 Tips（来自 h3-prompt-writing，只借技法 · Tier B）

> 来源：MiniMax 官方 skills 仓库 `h3-prompt-writing`（2026-08 克隆归档于 `📦 原浆窖/raw/prompts/MiniMax-H3-skills/`）。该 skill 与本站 translator 思路同源（把多模态需求改写成 H3 结构），其 `references/base-en.txt`、`ref-en.txt` 与已入库官方文档 **md5 完全一致（同源）**，不重复入向量库。以下只提取可复用的「写好 H3 prompt 的通用原则」，不复制其工作流原文。

**通用原则（适用于所有段角色 / 所有风格）**：
1. **先定结构再填内容**：严格按官方六段/三段骨架组织，不自由散写——骨架错配是翻译器编译失败的首要原因。
2. **主体零中文**：最终 prompt 全英文；中文只进 `scene_note` 审读，对白原文包 `<d>[Language] 原文</d>`。
3. **动作按发生顺序、单镜 ≤4 段**：时间轴清晰，避免跳跃或同屏多动作打架。
4. **视觉要素具体可生成**：材质词（matte/brushed/frosted）、光影（top key/rim light）、运镜三维度（type+amplitude+speed）必须展开，不能只写「好看」「电影感」。
5. **声音三段不可省**：即使静音也写 `overall_soundscape` + `non_diegetic_music`（填 none/ambient 明确意图），避免模型自作主张加 BGM。
6. **风格化镜头叠加风格卡技法**：见同级 `h3-style-skills/` 八风格包，风格卡提供质感词表/禁止项/时间轴分段规则，与骨架互补。
7. **长视频用气闸段接缝**：>15s 或多镜拼接时，接缝处用 `segment_role="airlock"` 钉尾帧、无对白、微动作，配合生产线段间引导防漂移。
