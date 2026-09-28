---
name: "珠宝电商图文视频一站式"
description: "仅限珠宝品类（戒指/项链/耳环/手链/吊坠/胸针等）的电商素材一站式生成技能，图片、文案、短视频一体交付：按平台预设产出商品主图、角度图、细节图、佩戴图、场景图、包装图、卖点图 + 商品文案 + 短视频。当用户说\"珠宝/戒指/项链/耳环/手链上架素材\"\"珠宝亚马逊九图\"\"珠宝电商全套图文视频\"\"珠宝商品图文案视频一起出\"\"用这款珠宝产品图做电商物料\"\"珠宝 Shopify/天猫/小红书/抖音种草\"时使用。非珠宝品类不适用。"
metadata:
  version: "1.0.0"
  author: "地质大学博士说AI"
  owner: "1814655359525112"
  skillId: "14811816960780"
  tag: ecommerce
  sortWeight: 1000
  source: 3
  createdAt: 1782120989032
  updatedAt: 1782441738378
  initialLikeCount: 80
  initialAddedCount: 311
  authorAvatarUrl: "https://p3-passport.byteacctimg.com/img/user-avatar/8d157a05737f5fd7a797aa5856494201~300x300.image"
  extraInfo: ""
  showcaseMedia: [{"type":"image","showcase_uri":"tos-cn-i-tb4s082cfz/4c057356cc044264ac69087c334b63ab","showcase_url":"https://p26-dreamina-sign.byteimg.com/tos-cn-i-tb4s082cfz/4c057356cc044264ac69087c334b63ab~tplv-tb4s082cfz-resize:0:0.image?lk3s=28a09430&x-expires=1817189864&x-signature=EnKAaY5sV15v%2BH1hdCDwK%2BPlRTU%3D"},{"type":"image","showcase_uri":"tos-cn-i-tb4s082cfz/fe8ec650ec3a480fa983cdbca387c3da","showcase_url":"https://p11-dreamina-sign.byteimg.com/tos-cn-i-tb4s082cfz/fe8ec650ec3a480fa983cdbca387c3da~tplv-tb4s082cfz-resize:0:0.image?lk3s=28a09430&x-expires=1817189864&x-signature=b5viLAYaLX2FoF0005Pl6q9s%2Bg0%3D"},{"type":"video","showcase_uri":"v0d870g10004d8u1qanog65qk9eiophg","showcase_url":"https://v9-artist.vlabvod.com/b5f500924f0c111914725934a2f4a60b/6a7824f2/video/tos/cn/tos-cn-v-148450/oUQiXlJhi8Q6ajIEKovNZdBExIwEwjsHoTUS0/"}]
---

## 技能内容：

分为**交互阶段**和**执行阶段**。交互阶段提取珠宝产品、简单描述、平台预设和素材；执行阶段自动补齐场景、槽位、工具链和质量检查，一步到位交付全套图 + 文 + 视频。

链式调用要求：每一步都必须写明下一步工具和输入素材。图片生成完成后，继续用生成图作为参考进入视频工具；视频片段生成后，继续进入 video\_editor；缺少必填信息时才调用表单，不把可选项变成阻塞。

批量执行要求：先生成任务清单，再按依赖、批次和并发规则调用工具。电商任务的数量单位是 SKU × 预设槽位，不能把一张拼图、一个视频或一段文案当作多个 SKU 的替代交付。

## 一、触发范围

### 1.1 应使用本技能的情况

* 用户需要珠宝商品上架图、广告图、详情页图、视频和文案。
* 用户提到 Amazon、亚马逊、Shopify、天猫、淘宝、京东、小红书、抖音、PDP、listing、主图、九图、详情页、种草视频。
* 用户上传产品图，要求"做一整套电商素材"。
* 用户没有产品图，但给了设计描述，希望直接生成可销售视觉物料。

### 1.2 不应由本技能主导的情况

* 用户主要想"设计新款珠宝""批量出款""做系列设计""参考某风格做 20 款"，应先完成专业珠宝设计方案。
* 用户只要专业设计概念，不要电商图文视频。
* 用户要求真实证书、产地、价格、库存、品牌授权等不可从视觉生成中证明的信息。

## 二、工具映射

| 工具名                                   | 本技能用途                | 链式调用提示                     |
| ------------------------------------- | -------------------- | -------------------------- |
| generate\_form\_for\_info\_collection | 只在缺少产品类型或简单描述时收集必填信息 | 表单完成后必须进入图片生成，不停在确认摘要      |
| creation\_agent\_search               | 查询平台规范、趋势参考、非侵权风格参考  | 搜索完成后必须沉淀为图片提示词约束          |
| text2image / text2image\_v3           | 无产品图时生成产品母图、首屏图      | 母图通过后必须作为后续 image2image 参考 |
| image2image / image2image\_v3         | 有产品图或母图后生成所有商品槽位图    | 每个槽位都重复产品身份锁               |
| foreground\_segmentation              | 白底主图、透明底、详情页产品抠图     | 抠图后继续进入超分或详情页组合            |
| image\_super\_resolution              | 主图、细节图、视频关键帧高清化      | 只处理结构正确的图                  |
| text2video                            | 快速概念片，无参考图时可用        | 非默认；有图片后不要用它重造产品           |
| image2video                           | 单张主图生成简单动效           | 生成后继续进入 video\_editor      |
| start\_end2video                      | 开盒、远近推进、首尾帧过渡        | 适合礼盒开场或产品由远到近              |
| multi\_frame2video                    | 多张商品图串成 10 秒广告       | Amazon 9 图视频可用             |
| multi\_modal2video                    | 用商品图、佩戴图、音频等生成高一致性广告 | 默认优先视频工具                   |
| video\_editor                         | 拼接、配乐、整理最终成片         | 视频流程最后必须调用                 |

在线版适配规则：

* 如果在线环境提供 v3 工具，图片生成优先使用 text2image\_v3 / image2image\_v3；否则使用通用工具名。
* 图片类任务默认使用 4.7 模型的 2k 版。
* 视频类任务默认使用 seedance2.0fast\_vip。
* 如用户明确指定图片或视频模型版本，按用户指定执行，不再套用对应默认模型。
* 不硬编码本地 云端生成 模型名、账号命令或任务查询命令。
* 当工具面板提供商业摄影、电商主图、产品广告、竖屏短视频、高清输出等预设时，优先选择最贴近场景的预设。

## 三、输入字段

| 字段        | 必填 | 缺失时处理                                                       |
| --------- | -- | ----------------------------------------------------------- |
| 珠宝产品      | 是  | 无法判断产品类型时，调用 generate\_form\_for\_info\_collection，停止执行直到补齐 |
| 简单描述      | 是  | 没有材质、风格、用途或外观线索时，调用表单补一句描述                                  |
| 产品图 / 参考图 | 否  | 有图则锁定 SKU 身份；无图则先生成产品母图                                     |
| 电商预设      | 否  | 默认 amazon\_9\_images\_10s\_video                            |
| 平台        | 否  | 随预设自动设置                                                     |
| 图片模型      | 否  | 默认 4.7 模型的 2k 版；用户指定模型版本时按指定                                |
| 视频模型      | 否  | 默认 seedance2.0fast\_vip；用户指定模型版本时按指定                        |
| 图片比例      | 否  | 商品图默认 1:1，详情页默认 3:4                                         |
| 视频比例      | 否  | 默认 9:16                                                     |
| 视频时长      | 否  | 默认 10 秒，可在 4-15 秒内调整                                        |
| 文案语言      | 否  | 默认中文；Amazon 预设额外生成英文标题和 bullet points                       |
| 目标客群      | 否  | 默认礼物购买者与自购女性消费者                                             |
| 视觉风格      | 否  | 默认高端真实商业摄影                                                  |

## 四、产品身份锁

每次进入图片或视频工具前，先写出产品身份锁，并在后续提示词中重复。

产品身份锁包括：

* 产品类型：戒指、项链、耳环、手链、吊坠、胸针等。
* 主轮廓：整体形状、比例、视觉重心。
* 材质：铂金、18K 白金、18K 黄金、玫瑰金、珍珠、珐琅等。
* 宝石：主石颜色、切工、位置，副石排列。
* 结构：镶口、爪数、链条、扣具、耳针、铰链、开口等。
* 禁止变化：不得增加宝石、改金属、改主石形状、添加假 Logo、证书或价格。

## 五、任务清单、数量守恒和并发

在调用任何生成工具前，先生成电商任务清单。

### 5.1 计数规则

| 场景                  | requested\_count 计算          |
| ------------------- | ---------------------------- |
| 1 个 SKU 的 Amazon 预设 | 9 张图片 + 1 个视频 + 1 组文案        |
| N 个 SKU 的 Amazon 预设 | N × 9 张图片 + N 个视频 + N 组文案    |
| Shopify 7 图预设       | 每个 SKU 7 张图片 + 1 个视频 + 1 组文案 |
| 纯产品净化包              | 每个 SKU 至少白底图、透明底、高清细节和文案     |

如果用户说"3 款戒指做亚马逊九图和视频"，必须规划 3 个 SKU，每个 SKU 9 张图、1 条视频和 1 组文案；不得只做一套示例。

### 5.2 任务清单模板

| job\_id     | SKU   | target    | tool                   | model                | depends\_on                                        | status  | quality\_gate |
| ----------- | ----- | --------- | ---------------------- | -------------------- | -------------------------------------------------- | ------- | ------------- |
| SKU01-BASE  | SKU01 | 产品母图/身份参考 | text2image\_v3 或 用户上传图 | 4.7 模型 2k 版          |                                                    | planned | 产品身份锁         |
| SKU01-IMG01 | SKU01 | 白底主图      | image2image\_v3        | 4.7 模型 2k 版          | SKU01-BASE                                         | planned | EC-I1/EC-I3   |
| SKU01-IMG04 | SKU01 | 微距细节图     | image2image\_v3        | 4.7 模型 2k 版          | SKU01-BASE                                         | planned | EC-I1/EC-I5   |
| SKU01-VID01 | SKU01 | 10 秒视频    | multi\_modal2video     | seedance2.0fast\_vip | SKU01-IMG01, SKU01-IMG04, SKU01-IMG05, SKU01-IMG08 | planned | EC-V1/EC-V3   |
| SKU01-FINAL | SKU01 | 最终成片      | video\_editor          |                      | SKU01-VID01                                        | planned | EC-V4         |

### 5.3 并发规则

* 产品母图或上传图确认前，不并发生成槽位图。
* 同一 SKU 的 9 张独立图片可并发生成，默认并发 4-6。
* 多个 SKU 可按 SKU 分批，也可对同类槽位并发，但每个 job 必须带 SKU 编号。
* 视频生成依赖主图、微距图、佩戴图、礼盒图；这些参考图未完成前不得生成视频。
* 每个 SKU 的最终 video\_editor 拼接只能在该 SKU 视频素材完成后执行。
* 失败图片保留原 job\_id 重试，不减少 requested\_count。

## 六、电商预设

### 6.1 amazon\_9\_images\_10s\_video

默认预设，适合跨境电商 listing。

| 序号 | 物料       | 规格                | 工具链                                                               |
| -- | -------- | ----------------- | ----------------------------------------------------------------- |
| 1  | 白底主图     | 1:1，纯白背景，主体占比高    | image2image → foreground\_segmentation → image\_super\_resolution |
| 2  | 45 度角度图  | 1:1，展示结构和宝石火彩     | image2image                                                       |
| 3  | 侧面 / 背面图 | 1:1，展示戒托、扣具、链路等   | image2image                                                       |
| 4  | 微距细节图    | 1:1，宝石切工、镶嵌、金属边缘  | image2image → image\_super\_resolution                            |
| 5  | 模特佩戴图    | 3:4 或 1:1，真实比例    | image2image                                                       |
| 6  | 生活方式图    | 3:4，送礼/婚礼/通勤场景    | image2image                                                       |
| 7  | 卖点解释图    | 1:1，可有简洁图形但不编造参数  | image2image                                                       |
| 8  | 包装礼盒图    | 1:1，高端礼盒和产品同框     | image2image                                                       |
| 9  | 品牌氛围图    | 3:4，广告收尾感，无假 Logo | image2image                                                       |
| 10 | 10 秒视频   | 9:16，微距、佩戴、礼盒、收尾  | multi\_modal2video → video\_editor                                |
| 11 | 文案       | 标题、五点、短描述、字幕      | 技能内部生成                                                            |

链式调用强制说明：

1. 如果没有产品图，先 text2image / text2image\_v3 生成产品母图。
2. 用产品图或母图连续生成 9 个电商槽位图。
3. 对白底主图执行 foreground\_segmentation，必要时对主图和微距图执行 image\_super\_resolution。
4. 选主图、微距图、佩戴图、礼盒图作为 @图片1-@图片4，调用 multi\_modal2video 生成 10 秒视频。
5. 调用 video\_editor 输出最终成片。
6. 生成英文 title、five bullets、short description、image captions、video subtitles。

### 6.2 shopify\_pdp\_7\_images\_8s\_video

适合独立站商品页。

* 7 张图：主图、角度、微距、佩戴、生活方式、包装、品牌氛围。
* 8 秒视频：更少文字，更强品牌摄影质感。
* 文案：产品标题、短描述、SEO 摘要、材质说明、护理提示。

链路：

text2image / image2image → image2image 扩展 7 图 → image\_super\_resolution → multi\_modal2video → video\_editor

### 6.3 tmall\_detail\_page

适合天猫、淘宝、京东详情页。

* 首屏海报。
* 材质与工艺模块。
* 佩戴场景模块。
* 宝石/金属微距模块。
* 礼赠包装模块。
* 护理与注意事项模块。
* 中文标题、卖点短句、详情页文案。

链路：

image2image → foreground\_segmentation → image\_super\_resolution → 详情页文案生成

### 6.4 xiaohongshu\_douyin\_seed

适合小红书和抖音种草。

* 3 张封面/种草图。
* 10-15 秒竖屏视频。
* 口播脚本、字幕条、标题建议。

链路：

image2image → multi\_modal2video → video\_editor

### 6.5 clean\_product\_pack

适合已有产品图标准化。

* 白底主图。
* 透明底抠图。
* 高清微距图。
* 简短上架文案。

链路：

image2image → foreground\_segmentation → image\_super\_resolution

## 七、执行流程

### 步骤 1：提取与补齐

提取用户输入，填入字段表。只在缺失必填项时调用 generate\_form\_for\_info\_collection。

### 步骤 2：选择预设

用户指定平台则按平台选择；未指定时默认 amazon\_9\_images\_10s\_video。

### 步骤 3：建立产品身份锁

有产品图时以产品图为最高优先级；无产品图时先生成产品母图。

### 步骤 4：生成图片

每个槽位都单独写提示词，必须包含：

* 图片模型：默认 4.7 模型的 2k 版；用户指定模型版本时按指定。
* 产品身份锁。
* 当前槽位目的。
* 构图、背景、灯光、比例。
* 禁止改变产品结构。
* 下一步工具：如果该图要进入视频，明确标记"本图将作为 @图片N 进入 multi\_modal2video"。

### 步骤 5：标准化与高清

白底主图、透明底和详情页元素调用 foreground\_segmentation。主图、微距图和关键帧调用 image\_super\_resolution。

### 步骤 6：生成视频

默认视频提示词：

模型设置: seedance2.0fast\_vip；用户指定视频模型版本时按用户指定。 使用 @图片1 作为产品身份参考，@图片2 作为微距细节参考，@图片3 作为佩戴比例参考，@图片4 作为礼盒/场景参考，生成 10 秒 9:16 高端珠宝电商短视频。 0-2s 微距推进，展示主石、金属反射和镶嵌细节。 2-4s 产品轻微环绕或光线扫过，结构保持不变。 4-6s 模特佩戴，动作自然，珠宝清晰可见。 6-8s 礼盒或生活方式场景，营造送礼情绪。 8-10s 产品英雄收尾，背景干净，留出字幕空间。 禁止改变珠宝造型、宝石颜色、镶嵌结构、金属材质；禁止假 Logo、文字水印、额外首饰、产品变形。

视频生成后必须继续调用 video\_editor 做最终成片整理。

### 步骤 7：生成文案

Amazon 默认输出：

* English Title。
* Five Bullet Points。
* Short Description。
* 9 条图片 caption。
* 10 秒视频字幕。
* 中文运营卖点摘要。

文案不得编造证书、克拉数、产地、天然等级、价格、库存、品牌授权或功效。

## 八、质量检查

### 图片检查

| 编号    | 标准                        |
| ----- | ------------------------- |
| EC-I1 | 产品身份一致，主石、金属、结构不漂移        |
| EC-I2 | 电商槽位明确，9 张图不能重复完成同一目的     |
| EC-I3 | 白底图干净，无文字、Logo、证书、价格和多余道具 |
| EC-I4 | 佩戴图比例真实，珠宝清晰，不被模特或其他首饰抢占  |
| EC-I5 | 细节图可读，宝石和镶口结构可信           |

### 视频检查

| 编号    | 标准                       |
| ----- | ------------------------ |
| EC-V1 | 视频基于参考图，不从纯文本重造产品        |
| EC-V2 | 镜头运动克制，产品始终清晰            |
| EC-V3 | 时长、比例和节奏符合预设             |
| EC-V4 | 视频完成后经过 video\_editor 整理 |

失败处理：

* 产品漂移：增加产品身份锁，改用更多参考图，优先 multi\_modal2video。
* 背景不干净：调用 foreground\_segmentation 或重做白底图。
* 清晰度不足：结构正确时调用 image\_super\_resolution。
* 链路中断：在回复里明确"下一步调用工具为 X，输入为刚生成的 Y"。

## 九、输出格式

```markdown
# 珠宝电商素材交付

## 执行汇总
- requested_count:
- planned_count:
- done_count:
- failed_count:
- missing_count:
- concurrency:
- batch_size:

## 项目摘要
- 产品:
- 预设:
- 平台:
- 假设:

## 产品身份锁
- 类型:
- 材质:
- 宝石:
- 结构:
- 禁止变化:

## 图片物料
| 序号 | 物料 | 工具链 | 模型 | 状态 | 备注 |
|---|---|---|---|---|---|

## 视频物料
- 工具链:
- 模型:
- 使用参考图:
- 时长/比例:
- 镜头脚本:
- 状态:

## 商品文案
- Title:
- Bullets:
- Short Description:
- Captions:
- 字幕:

## 质量检查
| 项目 | 结果 | 处理 |
|---|---|---|
```

## 十、可扩展预设空间

可继续扩展的电商预设命名建议：

* amazon-premium-gift-set
* wedding-bridal-listing
* luxury-high-jewelry-campaign
* live-commerce-jewelry-pack
* holiday-gift-campaign

每个预设至少定义：适用平台、图片槽位、视频链路、文案模块、质量检查和禁止项。
