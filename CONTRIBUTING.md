# 贡献指南

感谢参与 Open AI Canvas。提交改动前，请先确认相关 Issue 或用简短说明描述问题、目标和外部行为变化。

## 开发环境

- 前端：Bun、Vite、React、TypeScript。
- 后端：Go、Gin、GORM、SQLite。
- 本地全栈：`docker compose up -d --build`。

不要提交 `.env`、数据库、数据目录、生成产物、编辑器配置或真实 API/OSS 密钥。新增配置项时只在 `.env.example` 中提供无敏感信息的说明。

## 提交要求

- 保持改动聚焦，沿用现有目录职责、命名和错误处理风格。
- 写路径必须明确失败；不可用默认值掩盖保存、权限、生成或删除错误。
- 后端对象读取必须同时校验当前用户和资源归属。
- 涉及上传、外部请求或模型调用时，必须说明大小、频率、费用和 SSRF 边界。
- 用户可见文案使用中文；核心业务入口和安全边界使用简短中文注释说明原因。

## 质量检查与合并

检查命令以 `.github/workflows/quality.yml` 为准。`bun run build` 只做类型检查和打包，不会运行 lint、单元测试或浏览器 E2E；不能用构建成功代替 Web checks 通过。

- 前端使用 Bun 1.3.9 和 `bun install --frozen-lockfile`，执行 `bun run typecheck`、`bun run lint`、`bun run test`、`bun run test:previs:e2e`（均在 `web/` 下）。E2E 需要 Chrome/Chromium，可用 `CHROME_BIN` 指定。改动文件另做 Prettier 检查；CI 用 `web/scripts/check-changed-formatting.mjs` 检查提交差异。
- 后端在 `backend/` 下运行 `gofmt -l .` 并修复列出的文件，再运行 `go test -json -timeout=20m ./...`。完整测试需要 Node 22.19.0、`backend/agent-runtime/pi/` 中的 `npm ci --omit=dev --ignore-scripts`、`redis-server` 和独立的 PostgreSQL 测试库；连接通过 `CANVAS_TEST_POSTGRES_DSN` 提供。缺少服务导致用例跳过时，不能声称与 Backend checks 等价。
- CSS、组件结构、路由或协议变动时，同时核对相邻回归测试。测试应表达当前约定；不要为了通过旧断言恢复已修复的行为，也不要直接跳过失败用例。
- 合并、解决冲突或同步主干后，针对最终代码重新验证。先确认 `git status` 无未解决冲突、`git diff --check` 通过，再查看该提交的 CI 结果；旧提交的成功不能代表新提交通过。
- Web checks、Backend checks 或 Payment plugin artifacts 失败时，先定位并修复。即使失败来自主干遗留问题，也不能将红色检查视为可忽略的背景噪声。

Pull Request 应包含改动摘要、风险、验证方式和必要截图，并分别写明已执行、未执行或因环境跳过的检查。提交即表示你有权按本项目 MIT 许可证贡献相关代码或素材，并保留已有上游署名和许可证通知。
