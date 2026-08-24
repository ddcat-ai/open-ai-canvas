# Upload a request protocol plugin

The upload entry currently installs **declarative request protocol plugins** only. These plugins translate Yingce's unified text, image, video, or audio requests into upstream HTTP API calls and parse upstream responses. Asset sources, canvas nodes, workflows, Agent tools, and UI extensions must still be registered by application code and cannot be installed here from JSON.

## 1. Prepare the manifest

The uploaded file must be UTF-8 JSON and no larger than 512 KiB. Plugin IDs use lowercase kebab-case, request paths must be relative, and manifests must not contain domains, cookies, or API keys.

```json
{
  "apiVersion": "v1",
  "metadata": {
    "id": "acme-video",
    "name": "Acme Video API",
    "version": "1.0.0",
    "vendor": "Acme",
    "description": "Acme video generation protocol adapter",
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
        "description": "Upstream model name"
      },
      {
        "name": "prompt",
        "type": "string",
        "required": true,
        "mapping": "input.prompt",
        "description": "Video description"
      },
      {
        "name": "duration",
        "type": "integer",
        "mapping": "input.seconds",
        "description": "Generation duration in seconds"
      }
    ],
    "documentation": "# Acme Video API\n\nWrite complete Markdown integration documentation here."
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

Keys on the left side of `fields` are upstream request paths. Values on the right refer to Yingce request fields. Synchronous protocols need only `create` and `response`; asynchronous protocols also declare `poll`. A manifest cannot run JavaScript or use a `host:` executor.

### Synchronous text responses

A text model does not always need task creation and polling. When the upstream create request returns text directly, declare only `create` and `response`:

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

- `response.textPaths` checks each path in order for the response text. Object paths and array indexes are supported.
- `response.reasoningPaths` is optional and reads reasoning content. Omitting it does not affect normal text parsing.
- If `statusPaths` is absent but text or media output is parsed, the host treats the response as successful.
- `agentResponse` parses Agent tool responses only and is independent from the normal text `response`.

## 2. Write integration documentation

`metadata.documentation` is the Markdown body shown on the plugin details page, not an optional summary. At minimum, document:

- API and authentication: method, path, headers, and content type for create, query, and cancel endpoints.
- Models and parameters: available model names, types, required fields, defaults, allowed values, and field mappings.
- Asset limits: count, format, size, duration, and URL accessibility requirements.
- Requests and responses: real examples for accepted, processing, completed, and failed states.
- Polling and downloads: status values, recommended interval, timeout, and result URL lifetime.
- Error handling: HTTP statuses, upstream error fields, content moderation, and quota limits.

Paths, model names, and response fields in the documentation must match the manifest. The details page supports headings, tables, lists, blockquotes, links, and code blocks rendered as GitHub Flavored Markdown.

## 3. Pre-upload checklist

| Item | Requirement |
| --- | --- |
| Identity | `apiVersion` is `v1`; ID is kebab-case; name and version are present |
| Capabilities | At least one `category` and one `scope` are declared |
| Request | Method is supported, path is relative, and mappings come from `request.*` |
| Response | Task ID, status, error, and result URL paths match real responses |
| Documentation | `metadata.documentation` is complete and matches the implementation |
| Security | No domain, credential, cookie, personal data, or `host:` executor is included |

Upload, enable, and disable actions require administrator access. A plugin is not installed when validation fails. After an installed protocol is disabled, model configuration no longer offers it.

## 4. Agent tool request protocols

When the protocol also serves the canvas Agent, declare `agent` and `agentResponse`. Values on the right side of `agent.fields` may access:

- `request.model`
- `request.extra.agent.chatCompletion.*`
- `request.extra.agent.responses.*`

The same plugin can map third-party messages, tool definitions, and tool choices without hard-coding a model URL or request shape in the frontend:

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

Paths in `agentResponse` support object fields and array indexes such as `choices.0.message.content`. The returned `tool_calls[].function.arguments` may be a JSON string or object; the host converts it to the string required by the Agent contract. The backend still owns authentication, private or local upstream validation, timeouts, logging, and billing. The plugin only maps fields and parses results.

## 5. Runtime boundaries

A declarative plugin is a request protocol runtime. It defines the third-party HTTP method, relative path, request field mappings, synchronous or asynchronous response parsing, polling states, task IDs, error messages, and result URLs. System channels and user-defined channels with an explicit protocol both use the backend protocol runtime instead of frontend model-specific request code.

The host owns authentication, Base URL version normalization, private or local upstream validation, outbound requests, timeouts, concurrency, billing, polling lifecycle, result downloads, and task recovery. Built-in adapters still handle multipart requests, signed authentication, and specialized media downloads. Uploaded third-party plugins must use declarative field mappings and cannot contain executable code.
