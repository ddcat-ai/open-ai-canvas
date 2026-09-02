# M4 转写与渲染任务设计（增量）

> 状态：M4.1 设计定稿，待实现。事实锚点以 `backend/internal/service/task_creation.go`、
> `task_worker.go`、`backend/internal/repository/task.go`、`backend/internal/handler/routes.go`
> 现行代码为准。

## 1. 现状边界（调研结论）

现有模型生成链路对"任务"的约定：

- `CreateTask`（`task_creation.go`）：draining 检查 → prompt/type 校验 → **模型路由**
  `resolveTaskModelSelection`（绑定 logical model / revision / route / channel model / billing）→
  额度与活跃任务配额 → 落库 `queued`。`text_replay` 是唯一旁路（前端自管、不排队）。
- worker（`task_worker.go`）：`ClaimNextTask` **不过滤 task type**——任何 `queued` 都会被模型
  worker 领取；`processClaimedTask` 随后做二次路由、billing `MarkRunning`、provider 执行、
  `handleSuccess`（billing settle + session/message 落库）。
- 结论：**M4 转写/渲染任务不能以普通任务进入公共队列**，否则会被当模型任务执行并因缺少
  模型路由/计费上下文而失败；也不能复用 `handleSuccess` 的 billing 收尾。

## 2. 架构决策

1. **新任务类型常量**（放 `backend/internal/model`，与 `TaskStatus*` 并列）：
   - `TaskTypeTimelineTranscription = "timeline_transcription"`
   - `TaskTypeTimelineRender = "timeline_render"`
   两者都不经过 `validateTaskType` 白名单（创建走独立入口）。
2. **创建走独立 API 与 service 方法**（不经过 `POST /api/tasks`）：
   - `POST /api/timeline/transcription`（M4.1，`CreateTimelineTranscriptionTask`）
   - `POST /api/timeline/render`（M4.2，`CreateTimelineRenderTask`）
   - 复用现有任务基础设施：同一 `tasks` 表、同一 `TaskStatus` 状态机、租约/取消原语；
     无 billing/session/message 关联（`BillingOrderID` 为空，收尾走旁路终态）。
   - 查询与取消**复用现有端点**：`GET /api/tasks/:id`、`POST /api/tasks/:id/cancel`
     （service 的 `Task()` / `CancelTask()` 均与 task type 无关，已核对）。
3. **worker 领取加类型过滤**：`repository.ClaimNextTask` 增加
   `AND type NOT IN ('timeline_transcription','timeline_render')`，模型 worker 永不领取
   两类新任务。常量从 `model` 包引入（repository 不 import service）。
4. **`processClaimedTask` 顶部按类型分叉**：在 cancelled 复查之后、stage 覆盖/路由之前，
   若 `task.Type` 为两类新任务 → `processTimelineTask(task)`（新文件
   `task_timeline.go`），复用外层已建立的租约续期、`registerActiveTask`（取消即时生效）
   与超时 context 框架。超时在 `taskExecutionTimeoutWithPolicy` 加分支：
   `timeline_transcription` / `timeline_render` 使用 30 分钟。
5. **旁路终态**：转写/渲染成功不用 `handleSuccess`，直接
   `repo.UpdateTaskTerminalState(succeeded)` + 清租约（与框架现有 defer 配合）；
   失败走 `repo.MarkTaskFailed`（沿用租约清理语义）。日志沿用 `s.log`。

## 3. M4.1 转写任务规格

### 3.1 输入（`POST /api/timeline/transcription` body）

```jsonc
{
  "projectId": "string",          // 必填，校验归属且 project active
  "resourceId": "string",         // 必填，音频/视频资源；校验归属且存在
  "language": "zh",               // 可选，默认空 = 自动检测
  "operation": "transcribe"       // 可选，透传日志
}
```

校验：`RequireTimelineFeature`（feature gate）→ draining → 资源归属
（`GetResource` 类读取 + user scope）→ 资源 mime 属于音频或视频 → 活跃任务配额
（复用 `ActiveTaskCountForUser` 同一限额）→ 落库 `queued`，
`InputJSON = {"resourceId","language"}`（不含项目名以外的敏感字段）。

### 3.2 输出 JSON 形状（`ResultJSON`，成功时）

```jsonc
{
  "srt": "1\n00:00:00,000 --> 00:00:03,200\n字幕文本…",
  "segments": [
    { "id": 0, "start": 0.0, "end": 3.2, "text": "字幕文本…", "speaker": "" }
  ],
  "language": "zh",
  "durationMs": 3200,
  "provider": "whisper",
  "model": "whisper-1"            // provider 回传的实际模型标识，可空
}
```

`segments` 直接对接前端 `timeline-build.ts` 的 `TimelineSegment`（id/start/end/text），
前端字幕轨道回写不再做二次解析；`srt` 供导出。

### 3.3 状态机

与现有 Task 完全一致：`queued → running(claim) → succeeded | failed | cancelled`；
stage/progress 由 `processTimelineTask` 内更新：
`"等待转写服务"`(progress 15) → `"正在转写…"`(40) → `"整理字幕…"`(80) → succeeded(100)。
取消：外层 `registerActiveTask` 的 cancel ctx 令 provider HTTP 调用中断（需在请求中透传
`ctx`）。

### 3.4 Provider 接口（`backend/internal/service/transcription/`）

```go
package transcription

type Segment struct {
    ID      int     `json:"id"`
    Start   float64 `json:"start"`
    End     float64 `json:"end"`
    Text    string  `json:"text"`
    Speaker string  `json:"speaker"`
}

type Result struct {
    Text       string    `json:"text"`
    Segments   []Segment `json:"segments"`
    Language   string    `json:"language"`
    DurationMS int64     `json:"durationMs"`
    Model      string    `json:"model"`
}

// Provider 是 ASR 提供方接口。实现必须遵守 ctx 取消。
type Provider interface {
    Transcribe(ctx context.Context, audio io.Reader, opts Options) (*Result, error)
}

type Options struct {
    Language string
    // 元信息（可选透传给服务端日志）
    Filename string
    MimeType string
}
```

whisper HTTP 实现（`whisper_http.go`）：`POST {baseURL}/inference?response_format=json`
multipart `file` 字段；读 `model.BaseURL`（whisper 服务是"自建模型渠道"还是独立 baseURL
配置，实现时按现有渠道配置读取方式接入——见 3.6 开放项）。超时与重试收敛在实现内。

### 3.5 任务执行（`task_timeline.go` 内 `processTranscriptionTask`）

1. 解密 `InputJSON` → 校验 `resourceId`。
2. `OpenResource`（user scope 校验在 service 内）拿媒体流 + mime。
3. `transcription.Provider.Transcribe(ctx, reader, {Language})`。
4. 由 `Result.Segments` 生成 SRT（对齐现有 `srt-parser` 的时间码格式
   `HH:MM:SS,mmm`）与 `ResultJSON`（3.2 形状）。
5. `repo.UpdateTaskTerminalState(succeeded, resultJSON, "" )` + 记日志。

### 3.6 开放项（实现前需确认）

- whisper 服务 baseURL 的配置入口：现有模型渠道（managed channel）还是新环境变量
  `CANVAS_WHISPER_BASE_URL`。倾向后者（转写不属于生成模型计费域），实现时以
  `.env.example` 补充为准。
- 语言参数映射（`zh` → whisper `language=zh`）。
- feature gate 名称：`timeline-transcription`，纳入 `RequireFeature` 机制与
  `docs/content/docs/backend/backend-database.mdx` 之外的权限文档。

## 4. M4.2 渲染任务（占位，M4.1 落地后细化）

- `POST /api/timeline/render`：输入 = projectId + timeline 快照（tracks/segments 的
  JSON，见 `timeline-to-ffmpeg.ts` 现有映射）→ 落 `timeline_render` 任务。
- 执行：`render.Provider`（ffmpeg HTTP/exec 包装）→ 产物写资源存储
  （`storeResourceObject` 路径，M4 规格的资源输出形态）→ `ResultJSON` 记录
  resourceId。终态同样旁路。

## 5. 数据库/文档同步

- 无 schema 变更（复用 tasks 表）。任务 type 以字符串存储，无须迁移。
- 同步更新 `docs/content/docs/progress/pending-test.mdx` 与 Runbook M4 章节的
  API 表格（端点/入参/出参），以及权限文档中新增 feature gate 与 API 前缀
  `timeline`（`auth.go` 的 API 前缀白名单需加 `timeline`）。
