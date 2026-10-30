# 行为规范（每次操作世界引擎前先读）

## 1. 先读后写
- 写入前必须 `previs_scene_read(sceneId)` 拿到最新 `snapshotHash`。每次写入成功后，下一次写入用返回的新 `snapshotHash`，不要复用旧值。
- 需要坐标时加 `includeTransforms=true`。不要凭记忆或画面描述猜坐标、ID、标签。
- 返回里的 `markers`（标记点 A、B…）、`paths`（参考轨迹「路径1」…）、`objects[].motionPath`、`cameras[].motionPath`、`cameras[].moves` 是用户已经画好的东西，优先复用，不要另起一套。

## 2. 坐标与单位
- Y 轴向上，单位米，**地面 Y=0**。成人约 1.83 米高，演员默认面朝 +Z；`rotation=[0, yaw, 0]`，yaw=atan2(dx, dz)，面朝 +X 时 yaw≈1.571。
- 演员的 `position` Y 永远是 0；离地（飞行、悬空）用路径点高度或 `actor_travel` 的 `height` 表达。
- 道具原点在底面中心，放在地上就是 y=0；放在桌面就是桌面高度（桌高约 0.75）。
- 路径点、参考轨迹的 Y 都是离地高度。

## 3. 一次补丁做一件完整的事
- 每次 `previs_apply_patch` 最多 32 项操作，按顺序执行，后面的操作能看到前面的结果。
- 搭景、摆人、动作、运镜可以拆成几次补丁，每次补丁都能独立审批、独立撤销。不要一次塞满 32 项。
- 审批卡会逐条显示每项操作的摘要，所以每项操作都要能单独看懂（给对象起有意义的 name）。

## 4. 用对工具
| 要做的事 | 用 | 不要用 |
| --- | --- | --- |
| 实物（树、车、房子、桌椅） | `object_add kind=prop propId` | box / cylinder 拼凑 |
| 一片街区、城镇、园林、森林 | `object_add kind=layout` | 上百个单独道具 |
| N 个同类 | `object_array_add` | N 条 object_add |
| 人物 A 点到 B 点 | `actor_travel` | `actor_motion_add run`（那是原地动作） |
| 人物沿一条路线，或沿用户画的轨迹 | `object_motion_path_set`（pathPoints 或 pathId） | 一帧帧手写关键帧 |
| 推拉摇移、环绕、跟拍 | `camera_move` | 用 camera_keyframe_upsert 手算 |
| 多节拍运镜、导演手法 | `camera_move` 的 `recipe`，或按 `manual=shots` 的节拍表逐段写 | 一段运镜铺满整个镜头 |
| 从零搭一个完整镜头（景、人、运镜） | 先读 `manual=recipes` 第 0 节，挑最接近的完整范例照着改 | 凭感觉写一两段运镜 |
| 时间、天气 | `world_update` | 改背景色 |

## 5. 不确定就问
- 用户说「从这里到那里」，但场景里没有标记点或参考轨迹：请用户右键地面标记 A、B，或用画笔画一条轨迹。不要编坐标。
- 主体不明确（例如场景里有多个人）：先问是谁。
- 镜头时长不够：先说明，再用 `shot_update` 加长，或缩短动作。不要静默压缩到看不清。

## 6. 写完自检
- 写完后再读一次场景，核对：对象数量、谁在哪、路径起止时间（`motionPath.end`）、运镜段时间是否落在镜头时长内、人物是否面朝正确方向。
- 写入结果和场景精读里的 `review` 列出镜头在数据上的单薄之处（只有一个运动节拍、参数全靠默认、跟拍换方位没有过渡、人物在走但镜头没跟）。用户要电影感时逐条处理，见 `manual=shots`；保留的要说明原因。
- 需要看画面时用 `previs_preview` 生成白模视频；场景摘要只说明数据，不代表已经看到画面。

## 7. 修改与删除
- 改已有对象用 `*_update`，不要删了重建（会丢失 ID、关键帧和用户的手动调整）。
- 删除前确认删的是哪一个；运镜、路径、动作都有专门的删除操作，见 `manual=edit`。
