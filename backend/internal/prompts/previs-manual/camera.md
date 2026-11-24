# 机位与景别

## 摄影机
- 新增：`camera_add position target focalLength name`；修改：`camera_update`（改 `focalLength` 时取景会同步）。
- 画面看向 `target`。改机位时同时改 `target`，否则镜头仍然对着原来的焦点。
- 一个镜头只用一台摄影机：`shot_update cameraId`。正反打用两台摄影机、两个镜头；多个镜头共用同一条时间线，每个镜头都从 0 秒播放同一段表演（完整写法见 `manual=recipes` 第 2 节）。
- 画幅：`shot_update aspectRatio`（auto / 2.39:1 / 21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16），读取结果的 `shots[].aspectRatio` 是当前画幅，未设置按 9:16。用户已选的画幅不要改。宽银幕的竖直视角很窄，人物的脸更容易出画，`aim` 要写到脸部高度。

## 景别对照（成人 1.8 米，35mm 焦段，竖屏 9:16 的大致距离）
| 景别 shotSize | 机位到人物距离 | target 高度 |
| --- | --- | --- |
| extreme_wide 大远景 | 25 米以上，或者升高机位 | 0.9 |
| wide 远景 | 8–12 米 | 1.0 |
| full 全身 | 4–5 米 | 0.95 |
| medium 中景 | 2.2–2.8 米 | 1.3 |
| close_up 近景 | 1.0–1.4 米 | 1.6 |
| extreme_close_up 大特写 | 0.5–0.7 米，或 85mm 以上 | 1.65 |
焦段越长，同一景别的距离越远：50mm 约为 35mm 时的 1.4 倍，85mm 约为 2.4 倍。

## 机位高度
- 平视：机位高 1.5–1.7 米，target 高 1.5 左右。
- 仰拍（显得强大）：机位 0.4–0.8 米，target 高于机位。
- 俯拍（显得渺小）：机位比人物头顶高 2 米以上，target 在胸口。
- 荷兰角：`camera_move technique=roll angle=10~25`。

## 构图
- 主体放在三分线上，视线方向留出空间。
- 两人对话的过肩镜头：摄影机放在一人身后 0.8–1.2 米、偏向一侧 0.4 米，target 放在另一人脸部。
- 写完后用 `previs_preview` 看一眼。读坐标不等于看画面。
