---
name: vis-to-prompt
description: "当用户已经定了画面设计（空间/影调/色彩/运动），却写不出模型能懂的提示词，或照搬电影术语导致模型还原不出原意图时调用。核心能力：七元素×对比相似→FLUX/H3 短语映射表（电影概念翻成具象描述词）+ 嵌入目标结构 + 术语清洗自检。关键触发：视觉决策怎么写成提示词、空间选型怎么翻译、影调同步英文怎么说、七元素转 prompt、vis-to-prompt。工位边界：只做「视觉决策→模型短语」的翻译与清洗，不产出视觉决策本身（由 vis 系列卡负责），也不产出完整分镜与成片流程；后者由上游市场技能『叙事短片导演分镜』等负责，两者接力不抢戏。"
tags: ["vis", "prompt-engineering", "translation-layer", "FLUX", "H3", "七元素映射"]
metadata:
  source_book: "《以眼说话：影像视觉原理及应用》 Bruce A. Block（汪代岚译）"
  attribution: "Methodological framework re-derived and rewritten by the Judian project from published-book methodology notes; inspired by the cited books, no original expression reproduced."
  source_card: "story-recipes\\05-视觉风格与影像基调\\以眼说话：影像视觉原理及应用\\vis-to-prompt\\SKILL.md"
evidence: E4

---
## I — 方法论骨架 (Interpretation)

### 七元素 × 对比相似 → FLUX/H3 短语映射表

#### 1. 对比 vs 相似（强度总阀）
| vis 决策 | FLUX 短语 | H3 短语 |
|---|---|---|
| 强对比（冲突/爆发/反套路揭穿） | `high contrast, stark lighting, clashing colors, dynamic composition` | `[Whip pan] rapid shift, high contrast cut, jarring transition` |
| 相似（平静/温馨/日常基底） | `low contrast, muted harmonious palette, soft diffused lighting, calm composition` | `slow gentle movement, matched cuts, continuous tone` |
| 中间档（温情微澜） | `moderate contrast, warm even lighting` | `slow build, gradual shift` |

#### 2. 空间四选型
| vis 决策 | FLUX 短语 | H3 短语 |
|---|---|---|
| 纵深空间（疏离/距离感） | `deep perspective, converging leading lines, foreground-background separation, shallow depth of field` | `[Push in] through doorway, subject receding into background` |
| 平面空间（平等/亲密群像） | `flat composition, frontal arrangement, minimal depth cues, everyone on same plane` | `[Static wide] flat staging, subjects aligned on one plane` |
| 有限空间（羁绊/包围感） | `framed within doorway, shallow depth of field, subject enclosed by foreground elements, frame within frame` | `[Static medium] through doorway frame, limited movement range` |
| 模糊空间（误会/悬疑） | `ambiguous depth, unclear spatial relationship, disorienting scale, fog obscuring depth` | `slow drift, spatial ambiguity, fog rolling in` |

#### 3. 线条与形状
| vis 决策 | FLUX 短语 | H3 短语 |
|---|---|---|
| 圆形（温和/亲和） | `rounded shapes, soft circular forms, curved edges` | `smooth circular movement, gentle arc` |
| 方形（秩序/稳定） | `geometric grid, rectilinear forms, orthogonal composition` | `static, locked-off, grid-aligned` |
| 三角（冲突/动感） | `sharp angular shapes, triangular composition, diagonal tension` | `[Handheld] tilting, unstable, dynamic diagonal motion` |
| 水平垂直线（平静） | `horizontal and vertical lines, stable composition` | `smooth horizontal track, level horizon` |
| 斜线（张力） | `diagonal lines, converging perspective lines, unstable angle` | `[Dutch angle] tilting frame, diagonal tracking` |

#### 4. 影调（明暗灰阶）
| vis 决策 | FLUX 短语 | H3 短语 |
|---|---|---|
| 暖亮（温情/可读性） | `bright warm key light, soft Rembrandt lighting, subject lit brighter than background` | `warm practical light, subject clearly visible, bright exposure` |
| 冷暗（压抑/疏离） | `low-key lighting, deep shadows, cool dim illumination, subject in partial shadow` | `moody dim lighting, shadow-heavy, cool tone` |
| 影调同步（喜剧可读性） | `even bright lighting, subject clearly separated from background by brightness` | `flat even lighting, no dramatic shadows, subject pops` |
| 影调分离（焦点+纵深） | `bright subject against dark background, strong tone separation, rim light` | `subject lit, background falls to shadow` |
| 反射光控法（低成本） | `bright costume color, reflective prop, light-colored backdrop` | —（H3 光照由 prompt 描述，反射光靠服装/道具词） |

#### 5. 色彩
| vis 决策 | FLUX 短语 | H3 短语 |
|---|---|---|
| 暖调基底 | `warm palette of amber and gold tones` | `warm amber color grading` |
| 冷色反套路场 | `cold palette of slate blue and ash grey` | `desaturated cool blue grading` |
| 饱和度对比（焦点） | `muted grey palette with single highly saturated red accent color #C0392B` | `desaturated background, subject in vivid saturated color` |
| 反用俗套（红=安全） | `warm red tones connoting safety and comfort, not danger` | `warm red palette, comforting tone` |
| 专属色母题 | `signature amber tone #E8A847 recurring as visual motif` | `consistent amber color theme throughout` |
| 互补色陷阱（避免） | 不写 `complementary colors`（FLUX 会互相去饱和变灰）；改写具体物体各自绑色 | — |

#### 6. 运动与节奏
| vis 决策 | FLUX 短语（单帧动势） | H3 短语（动态） |
|---|---|---|
| 静止/低节奏 | `frozen moment, still composition, no motion blur` | `[Static] held shot, minimal movement` |
| 高节奏/急促 | `motion blur, dynamic action freeze, sense of speed` | `rapid three-beat cut, fast tracking, quick pan` |
| 运动方向暗示 | `motion blur trailing left, coat fabric caught mid-swing` | `[Tracking left] following subject, fabric trailing` |
| 节奏控制 | —（单帧无节奏） | 分镜列 `shot A 4s hold → shot B 1s → cut → shot C 2s` |

#### 7. 情绪承载（综合翻译）
| vis 决策组合 | FLUX 短语 | H3 短语 |
|---|---|---|
| 孤独 | `small figure in enormous empty space, cold blue palette, vast negative space, low-key` | `[Wide shot] tiny figure, vast empty space, slow static hold` |
| 压迫/紧张 | `claustrophobic close framing, dutch tilt, harsh high contrast lighting` | `[Handheld] tight framing, dutch angle, unstable` |
| 温暖/亲密 | `intimate warm candlelight, shallow focus, two faces close, soft glow` | `slow push-in, warm practical light, shallow focus on faces` |

## A1 — 书中的应用 (Past Application)

- **纵深空间→代际疏离**：vis-space-four-types 决策"子女在画面远处显隔阂"，翻译为 FLUX `deep perspective, converging lines, subject small in far background, shallow depth of field` / H3 `[Wide shot] subject receding into background, slow push-in`。模型不懂"代际疏离"，但懂"近大远小+浅景深+主体在远处"。
- **影调同步→喜剧可读性**：vis-tone-control 决策"主体亮于环境保证包袱看清"，翻译为 FLUX `bright even lighting on face, subject clearly separated from background by brightness` / H3 `flat even lighting, no dramatic shadows, face clearly visible`。模型不懂"影调同步"，但懂"脸上亮、背景暗、没有阴影遮挡"。
- **饱和度对比→焦点**：vis-color-mapping 决策"灰调中唯一亮色围巾当焦点"，翻译为 FLUX `muted grey palette, single highly saturated amber scarf as focal point, color #E8A847`。模型不懂"饱和度对比"，但懂"灰色调+一个高饱和琥珀色围巾"。

## A2 — 触发场景 (Future Trigger)

- 阶⑧资产设计：场景概念图生成前，把 vis 系列卡定的空间选型/影调/色彩决策翻译成 FLUX 短语。
- 阶⑨提示词工厂：H3 六段时间轴各段需要填入画面描述时，把 vis 决策翻译成 H3 短语嵌入。
- 会审放行（阶⑩）一致性轴：检查提示词里的视觉短语与 vis 决策是否对应。
- 语言信号："视觉决策怎么写成提示词 / 空间选型怎么翻译 / 影调同步用英文怎么说 / vis-to-prompt / 七元素转prompt"。

## E — 可执行步骤 (Execution)

1. **取 vis 决策清单**：从阶⑦/阶⑧的视觉自检表或 assets.json 取出已做好的七元素决策（空间选型/线形/影调/色彩/运动/节奏/对比相似强度）。
   *完成标准*：至少有空间、影调、色彩三项明确决策。

2. **逐项查映射表翻译**：对每个已决策的元素，查本卡 I 段映射表，取出对应的 FLUX 短语和 H3 短语。
   *完成标准*：每个决策项都有对应的模型短语，无遗漏。

3. **嵌入目标提示词结构**：
   - FLUX 资产图：短语嵌入 flux-asset-image 的 Subject/Action/Style/Context 四层（空间→Context、影调→Style/Context、色彩→Style+HEX 绑定物体）。
   - H3 提示词：短语嵌入 h3-prompt-six-section 的时间轴各段（空间/构图→各段画面描述、影调/色彩→各段光线/视觉风格、运动→运镜动词）。
   *完成标准*：短语已嵌入目标结构，位置正确。

4. **术语清洗自检**：全文搜索电影术语名（"contrast/affinity""limited space""tone separation"等纯概念词），确认都已翻译为具象描述词而非照搬术语；与案例窖对应模块比对。
   *完成标准*：零裸术语，全部是模型能理解的具象描述。
