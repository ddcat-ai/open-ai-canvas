# LL2 二开 · 网关协议契约与现状基线

本文件是 LL2 二开（`DAV-SAM/LL2TV`，上游 `ddcat-ai/open-ai-canvas`）在仓库内的协议与现状基线。
桌面交接清单是同一份内容的历史快照；后续协议、契约、待办以本文件为准，改代码前先读这里，不要重新猜字段。

## 1. 两条视频协议

| | MiniMax-H3 | 其余 13 个视频模型 |
| --- | --- | --- |
| 创建 | `POST /v2/video_generation` | `POST /v1/video/generations` |
| 查询 | `GET /v2/query/video_generation/{id}` | `GET /v1/video/generations/{id}` |
| 请求体 | `{ model, content:[{type:"text",text}, ...media], resolution, duration, ratio }` | `{ model, prompt, seconds, aspect_ratio, resolution }` |
| 素材 | `content[]` 支持 first_frame / last_frame / reference_* | 只做纯文字；带素材在提交前就被产品拦下 |

实现位置：`web/src/services/ll2/ll2-video-adapters.ts`（`LL2_VIDEO_ADAPTERS`，H3 一条 + 工厂生成 13 条）；
字段来源与上游 `web/src/services/api/video-provider-newapi.ts` 一致，不是猜的。

## 2. 实测硬契约（改动前必须保持）

1. **`/v1/video/generations` 的 `seconds` 必须是字符串**。传数字直接 400：
   `json: cannot unmarshal number into Go struct field .Alias.seconds of type string`。
   代码固定在 `seconds: String(args.seconds)`；H3 走 `/v2` 用数字 `duration`，不受影响。
2. **图片可以直传 Base64，视频/音频不行**。`image_url.url` 用 `data:image/...;base64,...` 实测出片；
   `video_url.url` / `audio_url.url` 用 data URI 必 400（`must be a public HTTPS URL`）。
   本机没有对象存储，所以本机视频目前只能存、不能参与生成。
3. **503 `model_not_found` 不是平台故障**，含义是调用方 Key 所在分组没挂该模型渠道。
   `httpErrorMessage()` 已单独映射成中文；不要笼统说成「服务暂不可用」。
4. **网关支持幂等**：同一 `Idempotency-Key` 连发两次创建返回同一个 task_id。
   但首页提交目前没传 key（每次提交 `newIdempotencyKey()`），用户手动重试仍是新任务、再扣费；
   要做「同一次意图复用 key」需要另设计交互。
5. **轮询上限**：`maxPolls ?? 120` × 5s = 10 分钟。首尾帧 2 图组合实测 480 秒仍 running，
   属于体验缺口而非协议错误。

## 3. 素材构造规则（`web/src/services/ll2/ll2-media.ts`）

- 无素材 = 纯文本；
- 1 张图 = `first_frame`；
- 2 张图 = `first_frame` + `last_frame`（用户要的首尾帧）；
- ≥3 张图或含视频/音频 = 全部 `reference_*`，提示词里用 `<Picture N>` / `<Video N>` / `<Audio N>` 引用；
- `first_frame` 不得与 `reference_*` 混用（官方契约），首帧/尾帧分支会把 `@` 标记剥离不发给网关；
- 客户端按编码后体积卡上限（单文件 30/50/15MB、合计 24MB；视频 ≥2 秒；图片 ≤9；总数 ≤12）。

## 4. 模型清单与计费

- 视频生成 **14 个**：H3、wan3.0-video、wan3.0-video-prime、doubao-seedance-2-0 / -fast / -mini / 2-5、
  viduq3-pro、viduq3-turbo、Super Vega 1.0-lite / -pro / -pro-fast / -pro-mini、1.5-pro。
  `auto-hd` 是超分后处理（需要输入视频），不在生成清单里。
- 文本模型 6 个，只服务自家 C 端（写漫剧/改提示词/答创作问题），不露模型代号。
- 价格唯一来源：`web/src/lib/ll2-models.ts` 的 `LL2_MODEL_SPECS`（21 模型 / 71 档位）。
  档位与时长从 SPECS 派生，新增模型只改 SPECS 一处，避免两份清单漂移。
- 豆包四款按 Token 计费，没有「元/秒」；`ll2PreciseCNY` 对它们返回「按 Token 计费」，不显示「不到 1 分钱」。

## 5. 免登录 / 本机数据红线

- C 端 BYOK 免登录，绝大多数依赖登录态后端的用户入口在路由层回首页。
- 本机素材写同一个 `useAssetStore`（IndexedDB，GUEST_SCOPE），**水合路径不能有任何依赖登录态后端的 await**：
  `normalizePersistedAsset()` 对 `source === "dmc-local"` 直接返回，其它历史图上传失败也必须返回原 asset，
  否则整库水合 reject，刷新后素材全部消失（已发生过，回归测试锁住）。
- `?quote=` / `?prompt=` 必须靠一次性闸门消费（StrictMode effect 双跑会把 `@[名称]` 插两遍），落地后清参数。
- 没填 Key 也必须显示本次预估价 `estimate.label` + `estimate.basis`，只给一句承诺不算数。
- 本机视频不能 `@` 引用进生成，资产页对应入口置灰并写明原因，不能留半开状态。

## 6. 验证基线（可复现）

在 `web/` 下：

```bash
bun run typecheck                                  # 0 错误
bun test test/ll2-ux-walkthrough-regressions.test.ts   # 11 pass / 0 fail
bun run scripts/ll2-media-mock-check.ts            # 44 pass / 0 fail，零费用，不连网关
bun run scripts/ll2-video-mock-check.ts            # H3 轮询/取消/失败 + 非 H3 三模型 /v1 协议，零费用
bun x vite build --outDir dist-verify-allmodels    # 构建通过
```

`ll2-video-mock-check.ts` 用本机 mock 网关跑通两条协议：H3 的 `/v2` 与其余模型的 `/v1`。
非 H3 段覆盖 seedance 2.0 / viduq3-pro / Super Vega 1.0-pro，断言 `seconds` 是字符串、
字段名是 `aspect_ratio`、查询走 `/v1/video/generations/{id}`；豆包四款还必须显示「按 Token 计费」而不是「实付 ¥0」。

**注意**：「回归 11/11」是读源码字符串断言（`expect(source).toContain(...)`），只能防止标记被删，
不证明运行时行为；行为证据是 44 项 mock 自检 + 真网关冒烟。全量 `bun test` 有 511 个测试文件，
CI 给 30 分钟，本地不要用全量当快速验证。

真网关冒烟（**产生费用**，Key 只从环境变量 `LL2_TEST_API_KEY` / `DMC_MONITOR_KEY` 读）：

```bash
bun run scripts/ll2-real-smoke.ts --scenario=text
bun run scripts/ll2-real-smoke.ts --model=wan3.0-video --resolution=480P --seconds=2 --scenario=text
bun run scripts/ll2-real-smoke.ts --model=viduq3-turbo --resolution=540p --seconds=2 --scenario=text  # 探渠道，503 不计费
bun run scripts/ll2-real-smoke.ts --model=MiniMax-H3 --scenario=text --probe-idempotency
```

已实测成功的组合：H3 1s 纯文字（约 90s 出片）、H3 1 图首帧、wan3.0-video 480P 2s（约 182s）。
其余 11 个模型只有代码适配，没有真跑——当前 Key 属 default 分组，只挂了 H3 和 wan3 的渠道。

## 7. 已知缺口（按优先级）

1. **13 个模型未逐个真跑**：需先在 LL2 控制台给分组挂渠道，再按 `--model=` 逐个冒烟。
2. **首尾帧 10 分钟不出片**：代码只有轮询上限，UI 没有「会更慢」的预期提示，也没有中途放弃入口。
3. **全量测试慢**：511 个测试文件，本地只跑定向；全量交给 CI。
4. **画布内部交互**（拖拽/连线/缩放/五步生成/Agent 出片）无法自动化验证，需人工走查。
5. **首屏 chunk 偏大**（1.46 / 1.62 / 1.82MB），低配机启动是硬约束，属下一轮重点。

已收口（2026-11-19）：

- **拖图闭环**：保存弹窗改为「只保存 / 保存并引用」，点「保存并引用」会把 `@[标题]` 直接插回句子，
  拖图→出片不再需要手动打 @。真机验证：拖拽 → 弹窗 → 点按钮 → 输入框出现 `@[drag-test]`。
- **本机视频参考**：已拍板不做公网链接入口，UI 写死「视频只能保存，不能引用（需公网地址）」；
  素材库抽屉、资产页卡片菜单、提交前防御三层一致。
- **豆包 Token 计费**：出片后的「实付」不再显示 ¥0，改为「按 Token 计费」。
- **黑夜模式输入框**：保存弹窗原先引用了暗色表里不存在的 `--ll2-t-f7f7f9` / `-6b6b76` / `-9a9aa4` / `-e9e9ee`，
  暗色下输入框是白底；已改用表中已有的 `f7f7fa` / `6b6b6b` / `888` / `e5e5e5`，浅色兜底值不变。

## 8. 相关文件

- 模型与价格：`web/src/lib/ll2-models.ts`
- 视频协议与轮询：`web/src/services/ll2/ll2-video.ts`、`ll2-video-adapters.ts`
- 素材读取与构造：`web/src/services/ll2/ll2-media.ts`、`ll2-assets.ts`
- 首页一句话成片：`web/src/components/ll2/ll2-oneshot.tsx`、`ll2-save-asset-dialog.tsx`
- 自检与冒烟：`web/scripts/ll2-media-mock-check.ts`、`ll2-real-smoke.ts`
- 回归：`web/test/ll2-ux-walkthrough-regressions.test.ts`
