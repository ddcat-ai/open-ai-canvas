---
name: tvd-finding-stories-filter
description: "当需要手里有一堆点子（某社会热点、某亲戚糗事、某经典计谋），不确定哪个贴剧、哪个是\"借用设定的独立电影\"。；担心某集变成\"主题时调用。核心能力：选故事四准则过滤器。关键触发：借用设定的独立电影、主题先行、这集要讲敬老、帮我筛一下这些集数点子，哪些值得拍。"
tags: ["story-selection", "episode-ideas", "series-engine"]
metadata:
  source_book: "《Writing the TV Drama Series, 3rd Edition》 Pamela Douglas"
  attribution: "Methodological framework re-derived and rewritten by the Judian project from published-book methodology notes; inspired by the cited books, no original expression reproduced."
  source_card: "story-recipes\\06-分集大纲与叙事脉络（系列化）\\Writing the TV Drama Series 3rd Edition\\tvd-finding-stories-filter\\SKILL.md"
evidence: E4

---
## I — 方法论骨架 (Interpretation)

筛选任一集/单元故事 idea，用四重过滤，且故事必须由常驻角色驱动：

1. **契合媒介**：这个点子是否适合"电视"这个亲密、家庭、连续的媒介尺度？还是更适合电影/小说？
2. **补足具体剧**：它是否贴合本剧的调性、world 和已建立的 springboard（换部剧也能成立的=失败）？
3. **能在屏幕上发生**：冲突是否外部化为可见的动作与对峙，而非停留在心理/议题层面？
4. **表达独特经验或新鲜洞察**：它是否承载了你真实了解的生活质感或新鲜角度，而非公式填空？

底线约束：故事的转折点必须由**常驻角色**承担——"换掉主演这集也成立"即判失败。核心是**从故事出发，主题与角色自然浮现**，而不是倒果为因。

---

## A1 — 书中的应用 (Past Application)

### 案例 1: Ghostwriter（PBS）——强壮 franchise + 真实角色托起教育使命
- **问题**: Pamela Douglas 作为 developer 要从零搭一部"鼓励 8 岁孩子阅读"的系列，看似主题先行、天然说教。
- **方法论的使用**: 她先确认 franchise（神秘信使引导少年破案）足够强壮能承载教育使命，再让故事从具体案件与真实角色关系出发，而非从"要教阅读"出发。
- **结论**: 主题（阅读）从 kids 追神秘信使的张力里自然浮现，而非被硬塞。
- **结果**: 受众意外从 4 岁扩展到 16 岁，证明"四准则通过"的点子能高张力推进，哪怕带教育任务。

### 案例 2: Paradise（西部剧）——研究注入真实，让 guest 改写活起来
- **问题**: 作者 freelance 接手一份"guest cast 立不住"的完成稿。
- **方法论的使用**: 她用对 1900s 西北的历史研究带来贴合该剧世界的真实碎片，使改写通过"独特经验/真实质感"这一关，而非套模板。
- **结论**: 真实研究让故事"呼吸"，客人公也因落在具体世界质感里可信。
- **结果**: 制作人因她懂该剧世界而把改写交予她，印证"真实经验"是选故事过滤器中最难替代的一关。

---

## A2 — 触发场景 (Future Trigger) ★

### 用户会在什么情境下需要这个 skill?

2. 手里有一堆点子（某社会热点、某亲戚糗事、某经典计谋），不确定哪个贴剧、哪个是"借用设定的独立电影"。
3. 担心某集变成"主题先行"的说教（如"这集要讲敬老"），或把危机推给客座角色而非一家承担。

### 语言信号 (用户的话里出现这些就应激活)

- "帮我筛一下这些集数点子，哪些值得拍"
- "这个计谋/事件能不能做成一集？"
- "我这一集想讲'亲情/敬老/反诈'，这样行吗"
- "finding stories / 选题表 / story filter / 点子评估"

### 与相邻 skill 的区分

- 与 `tvd-season-arc-planning` 的区别：season-arc-planning 管整季首尾与情感旅程；本 skill 只管"单个故事 idea 是否合格"，不规划集间顺序。

---

## E — 可执行步骤 (Execution)

当 skill 被激活后，agent 应按以下步骤执行:

1. **列出待评估点子 + 标注其戏剧引擎归属**
   - 完成标准: 每个点子明确"谁承担转折点"——若主语是客座/事件而非/常驻家人，打上 ce01 风险标记。

2. **逐条过四关过滤**
   - 完成标准: 对每个点子输出四关 {媒介契合 / 贴剧 / 可视觉化 / 真实洞察} 的通过/失败判定与一句理由；任一硬失败即筛除。
   - 判停条件: 若"主题先行"明显（首句是"这集想讲 X"），先退回"从故事出发"再评估，否则直接判失败。

3. **产出 选题筛子表**

---

## B — 边界 (Boundary) ★

### 不要在以下情况使用此 skill

- 用户要的是"整季 怎么排布/首尾怎么定"——那属于 tvd-season-arc-planning。
- 用户要的是"这个题材 franchise 边界与续航力判断"——那属于 tvd-franchise-springboards。
- 用户已锁定一个故事、只问"这一集分几幕、钩子在哪"——那属于 tvd-grid-reverse-engineering / tvd-outline-color-cards。

### 作者在书中警告的失败模式

- **ce01 客座角色驱动**：最常见的错——把引擎放在 guest 身上，常驻角色退为旁观者；"换部剧名这集也成立"即判失败。
- **ce02 主题先行**：先定议题再硬塞情节，主题变成说教、张力抽空；应"讲好故事，主题自然浮现"。
- **ce15 生活复印机（Xerox of life）**：没真实阅历却硬写，人物像二手生活的复印，缺可信颗粒度。

### 作者的盲点 / 时代局限
### 容易混淆的邻近方法论

- `tvd-franchise-springboards`（最易混，见 A2）；`tvd-season-arc-planning`。

---

## 相关 skills (阶段 3 填充)

- depends-on:
  - `tvd-season-bible` — 贴剧判定需对照 bible 的 franchise/springboards。
  - `tvd-episodic-characterization` — 故事必须由常驻角色驱动（换主演也成立即失败），过滤以角色为前提。
- contrasts-with:
  - `tvd-franchise-springboards` — franchise 回答"边界/引擎/legs（能不能长）"，本 skill 是更本书衍生的单个点子四关评估，易混。
- composes-with:
  - `tvd-outline-color-cards` — 通过筛选的点子进入 outline 写分集大纲。
  - `tvd-episode-quality-checklist` — 写完后用质检清单验收。

---
