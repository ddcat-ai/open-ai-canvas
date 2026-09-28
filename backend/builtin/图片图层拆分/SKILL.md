---
name: "图片图层拆分"
description: "按用户指定的主体或区域拆分图片图层，并把结果回写到画布。"
metadata:
  version: "1.0.0"
  author: "影策"
  owner: "yingce-system"
  skillId: "yingce-image-layer-split"
  tag: creative
  sortWeight: 880
  source: 3
  createdAt: 1789700000000
  updatedAt: 1789700000000
  initialLikeCount: 0
  initialAddedCount: 0
---

# 图片图层拆分

1. 先用 canvas_get_state 读取源图片。用户没有提供拆分对象时，使用 ask_user 让用户选择框选区域或文字描述，不要自行猜测。
2. 框选确认后，检查原图和带框预览，逐项用自然语言命名要提取的对象；不要把坐标写进 prompt，也不要把带框预览当成最终图。
3. 调用 generate_media，mode=image，原图作为第一张 referenceNode，prompt 说明需要独立输出的图层及“保持外观、只提取指定对象、透明背景”。使用已配置的图层拆分模型或用户指定模型。
4. 每个成功输出都创建独立图片节点，按拆分顺序排列并连回源图；源图保持不变。部分失败时保留成功图层并明确报告失败项。
5. 生成、下载、持久化和审批全部复用宿主现有链路，不直接访问第三方 API。
