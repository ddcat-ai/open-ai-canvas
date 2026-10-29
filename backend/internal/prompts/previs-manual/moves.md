# 运镜

## 基本用法
`{"type":"camera_move","id":"<摄影机id>","technique":"push_in","time":0,"duration":4,"easing":"smooth","params":{"distance":2}}`
- 手法列表与参数范围见 `catalog.cameraMoves`，大师手法配方见 `catalog.cameraRecipes`。带 `*` 的手法必须给 `subjectId`，带 `°` 的可以给。
- 时间：`time` 是开始秒，`duration` 省略时到镜头结束；超过镜头时长会被拒绝。
- `easing` 是运动规律：linear 匀速、ease_in 加速、ease_out 减速、smooth 缓入缓出（默认）。
- 参数省略时会自动取值：推镜默认推近当前距离的 45%，跟拍按方位取距离与高度。

## 叠加规则
- 多段按开始时间依次叠加：后一段从前一段结束时的机位继续。
- 时间重叠的段同时生效：环绕叠加升高就是螺旋升镜；跟拍叠加环绕就是绕着移动的人物转。
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

## 用户口语与手法
| 用户说 | 手法 |
| --- | --- |
| 慢慢推近、情绪推 | push_in，4–6 秒，smooth |
| 拉远、交代环境、结尾抽离 | pull_out 或 crane_up（distance=同时后退） |
| 镜头跟着人走 | follow side=behind / left / right |
| 绕着人转 | orbit_left / orbit_right，subjectId=人物 |
| 眩晕、背景压过来 | dolly_zoom_out，subjectId=人物 |
| 快速甩过去、转场 | whip_pan_left / whip_pan_right，0.4–0.6 秒 |
| 晃、紧张、纪实 | handheld，intensity 1–1.8 |
| 爆炸、撞击 | shake，0.4–0.8 秒 |
| 盯着某人（机位不动） | look_at |

## 删除与修改
- 删一段：`camera_move_remove` 加 `keyframeId=<运镜段 id>`，id 见 `cameras[].moves`。
- 清空全部运镜：`camera_move_remove` 不给 `keyframeId`。
- 改一段：`camera_move` 的 `keyframeId` 传原段 id，整段覆盖。
- 不要为了微调而叠加一段反向运镜去抵消，直接改或删原段。
