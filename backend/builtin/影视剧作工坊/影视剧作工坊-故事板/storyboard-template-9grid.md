# 9格黑白分镜故事版模板库（金标准参考）

> 来源：用户提供的高成熟度黑白漫画分镜模板图（雨夜巷道悬疑故事），作为本技能 9 格分镜故事版的**视觉金标准**。
> 本库定义 9 格分镜故事版的**叙事结构、镜头类型分配、情绪曲线、构图规范与 AI 生成适配规则**。
> 金标准示例图：`examples/E01_storyboard_9grid_golden.png`

---

## 一、9 格叙事结构总览

### 1.1 三幕四段式叙事弧

9 格分镜固定遵循「起→承→转→合」四段叙事节奏，适配 15 秒动态漫播放节奏：

| 格位 | 叙事段 | 功能 | 情绪方向 |
|------|--------|------|---------|
| 第 1 格 | **起** | 远景定场·环境铺垫 | 静·压抑·氛围建立 |
| 第 2 格 | **起** | 中近景·人物入场 | 引入·角色亮相 |
| 第 3 格 | **承** | 特写·细节伏笔 | 暗示·悬念埋设 |
| 第 4 格 | **承** | 过肩/中景·转折触发 | 转折·紧张升级 |
| 第 5 格 | **转** | 中心高潮·威胁/冲突爆发 | 峰值·视觉冲击 |
| 第 6 格 | **转** | 特写·准备/防御动作 | 决心·行动前奏 |
| 第 7 格 | **合** | 动态奔跑/爆发·速度线 | 爆发·节奏最快 |
| 第 8 格 | **合** | 外部力量介入·空间压迫 | 绝境·升级 |
| 第 9 格 | **合** | 静止定格·开放式结局 | 收束·留白·余韵 |

### 1.2 情绪曲线控制

```
静 ──→ 引入 ──→ 暗示 ──→ 紧张 ──→ 冲击 ──→ 决心 ──→ 爆发 ──→ 绝境 ──→ 静止
低    中低     中       中高      峰值     高       最高     高       低（留白）
```

**核心原则**：由静到动再到静，配合光影变化实现心理起伏。首尾呼应，中间爆发。

---

## 二、逐格镜头规范（金标准参数）

### 第 1 格｜远景定场·环境铺垫

| 参数 | 金标准值 |
|------|---------|
| 景别 | 远景（WS/EWS） |
| 推荐焦距 | 20mm 超广角 |
| 构图 | 纵深透视，主体极小（占画面<1/10），突出环境孤立感 |
| 人物 | 剪影或背影，走向画面深处，比例极小 |
| 光影 | 单点光源（路灯/月光），大面积阴影，地面湿滑反光 |
| 景深 | 大景深，前后清晰 |
| 叙事功能 | 设定时间（夜晚）、地点（巷道/废墟/大厅）、天气/氛围 |
| AI 关键词 | `wide establishing shot, deep perspective, silhouette figure, dramatic lighting, atmospheric` |

### 第 2 格｜中近景·人物入场

| 参数 | 金标准值 |
|------|---------|
| 景别 | 中近景（MCU） |
| 推荐焦距 | 28mm 小广角 |
| 构图 | 人物占画面 2/3，侧面 45°，一侧留白表现空间感 |
| 人物 | 低头/沉思/专注状态，面部特征首次亮相 |
| 光影 | 侧面光照亮半张脸，另一半隐入阴影 |
| 景深 | 中等景深，人物清晰+背景可辨 |
| 叙事功能 | 引入主角外貌特征，暗示心理状态 |
| AI 关键词 | `medium close-up, side profile 45 degrees, character introduction, contemplative expression` |

### 第 3 格｜特写·细节伏笔

| 参数 | 金标准值 |
|------|---------|
| 景别 | 特写（ECU/INS） |
| 推荐焦距 | 100mm 微距长焦 |
| 构图 | 低角度/极端特写，聚焦局部（脚部/手部/道具/水洼倒影） |
| 人物 | 仅展示局部，不露面 |
| 光影 | 利用反射/倒影增加画面层次与神秘感 |
| 景深 | 浅景深，主体锐利+背景虚化 |
| 叙事功能 | 制造心理暗示，为后续转折埋下伏笔 |
| AI 关键词 | `extreme close-up, low angle, reflection in puddle, detail shot, foreshadowing` |

### 第 4 格｜过肩/中景·转折触发

| 参数 | 金标准值 |
|------|---------|
| 景别 | 中景（MS）/ 过肩镜头（OTS） |
| 推荐焦距 | 35mm 人文标准 |
| 构图 | 主角背部占前景，头部转向一侧，视线方向引导读者 |
| 人物 | 身体紧绷，肩膀微耸，表情严肃（仅见侧脸轮廓） |
| 光影 | 背景灰阶加深，压迫感上升 |
| 景深 | 中景深，前景虚化+中景清晰 |
| 叙事功能 | 表现主角察觉异样，触发紧张情绪，推动剧情转折 |
| AI 关键词 | `over-the-shoulder shot, character turning back, tension building, alert expression` |

### 第 5 格｜中心高潮·威胁/冲突爆发

| 参数 | 金标准值 |
|------|---------|
| 景别 | 中近景至近景（MCU/CU） |
| 推荐焦距 | 35mm 标准镜（冲突稳定） |
| 构图 | 威胁符号居中，正面直视，距离感拉近 |
| 人物 | 全黑剪影/模糊轮廓，不具象化以激发想象 |
| 光影 | 用负空间（黑色）对抗正空间（灰色背景），强化视觉冲击 |
| 景深 | 中景深 |
| 叙事功能 | 象征未知危险源，典型「恐怖谷效应」运用，全段视觉冲击力最强 |
| AI 关键词 | `silhouette threat figure, center composition, confrontational, dramatic contrast, horror valley effect` |

### 第 6 格｜特写·准备/防御动作

| 参数 | 金标准值 |
|------|---------|
| 景别 | 特写（ECU） |
| 推荐焦距 | 85mm 人像长焦 |
| 构图 | 极端特写，聚焦局部动作（手握武器/道具/拳头） |
| 人物 | 仅展示手部/局部，肌肉线条明显，显示决心或恐惧 |
| 光影 | 高对比度，指节/关节处高光 |
| 景深 | 浅景深，主体锐利 |
| 叙事功能 | 暗示主角已做好应对准备，道具/武器隐喻（日常用品=潜在武器） |
| AI 关键词 | `extreme close-up hand gripping, knuckles white, determination, weapon or tool detail` |

### 第 7 格｜动态奔跑·速度线·爆发力

| 参数 | 金标准值 |
|------|---------|
| 景别 | 全景（FS） |
| 推荐焦距 | 32mm 微广角 |
| 构图 | 放射状速度线包围全身，中心聚焦奔跑者，四肢舒展，重心前倾 |
| 人物 | 全力冲刺，面部狰狞（咬牙瞪眼），衣物飞扬 |
| 光影 | 正面追踪，速度线强化运动感 |
| 景深 | 大景深 |
| 叙事功能 | 表现紧急逃亡/追逐，节奏骤然加快，达到情绪峰值 |
| AI 关键词 | `dynamic running pose, speed lines radiating, full body action, jacket flying, desperate sprint` |

### 第 8 格｜外部力量介入·空间压迫

| 参数 | 金标准值 |
|------|---------|
| 景别 | 中景至全景（MS/FS） |
| 推荐焦距 | 24mm 小广角 |
| 构图 | 强光源直射镜头（车灯/探照灯/手电筒），两侧墙壁挤压空间 |
| 人物 | 主角可不在画面内，通过上下文推断位置 |
| 光影 | 强光穿透+高光点（警灯/探照灯），潮湿路面反射 |
| 景深 | 大景深 |
| 叙事功能 | 引入外部力量，将个人危机升级为系统性追捕/对抗 |
| AI 关键词 | `approaching headlights, confined space, police car or searchlight, wet pavement reflection, closing in` |

### 第 9 格｜静止定格·开放式结局

| 参数 | 金标准值 |
|------|---------|
| 景别 | 全景至中景（FS/MS） |
| 推荐焦距 | 50mm 标准镜头 |
| 构图 | 垂直狭长光束/门缝光/窗口光，主角立于其中，四周漆黑，对称构图 |
| 人物 | 直立不动，双手自然垂落，表情平静甚至冷漠 |
| 光影 | 极简主义，强烈明暗对比，舞台剧式打光 |
| 景深 | 中景深 |
| 叙事功能 | 戏剧性收尾，可能是逃脱/自首/对决/新阶段，留给观众解读空间 |
| 象征意义 | 「光明 vs 黑暗」「选择 vs 命运」 |
| AI 关键词 | `static freeze frame, narrow beam of light, symmetrical composition, dramatic chiaroscuro, open ending, cinematic` |

---

## 三、全局美术标准（9 格统一）

### 3.1 视觉风格锁定

| 标准 | 要求 |
|------|------|
| 色彩 | **纯黑白单色阶**，0 饱和度，灰阶层次丰富 |
| 对比度 | 电影级高对比，明暗过渡自然 |
| 线条 | 闭合干净漫画线稿，主次线条分明，无飞线乱线 |
| 人体 | 结构百分百正确，无畸形、无崩坏、无扭曲 |
| 画质 | 超高清 8K，锐利边缘，干净画面，无噪点 |
| 渲染 | UE5 次世代写实质感（Nanite+Lumen），黑白漫改风格 |

### 3.2 雨景/夜景表现技法

| 元素 | 表现方法 |
|------|---------|
| 雨丝 | 斜线排线，方向统一（左倾或右倾），密度随情绪递增 |
| 地面反光 | 湿滑路面柔和镜面反射，倒映建筑轮廓与光源 |
| 路灯光晕 | 柔和 bloom，不爆炸炫光 |
| 水洼 | 镜面反射+涟漪纹理，可用作伏笔（倒影暗示） |
| 氛围 | 灰阶过渡丰富，远景空气透视衰减 |

### 3.3 速度线/动态线技法

| 类型 | 用途 | 画法 |
|------|------|------|
| 放射状集中线 | 奔跑/冲刺/爆发 | 从画面中心向四周放射，线条由密到疏 |
| 平行速度线 | 横向移动/追逐 | 水平平行线，间距递减 |
| 弧形速度线 | 旋转/投掷/弧形运动 | 弧线跟随运动轨迹 |
| 冲击线 | 打击/碰撞瞬间 | 短促放射线从撞击点发出 |

---

## 四、9 格 AI 生成 Prompt 框架

### 4.1 整体框架 Prompt

```
manga panel grid 3x3, black and white, [主题场景描述],
cinematic composition, dramatic chiaroscuro, UE5 photorealistic 3D manhua,
consistent character design throughout all 9 panels,
narrative arc: establishing → introduction → foreshadowing → turning point →
climax → preparation → action → escalation → resolution
```

### 4.2 逐格 Prompt 模板

每格 prompt 结构：`[统一前缀] + [格位构图描述] + [人物状态] + [光影氛围] + [特殊效果]`

| 格位 | Prompt 骨架 |
|------|------------|
| 1 | `[前缀], wide establishing shot, deep perspective alley, silhouette figure walking away, single street lamp glow, wet pavement reflection, rain streaks, oppressive atmosphere` |
| 2 | `[前缀], medium close-up side profile 45 degrees, character looking at phone, hair slightly messy, collar raised, half face lit half in shadow` |
| 3 | `[前缀], extreme close-up low angle, feet standing in puddle, reflection in water, leather shoes wet, atmospheric mystery` |
| 4 | `[前缀], over-the-shoulder shot, character turning back looking over shoulder, tense body language, rain intensifying, background darkening` |
| 5 | `[前缀], center composition, full black silhouette threat figure, confrontational stance, dense rain lines background, negative space vs positive space, horror valley effect` |
| 6 | `[前缀], extreme close-up, hand gripping umbrella handle tightly, white knuckles, fabric sleeve texture visible, determination` |
| 7 | `[前缀], dynamic running pose full body, radiating speed lines, desperate sprint, jacket flying, teeth gritted, frontal tracking shot` |
| 8 | `[前缀], approaching headlights, confined narrow space, police car lights, wet pavement strong reflection, closing in, no character visible` |
| 9 | `[前缀], static freeze frame, narrow vertical beam of light from door crack, character standing still in light, surrounded by darkness, symmetrical composition, dramatic chiaroscuro, open ending` |

---

## 五、9 格叙事变体模板

### 5.1 悬疑惊悚型（金标准）

```
1.远景定场 → 2.人物入场 → 3.细节伏笔 → 4.警觉转折 → 5.威胁符号 →
6.防御准备 → 7.奔跑逃亡 → 8.追捕升级 → 9.静止定格
```

### 5.2 情感爆发型

```
1.远景定场 → 2.人物入场 → 3.道具特写（信物/照片） → 4.回忆触发 →
5.情绪爆发（泪水/呐喊） → 6.手握道具特写 → 7.奔跑/追寻 →
8.重逢/对峙 → 9.拥抱/分离定格
```

### 5.3 战斗对决型

```
1.远景定场（战场/擂台） → 2.主角入场 → 3.武器/拳头特写 → 4.对手亮相 →
5.对峙凝视 → 6.蓄力特写 → 7.交锋爆发（速度线） →
8.绝招释放 → 9.胜负定格
```

### 5.4 都市日常型

```
1.远景定场（城市/街道） → 2.人物入场 → 3.手机/咖啡特写 → 4.偶遇/转折 →
5.对话高潮 → 6.表情反应特写 → 7.同行/分离 →
8.环境变化（天气/时间） → 9.回望/前行定格
```

---

## 六、与镜头焦距库的协同

| 格位 | 叙事功能 | 焦距库推荐 | 景深规则 |
|------|---------|-----------|---------|
| 1 | 远景定场 | 20mm 超广角 | 大景深 |
| 2 | 人物入场 | 28mm 小广角 | 大景深 |
| 3 | 细节伏笔 | 100mm 微距长焦 | 浅景深 |
| 4 | 转折触发 | 35mm 人文标准 | 中景深 |
| 5 | 中心高潮 | 35mm 标准镜 | 中景深 |
| 6 | 准备动作 | 85mm 人像长焦 | 浅景深 |
| 7 | 动态爆发 | 32mm 微广角 | 大景深 |
| 8 | 外部介入 | 24mm 小广角 | 大景深 |
| 9 | 静止定格 | 50mm 标准镜 | 中景深 |

**景深递进规则**：广角格（1/2/7/8）强制大景深 → 标准格（4/5/9）中景深 → 长焦格（3/6）强制浅景深。景深变化本身构成节奏呼吸。

---

## 七、与 15 秒生产流程库的协同

本模板库为㉑库（production-pipeline-15s.md）第三阶段「9 格 UE5 次世代黑白分镜故事板生成」的**视觉金标准**：

- ㉑库定义五阶流程与质检规则
- 本库定义 9 格画面的**具体构图、镜头参数、情绪曲线、AI prompt 框架**
- 生成 9 格分镜时，先按本库选定叙事变体模板 → 套用逐格参数 → 填入具体剧情内容 → 输出 AI prompt

---

## 八、自检规则（9 格专项）

- [ ] 9 格是否遵循「起→承→转→合」四段叙事弧？
- [ ] 第 1 格是否为远景定场（环境铺垫）？
- [ ] 第 3 格是否包含细节伏笔（特写镜头）？
- [ ] 第 5 格是否为全段视觉冲击力最强的中心高潮？
- [ ] 第 7 格是否使用速度线/动态线表现爆发力？
- [ ] 第 9 格是否为静止定格+开放式结局？
- [ ] 情绪曲线是否由静到动再到静？
- [ ] 每格焦距是否符合镜头焦距库推荐值？
- [ ] 景深是否遵循「广角大景深/长焦浅景深」规则？
- [ ] 人物造型是否全 9 格统一（零人设漂移）？
- [ ] 光影风格是否全 9 格统一（零光影跳变）？
- [ ] 线条风格是否全 9 格统一（零画风偏移）？
