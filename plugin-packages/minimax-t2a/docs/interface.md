# MiniMax T2A 语音合成 接口字段

## 协议身份

- 插件 ID：`minimax-t2a`。
- Provider ID：`minimax-t2a`。
- 能力：`audio`。
- 默认 Base URL：`https://api.minimaxi.com`。
- 鉴权驱动：`bearer`。
- 创建：`POST /v1/t2a_async_v2`。
- 查询：`GET /v1/query/t2a_async_query_v2?task_id={{taskId}}`。
- 结果：`GET /v1/files/retrieve_content?file_id={{taskId}}`。
- 媒体：`requiresPublicMediaUrls: false`（纯文本入参，不需要公网可访问的素材地址）。

MiniMax 的异步长文本语音合成是**三步链路**：建任务 → 轮询 → 下载音频字节。
它没有 OpenAI 兼容的单次返回形态，因此本插件必须独立声明 `result` 端点：
查询接口在成功时才给出 `file_id`，音频字节要从文件接口单独取。

## 配置字段

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `apiKey` | secret | 是 | API Key |

## 统一字段映射

| 统一字段 | 类型 | 必填 | 上游映射 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `model` | 语音模型 ID，如 `speech-02-hd`。 |
| `prompt` | string | 是 | `text` | 待合成文本。 |
| `providerOptions` | object | 否 | `provider-specific fields` | 插件命名空间内的厂商扩展字段（音色/语速/音量/音调/情感/采样率/格式/声道）。 |

## 上游请求模板逐字段清单

下表由插件请求模板生成，覆盖 body、query 和 headers 中的每个字段。

| 上游位置 | 值或转换表达式 |
| --- | --- |
| `create.method` | `"POST"` |
| `create.path` | `"/v1/t2a_async_v2"` |
| `create.contentType` | `"application/json"` |
| `create.body.model` | `{"$ref":"request.model"}` |
| `create.body.text` | `{"$ref":"request.prompt"}` |
| `create.body.voice_setting.voice_id` | `{"$coalesce":[{"$ref":"request.providerOptions.minimax-t2a.voice_id"},{"$ref":"request.extra.audioVoice"},"male-qn-qingse"]}` |
| `create.body.voice_setting.speed` | `{"$coalesce":[{"$ref":"request.providerOptions.minimax-t2a.speed"},{"$ref":"request.extra.audioSpeed"}]}` |
| `create.body.voice_setting.vol` | `{"$coalesce":[{"$ref":"request.providerOptions.minimax-t2a.vol"}]}` |
| `create.body.voice_setting.pitch` | `{"$coalesce":[{"$ref":"request.providerOptions.minimax-t2a.pitch"}]}` |
| `create.body.voice_setting.emotion` | `{"$coalesce":[{"$ref":"request.providerOptions.minimax-t2a.emotion"}]}` |
| `create.body.audio_setting.audio_sample_rate` | `{"$coalesce":[{"$ref":"request.providerOptions.minimax-t2a.sample_rate"},32000]}` |
| `create.body.audio_setting.bitrate` | `128000` |
| `create.body.audio_setting.format` | `{"$coalesce":[{"$ref":"request.providerOptions.minimax-t2a.format"},{"$ref":"request.extra.audioFormat"},"mp3"]}` |
| `create.body.audio_setting.channel` | `{"$coalesce":[{"$ref":"request.providerOptions.minimax-t2a.channel"},1]}` |
| `poll.method` | `"GET"` |
| `poll.path` | `"/v1/query/t2a_async_query_v2?task_id={{taskId}}"` |
| `poll.contentType` | `"application/json"` |
| `result.method` | `"GET"` |
| `result.path` | `"/v1/files/retrieve_content?file_id={{taskId}}"` |

### 两个必须注意的取值约定

- **音色优先取插件命名空间**，再回落到 `extra.audioVoice`（对外 API 的 OpenAI `voice` 参数走这条），
  最后默认 `male-qn-qingse`。上游没有 `voice_id` 会直接回 `2013 invalid params, no voice_id found`，
  所以缺省音色必须发一个合法值，而不是省略字段 —— 「面板里选了模型就能出活」比
  「必须先去别处挑一个音色」更符合画布用法。
- **未给出的数值字段整体省略**（`$coalesce` 落空即不写该键）。上游对 `null` 按参数错误处理，
  例如未提供 `pitch` 时不能发 `"pitch": null`。

## Provider 扩展键

- `providerOptions.minimax-t2a.voice_id` — 音色 ID（预设音色、克隆音色或音色设计生成的 `ttv-voice-…` 均可）
- `providerOptions.minimax-t2a.speed` — 语速 0.5–2.0
- `providerOptions.minimax-t2a.vol` — 音量 0.1–3.0
- `providerOptions.minimax-t2a.pitch` — 音调 −12–12（仅 `speech-02` 系列）
- `providerOptions.minimax-t2a.emotion` — 情感（仅 `speech-02` 系列）
- `providerOptions.minimax-t2a.sample_rate` — 采样率 8000/16000/32000/44100/48000
- `providerOptions.minimax-t2a.format` — 音频格式 mp3/wav/flac
- `providerOptions.minimax-t2a.channel` — 声道 1/2

## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.taskId` | `{"$if":{"condition":{"$eq":[{"$lower":{"$ref":"response.status"}},"success"]},"then":{"$ref":"response.file_id"},"else":{"$ref":"response.task_id"}}}` |
| `response.status` | `{"$lower":{"$ref":"response.status"}}` |
| `response.errorPaths[0]` | `"base_resp.status_code"` |
| `response.messagePaths[0]` | `"base_resp.status_msg"` |
| `response.resultKind` | `"audio"` |

### 响应形状的两个陷阱

- **字段都在顶层，没有 `data` 包装**：`task_id` / `file_id` / `status` 直接挂在响应根上。
- **`task_id` 与 `file_id` 是数字，且不是同一个数**。官方文档示例里
  `task_id = 95157322514444`、`file_id = 95157322514496`。处理中要继续用 `task_id` 轮询，
  成功后才切换到 `file_id` 下载 —— 这就是 `response.taskId` 那条 `$if` 的由来。

## 响应与错误

插件把上游 `task_id`/`file_id`/`status`/音频字节映射为统一结果。
创建与查询接口都返回**顶层** `base_resp`，业务错误码在 `base_resp.status_code`、
原因在 `base_resp.status_msg`；参数错误时 `task_id` 是 `0`，此时必须把真实原因
（例如 `invalid params, no voice_id found`）浮上来，不能被宿主的兜底解析盖成
「字段类型不对」。HTTP 错误、业务 code 保持失败语义，不包装成成功。

音频字节以 `resultKind: "audio"` 交给宿主，宿主按音频媒体处理并持久化。

## 兼容边界

- 只覆盖 **异步** 长文本语音合成（`t2a_async_v2`）。MiniMax 的同步 `t2a_v2`、
  音色设计、音色克隆属于**控制面**接口（不是生成任务），不在协议插件的职责范围内。
- 语速/音量/音调/情感四组参数里，`pitch` 与 `emotion` 仅 `speech-02` 系列支持；
  `speech-01` 系列传入会被上游忽略或报错，由调用方按模型选择。
- `status` 取值 `processing`/`success`/`failed`/`expired` 统一归一：`success` → 成功，
  `failed`/`expired` → 失败，其余视为处理中。
- Base URL 默认 `https://api.minimaxi.com`；MiniMax 另提供 `api.minimax.chat` /
  `api.minimax.io` 等域名，部署方可在渠道配置里覆盖。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "minimax-t2a",
  "name": "MiniMax T2A 语音合成",
  "version": "3.0.0",
  "author": "MiniMax / 趣影",
  "description": "通过 MiniMax 异步语音合成 API（/v1/t2a_async_v2 + /v1/query/t2a_async_query_v2 + /v1/files/retrieve_content）合成语音。",
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>",
  "permissions": [
    "generation.run",
    "media.read"
  ],
  "configuration": {
    "fields": [
      {
        "name": "apiKey",
        "type": "secret",
        "label": "API Key",
        "required": true
      }
    ]
  },
  "contributes": {
    "providers": [
      {
        "id": "minimax-t2a",
        "label": "MiniMax T2A 语音合成",
        "capabilities": [
          "audio"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://api.minimaxi.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "parameters": [
          {
            "name": "text",
            "type": "string",
            "mapping": "request.prompt",
            "description": "要合成的文本"
          },
          {
            "name": "model",
            "type": "string",
            "mapping": "request.model",
            "description": "speech-02-hd 等"
          },
          {
            "name": "voice_id",
            "type": "string",
            "mapping": "providerOptions.voice_id",
            "description": "音色 ID（预设音色、克隆音色或音色设计生成的 ttv-voice-… 均可）"
          },
          {
            "name": "speed",
            "type": "number",
            "mapping": "providerOptions.speed",
            "description": "语速 0.5-2.0"
          },
          {
            "name": "vol",
            "type": "number",
            "mapping": "providerOptions.vol",
            "description": "音量 0.1-3.0"
          },
          {
            "name": "pitch",
            "type": "number",
            "mapping": "providerOptions.pitch",
            "description": "音调 -12~12（仅 speech-02 系列）"
          },
          {
            "name": "emotion",
            "type": "string",
            "mapping": "providerOptions.emotion",
            "description": "情感（仅 speech-02 系列）"
          },
          {
            "name": "sample_rate",
            "type": "integer",
            "mapping": "providerOptions.sample_rate",
            "description": "采样率 8000/16000/32000/44100/48000"
          },
          {
            "name": "format",
            "type": "string",
            "mapping": "providerOptions.format",
            "description": "音频格式 mp3/wav/flac"
          },
          {
            "name": "channel",
            "type": "integer",
            "mapping": "providerOptions.channel",
            "description": "声道 1/2"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/t2a_async_v2",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "text": {
              "$ref": "request.prompt"
            },
            "voice_setting": {
              "voice_id": {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.minimax-t2a.voice_id"
                  },
                  {
                    "$ref": "request.extra.audioVoice"
                  },
                  "male-qn-qingse"
                ]
              },
              "speed": {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.minimax-t2a.speed"
                  },
                  {
                    "$ref": "request.extra.audioSpeed"
                  }
                ]
              },
              "vol": {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.minimax-t2a.vol"
                  }
                ]
              },
              "pitch": {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.minimax-t2a.pitch"
                  }
                ]
              },
              "emotion": {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.minimax-t2a.emotion"
                  }
                ]
              }
            },
            "audio_setting": {
              "audio_sample_rate": {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.minimax-t2a.sample_rate"
                  },
                  32000
                ]
              },
              "bitrate": 128000,
              "format": {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.minimax-t2a.format"
                  },
                  {
                    "$ref": "request.extra.audioFormat"
                  },
                  "mp3"
                ]
              },
              "channel": {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.minimax-t2a.channel"
                  },
                  1
                ]
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/query/t2a_async_query_v2?task_id={{taskId}}",
          "contentType": "application/json"
        },
        "result": {
          "method": "GET",
          "path": "/v1/files/retrieve_content?file_id={{taskId}}"
        },
        "response": {
          "taskId": {
            "$if": {
              "condition": {
                "$eq": [
                  {
                    "$lower": {
                      "$ref": "response.status"
                    }
                  },
                  "success"
                ]
              },
              "then": {
                "$ref": "response.file_id"
              },
              "else": {
                "$ref": "response.task_id"
              }
            }
          },
          "status": {
            "$lower": {
              "$ref": "response.status"
            }
          },
          "errorPaths": [
            "base_resp.status_code"
          ],
          "messagePaths": [
            "base_resp.status_msg"
          ],
          "resultKind": "audio"
        }
      }
    ]
  }
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
