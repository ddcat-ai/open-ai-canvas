# 搭场景：外景、内景、城镇

## 流程
1. 外景先定环境：`world_update`（`timeOfDay` 0–24 小时、`weather`、`ground`、`groundSize`、`horizon`）。`id` 用场景 ID。
2. 成片的环境用一个布景：`object_add kind=layout layoutTemplate=… size=… density=… seed=…`。模板与尺寸范围见 `catalog.layouts`。
3. 关键道具单独放：`object_add kind=prop propId=…`，参数化组件用 `params`（如楼层数、风格），键与范围见 `catalog.params`。
4. 一排、一圈、一片同类道具：`object_array_add`（`count`、`pattern=line/grid/ring/scatter`、`spacing`、`facing`、`vary`）。
5. 室内：`propId=room` 搭房间壳（宽、深、高、窗、门），再放家具。

## 尺度参考（米）
门 0.9×2.1；桌高 0.75；椅面 0.45；床 2.0×1.6；轿车长 4.6；公交 11；一层楼 3.2；街道宽 10–20；古城民居面宽约 9。

## 范例：黄昏下雨的古街
```json
[
  {"type":"world_update","id":"<sceneId>","timeOfDay":18.2,"weather":"rain","ground":"warm"},
  {"type":"object_add","id":"street","kind":"layout","layoutTemplate":"ancient_street","size":180,"density":0.8,"seed":7},
  {"type":"object_array_add","id":"lantern","propId":"lantern_pole","count":8,"pattern":"line","spacing":6,"position":[-3,0,-20],"facing":"same"}
]
```

## 常见错误
- 布景范围远大于镜头能看到的区域：先确定镜头拍哪里，布景 200 米以内通常够用。
- 道具悬空或半埋：除了岩石、灌木，道具的 y 应该是 0 或所在台面的高度。
- 人物站进建筑：放人前用 `includeTransforms=true` 看一下附近建筑的位置。
