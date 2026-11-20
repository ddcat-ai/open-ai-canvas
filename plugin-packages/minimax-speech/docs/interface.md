# MiniMax 语音合成接口

## 协议

- Provider ID：`minimax-speech`，能力：`audio`。
- 默认地址：`https://api.minimax.cn`。
- 鉴权：`Authorization: Bearer <API Key>`。
- 配置字段：`apiKey`，必填，保存于渠道密钥配置。
- 创建：`POST /v1/t2a_v2`，同步、非流式。
- 请求使用 `model`、`text`、`voice_setting.voice_id`、`voice_setting.speed` 和 `audio_setting.format`；`output_format=url` 返回临时音频 URL，由宿主立即下载持久化。
- `base_resp.status_code` 非零时视为失败。没有音频 URL 时也不会交付空结果。

## 响应

`data.audio` 是临时音频 URL，`base_resp.status_code` 和 `base_resp.status_msg` 是业务状态与错误信息。

支持的模型 ID：`speech-2.8-hd`、`speech-2.8-turbo`、`speech-2.6-hd`、`speech-2.6-turbo`、`speech-02-hd`、`speech-02-turbo`。

音色 ID 可使用 MiniMax 系统音色或账户已有的复刻音色。未指定时使用 `male-qn-qingse`；格式默认 MP3，语速默认 1。官方接口单次文本须小于 10000 字符。

依据：[MiniMax 同步语音合成 API](https://platform.minimax.cn/docs/api-reference/speech-t2a-http)。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "minimax-speech",
  "name": "MiniMax 语音合成",
  "version": "1.0.0",
  "author": "MiniMax / 影策",
  "description": "MiniMax 同步文字转语音协议。",
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
        "id": "minimax-speech",
        "label": "MiniMax 语音合成",
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
        "baseUrl": "https://api.minimax.cn",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "parameters": [
          {
            "name": "model",
            "type": "string",
            "required": true,
            "mapping": "model",
            "values": [
              "speech-2.8-hd",
              "speech-2.8-turbo",
              "speech-2.6-hd",
              "speech-2.6-turbo",
              "speech-02-hd",
              "speech-02-turbo"
            ],
            "description": "MiniMax 语音模型 ID。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "text",
            "description": "待合成文本。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "provider-specific fields",
            "description": "可通过 minimax-speech.voice 指定音色 ID。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/t2a_v2",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "text": {
              "$ref": "request.prompt"
            },
            "stream": false,
            "output_format": "url",
            "voice_setting": {
              "voice_id": {
                "$coalesce": [
                  {
                    "$ref": "request.extra.audioVoice"
                  },
                  {
                    "$ref": "request.providerOptions.minimax-speech.voice"
                  },
                  "male-qn-qingse"
                ]
              },
              "speed": {
                "$coalesce": [
                  {
                    "$if": {
                      "condition": {
                        "$ne": [
                          {
                            "$toFloat": {
                              "$ref": "request.extra.audioSpeed"
                            }
                          },
                          0
                        ]
                      },
                      "then": {
                        "$toFloat": {
                          "$ref": "request.extra.audioSpeed"
                        }
                      },
                      "else": null
                    }
                  },
                  1
                ]
              }
            },
            "audio_setting": {
              "format": {
                "$coalesce": [
                  {
                    "$ref": "request.extra.audioFormat"
                  },
                  "mp3"
                ]
              }
            }
          }
        },
        "response": {
          "status": "succeeded",
          "errorPaths": [
            "base_resp.status_code"
          ],
          "messagePaths": [
            "base_resp.status_msg"
          ],
          "audios": {
            "$ref": "response.data.audio"
          },
          "resultEphemeral": true
        }
      }
    ]
  },
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
