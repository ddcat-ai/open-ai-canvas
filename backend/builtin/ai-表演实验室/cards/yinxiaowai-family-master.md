---
name: yinxiaowai-family-master
description: "当用户说\"尹小歪那套人像/演技提示词怎么用\"、\"尹小歪的提示词\"、\"那套人像玩法\"时调用。核心能力：尹小歪 AI 提示词家族 · 跨媒介总控。关键触发：尹小歪那套人像/演技提示词怎么用、尹小歪的提示词、那套人像玩法。不适用于：纯文字设计、logo、非人像插画、风景/物体生图（除非以真人身份为底座的人像图）。"
tags: ["prompt", "image-gen", "portrait", "acting", "cross-media", "family-master", "portrait-acting"]
metadata:
  source_book: "13-AI角色表演与资产"
  attribution: "Methodological framework re-derived and rewritten by the Judian project from published-book methodology notes; inspired by the cited books, no original expression reproduced."
  source_card: "story-recipes\\13-AI角色表演与资产\\yinxiaowai-family\\yinxiaowai-family-master\\SKILL.md"
evidence: E4

---
## I — 路由方法论 (Interpretation)

两条判定轴，先判媒介，再派侧内总控：

**轴 1 — 媒介（图像 vs 视频）**
- 用户要的是**一张图 / 一组静态头像 / 表情包 / 旅行纪念 / 卡牌** → 图像侧。
- 用户要的是**一段表演 / 数字人演技 / 文生视频 / 图生视频** → 视频侧。
- 若用户同时说"出一张定帧人像 + 让角色演起来" → 以"表演"为主诉求走视频侧，定帧可作为视频的一帧或单独走图像侧，向用户澄清。

**轴 2 — 侧内路由**
- 图像侧总控 `ai-portrait-prompt`：先锁身份 → 按目的分流：
  - 材质实体化（丑萌/拼豆/纸雕/塔罗/珐琅/毛线）→ `ai-portrait-material`
  - 分身尺度（迷你分身/城市巨人）→ `ai-portrait-scale`
  - 卡牌头像（贴纸/银幕主角/3D潮玩/MBTI卡）→ `ai-portrait-card`
- 视频侧总控 `ai-acting-master`：十项公式 → 按表演层编排 5 子技巧：
  - 情绪节拍 → `emotion-action-beats`
  - 面部部位 → `facial-part-spec`
  - 头肩肢体 → `head-body-movement`
  - 生理皮肤 → `physiological-skin`
  - 景深运镜 → `dof-focus-cinematography`

一句话：**本 skill 只做"判媒介 + 派总控"，不写具体玩法约束**；具体约束交给两侧总控与其技法组。

## A1 — 合并后的家族地图 (Past Application)

| 侧 | 总控 | 技法组（10 个 skill） |
|----|------|----------------------|
| 图像 | `ai-portrait-prompt` | `ai-portrait-material`(6玩法) / `ai-portrait-scale`(2) / `ai-portrait-card`(4) |
| 视频 | `ai-acting-master` | `emotion-action-beats` / `facial-part-spec` / `head-body-movement` / `physiological-skin` / `dof-focus-cinematography` |

> 图像侧 12 玩法 = 6+2+4，与原文编号一一对应；视频侧 6 skill = 1 总控 + 5 表演层。两篇合并后共 10 个可执行 skill + 本 umbrella。

## A2 — 触发场景 (Future Trigger)

### 用户情境
1. 用户提"尹小歪那套人像/演技提示词怎么用"或不清楚该调哪个 skill。
2. 用户想用真人照做可控人像图（头像/表情包/分身/材质/卡牌）。
3. 用户想让数字人/视频角色演得有戏（情绪戏/表情自然/运镜服务表演）。
4. 用户诉求横跨图像+视频（既出定帧人像又演）。

### 语言信号
- 照片做成X风 / 加个分身 / 丑萌·银幕主角·3D头像·塔罗·毛线
- 角色演得假/僵硬 / 怎么写情绪戏提示词 / 让数字人更有戏
- "尹小歪的提示词" / "那套人像玩法"

### 与相邻 skill 的区分
- 本 skill 是**家族最外层入口**：只判媒介、派总控，不持有任何具体玩法约束。
- `ai-portrait-prompt` / `ai-acting-master` 是两侧**内部总控**，持有各自的身份锚定/十项公式与侧内路由。
- 10 个技法组是叶子节点，持有具体配方。

## E — 可执行步骤 (Execution)

1. **判媒介**：问自己——用户要的是一张图，还是一段表演？含"视频/数字人/演"→视频侧；含"头像/图/表情包/分身/材质/卡牌"且无表演→图像侧；模糊→向用户澄清主诉求。
   - *完成标准*：已确定"图像侧"或"视频侧"，并能向用户说明判断依据。
2. **派总控**：图像侧 → 调用 `ai-portrait-prompt`；视频侧 → 调用 `ai-acting-master`。
   - *完成标准*：已激活对应侧总控，并把用户原始诉求原样交接。
3. **侧内路由（由被派总控完成）**：图像侧按目的分流 material/scale/card；视频侧按表演层编排 5 子技巧。本 skill 不越权写具体约束。
   - *完成标准*：具体技法组被激活，或已向用户说明将套用的技法组。
4. **边界处置**：非人像/非角色、纯文字/logo/品牌VI/商业批量的诉求，明确拒用本家族并引导到合适工具。
   - *完成标准*：已对越界诉求给出"不接 + 建议替代"的明确答复。

## B — 边界 (Boundary)

### 不要在以下情况使用
- 纯文字设计、logo、非人像插画、风景/物体生图（除非以真人身份为底座的人像图）。
- 需要精确品牌 VI 合规、严肃商业设计或批量一致产线（家族定位趣味个人向）。
- 纯诗歌/代码/与真人身份无关的内容。
- 用户无合格真人照（多人/模糊/遮挡/光线差）时，应先要求重拍，否则身份必漂移。

### 已裁决的跨技能边界（darwin 升级后定稿）
1. **塔罗牌分流**：`ai-portrait-material` 玩法7 = **塔罗风人物肖像插画（非卡牌成品，原创平涂油墨）**；`ai-portrait-card` = **塔罗卡牌形式（把照片做成塔罗牌，含版权守卫）**。路由：塔罗风肖像(非卡牌)→material 玩法7；做成塔罗卡牌/涉及复制某知名塔罗IP→card（强制原创、不照搬现成IP、自创配色版式）。
2. **放大贴面分流**：无接触阴影、无物理落点的"超大等身招牌贴面放大版" = 单人符号化头像放大 → `ai-portrait-card`（sc-05 单人符号化头像放大呈现）；要真巨人坐姿+接触阴影+透视 → `ai-portrait-scale`。路由：放大贴面(无接触阴影)→card；城市巨人坐姿(有接触阴影)→scale。

## 相关 skills
- depends-on: []
- contrasts-with: []
- composes-with: [ai-portrait-prompt, ai-portrait-material, ai-portrait-scale, ai-portrait-card, ai-acting-master, emotion-action-beats, facial-part-spec, head-body-movement, physiological-skin, dof-focus-cinematography]
- 本 skill 是「尹小歪 AI 提示词」家族（两篇文章合并）的最外层跨媒介入口；图像侧与视频侧各自有内部总控，本 skill 只做媒介判定与派发。
