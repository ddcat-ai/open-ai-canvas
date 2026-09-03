# M4 转写与渲染任务设计（增量）

> 状态：M4.1–M4.3 已实现并提交（执行侧 e9d1b8ad、创建 API bf26ebb1、前端字幕回写 fd5e8139、
> 渲染任务 3f16d13b）。本文按实现回写；任何出入以 `backend/internal/service/` 现行代码为准。
> 参考锚点：`task_worker.go`、`backend/internal/repository/repository.go`、
> `backend/internal/handler/routes.go`（各小节内另行标注实现文件）。

## 1. 现状边界（调研结论）

现有模型生成链路对"任务"的约定：

- `CreateTask`（`task_creation.go`）：draining 检查 → prompt/type 校验 → **模型路由**
  `resolveTaskModelSelection`（绑定 logical model / revision / route / channel model / billing）→
  额度与活跃任务配额 → 落库 `queued`。`text_replay` 是唯一旁路（前端自管、不排队）。
- worker（`task_worker.go`）：`ClaimNextTask` **不过滤 task type**——任何 `queued` 都会被模型
  worker 领取；`processClaimedTask` 随后做二次路由、billing `MarkRunning`、provider 执行、
  `handleSuccess`（billing settle + session/message 落库）。
- 结论（实现，修正原草案）：M4 任务**进入同一公共队列**，由唯一 worker 池领取
  （`ClaimNextTask` 不过滤类型），但在 `processClaimedTask` 顶部按类型分叉到独立执行器，
  **不经计费与模型渠道路由**（`beginTaskRouteAttempt` / `MarkBillingRunning` /
  `routeExecutor` / `handleSuccess` 全部跳过）；终态分别走 `SaveTaskCompletion`（成功）/
  `UpdateTaskTerminalState`（失败）。

## 2. 架构决策

1. **新任务类型常量**（放 `backend/internal/model`，与 `TaskStatus*` 并列）：
   - `TaskTypeTimelineTranscription = "timeline_transcription"`
   - `TaskTypeTimelineRender = "timeline_render"`
   两者都不经过 `validateTaskType` 白名单（创建走独立入口）。
2. **创建走独立 API 与 service 方法**（不经过 `POST /api/tasks` 的模型路由/计费入口）：
   - `POST /api/timeline/transcriptions`（M4.1，`CreateTimelineTranscriptionTask`）
   - `POST /api/timeline/renders`（M4.2，`CreateTimelineRenderTask`）
   - 两路由**注册在 `RegisterTaskRoutes` 内**（挂载于 `/api` 组），复用任务路由组的
     鉴权/限流骨架（限流键 `timeline-ts:<userID>` 等），非独立路由组。
   - 复用现有任务基础设施：同一 `tasks` 表、同一 `TaskStatus` 状态机、租约/取消原语；
     无 billing/session/message 关联（`BillingOrderID` 为空，收尾走旁路终态）。
   - 查询与取消**复用现有端点**：`GET /api/tasks/:id`、`POST /api/tasks/:id/cancel`
     （service 的 `Task()` / `CancelTask()` 均与 task type 无关，已核对）。
3. **单一 worker 池，领取不过滤**（实现修正原草案）：`ClaimNextTask` **不加类型过滤**
   ——worker 是 queued 任务的唯一领取方，若按类型排除会使两类新任务无人领取；改为在
   `processClaimedTask` 顶部按 `task.Type` 分叉（见决策 4）。任务类型常量从 `model` 包引入。
4. **`processClaimedTask` 顶部按类型分叉**：在 cancelled 复查之后、stage 覆盖/路由之前，
   `timeline_transcription` → `processTimelineTranscription(task, ctx)`（`task_timeline.go`）、
   `timeline_render` → `processTimelineRender(task, ctx)`（`task_render.go`），复用外层已建立的
   租约续期、`registerActiveTask`（取消即时生效）与超时 context 框架。超时
   `taskExecutionTimeoutWithPolicy` 分叉：转写 **20 分钟**、渲染 **60 分钟**（草案 30 分钟已改）。
5. **旁路终态**：转写/渲染成功不用 `handleSuccess`，`ResultJSON` 落盘后
   `repo.SaveTaskCompletion(task, running, nil, nil, nil)`（清租约由框架现有 defer 完成）；
   失败走 `repo.UpdateTaskTerminalState(failed, stage, message, now)` 记可读错误。日志沿用 `s.log`。

## 3. M4.1 转写任务规格

### 3.1 输入（`POST /api/timeline/transcriptions` body，路由注册于 `RegisterTaskRoutes`）

```jsonc
{
  "resourceId": "string",   // 必填，音频/视频资源；校验归属且存在
  "language": "zh",         // 可选，默认空 = whisper 自动检测
  "projectId": "string"     // 可选，记录到任务归属字段（ProjectID）
}
```

校验顺序（`CreateTimelineTranscriptionTask`）：`IsDraining`(503) → `RequireFeature`
（timelineTranscription，默认开）→ `Resource()` 归属读取（失败提示"无法读取待转写媒体，
可能已被删除"）→ `isTranscribableMime`（失败提示"仅支持音视频文件转写"）→
`RuntimePolicy` → 配额入队（`createTaskWithinStorageQuota`，无 billing order；
`repository.ErrActiveTaskLimit` → 可读 400）→ 落库 `queued`
（Stage="等待队列调度"、Progress=5、Provider=local、Model=whisper.cpp，
`InputJSON = {"resourceId","language"}`）。

### 3.2 输出 JSON 形状（`ResultJSON`，成功时）

```jsonc
{
  "segments": [
    { "startMs": 0, "endMs": 3200, "text": "字幕文本…" }
  ],
  "srt": "1\n00:00:00,000 --> 00:00:03,200\n字幕文本…",
  "language": "zh"
}
```

毫秒为整型（`timelineTranscriptionSegment{StartMs,EndMs,Text}`）。前端（M4.3）把
`segments` 映射为 `SrtEntry[]`（index = i+1）后直接 `rebuildSubtitleClips` 写入字幕轨道，
不做二次解析；`srt` 供导出。

### 3.3 状态机

与现有 Task 完全一致：`queued → running(claim) → succeeded | failed | cancelled`；
stage/progress 由 `processTimelineTranscription` 内更新：
`"等待转写服务"`(progress 15) → `"正在转写…"`(40) → `"整理字幕…"`(80) → succeeded(100)。
取消：外层 `registerActiveTask` 的 cancel ctx 令 provider HTTP 调用中断（需在请求中透传
`ctx`）。

### 3.4 转写执行实现（`transcription_whisper.go`，未引入独立 Provider 包）

- `whisperClient`（`newWhisperClient`）：baseURL 取自环境变量 `CANVAS_WHISPER_BASE_URL`
  （§3.6 已决：独立 env，非模型渠道）。
- `transcribe(ctx, wavPath, language)`：本地 ffmpeg 预处理为 16k 单声道 PCM wav
  （`prepareWhisperWav`），POST `{baseURL}/inference`，multipart `file` 字段，
  `response_format=verbose_json`；ctx 随外层任务 context 透传（取消即时生效）。
- `decodeWhisperVerboseJSON` → `timelineTranscriptionResult{Segments,SRT,Language}`；
  `formatSRTTimestamp` / `buildTimelineSRT` 生成 SRT（对齐 `HH:MM:SS,mmm`）。

### 3.5 任务执行（`task_timeline.go` 内 `processTimelineTranscription`）

1. 解密 `InputJSON` → 校验 `resourceId`；`Resource()` 读取并做 user scope 归属校验。
2. `isTranscribableMime`（audio/video）前置校验；ffmpeg 预处理 16k 单声道 PCM wav。
3. 转写（stage/progress：等待转写服务 15 → 正在转写… 40 → 整理字幕… 80 → 完成 100）。
4. `ResultJSON` 落盘（3.2 形状）→ `repo.SaveTaskCompletion`；失败走
   `repo.UpdateTaskTerminalState` 记可读错误（未配置 `CANVAS_WHISPER_BASE_URL` 时
   明确失败并提示设置）。

### 3.6 已决项

- baseURL：**环境变量 `CANVAS_WHISPER_BASE_URL`**（whisper.cpp HTTP，语音数据不出本机）；
  `.env.example` 已补充。
- 语言：`language` 直传 whisper `language=`，空 = 自动检测。
- feature gate：`FeatureTimelineTranscription`（availability JSON
  `timelineTranscriptionEnabled`，默认开；未开时 `RequireFeature` → Forbidden
  "字幕转写暂未开放"）。
- ffmpeg 路径：`CANVAS_FFMPEG_PATH`（可空，空则 PATH 查找；转写/渲染/播放副本共用）。

## 4. M4.2 渲染任务（已实现：`task_render.go` + `timeline_render_plan.go` + `task_timeline.go` 创建侧）

- `POST /api/timeline/renders`（注册于 `RegisterTaskRoutes`）：body =
  `{projectId, timeline}`；timeline 为 v2 快照（tracks/clips 平铺，`renderProject`），片段经
  `directMedia.storageKey = "resource:"+<id>` 引用后端资源。
- 创建（`CreateTimelineRenderTask`）：draining(503) → `buildRenderPlan` 校验 ≥1 个可渲染
  媒体片段（否则 400 "时间线没有可渲染的媒体片段"）→ 配额入队（Provider=local、
  Model=ffmpeg、Stage="等待队列调度"、Progress=5）。
- 执行（`processTimelineRender`，60 分钟超时）：`buildRenderPlan` 展开合成脚本 → 本地
  ffmpeg（`CANVAS_FFMPEG_PATH` 或 PATH 查找）→ 产物写资源存储（`storeResource` 路径）→
  `ResultJSON` = `{"resourceId","fileName","size","durationMs","subtitleSrt"?}`
  （`subtitleSrt`：时间线含字幕轨时携带导出的 SRT 文本，可空）。
- 终态旁路（同 §2 决策 5）；无 billing/session/message 关联。

## 5. 数据库/文档同步

- 无 schema 变更（复用 tasks 表）。任务 type 以字符串存储，无须迁移。
- `auth.go` 的 API 前缀白名单已加 `timeline`（防 NoRoute 短代理把未匹配的
  `/api/timeline/*` 当渠道请求）。
- 同步更新 `docs/content/docs/progress/pending-test.mdx`（gitignore，仅本地）与
  Runbook M4 章节的 API 表格（端点/入参/出参），以及权限文档中的 feature gate。
  本文 §2–§4 已按实现回写，仍以代码为准。
