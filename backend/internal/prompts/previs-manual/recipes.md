# 多场景范例

每个范例都只列关键操作。开始前先读场景和行为规范；坐标需要按实际场景调整。

## 1. 双人对话（正反打）
1. 两人间距 1.4 米，彼此面对（见 `manual=actors`）。
2. 摄影机 1 放在男主肩后（过肩），target 放在女主脸部，用于镜头 1；摄影机 2 在轴线同侧对称放在女主肩后，用于镜头 2。
3. 镜头 1 加 `push_in` 5 秒、distance 0.6，营造情绪；说话人加 `actor_motion_add talk`。

## 2. 街头追逐
1. 布景用 modern_street 或 ancient_street。
2. 逃跑者：`object_motion_path_set` 走 4–6 个点绕过障碍，`easing=ease_in`，速度约 5 米/秒。
3. 追逐者：用同一条路线，`pathId=<逃跑者id>`，`startDelay` 晚 0.6 秒。
4. 镜头：`follow side=left distance=6` 做侧面平移跟拍，叠加 `handheld intensity=1.2`。

## 3. 御剑飞行
1. `actor_travel travelStyle=sword_fly height=3 duration=4`，或者用带高度的路径做弯曲飞行。
2. 镜头：`follow side=behind distance=6 lag=0.35`；后半段叠加 `orbit_left angle=120`（配方「御剑跟拍」）。
3. 外景可加 `world_update weather=cloudy`、`horizon=true`，营造开阔感。

## 4. 开场航拍揭示城市
1. 布景用 ancient_city 或 modern_city，size 400 以上。
2. 摄影机初始放低（2 米）、靠近主角；`crane_up height=15 distance=20 duration=6 easing=smooth`。
3. 主角可以加 `actor_motion_add look_around`。

## 5. 揭示（从物到人）
1. 摄影机先对准道具特写（target 放在道具上，focal 50）。
2. `truck_right distance=1.5` 加 `pan_right angle=25`，把人物带进画面。

## 6. 打斗
1. 两人距离 0.8 米，`actor_motion_add punch / slap / hit_react` 交替，时间互相错开。
2. 镜头 `orbit_right angle=60`，配 `shake` 0.5 秒落在击中的那一刻。

## 7. 用户画好运镜轨迹，让人物沿着走、镜头跟随
见 `manual=paths` 的方式 A。先读 `cameras[].motionPath` 确认这条轨迹存在，审批前告诉用户：「人物将沿你画的轨迹走，镜头晚 0.8 秒沿同一轨迹跟在后面，并始终对着人物」。

## 8. 用户说「按路径1 飞过去」
1. `scene.paths` 里找到「路径1」，报出长度和最高离地高度。
2. `object_motion_path_set id=<人物> pathId=路径1`。用户给了高度就写 `height`；没给且轨迹贴地时，问用户要飞多高。
3. 需要跟拍时再加 `camera_move follow`。
