# 用户画的轨迹：识别、复用、人物走镜头轨迹

## 识别
用户在世界引擎里用画笔或折线画的轨迹出现在三个地方：
- `scene.paths`：没选对象时画的参考轨迹。字段有 `label`（如「路径1」）、`points`（Y 为离地高度）、`length`（米）、`maxHeight`。
- `cameras[].motionPath`：画在摄影机上的运镜路径。
- `objects[].motionPath`：画在演员或道具上的路径。字段有 `points`、`length`、`maxHeight`、`startDelay`、`end`、`easing`、`curve`。

用户说「沿我画的那条」「按路径1」「按刚才的运镜轨迹」时，从这三处找。只有一条时直接用；有多条时报出标签，问用户用哪条。描述轨迹时说清长度、起终点大致位置、最高离地高度。

## 复用：pathId
`object_motion_path_set` 的 `pathId` 可以是：
- 参考轨迹的标签或 ID，保留它画下的高度；
- 另一个对象或摄影机的 ID，复用它的整条路线和节奏（速度、运动规律、曲线、段速、停留）。

把别人的路径交给演员时，演员默认**贴地行走**（高度清零）。要让演员按原高度飞，给 `height` 表示整条路径的离地高度；要逐点不同高度，改用 `pathPoints`。`duration`、`easing`、`startDelay` 写了就覆盖原值。

## 场景：人物按我画的运镜轨迹走，镜头跟着
用户已经给摄影机画了运镜路径，现在想让某个人物沿这条轨迹走、镜头跟随。按用户想要的效果选一种：

**A. 镜头沿同一条轨迹跟在后面（推荐，最贴近「镜头跟随运镜」）**
```json
[
  {"type":"object_motion_path_set","id":"<演员>","pathId":"<摄影机id>"},
  {"type":"object_motion_path_set","id":"<摄影机id>","pathId":"<摄影机id>","startDelay":0.8},
  {"type":"camera_move","id":"<摄影机id>","technique":"look_at","subjectId":"<演员>","time":0}
]
```
第二条让摄影机走自己原来的轨迹，比人物晚 0.8 秒出发（数值越大离人物越远）；摄影机原来的 `motionPath.startDelay` 不是 0 时，写「原值 + 0.8」。第三条让镜头始终对着人物。人物出发时间与摄影机原路径一致，`motionPath.end` 加上延迟后不能超过镜头时长，否则先 `shot_update` 加长镜头。

**B. 镜头改为跟拍人物**：去掉摄影机自己的路径，改用 `follow`。
```json
[
  {"type":"object_motion_path_set","id":"<演员>","pathId":"<摄影机id>"},
  {"type":"object_motion_path_clear","id":"<摄影机id>"},
  {"type":"camera_move","id":"<摄影机id>","technique":"follow","subjectId":"<演员>","params":{"side":"behind","distance":4.5}}
]
```

**C. 镜头保留原轨迹，只是盯住人物**：只写 A 的第一条和第三条。

在世界引擎里，用户也可以直接操作：右键摄影机路径上的点，选「让人物走这条轨迹」；或者在镜头面板「运镜」里选人物和镜头方式。

## 场景：摄影机沿参考轨迹运镜
`{"type":"object_motion_path_set","id":"<摄影机id>","pathId":"路径1","height":2.5,"easing":"smooth","duration":6}`
摄影机的路径高度就是机位离地高度。参考轨迹画在地面上（高度 0）时，一定要给 `height`，否则镜头会贴着地面。
