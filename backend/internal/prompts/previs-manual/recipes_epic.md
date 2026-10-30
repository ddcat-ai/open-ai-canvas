# 完整范例 · 大场面（航拍揭示、群戏、浪漫环绕）

用法、ID 约定和改写方法见 `manual=recipes` 第 0 节：从空模板开始，场景 id 写作 `s`，分几次补丁（搭景 → 表演 → 镜头），先改镜头时长。每个范例都能原样执行并通过 `review`。

大场面的通用规则：
- 揭示要有「小 → 大」：先让观众贴近一个人（背影、脸），再升起或后拉，让环境压过人物。
- 升高与后退同时做（`crane_up` 的 `distance`），只升不退会变成俯视地面；再叠一段 `tilt_up` 把视线抬到地平线，城市和远山才会进画面。
- 大远景的运动要慢：6 秒以上，`easing=smooth`；快了像无人机演示。
- 成片的城市、街区用 `kind=layout`；它以 `position` 为中心铺开，先想清楚人物站在布景的哪一边。
- 群戏里的每个人都要有一点动作（`idle` 呼吸、`look_around`），完全静止的人会被 `review` 指出，画面也像摆拍。

## 1. 开场航拍：少年背影 → 升起后拉 → 上摇揭示整座古城

情境：黄昏，少年走向古城的城门；镜头从他身后升起、后退，城墙和城里的楼阁铺满画面。2.39:1，10 秒。

| 秒 | 人物 | 机位 | 景别 |
| --- | --- | --- | --- |
| 0–3 | 走向城门 | 身后跟随 | 全景背影 |
| 2.4–10 | 继续走，越来越小 | 升高 24 米、后退 40 米 | 全景 → 大远景 |
| 5–10 | — | 上摇 14°，视线从人物抬到城墙与城里 | 揭示 |

布景：`ancient_city` 以 `position` 为中心铺开，城门在它的 +Z 边（中心再往 +Z 约 204 米）。把城的中心放在 z=-232，城门就在人物前方约 26 米（z≈-26）。人物站在原点，面朝 -Z。

第 1 次补丁：
```json
[
  {"type":"shot_update","id":"s-shot-1","name":"古城开场","duration":10,"aspectRatio":"2.39:1","shotSize":"extreme_wide","prompt":"史诗电影开场，2.39:1，黄昏金色逆光，夕阳压在城楼上方，城墙与千家屋顶在暖色薄雾中层层展开，炊烟升起；人物是画面里很小的剪影；空气透视、体积光，宏大而安静，写实质感，柔和胶片颗粒。"},
  {"type":"world_update","id":"s","timeOfDay":17.8,"weather":"clear","ground":"warm","horizon":true,"groundSize":2000},
  {"type":"object_add","id":"city","kind":"layout","layoutTemplate":"ancient_city","name":"长安城","position":[0,0,-232],"size":420,"density":0.7,"crowd":true,"seed":3},
  {"type":"object_add","id":"approach","kind":"prop","propId":"road","name":"城外官道","position":[0,0,-8],"rotation":[0,1.5708,0],"params":{"length":40,"width":8,"lanes":0,"sidewalk":0,"surface":"dirt"}}
]
```
第 2 次补丁：
```json
[
  {"type":"object_add","id":"boy","kind":"actor","archetype":"child","name":"少年","position":[0,0,0],"rotation":[0,3.1416,0],"color":"#dfae3f"},
  {"type":"actor_travel","id":"boy","travelStyle":"walk","time":0.8,"duration":7.7,"pathPoints":[[0,0,0],[0,0,-10]]},
  {"type":"actor_motion_add","id":"boy","motion":"look_around","time":8.5,"duration":1.5,"intensity":0.5}
]
```
第 3 次补丁：
```json
[
  {"type":"camera_update","id":"s-camera-1","name":"航拍","focalLength":35},
  {"type":"camera_move","id":"s-camera-1","technique":"follow","subjectId":"boy","time":0,"duration":3,"params":{"side":"behind","shotSize":"full","lag":0.3}},
  {"type":"camera_move","id":"s-camera-1","technique":"crane_up","time":2.4,"duration":7.6,"easing":"smooth","params":{"height":24,"distance":40}},
  {"type":"camera_move","id":"s-camera-1","technique":"tilt_up","time":5,"duration":5,"easing":"smooth","params":{"angle":14}}
]
```
为什么这样写：跟随只用前 3 秒，让观众先认识这个人；升起后拉时视线还对着他刚才的位置，上摇在中途开始，人物滑到画面下方，城墙和城里从画面上方进来。

## 2. 将军阅兵：侧面跟随掠过士兵 → 升起见全军

情境：两排士兵列阵，将军从队列前走过。镜头在将军右侧平行跟随，士兵的面孔在他身后一个个掠过，最后升起看到整个方阵。2.39:1，9 秒。

| 秒 | 将军 | 机位 |
| --- | --- | --- |
| 0.6–8 | 从队列一端走到另一端（17 米） | 0–5.4 秒在他右侧 3 米平行跟随，中景 |
| 4.6–9 | 继续走 | 升高 12 米、后退 10 米，俯瞰方阵 |

士兵沿 X 排成两排（z=0 和 z=-1.6），面朝 +Z；将军在 z=2 沿 +X 走。他面朝 +X 时右手边是 +Z，所以跟随机位在 z≈5，士兵在他身后。人多时把表演拆成两次补丁。

第 1 次补丁：
```json
[
  {"type":"shot_update","id":"s-shot-1","name":"阅兵","duration":9,"aspectRatio":"2.39:1","shotSize":"medium","prompt":"史诗战争片画面，2.39:1，阴天冷光，铠甲与兵器泛着金属冷光，旌旗在风中翻动；士兵的面孔坚毅、神情各异；低饱和的青灰调色，大颗粒胶片质感，肃杀而庄严。"},
  {"type":"world_update","id":"s","timeOfDay":9.5,"weather":"overcast","ground":"redsoil","horizon":true},
  {"type":"object_add","id":"wall_bg","kind":"prop","propId":"ancient_wall","name":"后方城墙","position":[0,0,-14]},
  {"type":"object_add","id":"gate_bg","kind":"prop","propId":"city_gate","name":"城门","position":[0,0,-34]},
  {"type":"object_array_add","id":"banners","propId":"lantern_pole","name":"旗杆","count":6,"pattern":"line","spacing":4,"position":[0,0,-4]}
]
```
第 2 次补丁：士兵。
```json
[
  {"type":"object_add","id":"soldier_1","kind":"actor","archetype":"man","name":"士兵一","position":[-7.5,0,0],"color":"#8795a5"},
  {"type":"object_add","id":"soldier_2","kind":"actor","archetype":"man","name":"士兵二","position":[-4.5,0,0],"color":"#8795a5"},
  {"type":"object_add","id":"soldier_3","kind":"actor","archetype":"man","name":"士兵三","position":[-1.5,0,0],"color":"#8795a5"},
  {"type":"object_add","id":"soldier_4","kind":"actor","archetype":"man","name":"士兵四","position":[1.5,0,0],"color":"#8795a5"},
  {"type":"object_add","id":"soldier_5","kind":"actor","archetype":"man","name":"士兵五","position":[4.5,0,0],"color":"#8795a5"},
  {"type":"object_add","id":"soldier_6","kind":"actor","archetype":"man","name":"士兵六","position":[7.5,0,0],"color":"#8795a5"},
  {"type":"object_add","id":"soldier_7","kind":"actor","archetype":"man","name":"后排士兵一","position":[-6,0,-1.6],"color":"#6b7580"},
  {"type":"object_add","id":"soldier_8","kind":"actor","archetype":"man","name":"后排士兵二","position":[-3,0,-1.6],"color":"#6b7580"},
  {"type":"object_add","id":"soldier_9","kind":"actor","archetype":"man","name":"后排士兵三","position":[0,0,-1.6],"color":"#6b7580"},
  {"type":"object_add","id":"soldier_10","kind":"actor","archetype":"man","name":"后排士兵四","position":[3,0,-1.6],"color":"#6b7580"},
  {"type":"object_add","id":"soldier_11","kind":"actor","archetype":"man","name":"后排士兵五","position":[6,0,-1.6],"color":"#6b7580"}
]
```
第 3 次补丁：将军和所有人的动作。士兵的 `idle` 时间错开，看起来才不像复制粘贴。
```json
[
  {"type":"object_add","id":"general","kind":"actor","archetype":"man","name":"将军","position":[-10,0,2],"rotation":[0,1.5708,0],"color":"#d84949"},
  {"type":"actor_travel","id":"general","travelStyle":"walk","time":0.6,"duration":7.4,"pathPoints":[[-10,0,2],[7,0,2]]},
  {"type":"actor_motion_add","id":"general","motion":"look_around","time":3,"duration":2,"intensity":0.4},
  {"type":"actor_motion_add","id":"soldier_1","motion":"idle","time":0,"duration":9,"intensity":0.4},
  {"type":"actor_motion_add","id":"soldier_2","motion":"idle","time":0.3,"duration":8.7,"intensity":0.3},
  {"type":"actor_motion_add","id":"soldier_3","motion":"idle","time":0.6,"duration":8.4,"intensity":0.5},
  {"type":"actor_motion_add","id":"soldier_4","motion":"idle","time":0.2,"duration":8.8,"intensity":0.4},
  {"type":"actor_motion_add","id":"soldier_5","motion":"idle","time":0.5,"duration":8.5,"intensity":0.3},
  {"type":"actor_motion_add","id":"soldier_6","motion":"idle","time":0.1,"duration":8.9,"intensity":0.4},
  {"type":"actor_motion_add","id":"soldier_7","motion":"idle","time":0.4,"duration":8.6,"intensity":0.3},
  {"type":"actor_motion_add","id":"soldier_8","motion":"idle","time":0,"duration":9,"intensity":0.5},
  {"type":"actor_motion_add","id":"soldier_9","motion":"idle","time":0.7,"duration":8.3,"intensity":0.4},
  {"type":"actor_motion_add","id":"soldier_10","motion":"idle","time":0.2,"duration":8.8,"intensity":0.3},
  {"type":"actor_motion_add","id":"soldier_11","motion":"idle","time":0.5,"duration":8.5,"intensity":0.4}
]
```
第 4 次补丁：
```json
[
  {"type":"camera_update","id":"s-camera-1","name":"侧跟机位","focalLength":40},
  {"type":"camera_move","id":"s-camera-1","technique":"follow","subjectId":"general","time":0,"duration":5.4,"params":{"side":"right","shotSize":"medium","lag":0.3}},
  {"type":"camera_move","id":"s-camera-1","technique":"crane_up","time":4.6,"duration":4.4,"easing":"smooth","params":{"height":12,"distance":10}},
  {"type":"camera_move","id":"s-camera-1","technique":"handheld","time":0,"duration":4.8,"params":{"intensity":0.3}}
]
```
为什么这样写：平行跟随时前景是将军、背景是一张张士兵的脸，景深层次自然出现；升起在跟随结束前 0.8 秒开始，两段叠在一起，机位不会停顿。

## 3. 雨夜重逢：两人从画面两侧走近 → 环绕 200° 并升高 → 相拥

情境：雨夜街头，分别多年的两人从两侧走向彼此，拉住手；镜头绕着他们转大半圈并缓缓升起。2.39:1，8 秒。

| 秒 | 江屿 | 温言 | 机位 |
| --- | --- | --- | --- |
| 0–3.6 | 从左侧走近 | 1 秒起从右侧走近 | 侧面 6.5 米，推近 2.5 米，两人从画面两侧进来 |
| 3.4–8 | 拉住手 | 拉住手，落泪 | 以江屿为圆心向左环绕 200°，同时升高 1.8 米 |

两人沿 Z 轴相向而行，最后相距 0.9 米；摄影机从 +X 一侧看过去，两人分别从画面左右进入。

第 1 次补丁：
```json
[
  {"type":"shot_update","id":"s-shot-1","name":"雨夜重逢","duration":8,"aspectRatio":"2.39:1","shotSize":"medium","prompt":"爱情电影画面，2.39:1，雨夜街头，两盏路灯的暖光在雨幕中形成光柱，湿漉漉的地面映出霓虹与灯光的倒影，雨滴在逆光中闪烁；浅景深，焦外光斑柔和；暖橙与青蓝的对比调色，胶片颗粒，情绪饱满但克制。"},
  {"type":"world_update","id":"s","timeOfDay":22,"weather":"rain","ground":"city","horizon":false},
  {"type":"object_add","id":"pavement","kind":"prop","propId":"ground_patch","name":"湿地面","position":[0,0,0],"params":{"width":30,"depth":30,"surface":"plaza"}},
  {"type":"object_add","id":"lamp_a","kind":"prop","propId":"street_lamp","name":"路灯一","position":[-2.2,0,-1.8],"rotation":[0,1.5708,0]},
  {"type":"object_add","id":"lamp_b","kind":"prop","propId":"street_lamp","name":"路灯二","position":[-2.2,0,2.6],"rotation":[0,1.5708,0]},
  {"type":"object_add","id":"shopfront","kind":"prop","propId":"shop_front","name":"背景店铺","position":[-9,0,0],"rotation":[0,1.5708,0]},
  {"type":"object_add","id":"parked_car","kind":"prop","propId":"car","name":"路边的车","position":[-4.6,0,-6],"color":"#2f3a4a"}
]
```
第 2 次补丁：
```json
[
  {"type":"object_add","id":"jiang","kind":"actor","archetype":"man","name":"江屿","position":[0,0,-4.5],"rotation":[0,0,0],"color":"#2f7de1"},
  {"type":"object_add","id":"wen","kind":"actor","archetype":"woman","name":"温言","position":[0,0,4.5],"rotation":[0,3.1416,0],"color":"#d84949"},
  {"type":"actor_travel","id":"jiang","travelStyle":"walk","time":0.4,"duration":3.2,"pathPoints":[[0,0,-4.5],[0,0,-0.45]]},
  {"type":"actor_travel","id":"wen","travelStyle":"walk","time":1,"duration":2.5,"pathPoints":[[0,0,4.5],[0,0,0.45]]},
  {"type":"actor_motion_add","id":"jiang","motion":"hold_hand","time":3.7,"duration":4.3,"intensity":1},
  {"type":"actor_motion_add","id":"wen","motion":"hold_hand","time":3.7,"duration":4.3,"intensity":1},
  {"type":"actor_motion_add","id":"wen","motion":"cry","time":4.2,"duration":3.8,"intensity":0.5}
]
```
第 3 次补丁：
```json
[
  {"type":"camera_update","id":"s-camera-1","name":"重逢机位","position":[6.5,1.5,0],"target":[0,1.45,0],"focalLength":50},
  {"type":"camera_move","id":"s-camera-1","technique":"push_in","time":0,"duration":3.6,"easing":"ease_out","params":{"distance":2.5}},
  {"type":"camera_move","id":"s-camera-1","technique":"orbit_left","subjectId":"jiang","time":3.4,"duration":4.6,"easing":"smooth","params":{"angle":200,"rise":1.8,"aim":1.5}},
  {"type":"camera_move","id":"s-camera-1","technique":"handheld","time":0,"duration":8,"params":{"intensity":0.3}}
]
```
为什么这样写：两人走近时镜头同步推近，距离感在画面里同时缩小；拉住手的那一刻开始环绕，环绕本身就是情绪的释放。环绕 200° 而不是 360°，结尾停在另一个人的正面。
