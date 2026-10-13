# 导演plus 5.0.0 — 负面提示词（Negative Prompts）全量提取

> **落位说明**（并入影视剧作工坊时添加，正文保留原文）
> 来源：导演plus 5.0.0 · 负面提示词全量提取
> 原文文件名：`导演plus5.0_负面提示词全量提取.txt`
> 链路归位：见第四批提取索引 `INDEX.md`（镜头→光影→物理→分镜连续→提示词→声音BGM→连续性）

> 来源：`导演plus-5.0.0-修复版.zip`（插件 `director-plus-1999` 5.0.0）。
> 解压镜像：`C:\Users\zxzac\.zcode\workspace\default\_dp_extract\director-plus-1999\`。
> 各条目均标注原始出处文件。zip 内中文文件名有编码乱码，但文件内容本身为正常 UTF-8。

---

## 一、核心词表（总表）

**出处**：`AI_ART_FUSION/ai-film-art-v5.2-source/references/negative-prompts.md`

> 用途：拼装【负面词 not】段。**每通道专属负面词 + 通用负面词**合并去重使用。

### 1.1 通用负面词（所有通道必带）

```text
多余手指, 缺失手指, 多指, 少指, 畸形, 肢体扭曲, 比例错误,
面部崩坏, 五官错位, 眼睛不对称, 斗鸡眼, 死鱼眼, 眼神空洞,
牙齿畸形, 多颗牙, 缺牙, 穿模, 物体穿插,
模糊, 低分辨率, 噪点, 压缩 artifacts, 水印, 文字, 签名,
丑陋, 低质量, 画质感, 3D渲染伪影
```

### 1.2 分通道专属负面词

**A. 真人通道**
```text
卡通, 动漫, 插画, 3D渲染, CG感, 塑料皮肤, 蜡像感,
过度磨皮, 假面感, 二次元, 大眼萌系, 手绘, 恐怖谷
```

**B1. 超写实 3D**
```text
卡通, 动漫, 二次元, Q版, 大眼萌系, 赛璐璐, 描边, 手绘, 插画,
塑料皮肤, 蜡像感, 过度光滑, 假面, 恐怖谷, 眼睛空洞, 死鱼眼,
低模, 贴图糊, 真人照片感, 过度磨皮, 皮肤无毛孔, 塑料假发感
```

**B2. 次世代**
```text
低多边形, 低模, 手绘, 二次元平涂, 赛璐璐, Q版, 大头娃娃,
塑料材质, 蜡像皮肤, 贴图模糊, 卡通渲染, 描边线,
真人照片感, 真人实拍
```

**B3. Arnold**
```text
卡通, 动漫, 手绘, 赛璐璐, Q版, 低模,
噪点, 颗粒感重, 画面脏, 塑料皮肤, 蜡像感, 无透光感,
硬阴影, 平光, 贴图糊, 真人照片感, 游戏实时感
```

**B4. 国漫风（重点防 2D 化）**
```text
2D动画, 赛璐璐, 描边, 手绘, 水彩, 厚涂, 二次元, 大眼萌系,
Q版, chibi, 大头娃娃, 卡通渲染, 平涂色块,
塑料皮肤, 蜡像感, 低模, 贴图糊, 真人照片感, 恐怖谷, 画面噪点
```

**B5. UE5**
```text
卡通, 动漫, 手绘, 赛璐璐, Q版, 低模, 像素感,
画面噪点, 灯光不真实, 暗部死黑, 平光无层次,
塑料皮肤, 蜡像感, 贴图糊, 真人照片感, 恐怖谷, 过曝, 色偏
```

### 1.3 场景化补充负面词

| 场景 | 追加负面词 |
|------|-----------|
| 特写/面部 | 面部不对称, 毛孔过大, 皱纹过多, 妆容脏 |
| 全身 | 腿比例错, 头身比错, 手脚畸形, 身体比例失调 |
| 古装 | 现代物品穿帮, 拉链, 手表, 眼镜（除非设定有） |
| 战斗/动态 | 动作僵硬, 肢体穿插, 飘带穿模 |
| 多人 | 人脸混淆, 张冠李戴, 多人共用一张脸 |

### 1.4 拼装规则（negative-prompts.md 原文）

1. **通用负面词必带**（§一）。
2. **叠加对应通道专属负面词**（§二）。
3. **按场景补充**（§三）。
4. **去重**：重复词只留一次。
5. 负面词只进 not 列表，**不进正向描述**。

---

## 二、各风格通道文件的专属负面词（§5 节）

**出处**：`AI_ART_FUSION/ai-film-art-v5.2-source/references/style-*.md`

### style-octane.md — Octane 通道
```text
卡通, 动漫, 手绘, 赛璐璐, Q版, 低模,
噪点, 颗粒感重, 画面脏, 采样不足, 塑料皮肤, 蜡像感, 不透光,
硬阴影, 平光无层次, 贴图糊, 色彩发灰, 色偏, 过曝, 高光过曝,
多手指, 畸形, 真人照片感, 游戏实时感, 烘焙感
```
该文件的"问题急救表"还规定了负面词追加时机：
| 问题 | 处置 |
|------|------|
| 噪点脏 | 负面加"噪点" |
| 皮肤像塑料 | 负面加"塑料皮肤" |
| 色彩发灰 | 负面加"色彩发灰""色偏" |
| 高光过曝 | 负面加"过曝""高光过曝" |

### style-ue5.md — UE5 通道
```text
卡通, 动漫, 手绘, 赛璐璐, Q版, 低模, 像素感,
画面噪点, 灯光不真实, 暗部死黑, 平光无层次,
塑料皮肤, 蜡像感, 贴图糊, 多手指, 畸形,
真人照片感, 恐怖谷, 过曝, 色偏
```

### style-realistic.md — 真人写实通道（必带）
```text
卡通, 动漫, 插画, 3D渲染, CG感, 塑料皮肤, 蜡像感, 过度磨皮, 假面感,
AI塑料脸, 多余手指, 畸形, 比例失调, 大眼萌系, 磨皮过度, 油画感,
手绘, 二次元, 恐怖谷, 失真
```
急救表：磨皮过度 → 负面加"过度磨皮"。

### style-guoman.md — 国漫通道（必带，重点）
```text
2D动画, 赛璐璐, 描边, 手绘, 水彩, 厚涂, 二次元, 大眼萌系,
Q版, chibi, 大头娃娃, 卡通渲染, 平涂色块,
塑料皮肤, 蜡像感, 过度光滑, 低模, 贴图糊,
多手指, 畸形, 真人照片感, 恐怖谷, 画面噪点, 高光过曝
```
> ⚠️ 原文警示：国漫通道**最容易翻车成 2D 动画**。负面词里必须锁死"2D/赛璐璐/描边/手绘/二次元/大眼/Q版"。同时"真人照片感/恐怖谷"也要禁（保留 CG 感）。

### style-arnold.md — Arnold 通道
```text
卡通, 动漫, 手绘, 赛璐璐, Q版, 低模,
噪点, 颗粒感重, 画面脏, 塑料皮肤, 蜡像感, 无透光感,
硬阴影, 平光, 贴图糊, 多手指, 畸形, 真人照片感, 游戏实时感
```

### style-hyperreal.md — 超写实通道
```text
卡通, 动漫, 二次元, Q版, 大眼萌系, 赛璐璐, 描边, 手绘, 插画,
塑料皮肤, 蜡像感, 过度光滑, 假面, 恐怖谷, 眼睛空洞, 死鱼眼,
低模, 贴图糊, 多手指, 畸形, 比例错误, 真人照片感, 过度磨皮,
皮肤无毛孔, 头发成块, 塑料假发感
```
> ⚠️ 原文警示：超写实通道**既要逼真又要避恐怖谷**。负面里必须带"no uncanny valley"，角色五官比例略美化、眼神一定要有光。

### style-nextgen.md — 次世代通道
```text
低多边形, 低模, 手绘, 二次元平涂, 赛璐璐, Q版, 大头娃娃,
塑料材质, 蜡像皮肤, 贴图模糊, 无细节, 卡通渲染, 描边线,
多手指, 畸形, 穿模, 比例错误, 真实照片感, 真人实拍
```

---

## 三、视频端交付层：负面规避词表

**出处**：`LOCKED_CONTRACTS/FINAL_DELIVERY_TRUTH.md`、`DELIVERY/README.md`、`SKILL.md`（根）

- 5.0 版锁死的最终模型可见交付结构为：
  `id + ①渲染规格～⑩BGM + ## 负面规避词表 + ## 逐秒精细化说明`
- 负面规避词表是**全局尾部字段**（多镜头共用一段，不是每镜头一条），在 `DELIVERY/DELIVERY_SCHEMA.json` 中对应必填字段 `negative_constraints`（string 类型）。
- **硬锁规则**：不新增/不删除/不调序字段；负面规避词表与逐秒说明必须存在，缺失即触发自修复补容器（`SELF_REPAIR/REPAIR_POLICY.md`）。

官方 E2E 交付示例（`TESTS/E2E/locked_delivery.md`、`e2e_plan_delivery.md`）中的标准写法：

```text
## 负面规避词表
无卡顿，无画面抖动，无变形，无多手指，无塑料皮肤
```

风格融合规则（`VISUAL_STYLE_FUSION/RULES/VISUAL_STYLE_FUSION_RULES_5.0.md` §7）：
> Negative 按通用、风格、镜头/动作、人物、模型能力等来源组织。**不能把所有 Negative 机械堆入最终提示词。**

---

## 四、即梦（Seedream）平台：负面词三法 ⚠️ **规则归属已迁 12**

> **本条为提取归档。规则归属地已迁至 `12/platform/09-即梦交付拼装规格.md` §三。**
> 本模块（13）**只判合规，不持有拼装规则**——判据见 `review/14` 的 G10。

**出处**：`AI_ART_FUSION/ai-film-art-v5.2-source/references/jimeng-seedream-adaptation.md` §3

即梦没有独立负面词输入框，负面词按以下三法处理，**不单独成段**：

| 方法 | 用法 | 示例 |
|------|------|------|
| **正向融合（首选）** | 把禁止项翻成对应的正向描述，融进段落 | 负面"塑料皮肤" → "皮肤通透有血色、可见毛孔"；负面"卡通Q版" → 锚定段已含"非大眼Q版，非2D动画"，保留即可 |
| **句内否定（少量用）** | 段尾加"不要/无/非"短句 | "画面干净，无文字无水印，不要多余肢体" |
| **转自查清单（兜底）** | 融不进词的项列进交付备注，出图后人工核对 | "多手指/畸形——出图后检查" |

配套规则：
- 通道专属负面项优先**正向融合**：把"禁X"写成"要非X的正确特征"。
- 一条提示词里**句内否定 ≤ 2 处**，多了互相打架。
- 即梦规范（`jimeng-prompt-spec.md`）：用户需要时才单独输出 `负面提示词：……`。

---

## 五、角色资产库的全局负面词

### 5.1 UE5 次世代角色资产库（214 个）全局负面提示词

**出处**：`baselines/角色基准-UE5次世代角色资产库(214个).md` §1.2（"每个角色 prompt 必须附带"）

```text
卡通，二次元，Q版，畸形五官，扭曲肢体，多手指，变形，低模，模糊，噪点，手绘，厚涂，水彩，动漫大眼，夸张比例
```

该库自查清单要求逐条确认："是否附带全局负面提示词？"负面词可直接拼装至 `shot_list.json` 的 `img_prompt` / `h3_video_prompt`。

### 5.2 国风角色原型库（character-library.md）对应负面词

**出处**：`references/character-library.md`

```text
卡通, 二次元, Q版, 畸形五官, 扭曲肢体, 多手指, 变形, 低模, 模糊,
噪点, 手绘, 厚涂, 水彩, 动漫大眼, 夸张比例
```

---

## 六、影视风格熔炼模块的英文负面约束

**出处**：`VISUAL_STYLE_FUSION/SOURCE/影视视觉风格精华熔炼模块_原文.md` §13（文件名乱码，内容完好）

该模块不规定固定负面词，而建议按目标风格建立"反向约束"。

### 13.1 通用反向约束
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

### 13.2 风格冲突约束
低饱和日系：
```text
no excessive saturation
no harsh studio lighting
no deep crushed blacks
no excessive contrast
no glossy commercial look
```
粗粝港片：
```text
no clean digital look
no sterile lighting
no excessive skin smoothing
no perfectly balanced composition
```

同一约束已机器化进 `VISUAL_STYLE_FUSION/REGISTRY/VISUAL_DNA_REGISTRY.json` 的 `"negative"` 字段（general / low_saturation_japanese / coarse_hong_kong 三组，由 `ENGINE/visual_style_dna_engine.py` 读取）。

---

## 七、负面词相关的质检与编译规则

**出处**：`references/prompt-lint-rules.md`、`references/prompt-compiler.md`、`baselines/README.md`

- **P2 优化项**：`负面词与正向词重复或互相打架`（lint 检查项）。
- **模型无关原则**（prompt-compiler §13）：不要假设所有模型共享同一套负面词机制；平台适配只改变表达方式，不改变角色事实。
- **拼词流程**（baselines README ⑦）：`风格锚定段(逐字) + 角色描述(逐字) + 表情段(逐字) + 版式模板 + 负面词`；风格词源**三选一**——通道锚定段只负责路由与负面词来源，三套风格词都带会导致重复与冲突。
- 图像分析流程（`image-analysis-rules.md`）：交付物固定含"中英提示词 + **负面词** + 收录基准卡"。
- 修复策略（`SELF_REPAIR/REPAIR_POLICY.md`）：交付缺负面规避词表属结构性缺陷，自修复**允许补齐容器**，但不得静默改变创作意图。

---

## 附：负面词相关文件索引（69 个命中文件中的关键部分）

| 层 | 文件（zip 内路径） | 内容 |
|----|------|------|
| 总表 | `AI_ART_FUSION/.../references/negative-prompts.md` | 通用 + 分通道 + 场景化 + 拼装规则 |
| 通道 | `AI_ART_FUSION/.../references/style-{octane,ue5,realistic,guoman,arnold,hyperreal,nextgen}.md` | 各 §5 专属负面词 |
| 视频交付 | `LOCKED_CONTRACTS/FINAL_DELIVERY_TRUTH.md`、`DELIVERY/DELIVERY_SCHEMA.json`、`TESTS/E2E/locked_delivery.md` | 负面规避词表字段与示例 |
| 图片端即梦 | `AI_ART_FUSION/.../references/jimeng-seedream-adaptation.md` §3、`jimeng-prompt-spec.md` | 负面词三法 |
| 角色资产 | `baselines/角色基准-UE5次世代角色资产库(214个).md` §1.2、`references/character-library.md` | 全局负面提示词 |
| 风格熔炼 | `VISUAL_STYLE_FUSION/SOURCE/影视视觉风格精华熔炼模块_原文.md` §13、`REGISTRY/VISUAL_DNA_REGISTRY.json` | 英文反向约束 |
| 质检 | `references/prompt-lint-rules.md`、`references/prompt-compiler.md` §13、`SELF_REPAIR/REPAIR_POLICY.md` | 打架检查、模型无关、自修复规则 |
