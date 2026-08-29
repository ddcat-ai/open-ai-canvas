# 影策 Canvas Agent

本地 Canvas Agent 用来连接画布网页和用户电脑上的 Codex / Claude Code。本地开发时优先连接 `http://localhost:3000`，不需要先使用线上站点。

## 启动

```bash
npx -y @ddcat666/open-ai-canvas-agent
```

本仓库开发时也可以直接运行：

```bash
cd canvas-agent
npm install
npm run build
node dist/index.js
```

启动后会输出本机地址和 token：

```txt
Local URL: http://127.0.0.1:17371
Connect token: xxxxxx
```

在画布右上角点击 `Agent`，填入地址和 token 后连接。

## ComfyUI Bridge

Bridge 让云端后端把工作流请求投递到运行 Bridge 的机器，再由该进程访问 ComfyUI。`--comfy` 可填写本机 `127.0.0.1:8188`、局域网地址或公网 HTTP/HTTPS 地址，只要运行 Bridge 的机器能够访问即可；网页和云端不直接访问该地址。

部署镜像会用 Go 标准库把 Bridge 交叉编译成站点根目录下的 Windows x64、Linux x64 和 Linux ARM64 原生程序。它们不捆绑 Node.js/Bun 运行时，运行 Bridge 的机器不需要安装 Node.js、npm 或项目源码；画布“设置 → ComfyUI Bridge”会按平台生成带当前地址、令牌和工作流目录的完整命令。

```powershell
$bridgeDir = Join-Path $env:LOCALAPPDATA "OpenAICanvas"
New-Item -ItemType Directory -Force -Path $bridgeDir | Out-Null
$bridgeFile = Join-Path $bridgeDir "OpenAICanvas-ComfyBridge.exe"
Invoke-WebRequest "https://你的画布服务地址/OpenAICanvas-ComfyBridge.exe" -OutFile $bridgeFile
$bridgeStream = [System.IO.File]::OpenRead($bridgeFile)
try { $bridgeHeader0 = $bridgeStream.ReadByte(); $bridgeHeader1 = $bridgeStream.ReadByte() } finally { $bridgeStream.Dispose() }
if ($bridgeHeader0 -ne 0x4D -or $bridgeHeader1 -ne 0x5A) { throw "Bridge 下载失败：服务器未返回 Windows 可执行程序，请联系管理员重新部署 Bridge" }
& $bridgeFile --server "https://你的画布服务地址" --token "你的 Bridge Token" --comfy "http://127.0.0.1:8188" --workflow-dir "D:\\ComfyUI\\workflows"
```

Linux x64 云服务器（ARM64 服务器请把文件名中的 `amd64` 改为 `arm64`）：

```bash
bridge_dir="./openai-canvas-bridge"
mkdir -p "$bridge_dir"
curl --fail --location "https://你的画布服务地址/OpenAICanvas-ComfyBridge-linux-amd64" --output "$bridge_dir/OpenAICanvas-ComfyBridge-linux-amd64"
chmod +x "$bridge_dir/OpenAICanvas-ComfyBridge-linux-amd64"
"$bridge_dir/OpenAICanvas-ComfyBridge-linux-amd64" --server "https://你的画布服务地址" --token "你的 Bridge Token" --comfy "http://127.0.0.1:8188" --workflow-dir "/opt/ComfyUI/user/default/workflows"
```

如果 ComfyUI 和 Bridge 都在云端 Linux，`--comfy` 建议使用 `http://127.0.0.1:8188`，不要把 ComfyUI 的 8188 端口暴露给公网。生产环境可将上面的 Bridge 命令配置为 systemd 服务，确保云服务器重启后自动恢复；Bridge Token 应通过受限的环境文件或服务管理器注入，不要写进公开脚本。

工作流可以在“设置 → ComfyUI Bridge”中选择 Bridge 发现的 API JSON、粘贴 ComfyUI API 格式 JSON，也可以只填写 `workflowId`，让 Bridge 从 `--workflow-dir` 下读取同名 `.json` 文件。Bridge 会分析本机工作流，并把可配置字段回传给可视化映射面板；面板可设置任务提示词、固定文本、参考图片/视频/音频顺序、蒙版、尺寸、宽高、数量、质量、视频时长、音频参数、随机 Seed 以及必选/可选规则。未保存字段映射时，Bridge 也会在执行前按同一规则分析工作流；正向 Prompt 优先于负向文本节点。参考素材会先上传到本机 ComfyUI，多余素材或缺失的必选槽位会直接报错，可选媒体缺失时不会继续使用工作流模板中的旧文件名。映射同时兼容原项目配置里的 `node`、`input`、`default` 和 `bind_prompt` 字段。RunningHub 工作流在独立的“设置 → RunningHub 工作流”中管理，不属于模型渠道。

Bridge Token 只用于主动轮询和回传结果，不要提交到 Git 或写入公开日志。Bridge 执行长任务时每 30 秒发送心跳；远程参考素材只允许解析到公网地址，`127.0.0.1`、localhost、私网和链路本地地址会被拒绝。请求、领取状态和完成结果由后端持久化：后端重启后未领取请求会继续投递，已领取请求的迟到结果也能由恢复后的任务读取；Bridge 进程自身在执行中退出时，本机 ComfyUI 任务仍不能自动接管。工作流请求 JSON 上限为 16MB，结果 JSON（含 base64 媒体）上限为 64MB，超大视频建议改为资源上传链路。

Bridge 首次使用网页生成的命令启动后，会把服务器地址、Token、ComfyUI 地址和工作流目录保存到本机用户配置目录（权限为仅当前用户可读）。之后重启或断线恢复可以直接再次启动 Bridge 程序，不需要重新填写这些参数；如需更换连接目标，再使用带参数的启动命令覆盖旧配置。

Codex app 插件会读取启动输出里的 Local URL 和 Connect token，并直接打开画布网页地址；Canvas Agent 不负责生成画布打开 URL。

Canvas Agent 默认只监听 `127.0.0.1`。网页第一次带正确 token 连接后，Canvas Agent 会记录该网页 Origin；之后其他 Origin 不能复用这个本地 Agent，除非用户清理 `~/.infinite-canvas/canvas-agent.json` 里的 `origins`。

## Dreamina CLI 安全边界

- 外部程序直接切换 Dreamina CLI 账号无法被本应用实时观测；只能在下一次 CLI 状态或命令边界重新校验，因此本机任务运行期间请不要在其他程序中换号。
- 官方 CLI 的 argv 可能被同一 OS 用户通过进程列表看到，其中可能包含 prompt、receipt 或本地路径；这是官方 CLI 的进程边界，本应用不承诺对同机用户隐藏这些参数。

## 肖像可识别性本机引擎

Canvas Agent 内置 `portrait-clearance` Local Runtime 模块。它只接收签名的画布请求，不读取项目 API Key；图片、embedding、候选和报告保存在 Agent 的配置目录，不进入画布 JSON。

本机模型不会随 npm 包发布。用户必须在肖像排查工作台中显式安装并校验 `buffalo_l` 所需的 `det_10g.onnx` 与 `w600k_r50.onnx`，安装过程保留现有可用模型并拒绝校验失败的临时文件。缺少模型时，模块返回 `portrait_model_missing`，不会伪造低风险结果。

## 发布

`canvas-agent` 使用自己的 `package.json` 版本号，不跟仓库根目录 `VERSION` 绑定。发布包名为 `@ddcat666/open-ai-canvas-agent`。

发布前需要在 GitHub 仓库 Secrets 中配置 `NPM_TOKEN`。

## Codex MCP

如果希望 Codex 终端能直接操作画布，需要先把 Canvas Agent 注册成 Codex MCP。

### Codex app 插件

仓库内提供了 Codex app 插件：`plugins/yingce`。该插件尚未上架公共插件目录，直接搜索不会显示；在 Codex app 中添加本仓库的 marketplace 后即可安装。插件会注册 `yingce` MCP，并带上画布操作说明。

添加本地 marketplace 时建议使用仓库绝对路径，避免 Codex 从其他工作目录解析失败：

```bash
cd /path/to/open-ai-canvas
codex plugin marketplace add "$(pwd)"
codex plugin add yingce@yingce-local
```

插件默认通过 npm 启动 MCP：

```bash
npx -y @ddcat666/open-ai-canvas-agent mcp
```

使用时可以直接在 Codex 里说“打开影策”，插件会优先启动本地画布和本地 Agent，读取 Local URL 和 Connect token，然后直接打开画布网页地址新建并连接画布。如果自动连接失败，再检查本地画布服务和 Canvas Agent 是否都已启动。

Canvas Agent 启动后，给 Codex 添加 MCP：

```bash
codex mcp add yingce -- npx -y @ddcat666/open-ai-canvas-agent mcp
```

本仓库开发时可以改成，实际使用建议替换为本机绝对路径：

```bash
codex mcp add yingce -- node /path/to/open-ai-canvas/canvas-agent/dist/index.js mcp
```

Canvas Agent 源码使用 TypeScript 编写，MCP 协议层使用官方 `@modelcontextprotocol/sdk`，工具入参使用 `zod` 描述。

如果希望终端里的 Codex 不被 MCP 审批卡住，可以在 `~/.codex/config.toml` 里给这个 MCP 设置自动放行：

```toml
[mcp_servers.yingce]
command = "npx"
args = ["-y", "@ddcat666/open-ai-canvas-agent", "mcp"]
default_tools_approval_mode = "approve"
```

可用工具：

- `canvas_get_state`
- `canvas_get_context`
- `canvas_find_nodes`
- `canvas_get_node`
- `canvas_get_connection`
- `canvas_get_generation_tasks`
- `canvas_get_resources`
- `canvas_validate_ops`
- `canvas_get_selection`
- `canvas_export_snapshot`
- `canvas_apply_ops`
- `canvas_create_workflow`
- `canvas_create_text_node`
- `canvas_create_image_prompt_flow`

`canvas_create_workflow` 是创建流水线/节点图的高阶工具，不要把工作流退化成批量文本节点。它会根据节点语义自动选择真实节点类型、按实际尺寸布局、创建默认顺序连线，并复核连接与重叠结果：

| kind | 画布节点类型 | 用途 |
| --- | --- | --- |
| `character_cards` | `image` | 角色拆分图片卡片 |
| `character_three_view` | `image` | 角色正面/侧面/背面三视图 |
| `storyboard_video` | `video` | 分镜剧情视频 |
| `script` | `script` | 剧本或分镜文字 |

媒体节点优先提供 `prompt`/`content`；对三个影视语义节点，即使模型漏填提示词，工具也会从工作流标题和节点语义生成最小可用创作提示词。已有画布素材必须先通过 `canvas_find_nodes` 或 `canvas_get_resources` 获取真实 node id，再放入 `referenceNodeIds`。

```json
{
  "title": "搞笑修仙小说流水线",
  "nodes": [
    { "ref": "cards", "kind": "character_cards", "title": "角色拆分图片卡片" },
    { "ref": "views", "kind": "character_three_view", "title": "角色三视图", "referenceRefs": ["cards"] },
    { "ref": "video", "kind": "storyboard_video", "title": "分镜剧情视频", "referenceRefs": ["views"], "runGeneration": false }
  ]
}
```

`canvas_apply_ops` 示例：

```json
{
  "ops": [
    {
      "type": "add_node",
      "nodeType": "text",
      "title": "标题",
      "position": { "x": 0, "y": 0 },
      "metadata": { "content": "文本内容" }
    }
  ]
}
```

画布写工具返回的结果包含 `ok`、`message` 和 `data`。`data.snapshot` 是本地 Runtime 写入后的最新快照，`data.verification` 会列出 `createdNodeIds`、`removedNodeIds`、缺失节点/连线、前后状态摘要和生成任务观察结果。生成任务的 `message` 会明确区分“已提交/生成中，尚未完成”和“已完成且资源就绪”；不要只根据节点已经创建就向用户报告生成完成。

推荐的 Agent 工作流是：先调用 `canvas_get_context` 读取语义化上下文和 `stateHash`；不知道节点 id 时调用 `canvas_find_nodes`，已经知道 id 后用 `canvas_get_node` 或 `canvas_get_connection` 做精确复核；需要观察生成中的节点时调用 `canvas_get_generation_tasks`；涉及图片、视频或音频参考时调用 `canvas_get_resources`；复杂写操作先调用 `canvas_validate_ops`，通过后再调用 `canvas_apply_ops`。这样 Agent 不需要猜测节点 id，也不会把 loading/error/占位媒体误判成可用资源。

## 侧边栏 Codex

本地面板会把提示词发送给 Canvas Agent。Canvas Agent 使用官方 `@openai/codex` CLI 的 `codex app-server --stdio` 启动并复用同一个 Codex thread，启动时会注入 `yingce` MCP 配置并自动放行 MCP 审批，真正执行画布修改前仍由网页侧边栏二次确认。

侧边栏会展示 Codex 返回的 `thread.started`、`turn.started`、`item.*`、`turn.completed` 等结构化事件；收到 app-server 的 `item/agentMessage/delta` 时，Canvas Agent 会转成 `item.updated`，网页会用同一条消息做真实流式更新，并把工具细节收进运行日志。

侧边栏上传或粘贴的图片会先发到本机 Canvas Agent，再由 Canvas Agent 临时写入本机文件并作为 app-server `localImage` 输入传给 Codex；前端会提示附件体积，单次请求体限制为 30MB。

侧边栏 Composer 中显式提及的网页技能不会被拼接进用户 Prompt。网页只为本轮提及的技能获取 bundle，本机 Runtime 将 `SKILL.md`、`references/`、`scripts/`、`assets/` 等目录完整写入当前 turn 的临时技能目录，并通过 Codex app-server 的原生 `skill` 输入项加载；技能不会被复制进文本输入，也不会添加 `$skill-name` 伪标记，turn 完成后删除整个临时目录。未被用户提及的技能不会传给本机 Runtime。

网页内置在线 Agent 使用另一条渐进式路径：系统上下文只列技能名称、简介、版本和文件数；模型先读取入口 `SKILL.md`，再按入口引用调用文件清单、搜索或单文件读取工具，不会一次性加载整个技能包。

## Claude Code

Claude Code Adapter 代码暂时保留，但当前网页侧边栏只开放 Codex。后续开放 Claude 入口时，Canvas Agent 会调用本机 `claude -p --output-format stream-json` 并把流式 JSON 事件转发到侧边栏。

如果希望 Claude Code 也能操作画布，需要给 Claude Code 添加同一个 MCP。建议用 user scope，避免 Canvas Agent 从不同目录启动时找不到配置：

```bash
claude mcp add --scope user --transport stdio yingce -- npx -y @ddcat666/open-ai-canvas-agent mcp
```

本仓库开发时可以改成：

```bash
claude mcp add --scope user --transport stdio yingce -- node /path/to/open-ai-canvas/canvas-agent/dist/index.js mcp
```

Canvas Agent 调用 Claude Code 时会默认带上 `--allowedTools mcp__yingce__*`，画布写操作仍由网页侧边栏确认。
