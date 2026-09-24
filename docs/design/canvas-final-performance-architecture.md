# 画布性能与媒体分发最终改造方案

状态：基于当前 `main`（`7bf655e9`）和现有 OSS/CDN 重构重新整理。本文是当前仓库的最终目标和一次性改造边界，不把已经存在的能力重复当成待建设，也不把关键问题推到二期、三期。

## 1. 最终结论

当前仓库已经完成了画布优化的第一代基础设施：

- 资源访问已经收敛到 `assets.ResolveAccess` 和 `POST /api/resources/access`。
- 画布已经有 `canvas-live-viewport` 的合成层预览、Leafer underlay/overlay 图形层、空间索引、节点拖拽预览和选择预览。
- 图片、视频和音频的多数展示路径已经使用 `storageKey` 解析访问地址。
- 云资源 `/file` 路径已经能够重定向到 CDN/源站，平台不必转发云端媒体正文。

因此，最终改造方向不是重写成 WebGL，也不是复制 LibTV 的组件，而是把当前已经存在的能力合并成一个闭环：

```text
稳定资源身份
  -> 统一访问描述
  -> poster-first 媒体状态机
  -> 展示与字节读取分离
  -> 交互预览与持久化提交分离
  -> 可见节点 / 轻量节点 / 完整节点三层 LOD
  -> 同一帧节点、连接、对齐线更新
  -> 以设备帧预算驱动调度和验收
```

用户手势帧永远不承担以下工作：整视频 Blob 下载、视频首帧编码上传、批量 React 复杂节点挂载、全量连线重算、逐 pointermove 持久化和签名地址同步写入画布。

## 2. 外部方案需要修正的地方

外部方案仍然正确的核心原则是视频默认图片化、旧画面不清空、交互期间不做重活、屏内节点不能被屏外预算截断，以及节点与连线使用同一帧预览。

以下内容不能直接照搬：

1. **OSS snapshot 尚未成为当前仓库的统一首帧供应链。** 当前 `web/src/services/canvas-video-preview.ts` 仍在缺少持久 poster 时使用浏览器截帧并后台上传；这只能是历史资源的降级路径，不能继续作为新资源的正常路径。
2. **当前没有完整的 `SelfVirtualizingNode` 和渐进挂载队列。** `use-canvas-render-model.ts` 主要负责空间查询和 DOM 节点挂载窗口，固定使用 280/420/720 节点预算；这不是完整 LOD，也不能宣称支持任意万级画布。
3. **Leafer 目前主要承载连接、选框、对齐线和草稿线。** 节点正文仍是 DOM。`canvas-live-viewport.ts` 已解决交互期合成变换，但不能替代节点 LOD 和挂载调度。
4. **小地图仍然为所有节点创建 DOM 和标签。** 只有图片预览数量限制为 24，节点和标签没有虚拟化；节点规模增大时，小地图本身会变成主线程负担。
5. **当前播放后整文件缓存会制造重复流量。** `resource-blob-cache.ts` 曾由播放器播放后延迟 4 秒拉取完整 Blob；播放 Range 和完整下载可能并存，且缓存预算最高可达 2 GiB。这不属于普通展示行为。
6. **`provider-input` 的浏览器边界与文档不一致。** 当前登录用户 `/resources/access` 直接以 `allowProvider=true` 处理该用途，前端可以申请长 TTL 模型输入地址。最终合同必须把模型输入迁移到服务端受控读取，浏览器公开 batch 只接受展示、复制、下载和浏览器字节处理。
7. **固定数字不是性能承诺。** 0.23/0.27、256px、30+4、280/420/720、5000 条连接、DPR 上限 3 都只能是初始参数。最终参数必须由真实设备和帧预算测量得到。

## 3. 最终分层

### 3.1 持久数据层

画布 JSON 只保存稳定身份和业务元数据：

```ts
type CanvasMediaRef = {
  kind: "image" | "video" | "audio";
  resourceId?: string;
  storageKey?: string;       // resource:<id>
  originalUrl?: string;      // 外部资源历史兼容字段
  previewContent?: string;   // 已经持久化的静态预览
  videoPreview?: {
    storageKey?: string;
    content?: string;
    width?: number;
    height?: number;
    mimeType?: string;
  };
  naturalWidth?: number;
  naturalHeight?: number;
  mimeType?: string;
};
```

临时签名 URL、`blob:` URL、当前播放器实例、缓存 lease 和访问描述不得写入画布 JSON、任务结果、localStorage 或日志。

上传、生成、导入三条路径必须在创建节点时统一写入同一 `resource:<id>`。只有外部直链未转存时才保留外部 URL，并明确标记为外部资源。

### 3.2 访问描述层

`assets.ResolveAccess` 是唯一分发策略入口。浏览器端的 `media-access` 只负责：

- 按 scope、资源、用途、变体合并请求。
- 使用服务端返回的 `expiresAt`、`refreshAt` 和 `revision`。
- 账号切换时取消在途请求并清理旧描述。
- 只把描述交给 `<img>`、`<video>`、原生下载或明确的字节读取器。

服务端用途矩阵固定为：

| 用途 | 浏览器公开 batch | 服务端内部 | 变体 |
| --- | --- | --- | --- |
| `display` | 允许 | 允许 | original/playback |
| `copy` | 允许 | 允许 | original |
| `download` | 允许 | 允许 | original |
| `browser-process` | 允许，必须满足 CORS/Range | 允许 | original/playback |
| `provider-input` | 禁止 | 仅模型请求组合根 | original |

模型输入由后端在真正发出上游请求前解析，前端只提交稳定资源身份或引用绑定。不得让浏览器先申请 4 小时地址再把它当作普通页面能力。

`ResourceAccess` 的缓存键至少包含：

```text
userScope + resourceId + purpose + requestedVariant + serverRevision
```

响应返回后必须再次校验发起时的 scope 和 access generation；账号切换后旧请求即使晚到，也不能写入新账号缓存。

### 3.3 媒体层

视频节点采用 poster-first 状态机：

```text
no-poster -> requesting-poster -> poster-visible
poster-visible -> activating -> player-created
player-created -> metadata-ready -> first-frame-ready -> player-visible
任何失败 -> poster-visible / 可重试状态
```

硬规则：

- 未选中视频不挂载 `<video>`。
- 激活时 poster 保持在底层，播放器真实出帧后才淡入。
- 播放 URL 不先置空，不能制造黑屏窗口。
- `canplay` 或 `requestVideoFrameCallback` 之前播放器保持透明。
- 播放失败、签名过期和 CORS 失败都回到 poster，并给出可见重试。
- 普通播放不调用完整 Blob 缓存。Blob 只服务裁剪、像素读取、导出、识别和明确离线场景。
- 播放器池只保留少量热实例，按设备内存和可见性淘汰。

### 3.4 首帧供应链

新上传和生成完成的视频必须优先得到服务端可复用的静态首帧：

1. OSS 资源使用对应对象存储的 `video/snapshot` 或同等处理能力生成首帧访问描述。
2. 处理参数固定由服务端白名单生成，宽度按 400/800 等档位选择，不接受任意客户端处理串。
3. 签名 URL 只在内存中使用，不写回画布。
4. 高频资源可以异步物化为独立 poster 对象，但不放进上传同步关键路径。
5. 历史没有 poster 的资源才使用浏览器截帧兜底，且该路径必须限流、可取消、可观测。

首帧接口需要验证资源归属、资源类型、ready 状态、实际存储位置和访问用途。非支持 OSS 资源返回结构化 `supported=false`，不能伪造一个视频 URL 当作图片。

### 3.5 画布渲染层

画布分成四个运行时状态：

```text
committedViewport       持久化视口
liveViewport            手势期间实时视口
committedNodes          持久化节点状态
mediaRuntime            poster/player/cache 运行时状态
```

平移、缩放、小地图拖动和节点拖动期间只更新 live 状态、CSS 合成层和 Leafer preview；手势结束后一次性提交 React/store/服务端状态。媒体运行时状态不能因为 viewport 每帧变化而重置。

节点渲染采用三层 LOD：

| 层级 | 条件 | 内容 |
| --- | --- | --- |
| `shell` | 远景、屏外 retain 区、交互资源不足 | 尺寸、标题、连接入口、色块或低清 poster |
| `preview` | entry margin、可见但非焦点 | poster/图片、最少状态、静态文字 |
| `full` | 屏内焦点、选中、拖动、连接、编辑 | 完整业务组件和交互控件 |

进入和退出完整层必须有迟滞；选中、拖动、连接和编辑是强制升级条件。屏内节点和 entry margin 节点不能被总预算裁掉，预算只用于更远的 shell 和完整层数量。

渐进挂载调度器以帧预算为准：

- 每帧先测量 `performance.now()` 消耗。
- 剩余预算足够时才挂载下一个完整节点。
- pointerdown、wheel、拖动、框选期间暂停后台升级。
- 优先级顺序为当前交互节点、屏内节点、entry margin、按距离排序的 shell。
- 连续超预算时自动降低媒体效果和完整层并发，而不是硬编码一个全球固定数量。

### 3.6 连接和图形层

Leafer 保留为连接、选框、对齐线和草稿线的图形层。连接路径按连接 ID 缓存，并维护节点到连接的反向索引。

拖动的一帧必须按以下顺序完成：

```text
pointermove
  -> 计算 dragOffset
  -> DOM 节点临时 translate
  -> Leafer 只更新受影响连接
  -> 更新选择框和对齐线
  -> 同一 RAF 提交图形脏区
```

只有一端移动时重算曲线，两端一起移动时可整体平移旧路径。屏内连接不能因为屏外连接预算截断。拖动期间暂停流光动画，避免动画和路径重算争抢帧预算。

### 3.7 小地图

小地图改为单一 Canvas/Leafer 绘制：

- 节点按颜色和尺寸画矩形。
- 只对当前焦点或极少数指定节点画 poster。
- 不创建全量标题 DOM。
- 世界范围使用空间索引或增量 bounds，不在每次 pointermove 全量计算。
- 视口框拖动保留抓取偏移；框内拖动不跳到鼠标中心。
- 小地图拖动持续发布 live viewport，render window 同步跟随。

## 4. 缓存最终规则

缓存分成四类，不能互相替代：

1. **请求合并**：同一 scope、资源、用途、变体、档位只允许一个在途请求。
2. **访问描述缓存**：只缓存短期签名描述，按服务端 `refreshAt` 和 `revision` 失效。
3. **展示对象缓存**：交给浏览器/CDN；普通展示不转 Blob。
4. **字节缓存**：仅给明确 Blob 消费者，按 scope、实际变体、revision 隔离，有单文件上限、总量上限、LRU 和可取消下载。

账号切换必须同时：

- 清理 access descriptor、in-flight descriptor 和 resource metadata cache。
- 撤销展示用途产生的 Object URL。
- 取消或使旧 Blob 下载代际失效。
- 清理播放器池和媒体 lease。
- 响应提交前核对 scope/generation。

Service Worker 只允许缓存公开、无 token、无签名敏感参数的缩略图。私有 OSS、原始视频、鉴权 API 和包含用户 token 的 URL 不进入公开 Service Worker。

## 5. 后端 OSS/CDN 合同

资源访问顺序固定为：

```text
业务授权
  -> ready 校验
  -> 变体解析
  -> 实际存储位置解析
  -> 用途能力与保护校验
  -> CDN/源站签名或明确平台流计划
```

当前仓库必须保持以下边界：

- CDN 是分发能力，不等于 OSS 厂商名称。
- 历史资源按资源绑定的 provider、endpoint、bucket 和 storage setting 读取，不能把所有历史对象拼到当前 CDN 域名。
- `download` 使用对象存储响应的 Content-Disposition，不能因为改文件名而把媒体正文拉回平台。
- local/proxy 正文流必须带原因、字节量、Range 和失败指标。
- `/api/resources/access` 不得成为浏览器获取长效 provider-input 凭据的入口。
- `revision` 必须包含资源实际版本、播放副本状态和分发配置版本；配置变化后旧描述不能继续被前端长期使用。
- CORS、GET/HEAD、Range、206、416、签名过期、续期和 CDN 命中必须通过真实链路验证，不能用本地单测替代。

## 6. 一次性改造清单

这次改造以一个完整发布批次交付，下面是同一批次内的工作流，不是功能延期：

1. **访问合同收口**：公开 batch 拒绝 `provider-input`；模型输入迁移到后端组合根；访问描述缓存增加 scope/generation/revision 失效；补全账号切换清理。
2. **展示与字节读取分离**：移除播放后自动整 Blob 下载；保留 Blob 只给裁剪、导出、识别等真实字节消费者；补取消、去重、LRU 和单文件上限。
3. **poster-first 完整化**：新资源首帧走 OSS/CDN snapshot；浏览器截帧只做历史/不支持资源兜底；播放器保留 poster 到真实首帧。
4. **LOD 和渐进挂载**：在现有 `useCanvasRenderModel` 上增加 shell/preview/full 三层模型、迟滞和帧预算队列；当前固定节点预算降为初始策略，不作为产品承诺。
5. **小地图换成图形绘制**：去掉全量节点标签 DOM 和图片遍历，保留色块、焦点预览和视口框。
6. **连接增量更新**：保留现有 Leafer 路径缓存和拖动预览，补齐连接空间索引裁剪、屏内连接强制保留和动画暂停。
7. **运行时观测**：记录手势帧 P50/P95/max、50ms 长任务、可见/挂载节点、完整层数量、播放器数量、poster 请求、Blob 字节、平台正文 200/206 字节、CDN/origin 命中和降级原因。
8. **全入口清理**：静态扫描并删除页面自行拼接签名 URL、旧 `direct/proxy` 开关、展示路径隐式 Blob、重复的 provider 判断和旧直链 helper。

## 7. 验收门槛

### 画布交互

- 5%、10%、25% 缩放下四向连续平移，屏内节点不成片消失。
- 快速跳远、缩放和小地图持续拖动不出现成片黑边；新区域在手势进行中进入 render window。
- 单节点、多节点拖动时节点、连接端点、选择框、对齐线同一帧移动。
- pointercancel、Esc、失焦不会写入错误位置，也不会触发点击或工具栏。
- 连续框选不激活播放器、不显示单节点工具栏、不批量升级完整节点。

### 媒体

- 未选中视频 DOM 中 `<video>` 数量为 0。
- 选中视频在播放器真实出帧前 poster 持续可见。
- 播放失败、断网、签名过期和 CORS 失败不会黑屏。
- 普通播放不会触发整文件 Blob 下载；播放 Range 不与后台整文件下载重复。
- 相同资源/用途/变体的并发访问描述请求为 1。
- 账号切换后旧账号 URL、Blob、播放器和 in-flight 结果不会进入新账号。

### OSS/CDN

- CDN、源站、local、明确批准的 proxy、历史资源位置均有合同测试。
- 真实浏览器验证 CORS、Range、206、416、签名过期、续期、暂停后继续和下载文件名。
- 平台只对 local/approved-proxy 发送媒体正文；每次正文都有结构化原因。
- `provider-input` 不再由登录浏览器 batch 直接获取长效 URL。

### 规模与设备

- 至少覆盖 100、300、1000、3000 节点和 100、900、2000、5000 条连接。
- 覆盖 DPR 1/2、390px 窄屏、桌面、低端设备模拟、冷缓存和热缓存。
- 记录 P50、P95、最大帧间隔和长任务，不能只看平均 FPS。
- 所有固定数字都必须回填到设备/帧预算实测结果，不把某次机器上的 60fps 结果写成普遍承诺。

## 8. 风险控制

- 旧资源没有 poster 时允许降级为占位卡和可取消浏览器截帧，但不得挂载常驻被动播放器。
- OSS/CDN 配置无效时明确返回结构化错误，不把故障静默转成平台代理。
- 图形层异常时保留 DOM 节点和静态连接；LOD 调度异常时退回 shell/preview，不在手势帧内批量升级。
- 资源清理继续执行画布、项目、任务、素材和历史快照引用检查；性能改造不改变删除安全边界。
- 不以新增 Service Worker、`will-change`、WebGL 或 OffscreenCanvas 掩盖访问合同和渲染调度问题。
