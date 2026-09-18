# 火山方舟 Agent Plan 图片生成

本插件面向火山方舟 Agent Plan 专属图片入口。请求体与官方 Ark Seedream 协议一致，但 Base URL 与 API Key 必须来自 Agent Plan 控制台。

## 接口、鉴权与区域

{{OPERATIONS}}

```http
POST {channel_base_url}/api/plan/v3/images/generations
Authorization: Bearer <AGENT_PLAN_API_KEY>
Content-Type: application/json
```

与官方 `/api/v3` 的差异：

| 项 | 官方 Ark | Agent Plan |
| --- | --- | --- |
| Base URL | `https://ark.cn-beijing.volces.com/api/v3` | `https://ark.cn-beijing.volces.com/api/plan/v3` |
| API Key | 推理接入控制台 Key | Agent Plan 专属 Key |
| 计费 | 推理后付费/项目额度 | AFP 套餐抵扣 |
| 请求体 | Seedream images/generations | 同左 |

不要把官方 Key 打到 `/api/plan/v3`，也不要把 Agent Plan Key 打到 `/api/v3`。

## 参数与字段映射

{{PARAMETERS}}

当前实现：`aspectRatio -> size`，所有 `images -> image[]`；`extra` 可透传 `size`、`sequential_image_generation`、`sequential_image_generation_options`、`watermark`。

## 官方资料

- [火山方舟 Agent Plan 文档](https://www.volcengine.com/docs/82379/2375486)
- [火山方舟视觉模型 API 文档](https://www.volcengine.com/docs/82379)

{{CONTRACT}}
