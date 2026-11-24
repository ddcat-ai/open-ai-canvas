# 人物移动：A→B、沿路线、飞行与高度

## 选哪种
| 情况 | 用 |
| --- | --- |
| 从一个点到另一个点（走、跑、冲刺、跳、飞、御剑、悬浮、闪现） | `actor_travel` |
| 经过多个点、拐弯、绕障碍、高度起伏 | `object_motion_path_set` + `pathPoints` |
| 用户画好了轨迹 | `object_motion_path_set` + `pathId`，见 `manual=paths` |

## actor_travel
`{"type":"actor_travel","id":"<演员>","travelStyle":"run","time":1,"duration":3,"fromMarker":"A","toMarker":"B"}`
- `fromMarker` 可省略，省略时从演员在 `time` 时刻的位置出发。也可以用 `pathPoints` 给起终点坐标。
- 飞行类（fly、sword_fly、float、jump）可加 `height`（米），表示离地高度。起飞和降落会自动过渡。
- 合理速度：走 1.4、跑 3.5–6、冲刺 7–10、御剑与飞行 8–20 米/秒。审批摘要里出现「远超合理速度」时，加长 `duration` 或换成飞行、闪现。

## object_motion_path_set（路线）
`{"type":"object_motion_path_set","id":"<演员>","pathPoints":[[0,0,0],[4,0,2],[8,2,2],[12,0,0]],"duration":5,"easing":"smooth","startDelay":0.5}`
- 点的 Y 是离地高度。演员某段给了高度就悬空移动，不再迈步；落回 0 就恢复走路。
- `duration` 是走完整条路线的用时（不含停留）；省略时按 `pathSpeed`（slow 0.7、walk 1.4、run 3.5 米/秒）计算。
- `easing` 是运动规律：linear 匀速、ease_in 加速、ease_out 减速、smooth 缓入缓出。人物起步和停下用 smooth 更自然；冲出画面用 ease_in；急停用 ease_out。
- `orientToPath` 演员默认为 true，面朝前进方向。
- 整条路线会替换该演员原来的全部位置关键帧；同一演员不要同时用 actor_travel 和路径覆盖同一时间段。
- 路线时长超过镜头剩余时长时会被整体加速压缩，审批摘要会提示「镜头时长不够」。这时加长镜头或减少路程。

## 范例：跑过街口跃上屋顶
```json
{"type":"object_motion_path_set","id":"hero","pathPoints":[[-10,0,0],[-2,0,0],[0,1.5,0],[2,4.2,0],[5,4.2,1]],"duration":3.5,"easing":"ease_in","startDelay":0.3}
```
