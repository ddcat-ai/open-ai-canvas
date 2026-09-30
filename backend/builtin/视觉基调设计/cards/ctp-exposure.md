---
name: ctp-exposure
description: "当用户说\"曝光怎么定\"、\"宽容度/动态范围是什么\"、\"为什么曝光向右\"时调用。关键触发：曝光怎么定、宽容度/动态范围是什么、为什么曝光向右、18%灰。"
tags: ["exposure", "latitude", "dynamic-range", "18-gray", "log", "gamma", "tone", "expose-to-the-right"]
metadata:
  source_book: "Cinematography: Theory and Practice (Blain Brown, 4th ed.)"
  attribution: "Methodological framework re-derived and rewritten by the Judian project from published-book methodology notes; inspired by the cited books, no original expression reproduced."
  source_card: "story-recipes\\05-视觉风格与影像基调\\Cinematography Theory and Practice\\ctp-exposure\\SKILL.md"
evidence: E4

---
## I — 方法论骨架 (Interpretation)

1. **曝光是捕获级概念**：它决定"传感器收到了多少光"，目标是全灰阶准确重现。
2. **宽容度/动态范围**：介质能容纳的亮度跨度有限；场景 DR 常 > 捕获 DR → 必须决定"把曝光放在哪"。
3. **曝光向右**：在 raw/线性里欠曝的信息不可挽回，把曝光推向上限（不溢出）更安全。
4. **18% 灰**：标准中间调，测光表以此归一，是定曝光的锚点。
5. **编码**：胶片有趾部/肩部（S 曲线）压缩两极；视频 gamma(Rec.709)是显示参照的幂曲线；log 编码把每档亮度做成感知等距，给后期调色留空间。

---

## A1 — 书中的应用 (Past Application)

### 案例：夜外窗景
- 窗外天亮、窗内脸暗，亮度差可能超 15 stops；直接拍要么脸黑要么窗白。
- 解法：用 ND 把窗外压下来、或用灯把脸提上去，把整体亮度差塞进相机宽容度；或接受剪影走低调。
- 结论："曝光"的本质是**在有限 DR 里做取舍放置**，不是单纯"亮/暗"。

---

## A2 — 触发场景 (Future Trigger) ★

### 语言信号
- "曝光怎么定" / "宽容度/动态范围是什么" / "为什么曝光向右" / "18%灰" / "log 和 gamma 区别" / "S曲线"

### 与相邻 skill 的区分
- 与 `ctp-tone-contrast`：本卡管"捕获多少光/DR 取舍"，tone-contrast 管"影调反差外观"。
- 与 `ctp-lens`：本卡管曝光，lens 管景深/透视，二者协作但不同层。

---

## E — 可执行步骤 (Execution)

1. **测场景 DR**：估算最亮与最暗的差（stops）。
2. **定中间调**：以 18% 灰为锚，先对准主体关键中间调。
3. **定剪裁优先级**：保高光还是保暗部？按需决定（raw 偏向右）。
4. **选编码**：要调色空间 → log；直出 → 相应 gamma。
5. **复查**：用直方图/波形确认未溢出关键区域。

---

## B — 边界 (Boundary) ★

- **曝光 ≠ 影调外观**：亮不亮是曝光，黑脸白脸对比是 tone/contrast 层。
- **非越亮越好**：曝光向右是捕获策略，不是审美。
- **Tier B**：只抽"曝光/DR/log/gamma 机制"；不照搬书中图表与长段。

---

## 相关 skills

- depends-on: {{}}
- composes-with: ctp-tone-contrast / ctp-lens / ctp-lighting
- contrasts-with: {{}}

---
