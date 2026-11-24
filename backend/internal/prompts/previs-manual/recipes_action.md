# 完整范例 · 动作戏（追逐、打斗、御剑、爆炸）

用法、ID 约定和改写方法见 `manual=recipes` 第 0 节：从空模板开始，场景 id 写作 `s`，分三次补丁（搭景 → 表演 → 镜头），先改镜头时长。每个范例都能原样执行并通过 `review`。

动作戏的通用规则：
- 速度要真实：步行 1.2–1.6 米/秒，跑 3–5，冲刺 6–9，御剑、飞行 6–15。`actor_travel` 的距离 ÷ 时长就是速度，审批摘要会提示明显不合理的速度。
- 跟拍快速移动的人物要给 `lag`（0.2–0.4 秒），摄影师追赶的滞后感会让速度更真实。
- 冲击要落在动作的那一帧：`shake` 与击中、落地、爆炸同时开始，0.4–0.8 秒。
- 手持强度：追逐、打斗 0.7–1.3；手持叠在主运镜上，不要用手持代替运镜。
- 动作戏同样要有起幅、过程、落幅，最后用一个稳定的落点收住，不要动到最后一帧。
- 倒地这类要停住的动作，`duration` 写到镜头结束：动作结束后人物会恢复站立。

## 1. 古街追逐：侧面平行跟拍 → 绕到前方倒退拍 → 撞摊位震屏

情境：盗贼在古街上狂奔，捕快在后面越追越近。2.39:1，7 秒。

| 秒 | 人物 | 机位 | 景别 |
| --- | --- | --- | --- |
| 0–4.2 | 盗贼加速冲刺，绕过摊位 | 他的左侧 3.2 米平行跟拍 | 中景，看清奔跑全身动作 |
| 2.6–7 | 继续狂奔 | 用 1.4 秒绕到他正前方，倒退跟拍 | 近景，看清惊慌的脸；背景里捕快越来越近 |
| 4.8–5.3 | 擦撞路边摊位 | 震屏 | 冲击 |

街道沿 X 方向：两排商铺在 z=±9.5（正面朝街），街面宽约 11 米。人物面朝 +X 跑时，他的左手边是 -Z，所以侧面跟拍的机位在 z≈-3.2，不会撞进商铺。

第 1 次补丁：
```json
[
  {"type":"shot_update","id":"s-shot-1","name":"古街追逐","duration":7,"aspectRatio":"2.39:1","shotSize":"medium","prompt":"写实武侠电影画面，2.39:1，黄昏古街，斜阳从街口打出长长的影子，空气里有扬尘；两侧商铺的灯笼与幌子在运动中拉出动态模糊；高速快门的利落感，暖橙与青灰对比调色，胶片颗粒。"},
  {"type":"world_update","id":"s","timeOfDay":17.6,"weather":"clear","ground":"warm","horizon":true},
  {"type":"object_add","id":"street","kind":"prop","propId":"ground_patch","name":"石板街面","position":[0,0,0],"params":{"width":90,"depth":12,"surface":"stone"}},
  {"type":"object_array_add","id":"shops_south","propId":"ancient_shop","name":"南侧商铺","count":8,"pattern":"line","spacing":10,"position":[0,0,-9.5],"rotation":[0,0,0]},
  {"type":"object_array_add","id":"shops_north","propId":"ancient_shop","name":"北侧商铺","count":8,"pattern":"line","spacing":10,"position":[0,0,9.5],"rotation":[0,3.1416,0]},
  {"type":"object_array_add","id":"lanterns_south","propId":"lantern_pole","name":"南侧灯笼","count":8,"pattern":"line","spacing":10,"position":[5,0,-5.2]},
  {"type":"object_array_add","id":"lanterns_north","propId":"lantern_pole","name":"北侧灯笼","count":8,"pattern":"line","spacing":10,"position":[5,0,5.2],"rotation":[0,3.1416,0]},
  {"type":"object_add","id":"stall_a","kind":"prop","propId":"market_stall","name":"菜摊","position":[-4,0,3.2],"rotation":[0,3.1416,0]},
  {"type":"object_add","id":"stall_b","kind":"prop","propId":"market_stall","name":"被撞的摊位","position":[12,0,3]},
  {"type":"object_add","id":"cart","kind":"prop","propId":"ox_cart","name":"牛车","position":[22,0,-3.4],"rotation":[0,1.5708,0]}
]
```
第 2 次补丁：两人用多点路径绕过障碍。盗贼 6.6 秒跑完约 58 米（约 8.8 米/秒冲刺）；捕快起点在他身后 8 米，同样用时跑更长的路，所以越追越近。
```json
[
  {"type":"object_add","id":"thief","kind":"actor","archetype":"man","name":"盗贼阿七","position":[-28,0,0],"rotation":[0,1.5708,0],"color":"#d84949"},
  {"type":"object_add","id":"constable","kind":"actor","archetype":"man","name":"捕快","position":[-36,0,0.5],"rotation":[0,1.5708,0],"color":"#2f7de1"},
  {"type":"object_motion_path_set","id":"thief","pathPoints":[[-28,0,0],[-12,0,1.2],[2,0,-0.6],[12,0,1.6],[28,0,0]],"duration":6.6,"easing":"ease_in"},
  {"type":"object_motion_path_set","id":"constable","pathPoints":[[-36,0,0.5],[-13,0,1],[1,0,-0.4],[11,0,1],[24,0,0.3]],"duration":6.6,"easing":"ease_in"},
  {"type":"actor_motion_add","id":"thief","motion":"hit_react","time":4.8,"duration":0.6,"intensity":0.8}
]
```
第 3 次补丁：
```json
[
  {"type":"camera_update","id":"s-camera-1","name":"追逐机位","focalLength":40},
  {"type":"camera_move","id":"s-camera-1","technique":"follow","subjectId":"thief","time":0,"duration":4.2,"params":{"side":"left","shotSize":"medium","distance":3.2,"lag":0.3}},
  {"type":"camera_move","id":"s-camera-1","technique":"follow","subjectId":"thief","time":2.6,"duration":4.4,"params":{"side":"front","shotSize":"close_up","lag":0.35,"blend":1.4}},
  {"type":"camera_move","id":"s-camera-1","technique":"shake","time":4.8,"duration":0.5,"params":{"intensity":0.8}},
  {"type":"camera_move","id":"s-camera-1","technique":"handheld","time":0,"duration":7,"params":{"intensity":1.1}}
]
```
为什么这样写：
- 侧面跟拍交代速度和环境，正面倒退拍交代情绪；绕到正面后，背景里的捕快在画面中越来越大，追逐的紧张感来自画面本身。
- 第一段跟拍持续到 4.2 秒，覆盖第二段 1.4 秒的绕行过渡，交接时机位不会掉队。
- 侧面跟拍给了 `distance`：街道只有 11 米宽，按景别自动算的距离会撞进商铺。

## 2. 打斗：低机位环绕 → 击中瞬间急推变焦与震屏 → 升起俯拍倒地者

情境：夜晚庭院，武师与刺客交手，武师一记反击把刺客打倒。2.39:1，5 秒。

| 秒 | 武师 | 刺客 | 机位 |
| --- | --- | --- | --- |
| 0–1.2 | 摆架势 | 摆架势 | 低机位 1 米，从正面开始向右环绕 |
| 1.2–1.8 | 闪 | 出拳 | 继续环绕 |
| 2.0–2.6 | 反击出拳 | 2.35 起被击中 | 2.3 秒急推焦到 55mm，2.35 秒震屏 |
| 3.0–5 | 收势 | 倒地并躺到镜头结束 | 3.2 秒起升高 2.6 米，俯拍收尾 |

第 1 次补丁：灯笼围成半径 5 米的圈，正好在环绕机位的外侧，转动时前景不断掠过灯笼，速度感更强。
```json
[
  {"type":"shot_update","id":"s-shot-1","name":"庭院交手","duration":5,"aspectRatio":"2.39:1","shotSize":"full","prompt":"写实武侠动作电影画面，2.39:1，夜晚石板庭院，一圈灯笼的暖光从低处打亮人物，背景深蓝夜色；击中瞬间有尘土和衣袂飞扬；硬朗的侧逆光、高对比，动作清晰利落，港式武侠的力量感，胶片颗粒。"},
  {"type":"world_update","id":"s","timeOfDay":20.5,"weather":"clear","ground":"warm","horizon":false},
  {"type":"object_add","id":"courtyard","kind":"prop","propId":"ground_patch","name":"石板庭院","position":[0,0,0],"params":{"width":24,"depth":24,"surface":"stone"}},
  {"type":"object_array_add","id":"lantern_ring","propId":"lantern_pole","name":"灯笼","count":6,"pattern":"ring","spacing":5,"position":[0,0,0]},
  {"type":"object_add","id":"hall","kind":"prop","propId":"chinese_hall","name":"正殿","position":[0,0,-14],"params":{"bays":5,"depth":9,"tiers":1}}
]
```
第 2 次补丁：两人间距 0.9 米，彼此面对，沿 X 轴。动作在时间上一来一回地错开。
```json
[
  {"type":"object_add","id":"master","kind":"actor","archetype":"man","name":"武师","position":[-0.45,0,0],"rotation":[0,1.5708,0],"color":"#2f7de1","pose":"fight"},
  {"type":"object_add","id":"assassin","kind":"actor","archetype":"man","name":"刺客","position":[0.45,0,0],"rotation":[0,-1.5708,0],"color":"#d84949","pose":"fight"},
  {"type":"actor_motion_add","id":"master","motion":"fight_idle","time":0,"duration":2,"intensity":1},
  {"type":"actor_motion_add","id":"assassin","motion":"fight_idle","time":0,"duration":1.2,"intensity":1},
  {"type":"actor_motion_add","id":"assassin","motion":"punch","time":1.2,"duration":0.6,"intensity":1.2},
  {"type":"actor_motion_add","id":"master","motion":"punch","time":2,"duration":0.6,"intensity":1.4},
  {"type":"actor_motion_add","id":"assassin","motion":"hit_react","time":2.35,"duration":0.65,"intensity":1.3},
  {"type":"actor_motion_add","id":"assassin","motion":"fall","time":3,"duration":2,"intensity":1},
  {"type":"actor_motion_add","id":"master","motion":"fight_idle","time":3,"duration":2,"intensity":0.6}
]
```
第 3 次补丁：起始机位在两人正面 3.2 米、高 1 米（低机位让人物更有力量），环绕以武师为圆心。
```json
[
  {"type":"camera_update","id":"s-camera-1","name":"低机位","position":[0,1,3.2],"target":[0,1.55,0],"focalLength":32},
  {"type":"camera_move","id":"s-camera-1","technique":"orbit_right","subjectId":"master","time":0,"duration":3,"easing":"smooth","params":{"angle":70,"aim":1.55}},
  {"type":"camera_move","id":"s-camera-1","technique":"zoom_in","time":2.3,"duration":0.3,"easing":"linear","params":{"focalLength":55}},
  {"type":"camera_move","id":"s-camera-1","technique":"shake","time":2.35,"duration":0.6,"params":{"intensity":1.2}},
  {"type":"camera_move","id":"s-camera-1","technique":"crane_up","time":3.2,"duration":1.8,"easing":"ease_out","params":{"height":2.6,"distance":0.5}},
  {"type":"camera_move","id":"s-camera-1","technique":"handheld","time":0,"duration":5,"params":{"intensity":0.7}}
]
```
为什么这样写：急推变焦只有 0.3 秒、匀速，配合震屏就是港式动作片的「重击」；击中后换成升起俯拍，节奏从快到慢，给倒地一个停顿。低机位仰拍时 `aim` 放在胸口以上（1.55），推到 55mm 后脸才不会顶出画面。

## 3. 御剑飞行：起飞跟拍 → 绕到侧面 → 升起拉开见山河

情境：清晨云海，剑客御剑升空，向远方的群山飞去。2.39:1，7 秒。

| 秒 | 人物 | 机位 |
| --- | --- | --- |
| 0–0.6 | 站在剑上蓄势 | 身后 6 米 |
| 0.6–6 | 升到 4 米，向前飞 40 米 | 0–7 秒身后跟拍、随他升空；3.5 秒起向左绕 120° 到侧面 |
| 5.2–7 | 飞向远山 | 叠加升高 6 米、后拉 8 米，人物变小，山河展开 |

第 1 次补丁：
```json
[
  {"type":"shot_update","id":"s-shot-1","name":"御剑出山","duration":7,"aspectRatio":"2.39:1","shotSize":"full","prompt":"仙侠电影画面，2.39:1，清晨云海，金色晨光从侧后方照来，层层山峦在雾中由深到浅；人物衣袂与发带被风拉起，剑身反光；空气透视明显，大气磅礴，写实质感，柔和的高光溢出。"},
  {"type":"world_update","id":"s","timeOfDay":6.8,"weather":"cloudy","ground":"forest","horizon":true,"groundSize":2000},
  {"type":"object_add","id":"cliff","kind":"prop","propId":"boulder","name":"起飞的山岩","position":[0,0,-1.5]},
  {"type":"object_add","id":"hill_a","kind":"prop","propId":"hill","name":"近山","position":[-30,0,45]},
  {"type":"object_add","id":"hill_b","kind":"prop","propId":"hill","name":"远山","position":[35,0,90],"scale":[1.6,1.8,1.6]},
  {"type":"object_add","id":"hill_c","kind":"prop","propId":"hill","name":"最远的山","position":[-10,0,140],"scale":[2.4,2.6,2.4]},
  {"type":"object_array_add","id":"pines","propId":"tree_pine","name":"松林","count":20,"pattern":"scatter","spacing":6,"position":[0,0,20],"vary":0.6,"seed":7}
]
```
第 2 次补丁：
```json
[
  {"type":"object_add","id":"swordsman","kind":"actor","archetype":"man","name":"李长歌","position":[0,0,0],"rotation":[0,0,0],"color":"#34a276"},
  {"type":"actor_travel","id":"swordsman","travelStyle":"sword_fly","time":0.6,"duration":5.4,"height":4,"pathPoints":[[0,0,0],[0,0,40]]}
]
```
第 3 次补丁：配方 `sword_chase` 展开成「全程身后跟拍 + 后半段向左绕 120°」，再叠一段升高后拉。
```json
[
  {"type":"camera_update","id":"s-camera-1","name":"航拍跟机","focalLength":35},
  {"type":"camera_move","id":"s-camera-1","recipe":"sword_chase","subjectId":"swordsman","time":0,"duration":7},
  {"type":"camera_move","id":"s-camera-1","technique":"crane_up","time":5.2,"duration":1.8,"easing":"ease_in","params":{"height":6,"distance":8}},
  {"type":"camera_move","id":"s-camera-1","technique":"handheld","time":0,"duration":7,"params":{"intensity":0.4}}
]
```
为什么这样写：起飞前停 0.6 秒，观众先看清人物和剑；山放在飞行方向的远处，绕到侧面时山进入画面，拉开时人物和山河同框。

## 4. 爆炸逃生：前方低机位倒退跟拍 → 爆炸震屏 → 被掀倒 → 升起俯看

情境：黄昏的街口，身后汽车爆炸，主角向镜头冲来，被冲击波掀倒在地。16:9，5 秒。

| 秒 | 人物 | 机位 |
| --- | --- | --- |
| 0–2.6 | 向镜头冲刺 13 米 | 正前方低机位（0.7 米）倒退跟拍，中景 |
| 1.4–2.2 | 身后爆炸 | 强烈震屏 |
| 2.6–5 | 被掀倒，躺到镜头结束 | 机位停住 |
| 3–5 | 躺在地上 | 下摇 25°，同时升高 0.9 米、后退 0.8 米，俯看倒地的人，背景是燃烧的汽车 |

第 1 次补丁：
```json
[
  {"type":"shot_update","id":"s-shot-1","name":"爆炸逃生","duration":5,"aspectRatio":"16:9","shotSize":"medium","prompt":"写实动作电影画面，16:9，黄昏街口，主角身后汽车爆炸，橙红色火球与黑烟翻滚，碎片和火星飞散，冲击波掀起尘土；火光从背后勾出人物轮廓，前景偏暗；高对比，暖橙与烟灰调色，手持摄影的真实感，胶片颗粒。"},
  {"type":"world_update","id":"s","timeOfDay":18.2,"weather":"overcast","ground":"city","horizon":true},
  {"type":"object_add","id":"road","kind":"prop","propId":"road","name":"街道","position":[0,0,-8],"rotation":[0,1.5708,0],"params":{"length":40,"width":10,"lanes":2}},
  {"type":"object_add","id":"wreck","kind":"prop","propId":"car","name":"爆炸的汽车","position":[1.4,0,-19],"rotation":[0,0.4,0],"color":"#2b2f36"},
  {"type":"object_add","id":"bus_stop","kind":"prop","propId":"bus_stop","name":"公交站","position":[-5.4,0,-10],"rotation":[0,1.5708,0]},
  {"type":"object_array_add","id":"street_lamps","propId":"street_lamp","name":"路灯","count":3,"pattern":"grid","columns":1,"spacing":10,"position":[5.2,0,-10],"rotation":[0,-1.5708,0]},
  {"type":"object_add","id":"bin","kind":"prop","propId":"trash_bin","name":"垃圾桶","position":[-3,0,-4]}
]
```
第 2 次补丁：
```json
[
  {"type":"object_add","id":"zhao","kind":"actor","archetype":"man","name":"赵野","position":[0,0,-14],"rotation":[0,0,0],"color":"#dfae3f"},
  {"type":"actor_travel","id":"zhao","travelStyle":"dash","time":0,"duration":2.6,"pathPoints":[[0,0,-14],[0,0,-1]]},
  {"type":"actor_motion_add","id":"zhao","motion":"fall","time":2.6,"duration":2.4,"intensity":1.2}
]
```
第 3 次补丁：跟拍到 2.8 秒结束后机位停住，接着下摇，再升起后退。
```json
[
  {"type":"camera_update","id":"s-camera-1","name":"低机位前跟","focalLength":28},
  {"type":"camera_move","id":"s-camera-1","technique":"follow","subjectId":"zhao","time":0,"duration":2.8,"params":{"side":"front","shotSize":"medium","height":0.7,"lag":0.25}},
  {"type":"camera_move","id":"s-camera-1","technique":"shake","time":1.4,"duration":0.8,"params":{"intensity":1.6}},
  {"type":"camera_move","id":"s-camera-1","technique":"tilt_down","time":3,"duration":1.4,"easing":"ease_out","params":{"angle":25}},
  {"type":"camera_move","id":"s-camera-1","technique":"crane_up","time":3.2,"duration":1.8,"easing":"smooth","params":{"height":0.9,"distance":0.8}},
  {"type":"camera_move","id":"s-camera-1","technique":"handheld","time":0,"duration":5,"params":{"intensity":1}}
]
```
为什么这样写：世界引擎不模拟爆炸，爆炸写在 `prompt` 里，震屏的时刻就是爆炸的时刻。28mm 低机位让冲向镜头的人物更有压迫感。人物向后倒地时腿会伸向镜头，所以倒地后不要再推近，改为升起后退，前景是倒地的人、背景是燃烧的汽车。
