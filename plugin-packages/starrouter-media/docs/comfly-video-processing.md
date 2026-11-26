# Comfly 视频处理合同

## 工作流入参

通过 Comfly 生产环境只读 `GET /internal/comfly/workflows/batch-get-input-fields` 查询，`1194`、`1776`、`1849` 均返回同一个字段数组：

```json
[{ "type": "video", "field": "input_video", "desc": "", "is_list": false }]
```

没有公开倍率、字幕区域、分辨率、帧率或深度参数。字段接口没有声明输出编码、音轨保留策略、处理效果和上游时长/尺寸限制，不据此承诺固定倍率、HEVC、保留音频或逐帧对齐。

## StarRouter 请求与结果

| Provider | 固定上游型号 | 产品操作 |
| --- | --- | --- |
| `starrouter-comfly-video-subtitle-removal` | `comfly/1194` | `remove_subtitles` |
| `starrouter-comfly-video-depth` | `comfly/1776` | `depth` |
| `starrouter-comfly-video-upscale` | `comfly/1849` | `upscale` |

以下是去字幕请求结构；另两项只替换 model，且须选匹配的 provider：

```json
{
  "model": "comfly/1194",
  "metadata": { "input_video": "https://media.example/source.mp4" }
}
```

- 创建：`POST /comfly/v1/videos`，Bearer 凭据为 StarRouter 模型调用 Key。
- 查询：`GET /comfly/v1/videos/{id}`，使用创建响应顶层 `id`，不用 `comfly.task_id`。
- 状态：`queued`、`in_progress`、`completed`、`failed`、`canceled` 映射到宿主统一任务状态；`error.code/message` 保持失败语义。
- 输出：成功后通过 `GET /comfly/v1/videos/{id}/content` 下载视频二进制，复用宿主的媒体持久化；不把内部 Comfly `data.files` 当作 StarRouter 响应。
- 取消：`POST /comfly/v1/videos/{id}/cancel`。
- 查询响应中的 `usage` 保留为上游用量，不假设包含输出时长。按秒产品价格仍须靠落库媒体探测时长结算，缺少时长沿用待核对处理。

## 宿主配置边界

只开放系统渠道与画布作用域。源媒体经宿主归属、就绪状态与媒体地址转换检查。StarRouter 支持 HTTP(S) URL 和带 MIME 的 Base64 Data URL，插件不强制公网 URL。本地验证可在渠道把视频发送方式设为 Base64，由后端从当前用户资源读取，不需要对外暴露本地服务。现有 StarRouter 文生视频 provider 保持原合同。

默认只接收一个视频，不提供输出规格，媒体上限采用 StarRouter 视频接口公开的 100 MiB。默认 180 秒是平台任务处理预算，不是工作流字段接口返回的供应商限制。工作流没有公开尺寸边界，因此不复用火山增强的 1080p 输入限制。

本次只查询真实输入合同；成片二进制合同依据 StarRouter 视频接口文档。真实效果、编码、音轨、输出大小、处理耗时和账单需要付费调用另行验收。
