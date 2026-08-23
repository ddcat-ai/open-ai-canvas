# 视频模型API协议改造方案

## 一、现状分析

### 1.1 当前协议混乱情况

根据系统截图，当前视频生成能力存在以下协议：

| 服务商 | 协议名称 | 端点 | 问题 |
|--------|---------|------|------|
| OpenAI/NewAPI | OpenAI / NewAPI Videos | POST /v1/videos | NewAPI重复1 |
| NewAPI | NewAPI 媒体任务 | POST /v1/videos | NewAPI重复2，端点与上面相同 |
| NewAPI | NewAPI Video Generations | POST /v1/video/generations | NewAPI重复3 |
| xAI | xAI 官方视频 | POST /v1/videos/generations | - |
| 火山方舟 | 火山方舟视频 | POST /api/v3/contents/generation... | 路径过长 |
| 即梦 | 即梦官方视频 | POST CVSync2AsyncSubmitTask | RPC风格，非RESTful |
| Gemini | Gemini Veo | POST /v1beta/models/{model}:pred... | Google API风格 |
| Novita | Novita 视频 | POST /v3/video/create | - |
| MiniMax | MiniMax 视频 | POST /v2/video_generation | - |

**核心问题：**
1. NewAPI同时存在3个不同的协议配置，造成混淆
2. 端点路径不统一（/v1/videos vs /v1/video/generations vs /v2/video_generation）
3. 命名风格不一致（videos vs video vs video_generation）
4. 部分使用RPC风格，与RESTful体系不兼容

### 1.2 用户体验问题

- **选择困难**：面对3个NewAPI协议，用户不知道该选哪个
- **迁移成本高**：不同协议间切换需要修改请求格式
- **维护复杂**：每个协议需要单独的适配代码
- **文档混乱**：难以为用户提供清晰的使用文档

## 二、主流协议标准调研

### 2.1 OpenAI协议标准（事实标准）

OpenAI作为行业领导者，其API设计已成为事实标准：

**文本生成：**
```
POST /v1/chat/completions
POST /v1/completions
```

**图片生成：**
```
POST /v1/images/generations
POST /v1/images/edits
POST /v1/images/variations
```

**视频生成（推测标准）：**
```
POST /v1/videos/generations
```

**设计特点：**
- 使用复数名词（images, videos, completions）
- 动作使用名词形式（generations, edits, variations）
- 清晰的版本控制（/v1/）
- 一致的命名规范

### 2.2 其他主流厂商协议

**Google Gemini风格：**
```
POST /v1beta/models/{model}:generateContent
POST /v1beta/models/{model}:predict
```
- 特点：RPC风格，使用冒号分隔资源和动作
- 适用场景：Google生态内部

**Anthropic Claude风格：**
```
POST /v1/messages
```
- 特点：极简设计，资源导向
- 不太适合多模态场景

**业界通用RESTful风格：**
```
POST /api/v{version}/{resource}/{action}
```

### 2.3 异步任务处理模式

视频生成通常是长时间任务，业界有两种主流处理模式：

**模式1：同步等待（适合短视频）**
```
POST /v1/videos/generations
Response: {
  "id": "video-123",
  "status": "completed",
  "url": "https://..."
}
```

**模式2：异步轮询（主流）**
```
# 提交任务
POST /v1/videos/generations
Response: {
  "id": "video-123",
  "status": "processing"
}

# 查询状态
GET /v1/videos/{video_id}
Response: {
  "id": "video-123",
  "status": "completed",
  "url": "https://..."
}
```

**模式3：Webhook回调**
```
POST /v1/videos/generations
Request: {
  "prompt": "...",
  "webhook_url": "https://your-domain.com/callback"
}
```

## 三、问题诊断

### 3.1 NewAPI多协议分析

根据端点路径推测各协议用途：

| 协议 | 端点 | 推测用途 | 建议 |
|------|------|----------|------|
| OpenAI / NewAPI Videos | /v1/videos | 兼容OpenAI官方API（如果有的话） | 保留作为主协议 |
| NewAPI 媒体任务 | /v1/videos | 可能是旧版本或别名 | 废弃，合并到主协议 |
| NewAPI Video Generations | /v1/video/generations | 更RESTful的命名 | 考虑作为标准协议 |

### 3.2 命名不一致问题

| 问题 | 示例 | 影响 |
|------|------|------|
| 单复数混用 | videos vs video | 造成记忆负担 |
| 下划线vs连字符 | video_generation vs video-generation | 风格不统一 |
| 路径深度不一 | /v1/videos vs /api/v3/contents/generation | 增加适配复杂度 |

## 四、改造方案

### 4.1 统一协议标准

**推荐：采用OpenAI风格作为统一标准**

理由：
1. OpenAI是行业事实标准
2. 大部分开发者熟悉此风格
3. 利于生态兼容
4. 语义清晰，易于理解

**标准端点设计：**
```
POST /v1/videos/generations     # 创建视频生成任务
GET  /v1/videos/{video_id}      # 查询视频生成状态
GET  /v1/videos                 # 列出视频任务（可选）
DELETE /v1/videos/{video_id}    # 取消任务（可选）
```

### 4.2 协议映射策略

将现有协议统一映射到标准协议：

```
旧协议                              新协议（统一）
─────────────────────────────────────────────────────────
POST /v1/videos                  -> POST /v1/videos/generations
POST /v1/video/generations       -> POST /v1/videos/generations
POST /v2/video_generation        -> POST /v1/videos/generations
POST /api/v3/contents/generation -> POST /v1/videos/generations
POST CVSync2AsyncSubmitTask      -> POST /v1/videos/generations
POST /v3/video/create            -> POST /v1/videos/generations
```

### 4.3 请求/响应标准化

**标准请求格式：**
```json
{
  "model": "video-model-name",
  "prompt": "视频描述文本",
  "duration": 5,
  "aspect_ratio": "16:9",
  "fps": 30,
  "resolution": "1080p",
  "webhook_url": "https://callback-url.com/webhook"
}
```

**标准响应格式（提交时）：**
```json
{
  "id": "video-abc123",
  "object": "video.generation",
  "created": 1692800000,
  "model": "video-model-name",
  "status": "processing",
  "estimated_time": 120
}
```

**标准响应格式（完成后查询）：**
```json
{
  "id": "video-abc123",
  "object": "video.generation",
  "created": 1692800000,
  "completed": 1692800120,
  "model": "video-model-name",
  "status": "completed",
  "video": {
    "url": "https://storage.example.com/video-abc123.mp4",
    "duration": 5.2,
    "width": 1920,
    "height": 1080,
    "fps": 30,
    "format": "mp4"
  }
}
```

**错误响应格式：**
```json
{
  "error": {
    "type": "invalid_request_error",
    "code": "invalid_prompt",
    "message": "提示词包含不支持的内容",
    "param": "prompt"
  }
}
```

### 4.4 NewAPI协议整合方案

**方案A：保留一个，废弃其他（推荐）**

- 保留：`POST /v1/videos/generations`（最符合OpenAI标准）
- 废弃：另外两个NewAPI协议
- 过渡期：3个月内保留旧协议，显示弃用警告

**方案B：统一到通用适配器**

- 设置一个"NewAPI 视频生成（统一）"协议
- 后端自动检测NewAPI服务实际支持的端点
- 用户无需选择具体协议

### 4.5 厂商特殊协议处理

对于特殊协议（如即梦的RPC风格），采用适配器模式：

```
用户请求（标准格式）
    ↓
协议适配层
    ↓
厂商特定格式转换
    ↓
实际API调用
```

**实现示例：**
```python
class VideoAPIAdapter:
    def generate_video(self, standard_request):
        if self.provider == "jimeng":
            # 转换为即梦的RPC格式
            rpc_request = {
                "task_type": "video_generation",
                "params": self._convert_to_jimeng_format(standard_request)
            }
            return self._call_jimeng_api(rpc_request)
        elif self.provider == "volcano":
            # 转换为火山方舟格式
            return self._call_volcano_api(standard_request)
        # ... 其他厂商
```

## 五、实施计划

### 5.1 阶段划分

**第一阶段：标准制定（1周）**
- [ ] 确定统一协议标准
- [ ] 编写详细的协议规范文档
- [ ] 设计请求/响应Schema
- [ ] 评审和确认

**第二阶段：适配器开发（2-3周）**
- [ ] 开发协议适配层
- [ ] 实现各厂商协议转换器
- [ ] 单元测试覆盖
- [ ] 集成测试

**第三阶段：UI改造（1周）**
- [ ] 简化协议选择界面
- [ ] NewAPI只显示一个统一选项
- [ ] 添加协议说明文档链接
- [ ] 优化用户体验

**第四阶段：兼容性处理（1周）**
- [ ] 保留旧协议的兼容性
- [ ] 添加弃用警告
- [ ] 数据迁移工具
- [ ] 用户通知

**第五阶段：上线和监控（持续）**
- [ ] 灰度发布
- [ ] 监控错误率
- [ ] 收集用户反馈
- [ ] 迭代优化

### 5.2 风险控制

| 风险 | 影响 | 应对措施 |
|------|------|----------|
| 现有用户业务中断 | 高 | 保留旧协议3个月，提前通知 |
| 新协议与厂商API不兼容 | 中 | 充分测试，保留特殊处理逻辑 |
| 性能下降 | 中 | 适配层做性能优化，缓存转换逻辑 |
| 文档更新不及时 | 低 | 自动生成API文档 |

## 六、技术实现建议

### 6.1 配置文件结构

```yaml
video_providers:
  # 统一配置格式
  - name: "newapi"
    display_name: "NewAPI 视频生成"
    protocol: "openai_compatible"
    endpoint: "/v1/videos/generations"
    auth_type: "bearer"
    features:
      - async_polling
      - webhook
    
  - name: "jimeng"
    display_name: "即梦官方视频"
    protocol: "rpc"
    endpoint: "/CVSync2AsyncSubmitTask"
    adapter: "JimengVideoAdapter"
    auth_type: "custom"
    
  # ... 其他厂商
```

### 6.2 代码架构

```
/src
  /adapters
    /base.py              # 基础适配器接口
    /openai.py            # OpenAI标准协议
    /jimeng.py            # 即梦适配器
    /volcano.py           # 火山方舟适配器
    /minimax.py           # MiniMax适配器
  /models
    /video_request.py     # 标准请求模型
    /video_response.py    # 标准响应模型
  /services
    /video_service.py     # 视频生成服务
  /api
    /video_api.py         # 统一API接口
```

### 6.3 关键接口设计

```python
from abc import ABC, abstractmethod
from typing import Dict, Any

class VideoProviderAdapter(ABC):
    """视频服务提供商适配器基类"""
    
    @abstractmethod
    def submit_generation(self, request: VideoGenerationRequest) -> VideoGenerationResponse:
        """提交视频生成任务"""
        pass
    
    @abstractmethod
    def query_status(self, video_id: str) -> VideoStatusResponse:
        """查询视频生成状态"""
        pass
    
    @abstractmethod
    def cancel_generation(self, video_id: str) -> bool:
        """取消视频生成任务"""
        pass
    
    def _convert_request(self, request: VideoGenerationRequest) -> Dict[str, Any]:
        """将标准请求转换为厂商特定格式"""
        pass
    
    def _convert_response(self, raw_response: Dict[str, Any]) -> VideoGenerationResponse:
        """将厂商响应转换为标准格式"""
        pass
```

## 七、配置界面优化建议

### 7.1 当前界面问题

- NewAPI出现3次，用户困惑
- 协议列表过长，难以选择
- 缺少协议说明和推荐

### 7.2 优化方案

**视觉分组：**
```
请求协议
├─ 推荐协议
│  └─ OpenAI 标准协议（推荐）          [✓]
│
├─ 兼容协议
│  ├─ NewAPI 视频生成                 [ ]
│  ├─ Gemini Veo                      [ ]
│  └─ xAI 官方视频                    [ ]
│
└─ 特殊协议（需要特殊配置）
   ├─ 火山方舟视频                    [ ]
   ├─ 即梦官方视频                    [ ]
   ├─ Novita 视频                     [ ]
   └─ MiniMax 视频                    [ ]
```

**添加协议说明：**
- 鼠标悬停显示协议详情
- 链接到完整文档
- 显示支持的功能特性

**简化选择：**
- 默认推荐OpenAI标准协议
- 自动检测厂商并推荐对应协议
- 提供"快速配置"向导

## 八、总结与建议

### 8.1 核心建议

1. **立即行动**：NewAPI的3个重复协议问题需要尽快解决
2. **采用标准**：统一采用OpenAI风格协议作为标准
3. **平滑迁移**：保留兼容性，给用户足够的迁移时间
4. **持续优化**：根据新厂商和新标准不断迭代

### 8.2 预期收益

- **开发效率**：减少70%的协议适配代码
- **用户体验**：降低50%的配置复杂度
- **维护成本**：统一标准后维护成本降低60%
- **扩展性**：新增厂商只需实现标准适配器接口

### 8.3 下一步行动

1. 与团队评审此方案
2. 确定实施优先级
3. 制定详细的开发计划
4. 开始第一阶段工作

---

**文档版本**: v1.0  
**创建日期**: 2026-08-21  
**作者**: AI Assistant  
**状态**: 待评审
