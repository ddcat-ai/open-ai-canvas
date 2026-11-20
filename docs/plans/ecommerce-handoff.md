# 电商创作工作台改造 - 交接文档

**生成时间**: 2026-11-04 09:41  
**当前状态**: 部分完成，需要继续落地

---

## 一、原始需求

### 1.1 用户明确要求
- **布局**: 左侧方案/图片/视频结果，右侧当前创作与参数
- **去画布**: 移除电商独立无限画布
- **交互逻辑**: 借鉴 Opus 重做的 `/toolbox/image` 和 `/toolbox/video` 页面的出现时机、场景联动和反馈方式
- **核心体验**: 围绕同一件商品，做出一套表达连贯、事实准确、可以逐张调整的商品内容

### 1.2 产品方向
- 基础生成操作沿用工具箱的用法
- 电商增加商品记忆、整套内容规划和逐张迭代
- 知识库、行业分类和 Skills 在背后帮助产出，不成为用户开工前需要理解的模块
- 复杂套图才引入 Agent 策划，简单任务直接生成

---

## 二、设计方案

### 2.1 交互流程

#### 简单任务（白底图、单张场景图）
```
选择场景 → 上传商品素材 → 编辑描述 → 确认规格 → 生成 → 查看作品
```

#### 复杂任务（详情页、套图）
```
选择套图场景 → 补充商品事实 → Agent 策划 → 按页审阅 → 生成作品批次
```

### 2.2 页面结构

```
┌─────────────────────────────────────────────────────────┐
│ 系统导航与顶栏                                            │
├──────────────────────────────┬──────────────────────────┤
│ 左侧：本轮方案与作品          │ 右侧：当前创作面板        │
│                              │                          │
│ - 空态说明                   │ - 这次做什么（场景选择）  │
│ - 方案卡片（按页审阅）        │ - 商品图与所需参考        │
│ - 作品批次卡                 │ - 需求描述/场景短语       │
│ - 单张预览/修改/下载         │ - 平台、语言、数量        │
│ - 历史批次                   │ - 模型与规格              │
│                              │ - 本次费用+明确动作       │
└──────────────────────────────┴──────────────────────────┘
```

### 2.3 关键交互原则

1. **场景决定素材位**: 选择场景后，系统解释需要的素材，不重复要求
2. **描述是主输入**: 短语可选、可写、可改，所有被加入的内容都能在描述中看到和修改
3. **价格在提交前清楚**: 统一展示预计费用、产物数和实际会提交几个任务
4. **结果直接出现**: 新任务在画廊中马上占位，显示状态；不等刷新后才发现作品
5. **失败恢复单个目标**: 错在哪就在哪解释；只重试未成功的作品

### 2.4 后台整合

将三个电商后台导航合为一个「电商创作管理」：
- **使用设置**: 电商是否已开放、哪些能力可用、哪个配置阻塞
- **创作规则**: 方法、知识、来源的关联查看与审核
- **品类适配**: 查看某个品类实际会继承什么

### 2.5 功能开关

在 `/admin/settings/features` 增加：
- **电商创作** (ecommerceEnabled): 控制新商品图片创作
- **电商视频** (ecommerceVideoEnabled): 控制从图片制作视频
- **站内 AI 帮助** (siteAssistantEnabled): 控制收费 AI 帮助

---

## 三、改造进度

### 3.1 已完成 ✅

#### 前端页面改造
- [x] 创建新作品画廊组件 `output-gallery.tsx` 和 `output-gallery.css`
- [x] 移除画布容器 `EcommerceResultCanvas` 的 JSX 渲染
- [x] 接入系统标准模型选择器 `ModelPicker`
- [x] 移除小夜角色欢迎卡，改为简洁创作提示
- [x] 左右布局：左侧作品画廊，右侧创作面板
- [x] 移动端创作/作品切换控件
- [x] 清理画布相关状态（`focusedCanvasImageId`、`workspaceCollapsed` 等）
- [x] 移除旧图标依赖（`ProductDetailNodeIcon`、`VideoNodeIcon` 等）

#### 功能开关集成
- [x] 后端 `feature_availability.go`: 新增 `ecommerceEnabled`、`ecommerceVideoEnabled`、`siteAssistantEnabled` 字段
- [x] 后端 `platform_bridge.go` 和 `aliases_consts.go`: 同步常量别名
- [x] 前端 `use-user-store.ts`: 添加新开关字段和默认值
- [x] 前端 `auth.ts`: 更新 `updateAdminFeatureAvailability` 参数类型
- [x] 前端 `feature-availability-panel.tsx`: 添加三个新开关的 UI 控制
- [x] 电商页面读取开关状态，关闭时禁用新建入口

#### 服务端准入控制
- [x] `task_creation.go`: 新增 `requireTaskGenerationFeatures` 统一准入检查
- [x] `workbench_bridge.go`: 工作台任务创建接入准入检查
- [x] `ecommerce.go`: 电商项目创建/删除/保存接入准入检查
- [x] `ecommerce_agent.go`: 电商 Agent 各接口接入准入检查
- [x] `task_worker.go`: 任务执行前再次检查准入
- [x] `task_lifecycle.go`: 任务生命周期接入准入
- [x] 前端 `workbench.ts`: 任务创建请求添加 `ecommerceProjectId` 字段
- [x] 前端 `index.tsx`: 两处 `createWorkbenchTask` 调用传入项目 ID

#### 测试覆盖
- [x] 后端 `ecommerce_feature_admission_test.go`: 新增 5 个测试用例
- [x] 后端 `ecommerce_feature_routes_test.go`: 新增路由级准入测试
- [x] 前端类型检查通过 (`bun run typecheck`)

### 3.2 未完成 ❌

#### 页面交互优化
- [x] **页面重做（第二轮）**: 右侧创作面板改为满高单层面板（`composer.css`，`.ecs-*`），区块之间只用分隔线；左侧「方案与作品」承载已发送需求、视觉方向、方案审阅、进度错误与作品。平台选择改为居中弹窗（`market-picker.tsx/.css`），营销物料改为弹窗。
- [x] **场景选择联动**: `scenes.ts` 定义六个场景的说明、必需/建议素材、是否需要策划和短语分组；场景平铺选择，素材区标题显示所需素材
- [x] **描述短语系统**: 按场景切换短语分类，点选写入描述、再点移除（`lib/prompt-phrases.ts`，与 `/toolbox/image` 共用）
- [x] **空态智能提示**: 空态按「未开放 / 缺商品图 / 缺描述 / 可生成」给出下一步
- [ ] **套图策划流程**: 需要实现 Agent 策划、按页审阅、批量生成的完整流程
- [ ] **单张修改**: 需要实现局部修改、版本对比、候选版本选择

#### 后台整合
- [x] **电商管理页面合并**: 创建 `/admin/ecommerce` 统一入口，标签切换知识库/Skills/品类
- [x] **三标签页面**: AdminSegmented 标签导航，路由级切换
- [x] **旧路由重定向**: `/admin/ecommerce-knowledge` 等旧路由重定向到 `/admin/ecommerce`
- [x] **侧边栏合并**: 三个导航项合为「电商创作管理」单入口

#### 小夜收敛
- [x] **YoruWidget 受开关控制**: `siteAssistantEnabled` 关闭时不渲染悬浮角色和聊天窗口
- [ ] **设置页重做**: `/admin/settings/yoru` 改为帮助配置（后续交付）

#### 视频功能
- [ ] **图转视频**: 需要实现从图片作品直接创建视频任务
- [ ] **视频规格**: 需要实现时长、画幅、分辨率等视频参数
- [ ] **视频作品展示**: 需要在作品画廊中支持视频预览和播放

#### 样式修复
- [x] CSS 语法错误已修复（删除多余属性声明）
- [ ] **移动端响应式**: 需要验证 760px 以下布局是否正常
- [ ] **暗色主题**: 需要验证暗色主题下的显示效果

### 3.3 已知问题 ⚠️

0. **旧样式仍在加载**: `workspace.css`、`studio.css`、`agent-theme.css`、`interaction.css` 仍服务历史弹窗、方向卡片、风格库与单张修改弹窗；新布局在 `.ecs-*` / `.commerce-market` 作用域内覆盖同名类。清理旧样式前需先给这些组件补独立样式。
0. **画布助手遮挡**: 全局画布助手悬浮角色默认停在右下角，会盖住创作面板的「生成」按钮。
1. **CSS 文件末尾有多余空行**: `workspace.css` 第 3279 行有空行，不影响功能但不够整洁
3. **套图策划未实现**: 复杂任务仍走简单流程，没有 Agent 策划环节
4. **视频功能未接通**: 电商视频入口显示"即将开放"，实际未实现

---

## 四、文件清单

### 4.1 新增文件
```
web/src/pages/ecommerce/output-gallery.tsx          # 新作品画廊组件
web/src/pages/ecommerce/output-gallery.css          # 作品画廊样式
backend/internal/app/ecommerce_feature_admission_test.go  # 准入测试
backend/internal/handler/ecommerce_feature_routes_test.go # 路由测试
```

### 4.2 修改文件（前端）
```
web/src/pages/ecommerce/index.tsx                   # 主页面改造
web/src/pages/ecommerce/workspace.css               # 样式调整
web/src/services/api/workbench.ts                   # 添加项目 ID 字段
web/src/stores/use-user-store.ts                    # 添加功能开关字段
web/src/services/api/auth.ts                        # 更新参数类型
web/src/pages/admin/components/feature-availability-panel.tsx  # 添加开关 UI
```

### 4.3 修改文件（后端）
```
backend/internal/platform/feature_availability.go   # 添加功能字段
backend/internal/app/platform_bridge.go             # 同步常量
backend/internal/service/aliases_consts.go          # 同步常量
backend/internal/app/task_creation.go               # 添加准入检查
backend/internal/app/workbench_bridge.go            # 工作台准入
backend/internal/app/ecommerce.go                   # 电商项目准入
backend/internal/app/ecommerce_agent.go             # Agent 接口准入
backend/internal/app/task_worker.go                 # 任务执行准入
backend/internal/app/task_lifecycle.go              # 生命周期准入
backend/internal/workbench/tasks.go                 # 添加项目 ID 字段
```

### 4.4 未修改但相关文件
```
web/src/pages/ecommerce/result-canvas.tsx           # 旧画布组件（已不再使用）
web/src/pages/ecommerce/result-gallery.tsx          # 旧画廊组件（已不再使用）
web/src/pages/admin/ecommerce-knowledge-page.tsx    # 旧知识页面（待合并）
web/src/pages/admin/ecommerce-skills-page.tsx       # 旧技能页面（待合并）
web/src/pages/admin/ecommerce-categories-page.tsx   # 旧分类页面（待合并）
web/src/pages/admin/settings/yoru-settings-page.tsx # 旧小夜设置（待重做）
```

---

## 五、验证结果

### 5.1 已通过
- ✅ 前端类型检查 (`bun run typecheck`)
- ✅ CSS 语法检查（已修复）
- ✅ 后端准入测试（5 个用例）
- ✅ 后端路由测试（多个场景）

### 5.2 未验证
- ❌ 真实页面交互验证（需要登录账号）
- ❌ 移动端响应式验证
- ❌ 暗色主题验证
- ❌ 套图策划流程验证
- ❌ 视频功能验证

### 5.3 验证方法
```bash
# 前端类型检查
cd web && bun run typecheck

# 后端测试
cd backend && go test ./internal/app -run 'TestEcommerceFeature' -count=1

# 启动开发服务器
cd web && bun run dev

# 访问页面
http://localhost:3000/ecommerce
```

---

## 六、下一步执行建议

### 6.1 优先级排序

**P0 - 必须完成**
1. 实现场景选择联动（素材位动态显示）
2. 实现描述短语系统（可点选的场景化短语）
3. 验证真实页面交互

**P1 - 重要**
4. 实现套图策划流程（Agent 策划、按页审阅）
5. 实现单张修改（局部修改、版本对比）
6. 后台页面合并（三标签统一入口）

**P2 - 次要**
7. 小夜收敛（移除悬浮窗口、重做设置页）
8. 视频功能（图转视频、视频规格）
9. 移动端和暗色主题优化

### 6.2 执行顺序

```
1. 场景联动 → 2. 描述短语 → 3. 真实验证
   ↓
4. 套图策划 → 5. 单张修改 → 6. 后台合并
   ↓
7. 小夜收敛 → 8. 视频功能 → 9. 样式优化
```

### 6.3 注意事项

1. **不要回滚已有改动**: 当前工作区有大量并行改动，需要保护
2. **保留旧组件**: `result-canvas.tsx` 和 `result-gallery.tsx` 暂时保留，不要删除
3. **功能开关默认关闭**: 新部署默认不开放电商功能，需要管理员手动开启
4. **历史数据保留**: 功能关闭后，历史项目和作品仍可访问
5. **测试覆盖**: 每完成一个功能，补充对应的测试用例

---

## 七、技术债务

### 7.1 代码重复
- `output-gallery.tsx` 和 `result-gallery.tsx` 有部分重复逻辑
- 建议后续统一为 `output-gallery.tsx`，删除 `result-gallery.tsx`

### 7.2 状态管理
- 电商页面状态过于复杂（2900+ 行）
- 建议后续拆分为多个子组件和自定义 Hook

### 7.3 样式冗余
- `workspace.css` 有 3200+ 行，包含大量旧画布样式
- 建议后续清理不再使用的样式

### 7.4 测试覆盖
- 前端缺少组件级测试
- 后端测试覆盖了准入逻辑，但缺少端到端测试

---

## 八、参考文档

- 设计方案: `docs/plans/ecommerce-workbench-redesign.md`
- 后端 API: `docs/content/docs/backend/http-api.mdx`
- 功能说明: `docs/content/docs/overview/features.mdx`
- 待测试项: `docs/content/docs/progress/pending-test.mdx`

---

**交接完成时间**: 2026-11-04 09:41  
**交接人**: Little Code Sauce  
**接收人**: 下一个 Agent
