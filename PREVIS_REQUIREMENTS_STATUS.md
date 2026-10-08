# 预演台功能需求实现状态

## 已完成 ✅

### 需求1：统一预演台选择模型后添加参数调整面板
**文件**: `web/src/components/canvas/previs/canvas-previs-workbench.tsx` (行 977-1014)

**实现内容**:
- 添加"体型参数"面板，包含5个可调整参数：
  - 身高 (0.5-1.5)
  - 头身比 (0.5-1.5)
  - 肩宽 (0.5-1.5)
  - 躯干比例 (0.5-1.5)
  - 配件轮廓 (无/拐杖/角/王冠)
- 所有参数使用 `actorProfile` 字段持久化
- 保持原有姿势微调功能

**类型安全**: 已添加 `PrevisActorProfile` 和 `previsActorProfileForArchetype` 导入

---

### 需求6：统一预演台添加环境背景和资产功能
**文件**: `web/src/components/canvas/previs/canvas-previs-workbench.tsx` (行 1059-1088)

**实现内容**:
- 在右侧输出面板添加步骤3"画布资产与环境"
- 显示画布中的图片资产列表（最多3个，超过显示提示）
- 每个资产可以：
  - 设置为 360° 全景背景
  - 快速加入场景作为参考背板
  - 显示绑定状态（✓已加入 / 360°背景）
- 显示当前 360° 背景状态，支持一键移除
- 在步骤4中显示生成提示词预览（自动引用资产和环境）

**提示词编译**: `previs-prompt-compiler.ts` 已支持自动引用资产和360°背景

---

## 待实现 🔄

### 需求2：角色库添加 archetype 持久化和本地上传
**状态**: 进行中
**涉及文件**: 
- `web/src/components/canvas/canvas-character-library-modal.tsx`
- `web/src/services/api/projects.ts`

**需要实现**:
1. 在角色卡列表中显示 archetype 信息（类似图1的libtv）
2. 支持创建角色时设置 archetype
3. 添加本地上传图片创建角色的入口（参考图1）
4. 在角色详情中显示和编辑 archetype

**技术方案**:
- `ProjectAsset.character.definition` 可存储 archetype
- `createCharacter` API 已支持 `definition` 参数
- 需要在 UI 中添加 archetype 选择器

---

### 需求3：添加镜头时支持黄色自由拖动和视角切换
**状态**: 待开始
**涉及文件**:
- `web/src/components/canvas/previs/previs-viewport.tsx`
- `web/src/components/canvas/previs/canvas-previs-workbench.tsx`

**需要实现**:
1. 添加镜头时，对象显示黄色高亮（参考图2-5）
2. 黄色状态下可以自由拖动位置
3. 3D预演台画布支持切换：
   - 导演视角（自由3D视图）
   - 机位视角（摄影机POV）
4. 视角切换器在画布中可见（参考图3-4）

**技术方案**:
- `viewMode` 已有 "free" 和 "camera" 模式
- 需要在视口中添加选中状态的黄色高亮材质
- 旧分裂工作台已有视角切换，需要在快速模式中也显示

---

### 需求4：预演台卡片缩略图后台生成优化
**状态**: 待开始
**涉及文件**:
- `web/src/components/canvas/previs/canvas-previs-node-panel.tsx`
- `web/src/components/canvas/previs/previs-mini-viewport.tsx`

**当前问题**:
- 画布上的预演台卡片实时渲染 `PrevisMiniViewport`
- 每个卡片都会创建一个 Three.js 场景，影响画布性能
- 当有多个预演台节点时，性能明显下降

**需要实现**:
1. 关闭预演台时，后台生成一张缩略图
2. 将缩略图保存到 `node.metadata.previsPreviewNodeId` 引用的图片节点
3. 画布卡片直接显示缩略图，不再实时渲染3D
4. 只在预览图不存在时才fallback到 `PrevisMiniViewport`

**技术方案**:
```typescript
// 在关闭预演台时：
const blob = await viewportRef.current?.capture("clay");
// 上传blob并创建/更新preview图片节点
// 更新 node.metadata.previsPreviewNodeId
```

---

### 需求5：修复预演台选择模型后空白Bug
**状态**: 待诊断
**涉及文件**:
- `web/src/components/canvas/previs/canvas-previs-workbench.tsx`
- `web/src/components/canvas/previs/previs-inspectors.tsx`

**问题描述**（参考图6-7）:
- 有时候选择模型后，界面后面显示空白
- 但数据实际存在（图7显示数据结构正常）
- 可能是UI渲染问题，而非数据问题

**可能原因**:
1. 旧分裂工作台模式下，右侧检查器面板滚动问题
2. 内容溢出但没有滚动条
3. 动态加载的内容高度计算错误
4. CSS `overflow` 或 `min-height` 设置不当

**需要检查**:
- `.previs-desk-inspector` 的滚动容器
- `.previs-desk-inspector-content` 的内容高度
- 模型选择后动态插入的UI是否正确渲染
- 是否有条件渲染导致内容被隐藏

**调试步骤**:
1. 添加日志确认数据是否正确加载
2. 检查CSS是否导致内容被裁剪
3. 验证滚动容器的高度和overflow设置
4. 测试不同模型时的表现

---

## 技术债务

### 类型安全
- ✅ 已修复：导入 `PrevisActorProfile` 类型
- ✅ 已修复：导入 `previsActorProfileForArchetype` 函数

### 性能优化
- 🔄 待实现：预演台缩略图后台生成（需求4）
- 🔄 考虑：限制画布上同时渲染的 `PrevisMiniViewport` 数量

### 用户体验
- 🔄 待实现：黄色拖动状态提供更直观的反馈（需求3）
- 🔄 待实现：视角切换在快速模式中也可用（需求3）

---

## 测试建议

### 需求1测试
- [x] 选择演员后，体型参数面板显示
- [x] 调整每个参数，模型实时更新
- [x] 参数保存并在重新打开时恢复
- [x] 类型检查通过

### 需求6测试
- [x] 画布有图片时，资产列表显示
- [x] 点击"360°"按钮，设置全景背景
- [x] 点击"加入"按钮，添加到场景
- [x] 生成提示词包含资产引用
- [x] 移除背景功能正常

### 待测试（需求2-5）
- [ ] 角色库显示archetype信息
- [ ] 本地上传创建角色
- [ ] 添加镜头时对象黄色高亮
- [ ] 视角切换正常工作
- [ ] 缩略图后台生成
- [ ] 选择模型后界面不再空白

---

## 下一步行动

1. **优先级1**（影响用户体验）:
   - 修复需求5（选择模型空白Bug）
   - 实现需求4（缩略图优化）

2. **优先级2**（功能完善）:
   - 实现需求3（黄色拖动和视角切换）
   - 实现需求2（角色库archetype）

3. **代码审查**:
   - 确保所有新增代码符合项目规范
   - 检查是否有潜在的性能问题
   - 验证类型安全

4. **文档更新**:
   - 更新用户手册
   - 添加功能演示视频
   - 记录已知问题和解决方案
