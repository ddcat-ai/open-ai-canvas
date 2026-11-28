---
name: freestyle-style-library-migration
description: "旧技能「Freestyle 风格库」的兼容索引；把模板匹配、六块组装、风格模板跑偏和常见工件直达视觉提示词工程包内的现有卡片。"
tags: [Freestyle风格库, 风格模板, 六块组装, 提示词积木, 模板匹配]
evidence: E4
source: "原 freestyle-风格库 (16000000000089)，作者：剧典技能库（itsWyatt-K）"
---

# 「Freestyle 风格库」旧名直达

旧技能 `Freestyle 风格库`（`16000000000089`）已并入 `视觉提示词工程`。旧风格模板与避坑方法仍在现有卡中按需读取。

## 按出图问题读卡

| 当前问题 | 直接读 |
|---|---|
| 不知道选哪个风格模板 | `cards/freestyle-template-match.md` |
| 提示词缺块，模型开始自由发挥 | `cards/freestyle-prompt-blocks.md` |
| 模块过密、文字不可读、画面像模板套壳 | `cards/freestyle-pitfalls.md` |
| 图片要稳定资产外观或质感 | `cards/flux-asset-image.md` |
| 画面油腻、塑料感重 | `cards/vis-image-5slot-deslop.md` |

## 迁移约定

- 先判断是“选模板、补提示词结构、排查翻车”中的哪一项，再读对应卡。
- 旧名和旧 ID 由动态检索直达本卡；未提旧名时走 `视觉提示词工程` 的普通入口。
- 各方法卡的来源与许可保留在卡内 frontmatter；本兼容索引自撰，MIT。
