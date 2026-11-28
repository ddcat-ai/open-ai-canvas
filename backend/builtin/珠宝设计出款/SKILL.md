---
name: "珠宝设计出款"
description: "专业珠宝设计与批量出款技能。面向戒指、项链、耳环、手链、吊坠、胸针及高级珠宝系列，支持从文字描述、风格参考、产品图、草图或主题关键词出发，高效生成真实可信、好看、可延展的珠宝设计图与设计说明。适合单款精品、批量出款、系列化方案、参考图变体、材质替换、风格矩阵。当用户说“设计一款珠宝”“批量出款”“做 20 款戒指”“参考这个风格延展”时使用；纯电商上架素材（九图/详情页/短视频）请移交电商技能。"
metadata:
  version: "1.0.0"
  author: "地质大学博士说AI"
  owner: "1814655359525112"
  skillId: "14811816969484"
  tag: creative
  sortWeight: 999
  source: 3
  createdAt: 1782137715030
  updatedAt: 1782386855340
  initialLikeCount: 31
  initialAddedCount: 122
  authorAvatarUrl: "https://p3-passport.byteacctimg.com/img/user-avatar/8d157a05737f5fd7a797aa5856494201~300x300.image"
  extraInfo: ""
  showcaseMedia: [{"type":"image","showcase_uri":"tos-cn-i-tb4s082cfz/5d18368747fd4d458c29ae6aacdb9927","showcase_url":"https://p26-dreamina-sign.byteimg.com/tos-cn-i-tb4s082cfz/5d18368747fd4d458c29ae6aacdb9927~tplv-tb4s082cfz-resize:0:0.image?lk3s=28a09430&x-expires=1817189864&x-signature=dV63woz8nhCStBsVoTJpBV4%2FUMM%3D"},{"type":"image","showcase_uri":"tos-cn-i-tb4s082cfz/0575b14b98e340c886e415cc93154046","showcase_url":"https://p26-dreamina-sign.byteimg.com/tos-cn-i-tb4s082cfz/0575b14b98e340c886e415cc93154046~tplv-tb4s082cfz-resize:0:0.image?lk3s=28a09430&x-expires=1817189864&x-signature=2Edq1G78Vssn%2BBXCn6991U16ypw%3D"},{"type":"image","showcase_uri":"tos-cn-i-tb4s082cfz/499bb94877834ab2bf5e24eda504ebca","showcase_url":"https://p26-dreamina-sign.byteimg.com/tos-cn-i-tb4s082cfz/499bb94877834ab2bf5e24eda504ebca~tplv-tb4s082cfz-resize:0:0.image?lk3s=28a09430&x-expires=1817189864&x-signature=B8niHdGwHnTgdOyNK0loVbbE5Js%3D"},{"type":"image","showcase_uri":"tos-cn-i-tb4s082cfz/105109a39ced4eea950e739595219e35","showcase_url":"https://p26-dreamina-sign.byteimg.com/tos-cn-i-tb4s082cfz/105109a39ced4eea950e739595219e35~tplv-tb4s082cfz-resize:0:0.image?lk3s=28a09430&x-expires=1817189864&x-signature=YyradhiL68ZoWZR3dtH1DoLJv%2BQ%3D"},{"type":"image","showcase_uri":"tos-cn-i-tb4s082cfz/dd00afa114614dc7bdb46b88a9f2111c","showcase_url":"https://p11-dreamina-sign.byteimg.com/tos-cn-i-tb4s082cfz/dd00afa114614dc7bdb46b88a9f2111c~tplv-tb4s082cfz-resize:0:0.image?lk3s=28a09430&x-expires=1817189864&x-signature=K%2B8a31J9CaXyF93LcCi0%2F9Rwju4%3D"}]
---

## 技能内容：

分为**交互阶段**和**执行阶段**。交互阶段提取珠宝类型、设计目标、数量、参考图和风格方向；执行阶段生成设计矩阵、调用图片工具、进行质量检查，并按数量要求完成单款或批量设计。

本入口按任务分成两个模式，先判断用户要哪一种，再只读对应卡片：

| 用户要什么 | 模式 | 先读 |
|---|---|---|
| 设计一款、批量出 N 款、参考图变体、材质或风格矩阵 | 单款/批量出款 | `cards/design-batch.md` |
| 在底座上做 4/8 个进化方向、用选择题比较候选、先出方向再选 | 设计进化 | `cards/design-evolution.md` |
| 需要提示词字段、九类设计预设或图片提示词骨架 | 提示词层 | `cards/design-presets.md` |
| 已经定稿，要做亚马逊九图、详情页、短视频或上架文案 | 移交电商 | `珠宝电商图文视频一站式`（`14811816960780`） |
| 用户明确提到旧名「珠宝设计进化」或旧 ID `14811816969740` | 兼容旧名 | `cards/evolution-migration.md` |

默认链路为"设计 brief → 设计矩阵 → 图片生成 → 质量检查 → 失败重试 → 最终设计表"。批量设计时不要逐个确认设计 ID；用户给定 N 款就建立 N 个 design_id，并逐项记录成功或失败。

## 一、触发范围

### 1.1 应使用本入口的情况

* 用户要求设计戒指、项链、耳环、手链、吊坠、胸针、珠宝套装或高级珠宝系列。
* 用户要求"批量出款""设计 N 款""做系列延展""参考某风格做变化"。
* 用户上传草图、产品图或参考图，希望做原创化变体。
* 用户要在已有珠宝图上做多方向进化，并通过选择题比较候选。
* 用户更关心设计质量、真实结构、效率和设计流程，而不是上架图文视频。

### 1.2 应移交电商技能的情况

当用户已经选定设计，并继续要求：

* "做亚马逊九图"
* "生成商品图文案视频"
* "上架素材"
* "详情页"
* "投放短视频"

则输出已确认设计图、产品身份锁、材质宝石说明和可用于后续商品图生成的提示词，交给 `珠宝电商图文视频一站式`。

## 二、设计身份与真实结构

每个设计必须定义：

* 类型：戒指、项链、耳环、手链、吊坠、胸针等。
* 轮廓：圆形、椭圆、羽毛、花卉、几何、流线等。
* 主视觉：主石、中心图案、链坠、耳坠、开口结构。
* 材质：金属色、表面工艺、珐琅、珍珠、彩宝等。
* 宝石方案：主石、配石、切工、颜色、排列方式。
* 结构：爪镶、包镶、密镶、链条、扣具、耳针、铰链、戒托、桥位。
* 佩戴逻辑：舒适度、重量感、开合方式、稳定性。

禁止：

* 大宝石没有支撑。
* 项链吊坠漂浮，没有吊环或连接结构。
* 手镯没有开口、铰链或弹性逻辑。
* 耳环过重但没有合理固定方式。
* 未经用户证明就声明克拉数、证书、产地或价格。

## 三、共同交付边界

* 单款交付：主设计图 + 设计摘要 + 结构说明 + 质量检查 + 下一步。
* 批量交付：设计矩阵、数量汇总、逐项图片状态、批量质量检查。
* 进化交付：底座身份锁、进化变量、候选矩阵、候选评审、可执行收尾。
* 图片默认使用 4.7 模型 2k 版；视频默认 seedance2.0fast_vip；用户明确指定模型时按用户指定。
* 不在线版写本地 CLI 模型名、账号命令或任务查询命令。
* 不编造品牌授权、证书、克拉数、产地、价格或库存。
* 不在图片中加入文字、水印、logo、价格牌或复杂背景。
