# DirectorPlus 5.0 渲染层 · 视觉模块（新增件）

> **落位说明**（并入影视剧作工坊时添加，正文保留原文）
> 来源：导演plus 1999 / DirectorPlus 5.0.0（修复版）· 渲染层与影视视觉风格融合系统　原文文件名：`导演plus-5.0.0-渲染层-视觉模块.txt`
> **重复性处理**：以下内容已在现有包内，**不再收录**：
> - ~~## 禁止反向污染（重合 64%）~~
> - ~~## 约束（重合 64%）~~
> - ~~## 轴（重合 100%）~~
> - ~~## 兼容原则（重合 100%）~~
> - ~~## 典型组合（重合 87%）~~
> - ~~## 定位（重合 92%）~~
> - ~~## 运行时位置（重合 91%）~~
> - ~~# DirectorPlus 5.0 — 影视视觉风格融合规则（重合 80%）~~
> - ~~## 1. 完整保留（重合 100%）~~
> - ~~## 2. 风格不是单个标签（重合 100%）~~
> - ~~## 3. 五轴融合（重合 100%）~~
> - ~~## 4. 风格剂量（重合 100%）~~
> - ~~## 5. 风格冲突（重合 100%）~~
> - ~~## 6. 视频优先增加动态（重合 100%）~~
> - ~~## 7. 负面约束（重合 100%）~~
> - ~~## 8. 参数化与不丢真相（重合 100%）~~
> - ~~## 9. 统一 IR 映射（重合 100%）~~
> - ~~## 10. 最终输出（重合 80%）~~
> - ~~## 0. 本文件的性质（重合 71%）~~
> - ~~## 1. 总体融合方式（重合 100%）~~
> - ~~## 2. 章节 1：总原则 / 通用提示词骨架（重合 100%）~~
> - ~~## 3. 章节 2：六维视觉 DNA（重合 100%）~~
> - ~~## 4. 章节 3：构图轴（重合 100%）~~
> - ~~## 5. 章节 4：光影系统（重合 100%）~~
> - ~~## 6. 章节 5：色彩系统（重合 100%）~~
> - ~~## 7. 章节 6：影像质感（重合 100%）~~
> - ~~## 8. 章节 7：15 位导演 / 摄影视觉 DNA（重合 100%）~~
> - ~~## 9. 章节 8：15 种通用影视视觉风格（重合 100%）~~
> - ~~## 10. 章节 9：AIGC 电影风格合集 DNA（重合 100%）~~
> - ~~## 11. 章节 10：风格融合引擎（重合 100%）~~
> - ~~## 12. 章节 11：图片 → 视频转换（重合 100%）~~
> - ~~## 14. 章节 13：负面提示词 / 质量约束（重合 100%）~~
> - ~~## 15. 章节 14：技能执行规则（重合 100%）~~
> - ~~## 16. 章节 15：最终技能调用接口（重合 100%）~~
> - ~~## 17. 章节 16：最终生成公式（重合 100%）~~
> - ~~## 19. 关键新增模块（重合 100%）~~
> - ~~## 20. 与现有 DirectorPlus 的关系（重合 100%）~~
> - ~~## 23. 本模块融合后的实际价值（重合 70%）~~
> - ~~## 1.1 通用提示词骨架（重合 60%）~~
> - ~~## 4.3 戏剧化人工光（重合 100%）~~
> - ~~### 运动质感（重合 61%）~~
> - ~~# 7. 15 位导演 / 摄影视觉 DNA（重合 89%）~~
> - ~~# 8. 15 种通用影视视觉风格 DNA（重合 96%）~~
> - ~~# 10. 风格融合引擎（重合 100%）~~
> - ~~## 13.2 风格冲突约束（重合 100%）~~
> - ~~## Rule 05：图片和视频分别优化（重合 97%）~~
> - ~~# 17. 来源中的关键使用原则（重合 99%）~~
> 原文分节 129 节；收录 82 节，剔除重复 47 节。

---

(开头)
========================================================================
导演plus 1999 / DirectorPlus 5.0.0（修复版）
渲染层 · 视觉模块（Visual / Render Intelligence）完整提取
========================================================================

来源压缩包：导演plus-5.0.0-修复版.zip（解压自 C:\Users\zxzac\Desktop\导演plus-5.0.0-修复版.zip）
提取日期：2026-09-27

【收录范围】技能包标准链路中的 Visual/Render Intelligence 渲染层与影视视觉风格融合系统，
即当前 5.0 运行路径下的全部视觉/渲染资产：渲染智能层（RENDER）、视觉意图本体与风格组合
矩阵（VISUAL）、视觉渲染融合规则（FUSED_CORE/rules/05）、影视视觉风格融合模块
（VISUAL_STYLE_FUSION：说明 / 规则 / 熔炼映射 / 872 行原文 / 结构化注册表 / 引擎代码）。
所有文件内容均按原始文件逐字保留，未做摘要或删改，仅按原始路径分节排列。

【未收录说明】
  · ARCHIVE/HISTORICAL_4X/ 下的历史 4.x 视觉资产（已归档，不参与 5.0 运行路径）
  · AI_ART_FUSION/ 下的 AI 电影美术素材库（独立子系统，非渲染层本体）
  · TESTS/VISUAL_STYLE_FUSION_REGRESSION_5_0.py（回归测试脚本，非模块内容）

【目录】
  [01] RENDER/RENDER_INTELLIGENCE.md  （31 行 / 758 字节）
  [02] VISUAL/RENDER_INTELLIGENCE_ROUTING.md  （22 行 / 1059 字节）
  [03] VISUAL/VISUAL_INTENT_ONTOLOGY.md  （53 行 / 1641 字节）
  [04] VISUAL/STYLE_COMPOSITION_MATRIX_5_0.md  （28 行 / 1364 字节）
  [05] FUSED_CORE/rules/05_VISUAL_RENDER.md  （22 行 / 1018 字节）
  [06] VISUAL_STYLE_FUSION/README.md  （42 行 / 1005 字节）
  [07] VISUAL_STYLE_FUSION/RULES/VISUAL_STYLE_FUSION_RULES_5.0.md  （36 行 / 2268 字节）
  [08] VISUAL_STYLE_FUSION/INTEGRATION/影视视觉风格模块_完整熔炼映射.md  （355 行 / 9836 字节）
  [09] VISUAL_STYLE_FUSION/SOURCE/影视视觉风格精华熔炼模块_原文.md  （870 行 / 19122 字节）
  [10] VISUAL_STYLE_FUSION/REGISTRY/VISUAL_DNA_REGISTRY.json  （86 行 / 9227 字节）
  [11] VISUAL_STYLE_FUSION/ENGINE/visual_style_dna_engine.py  （99 行 / 4098 字节）
------------------------------------------------------------------------
[01] 文件路径：RENDER/RENDER_INTELLIGENCE.md
------------------------------------------------------------------------

# Render Intelligence Layer
渲染不是视觉风格本身，也不是单纯选择 Arnold/UE5。

Visual Intent → Render Intelligence → Renderer / Model Execution

## Render Intelligence 内容
- Render Style
- Render Quality
- Material Response
- Lighting Response
- Shadow
- Reflection
- Refraction
- Volume
- Exposure
- Depth of Field
- Motion Blur
- Lens Characteristics
- Photorealism QC
- Renderer Selection
- Renderer Translation

## 后端
- Arnold：电影级离线/英雄镜头高真实度后端
- UE5：实时高质量虚拟制作/复杂环境/预演后端
- 其他后端可扩展

## 硬规则
渲染器不能反向改变人工视觉目标。
技术参数留在内部 Render Manifest；模型交付层经 D-CG 转成可观察视觉结果。

------------------------------------------------------------------------
[02] 文件路径：VISUAL/RENDER_INTELLIGENCE_ROUTING.md
------------------------------------------------------------------------

# Render Intelligence Routing 1.0
固定链：
Visual Intent → Render Intelligence → Renderer/Model Execution → D-CG

## Render Intelligence 内部能力（全部保留）
Render Style / Render Quality / Material Response / Lighting Response / Shadow / Reflection / Refraction / Volume / Exposure / Depth of Field / Motion Blur / Lens Characteristics / Photorealism QC / Renderer Selection / Renderer Translation

## 处理顺序
1. 读取 Human Visual Lock。
2. 解析 Visual Production Style。
3. 解析 Realism Level。
4. 解析 Render Strategy。
5. 解析 Renderer（若用户指定）。
6. 生成 SHOT_RENDER_PROFILE。
7. 调用历史视觉、电影摄影、AI Film Art、Workbench、Higgsfield 能力。
8. 通过 D-CG 转换为模型可执行的可观察结果语言。
9. ST / Engine 11 验证。

# Visual Intent Ontology 1.0
视觉意图拆成三个正交维度，避免“风格、写实程度、渲染器”混为一谈。

## A. Visual Production Style
描述视觉生产体系/美术范式，例如：
- 写实3D
- 次世代
- 电影CG
- 二次元3D
- 风格化3D
- 其他项目自定义风格

## B. Realism Level
描述现实感强度，而不是资产生产范式：
- 风格化
- 半写实
- 写实
- 超写实

## C. Render Strategy
描述最终视觉计算策略：
- 实时
- 高质量实时
- 电影级离线
- 混合/特殊策略

## D. Renderer
是执行后端，不属于上述三个视觉维度：
- Arnold
- UE5
- 其他可用渲染器/模型后端

## 组合解析
“次世代”
→ Visual Production Style=次世代；Realism Level 不自动指定；Renderer 不自动指定。

“超写实3D”
→ Visual Production Style=写实3D；Realism Level=超写实；Renderer 不自动指定。

“次世代超写实3D”
→ Visual Production Style=次世代；Realism Level=超写实；Renderer 不自动指定。

“次世代超写实3D，Arnold”
→ Visual Production Style=次世代；Realism Level=超写实；Render Strategy=电影级离线高保真倾向；Renderer=Arnold。

“次世代，UE5”
→ Visual Production Style=次世代；Renderer=UE5；Realism Level 保持未指定，除非用户另行指定。

# 导演plus 1999 · Style Composition Matrix 5.0


# 05 Visual / Render Intelligence Fusion
来源融合：Visual Style Engine、NextGen Style Engine、Render Engine、Arnold、UE5、Visual Control、Photorealism QC。

## Visual hierarchy
Visual Production Style / Realism Level / Render Strategy / Renderer 四层独立。

写实3D ≠ 超写实3D；次世代 ≠ 自动超写实；超写实3D ≠ 自动 Arnold。

## Human lock
HARD HUMAN LOCK > SCENE LOCK > SHOT OVERRIDE > DIRECTOR DECISION > MODEL DEFAULT。

## Render Intelligence
负责将视觉意图转换为材质响应、光照响应、阴影、反射、折射、体积、曝光、景深、运动模糊、镜头特性与 QC 条件；Renderer 只是后端策略。

## Arnold / UE5
Arnold：离线电影级/hero/高质量物理渲染路径。
UE5：实时预演/复杂环境/虚拟制片/实时高质量路径。
两者均不能改变上游视觉意图。

## QC
皮肤塑料感、眼睛、微纹理、光影、阴影、反射、曝光、景深、运动模糊、边缘、镜头感、CG感逐项检查。

------------------------------------------------------------------------
[06] 文件路径：VISUAL_STYLE_FUSION/README.md
------------------------------------------------------------------------

# DirectorPlus 5.0 — 影视视觉风格融合模块


## 保全原则
原 872 行来源文本完整保留，不以摘要替代。

结构化数据是“可调用副本”，不是原文的替代品。

## 能力
- 六维视觉 DNA
- 构图控制轴
- 光影系统
- 色彩系统
- 影像质感系统
- 15 位导演/摄影视觉 DNA
- 15 种通用影视视觉风格
- 五轴风格融合
- 风格冲突检测
- 图片→视频动态桥
- 风格反向约束
- 视觉风格调用接口

# DirectorPlus 5.0｜影视视觉风格模块完整熔炼映射


## 13. 章节 12：风格调用模板
三个模板转为“编译规则”而不是固定句子：
- 导演视觉 DNA
- 类型风格
- 融合风格

禁止机械复制模板句式。

## 18. 章节 17：使用原则
进入运行时质量策略：
- 模型差异
- 图片/视频差异
- 镜头/胶片/光影作为强化层
- 不承诺 100% 复刻
- 多轮调试与负面约束

## 21. 最终视觉数据链
用户视觉需求
→ 风格识别
→ Visual DNA
→ 视觉六维参数
→ 电影语言
→ 风格组合
→ 冲突检测
→ Shot Visual Plan
→ Generation Visual Plan
→ D-CG
→ Prompt Compiler
→ Validation
→ 最终视频生成提示词

## 22. 内容保全验收
必须同时满足：
- 源模块 872 行完整保留
- 源模块原文件进入 DirectorPlus 5.0 Source Knowledge 区
- 每个章节均有 CAPABILITY_ID
- 每个能力均有新归属
- 每个能力均有 IR 映射
- 每个能力均有 Runtime/Registry/测试状态
- 没有任何旧能力因本次融合被删除
- 原 DirectorPlus 视觉能力不得因融合而被替换

# 影视视觉风格精华熔炼模块


## ——面向 AI 影视 / 短剧提示词技能的可调用视觉知识文档
> **来源范围**：本模块仅对用户提供的《AIGC电影风格提示词合集（196页）》《15种影视视觉风格 AI 提示词模板》《15位电影导演调色风格 AI 提示词模板》《电影风格核心要点》《使用注意与技巧》进行归纳、去重、结构化和压缩。
>
> **定位**：不是“导演名字词库”，而是一套可以被影视提示词技能调用的 **视觉语言模块**。核心任务是把“某种电影风格”拆成可组合、可控制、可迭代的视觉参数。

---

# 1. 总原则：先建立视觉语法，再调用风格
源材料反复强调：完整影视提示词不能只写“某导演风格”，而应同时处理镜头、主体、风格、光影、色彩、质感、情绪和画幅。

# 2. 六维视觉 DNA —— 技能调用的核心接口
《AIGC电影风格提示词合集》把电影风格拆成六个维度，这套拆法应作为技能内部的基础数据结构：

| 维度 | 控制内容 |
|---|---|
| 构图与镜头 | 景别、焦段、机位、角度、镜头运动、景深、构图秩序 |
| 色彩与光影 | 主色、辅色、冷暖、曝光、反差、高光、阴影、光源 |
| 质感与氛围 | 胶片、颗粒、柔焦、漏光、雾、水汽、粗粝、洁净、真实感 |
| 经典场景 | 能承载该风格的空间、时代、道具、环境 |
| 角色与动作 | 人物状态、姿态、互动方式、运动方式、表演强度 |
| 色调细节 | 饱和度、明度、黑位、肤色、局部色彩、色彩数量 |

**技能调用原则：**
- 不要只调用“风格名称”。
- 至少从六维中选择 3–5 个真正决定画面的参数。
- 如果用户指定导演风格，优先提取其“视觉 DNA”，而不是堆叠导演姓名。
- 如果用户指定的是类型风格，则以“类型视觉模块 + 场景需求”生成，而不是机械套导演模板。

---

# 3. 视觉控制轴：把风格变成可调参数


## 3.1 构图轴
常用控制项：

- 极简构图 / 大量留白
- 对称构图
- 失衡构图
- 倾斜构图
- 前景遮挡
- 框中框
- 中央构图
- 对角线构图
- 低角度 / 极低角度
- 高角度 / 俯拍
- 广角空间压迫
- 长焦压缩
- 浅景深 / 深景深
- 主体孤立 / 群像
- 大尺度环境 + 微小人物

### 选择逻辑
- **孤独 / 禅意** → 大留白、远景、主体缩小。
- **紧张 / 失控** → 倾斜、失衡、近距离、前景遮挡。
- **绘本 / 秩序** → 对称、平面化、明确几何关系。
- **宏大 / 史诗** → 超宽画幅、广角或空间展开、大环境比例。
- **亲密 / 情绪特写** → 近景、浅景深、局部遮挡。

---

# 4. 光影系统


## 4.1 柔和自然系
核心词：

```text
soft diffused light
natural light
warm golden hour
gentle backlight
soft side light
dappled sunlight
dreamy glow
```

适合：
- 青春
- 爱情
- 日系治愈
- 田园
- 回忆
- 生活流

## 4.2 冷峻压迫系
核心词：

```text
deep shadows
hard side light
rear rim light
chiaroscuro
low-key lighting
cold ambient light
muted highlights
```

适合：
- 悬疑
- 犯罪
- 疏离
- 都市颓败
- 黑暗文艺

# 5. 色彩系统
不要把“调色”理解成简单的颜色滤镜。源材料显示，真正有用的是：

```text
主色
+
辅色
+
冷暖关系
+
饱和度
+
明度
+
黑位
+
高光颜色
+
局部强调色
```

## 5.1 少色多阶
代表逻辑：
- 减少颜色数量。
- 用明度和纹理制造层次。
- 整体降低饱和度。
- 让单色系内部产生丰富层次。

适合宏大、沉重、荒凉、科幻、历史质感。

## 5.2 高饱和符号色
代表逻辑：
- 红、黄、蓝、绿等强色作为视觉符号。
- 让颜色承担情绪或叙事功能。
- 不追求“自然校色”。

适合戏剧化、类型化、舞台感、强烈东方视觉。

## 5.3 冷暖对冲
典型组合：

```text
冷蓝 / 青绿背景
+
暖黄 / 橙色局部光源
```

用于建立：
- 人与环境的距离
- 危险感
- 温柔与疏离
- 城市夜景
- 怀旧与现实的冲突

## 5.4 低饱和生活流
典型组合：

```text
暖灰
+
米白
+
低饱和绿 / 蓝
+
自然肤色
```

适合日常、家庭、治愈、纪实、生活电影。

---

# 6. 影像质感模块
源材料中反复出现的有效质感组件：

### 胶片
```text
35mm film grain
vintage film grain
fine film grain
heavy film grain
gritty film texture
```

### 光学
```text
soft focus
lens flare
anamorphic flare
bokeh
bloom
halation
```

### 工艺 / 老影像
```text
bleach bypass
pushed processing
film-out texture
light leaks
edge vignetting
```

### 环境质感
```text
fog
mist
smoke
steam
rain reflections
wet surfaces
dust particles
volumetric light
```

# 9. AIGC电影风格合集的“风格 DNA 库”
源合集覆盖大量导演、电影、类型与艺术风格。为了让技能可调用，优先保留“可迁移的视觉规律”，而不是保留大量示例句。

## 9.1 日系青春 / 青春回忆
典型 DNA：
- 清冷蓝、浅绿、暖高光
- 自然光
- 留白
- 青少年日常空间
- 列车、校园、海边、夏季、雨雪
- 动作克制
- 轻颗粒、柔焦
- 固定机位或轻微呼吸感晃动
- 怀旧、孤独、温柔

## 9.2 日系生活 / 治愈
典型 DNA：
- 低饱和暖色
- 原木、米白、抹茶绿
- 柔和侧逆光 / 漫射光
- 固定机位、长镜头
- 日常动作
- 框景、纸门、木格栅
- 安静、松弛、生活气

## 9.3 娄烨式都市颓败
典型 DNA：
- 手持晃动
- 失衡构图
- 近距离 / 挤压式取景
- 浅景深、虚焦
- 裸露灯泡、路灯、弱天光
- 灰蓝、浊绿、暗青
- 潮湿、水汽、粗颗粒
- 都市边缘、旧厂房、昏暗室内
- 疏离、漂泊、压抑

## 9.4 王家卫 / 杜可风港风
典型 DNA：
- 霓虹
- 绿色、蓝色、红色局部冲突
- 运动拖影
- 低速快门感
- 湿热、水雾、反射
- 柔焦与颗粒
- 倾斜 / 低角度跟拍
- 城市疏离与暧昧

## 9.5 徐克 / 港式武侠
典型 DNA：
- 超广角
- 极低角度
- 倾斜失衡
- 前景遮挡
- 动态模糊
- 逆光高光溢出
- 沙尘 / 烟雾 / 雨雾
- 粗颗粒
- 剑光、衣摆、快速动作
- 肃杀、危险、江湖感

## 9.6 李安 / 东方诗意武侠
典型 DNA：
- 自然环境框景
- 绿色植物遮挡
- 柔和自然光
- 浅景深
- 自然肤色
- 低饱和
- 雾、竹林、山水
- 克制、诗意、神秘

## 9.7 中国古典戏剧 / 戏曲电影
典型 DNA：
- 人工化舞台布光
- 红、黑、金等符号色
- 戏剧化服装与妆面
- 正面 / 特写
- 稳定构图
- 强烈明暗关系
- 传统纹样、帷幕、戏台
- 表演性、宿命感、悲剧感

## 9.8 90年代华语胶片
典型 DNA：
- 暖黄、暗红、旧绿
- 生活空间
- 老居民区、婚礼厅、厨房、街道
- 胶片颗粒
- 自然 / 室内暖光
- 慢推、慢拉
- 日常人物状态
- 怀旧、生活感

## 9.9 英伦 / 欧洲田园古典
典型 DNA：
- 暖黄、自然绿、米白
- 黄金时刻
- 花园、森林、草地、湖泊、木屋
- 柔光、散景、逆光
- 复古胶片
- 长裙、草帽、花环等时代 / 田园服饰
- 浪漫、诗意、温柔

## 9.10 巨物 / 宏大尺度
典型 DNA：
- 巨大主体
- 微小人物
- 大量负空间
- 宽银幕
- 强光束、尘埃、雾
- 中央构图或建筑几何
- 强烈比例关系
- 宏伟、神圣、压迫

## 9.11 超现实 / 魔幻现实
典型 DNA：
- 不可能的空间关系
- 双重曝光
- 剪影与景观融合
- 象征性道具
- 超现实色彩
- 油画 / 绘画纹理
- 梦境逻辑
- 诗意、隐喻、奇幻

## 9.12 纪实 / 真实摄影
典型 DNA：
- 手持
- 自然光
- 真实肤色
- 深景深
- 环境声音感 / 生活动作感
- 不刻意美化
- 真实、粗粝、即时

---

## 10.1 五轴融合
```text
A：构图语言
B：光影语言
C：色彩语言
D：质感语言
E：动作 / 运镜语言
```

例如：

```text
构图：东方武侠
+
光影：自然诗意
+
色彩：冷青 + 暖金
+
质感：35mm细颗粒
+
运镜：缓慢推近
```

这样形成的是“视觉系统”，而不是名字堆叠。

## 10.2 冲突检测
出现以下冲突时，应自动减权：

- 平面柔光 ↔ 极端硬光
- 极低饱和 ↔ 极高饱和
- 静态固定机位 ↔ 强烈高速运动
- 极致对称 ↔ 强烈失衡
- 真实自然光 ↔ 高度人工舞台光
- 极简留白 ↔ 元素密集
- 细腻洁净 ↔ 粗粝重颗粒

除非用户明确要求混合冲突，否则选择一个主导系统，其他系统只作为局部点缀。

---

# 11. 图片 → 视频转换模块
源材料提供了非常稳定的视频提示词结构：

```text
[运镜]
+
[风格标签]
+
[场景]
+
[主体动作]
+
[光效]
+
[色调]
+
[胶片颗粒 / 柔焦等质感]
+
[情绪]
```

## 11.1 基础运镜词
```text
缓慢推近
缓慢拉远
横向移动
跟拍
低角度跟拍
固定机位
轻微推拉变焦
缓慢小幅推近
轻微呼吸感晃动
```

## 11.2 视频动作原则
不要只写：

> “人物走路，镜头推进。”

应写清：

```text
人物动作
+
镜头动作
+
环境动态
+
需要捕捉的细节
+
最终情绪
```

例如：

```text
镜头缓慢推近，人物保持克制表情，
发丝被微风轻轻吹动，背景树叶产生细微晃动，
捕捉眼神与面部高光变化，传递安静而压抑的情绪。
```

---

# 12. 风格调用模板


## 模板 A：导演视觉 DNA
```text
[主体/场景]
+
[导演视觉 DNA]
+
[构图]
+
[光影]
+
[色彩]
+
[质感]
+
[情绪]
+
[镜头 / 运镜]
```

## 模板 B：类型风格
```text
[主体/场景]
+
[类型风格]
+
[类型构图]
+
[类型光影]
+
[类型色彩]
+
[类型质感]
+
[环境氛围]
+
[运镜]
```

## 模板 C：融合风格
```text
主风格：________
构图来源：________
光影来源：________
色彩来源：________
质感来源：________
运镜来源：________

冲突检测：
- 色彩是否冲突？
- 光影是否冲突？
- 构图是否冲突？
- 动态强度是否冲突？
- 质感是否过量？
```

---

# 13. 负面提示词 / 质量约束
源材料建议搭配负面提示词并进行多次调试。该模块不规定固定负面词，而建议根据目标风格建立“反向约束”。

## 13.1 通用反向约束
```text
unwanted text
watermark
logo
random typography
overprocessed skin
plastic skin
excessive sharpening
oversaturated colors
inconsistent lighting
unnatural anatomy
uncontrolled motion blur
excessive depth of field
generic stock-photo look
```

# 14. 技能执行规则


## Rule 01：风格先拆解，后生成
输入“做成某某电影感”时，先把它解析成：
- 构图
- 光影
- 色彩
- 质感
- 场景
- 动作
- 情绪

## Rule 02：风格名不是最终提示词
导演 / 电影名只负责“风格锚定”，真正生成依赖视觉属性。

## Rule 03：优先少量高权重特征
每次优先选择 3–7 个决定性视觉特征，而不是把所有词库全部塞入。

## Rule 04：镜头参数是辅助层
摄影机、胶片、滤镜、焦段、光圈等可以作为风格参考与强化层；不能替代主体、构图、光影和色彩描述。

## Rule 06：允许迭代
生成效果不理想时：
1. 换模型；
2. 删除无效词；
3. 修改镜头参数；
4. 强化主色 / 光影；
5. 增加负面约束；
6. 多轮测试。

## Rule 07：不要承诺“100%复刻”
源材料明确指出，提示词只是风格引导，模型性能与生成参数会影响结果，因此技能应输出“视觉 DNA / 风格方向”，而不是承诺完整复刻原片。

---

# 15. 最终技能调用接口
当其他影视技能需要视觉风格时，可以调用以下字段：

```yaml
visual_style:
  anchor: ""
  composition:
    framing: ""
    camera_angle: ""
    focal_length: ""
    depth_of_field: ""
    spatial_structure: ""
  lighting:
    source: ""
    direction: ""
    hardness: ""
    contrast: ""
    highlight_behavior: ""
    shadow_behavior: ""
  color:
    dominant: ""
    secondary: ""
    temperature: ""
    saturation: ""
    luminance: ""
    skin_tone: ""
  texture:
    film_stock_feel: ""
    grain: ""
    diffusion: ""
    flare: ""
    atmosphere: ""
    motion_texture: ""
  environment:
    setting: ""
    period: ""
    props: ""
  performance:
    posture: ""
    movement: ""
    interaction: ""
    emotional_state: ""
  cinematography:
    shot_size: ""
    camera_motion: ""
    aspect_ratio: ""
  negative_constraints:
    - ""
```

---

# 16. 一条可直接用于技能的最终生成公式
```text
主体与场景
→ 叙事 / 情绪目标
→ 风格锚定
→ 构图与景别
→ 光影
→ 色彩
→ 质感
→ 环境细节
→ 人物动作
→ 运镜
→ 画幅
→ 负面约束
→ 输出
→ 评估
→ 迭代
```

**核心思想：**

> 风格不是一串形容词，而是一组相互关联的视觉决策。

真正应该熔炼进影视提示词技能的，不是大量可以复制的句子，而是：

```text
风格识别
+
视觉 DNA 拆解
+
参数化控制
+
模块组合
+
冲突检测
+
图片 / 视频分流
+
负面约束
+
迭代优化
```

---
