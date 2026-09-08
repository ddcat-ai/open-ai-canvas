# 影策 Canvas Agent

Canvas Agent 是远程画布的 stdio MCP 适配器。它通过 HTTPS 调用影策后端，不启动 HTTP 服务，不监听 `127.0.0.1:17371`，也不提供本机 Agent、Dreamina CLI 或肖像排查能力。

网页内的在线 Agent 与外部 MCP 是两条独立路径：网页在线 Agent 继续在站点内运行；Codex、Claude Code 等 MCP 宿主通过本适配器操作用户明确选择的远端画布。

## 环境要求

- Node.js 18+
- 可通过 HTTPS 访问的影策服务（默认使用 `https://kraftreel.com`）
- 浏览器中可登录该影策服务的账号

CLI 默认连接 `https://kraftreel.com`，普通用户不需要设置服务地址。自部署用户可以用 `KRAFTREEL_SERVER_URL` 覆盖；它必须是没有用户名、密码、查询参数和片段的 HTTPS 根地址。`KRAFTREEL_CONFIG_DIR` 可选，默认使用 `~/.kraftreel`；旧版 `YINGCE_*` 环境变量和 `~/.yingce` 配置仍可读取。

```bash
# 仅自部署时需要；公网 KraftReel 用户跳过这一行
export KRAFTREEL_SERVER_URL=https://canvas.example.com
```

## 登录和选择画布

首次使用时发起设备登录（插件会按需下载 CLI，不需要全局 npm 安装）：

```bash
npx -y kraftreel-cli login web
```

命令会输出审批页面地址。用户在网页中确认后，访问令牌和刷新令牌保存到 `~/.kraftreel/credentials.json`，文件权限会尽可能限制为当前用户。数据库只保存令牌哈希。

登录后选择一个画布：

```bash
npx -y kraftreel-cli project list
npx -y kraftreel-cli project use <canvas-project-id>
npx -y kraftreel-cli project unuse
```

当前选择保存在 `~/.kraftreel/project.json`。`project unuse` 只删除该选择文件，不撤销令牌；需要撤销访问时应调用服务端 MCP revoke 接口或在账号安全入口撤销。

从网页安装 KraftReel Skill 后，Codex App 会自动注册同一条 MCP 配置，并在启动时按需执行 `npx -y kraftreel-cli mcp`。用户不需要手动执行 npm 安装命令或填写公网服务地址。

## 注册 MCP

Codex CLI：

```bash
codex mcp add kraftreel -- npx -y kraftreel-cli mcp
```

Claude Code：

```bash
claude mcp add --scope user --transport stdio kraftreel -- npx -y kraftreel-cli mcp
```

仓库内的 Codex app 插件位于 `plugins/kraftreel`，默认注册名为 `kraftreel` 并使用同一条 stdio 命令。插件安装后需要新建对话，使 MCP 和技能完整加载。

本仓库开发时可改用本地构建产物：

```bash
cd canvas-agent
npm install
npm test
npm run build
codex mcp add kraftreel -- node /absolute/path/to/open-ai-canvas/canvas-agent/dist/index.js mcp
```

## 写入和审批边界

- 所有写操作携带服务端返回的 `expectedRevision` 和 `expectedStateHash`。
- HTTP 409 表示画布已被其他窗口或 MCP 修改；客户端必须重新读取，不会用旧快照重放写入。
- HTTP 428 表示缺少前置条件，HTTP 422 表示操作不合法，HTTP 429 表示限流。
- 已发送的写请求遇到 401 或 429 时不会自动重放，避免重复创建、移动、删除或生成。
- 删除、覆盖、移动、改边和生成由 MCP 宿主审批。画布网页不会为外部 MCP 再弹出确认框。
- 后端仍会执行登录态、scope、资源归属、参数、并发和审计校验；宿主批准不代表服务端跳过权限。
- MCP 输出递归移除媒体 URL、Cookie、Token、API Key 等敏感字段，审计记录不保存 prompt、原始 payload 或凭据。

推荐先调用 `canvas_get_context`，再按真实节点 ID 读取或修改。复杂写操作先使用 `canvas_validate_ops`；生成任务只报告已提交或任务状态，不能把节点创建等同于媒体已经生成完成。

## Skill 与计划编排

远程 MCP 宿主（例如 Codex、Claude 或 Hermes）负责理解用户意图和生成结构化结果；CLI 不运行通用外部工具，也不替宿主调用模型。画布专用 Skill 通过以下只读工具发现：

```text
canvas_list_skills
canvas_get_skill { "name": "script-to-scenes" }
```

复杂创作请求使用“先计划、后执行”的链路。以剧本拆场景为例，宿主先读取真实剧本节点并根据 Skill 合同生成场景数组，然后调用：

```text
canvas_prepare_scene_plan {
  "scriptNodeId": "script-1",
  "scenes": [
    { "title": "大学宿舍深夜", "content": "沈舟在宿舍熬夜写作业。" },
    { "title": "长安城外清晨", "content": "两人在草垛旁醒来。" }
  ],
  "expectedRevision": 12,
  "expectedStateHash": "..."
}
```

该工具只读取画布、校验操作并返回 `planId`、操作预览和 `approvalDigest`，不会写入画布。宿主展示计划并获得用户批准后，使用原样的 `planId` 和 `approvalDigest` 调用 `canvas_apply_scene_plan`。批准期间如果画布 revision 或 state hash 变化，必须重新读取并重新规划，不能给旧操作替换新的版本号。

`canvas_get_scene_plan` 可查询计划状态。计划执行超时或连接异常时，状态可能为 `unknown`；此时先读取画布和计划确认是否已应用，禁止直接重放。计划只保存在当前 MCP 进程内，默认 30 分钟过期，进程重启后需要重新规划。

简单的单节点读取或改名可以直接使用基础画布工具，不必创建用户可见的 Plan。询问模式要求有影响的操作经过批准；自动模式只自动执行符合策略的计划，删除、覆盖、费用超限、冲突和未知结果仍会暂停。

## 能力边界

Canvas Agent 仅包含远程 CLI、stdio MCP、工具规划和 HTTPS 客户端。以下能力已完全移除：

- Local Runtime HTTP/SSE 和浏览器本机会话
- 本机 Codex/Claude Agent 进程桥接
- Dreamina CLI 本机生成
- 肖像排查本机模型与报告

ComfyUI Bridge 保留，但它是站点提供的独立原生程序，由“设置 -> ComfyUI Bridge”生成启动命令。它不属于 Canvas Agent 的 Local Runtime，也不会恢复 `17371` 端口或网页本机 Agent 连接。

## 发布

包名为 `kraftreel-cli`，版本由 `canvas-agent/package.json` 独立管理。全局安装后使用 `kraftreel` 命令。发布前运行：

```bash
npm test
npm run build
npm pack --dry-run
```
