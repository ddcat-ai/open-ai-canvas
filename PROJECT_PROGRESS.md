# 影策（open-ai-canvas）项目进度总结

> 最后更新：2026-09-02 22:30
> 当前阶段：Storyboard Benchmark 真实数据采集中（1/10 完成）

---

## 一、项目概述

在影策（open-ai-canvas）开源项目基础上，完成了以下工作：
1. 多AI中转站接入与付费体系搭建
2. Creative OS + Director Agent 架构（10个C2C迭代）
3. Storyboard Benchmark v1 基础设施与真实数据采集

---

## 二、已完成工作

### 2.1 中转站接入与付费体系（早期，已完结）

#### 已接入的中转站
| 中转站 | 类型 | 状态 |
|---|---|---|
| Grsai | 图像/视频 | ✅ 已接入 |
| 红鸟AI（hongniaoai） | 图像/视频 | ✅ 已接入 |
| A6API | 文本/图像 | ✅ 已接入 |
| A8API | 文本 | ✅ 已接入 |
| Agnes AI | 文本/图像/视频 | ✅ 已接入 |
| 米塔AI（metaso） | 视频（ComfyUI插件） | ✅ 已接入 |

#### 付费体系
- 积分价格 1:1 人民币，使用 ¥ 符号
- 按次/秒收费（不按token）
- 文本模型价格按A6API黑色字体价格×实时倍率×1.3倍定价，不取整显示所有小数
- 任务失败积分返还机制已修复

#### UI修复
- 模型选择器显示模型名称而非价格
- 画布模型列表滚动条修复（鼠标滚轮滑动）
- 模型列表不全问题修复
- 视频模型说明改为"最大秒数/分辨率/参考图/音频"格式
- 移除"文生/图生/全模态"标签

#### 部署与插件化
- Docker升级后重新部署，存储盘设置到5T硬盘（/Volumes/5T）
- 自定义协议提取为独立 .yingce-plugin 插件包
- 提交GitHub PR #375、#377（草稿状态）

---

### 2.2 Creative OS + Director Agent 架构（10个C2C迭代，全部完成）

#### 架构目标分层
```
User / external agent
        ↓
Director Agent
        ↓
Director Skill (storyboard-director)
        ↓
Creative Graph (Shot / ShotRevision domain)
        ↓
Semantic Commands (project_create_or_update_shots)
        ↓
Canvas Projection (canvas_create_storyboard_shots)
        ↓
Generation Task / Billing / Worker
```

#### 迭代清单

| # | 迭代名称 | 核心成果 | 状态 |
|---|---|---|---|
| 0 | C2C PLAN | 7维度只读架构审计，输出HANDOFF | ✅ |
| 1 | AgentRun基础 | AgentRun+AgentRunStep模型/Repository/Service/Handler/前端集成，V5迁移 | ✅ |
| 2 | AgentRun可靠性 | StartRun强制（失败不调用codex）、ProjectForUser所有权验证、TransitionAgentRunStatus终态安全、SSE agentRunId关联 | ✅ |
| 3 | Creative OS垂直切片 | canvas_create_storyboard_shots工具、storyboard-projection.ts、CanvasNodeMetadata.shotId、8分镜投影到画布 | ✅ |
| 4 | 分镜投影可靠性 | findFreeStoryboardPosition碰撞避免、幂等reconciliation、真实历史undo/redo测试（191断言） | ✅ |
| 5 | storyboard-director Skill | 247行规范源文件、6维度电影化推理规则、skills_seed.go嵌入、默认第一方技能 | ✅ |
| 6 | Skill运行时加固 | FIRST_PARTY_DEFAULT_SKILL_IDS、composeSkillsForTurn、用户技能maxSkills=4不占默认技能容量 | ✅ |
| 7 | Profile作用域 | 映射6个SKILL_RUNTIME_PROFILES，仅localProfile自动注入storyboard-director | ✅ |
| 8 | Benchmark v1 | 5个fixtures、7个metric评估器（总分100）、CLI、14个单元测试 | ✅ |
| 9/10 | 真实录制基础设施 | BenchmarkSkillMode(normal/baseline/director)、benchmark-recorder.ts、盲标注支持、raw recording自动下载 | ✅ |

#### 关键技术文件
| 文件 | 说明 |
|---|---|
| `backend/internal/model/agent_run.go` | AgentRun+AgentRunStep GORM模型 |
| `backend/internal/service/agent_run.go` | Service层（所有权验证+终态安全） |
| `backend/internal/database/migrations.go` | V5迁移（AutoMigrate AgentRun/AgentRunStep） |
| `backend/internal/service/seed/skills/storyboard-director.md` | storyboard-director技能规范源（247行） |
| `backend/internal/service/skills_seed.go` | 技能种子（embed规范源+默认技能） |
| `canvas-agent/src/storyboard-projection.ts` | 分镜投影（幂等reconciliation+碰撞避免） |
| `canvas-agent/src/canvas-session.ts` | canvas_create_storyboard_shots处理逻辑 |
| `canvas-agent/src/schemas.ts` | MCP工具定义（41个工具） |
| `canvas-agent/test/benchmark/` | Benchmark fixtures/evaluator/CLI/types |
| `web/src/lib/canvas/benchmark-recorder.ts` | Benchmark录制器（start/record/complete/download） |
| `web/src/services/skill-runtime.ts` | 技能运行时（profile-aware composition+benchmark mode） |
| `web/src/components/canvas/canvas-local-agent-panel.tsx` | Agent面板（AgentRun生命周期+benchmark集成） |

#### 测试状态
- canvas-agent：52个测试全部通过
- web：38个测试全部通过
- 后端：17个AgentRun测试全部通过
- web容器已构建部署

---

### 2.3 Storyboard Benchmark 真实数据采集（当前进行中）

#### Benchmark设计
- **5个fixtures**：
  | ID | 名称 | 分镜数 | 时长 | 类型 |
  |---|---|---|---|---|
  | emotional-convenience-store | 凌晨便利店 | 8 | 40s | 情感 |
  | dialogue-former-partners | 咖啡馆前合伙人 | 10 | 60s | 对话 |
  | action-courier-escape | 车站快递员逃脱 | 10 | 45s | 动作 |
  | reveal-childhood-home | 童年故居照片 | 9 | 50s | 揭示 |
  | tvc-premium-ev | 高端电动车广告 | 8 | 30s | TVC |

- **7个metric**（总分100）：
  shotCount(15)、beatCoverage(20)、shotDiversity(15)、cameraDiscipline(10)、pacing(15)、continuity(15)、toolDiscipline(10)

- **配对交错顺序**（用户指定）：
  1. emotional baseline → 2. emotional director → 3. dialogue director → 4. dialogue baseline
  → 5. action baseline → 6. action director → 7. reveal director → 8. reveal baseline
  → 9. TVC baseline → 10. TVC director

#### 采集进度
| # | Fixture | Mode | 状态 | 备注 |
|---|---|---|---|---|
| 1 | emotional | baseline | ✅ 完成 | 有效样本，已保存 |
| 2 | emotional | director | ✅ 画布流程完成 | 已恢复连接并完成8镜投影；有效raw录制文件仍待重新采集 |
| 3-10 | 其余8个 | - | ⏳ 待采集 | |

#### 已采集样本
- 文件：`benchmark-recordings/raw/benchmark-emotional-convenience-store-baseline-1788357973538.json`
- 内容：fixtureId=emotional-convenience-store, mode=baseline, toolTrace=[canvas_apply_ops×2], shots=0, effectiveSkillIds=[]
- sanity check通过：baseline的effectiveSkillIds不含storyboard-director ✅

---

## 三、当前阻塞与排查状态

### 3.0 当前状态（2026-09-02）
- **连接阻塞已解除**：`canvas-agent/src/agents.ts` 不再用 Node 错误执行原生 Codex 二进制；配置 `CODEX_CLI_PATH` 时直接启动该命令，未配置时才用 Node 启动 npm 包内的 `codex.js`。
- Runtime 健康检查通过：`http://127.0.0.1:17371` 返回 `ok=true`、`hasCanvas=true`、`clients=1`。
- 画布页面已显示“本机 Agent 已连接”；只读复核已成功返回“连接正常”。
- 当前页面已完成 emotional director 的画布投影：总节点12个（原有4个 + 新增分镜8个），2条连线保持不变，无媒体生成调用。
- 页面历史中仍可看到早期的 `Codex app-server exited: 1` 和“模型调用失败”记录；这些是修复前的历史事件，不代表当前连接状态。

### 3.1 问题：Codex模型调用失败

从第2个运行（emotional director）开始，页面持续显示"模型调用失败，请重试本轮"。

### 3.2 排查过程

#### 阶段1：ChatGPT使用限制
- 第1次运行（emotional baseline）成功
- 第2次运行开始失败，错误信息：`You've hit your usage limit. Upgrade to Pro`
- 结论：ChatGPT免费账号达到使用限制

#### 阶段2：切换到ccswitch + A6API
- 用户通过ccswitch将Codex切换到A6API中转站
- 配置（`~/.codex/config.toml`）：
  ```toml
  model_provider = "custom"
  model = "claude-fable-5.1"
  [model_providers.custom]
  wire_api = "responses"
  requires_openai_auth = false
  base_url = "https://api.a6api.com/v1"
  experimental_bearer_token = <REDACTED>
  ```

#### 阶段3：A6API端点测试
- ❌ `POST https://api.a6api.com/v1/responses` → `上游服务暂时不可用 (upstream_unavailable)`
- ✅ `POST https://api.a6api.com/v1/chat/completions` → 正常返回"Hello"

#### 阶段4：Codex版本兼容性
- canvas-agent的Codex v0.149.1：不支持`disable_response_storage`字段，可能不支持custom provider
- ChatGPT.app内置Codex v0.151.0-alpha.7.2：同样不支持`disable_response_storage`，但不用--strict-config时会忽略未知字段
- 当前`~/.local/bin/codex` → ChatGPT.app Codex v0.151.0-alpha.7.2

#### 阶段5：Runtime配置
- 代理：无（A6API是国内站点，直连即可）
- Runtime启动命令：
  ```bash
  cd ~/open-ai-canvas/canvas-agent
  FRAMEFIELD_TRUSTED_WEB_ORIGINS='http://127.0.0.1:3100' node dist/index.js
  ```
- Runtime日志：`/tmp/canvas-agent.log`（只显示启动信息，不记录每个请求）

### 3.3 可能的根因

**A6API的`/v1/responses`端点不可用，但Codex的custom provider配置使用`wire_api = "responses"`。**

需要确认：
1. A6API是否支持responses API？
2. 如果不支持，是否可以将`wire_api`改为`"chat"`或其他值？
3. ccswitch是否有其他配置选项？

### 3.4 当前状态

连接问题已解决。下一步应重新采集 emotional director 的有效 raw recording（此前下载的 director 文件均为0 shots），确认文件有效后再按交错顺序继续其余样本。

---

## 四、环境信息

### 4.1 影策环境
| 项目 | 值 |
|---|---|
| 项目路径 | `/Users/linmengjiang/open-ai-canvas` |
| Git分支 | `codex/merge-upstream-v1.2.4-and-decimal-price` |
| Git commit（冻结标识） | `0790bbc2a254e55625967405fb9919a098207c11` |
| 前端端口 | 3100（映射容器3000） |
| 后端端口 | 8080（不映射宿主机） |
| 数据库 | PostgreSQL，容器名 `open-ai-canvas-postgres-1` |
| 管理员账号 | username=lmj881029, email=309151651@qq.com |
| user_id | `eeda25ccf994f5e8c37f78bfe853cc2c` |
| 存储盘 | 5T硬盘 `/Volumes/5T` |

### 4.2 Benchmark采集环境
| 项目 | 值 |
|---|---|
| Benchmark canvas ID | `NG96l3QjlyYgQPqjRYKko` |
| URL | `http://127.0.0.1:3100/canvas/NG96l3QjlyYgQPqjRYKko` |
| Domain project ID | `NG96l3QjlyYgQPqjRYKko`（与canvas ID相同） |
| Project unit ID | `unit-emotional-001`（kind=script，含emotional fixture剧本） |
| 本地agent runtime端口 | 17371 |
| Runtime日志 | `/tmp/canvas-agent.log` |
| Codex symlink | `~/.local/bin/codex` → `/Applications/ChatGPT.app/Contents/Resources/codex`（v0.151.0-alpha.7.2） |
| Codex认证 | `~/.codex/auth.json`（ccswitch配置，A6API中转站） |
| 代理 | Clash Verge，端口7897（A6API不需要代理） |

### 4.3 Benchmark localStorage控制键
| 键 | 值 | 说明 |
|---|---|---|
| `__benchmark_skill_mode` | "normal"/"baseline"/"director" | 控制技能注入模式 |
| `__benchmark_capture_enabled` | "1" | 启用录制捕获 |
| `__benchmark_fixture_id` | fixture ID | 当前fixture |
| `__benchmark_mode` | "baseline"/"storyboard-director" | 录制的mode标签 |

### 4.4 GitHub信息
| 项目 | 值 |
|---|---|
| 上游仓库 | `ddcat-ai/open-ai-canvas` |
| 用户GitHub | 用户名 `15657306288`, 邮箱 `309151651@qq.com` |
| 已创建PR | #375, #377（草稿状态，早期UI改动） |

---

## 五、下一步计划

### 5.1 立即（阻塞解除后）
1. 用户在Codex里排查A6API调用问题
2. 问题解决后，从第2个样本（emotional director）继续采集
3. 按配对交错顺序完成剩余9个样本
4. 每个样本检查三件硬条件：raw JSON下载、turn完成、无图片/视频生成

### 5.2 采集完成后
1. 10个raw recording全部收集
2. 执行`prepare-annotation`生成R001-R010匿名盲标注包
3. 人工标注beatTags/continuityTags（不看baseline/director/score/toolTrace）
4. 执行`evaluate-raw`评估每个样本
5. 执行`compare`生成5组baseline vs director对比报告
6. 第一轮分析只回答四个问题：
   - Skill有没有遵守工具纪律？
   - 导演策略有没有明显改变Shot结构？
   - 是否存在退化？
   - 提升来自哪里（按metric delta）？

### 5.3 后续迭代
- 根据Benchmark Review结果，针对真实弱项制定storyboard-director v2
- 不先增加第二个Skill
- AgentRunStep接入（当前表已建但未接入）
- 浏览器断开后AgentRun恢复机制（当前永久running）

---

## 六、关键技术发现（避坑指南）

### 6.1 浏览器自动化
- `bu.type()`设置textarea后必须用JS手动触发input事件，否则React状态不更新、发送不生效
- "新建对话"按钮用`bu.click()`可能不触发React onClick，需用JS直接`btn.click()`
- 本地runtime需要`FRAMEFIELD_TRUSTED_WEB_ORIGINS`环境变量，且需要请求签名（通过session/challenge+exchange建立）
- BrowserUse下载的文件保存在`~/Downloads/BrowserUse/<uuid>/<uuid>/`目录，不是`~/Downloads/`

### 6.2 Codex与Runtime
- Codex必须在PATH中，runtime才能spawn
- `npx @openai/codex`在canvas-agent目录因zod override冲突失败
- Codex CLI需要终端（stdin is not a terminal），无法在非交互式shell中测试
- Runtime日志（stdout）不记录每个HTTP请求，只显示启动信息
- canvas-agent的Codex v0.149.1不支持ccswitch的新配置字段（disable_response_storage等）
- ChatGPT.app内置Codex v0.151.0-alpha.7.2也不支持disable_response_storage，但不用--strict-config时会忽略

### 6.3 数据库
- StartAgentRun的ProjectForUser验证需要canvas ID在projects表中有对应记录（空白canvas默认没有）
- 数据库操作需`docker exec open-ai-canvas-postgres-1 psql -U open_ai_canvas -d open_ai_canvas -c "<SQL>"`
- 后端8080端口不映射宿主机

### 6.4 构建与依赖
- canvas-agent目录npm install因zod override冲突（direct dep ^3.25.76 vs override 3.25.76），需临时将direct dep改为精确版本后install再恢复
- web目录npm install因依赖解析冲突失败，axios需--legacy-peer-deps但会修改package.json
- 所有基础镜像已替换为`docker.m.daocloud.io`
- Docker Hub直连超时，需用国内镜像源

### 6.5 网络
- 从中国大陆访问OpenAI API（api.openai.com）需要代理/VPN
- A6API是国内站点，不需要代理，通过代理反而可能访问异常
- Clash Verge代理端口：7897

---

## 七、文件索引

### 7.1 代码文件（关键修改）
- `backend/internal/model/agent_run.go` — AgentRun+AgentRunStep模型
- `backend/internal/repository/agent_run.go` — Repository（TransitionAgentRunStatus）
- `backend/internal/service/agent_run.go` — Service（所有权验证+终态安全）
- `backend/internal/service/agent_run_test.go` — 17个测试
- `backend/internal/handler/agent_run.go` — HTTP handler（4端点）
- `backend/internal/database/migrations.go` — V5迁移
- `backend/internal/service/seed/skills/storyboard-director.md` — Skill规范源
- `backend/internal/service/skills_seed.go` — 技能种子
- `backend/internal/service/skills.go` — AddedSkills+默认技能
- `canvas-agent/src/storyboard-projection.ts` — 分镜投影
- `canvas-agent/src/canvas-session.ts` — canvas_create_storyboard_shots
- `canvas-agent/src/schemas.ts` — MCP工具定义
- `canvas-agent/test/benchmark/` — fixtures/evaluator/CLI/types
- `canvas-agent/test/storyboard-projection.test.ts` — 17个投影测试
- `canvas-agent/test/storyboard-director-skill.test.ts` — 14个Skill测试
- `canvas-agent/test/storyboard-benchmark.test.ts` — 14个评估器测试
- `canvas-agent/test/storyboard-benchmark-recorder.test.ts` — 7个录制器测试
- `web/src/lib/canvas/benchmark-recorder.ts` — Benchmark录制器
- `web/src/services/skill-runtime.ts` — 技能运行时
- `web/src/services/api/agent-runs.ts` — 前端API client
- `web/src/components/canvas/canvas-local-agent-panel.tsx` — Agent面板
- `web/src/types/canvas.ts` — CanvasNodeMetadata.shotId
- `web/test/canvas-storyboard-projection-history.test.ts` — 3个历史测试（191断言）
- `web/test/skill-runtime.test.ts` — 38个测试

### 7.2 数据文件
- `benchmark-recordings/raw/` — 原始录制（当前1个）
- `~/.codex/config.toml` — Codex配置（ccswitch A6API）
- `~/.codex/auth.json` — Codex认证

### 7.3 日志与运行时
- `/tmp/canvas-agent.log` — Runtime日志
- `~/.local/bin/codex` — Codex symlink

---

*本文档由AI助手整理，记录影策项目从接入中转站到Creative OS架构再到Benchmark数据采集的完整进度。*
