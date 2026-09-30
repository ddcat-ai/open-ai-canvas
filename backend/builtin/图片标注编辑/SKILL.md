---
name: "图片标注编辑"
description: "通过编号标注图片中的多个位置，再按标注生成编辑结果。"
metadata:
  version: "1.0.0"
  author: "影策"
  owner: "yingce-system"
  skillId: "yingce-image-annotation"
  tag: creative
  sortWeight: 890
  source: 3
  createdAt: 1789700000000
  updatedAt: 1789700000000
  initialLikeCount: 0
  initialAddedCount: 0
---

# 图片标注编辑

1. 先读取源图片，不要凭空猜测坐标或目标区域。
2. 使用画布已有标注编辑入口，让用户放置编号点并为每个点填写修改说明；未确认前不要生成。
3. 生成时只使用用户确认的点位和文字。prompt 应列出 Point 1、Point 2 等顺序要求，并明确标注图仅用于定位，最终结果不能保留编号、圆点或辅助线。
4. 原图必须作为第一张 referenceNode，标注预览图作为第二张 guide reference；调用 generate_media 并走现有审批。
5. 成功后创建新图片节点并连回源图；保留原图和用户标注，不覆盖历史结果。
