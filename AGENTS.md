# AGENTS.md

本文件约束本项目中的 AI 和自动化开发行为。先遵循用户当前任务，再遵循本文件。

## 工作方式

- 先读代码、配置和文档，再判断和修改；结论必须有代码或命令输出依据。
- 默认推进到可交付状态，但只改任务相关文件，不回滚或覆盖已有用户修改。
- 优先小而完整的实现，不为假想兼容场景增加分支，不引入无实际收益的抽象。
- 项目尚未上线；除非用户要求，不为旧字段和旧数据编写迁移兼容层。
- 按用户要求，写完代码不执行语法检查、测试或构建；交付时明确说明未运行验证。
- 反复出现的项目约束应补充到本文件，规则要具体、可执行。

## 代码质量

- 页面或服务只保留本层职责。纯算法、协议转换和可独立测试的业务规则放到对应 `lib` 或 service 文件。
- 不新增只改名或透传 props 的组件，不用 helper 掩盖超长主流程；先拆清职责边界。
- 核心业务入口、非直观算法、安全边界和降级策略必须有简短中文注释，说明“为什么”和关键约束；显而易见的赋值不写注释。
- 新文件建议控制在 500 行以内；文件超过 800 行时，新增功能前应优先拆出明确职责。历史超长文件按功能逐步治理，不做无关的大爆炸重构。
- 错误不可静默吞掉。读展示路径允许降级并提示，保存、生成、权限、删除等写路径必须明确失败。
- 通用格式、解析、压缩、加密、日期等能力使用成熟库，不手写底层实现。

## 后端

- 技术栈：Go、Gin、GORM、SQLite。
- `handler/` 只处理 HTTP 入参、调用 service、返回 `OK` / `Fail`。
- `service/` 负责业务逻辑、校验、鉴权、默认值、时间和 ID。
- `repository/` 只负责数据库访问和 GORM 查询；`model/` 只定义结构、枚举和简单模型方法。
- 列表接口沿用 `model.Query`、`Normalize`、分页和标签筛选；响应保持 `{ code, data, msg }`。
- 新增或调整数据表时同步更新 `docs/content/docs/backend/backend-database.mdx`。
- 生成、激活、权限、删除和密钥处理属于强校验写路径，不允许用默认值掩盖失败。

## 前端

- 技术栈：Vite、React、React Router、TypeScript、Ant Design、Tailwind、Zustand、TanStack Query。
- Ant Design 以当前安装版本和官方 `llms-full.txt` 为准；共性主题、按钮、下拉框、弹窗和反馈配置集中在 `app-theme.ts` 或 `AppProviders`。
- API 放在 `web/src/services/api/`；跨页面状态放在 `web/src/stores/`；路由页面、布局和路由配置分别放在 `pages/`、`layouts/`、`router.tsx`。
- 画布组件、状态和工具分别放在 `components/canvas/`、`stores/canvas/`、`lib/canvas/`。
- 页面私有组件和 hook 放在页面目录内；只有真实跨页面复用的能力才上移到全局目录。
- 已在全局 store 或 hook 中的状态直接读取，不通过多层 props 透传。复制、下载、确认等跨页面 UI 副作用优先收敛为全局 hook。
- UI 图标优先使用 `lucide-react` 或项目已有 Ant Design 图标；页面文案使用中文。
- 私有样式优先用 Tailwind 或少量内联样式；`globals.css` 只放变量、重置、通用样式和必要的第三方覆盖。
- 业务列表、生成记录、媒体和大 JSON 使用 `localforage`；`localStorage` 只保存极小配置。

## 画布 UI

- 画布与核心产品界面的视觉交互以 Aceternity UI 的空间层次和组件语言为主基线；优先适配其组件源码并结合当前业务重构，不以旧平面组件外加少量动画作为完成标准。
- Aceternity 组件必须改造成当前项目的命令、状态和主题契约，使用 `lucide-react` 与现有业务 hook；不得为同一入口长期并行维护新旧两套视觉实现。
- 遵循现有画布主题，优先使用 `canvasThemes`、`useThemeStore` 和 Ant Design token，不硬编码导致明暗主题失配的颜色。
- 工具 Dock、节点表面、弹窗和浮层应具有清晰空间层级；高频创作操作保持紧凑，动效强度按使用频率和画布性能调整，但不退回静态平面方案。
- 图片节点默认保持原始比例；批量生成、多图和助手面板不得长期遮挡主要画布空间。
- 动效服务于状态变化和空间关系，并尊重 `prefers-reduced-motion`；不要添加持续干扰创作的装饰动画。

## 文档

- README 只保留项目定位、核心功能、快速开始、数据说明和文档入口。
- `docs/index.md` 是面向 AI 的短索引；详细内容只写入 `docs/content/docs/` 对应页面。
- 功能说明、代码地图、待办和待测试分别维护在 `features.mdx`、`code-map.mdx`、`todo.mdx`、`pending-test.mdx`。
- 已实现但未由用户确认的变化写入 `pending-test.mdx`；确认后再更新正式功能说明。
- 完成 todo 后先移入 `pending-test.mdx`，不要直接写入正式功能说明。
- `CHANGELOG.md` 的 `Unreleased` 只做版本级归纳，不逐条复制待测试内容。
- 每次任务结束前检查 todo 和 pending-test；没有功能变化时无需机械修改。
- 文档默认中文，不写过期日期，不暴露密钥、Token 或机器敏感信息。

## Git Commit 文案

提交说明必须使用统一格式（不要模仿仓库里旧的纯英文 subject）：

```text
<type>(<scope>): <业务模块> - <变更摘要>
```

- `type`：`feat` | `fix` | `refactor` | `perf` | `docs` | `test` | `build` | `ci` | `chore` | `revert`
- `scope`：技术域英文；跨模块用 `*`。常用：`canvas`、`platform`、`auth`、`api`、`database`、`deploy`、`release`、`dependencies`、`security`、`media`、`admin`
- `业务模块`：中文可检索名（如「模型选择」「登录态」），不用纯文件名
- `变更摘要`：中文写业务结果；不堆文件列表；不加句末句号；专有名词可英文
- 默认不写 body；breaking / 复杂原因 / issue 再写
- 正例：`fix(canvas): 模型选择 - 清空可选项后仍残留已删除模型显示为 undefined`
- 正例：`chore(release): 版本发布 - publish v0.16.4`
- 反例：`fix(canvas): use supported modal style slot`（纯英文）、`fix: 修了 bug`（缺 scope 与模块）

## 发布

- 发布时将 `Unreleased` 整理为新版本并保留空标题，更新 `VERSION`，提交全部当前改动，再创建对应 `vX.Y.Z` tag。
- 发布 commit 使用：`chore(release): 版本发布 - publish vX.Y.Z`
- 发布流程不执行编译、测试或构建，除非用户明确要求。

## 当前边界

- 画布和素材支持登录后端同步；`localForage` 仍是缓存及后端/OSS 不可用时的降级存储。
- 用户 AI API Key 保存在浏览器本地，任务创建时可能提交到自部署后端；安全说明必须强调 HTTPS 和可信部署。
- 媒体资源支持私有 OSS 或后端文件存储；删除节点或素材不会自动清理 OSS 远端对象。
- Docker 静态资源和生产部署仍需按待测试清单验证，不得写成已全面生产验证。
