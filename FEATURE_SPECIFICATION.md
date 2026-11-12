# 官方素材库、推荐审核与音频参考 - 功能说明书

## 文档概要

本文档为上游开发者提供完整的功能说明，包括架构设计、API接口、数据模型、集成指南和验证步骤。

---

## 1. 功能架构总览

### 1.1 核心模块关系

```
┌─────────────────────────────────────────────────────────────┐
│                     创作画布（Canvas）                        │
├────────────────┬─────────────────┬──────────────┬───────────┤
│  官方素材引用   │   角色卡分享     │  音频参考    │  推荐    │
│ (canvas_share) │ (character_copy) │ (audio_refs) │ (audit)  │
└────────────────┴─────────────────┴──────────────┴───────────┘
        │                │              │              │
        ↓                ↓              ↓              ↓
   ┌─────────────────────────────────────────────────────────┐
   │            官方素材库核心服务层（official_assets）       │
   │  - 素材CRUD、权限控制、生命周期管理                      │
   └─────────────────────────────────────────────────────────┘
        │                                    │
        ├─ 推荐审核流程                       └─ 音频状态管理
        │  (official_asset_recommendations)    (cloud_agent_audio_state)
        │
        └─ 数据访问层 (repository/)
           - official_assets.go
           - official_asset_recommendations.go
           - official_asset_reference_audit.go
           - canvas_official_resource.go
```

### 1.2 4个功能的独立性与关联

| 功能 | 依赖模块 | 核心文件 | 前端入口 |
|------|---------|---------|---------|
| 官方素材库 | repository/app/handler | official_assets.go | admin-assets-page.tsx |
| 推荐审核 | 官方素材库 | official_asset_recommendations.go | admin-recommendations-page.tsx |
| 角色卡分享 | canvas_share | official_character_copy.go | canvas-character-reference-modal |
| 音频参考 | cloud_agent/* | cloud_agent_audio_state.go | canvas-audio-settings-popover |

---

## 2. 功能详细说明

### 2.1 官方素材库 (Official Assets)

#### 目的
提供平台级别的素材管理，区分个人用户素材和平台官方认证素材，支持权限隔离、版本管理、生命周期控制。

#### 核心概念

**OfficialAsset** - 官方素材条目
```go
type OfficialAsset struct {
    ID                   string        // 唯一标识
    Type                 string        // 类型：character / prompt / background
    Title                string        // 素材名称
    Description          string        // 描述
    PreviewImageURL      string        // 预览图
    CharacterSnapshot    []byte        // 角色卡快照（JSON）
    Status               string        // 状态：draft/published/archived
    CreatedAt            time.Time
    PublishedAt          *time.Time
    ArchivedAt           *time.Time
}
```

#### 主要操作

| 操作 | 权限 | 入口 |
|------|------|------|
| 创建素材 | 平台管理员 | 管理后台 → 新增素材 |
| 编辑信息 | 管理员 | 管理后台 → 素材详情 |
| 发布/下架 | 管理员 | 管理后台 → 批量操作 |
| 画布引用 | 所有用户 | 画布右侧栏 → 素材库选择器 |
| 删除 | 管理员 | 管理后台 → 删除确认 |

#### API端点

**后端：`backend/internal/handler/official_asset_routes.go`**

| 方法 | 路由 | 功能 | 权限 |
|------|------|------|------|
| GET | `/api/official-assets` | 列表（分页、筛选） | 所有用户 |
| GET | `/api/official-assets/{id}` | 详情 | 所有用户 |
| POST | `/api/official-assets` | 创建 | 管理员 |
| PATCH | `/api/official-assets/{id}` | 编辑 | 管理员 |
| DELETE | `/api/official-assets/{id}` | 删除 | 管理员 |
| POST | `/api/official-assets/{id}/publish` | 发布 | 管理员 |
| POST | `/api/official-assets/{id}/archive` | 下架 | 管理员 |

**前端：`web/src/services/api/official-assets.ts`**

```typescript
// 列表查询
export async function fetchOfficialAssets(filter: OfficialAssetPageFilter)

// 详情
export async function getOfficialAsset(id: string)

// 管理操作
export async function createOfficialAsset(req: CreateOfficialAssetRequest)
export async function updateOfficialAsset(id: string, req: UpdateOfficialAssetRequest)
export async function publishOfficialAsset(id: string)
export async function archiveOfficialAsset(id: string)
```

#### 画布集成

在画布中使用官方素材：

```typescript
// 1. 打开素材库选择器
canvas.openOfficialAssetPicker()

// 2. 用户选择素材
const asset = selectedAsset  // OfficialAsset

// 3. 素材绑定到节点
canvas.bindAsset(nodeId, asset)

// 4. 保存时审计日志
// → repository/official_asset_reference_audit.go 记录引用关系
```

#### 权限隔离

- **个人素材库**：用户私有，不公开
- **官方素材库**：管理员发布，所有用户可见
- **审计日志**：记录所有引用关系，用于后续统计、下架处理

---

### 2.2 素材推荐与人工审核 (Asset Recommendations)

#### 目的
建立用户→管理员→发布的内容流转机制，支持社区贡献优化素材库质量。

#### 核心概念

**OfficialAssetRecommendation** - 推荐条目
```go
type OfficialAssetRecommendation struct {
    ID                 string        // 唯一标识
    SubmittedBy        string        // 推荐用户ID
    SubmittedAsset     []byte        // 素材JSON快照
    Type               string        // 推荐类型
    Title              string        // 标题
    Reason             string        // 推荐理由
    SnapshotJSON       []byte        // 完整快照
    Status             string        // 审核状态：pending/approved/rejected/published
    ReviewedBy         *string       // 审核员ID
    ReviewReason       *string       // 审核意见
    SubmittedAt        time.Time
    ReviewedAt         *time.Time
    ConssentVersion    *int          // 用户同意版本
    ConsentAt          *time.Time
}
```

#### 流转状态机

```
用户提交
   ↓
[pending] → 管理员审核
   ├─ [approved] → 管理员编辑 → [published]
   ├─ [rejected] ← 用户修改 → [pending]
   └─ [deleted]
```

#### API端点

**路由：`backend/internal/handler/official_asset_recommendation_routes.go`**

| 方法 | 路由 | 功能 | 权限 |
|------|------|------|------|
| GET | `/api/official-asset-recommendations` | 管理员看板 | 管理员 |
| POST | `/api/official-asset-recommendations` | 用户提交 | 所有用户 |
| PATCH | `/api/official-asset-recommendations/{id}` | 管理员审核 | 管理员 |
| GET | `/api/official-asset-recommendations/{id}` | 详情 | 提交者/管理员 |

#### 审核工作流

```typescript
// 1. 用户提交
submitRecommendation({
  type: "character",
  title: "新角色模板",
  reason: "适合短剧使用",
  snapshot: characterData
})

// 2. 管理员查看
fetchRecommendations({ status: "pending" })

// 3. 批量审核
batchReviewRecommendations([
  { id: "rec-1", action: "approve", note: "质量不错" },
  { id: "rec-2", action: "reject", note: "需要补充信息" }
])

// 4. 发布为官方素材
publishRecommendation(recId) 
  // → 自动创建 OfficialAsset
  // → 关联原始推荐
```

---

### 2.3 角色卡分享 (Character Card Sharing)

#### 目的
支持用户快速复制官方或他人的角色设定，加速内容创作。

#### 核心概念

分享包含：
- 角色基本信息（名字、描述）
- 造型集合（多个造型配置）
- 音色参考（绑定的音频）
- 设定参数（性格、背景等）

#### 操作流程

```
用户A创作角色 → 保存为角色卡快照
   ↓
通过分享链接/二维码 → 用户B访问
   ↓
用户B点击"使用此角色" 
   ↓
导入到用户B的画布
   ↓
可选：标记为官方推荐 → 进入素材推荐流程
```

#### 实现细节

**保存快照**：`backend/internal/app/official_character_copy.go`

```go
// 创建角色卡快照
snapshot := CharacterSnapshot{
    ID:       uuid.New().String(),
    Name:     character.Name,
    Outfits:  character.Outfits,      // 所有造型
    VoiceRef: character.VoiceRef,      // 音色绑定
    Settings: character.RawSettings,   // 设定JSON
    CreatedBy: userID,
    CreatedAt: time.Now(),
}
```

**使用快照**：

```typescript
// 前端：canvas-character-reference-modal.tsx
// 1. 解析分享数据
const snapshot = parseCharacterSnapshot(shareCode)

// 2. 导入到画布
importCharacterToCanvas(snapshot)

// 3. 用户可编辑后保存
canvas.saveProject()
```

#### 前端集成

```typescript
// 画布中的角色卡节点
interface CharacterNode {
  type: "character"
  snapshot?: CharacterSnapshot  // 来自官方或分享
  editable: boolean
  
  // 操作
  edit()        // 编辑设定
  share()       // 分享此角色
  import()      // 导入他人角色
}
```

---

### 2.4 音频参考与音色绑定 (Audio References)

#### 目的
支持用户上传参考音频，为角色绑定特定音色，优化语音生成质量。

#### 核心概念

**音频模式**（两种）：

| 模式 | 说明 | 适用场景 |
|------|------|---------|
| **TTS** | AI自动生成 | 快速原型、临时配音 |
| **unified_edit** | 上传参考音频 | 精细控制、角色音色复用 |

**音色绑定**：

```go
type AudioVoiceBinding struct {
    CharacterNodeID string  // 角色节点ID
    AudioNodeID     string  // 参考音频节点ID
    VoiceProfile    string  // 音色标签（可选）
}
```

#### 状态机设计

**音频生成决策流程**：

```
用户选择生成音频
   ↓
检查是否有参考音频（unified_edit模式）
   ├─ 有 → 使用参考音频作为音色参考
   │  └─ Doubao TTS（streaming mode）
   └─ 无 → 使用TTS自动生成
      └─ 随机或推荐音色

生成完成
   ↓
保存音频 + 音色绑定关系
   ↓
后续相同角色可复用此音色
```

#### API与状态

**后端实现**：`backend/internal/app/cloud_agent_audio_state.go`

```go
// 读取音频状态
func cloudAgentAudioReferenceState(meta, doc map[string]any) map[string]any {
    // 返回当前画布的音频模式、绑定关系、可用性
    return map[string]any{
        "mode": "unified_edit",  // 或 "tts"
        "voiceBindings": []{
            {"characterNodeId": "char-1", "audioNodeId": "audio-1"}
        },
        "bindingScope": "current_generation"
    }
}

// 验证音频连接
func validateCloudAgentConnection(nodes, fromId, toId string) error {
    // 只允许：
    // 1. 参考音频 → 目标音频
    // 2. 角色 + 参考音频 → 目标音频
}
```

**前端集成**：`web/src/components/canvas/canvas-audio-settings-popover.tsx`

```typescript
interface AudioSettingsProps {
  mode: "tts" | "unified_edit"      // 模式选择
  voiceBindings: AudioVoiceBinding[] // 角色-音频绑定
  onModeChange: (mode) => void
  onBindingUpdate: (binding) => void
}

// 用户操作：
// 1. 切换模式 → 更新 CloudAgent meta
// 2. 绑定音色 → 添加到 voiceBindings
// 3. 预览音频 → canvas-reference-audio-preview 播放
```

**预览与试听**：`web/src/components/canvas/canvas-reference-audio-preview.tsx`

```typescript
// 实时预览参考音频
<AudioPreview 
  audioNode={selectedAudioNode}
  characterName="角色名"
  onPlaybackComplete={() => {}}
/>
```

#### Doubao流式TTS集成

**插件配置**：`plugin-packages/doubao-streaming-tts/`

```json
{
  "name": "doubao-streaming-tts",
  "version": "1.0.0",
  "protocol": "openai-compatible",
  "endpoints": {
    "audio/generation": {
      "method": "POST",
      "params": {
        "mode": "tts|unified_edit",
        "voiceRef": "audio_node_id",
        "voiceBindings": [{"characterId": "...", "audioId": "..."}]
      }
    }
  }
}
```

---

## 3. 数据模型与数据库设计

### 3.1 核心表结构

**表：official_assets**
```sql
CREATE TABLE official_assets (
    id STRING PRIMARY KEY,
    type VARCHAR(32),           -- character/prompt/background
    title VARCHAR(255),
    description TEXT,
    preview_image_url TEXT,
    character_snapshot_json LONGBLOB,  -- 新增，保存完整快照
    status VARCHAR(32),         -- draft/published/archived
    created_at TIMESTAMP,
    published_at TIMESTAMP,
    archived_at TIMESTAMP
);

CREATE INDEX idx_official_assets_status ON official_assets(status);
CREATE INDEX idx_official_assets_type ON official_assets(type);
```

**表：official_asset_recommendations**
```sql
CREATE TABLE official_asset_recommendations (
    id STRING PRIMARY KEY,
    submitted_by VARCHAR(255),
    submitted_asset_json LONGBLOB,
    type VARCHAR(32),
    title VARCHAR(255),
    reason TEXT,
    snapshot_json LONGBLOB,
    status VARCHAR(32),         -- pending/approved/rejected/published
    reviewed_by VARCHAR(255),
    review_reason TEXT,
    submitted_at TIMESTAMP,
    reviewed_at TIMESTAMP,
    consent_version INT,        -- 新增，用户同意版本
    consent_at TIMESTAMP        -- 新增，同意时间
);

CREATE INDEX idx_recommendations_status ON official_asset_recommendations(status);
CREATE INDEX idx_recommendations_submitted_by ON official_asset_recommendations(submitted_by);
```

**表：official_asset_imports** （记录使用关系）
```sql
CREATE TABLE official_asset_imports (
    id STRING PRIMARY KEY,
    asset_id STRING REFERENCES official_assets(id),
    imported_by VARCHAR(255),
    project_id STRING,
    node_id STRING,
    imported_at TIMESTAMP
);

CREATE INDEX idx_imports_asset ON official_asset_imports(asset_id);
```

**表：canvas_official_resources** （画布中的官方资源绑定）
```sql
CREATE TABLE canvas_official_resources (
    id STRING PRIMARY KEY,
    canvas_id STRING,
    asset_id STRING REFERENCES official_assets(id),
    asset_type VARCHAR(32),
    reference_kind VARCHAR(32),  -- character/background/etc
    created_at TIMESTAMP
);
```

### 3.2 迁移策略

使用独立的 Yingce 迁移链（`yingce_schema_migrations`），与上游主线迁移分离：

```go
// backend/internal/database/migrations.go

var yingceSchemaMigrations = []migration{
    {version: 1, name: "official_assets", ...},
    {version: 2, name: "official_asset_recommendations", ...},
    {version: 3, name: "official_character_snapshots", ...},
    {version: 4, name: "official_recommendation_consent", ...},
}

// 迁移记录与上游分离，避免版本冲突
func (yingceSchemaMigration) TableName() string { 
    return "yingce_schema_migrations" 
}
```

---

## 4. 集成指南

### 4.1 启用官方素材库

**步骤1：运行数据库迁移**
```bash
# 自动执行 yingceSchemaMigrations
go run ./backend/cmd/server/main.go
```

**步骤2：注册API路由**

在 `backend/internal/handler/api.go` 中：
```go
func RegisterCanvasAPI(api *gin.RouterGroup, svc *service.Service) {
    RegisterOfficialAssetRoutes(api, svc)
    RegisterOfficialAssetRecommendationRoutes(api, svc)
    // ... 其他路由
}
```

**步骤3：前端路由配置**

在 `web/src/router.tsx` 中：
```typescript
{
    path: "/admin/assets",
    element: <OfficialAssetsPage />
},
{
    path: "/admin/recommendations",
    element: <OfficialAssetRecommendationsPage />
}
```

### 4.2 在画布中集成素材引用

**修改素材选择器**：`web/src/components/canvas/asset-picker-modal.tsx`

```typescript
<AssetPickerModal
  tabs={["personal", "official"]}  // 新增official标签
  onSelect={(asset) => {
    canvas.bindAsset(currentNodeId, asset)
  }}
/>
```

### 4.3 音频参考集成

**在Agent配置中启用**：

```typescript
// web/src/lib/canvas/cloud-agent-events.ts

interface CloudAgentMediaOptions {
    audioMode?: "tts" | "unified_edit"
    voiceBindings?: AudioVoiceBinding[]
}

// 在生成请求中传递
generateMedia({
    options: {
        audioMode: "unified_edit",
        voiceBindings: [...]
    }
})
```

---

## 5. 验证与测试

### 5.1 后端测试覆盖

**文件**：`backend/internal/app/*_test.go`

- `official_assets_test.go` (273行)
  - 权限验证
  - 生命周期管理（draft → published → archived）
  - 冲突检测

- `official_asset_recommendations_test.go` (40行)
  - 推荐流程（pending → approved → published）
  - 同意管理

- `canvas_official_resource_test.go` (65行)
  - 资源绑定
  - 审计日志

- `cloud_agent_audio_binding_test.go` (56行)
  - 模式验证（TTS vs unified_edit）
  - 音色绑定

### 5.2 前端测试

**文件**：`web/test/*.test.ts`

- `canvas-audio-voice-bindings.test.ts` (24行)
  - 绑定编译
  - 参数推导

**运行测试**：
```bash
# 后端
go test ./backend/internal/app -v -run "Official|Audio"

# 前端
npm test -- canvas-audio-voice-bindings
```

### 5.3 集成验证清单

- [ ] 管理后台能访问官方素材库页面
- [ ] 能创建、编辑、发布官方素材
- [ ] 画布选择器显示官方素材标签
- [ ] 用户可以在画布中引用官方素材
- [ ] 推荐流程：用户提交 → 管理员审核 → 发布
- [ ] 音频设置面板能切换模式（TTS ↔ unified_edit）
- [ ] 能绑定角色与参考音频
- [ ] 音频预览组件能正常播放
- [ ] 生成任务时正确传递音频参数

---

## 6. 性能考虑

### 6.1 缓存策略

**官方素材列表**（缓存5分钟）：
```go
const OfficialAssetsCacheTTL = 5 * time.Minute

func getOfficialAssets(filter Filter) ([]OfficialAsset, error) {
    cacheKey := fmt.Sprintf("official_assets:%s", hashFilter(filter))
    if cached := cache.Get(cacheKey); cached != nil {
        return cached, nil
    }
    
    assets, err := repo.FetchAssets(filter)
    if err == nil {
        cache.Set(cacheKey, assets, OfficialAssetsCacheTTL)
    }
    return assets, err
}
```

### 6.2 数据库索引

已创建的关键索引：
- `official_assets(status, type)`
- `official_asset_recommendations(status, submitted_by)`
- `canvas_official_resources(asset_id)`

### 6.3 前端性能

- **分页加载**：素材库默认每页20条
- **虚拟滚动**：管理后台列表使用虚拟滚动
- **图片优化**：预览图使用缩略图（200x200）

---

## 7. 未来扩展方向

### 7.1 版本管理

```go
// 支持素材版本控制
type OfficialAssetVersion struct {
    AssetID   string
    Version   int
    Snapshot  []byte
    CreatedAt time.Time
}
```

### 7.2 协作审核

```go
// 多管理员审核流程
type ReviewApproval struct {
    RecommendationID string
    ApprovedBy       []string  // 多个审核员
    ApprovedAt       []time.Time
}
```

### 7.3 素材推荐算法

```go
// 基于使用频率和评分的推荐
func GetRecommendedAssets(userId string, context CreationContext) []OfficialAsset
```

### 7.4 A/B测试

```go
// 测试不同的素材组合对创意质量的影响
type AssetABTest struct {
    ID        string
    VariantA  []string  // 素材集合A
    VariantB  []string  // 素材集合B
    Metrics   map[string]float64
}
```

---

## 8. 故障排查

### 问题：官方素材在画布中无法引用

**检查清单**：
1. 验证数据库迁移已执行：`SELECT * FROM yingce_schema_migrations`
2. 检查素材状态为 `published`
3. 前端检查浏览器控制台的API错误
4. 查看后端日志：`grep -i "official.*asset" logs/`

### 问题：推荐审核页面空白

**可能原因**：
- 管理员权限未配置
- `official_asset_recommendation_routes` 未注册
- 检查 `backend/internal/handler/api.go` 中是否调用了 `RegisterOfficialAssetRecommendationRoutes`

### 问题：音频绑定不生效

**调试步骤**：
1. 检查 `cloud_agent_audio_state.go` 中的绑定验证逻辑
2. 查看生成请求中是否包含 `voiceBindings` 参数
3. Doubao TTS插件是否正确初始化：`GET /api/plugins/doubao-streaming-tts/status`

---

## 9. 贡献指南

### 如何扩展官方素材库

1. **新增素材类型**：
   - 在 `official_assets.go` 中添加新的 `type` 枚举
   - 对应的前端UI组件

2. **自定义审核流程**：
   - 修改 `official_asset_recommendations.go` 的状态机
   - 更新前端审核UI

3. **新增音频模式**：
   - 在 `cloud_agent_audio_state.go` 中注册新模式
   - 更新音频设置面板UI

---

## 附录：API请求示例

### 创建官方素材
```bash
POST /api/official-assets HTTP/1.1
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "type": "character",
  "title": "标准短剧角色模板",
  "description": "...",
  "previewImageUrl": "https://...",
  "characterSnapshot": {
    "name": "李明",
    "settings": {...}
  }
}
```

### 提交素材推荐
```bash
POST /api/official-asset-recommendations HTTP/1.1
Authorization: Bearer <user-token>
Content-Type: application/json

{
  "type": "character",
  "title": "我的角色创意",
  "reason": "适合喜剧场景",
  "snapshot": {...}
}
```

### 绑定音色
```typescript
// 前端
await updateCanvasMetadata({
  audioMode: "unified_edit",
  audioVoiceBindings: [
    {
      characterNodeId: "char-node-1",
      audioNodeId: "audio-ref-node-1"
    }
  ]
})
```

---

**文档版本**：1.0  
**最后更新**：2026-11-12  
**作者**：Codex AI
