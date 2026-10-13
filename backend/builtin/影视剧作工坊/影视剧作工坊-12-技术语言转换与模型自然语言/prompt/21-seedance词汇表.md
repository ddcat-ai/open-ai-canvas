# Seedance 2.0 词汇库（运镜·风格·画质·大气）

> **落位说明**（并入影视剧作工坊时添加，正文保留原文）
> 来源：seedance2.0-prompt-skill · vocabulary
> 原文文件名：`seedance-vocabulary.txt`
> 链路归位：见第四批提取索引 `INDEX.md`（镜头→光影→物理→分镜连续→提示词→声音BGM→连续性）

> Seedance 2.0 对中英文混合描述效果更好。本文件收录：
> - **运镜修饰词**（速度/情绪/风格修饰、组合模板）
> - **视觉风格词**
> - **画质锚定词库**
> - **大气与镜头质感词库**
> - **光影三层结构词库**
> - **后期处理与收束词库**
>
> 📷 **运镜坐标系统已升级**：基础运镜动作（Pan/Dolly/Zoom/Crane/Orbit...）和情绪→坐标编码，请查阅 [camera-codec.md](camera-codec.md)（相机四维编码系统）。本文件只保留"修饰词"部分。

---

## 运镜修饰词（赋予运镜灵魂）

与 [camera-codec.md](camera-codec.md) 中的基础运镜动作组合使用，控制速度、情绪和风格。

### 速度修饰

| 修饰词 | 适用场景 | 示例 |
|--------|----------|------|
| Smooth / 流畅的 | 浪漫、平和 | Smooth dolly in on the couple dancing |
| Slow / 缓慢的 | 悬念、回忆 | Slow zoom out from the old photograph |
| Fast/Rapid / 快速的 | 紧张、激烈 | Fast tracking shot through the crowded market |
| Subtle / 微妙的 | 增强沉浸感 | Subtle tilt up during the character's monologue |
| Gradual / 渐进的 | 自然过渡 | Gradual 10-second crane up |
| Sudden / 突然的 | 惊吓、转折 | Sudden whip pan to reveal the villain |

### 情绪修饰

| 修饰词 | 适用场景 | 示例 |
|--------|----------|------|
| Cinematic / 电影感 | 万能增强词 | Cinematic arc shot around the hero |
| Aggressive / 侵略性 | 恐怖、动作 | Aggressive handheld tracking in the chase |
| Dreamy / 梦幻的 | 童话、回忆 | Dreamy slow-motion dolly through the field |
| Intimate / 亲密的 | 近距离情感 | Intimate close-up push-in on clasped hands |
| Epic / 史诗的 | 宏大场面 | Epic crane up revealing the army |
| Dynamic / 动态的 | 活力场景 | Dynamic tracking through the dance floor |

### 风格修饰

| 修饰词 | 效果 | 示例 |
|--------|------|------|
| Handheld / 手持 | 纪实感、混乱感 | Handheld follow shot in the war zone |
| Aerial / 航拍 | 俯瞰视角 | Aerial rising shot over the city at sunrise |
| Dutch Angle / 荷兰角 | 倾斜构图，不安感 | Dutch angle tracking in the thriller |
| Gimbal / 云台 | 稳定流畅 | Gimbal tracking shot through the corridor |
| Steadicam / 斯坦尼康 | 专业级稳定 | Steadicam follow through the long hallway |
| POV / 主观视角 | 第一人称沉浸 | POV walking through the haunted house |

### 组合运镜速查

将 2-3 个运镜叠加，用 `+` 或 `while` 连接。**一次不要超过 3 个动作（四维编码系统的核心铁律：最多双轴运动）。**

| 组合 | 效果 | 适用场景 |
|------|------|----------|
| Orbit + Zoom In | 视觉冲击力极强 | 揭示主体 |
| Crane Up + Pan | 大气磅礴 | 开场/结尾 |
| Dolly Zoom (Vertigo Effect) | 眩晕效果 | 心理冲击 |
| Hyperlapse + Orbit | 时空压缩感 | 城市/自然变化 |
| Tracking + Handheld Shake | 紧张追逐感 | 追逐/逃亡 |
| Dolly Back + Crane Up | 逐渐揭示 | 震撼场景揭示 |
| Arc Shot 180 + Subtle Zoom In | 情绪聚焦 | 情绪转折点 |

**组合示例：**
```
Starting from a close-up of a mysterious object,
Slow Dolly Back + Crane Up,
gradually revealing it's part of a massive ancient temple,
epic scale, golden hour lighting
```

### 运镜万能模板

```
[主体描述 Subject],
[运镜类型 Camera Movement] + [速度/情绪修饰 Modifier],
[光线描述 Lighting],
[风格关键词 Style],
[技术参数 Technical]
```

> 💡 需要精准控制镜头的四维坐标（Z 距离 / Y 高度 / X 方位 / F 滤镜）、情绪→坐标编码速查表、多镜头叙事坐标递进——请直接查阅 [camera-codec.md](camera-codec.md)。

### 常见问题

- **运镜不流畅？** 避免模糊词 "move"，改用精确术语如 `Smooth 3-second dolly forward`，加 `stabilized` 或 `gimbal shot`
- **控制运镜速度？** 用明确时间：`3-second slow zoom` / `Rapid 1-second whip pan`
- **多个运镜冲突？** 一次最多 2-3 个动作，用 `+` 或 `while` 连接。每个镜头最多双轴运动。

---

## 视觉风格词汇

| 类别 | 关键词 |
|------|--------|
| 画面质感 | 电影感、胶片质感、8K、HDR、RAW 质感、photorealistic |
| 影像风格 | 好莱坞大片、独立电影、纪录片、MV 风格、2.35:1 宽银幕 |
| 色调氛围 | 暖色调、冷色调、莫兰迪色系、赛博朋克霓虹、golden hour |
| 艺术风格 | 写实主义、超现实主义、蒸汽波、中国风水墨、3D 国漫 CG |
| 光影效果 | 自然光、侧逆光、丁达尔效应/god rays、霓虹灯光、体积光 |
| 景深控制 | shallow depth of field / 浅景深、deep focus / 深焦、rack focus / 焦点切换 |

> 💡 商业级/电影级的美学约束（Octane 渲染品质、冷暖色调对比系统、极简构图法则）详见 [aesthetic-constraints.md](aesthetic-constraints.md)。

---

## 画质锚定词库

> 在提示词开头声明，为模型设置品质基准。越具体越有效，比"电影感"精准 10 倍。

| 类别 | 关键词 |
|------|--------|
| **渲染引擎** | UnrealEngine5渲染、Octane物理渲染引擎、Blender Cycles渲染、V-Ray光追渲染 |
| **画质规格** | 8K超高清、4K超采样、IMAX级画质、RAW影像质感 |
| **HDR标准** | 杜比视界HDR、HDR10+、高动态范围 |
| **VFX等级** | 工业光魔级VFX特效、好莱坞A级特效、院线级CG、漫威级视觉特效 |
| **物理模拟** | 流体动力学模拟、粒子物理引擎、破碎物理模拟 |
| **摄影机感** | ARRI ALEXA摄影机质感、RED摄影机色彩、65mm胶片颗粒质感 |

**使用示例：**
```
15秒史诗科幻短片，8K超高清+杜比视界HDR，UnrealEngine5渲染，工业光魔级VFX特效，...
```

---

## 大气与镜头质感词库

> 描述环境介质和镜头本身的物理状态，大幅提升真实感和沉浸感。

### 大气效果

| 效果 | 关键词 |
|------|--------|
| **薄雾/朦胧** | 薄雾弥散、潮湿朦胧氛围、白色雾气弥漫、灰白色海雾包裹、雾气自然弥散 |
| **丁达尔效应** | 丁达尔效应清晰、光束穿透雾层、光柱在尘埃中可见、god rays射线感 |
| **热浪/蒸汽** | 热浪蒸腾、蒸汽气团上涌、高温气流扭曲画面、蒸汽与雾气交融 |
| **烟尘粒子** | 腐蚀白烟、爆炸烟尘、细粒子悬浮空中、粉尘弥散光线 |
| **大气连贯** | 每帧都有自然的薄雾弥散效果、全程雨雾弥漫、统一的大气透视感 |

### 镜头质感效果

| 效果 | 关键词 |
|------|--------|
| **镜头附着物** | 雾水珠附着镜头前、雾粒粘镜细节清晰、水珠在镜头前滚动、雨滴溅到镜头 |
| **光学畸变** | 镜头畸变效果、雾层折射、鱼眼镜头拉伸透视、超广角边缘畸变 |
| **镜头震动** | 镜头剧烈抖动、能量波动震动镜头、爆炸冲击波震动镜头 |
| **镜头耀斑** | 镜头耀斑(lens flare)、逆光眩光、光斑散射 |

---

## 光影三层结构词库

> 拆分为三层描述光影，避免笼统模糊，是大制作提示词的核心技巧。

**第一层 — 光源（是什么光、从哪里来）：**

| 场景 | 光源词 |
|------|--------|
| 灾难/动作 | 暴雨逆光 / 爆炸橙红火光 / 核爆白光 / 闪电侧光 |
| 奇幻/科幻 | 怪兽熔岩自发光 / 荧光酸液光 / 能量球蓝白光 / 飞船引擎尾焰光 |
| 都市/夜景 | 霓虹灯漫射 / 建筑玻璃幕墙反射 / 防空警报红光 / 车灯流光 |
| 自然/写实 | 暴风雨漫射天光 / 黄金时刻侧逆光 / 月光冷辉 / 火焰跳动暖光 |

**第二层 — 光的行为（光如何与材质/大气互动）：**

薄雾柔化高光 / 雾层强化阴影对比 / 烟尘散射光线 / 玻璃折射彩虹光斑 / 金属反射爆炸火光 / 雨水折射霓虹 / 丁达尔效应清晰 / 体积光穿透

**第三层 — 色调（整体冷暖和对比）：**

| 风格 | 色调 |
|------|------|
| 灾难/压迫 | 冷蓝底调+熔岩红高光 |
| 赛博朋克 | 冷蓝底调+霓虹紫红高光 |
| 奇幻/仙侠 | 暗青底调+金色/荧光高光 |
| 末日/恐怖 | 灰绿底调+暗红强化 |
| 暖色/史诗 | 暗棕底调+橙金高光 |

**三层结构使用示例：**
```
光影：暴雨逆光+爆炸橙红火光+怪兽熔岩自发光（光源层），
薄雾柔化高光但强化阴影对比、丁达尔效应清晰（光行为层），
冷蓝底调+熔岩红高光（色调层）。
```

---

## 后期处理与收束词库

> 附在提示词结尾，统一后期处理风格 + 一句话锚定全片情绪张力。

### 后期处理词（可叠加使用）

暗角 / 胶片颗粒 / 电子噪点 / 色差(chromatic aberration) / 轻微镜头失真 / 运动模糊 / 轻微过曝 / 胶片刮痕

### 张力宣言（按风格分类）

| 风格 | 收束句示例 |
|------|-----------|
| 压迫/灾难 | 窒息式压迫感+诡谲朦胧氛围，无冗余画面，全程高张力 |
| 科幻/未来 | 冰冷机械美学，每帧可截图成壁纸，镜头感拉满 |
| 仙侠/奇幻 | 仙气飘渺，如梦似幻，全程不要现代感痕迹 |
| 都市/情感 | 温度感十足，每帧有呼吸感，镜头语言克制而有力 |
| 动作/热血 | 肾上腺素拉满，节奏紧绷，剪辑感强烈 |
| 孤寂/文艺 | 留白充分，克制的情绪张力，画面呼吸感强 |

**收束句完整模板：**
```
[后期处理词1]+[后期处理词2]+[后期处理词3]收尾，[情绪形容词]氛围，[质量宣言]。
```

**实例：**
```
暗角+胶片颗粒+电子噪点混雾粒收尾，窒息式压迫感+诡谲朦胧氛围，无冗余画面，全程高张力。
```
