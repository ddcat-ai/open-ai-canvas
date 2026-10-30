# 完整范例 · 文戏（对话、情绪、揭示、短剧亮相）

动作戏见 `manual=recipes_action`（追逐、打斗、御剑、爆炸），大场面见 `manual=recipes_epic`（航拍揭示、阅兵、雨夜重逢）。镜头设计方法见 `manual=shots`。

## 0. 怎么用这些范例（先读这一节）

**每个范例都能原样执行。** 测试会从 `previs_scene_create templateId=empty` 建出的空场景开始，按顺序执行范例里的每一段 JSON，并要求结果通过 `review`。照抄结构、只改数字和名字，结果就不会差。

**ID 约定。** 范例里的场景 id 写作 `s`。空模板自带这些对象，范例直接用它们：

| 自带对象 | id |
| --- | --- |
| 镜头（默认 5 秒） | `s-shot-1` |
| 摄影机 | `s-camera-1` |
| 主光 / 轮廓光 / 环境光 | `s-light-key` / `s-light-fill` / `s-light-ambient` |

真实场景里把 `s` 换成 `previs_scene_read` 返回的场景 id；`world_update` 的 `id` 也是场景 id。场景里已经有人物或摄影机时，用它们的 id，不要重复新建。

**每个范例分三次补丁**，每次补丁都要用上一次返回的 `snapshotHash`：
1. 搭景：镜头时长、画幅、画面质感提示词、布景、灯光或天气。
2. 表演：人物、走位、动作。
3. 镜头：摄影机焦段与多段运镜。

**镜头时长要先改。** 运镜、走位、动作都不能超过当前镜头时长，所以第 1 次补丁的第一项永远是 `shot_update duration`。

**画幅。** 用户已经选了画幅（`shots[].aspectRatio`）就不要改；范例里的 `aspectRatio` 只用于新场景。电影感默认 `2.39:1` 或 `16:9`，短剧竖屏用 `9:16`。

**prompt 写画面质感，不写运镜。** 运镜、走位由世界引擎自动编进视频提示词；`shot_update prompt` 写光线、色调、胶片颗粒、景深、材质、情绪和参考影片。

**改写方法（不要改结构）：**
- 换地点：所有 `position`、`pathPoints`、`target` 加同一个偏移。
- 换时长：先改 `shot_update duration`，再把所有 `time`、`duration` 乘同一个比例；`recipe` 会按新的时长自动展开。
- 换人：改 `name`、`archetype`、`color`；脸部高度跟着身高变（成人、女性约 1.70 米，男性 1.77，儿童 1.23，老人 1.57）。
- 反方向：人物朝 -Z 走时，把所有 Z 坐标取反，`rotation` 的 yaw 加 3.1416。

**坐标速记：** 人物默认面朝 +Z；面朝 +X 时 yaw=1.5708，面朝 -X 时 yaw=-1.5708，面朝 -Z 时 yaw=3.1416。人物面朝 +Z 时，他的右手边是 -X、左手边是 +X。

### 按用户说法选范例
| 用户说 | 范例 |
| --- | --- |
| 从肩膀跟着主角走，再到面部特写；长镜头；斯坦尼康 | 本篇 1 |
| 两人对话、正反打、谈判、争吵 | 本篇 2 |
| 意识到真相、震惊、眩晕、希区柯克 | 本篇 3 |
| 结尾、孤独、抽离、镜头升起离开人物 | 本篇 4 |
| 先拍东西再拍人、揭示、悬念 | 本篇 5 |
| 短剧女主 / 男主出场、背影转身亮相、竖屏 | 本篇 6 |
| 追逐、逃跑 | `recipes_action` 1 |
| 打斗、交手、一拳打中 | `recipes_action` 2 |
| 御剑、飞行、腾空 | `recipes_action` 3 |
| 爆炸、逃生、被冲击波掀倒 | `recipes_action` 4 |
| 开场、航拍、揭示城市 | `recipes_epic` 1 |
| 将军检阅、军队、群戏 | `recipes_epic` 2 |
| 重逢、相拥、浪漫、环绕 | `recipes_epic` 3 |

## 1. 走廊长镜头：过肩跟随 → 绕到正面 → 面部大特写

情境：主角沿走廊走向尽头的门，停下，抬眼。斯坦尼康一镜到底，2.39:1，6.5 秒。

| 秒 | 人物 | 机位 | 景别 | 动机 |
| --- | --- | --- | --- | --- |
| 0–3.3 | 沿走廊向前走 | 右肩后，贴身跟随 | 过肩中景 | 观众跟着他走进走廊 |
| 2.6–4.9 | 继续走，放慢 | 从右侧绕到正面 | 近景 | 揭示他的表情 |
| 5.1–6.5 | 停步，四下看 | 正前方 | 面部大特写 | 情绪落点 |

第 1 次补丁：镜头、走廊、灯光。走廊沿 Z 方向，两侧墙在 x=±1.95，壁柱在 x=±1.7，给机位绕行留出 1 米以上空间。
```json
[
  {"type":"shot_update","id":"s-shot-1","name":"走廊长镜头","duration":6.5,"aspectRatio":"2.39:1","shotSize":"close_up","prompt":"写实电影画面，2.39:1 变形宽银幕，35mm 胶片颗粒与轻微光晕；狭长走廊，顶部冷青色灯带，尽头门缝透出暖橙色光，冷暖对比强烈；浅景深，背景虚化成柔和光斑；人物皮肤、布料质感真实，表情克制；斯坦尼康运动稳定但带呼吸感。"},
  {"type":"object_add","id":"wall_left","kind":"prop","propId":"wall","name":"走廊墙（人物左手边）","position":[1.95,0,3],"rotation":[0,1.5708,0],"params":{"length":16,"height":3.2,"material":"plaster"}},
  {"type":"object_add","id":"wall_right","kind":"prop","propId":"wall","name":"走廊墙（人物右手边）","position":[-1.95,0,3],"rotation":[0,1.5708,0],"params":{"length":16,"height":3.2,"material":"plaster"}},
  {"type":"object_add","id":"wall_end","kind":"prop","propId":"wall","name":"走廊尽头","position":[0,0,11],"params":{"length":4.2,"height":3.2,"material":"plaster"}},
  {"type":"object_array_add","id":"pillar_left","propId":"column","name":"左侧壁柱","count":6,"pattern":"grid","columns":1,"spacing":2.6,"position":[1.7,0,3],"params":{"height":3.2,"radius":0.18,"style":"square"}},
  {"type":"object_array_add","id":"pillar_right","propId":"column","name":"右侧壁柱","count":6,"pattern":"grid","columns":1,"spacing":2.6,"position":[-1.7,0,3],"params":{"height":3.2,"radius":0.18,"style":"square"}},
  {"type":"light_update","id":"s-light-key","name":"尽头门光","position":[0,2.4,10],"color":"#ffc58a","intensity":2.6},
  {"type":"light_update","id":"s-light-fill","name":"顶部冷光","position":[0,3.4,-2],"color":"#a9c4ff","intensity":0.9},
  {"type":"light_update","id":"s-light-ambient","intensity":0.35}
]
```
第 2 次补丁：人物。6 米走 5.2 秒，约 1.15 米/秒，是心事重重的慢走；最后 1.3 秒停下四顾，给特写一个表情。
```json
[
  {"type":"object_add","id":"hero","kind":"actor","archetype":"man","name":"陈默","position":[0,0,0],"rotation":[0,0,0],"color":"#2f7de1"},
  {"type":"actor_travel","id":"hero","travelStyle":"walk","time":0,"duration":5.2,"pathPoints":[[0,0,0],[0,0,6]]},
  {"type":"actor_motion_add","id":"hero","motion":"look_around","time":5.2,"duration":1.3,"intensity":0.5}
]
```
第 3 次补丁：镜头。40mm 适合贴身跟随；配方 `ots_to_closeup` 按 6.5 秒展开成四段：过肩跟随 0–4.9 秒，绕到正面近景 2.6–6.5 秒（切入 2.3 秒），面部大特写 5.1–6.5 秒（切入 1.2 秒），全程轻微手持。
```json
[
  {"type":"camera_update","id":"s-camera-1","name":"斯坦尼康","focalLength":40},
  {"type":"camera_move","id":"s-camera-1","recipe":"ots_to_closeup","subjectId":"hero","time":0,"duration":6.5}
]
```
为什么这样写：
- 人物先动、镜头跟着动；人物停下前，镜头已经绕到正面，停步那一刻正好是大特写。
- 前一段跟拍一直持续到后一段过渡结束，交接时机位不会停在原地。
- 墙和壁柱给了运动参照物：画面里能看出机位在移动。

## 2. 双人对话：三机位覆盖（双人横移 + 两个过肩推）

情境：客厅里两人对峙，林舟先说，苏晚后说。三台摄影机拍同一段 5 秒表演，剪辑时在三个镜头之间切换。

关键规则：
- 多个镜头共用同一条时间线：每个镜头都从 0 秒播放同一段表演，只是换了摄影机。正反打就是同一段表演，用两台摄影机各拍一遍。
- 两人连线是 X 轴。三台摄影机全在 +Z 一侧（180° 轴线同侧），切镜头时两人不会左右互换。
- 过肩机位放在前景人物身后约 1 米、偏向镜头一侧 0.4 米，高度与脸齐平，焦点对着对面那个人的脸。

| 镜头 | 摄影机 | 内容 | 运动 |
| --- | --- | --- | --- |
| 镜头 1 双人中景 | `s-camera-1` | 两人同框，交代关系 | 全程缓慢右移 0.35 米（只要一点视差）；2 秒起推近 0.5 米 |
| 镜头 2 过林舟肩拍苏晚 | `cam_b` | 苏晚的反应与台词 | 盯住苏晚的脸；她开口前 0.2 秒起慢推 |
| 镜头 3 过苏晚肩拍林舟 | `cam_c` | 林舟的台词 | 盯住林舟的脸；0.3 秒起慢推 |

第 1 次补丁：镜头 1、客厅、灯光。`room` 的正面（+Z）是敞开的，留给机位。
```json
[
  {"type":"shot_update","id":"s-shot-1","name":"双人中景","duration":5,"aspectRatio":"16:9","shotSize":"medium","prompt":"写实电影画面，16:9，室内夜景，暖色台灯与窗外冷蓝色天光交织；中等景深，背景书架略虚；两人之间留出紧张的负空间；胶片质感，肤色自然，低饱和偏青的调色。"},
  {"type":"object_add","id":"living_room","kind":"prop","propId":"room","name":"客厅","position":[0,0,-0.5],"params":{"width":7,"depth":6,"height":3,"windows":2,"door":"left","front":"open"}},
  {"type":"object_add","id":"shelf","kind":"prop","propId":"bookshelf","name":"书架","position":[-2.2,0,-3.2]},
  {"type":"object_add","id":"sofa","kind":"prop","propId":"sofa","name":"沙发","position":[2,0,-2.7]},
  {"type":"object_add","id":"plant","kind":"prop","propId":"potted_plant","name":"盆栽","position":[3,0,-3.1]},
  {"type":"light_update","id":"s-light-key","name":"暖色台灯方向","position":[3.2,2.8,1.5],"color":"#ffd9b0","intensity":2.2},
  {"type":"light_update","id":"s-light-fill","name":"窗外冷光","position":[-3,2.5,-2],"color":"#b8c8ff","intensity":0.8}
]
```
第 2 次补丁：两人和他们的表演。间距 1.4 米，彼此面对；说话和反应在时间上错开。
```json
[
  {"type":"object_add","id":"lin","kind":"actor","archetype":"man","name":"林舟","position":[-0.7,0,0],"rotation":[0,1.5708,0],"color":"#2f7de1"},
  {"type":"object_add","id":"su","kind":"actor","archetype":"woman","name":"苏晚","position":[0.7,0,0],"rotation":[0,-1.5708,0],"color":"#d84949"},
  {"type":"actor_motion_add","id":"lin","motion":"talk","time":0,"duration":2.2,"intensity":1},
  {"type":"actor_motion_add","id":"su","motion":"nod","time":0.6,"duration":1,"intensity":0.6},
  {"type":"actor_motion_add","id":"su","motion":"talk","time":2.4,"duration":2.4,"intensity":1.1},
  {"type":"actor_motion_add","id":"lin","motion":"shake_head","time":3.4,"duration":1,"intensity":0.5}
]
```
第 3 次补丁：三台摄影机与三个镜头。`look_at` 的 `aim` 是脸部高度（女性 1.66、男性 1.74，比眼睛略低）。
```json
[
  {"type":"camera_update","id":"s-camera-1","name":"A机·双人","position":[0,1.45,3.6],"target":[0,1.4,0],"focalLength":35},
  {"type":"camera_move","id":"s-camera-1","technique":"truck_right","time":0,"duration":5,"params":{"distance":0.35}},
  {"type":"camera_move","id":"s-camera-1","technique":"push_in","time":2,"duration":3,"params":{"distance":0.5}},
  {"type":"camera_add","id":"cam_b","name":"B机·过林舟肩","position":[-1.7,1.66,0.42],"target":[0.7,1.66,0],"focalLength":50},
  {"type":"camera_move","id":"cam_b","technique":"look_at","subjectId":"su","time":0,"duration":5,"params":{"aim":1.66}},
  {"type":"camera_move","id":"cam_b","technique":"push_in","time":2.2,"duration":2.6,"params":{"distance":0.45}},
  {"type":"camera_add","id":"cam_c","name":"C机·过苏晚肩","position":[1.7,1.7,0.42],"target":[-0.7,1.74,0],"focalLength":50},
  {"type":"camera_move","id":"cam_c","technique":"look_at","subjectId":"lin","time":0,"duration":5,"params":{"aim":1.74}},
  {"type":"camera_move","id":"cam_c","technique":"push_in","time":0.3,"duration":2.4,"params":{"distance":0.4}},
  {"type":"shot_add","id":"s-shot-2","name":"过肩·苏晚","cameraId":"cam_b","duration":5,"aspectRatio":"16:9","shotSize":"close_up","prompt":"过肩近景，前景林舟的肩膀与后脑虚化成暗部，焦点落在苏晚的眼睛；暖色侧光勾出她的轮廓，浅景深，情绪压抑。"},
  {"type":"shot_add","id":"s-shot-3","name":"过肩·林舟","cameraId":"cam_c","duration":5,"aspectRatio":"16:9","shotSize":"close_up","prompt":"反打过肩近景，前景苏晚的肩部虚化，焦点在林舟脸上；冷色窗光从侧后方勾边，浅景深，克制的愤怒。"}
]
```
为什么这样写：
- 每台机都有两个节拍：先稳住，再在台词的关键处推近，而不是三台机都一推到底。
- 过肩镜头的推近从说话人开口前 0.2–0.3 秒开始，观众先看到反应，再看到台词。
- 多人对话照此扩展：每加一个人，在同一侧加一台过肩机位和一个镜头。

## 3. 顿悟：稳住的中景 → 眩晕变焦（意识到真相）

情境：图书馆书架之间，女主突然明白了什么。希区柯克《迷魂记》式变焦，16:9，6 秒。

| 秒 | 人物 | 机位 | 效果 |
| --- | --- | --- | --- |
| 0–1.6 | 四下张望 | 正面中景，盯住脸 | 平静 |
| 1.6–6 | 摇头，不敢相信 | 后退 3.5 米同时焦段从 50mm 推到约 105mm | 人物大小不变，身后的书架向她压过来 |

眩晕变焦必须有纵深很长的背景，否则看不出效果。这里用两排书架形成 12 米长的通道。

第 1 次补丁：
```json
[
  {"type":"shot_update","id":"s-shot-1","name":"顿悟","duration":6,"aspectRatio":"16:9","shotSize":"medium","prompt":"写实电影画面，16:9，昏暗的图书馆书架通道，顶光冷白，通道尽头一盏暖黄台灯；背景纵深很长，书架的透视线汇聚到人物身后；轻微胶片颗粒，心理惊悚片的紧张感。"},
  {"type":"object_array_add","id":"shelf_left","propId":"bookshelf","name":"左排书架","count":6,"pattern":"grid","columns":1,"spacing":2.2,"position":[-1.4,0,-7],"rotation":[0,1.5708,0]},
  {"type":"object_array_add","id":"shelf_right","propId":"bookshelf","name":"右排书架","count":6,"pattern":"grid","columns":1,"spacing":2.2,"position":[1.4,0,-7],"rotation":[0,-1.5708,0]},
  {"type":"light_update","id":"s-light-key","name":"顶光","position":[0,3.5,1],"color":"#e8f0ff","intensity":2},
  {"type":"light_update","id":"s-light-fill","name":"通道尽头台灯","position":[0,2.5,-12],"color":"#ffb070","intensity":1.2}
]
```
第 2 次补丁：人物面朝镜头（+Z），背对书架通道。
```json
[
  {"type":"object_add","id":"xu","kind":"actor","archetype":"woman","name":"许知意","position":[0,0,0],"rotation":[0,0,0],"color":"#d84949"},
  {"type":"actor_motion_add","id":"xu","motion":"look_around","time":0,"duration":1.4,"intensity":0.6},
  {"type":"actor_motion_add","id":"xu","motion":"shake_head","time":2.2,"duration":1.2,"intensity":0.4}
]
```
第 3 次补丁：
```json
[
  {"type":"camera_update","id":"s-camera-1","name":"眩晕机位","position":[0,1.55,3.2],"target":[0,1.55,0],"focalLength":50},
  {"type":"camera_move","id":"s-camera-1","technique":"look_at","subjectId":"xu","time":0,"duration":6,"params":{"aim":1.55}},
  {"type":"camera_move","id":"s-camera-1","technique":"dolly_zoom_out","subjectId":"xu","time":1.6,"duration":4.4,"easing":"smooth","params":{"distance":3.5,"aim":1.55}},
  {"type":"camera_move","id":"s-camera-1","technique":"handheld","time":0,"duration":6,"params":{"intensity":0.25}}
]
```
为什么这样写：变焦开始前先稳住 1.6 秒，观众先看清人物，变化才有冲击力。起始焦段 50mm、后退到原距离的两倍左右，焦段停在 300mm 以内。

## 4. 结尾抽离：近景 → 摇臂升起并环绕，拉成雨夜大远景

情境：雨夜路灯下，主角独自哭泣；镜头离开她，升到高空，她变成路灯下的一个小点。2.39:1，9 秒。

| 秒 | 人物 | 机位 | 景别 |
| --- | --- | --- | --- |
| 0–2.2 | 低头哭 | 正面，极慢推近 0.2 米 | 近景 |
| 2.2–9 | 哭完，茫然四顾 | 摇臂升高 14 米、后退 18 米，同时绕她转 35° | 近景 → 大远景 |

第 1 次补丁：雨夜外景。背景的路灯和楼房让升起时有层次。
```json
[
  {"type":"shot_update","id":"s-shot-1","name":"雨夜抽离","duration":9,"aspectRatio":"2.39:1","shotSize":"close_up","prompt":"写实电影画面，2.39:1，雨夜城市广场，路灯钠灯橙光在湿地面上拉出长长的倒影，雨丝在逆光中清晰可见；远处楼房窗户零星亮着；高对比、低饱和、偏青的夜色调色，胶片颗粒，孤独感。"},
  {"type":"world_update","id":"s","timeOfDay":21.5,"weather":"rain","ground":"city","horizon":true},
  {"type":"object_add","id":"plaza","kind":"prop","propId":"ground_patch","name":"广场地面","position":[0,0,0],"params":{"width":40,"depth":40,"surface":"plaza"}},
  {"type":"object_add","id":"lamp","kind":"prop","propId":"street_lamp","name":"她头顶的路灯","position":[1.3,0,-0.6],"rotation":[0,-1.5708,0]},
  {"type":"object_add","id":"bench","kind":"prop","propId":"bench","name":"长椅","position":[-1.6,0,0.6],"rotation":[0,0.6,0]},
  {"type":"object_array_add","id":"far_lamps","propId":"street_lamp","name":"远处路灯","count":4,"pattern":"line","spacing":12,"position":[0,0,-16]},
  {"type":"object_add","id":"block_a","kind":"prop","propId":"apartment","name":"公寓楼","position":[-16,0,-26]},
  {"type":"object_add","id":"block_b","kind":"prop","propId":"office_tower","name":"写字楼","position":[18,0,-36]}
]
```
第 2 次补丁：
```json
[
  {"type":"object_add","id":"xia","kind":"actor","archetype":"adult","name":"林夏","position":[0,0,0],"rotation":[0,0,0],"color":"#8b5cf6"},
  {"type":"actor_motion_add","id":"xia","motion":"cry","time":0.6,"duration":4.4,"intensity":0.7},
  {"type":"actor_motion_add","id":"xia","motion":"look_around","time":6,"duration":2.4,"intensity":0.3}
]
```
第 3 次补丁：摇臂升起和环绕同时开始、同时结束，两者叠加成一条上升的弧线。
```json
[
  {"type":"camera_update","id":"s-camera-1","name":"摇臂","position":[0.3,1.62,1.35],"target":[0,1.6,0],"focalLength":50},
  {"type":"camera_move","id":"s-camera-1","technique":"push_in","time":0,"duration":2,"params":{"distance":0.2}},
  {"type":"camera_move","id":"s-camera-1","technique":"crane_up","time":2.2,"duration":6.8,"easing":"smooth","params":{"height":14,"distance":18}},
  {"type":"camera_move","id":"s-camera-1","technique":"orbit_left","subjectId":"xia","time":2.2,"duration":6.8,"easing":"smooth","params":{"angle":35,"aim":1.6}},
  {"type":"camera_move","id":"s-camera-1","technique":"handheld","time":0,"duration":2.4,"params":{"intensity":0.25}}
]
```
为什么这样写：手持只放在开头的近景，升起后换成稳定的摇臂，画面从「贴着人物的情绪」变成「冷静旁观」。环绕的 `aim` 写脸部高度：宽银幕的竖直视角很窄，对着胸口升起时，脸会先出画。

## 5. 物到人的揭示：桌上的照片 → 上摇右移 → 窗前打电话的人转身

情境：深夜书房，镜头先停在桌上的照片，然后抬起、移向窗前背对镜头打电话的男人；他挂断电话，转过身来。16:9，6.5 秒。

| 秒 | 人物 | 机位 |
| --- | --- | --- |
| 0–1 | 背对镜头打电话 | 俯拍桌上的照片特写 |
| 1–4 | 继续打电话 | 上摇 22°、升高 0.45 米（从俯看桌面抬到站立平视），同时右移 0.9 米，把窗前的人带进画面 |
| 4.1–5.1 | 挂断，转身面向镜头 | 稳住 |
| 4.3–6.5 | 看向镜头方向 | 推近 0.9 米 |

第 1 次补丁：书房。照片不是目录道具，用一个很薄的方块代替（只用于目录里没有的小物件）。
```json
[
  {"type":"shot_update","id":"s-shot-1","name":"照片与背影","duration":6.5,"aspectRatio":"16:9","shotSize":"close_up","prompt":"写实电影画面，16:9，深夜书房，桌上台灯的暖橙光只照亮一张旧照片和桌面，窗外冷蓝色月光勾出窗前男人的剪影；大面积暗部，浅景深，从照片到人物的焦点转移；胶片颗粒，黑色电影的悬疑感。"},
  {"type":"object_add","id":"study","kind":"prop","propId":"room","name":"书房","position":[0,0,-0.5],"params":{"width":6,"depth":5,"height":3,"windows":2,"door":"none","front":"open"}},
  {"type":"object_add","id":"desk","kind":"prop","propId":"desk","name":"书桌","position":[-0.4,0,0.2]},
  {"type":"object_add","id":"chair","kind":"prop","propId":"chair","name":"椅子","position":[-0.4,0,0.85],"rotation":[0,3.1416,0]},
  {"type":"object_add","id":"photo","kind":"primitive","primitive":"box","name":"旧照片","position":[-0.3,0.78,0.25],"scale":[0.18,0.01,0.13],"color":"#e8e0d0"},
  {"type":"object_add","id":"study_shelf","kind":"prop","propId":"bookshelf","name":"书架","position":[-2.4,0,-2.7]},
  {"type":"light_update","id":"s-light-key","name":"窗外月光","position":[1,2.6,-4.5],"color":"#9fb7ff","intensity":1.6},
  {"type":"light_update","id":"s-light-fill","intensity":0.4},
  {"type":"light_update","id":"s-light-ambient","intensity":0.25},
  {"type":"light_add","id":"desk_lamp","name":"台灯","lightType":"point","position":[-0.8,1.1,0.1],"color":"#ffb36b","intensity":3}
]
```
第 2 次补丁：转身用两个关键帧写，`position` 必须与人物所在位置一致（不写会被重置到原位）。转身前后都是原地，`easing=smooth` 让转身先慢后快再慢。
```json
[
  {"type":"object_add","id":"zhou","kind":"actor","archetype":"man","name":"周行","position":[0.9,0,-2.2],"rotation":[0,3.1416,0],"color":"#2f7de1"},
  {"type":"actor_motion_add","id":"zhou","motion":"phone_call","time":0,"duration":4,"intensity":0.8},
  {"type":"object_keyframe_upsert","id":"zhou","time":4.1,"position":[0.9,0,-2.2],"rotation":[0,3.1416,0],"easing":"smooth"},
  {"type":"object_keyframe_upsert","id":"zhou","time":5.1,"position":[0.9,0,-2.2],"rotation":[0,-0.3,0]}
]
```
第 3 次补丁：
```json
[
  {"type":"camera_update","id":"s-camera-1","name":"揭示机位","position":[-0.3,1.05,0.95],"target":[-0.3,0.78,0.25],"focalLength":50},
  {"type":"camera_move","id":"s-camera-1","technique":"tilt_up","time":1,"duration":3,"params":{"angle":22}},
  {"type":"camera_move","id":"s-camera-1","technique":"pedestal_up","time":1,"duration":3,"params":{"distance":0.45}},
  {"type":"camera_move","id":"s-camera-1","technique":"truck_right","time":1.2,"duration":2.8,"params":{"distance":0.9}},
  {"type":"camera_move","id":"s-camera-1","technique":"push_in","time":4.3,"duration":2.2,"params":{"distance":0.9}}
]
```
为什么这样写：上摇和升高同时开始、右移晚 0.2 秒，画面先「抬眼」再「找人」；只上摇不升高，机位停在桌面高度，人物会顶到画面上沿。转身在推近开始前完成一半，推近落在他转过来的脸上。

## 6. 竖屏短剧：背影登场 → 绕到正面低机位仰拍亮相

情境：古装短剧女主穿过牌坊下的石板路走来，先拍背影，镜头绕到她正面并压低机位，最后半秒轻推焦定格亮相。9:16，7 秒。

| 秒 | 人物 | 机位 | 景别 |
| --- | --- | --- | --- |
| 0–6 | 沿石板路向前走 | 身后跟随 | 全景背影 |
| 2.1–7 | 走完、停步、环视 | 用 3.9 秒绕到正面，机位降到 0.95 米仰拍 | 中景 |
| 6.2–6.8 | 定格 | 焦段 35 → 50mm，收成近景 | 亮相 |

第 1 次补丁：
```json
[
  {"type":"shot_update","id":"s-shot-1","name":"女主亮相","duration":7,"aspectRatio":"9:16","shotSize":"full","prompt":"古装短剧竖屏 9:16，午后斜阳，暖金色逆光勾出人物轮廓与发丝，石板路反光；两侧灯笼与远处牌坊虚化成层次；服饰丝绸质感真实，妆造精致，电影级调色，浅景深，女主气场强大。"},
  {"type":"world_update","id":"s","timeOfDay":16.5,"weather":"clear","ground":"warm","horizon":true},
  {"type":"object_add","id":"stone_road","kind":"prop","propId":"ground_patch","name":"石板路","position":[0,0,4],"params":{"width":8,"depth":24,"surface":"stone"}},
  {"type":"object_add","id":"gate","kind":"prop","propId":"paifang","name":"牌坊","position":[0,0,12]},
  {"type":"object_array_add","id":"lanterns_left","propId":"lantern_pole","name":"左侧灯笼","count":4,"pattern":"grid","columns":1,"spacing":3,"position":[2.4,0,4],"rotation":[0,-1.5708,0]},
  {"type":"object_array_add","id":"lanterns_right","propId":"lantern_pole","name":"右侧灯笼","count":4,"pattern":"grid","columns":1,"spacing":3,"position":[-2.4,0,4],"rotation":[0,1.5708,0]}
]
```
第 2 次补丁：
```json
[
  {"type":"object_add","id":"shen","kind":"actor","archetype":"woman","name":"沈清辞","position":[0,0,0],"rotation":[0,0,0],"color":"#d84949"},
  {"type":"actor_travel","id":"shen","travelStyle":"walk","time":0,"duration":5.4,"pathPoints":[[0,0,0],[0,0,6]]},
  {"type":"actor_motion_add","id":"shen","motion":"look_around","time":5.4,"duration":1.6,"intensity":0.4}
]
```
第 3 次补丁：结构与配方 `hero_reveal` 相同（身后全景跟随 → 绕到正面低机位），但逐段写，正面一段用中景。
```json
[
  {"type":"camera_update","id":"s-camera-1","name":"亮相机位","focalLength":35},
  {"type":"camera_move","id":"s-camera-1","technique":"follow","subjectId":"shen","time":0,"duration":6,"params":{"side":"behind","shotSize":"full","lag":0.15}},
  {"type":"camera_move","id":"s-camera-1","technique":"follow","subjectId":"shen","time":2.1,"duration":4.9,"params":{"side":"front","shotSize":"medium","height":0.95,"lag":0.15,"blend":3.9}},
  {"type":"camera_move","id":"s-camera-1","technique":"zoom_in","time":6.2,"duration":0.6,"easing":"linear","params":{"focalLength":50}},
  {"type":"camera_move","id":"s-camera-1","technique":"handheld","time":0,"duration":6,"params":{"intensity":0.25}}
]
```
为什么这样写：竖屏的取景以画面宽度为准，同一景别的机位比横屏近得多；`shotSize` 会按 9:16 自动算，不要自己写 `distance`。竖屏近景只有 0.6–0.8 米，机位压到 0.95 米时仰角会超过 40°，所以低机位配中景，再用最后半秒的推焦收成近景定格。横屏（16:9、2.39:1）可以直接用 `recipe` `hero_reveal`。
