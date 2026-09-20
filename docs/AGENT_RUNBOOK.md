# AI Agent 故障排查手册

本手册记录影策项目中已经遇到并验证过的可复用问题。它服务于 AI、自动化工具和协作者，目标是让后续排障优先复用已经验证成功的路线，避免重复执行已确认失败的操作。

## 使用规则

1. 开始任何开发、部署、测试或排障工作前，先阅读本手册和根目录 [`AGENTS.md`](../AGENTS.md)。
2. 先按主题查找相同或相似问题。找到仍然有效的记录时，直接采用其中的正确路线，并在回复中引用记录编号。
3. 只有在没有匹配记录，或记录已被验证失效时，才尝试新的路线。
4. 新路线验证成功后，追加一条记录；如果只是修正已有问题，更新原记录，不重复新增相同问题。
5. 每次项目修改都要同步更新本手册和根目录 [`CHANGELOG.md`](../CHANGELOG.md) 的项目更新记录；没有新的可复用故障时，在交付说明中明确“无新增故障记录”，不要为了凑条目编造故障。
6. 记录中不得写入 API Key、密码、数据库连接串、Cookie、用户隐私、真实服务器地址或其他私密信息。命令使用占位符表示敏感值。

协作入口、成员管理和浏览器验收状态维护在 `CHANGELOG.md` 与 `docs/content/docs/progress/pending-test.mdx`；开发缓存问题见 RB-20260920-02，合并回执与界面更新问题见 RB-20260920-03。

## 快速排障流程

```text
读取 AGENTS.md 和本手册
    ↓
按主题搜索匹配记录
    ↓
记录仍有效？ ── 是 → 执行“已验证成功的正确路线”并引用记录编号
    │
    否
    ↓
确认工作树和运行前置条件，尝试一条新路线
    ↓
验证结果，记录失败路线、成功路线和可复制命令
    ↓
同步更新本手册与 CHANGELOG.md
```

开始排障时先确认工作树状态，避免覆盖其他人的工作：

```bash
git status --short
```

同类路线连续失败三次时停止盲试，记录现象、已排除项和新假设，再切换路线或请求决策。

## 主题索引

- [本地开发](#本地开发)
- [依赖安装](#依赖安装)
- [Git 与网络](#git-与网络)
- [数据库](#数据库)
- [测试](#测试)
- [部署](#部署)
- [第三方 API](#第三方-api)
- [前端构建](#前端构建)
- [回滚](#回滚)
- [记录模板](#记录模板)

## 本地开发

### 已验证的入口命令

以下命令是项目约定的入口。它们描述如何启动或检查对应单元，不代表每次环境都已经具备所需依赖；执行前应先阅读对应目录文档和环境变量说明。

| 单元 | 命令 |
| --- | --- |
| 后端 | `cd backend && CANVAS_BACKEND_DATA_DIR=../.local/project-workbench-debug go run ./cmd/server` |
| 前端 | `cd web && bun run build` |
| 云端 Agent 测试 | `cd backend && go test ./internal/app -run CloudAgent` |
| 文档站类型检查 | `cd docs && bun run types:check` |

### 故障记录

#### RB-20260920-01：协作 WebSocket 的前后端实现遗漏代理升级链路

- 日期：2026-09-20
- 状态：Vite 临时服务测试已验证；Nginx 配置已补充，容器运行验收待完成。
- 问题现象：代码审查发现客户端和后端均已实现协作 WebSocket，但真实 Vite 代理未开启 `ws`，Nginx API 代理未转发升级头。经这些入口访问无法形成预期实时通道，客户端可能仅靠补偿拉取更新。
- 影响范围：经过 Vite 开发入口或 Nginx 静态入口的画布内容实时通知；普通 REST 保存可以继续成功，容易掩盖问题。
- 根本原因：WebSocket 的 HTTP Upgrade 不会自动继承普通 API 代理配置。另在 CI 的 Bun 1.3.9 中直接运行 Vite，会因缺少 `socket.destroySoon()` 而握手超时；本机 Bun 1.4.0 通过不能替代固定 CI 版本验证。
- 不足的排查路线：只检查后端健康、REST 成功或 service 广播测试，均不能证明入口会转发升级请求；直接在 Bun 测试进程内启动 Vite 还会混入运行时兼容差异，不能靠延长超时或跳过用例解决。
- 已验证成功的正确路线：
  1. 为 `/api/canvas-projects/:id/collaboration/ws` 配置专用 Vite `ws: true` 规则。
  2. 测试启动临时回显上游，在独立 Node 子进程加载真实 Vite 配置，匹配 Vite CLI 的运行时；使用独立缓存和子进程环境，等待就绪端口后确认握手、消息回传及开发代理 Origin。启动有超时，结束时回收子进程；测试不读写业务数据库。已在 Bun 1.3.9 复现旧测试失败、验证修复后通过。
  3. Nginx 为同一路径转发 `Upgrade`、`Connection`，并保留原 Host 与转发头；上线前另做容器和外层代理验收。
- 可直接复制执行的命令：

  ```bash
  cd web
  bun test test/canvas-collaboration-proxy.test.ts
  npm exec --yes --package=bun@1.3.9 -- bun test test/canvas-collaboration-proxy.test.ts
  ```

- 需要避免的操作：不要以接口 200 或服务健康代替 101 升级验证；不要为所有 API 开启不必要的长连接特殊配置；不要将临时代理测试称为真实账号协作验收。
- 文档/配置同步：`web/vite.config.ts`、`nginx.conf`、代理测试及 Node fixture、本地开发专题、实时协作调研与待测试清单。
- 关联项目更新记录：`CHANGELOG.md` 的 `Unreleased` 条目。

## 依赖安装

### RB-20260920-02：临时 Vite 测试共享开发缓存，页面出现 504

- 日期：2026-09-20
- 状态：有效
- 问题现象：真实浏览器打开本地页面为空白，`react-dom_client.js`、`react-router.js` 返回 `504 Outdated Optimize Dep`，入口动态导入失败。
- 影响范围：使用同一 `web/` 根目录运行的 Vite 开发服务与临时代理测试。
- 根本原因：临时测试加载真实 Vite 配置，却与现有开发服务共用默认依赖预构建目录；不同优化选项重写缓存后，现有服务仍引用旧依赖哈希。
- 不足的路线：继续等待页面或只检查 TypeScript 无法修复运行中服务的依赖引用。
- 已验证成功的正确路线：
  1. 临时 Vite 测试显式使用 `.local/cache/canvas-proxy-test-vite` 作为独立 `cacheDir`。
  2. 触发原开发服务重新加载配置，使其重新读取依赖索引；无需修改数据库或依赖锁文件。
  3. 真实浏览器重新打开页面已能显示登录界面；隔离缓存后的代理测试再次通过。
- 可直接复制执行的命令（先确认当前开发服务属于本仓库）：

  ```bash
  touch web/vite.config.ts
  cd web
  bun test test/canvas-collaboration-proxy.test.ts
  ```

- 需要避免的操作：不要让集成测试与用户开发服务共用 Vite 预构建缓存；不要宽范围删除 `node_modules` 或重装依赖。
- 文档/配置同步：代理测试的 `cacheDir`、`CHANGELOG.md` 和待测试清单。
- 关联项目更新记录：`Unreleased`。

### 故障记录

### RB-20260920-05：Bun 临时测试模块在首次导入后创建，后续模块无法解析

- 日期：2026-09-20
- 现象：Bun 1.4.0 执行 Agent API 可靠性测试时，conversations.ts 已写入却报 Cannot find module；该错误既出现在全量测试，也能单文件复现。
- 影响范围：使用临时 TypeScript 模块隔离依赖的测试初始化；非线上 Agent API 失败。
- 根因：首次动态导入之后再向同一临时目录添加模块，运行时已缓存该目录解析结果。
- 失败路线：仅重跑单文件仍失败；不应修改业务 API 或掩盖模块加载异常。
- 成功路线：先生成全部临时模块，再执行首次 import。保留原 transport/storage 隔离、用例内容和 afterAll 清理。
- 可复制命令：在 web 目录执行 `bun test test/agent-api-reliability.test.ts` 或 `bun run test`。
- 避免操作：不修改全局 Bun 配置，不在失败时跳过整组可靠性测试，不让临时 mock 污染其他测试。
- 文档同步：待测试及 CHANGELOG 中记录验证修复；该调整用于保持当前 Bun 及 CI 版本的测试初始化可靠性。

## Git 与网络

### RB-20260920-04：定制协作代码移植到上游后遗漏新入口

- 日期：2026-09-20
- 现象：直接应用定制补丁时产生旧 service 文件与上游领域层冲突；重复画布加载函数、旧主题/API 名称导致类型失败；共享列表和刷新恢复仍挂在旧的全量入口。
- 影响范围：协作内容、分页列表、IndexedDB 原请求重放、Agent 同步、迁移版本和历史测试。
- 根因：上游已改为 internal/canvas 领域服务、internal/app 组合根、http API 客户端、分页与按需加载；定制补丁基于旧入口及团队数据范围。
- 失败路线：逐冲突块选“本地版本”会覆盖上游新语义；只新增协作页面会漏接分页和会话初始化；只运行新增测试不能发现旧历史夹具漏建成员表。
- 成功路线：从独立 worktree 移植，通过 canvas_bridge 接入业务模块；迁移接续 v30/v31；合并加载函数，保留账号代次、素材加载、Agent 回写和视口保护；在按需会话初始化恢复原请求队列；补齐新旧测试的表结构。
- 可复制验证命令（仓库根目录）：

  ```bash
  git diff --check
  cd web
  bun test test/canvas-remote-revision.test.ts test/canvas-collaboration-operations.test.ts test/canvas-conflicts.test.ts test/canvas-collaboration-proxy.test.ts
  bun run build
  cd ../backend
  go test ./internal/canvas ./internal/handler ./internal/database ./cmd/migrate-sqlite-postgres
  ```

- 避免操作：不向开源分支带入整段定制历史，不改写已发布迁移校验和，不把旧分支的浏览器/PostgreSQL 验收写成本次验收，不因画布邀请而放宽全局资源或账单权限。
- 文档同步：CHANGELOG、共享协作专题、数据库/API/代码地图、待测试；跨账号媒体读取后续按 RB-20260920-08 的画布引用授权接入，不能沿用旧的所有者专属读取结论。

### 故障记录

#### RB-20260919-01：`docs/` 根目录新增文档未出现在 Git 状态

- 日期：2026-09-19
- 状态：有效
- 问题现象：新增 `docs/AGENT_RUNBOOK.md` 后，文件存在于磁盘，但 `git status --short --untracked-files=all` 不显示该文件。
- 影响范围：`docs/` 下未被显式放行的新增文档，包括根目录与专题子目录；已被忽略的文件不会进入待提交变更，容易造成文档遗漏。
- 根本原因：`.gitignore` 使用 `docs/*` 忽略整个 `docs/`，只显式放行了 `docs/design/` 和 `docs/index.md`。
- 尝试过但失败的路线：
  - 只创建 `docs/AGENT_RUNBOOK.md`：文件可读取，但仍被 Git 忽略，无法作为普通新增文件发现。
- 已验证成功的正确路线：
  1. 使用 `git check-ignore -v` 确认命中的忽略规则。
  2. 在 `.gitignore` 中为需要纳入版本控制的根目录文档增加 `!docs/<文件名>` 例外。
     对专题子目录逐层放行父目录，再用目录内 `*` 继续忽略其他文件，最后只放行目标文件。本轮实时协作调研与体验方案采用此路线，未开放整个文档目录。
  3. 重新检查 Git 状态，确认文件显示为 `??`。
- 可直接复制执行的命令：

  ```bash
  git check-ignore -v docs/AGENT_RUNBOOK.md
  git status --short --untracked-files=all -- docs/AGENT_RUNBOOK.md
  git check-ignore -v docs/content/docs/overview/canvas-collaboration-realtime.mdx
  git status --short --untracked-files=all -- docs/content/docs/overview/canvas-collaboration-realtime.mdx docs/content/docs/overview/canvas-collaboration-figma-plan.mdx
  ```

- 需要避免的操作：不要为了放行单个文档删除整个 `docs/*` 忽略规则，也不要使用宽范围 `git add -f docs/*` 绕过项目忽略边界。
- 是否需要更新其他文档或配置：是；已更新 `.gitignore`，并在 `docs/index.md` 增加手册入口。
- 关联项目更新记录：`CHANGELOG.md` 的 `Unreleased` 条目。

### RB-20260920-06：个人镜像仓库没有 Fork 关系，无法创建跨仓库 PR

- 日期：2026-09-20
- 现象：分支已成功推送，创建上游 PR 却返回 Head sha/Head repository 为空、No commits 或 refs 不可读。
- 影响范围：从独立镜像向开源上游贡献代码；不影响已推送的 Git 分支。
- 根因：个人仓库的 fork=false、parent 为空，共有 Git 历史不等于 GitHub Fork 网络关系。
- 失败路线：仅重试 owner:branch 形式的 PR 创建，或认为有共同提交即可自动识别跨仓库来源。
- 成功路线：保留原个人仓库，用不同名称创建上游 Fork，确认 parent 后将同一贡献提交推送过去，再创建 PR；不推送定制分支整段历史。
- 可复制命令（替换占位符后执行）：

  ```bash
  gh repo fork UPSTREAM_OWNER/REPOSITORY --fork-name REPOSITORY-contrib --clone=false
  git remote add github-contrib https://github.com/YOUR_USER/REPOSITORY-contrib.git
  git push -u github-contrib CONTRIBUTION_BRANCH
  ```

- 避免操作：不删除/改名已有个人仓库，不覆盖默认分支，不重复推送本地备份分支；gh repo fork 带仓库参数时不同时传 --remote=false。
- 同步要求：交付中记录 PR 实际 head 仓库、分支、基线和验证状态；CHANGELOG、待测试及梳理报告保持一致。

## 数据库

### RB-20260920-08：受邀成员能打开画布，却无法读取私有图片/视频

- 日期：2026-09-20
- 现象：受邀 editor/viewer 能读取共享正文，但资源文件、视频播放副本及素材详情仍按资源所有者查找，出现 404；复制为独立方案也不改变资源归属。
- 影响范围：共享画布及独立方案中的图片、视频、音频、预览和素材按需加载。
- 根因：画布成员权限与私有资源读取分别鉴权；对象存储设置还必须使用资源所有者身份。旧协作操作没有在提交媒体引用时建立可信授权。
- 失败路线：只放开画布 JSON，或将成员 ID 替换成画布 owner，不能覆盖编辑者贡献的资源；仅凭 JSON 包含资源 ID 授权会允许编辑者注入未共享的私有资源。向成员返回长期 CDN 地址也无法在后续请求检查撤权。将浏览器上传的 Asset/Resource 配对要求套到所有内部保存，会拦截 Agent 尚未入素材库的合法输出；内部路径仍校验资源归属，普通浏览器同步另保留素材配对要求。
- 成功路线：新增 v32 `canvas_media_grants`，保存/协作/分支/合并在事务内校验媒体归属或来源授权后记账；读取时实时联查当前画布成员。共用文件出口保留 Range/播放副本，跨所有者强制代理并 `private, no-store`，按资源 owner 解析 OSS。当前跨所有者引用参与删除保护；删除画布先校验 owner，再清理授权和成员。
- 验证：领域回归与实际 HTTP 测试通过，覆盖 image/video/audio、素材按需读取、编辑者贡献、伪造引用拒绝、撤权后的旧 ETag、分支/合并/恢复、Range 与播放副本；本机模拟 OSS 测试确认使用 owner 配置且成员不收到 CDN 重定向。迁移测试覆盖历史、分支、非所有者引用排除和重复执行。
- 可复制命令：在 backend 执行 `go test ./internal/canvas ./internal/database ./internal/handler ./internal/app -run TestCanvasMedia -count=1`；相邻流程执行 `go test ./internal/app -run 'Canvas|UserData|Resource|Asset' -timeout 10m`。
- 避免操作：不放宽私人素材列表、资源管理或其他人的任务/账单权限；不根据任意客户端引用授予读权；不将自动化测试当作真实双账号浏览器、真实 OSS 或 PostgreSQL 并发验收。历史授权与独立方案按各自画布成员关系保留，已下载的本机内容不能撤回。
- 同步要求：CHANGELOG、协作专题、HTTP API、数据库 schema32/导入表、功能清单和待测试；升级先执行迁移，本次未运行生产迁移。

### 故障记录

数据库开发数据必须使用 Git 忽略的 `.local/project-workbench-debug`；不要把真实数据库文件、连接串或账号信息提交到仓库。

## 测试

### RB-20260920-07：素材删除测试与异步 Outbox worker 争用内存 SQLite

- 日期：2026-09-20
- 现象：CI 的已取消任务产物删除、过期归档素材清理用例在查询 `resource_deletion_jobs` 时偶发 `database table is locked`；应用层测试包正常结束，非超时。
- 影响范围：`internal/app/resource_delete_test.go` 的共享内存 SQLite 夹具；本次未修改的上游素材删除测试。
- 根因：删除事务提交后会异步消费 Outbox，夹具允许多个连接，断言查询与 worker 的 claim 事务争用共享缓存表锁。表存在，引用拒绝也已正确发生。
- 失败路线：单次本地专项可能通过，不能排除竞态；补建协作表或只延长测试时限不解决该锁冲突。
- 已验证成功的路线：仅在该组测试夹具设置 `SetMaxOpenConns(1)`，串行化断言和 worker 的数据库访问，保留资源引用、事务回滚、物理对象及 Outbox 断言；生产连接池及删除逻辑不改。相关用例连续三轮通过，共 42 条测试/子测试通过结果。
- 可复制命令：在 backend 目录执行 `go test ./internal/app -run 'Test(Delete.*Asset|ExpiredArchivedAssetCleanup|ResourceDeletionWorker)' -count=3 -timeout 10m`，并检查 PR 的后端全包 CI。
- 避免操作：不跳过素材保护用例，不吞掉数据库查询错误，不用固定 sleep 等待 worker，不将内存夹具验证描述为 PostgreSQL 并发验收。
- 同步要求：CHANGELOG、待测试清单、PR 验证说明与本地梳理报告同步实际结果。

### RB-20260920-03：合并成功后未及时更新接收画布

- 日期：2026-09-20
- 状态：已通过真实双账号无冲突合并、人工冲突选择、过期预览拒绝和 WebSocket 通知验证，以及前端并发专项验证。
- 问题现象：代码审查发现方案合并只弹成功提示，未接收合并后的内容，也未向在线成员广播；合并响应中的画布正文仍带递增前版本号。接收画布可能等待轮询，个人画布没有协作轮询时更难看到结果。
- 影响范围：从来源页合入方案、从方案返回来源、其他在线成员，以及合并期间本机继续编辑的自动保存。
- 根本原因：分支合并绕开普通协作提交后的通知和本机回执接收路径；数据库版本已递增，返回正文却复用了写入前的重绑定结果。
- 不足的路线：仅检查合并接口 200、或强行覆盖前端整张画布，都不能保证编辑器与保存基线一致，也不能保护请求期间产生的新编辑。
- 已验证成功的正确路线：
  1. 合并前同步并检查源方案、目标画布及当前画布的冲突状态。
  2. 合并请求进入本机写入串行队列，服务端返回提交后的正文版本；通过正常三方重放接收回执，保留请求期间的独立编辑。
  3. 个人画布也监听本机投影更新；共享画布在事务成功后广播 `resync`，确认合并后打开接收画布。
  4. 真实页面创建文本并执行合并，核对另一账号收到结果；测试覆盖共享、个人目标在请求期间继续编辑并保存。
- 可复制命令：

  ```bash
  cd web
  bun test test/canvas-remote-revision.test.ts test/canvas-collaboration-operations.test.ts test/canvas-conflicts.test.ts
  ```

- 需要避免：不要给旧正文直接套新版本号；不要用整页刷新掩盖编辑器仍持有旧节点；不要在合并回执处理前放行旧自动保存。
- 文档/配置同步：协作体验方案的接口合同、功能清单、待测试清单和 `CHANGELOG.md`；无需表结构变化。

### 故障记录

暂无已归档的测试故障。测试失败需区分代码回归、环境缺失和项目既有阻断，并记录实际执行的最小命令。

## 部署

### 故障记录

暂无已归档的部署故障。部署记录应包含部署入口、前置检查、健康检查结果和回滚触发条件，但不得写入生产密钥或真实地址。

## 第三方 API

### 故障记录

暂无已归档的第三方 API 故障。只记录协议、状态码、脱敏错误类别和可复现的最小请求形态；请求体中的密钥、Cookie、用户内容和签名参数必须删除或替换为占位符。

## 前端构建

### 故障记录

暂无已归档的前端构建故障。记录包管理器和运行时版本、失败阶段、错误类别、已验证替代命令及是否需要同步锁文件或文档。

## 回滚

### 故障记录

暂无已归档的回滚故障。回滚前先保存当前工作副本并核对目标版本；禁止使用宽范围删除、`git reset --hard` 或覆盖他人未提交的改动。

## 记录模板

每条记录使用唯一编号 `RB-YYYYMMDD-序号`，按主题放置。日期使用 `YYYY-MM-DD`，命令必须可以复制执行，敏感值使用 `<占位符>`。

```markdown
### RB-YYYYMMDD-01：简短问题标题

- 日期：YYYY-MM-DD
- 状态：有效 / 已失效 / 待复核
- 问题现象：
- 影响范围：
- 根本原因：
- 尝试过但失败的路线：
  - `命令或操作`：失败原因。
- 已验证成功的正确路线：
  1. 前置条件：
  2. 执行步骤：
  3. 验证结果：
- 可直接复制执行的命令：

  ```bash
  command --with <placeholder>
  ```

- 需要避免的操作：
- 是否需要更新其他文档或配置：是 / 否；说明：
- 关联项目更新记录：`CHANGELOG.md` 的版本或 `Unreleased` 条目。
```

## 维护检查清单

- [ ] 已先阅读 `AGENTS.md` 和本手册。
- [ ] 已检查 `git status --short`，未覆盖已有改动。
- [ ] 已搜索并引用匹配的有效记录，或说明没有匹配记录。
- [ ] 新问题已记录失败路线和成功路线，命令已脱敏。
- [ ] 失效路线已更新原记录的状态和替代方案。
- [ ] 本次项目修改已同步本手册和 `CHANGELOG.md`；无新故障时已明确说明无新增故障记录。
- [ ] 已同步 `CHANGELOG.md` 及必要的专题文档或配置说明。
