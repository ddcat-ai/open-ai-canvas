# 上传请求协议插件

当前上传入口只安装**声明式请求协议插件**。它把影策统一的文本、图片、视频或音频请求转换为上游 HTTP API，并解析上游响应。素材源、画布节点、工作流、Agent 工具和 UI 扩展仍由应用代码注册，不能通过这里上传 JSON 安装。

## 1. 准备清单

上传文件必须是 UTF-8 JSON，大小不超过 512 KiB。插件 ID 使用小写 kebab-case；请求路径必须是相对路径；清单不得包含域名、Cookie 或 API Key。

```json
{
  "apiVersion": "v1",
  "metadata": {
    "id": "acme-video",
    "name": "Acme Video API",
    "version": "1.0.0",
    "vendor": "Acme",
    "description": "Acme 视频生成协议适配",
    "categories": ["video"],
    "scopes": [
      "admin.system-channel",
      "user.custom-channel",
      "canvas",
      "creation",
      "agent"
    ],
    "contentType": "application/json",
    "parameters": [
      {
        "name": "model",
        "type": "string",
        "required": true,
        "mapping": "model",
        "description": "上游模型名"
      },
      {
        "name": "prompt",
        "type": "string",
        "required": true,
        "mapping": "input.prompt",
        "description": "视频描述"
      },
      {
        "name": "duration",
        "type": "integer",
        "mapping": "input.seconds",
        "description": "生成时长，单位为秒"
      }
    ],
    "documentation": "# Acme Video API\n\n在这里写完整的 Markdown 接入文档。"
  },
  "create": {
    "method": "POST",
    "path": "/v1/videos",
    "fields": {
      "model": "request.model",
      "input.prompt": "request.prompt",
      "input.seconds": "request.duration"
    }
  },
  "poll": {
    "method": "GET",
    "path": "/v1/videos/{{taskId}}"
  },
  "response": {
    "taskIdPaths": ["id", "task_id"],
    "statusPaths": ["status", "data.status"],
    "messagePaths": ["error.message", "message"],
    "resultUrlPaths": ["url", "video.url", "data.0.url"],
    "resultKind": "video"
  }
}
```

`fields` 左侧是上游请求字段路径，右侧是影策请求字段。同步协议只需要 `create` 和 `response`；异步协议再声明 `poll`。清单不会执行 JavaScript，也不能使用 `host:` 执行器。

### 同步文本响应

文本模型不一定需要创建任务后轮询。如果上游在创建请求中直接返回正文，可以只声明 `create` 和 `response`，例如：

```json
{
  "create": {
    "method": "POST",
    "path": "/v1/chat/completions",
    "fields": {
      "model": "request.model",
      "messages": "request.messages"
    }
  },
  "response": {
    "textPaths": ["choices.0.message.content"],
    "reasoningPaths": ["choices.0.message.reasoning_content"]
  }
}
```

- `response.textPaths` 按顺序尝试读取文本正文，支持对象路径和数组下标。
- `response.reasoningPaths` 是可选的，用于读取推理内容；没有该字段时不会影响正文解析。
- 如果没有声明 `statusPaths`，但解析到了文本或媒体结果，宿主会将本次响应视为成功。
- `agentResponse` 只负责 Agent 工具请求的响应解析，与普通文本请求的 `response` 相互独立。

## 2. 编写接入文档

`metadata.documentation` 是插件详情页展示的 Markdown 正文，不是可选简介。至少写清楚：

- 接口与鉴权：创建、查询和取消接口的 Method、Path、Header 与 Content-Type。
- 模型与参数：可用模型名、类型、必填性、默认值、可选值及字段映射。
- 素材限制：数量、格式、大小、时长，以及 URL 可访问性要求。
- 请求与响应：提交成功、处理中、完成和失败的真实示例。
- 轮询与下载：状态值、建议间隔、超时和结果 URL 有效期。
- 错误处理：HTTP 状态、上游错误字段、内容审核和额度限制。

文档中的路径、模型名和响应字段必须与清单实现一致。详情页支持标题、表格、列表、引用、链接和代码块，并按 GitHub Flavored Markdown 预览。

## 3. 上传前检查

| 检查项 | 要求 |
| --- | --- |
| 标识 | `apiVersion` 为 `v1`，ID 为 kebab-case，名称和版本不为空 |
| 能力 | 至少声明一个 `category` 和一个 `scope` |
| 请求 | Method 受支持，Path 为相对路径，字段映射来自 `request.*` |
| 响应 | 任务 ID、状态、错误和结果地址路径与真实响应一致 |
| 文档 | `metadata.documentation` 完整，并与实现同步 |
| 安全 | 不包含域名、密钥、Cookie、个人数据或 `host:` 执行器 |

上传、启用和停用属于管理员写操作。校验失败时插件不会安装；已安装协议停用后，模型配置入口不再提供该协议。

## 4. Agent 工具请求协议

如果协议同时服务于画布 Agent，请额外声明 `agent` 和 `agentResponse`。`agent.fields` 的右侧可以访问：

- `request.model`
- `request.extra.agent.chatCompletion.*`
- `request.extra.agent.responses.*`

这样同一个插件可以由字段映射决定第三方的消息、工具定义和工具选择，不需要在前端为某个模型写死 URL 或请求格式。示例：

```json
{
  "agent": {
    "method": "POST",
    "path": "/v1/chat/completions",
    "fields": {
      "model": "request.model",
      "messages": "request.extra.agent.chatCompletion.messages",
      "tools": "request.extra.agent.chatCompletion.tools",
      "tool_choice": "request.extra.agent.chatCompletion.tool_choice"
    }
  },
  "agentResponse": {
    "textPaths": ["choices.0.message.content"],
    "reasoningPaths": ["choices.0.message.reasoning_content"],
    "toolCallsPath": "choices.0.message.tool_calls",
    "toolCallIdPaths": ["id"],
    "toolCallNamePaths": ["function.name"],
    "toolCallArgumentsPaths": ["function.arguments"]
  }
}
```

`agentResponse` 的路径支持对象和数组下标（例如 `choices.0.message.content`）。第三方返回的 `tool_calls[].function.arguments` 可以是 JSON 字符串，也可以是 JSON 对象；宿主会统一转换为 Agent 合同要求的字符串。Agent 请求仍由后端统一负责鉴权、私网/本机上游校验、超时、日志和计费；插件只负责字段映射与结果解析。

## 5. 运行边界

声明式插件是请求协议运行时：它负责第三方 HTTP 方法、相对路径、请求字段映射、同步/异步响应解析、轮询状态、任务 ID、错误消息和结果地址。系统渠道和用户自建渠道只要选择了明确的协议，都会经过后端协议运行时，不依赖前端为某个模型硬编码请求格式。

宿主负责鉴权、Base URL 版本归一化、私网/本机上游安全校验、出站请求、超时、并发、计费、轮询生命周期、结果下载和任务恢复。内置的 multipart、签名鉴权、特殊媒体下载等协议仍由宿主内置 adapter 承担；上传的第三方插件必须使用声明式字段映射，不能上传可执行代码。
