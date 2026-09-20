# A6api 接口说明

## 鉴权

`Authorization: Bearer sk-xxxxxxxxxxxxxxxxxxxxxxxx`

## 文本对话

POST `https://api.a6api.com/chat/completions`

请求体 OpenAI Chat Completions 格式：`model`、`messages`、`temperature`、`max_tokens`、`tools`、`tool_choice`、`response_format`、`stream` 等。

响应 `choices[0].message.content` 为正文，`choices[0].message.reasoning_content` 为推理内容，`usage` 为用量。

## 图像生成

POST `https://api.a6api.com/images/generations`

请求体：`model`、`prompt`、`n`、`size`、`quality`、`response_format`。

响应 `data[].url` 或 `data[].b64_json`。

## 图像编辑

POST `https://api.a6api.com/images/edits`（multipart，带参考图时使用）

## 模型列表

GET `https://api.a6api.com/models`