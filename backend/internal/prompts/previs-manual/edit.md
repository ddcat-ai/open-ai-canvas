# 修改与删除

| 要删 / 改的 | 操作 |
| --- | --- |
| 对象（人物、道具、布景） | `object_remove id` |
| 对象的位置、朝向、大小、颜色、姿势、参数 | `object_update`（position / rotation / scale / color / pose / params / visible） |
| 人物或道具的路径 | `object_motion_path_clear id`（同时清空它的全部位置关键帧） |
| 摄影机的运镜路径 | `object_motion_path_clear id=<摄影机id>` |
| 一段运镜 | `camera_move_remove id=<摄影机id> keyframeId=<运镜段id>` |
| 全部运镜 | `camera_move_remove id=<摄影机id>`（不给 keyframeId） |
| 一个原地动作 | `actor_motion_remove id=<演员> keyframeId=<动作id>` |
| 一个关键帧 | `object_keyframe_remove` / `camera_keyframe_remove` 加 `keyframeId` |
| 摄影机 | `camera_remove`（场景至少保留一台；还被镜头使用时不能删） |
| 镜头 | `shot_remove`（至少保留一个） |
| 灯光 | `light_remove` |
| 时间、天气、远景 | `world_update`；`worldEnabled=false` 关闭世界环境 |

## 规则
- 删除前先读场景确认 ID。用户说「删掉那个运镜」时，如果有多段，列出每段的手法和时间，问清楚删哪一段。
- 改路径的某一个点：读出 `motionPath.points`，改好后用 `object_motion_path_set` 把整条路径重写一遍（写明原来的 `duration` / `easing` / `startDelay`，否则会回到默认值）。
- 用户画的参考轨迹（`scene.paths`）只能由用户在世界引擎里删除：右键轨迹上的点，选「删除整条参考轨迹」，或在属性面板的参考轨迹列表里删。Agent 不能删，需要时提醒用户。
- 用户界面里删除的入口：右键路径上的点（删除途经点或整条路径）；属性面板里的「删除路径」「清空运镜」，以及每段运镜后面的垃圾桶。
