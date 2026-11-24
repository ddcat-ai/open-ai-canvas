# 镜头设计（要电影感、高级运镜、导演手法时先读）

一段 `push_in` 铺满整个镜头、一段不写参数的 `follow`，数据上都合法，但成片像电脑演示。电影里的运镜有节拍：起幅、运动、落幅，每次运动都有理由。下面是设计方法和质量底线。

**拿不准时，先照抄完整范例。** `manual=recipes`（文戏）、`manual=recipes_action`（动作戏）、`manual=recipes_epic`（大场面）里的 13 个范例都能原样执行并通过 `review`，包含搭景、表演、多段运镜和画面质感提示词。先找最接近用户要求的范例，照它的结构改数字，比从零写可靠。

## 1. 先写节拍表，再写补丁
写 `camera_move` 之前，先按镜头时长把节拍表写出来，审批前把节拍表告诉用户。每 2–3 秒一个节拍。

| 秒 | 人物在做什么 | 机位方位 | 景别 | 运动 | 动机 |
| --- | --- | --- | --- | --- | --- |
| 0–3.3 | 主角沿走廊走向门口 | 右肩后（过肩） | 中景 | 贴身跟随 | 让观众跟着他走 |
| 2.4–4.5 | 继续走，放慢 | 绕到正面 | 近景 | 跟拍，用 2 秒绕过去 | 揭示他的表情 |
| 4.7–6 | 停步，抬眼 | 正面 | 面部大特写 | 收紧 | 情绪落点 |

节拍表里的每一行对应一段运镜；人物那一列对应 `actor_travel`、路径或 `actor_motion_add`。

## 2. 质量底线
用户要电影感、高级、还原某部电影或某位导演时，下面每一条都要做到；用户明确要固定机位或简单镜头时可以不做，并在回复里说明。
- 4 秒以上的镜头至少 2 个运动节拍，起幅和落幅的景别不同。
- 每段写全参数：跟拍写 `side`、`shotSize`（或 `distance`）、`lag`；换方位或景别的那一段写 `blend`；摇、环绕写角度；升降写高度。默认值只保证能看。
- 每次运动都要说得出动机：跟随人物、揭示信息、推进情绪、交代空间。说不出动机的运动就删掉。
- 人物也要演。走位、动作和运镜节拍对齐：人物先动，镜头晚 0.1–0.3 秒（`lag`）；人物停下后镜头再停 0.3–0.5 秒。
- 换方位用后一段 `follow` 的 `blend`（绕到另一侧一般 1.5–3 秒），机位会绕着人物走，不会从人物身体里穿过去。
- 叠一层轻微 `handheld`（intensity 0.3–0.6）去掉机械感；追逐、打斗再加强。
- 焦段跟着景别走：特写用 50–85mm，全景用 24–35mm（`camera_update focalLength`）。`shotSize` 会按当时焦段算距离，换焦段不用重算。
- 换方位的跟拍，前一段要持续到后一段 `blend` 结束；提前结束时机位会停在原地，人物继续走远。
- 画面质感写进 `shot_update prompt`：光线方向与色温、调色、胶片颗粒、景深、材质、情绪、参考影片。运镜不用写进 prompt，世界引擎会自动编进去。
- 画幅：用户已选的 `aspectRatio` 不要改；新场景要电影感用 `2.39:1` 或 `16:9`，短剧竖屏用 `9:16`。
- 写完看 `review`：`previs_apply_patch` 的结果和 `previs_scene_read` 的场景精读都会带它，列出数据上看得出的单薄之处。逐条处理，或说明为什么保留。

## 3. 用 recipe 起手，再按剧情改
- `camera_move` 给 `recipe`（不给 `technique`）一次写入整套多段运镜；`catalog.cameraRecipes` 列出每个配方的出处和逐段构成。
- 写入后，`previs_scene_read` 的 `cameras[].moves` 里能看到展开后的每一段。要改某一段，用 `camera_move` 的 `keyframeId` 传那一段的 id 整段覆盖，例如把大特写换成近景。
- 用户点名的导演或电影没有对应配方时，按节拍表用 `technique` 逐段写，至少写清三件事：机位在人物的哪一侧、怎么动、落在什么景别。

| 用户说 | 用 |
| --- | --- |
| 从肩膀跟着主角走，再到脸部特写；斯坦尼康长镜头 | recipe `ots_to_closeup` |
| 边走边说、倒退跟拍、对话里逐渐收紧 | recipe `walk_and_talk` |
| 背影登场、英雄亮相、从背后绕到正脸 | recipe `hero_reveal` |
| 希区柯克、眩晕 | recipe `vertigo` |
| 王家卫、贴身、摇晃的近距离 | recipe `intimate_handheld` |
| 库布里克、对称、一点透视 | recipe `symmetric_follow` |
| 诺兰、航拍揭示 | recipe `aerial_reveal` |
| 御剑、飞行追拍 | 先 `actor_travel` 起飞，再 recipe `sword_chase` |

## 4. 范例：过肩跟随主角走，绕到正面收成面部特写
下面只列运镜部分；连同走廊、灯光、画幅和质感提示词的完整写法见 `manual=recipes` 第 1 节。用配方一次写完：
```json
[
  {"type":"actor_travel","id":"hero","travelStyle":"walk","time":0,"duration":6,"toMarker":"B"},
  {"type":"camera_update","id":"cam","focalLength":40},
  {"type":"camera_move","id":"cam","recipe":"ots_to_closeup","subjectId":"hero","time":0,"duration":6}
]
```
逐段写的等价做法（想改其中某一拍时参考）：
```json
[
  {"type":"camera_move","id":"cam","technique":"follow","subjectId":"hero","time":0,"duration":3.3,"params":{"side":"shoulder"}},
  {"type":"camera_move","id":"cam","technique":"follow","subjectId":"hero","time":2.4,"duration":3.6,"params":{"side":"front","shotSize":"close_up","lag":0.1,"blend":2.1}},
  {"type":"camera_move","id":"cam","technique":"follow","subjectId":"hero","time":4.7,"duration":1.3,"params":{"side":"front","shotSize":"extreme_close_up","lag":0.1,"blend":1.1}},
  {"type":"camera_move","id":"cam","technique":"handheld","time":0,"duration":6,"params":{"intensity":0.35}}
]
```
第二段从 2.4 秒开始、2.1 秒内从过肩绕到正面；它和第一段重叠 0.9 秒，过渡从正在跟随的机位出发，不会停顿。

## 5. 常见偷懒写法
| 写法 | 问题 | 改成 |
| --- | --- | --- |
| 一段 `push_in` 铺满 6 秒 | 一种运动、一个景别 | 先跟随或横移交代空间，再推到近景，落幅停 0.5 秒 |
| 一段 `follow` 不写参数 | 永远是身后 4.5 米 | 写 `side`、`shotSize`、`lag`，后半段换方位并给 `blend` |
| 人物站着不动，只有镜头在动 | 像产品展示 | 给人物走位或动作，镜头跟着人物的动机走 |
| 两段 `follow` 直接换 `side` | 机位 0.6 秒甩过去，像跳切 | 后一段给 `blend` 1.5–3 秒 |
| 每个镜头都套同一个 recipe | 重复，没有剧情 | 按每场戏的情绪选配方，再用 `keyframeId` 改其中一段 |
