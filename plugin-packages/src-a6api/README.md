# A6api

A6api 模型网关协议插件。统一入口 `https://api.a6api.com`，OpenAI 兼容（`Authorization: Bearer <api_key>`）。

## Providers

| Provider | 能力 | 端点 |
|---|---|---|
| a6api-chat | text | POST /chat/completions |
| a6api-image | image | POST /images/generations、POST /images/edits |

## 配置

在渠道中填写 API Key（A6api 控制台创建，形如 `sk-xxxxxxxx`），baseUrl 使用 `https://api.a6api.com`。

## 说明

- 模型名以 A6api 模型市场当前列表为准。
- 图像编辑（带参考图）走 `/images/edits` multipart 请求。
- 错误体为 OpenAI 风格，携带 `request_id`。