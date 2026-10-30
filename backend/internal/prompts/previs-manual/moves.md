# 运镜

## 基本用法
`{"type":"camera_move","id":"<摄影机id>","technique":"push_in","time":0,"duration":4,"easing":"smooth","params":{"distance":2}}`
- 手法列表与参数范围见 `catalog.cameraMoves`，大师手法配方见 `catalog.cameraRecipes`。带 `*` 的手法必须给 `subjectId`，带 `°` 的可以给。
- 时间：`time` 是开始秒，`duration` 省略时到镜头结束；超过镜头时长会被拒绝。
- `easing` 是运动规律：linear 匀速、ease_in 加速、ease_out 减速、smooth 缓入缓出（默认）。
- 参数省略时取默认值：推镜推近当前距离的 45%，跟拍在身后 4.5 米。默认值只保证能看；要好看就按镜头设计写明参数（见 `manual=shots`）。

## 整套大师手法
`{"type":"camera_move","id":"<摄影机id>","recipe":"ots_to_closeup","subjectId":"<人物id>","time":0,"duration":6}`
- `recipe` 和 `technique` 二选一。配方按总时长比例展开成多段运镜，逐段构成见 `catalog.cameraRecipes`。
- 配方不接受 `params`、`easing`；写入后用 `keyframeId` 覆盖其中一段来微调。

## 跟拍的方位、景别与过渡
- `side`：behind 身后、front 前方倒退跟拍、left / right 人物侧面、above 俯拍、shoulder 过肩、pov 主观。
- `shotSize`：extreme_close_up 面部大特写、close_up 肩部以上、medium 腰部以上、full 全身、wide 远景、extreme_wide 大远景。按当时焦段和镜头画幅算距离、注视高度和机位高度，只对 behind、front、left、right 生效。给了 `distance`、`height`、`aim` 时以给的值为准。
- `blend`：这一段从上一个机位过渡过来的秒数。过渡时机位绕着人物走（方位角、半径、高度分别插值），不会直线穿过人物。不给时，中途开始的跟拍约 0.6 秒内切入。
- `lag`：机位比人物晚多少秒，模拟摄影师追赶；过肩、主观视角不滞后。

## 叠加规则
- 多段按开始时间依次叠加：后一段从前一段结束时的机位继续。
- 时间重叠的段同时生效：环绕叠加升高就是螺旋升镜；跟拍叠加环绕就是绕着移动的人物转。
- 两段跟拍重叠时，后一段从前一段正在跟随的机位出发过渡（过肩跟随 → 绕到正面就是这样写的）。
- `handheld`、`shake` 是叠加层，可以和任何运镜重叠。
- 运镜段叠加在摄影机的路径或关键帧之上：摄影机沿路径走，同时可以叠加 `look_at` 盯人、`handheld` 手持。

## 跟拍飞行的人物
人物先用 `actor_travel`（fly / sword_fly）或带高度的路径飞起来，再加 `follow`，机位会随人物一起升空。
```json
[
  {"type":"actor_travel","id":"hero","travelStyle":"sword_fly","time":0.5,"duration":4,"toMarker":"B","height":3},
  {"type":"camera_move","id":"cam","technique":"follow","subjectId":"hero","params":{"side":"behind","distance":6,"lag":0.35}},
  {"type":"camera_move","id":"cam","technique":"orbit_left","subjectId":"hero","time":2.5,"duration":2,"params":{"angle":120}}
]
```

## 用户口语与写法
一句口语通常对应两到三拍，不是一段运镜。

| 用户说 | 写法 |
| --- | --- |
| 镜头跟着人走 | follow side=behind shotSize=full lag=0.25 起步；人物停下前用 blend 2 秒换到 front close_up 收住 |
| 从肩膀跟着走，再到脸 | recipe `ots_to_closeup` |
| 慢慢推近、情绪推 | 先 follow 或静止中景 1–2 秒，再 push_in 3–4 秒推到近景，smooth，落幅停 0.5 秒 |
| 拉远、交代环境、结尾抽离 | 近景停 1 秒后 pull_out，或 crane_up（distance=同时后退） |
| 绕着人转 | orbit_left / orbit_right，subjectId=人物，angle 90–180，可加 rise 做螺旋 |
| 眩晕、背景压过来 | dolly_zoom_out，subjectId=人物，3 秒以上 |
| 快速甩过去、转场 | 平稳横移或摇镜后接 whip_pan_left / whip_pan_right，0.4–0.6 秒 |
| 晃、紧张、纪实 | 主运镜叠 handheld，intensity 1–1.8 |
| 爆炸、撞击 | shake，0.4–0.8 秒，落在撞击那一帧 |
| 盯着某人（机位不动） | look_at |

## 删除与修改
- 删一段：`camera_move_remove` 加 `keyframeId=<运镜段 id>`，id 见 `cameras[].moves`。
- 清空全部运镜：`camera_move_remove` 不给 `keyframeId`。
- 改一段：`camera_move` 的 `keyframeId` 传原段 id，整段覆盖。
- 不要为了微调而叠加一段反向运镜去抵消，直接改或删原段。
