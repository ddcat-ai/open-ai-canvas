# 分镜节点白盒输入口改造

## 已确认偏好

- **五槽**输入（全可选，不强制先接线才能用节点）
- 下游默认：**角色必送**；**背景 / 画风默认可送、可关**；**正文不送**下游图视频

---

## 问题诊断

当前分镜脚本节点输入是**单口混装**：

| 现状 | 后果 |
|---|---|
| 左侧只有一个 `storyboard:context` | 角色 / 正文 / 场景 / 画风 / 参考图全塞同一入口 |
| `getContextResourceNodes` 只按 `toNodeId` 收集，不区分 handle | 连到哪都当「上下文」 |
| `resolveStoryboardGenerationContext` 扫整张画布找 styleboard / character | 没连线也可能被吃；连了也可能重复 |
| 下游动作板 / 图 / 视频靠 `referenceNodeIds` + 启发式 | 谁进最终请求不可控、不可见 |

目标：**输入分槽、用途分阶段、白盒可控。**

---

## 目标语义

### 五个输入槽（脚本节点左侧，composer 区竖排）

| Handle ID | 显示名 | 建议接入 | 自动分镜 plan | 12 宫格 / 首帧 / 视频 |
|---|---|---|---|---|
| `storyboard:story` | 正文 | Text / story_input / Skill | ✅ 进剧情变量 | ❌ 默认不送 |
| `storyboard:characters` | 角色 | character 卡（多条） | ✅ 有则用 | ✅ **必送**（卡正文 + 三视图） |
| `storyboard:background` | 背景/场景 | 场景文、场景图、scene | ✅ 有则用 | ⚙️ **默认开，可关** |
| `storyboard:style` | 画风 | styleboard | ✅ 有则用（完整自动分镜时建议有） | ⚙️ **默认开，可关** |
| `storyboard:props` | 道具/参考 | 道具图、局部参考图、其它图 | ✅ 有则作 canvas 资产 | ✅ **默认开，可关**（与行级额外参考合并） |

**全可选含义：**

- 五槽都可以空，节点仍可编辑、手写 brief、手填分镜表
- **不**因为缺线就禁止打开节点
- 点「自动分镜」时：缺画风 → **明确报错/引导连到画风口**（比静默扫全画布白盒）；缺角色 → 允许空角色数组或警告（与现网校验对齐，实现时保持「有 style 即可 plan」若现网允许空角色）
- 不再主路径扫描整画布；没连 = 没用上

### 行级 handle（保留）

- 行左 `row:{id}`：该镜**额外**参考（覆盖/补充 props）
- 行右 `row:{id}`：该镜出图 / 出视频出口

### 策略 metadata（每脚本节点可覆写）

```ts
storyboardInputPolicy?: {
  backgroundToActionBoard?: boolean; // default true
  backgroundToImage?: boolean;       // default true
  backgroundToVideo?: boolean;       // default true
  styleToActionBoard?: boolean;      // default true
  styleToImage?: boolean;            // default true
  styleToVideo?: boolean;            // default true
  propsToActionBoard?: boolean;      // default true
  propsToImage?: boolean;            // default true
  propsToVideo?: boolean;            // default true
  // story 下游固定 false（本轮不提供打开，避免正文污染图视频）
  // characters 下游固定 true
}
```

UI：发送前预览 / 简条显示「本阶段将送入：…」，背景/画风/道具可勾选。

---

## 方案

### 1. Handle 协议

- 五常量：`storyboard:story|characters|background|style|props`
- 兼容旧 `storyboard:context` / 空 handle → 迁移（见下）
- 连接落点写入 `toHandleId`
- 连接时按 source **建议**目标槽（可改接）：
  - character → characters
  - styleboard → style
  - story_input / 长文本 → story
  - 含「场景/背景」标题的文本或 scene → background
  - 普通 image/drawing → props（或 background 若 workflow 是 scene）

### 2. 收集 API（替换一锅端）

新建 `web/src/lib/canvas/storyboard-input-slots.ts`：

```ts
collectStoryboardInputSlots(scriptNodeId, nodes, connections): {
  story, characters, background, style, props, legacyContext
}
```

- 只认入边 + 五槽 handle
- `resolveStoryboardGenerationContext` 改为 **slots 优先**（style/characters 来自槽，不再扫全画布）
- mention / canvasAssets 按槽组装

### 3. 自动分镜

- brief：composer + story 槽展开
- characters / projectStyle / 背景资产：来自对应槽
- 预览弹层增加「输入槽摘要 + 下游将送」

### 4. 下游 ref

重写 `storyboardRowReferenceNodeIds` → `resolveStoryboardDownstreamRefs(stage, …)`：

- characters：恒有
- story：恒无
- background / style / props：按 policy
- 行级入边：恒有

`createScriptActionBoards`、分镜图/视频创建统一走此函数。

### 5. UI

Composer 左缘五口竖排小标签：

```
正文 ○
角色 ○
背景 ○
画风 ○
道具 ○
```

- tooltip：阶段用途
- simple 模式可折叠为「角色 / 画风 / 正文」三口 +「更多」展开背景/道具（实现时若太挤再做；默认五口都显示）

### 6. 旧数据迁移

| 旧连接 | 新槽 |
|---|---|
| context + character | characters |
| context + styleboard | style |
| context + story_input / 章节文 | story |
| context + image/drawing | props（scene 图 → background） |
| 无法判断 | legacyContext + 黄条「请拖到正确输入口」 |

加载脚本节点时写回 `toHandleId`。

### 7. 测试与部署

- unit：分槽收集、迁移、下游矩阵（story 不进动作板、character 进）
- 回归：action-board / plan preview
- **web 必发**；backend 无硬依赖（仍收 JSON characters/style）

---

## 非目标

- 不重做 Config 通用引用模型
- 不改视频厂商协议
- 不强制用户重连（靠迁移）
- 本轮不把「正文送下游」做成开关

---

## 主要文件

| 文件 | 改动 |
|---|---|
| `web/src/types/canvas.ts` | handle / policy 类型 |
| `web/src/lib/canvas/storyboard-input-slots.ts` | **新建** |
| `web/src/lib/canvas/canvas-storyboard-context.ts` | slots 优先 |
| `web/src/lib/canvas/canvas-project-domain.ts` | handle 几何 / attach / 兼容 |
| `web/src/lib/canvas/canvas-resource-references.ts` | 按槽 mention |
| `web/src/components/canvas/canvas-script-node.tsx` | 五口 UI + 策略摘要 |
| `web/src/pages/canvas/use-canvas-storyboard.ts` | plan / 下游 ref |
| `web/src/pages/canvas/use-canvas-connection-controller.ts` | 落点与建议槽 |
| `web/src/components/canvas/canvas-connections.tsx` | 锚点 Y |
| `web/test/*` | 单测 |

---

## 实施步骤

1. 协议 + `collectStoryboardInputSlots` + 迁移 + 单测  
2. 五输入口 UI + 连接写入 handle  
3. plan / preview 改读 slots  
4. 下游 ref 矩阵 + policy 默认  
5. 旧画布打开验证 + 手动 plan / 12 宫格看发送清单  
6. web 部署（可与 backend 同发）

---

## 风险

| 风险 | 缓解 |
|---|---|
| 五口偏挤 | 固定小标签 + 间距；必要时 simple 折叠 |
| 迁移误分 | 保守进 legacy + 黄条 |
| 去掉全局扫描后「画布有画风但没连」失败 | 明确文案：请连到画风口——符合白盒 |
