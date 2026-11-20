import { expect, test } from "bun:test";

/**
 * 2026-11-19 真实浏览器走查抓到的 4 个回归点。
 * 这些行为必须在源码里留痕，避免后续改版又悄悄退化：
 *  1. 本机素材（source=dmc-local）水合时不能回传后端，否则整库刷新后变空
 *  2. 没填 Key 也要显示本次预估价，不能只写一句「看要花多少钱」
 *  3. ?quote= 只消费一次，StrictMode 下不能把 @ 引用插两遍
 *  4. 首页已有「聊天改稿」页签，不再挂重复的悬浮按钮压住内容
 */

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();

test("本机 data URI 图片水合时跳过后端上传，且上传失败不拖垮整库", async () => {
    const source = await read("../src/stores/use-asset-store.ts");
    expect(source).toContain('asset.source === "dmc-local"');
    const guard = source.indexOf('asset.source === "dmc-local"');
    const upload = source.indexOf("await uploadImage(asset.data.dataUrl)");
    expect(guard).toBeGreaterThan(-1);
    expect(upload).toBeGreaterThan(guard);
    // 其它历史素材的上传必须带兜底，任何一张失败都不能让 getItem reject。
    expect(source).toContain("不能因为一张图拖垮整库水合");
});

test("没填 Key 的首页直接给出本次预估价和计价依据", async () => {
    const source = await read("../src/components/ll2/ll2-oneshot.tsx");
    expect(source).toContain("ll2-oneshot-preview-price");
    expect(source).toContain("{estimate.label}");
    expect(source).toContain("{estimate.basis}");
    // 旧文案「看这次要花多少钱」只是承诺，不显示数字，已废弃。
    expect(source).not.toContain("看这次要花多少钱");
});

test("资产页 ?quote= 只落地一次，灵感 ?prompt= 落地后也清参数", async () => {
    const source = await read("../src/components/ll2/ll2-oneshot.tsx");
    expect(source).toContain("consumedQueryRef");
    expect(source).toContain("if (consumedQueryRef.current === token) return;");
    const quoteNavigate = source.indexOf('navigate("/", { replace: true })');
    expect(quoteNavigate).toBeGreaterThan(-1);
    expect(source.lastIndexOf('navigate("/", { replace: true })')).toBeGreaterThan(quoteNavigate);
});

test("首页不再挂重复的聊天改稿悬浮按钮", async () => {
    const source = await read("../src/components/ll2/ll2-agent-panel.tsx");
    expect(source).toContain('pathname === "/" || pathname === "/create"');
});

test("带素材：H3 / wan3 已接协议，其它模型明确拦截", async () => {
    // 2026-11-19 真机反馈：非 H3 的 image_urls 被网关忽略，成片与参考图无关还扣费。
    // wan3 已改走 DashScope 的 input.img_url，并用洋红测试卡真机验证首帧一致。
    const video = await read("../src/services/ll2/ll2-video.ts");
    expect(video).toContain("mediaProtocolReady");
    expect(video).toContain('req.model.startsWith("wan3.0-")');
    expect(video).toContain('req.model.startsWith("doubao-seedance-2-")');
    expect(video).toContain('req.model.startsWith("viduq3-")');
    expect(video).toContain("协议还没验证通过");
    const adapters = await read("../src/services/ll2/ll2-video-adapters.ts");
    expect(adapters).toContain("/ali/api/v1/services/aigc/video-generation/video-synthesis");
    expect(adapters).toContain("img_url");
    expect(adapters).toContain("X-DashScope-Async");
    expect(adapters).toContain("/seedance/api/v3/contents/generations/tasks");
    expect(adapters).toContain("requiresAuth: true");
    expect(adapters).toContain("/vidu/ent/v2/tasks/");
    expect(adapters).toContain("start-end2video");
    const source = await read("../src/components/ll2/ll2-oneshot.tsx");
    expect(source).not.toContain('setModel("MiniMax-H3")');
    expect(source).not.toContain("disabled={hasAnyReference}");
});

test("窄窗顶栏常驻资产入口，宽屏交给侧栏", async () => {
    const bar = await read("../src/components/layout/workspace-top-bar.tsx");
    expect(bar).toContain('className="ll2-topbar-assets"');
    expect(bar).toContain('to="/assets"');
    const css = await read("../src/styles/ll2-c-ui.css");
    // 宽屏隐藏，避免和侧栏一级导航重复。
    expect(css).toContain("@media (min-width: 1024px)");
    expect(css).toContain(".ll2-topbar-assets");
});

test("首屏 i18n 只同步加载中文，其余语言按需 import", async () => {
    const source = await read("../src/i18n/index.ts");
    expect(source).toContain("initAsync: false");
    // 5 个非中文语言必须走 lazy pack，不能静态聚合回首屏。
    expect(source).toContain('"en-US": () => import("./messages/packs/en-US")');
    expect(source).toContain('"ko-KR": () => import("./messages/packs/ko-KR")');
    expect(source).not.toContain("AREA_CATALOGS");
});

test("参考视频只认公网 HTTPS：本机视频在提交前就被挡住", async () => {
    // 2026-11-19 真网关实测 400：content[n].video_url.url must be a public HTTPS URL。
    const media = await read("../src/services/ll2/ll2-media.ts");
    expect(media).toContain('kind !== "image" && item.dataUrl.startsWith("data:")');
    const video = await read("../src/services/ll2/ll2-video.ts");
    expect(video).toContain("/^https:\\/\\//i.test(url)");
    // 首页 @ 素材库抽屉里写明「视频只能存着预览下载」，不留半开状态。
    const library = await read("../src/components/ll2/ll2-asset-library.tsx");
    expect(library).toContain("视频只能存着预览下载");
    // 真正在用的资产页是影策原版卡片：视频项置灰并说明原因，同时补了「引用到创作台」。
    const cards = await read("../src/pages/assets/asset-library-cards.tsx");
    expect(cards).toContain("视频只能保存，不能引用（需公网地址）");
    expect(cards).toContain("引用到创作台");
});

test("资产页照搬影策原版，数据层在免登录下接本机", async () => {
    const router = await read("../src/router.tsx");
    expect(router).toContain('{ path: "/assets", element: deferred(<AssetsPage />) }');
    const page = await read("../src/pages/assets/index.tsx");
    // 图片上传：免登录不去打 /api/resources，直接用本机 data URI。
    expect(page).toContain("本机 imageDraft 已经是 data URI");
    // 文件夹定义存本机。
    expect(page).toContain("LOCAL_FOLDER_KEY");
    // 存储用量不再请求 /api/resources/storage-usage（免登录必然 401，会冒出「重试」）。
    const usage = await read("../src/pages/assets/asset-storage-usage.tsx");
    expect(usage).toContain("useAccountFileStorageUsage(Boolean(userId))");
    expect(usage).toContain("本机素材");
});

test("首页拖图先存资产库：没有「素材库 @」页签，弹保存框", async () => {
    const source = await read("../src/components/ll2/ll2-oneshot.tsx");
    // 页签只剩 视频 / 文本 / 聊天改稿。
    expect(source).toContain('type Tab = "video" | "text" | "chat";');
    expect(source).not.toContain('label: "素材库 @"');
    // 拖图不再直接当首帧，而是打开保存弹窗。
    expect(source).toContain("setSaveAssetDraft({ file, dataUrl: item.dataUrl");
    expect(source).toContain("<LL2SaveAssetDialog");
    // 2026-11-19：素材入口收进参数行的「+」chip，不再占一整行提示。
    expect(source).not.toContain("这里只能拖一张图");
    expect(source).toContain("ll2-chip-add");
    expect(source).toContain("打 @ 可以引用素材库里的图片");
    expect(source).not.toContain("给小白简单出片");
    const dialog = await read("../src/components/ll2/ll2-save-asset-dialog.tsx");
    expect(dialog).toContain("保存到资产库");
    expect(dialog).toContain("ll2SaveImageAsset");
    // 「保存并引用」：拖图存进资产库的同时把 @ 引用插回句子，不用再手动打一次 @。
    expect(dialog).toContain('save("quote")');
    expect(dialog).toContain("保存并引用");
    expect(source).toContain("applyMention(ll2MentionToken(result.title), null)");
    expect(source).toContain('mode === "quote"');
});

test("免登录不偷偷打登录态接口，价格页与悬浮按钮不挡内容", async () => {
    // 走查发现：每条路由都打 /api/model-catalog（401），画布编辑器还打 /tasks 和 /sync-status。
    const session = await read("../src/lib/user-session.ts");
    expect(session).toContain("if (!userId) return;");
    const lifecycle = await read("../src/pages/canvas/use-canvas-project-lifecycle.ts");
    expect(lifecycle).toContain("if (!hasRemoteUserDataSyncSession()) return;");
    const tasks = await read("../src/pages/canvas/use-canvas-active-tasks.ts");
    expect(tasks).toContain("enabled && Boolean(projectId) && hasRemoteUserDataSyncSession()");
    // 价格页是满宽表格，悬浮按钮会压住最后一列。
    const panel = await read("../src/components/ll2/ll2-agent-panel.tsx");
    expect(panel).toContain('pathname === "/models"');
    // 官网价格接口跨域必然失败：不要再摆「点此重试」这种假承诺，价格页只做静态说明。
    const plaza = await read("../src/pages/models/ll2-model-plaza.tsx");
    expect(plaza).toContain("价格按内置快照展示");
    expect(plaza).not.toContain("官网价格暂时读不到，点此重试");
    expect(plaza).not.toContain("loadLive");
    expect(plaza).not.toContain("fetchLL2LivePricing");
    // 设置页的「从官网刷新」同样是永远失败的入口，一并去掉。
    const config = await read("../src/pages/ll2-workspace/config.tsx");
    expect(config).not.toContain("官网暂时读不到");
    expect(config).not.toContain("fetchLL2LivePricing");
    // 批量上传在免登录时必须走本机 data URI，不能拿 File 直传 /api/resources（会「请先登录」）。
    const batch = await read("../src/pages/assets/asset-batch-upload-modal.tsx");
    expect(batch).toContain("readFileAsDataUrl(item.file)");
    expect(batch).toContain("if (!userId)");
});

test("文本模型下拉显示真实模型名与 Token 单价，填 Key 弹窗只留必要信息", async () => {
    // 用户口径：不能写「写得快 · 便宜」这种档位白话，要能对上控制台和账单。
    const text = await read("../src/services/ll2/ll2-text.ts");
    expect(text).toContain("export function ll2TextModelName");
    expect(text).toContain("export function ll2TextModelPriceHint");
    expect(text).not.toContain("写得快 · 便宜");
    const config = await read("../src/pages/ll2-workspace/config.tsx");
    expect(config).toContain("ll2TextModelPriceHint");
    expect(config).toContain("{item.name}</option>");
    // 填 Key 弹窗：不要红色大按钮、不要两段解释。
    const connect = await read("../src/components/ll2/ll2-connect.tsx");
    expect(connect).not.toContain("ll2-key-console-button");
    expect(connect).not.toContain("我们不会另做一套登录");
    expect(connect).toContain("粘贴 LL2 Key，只保存在这台电脑。");
});

test("生成后超分：默认不勾、只能往上超、1080P 就是 1K", async () => {
    // 用户口径：1080P 就写 1080P；勾选才超分，不勾不多花钱；不能反向超分。
    const upscale = await read("../src/lib/ll2-upscale.ts");
    expect(upscale).toContain('label: "1080P"');
    expect(upscale).not.toContain("1080P（1K）");
    expect(upscale).toContain("target.rank > sourceRank");
    const oneshot = await read("../src/components/ll2/ll2-oneshot.tsx");
    expect(oneshot).toContain("生成后顺便超分");
    expect(oneshot).toContain("checked={Boolean(upscale)}");
    expect(oneshot).toContain("ll2RunHd");
    expect(oneshot).toContain("previewUrl");
    // 超分走独立协议 /hd/tasks，结果要带 Bearer 才能下载。
    const hd = await read("../src/services/ll2/ll2-hd.ts");
    expect(hd).toContain("/hd/tasks");
    expect(hd).toContain("auto-hd");
    expect(hd).toContain("Bearer");
});

test("视频模型一律 4 秒起", async () => {
    const models = await read("../src/lib/ll2-models.ts");
    expect(models).toContain("Math.max(4, spec?.secondsMin ?? 4)");
    expect(models).toContain("duration: \"4–15 秒\"");
    const workspace = await read("../src/lib/ll2-workspace.ts");
    expect(workspace).toContain("Math.max(4, Number(value.seconds))");
});

test("无限画布：视频节点能用 LL2 auto-hd 超分，生成新节点", async () => {
    const toolsRegistry = await read("../src/lib/canvas/tool-registry/definitions/node-hover-tools.tsx");
    expect(toolsRegistry).toContain('id: "llmUpscale"');
    expect(toolsRegistry).toContain("onNodeLlmUpscale");
    const hook = await read("../src/pages/canvas/use-ll2-canvas-upscale.ts");
    expect(hook).toContain("ll2RunHd");
    expect(hook).toContain("ll2FetchHdBlob");
    expect(hook).toContain("uploadMediaFile");
    expect(hook).toContain("ll2Upscale");
    const dialog = await read("../src/components/ll2/ll2-canvas-upscale-dialog.tsx");
    expect(dialog).toContain("超分这条视频");
    expect(dialog).toContain("只存在本机");
    const project = await read("../src/pages/canvas/project.tsx");
    expect(project).toContain("<LL2CanvasUpscaleDialog");
    expect(project).toContain("onLlmUpscale={openLl2Upscale}");
});

test("我的片子改成带视频封面的自适应网格，不再横向拖动", async () => {
    const films = await read("../src/pages/ll2-workspace/films.tsx");
    expect(films).toContain("ll2-films-grid");
    expect(films).toContain("<video src={film.url}");
    expect(films).not.toContain("ll2-filmstrip-track");
    const css = await read("../src/styles/ll2-c-polish.css");
    expect(css).toContain(".ll2-film-tile-thumb video");
    expect(css).toContain("grid-template-columns: repeat(auto-fill, minmax(238px, 1fr))");
});

test("一句话成片输入框有 AI 润色提示词按钮", async () => {
    const page = await read("../src/components/ll2/ll2-oneshot.tsx");
    expect(page).toContain("AI 润色提示词");
    expect(page).toContain("polishPrompt");
    expect(page).toContain("ll2ChatText");
    expect(page).toContain('model: "deepseek-v4.1-flash"');
    expect(page).toContain('setPolishNote("已润色")');
    const css = await read("../src/styles/ll2-c-polish.css");
    expect(css).toContain(".ll2-oneshot-polish-btn");
});

test("视频节点右键提供下载到本机和存到资产库两个出口", async () => {
    const menu = await read("../src/components/canvas/canvas-context-menu.tsx");
    expect(menu).toContain("保存与导出");
    expect(menu).toContain("下载到本机");
    expect(menu).toContain("存到资产库");
    const wrapper = await read("../src/pages/canvas/canvas-project-context-menu.tsx");
    expect(wrapper).toContain("onDownloadMedia");
    const project = await read("../src/pages/canvas/project.tsx");
    expect(project).toContain("onDownloadMedia={(targetNode) => void downloadNodesMedia([targetNode])}");
});

test("超分会重置计时起点，标题显示正在超分", async () => {
    const project = await read("../src/pages/canvas/project.tsx");
    expect(project).toContain("超分是一段新的等待");
    expect(project).toContain("taskCreatedAt: new Date().toISOString()");
    const status = await read("../src/components/canvas/canvas-node-status-content.tsx");
    expect(status).toContain("ll2Upscaling");
    expect(status).toContain('"正在超分"');
});

test("已生成视频可从右键菜单直接超分，并按当前清晰度给目标档", async () => {
    const helper = await read("../src/lib/canvas/canvas-video-upscale.ts");
    expect(helper).toContain("canvasVideoUpscaleOptions");
    expect(helper).toContain("ll2ResolutionRank");
    expect(helper).toContain("ll2RunHd");
    expect(helper).toContain("requiresAuth");
    const menu = await read("../src/components/canvas/canvas-context-menu.tsx");
    expect(menu).toContain("视频超分");
    expect(menu).toContain("canvasVideoUpscaleOptions");
    const project = await read("../src/pages/canvas/project.tsx");
    expect(project).toContain("handleUpscaleVideo");
});

test("本机上传的图片刷新后从 IndexedDB 重新解析，不再只认 blob URL", async () => {
    const media = await read("../src/components/canvas/canvas-node-media-content.tsx");
    expect(media).toContain("isLocalMediaKey");
    expect(media).toContain("resolveImageUrl(storageKey, fallback)");
    expect(media).toContain("isRemoteResource || isLocalMediaKey");
});

test("LL2 模型按模型路由，不因 Key 未就绪退回后端", async () => {
    const exec = await read("../src/pages/canvas/canvas-ll2-video-execution.ts");
    expect(exec).toContain("只按模型判断");
    expect(exec).not.toContain("if (!useLL2Store.getState().apiKey.trim()) return false;");
});

test("画布记录本次提交参数，长视频轮询按秒数放宽", async () => {
    const executor = await read("../src/pages/canvas/canvas-media-generation-executors.ts");
    expect(executor).toContain("ll2Submitted");
    expect(executor).toContain("本次提交");
    const video = await read("../src/services/ll2/ll2-video.ts");
    expect(video).toContain("Math.ceil((seconds * 90) / interval)");
    const types = await read("../src/types/canvas.ts");
    expect(types).toContain("ll2Submitted?: string");
});

test("wan3 按官方 media[] 适配参考图/参考视频，不再只塞 img_url", async () => {
    const adapters = await read("../src/services/ll2/ll2-video-adapters.ts");
    expect(adapters).toContain("reference_video");
    expect(adapters).toContain("referenceMode");
    expect(adapters).toContain("input: {");
    const caps = await read("../src/lib/model-capabilities.ts");
    expect(caps).toContain("isWan ? 5");
    expect(caps).toContain("isWan ? 10");
    const video = await read("../src/services/ll2/ll2-video.ts");
    expect(video).toContain("万相 3.0 最多 5 段参考视频");
    expect(video).toContain("首帧/尾帧不能和参考视频");
});

test("超分阶段刷新会按 hdTaskId 续查，不重复提交超分", async () => {
    const hd = await read("../src/services/ll2/ll2-hd.ts");
    expect(hd).toContain("export async function ll2WaitHdTask");
    const exec = await read("../src/pages/canvas/canvas-ll2-video-execution.ts");
    expect(exec).toContain("ll2WaitHdTask(hdTaskId");
    expect(exec).toContain("onHdTaskId");
    const executor = await read("../src/pages/canvas/canvas-media-generation-executors.ts");
    expect(executor).toContain("ll2HdTaskId");
    const hook = await read("../src/pages/canvas/use-canvas-ll2-recovery.ts");
    expect(hook).toContain("metadata.ll2HdTaskId");
    const types = await read("../src/types/canvas.ts");
    expect(types).toContain("ll2HdTaskId?: string");
});

test("刷新后按 ll2TaskId 自动查回已生成的 LL2 片子", async () => {
    const service = await read("../src/services/ll2/ll2-video.ts");
    expect(service).toContain("export async function ll2ResumeVideo");
    expect(service).toContain("function waitForLL2Video");
    const hook = await read("../src/pages/canvas/use-canvas-ll2-recovery.ts");
    expect(hook).toContain("resumeLL2CanvasVideo");
    expect(hook).toContain("ll2TaskId");
    expect(hook).toContain("bootRef");
    const project = await read("../src/pages/canvas/project.tsx");
    expect(project).toContain("useCanvasLL2Recovery");
});

test("画布 LL2 节点会显示排队/生成/超分阶段，并对中断给出提示", async () => {
    const exec = await read("../src/pages/canvas/canvas-ll2-video-execution.ts");
    expect(exec).toContain("onStage");
    expect(exec).toContain("正在超分");
    expect(exec).toContain("fetchBlobWithTimeout");
    const status = await read("../src/components/canvas/canvas-node-status-content.tsx");
    expect(status).toContain("ll2Stale");
    expect(status).toContain("40 * 60 * 1000");
    expect(status).toContain("生成状态未确认");
    expect(status).toContain("metadata?.ll2Stage");
    const executor = await read("../src/pages/canvas/canvas-media-generation-executors.ts");
    expect(executor).toContain("ll2TaskId");
});

test("画布文本助手使用 DMC 深色玻璃样式", async () => {
    const css = await read("../src/styles/ll2-c-polish.css");
    expect(css).toContain(".ll2-agent.is-canvas");
    expect(css).toContain("rgba(22, 22, 26, 0.92)");
    expect(css).toContain(".ll2-agent.is-canvas .ll2-agent-compose textarea");
});

test("旧配置里的 auto-hd 也会从所有模型下拉里清掉", async () => {
    const store = await read("../src/stores/use-config-store.ts");
    expect(store).toContain('channel.models.filter((model) => model !== "auto-hd")');
    expect(store).toContain('return filterModelsByCapability(models, capability, config.channels).filter((model) => model !== "auto-hd")');
    const picker = await read("../src/components/model-picker.tsx");
    expect(picker).toContain('model !== "auto-hd"');
    const ll2 = await read("../src/stores/use-ll2-store.ts");
    expect(ll2).toContain('groups.video.filter((model) => model !== "auto-hd")');
});

test("画布入口输入框打 @ 会弹出本机素材库，且素材菜单可点", async () => {
    const entry = await read("../src/components/canvas/canvas-short-drama-entry.tsx");
    expect(entry).toContain("LL2AssetLibrary");
    expect(entry).toContain("handlePromptChange");
    expect(entry).toContain("insertAssetMention");
    expect(entry).toContain("打 @ 可以引用素材");
    // 菜单必须挂到 body，否则会被入口 stage 的 pointer-events: none 吞掉。
    expect(entry).toContain("createPortal");
    // 回调已带 @[名称]，不能再包一层 -> 不能出现 @[${title}]。
    expect(entry).not.toContain("@[${title}]");
    const css = await read("../src/styles/ll2-c-polish.css");
    expect(css).toContain("pointer-events: auto");
    expect(css).toContain("z-index: 400");
});

test("wan3 按官方素材规则校验参考视频/首尾帧混用", async () => {
    const video = await read("../src/services/ll2/ll2-video.ts");
    expect(video).toContain("万相 3.0 最多 5 段参考视频");
    expect(video).toContain("首帧/尾帧不能和参考视频");
});

test("画布 LL2 直连节点不显示「排队」三段进度", async () => {
    const status = await read("../src/components/canvas/canvas-node-status-content.tsx");
    expect(status).toContain("ll2Direct");
    expect(status).toContain('"正在生成"');
    expect(status).toContain("!uncertain && !workflow && !ll2Direct");
    const executor = await read("../src/pages/canvas/canvas-media-generation-executors.ts");
    expect(executor).toContain("ll2Direct: isLL2CanvasVideoModel(generationConfig) ? true : undefined");
});

test("画布 LL2 模型的能力表支持参考图/参考视频，不再误判不可用", async () => {
    const caps = await read("../src/lib/model-capabilities.ts");
    expect(caps).toContain('channel?.id === "ll2-primary"');
    expect(caps).toContain("ll2VideoCapabilityConfig");
    expect(caps).toContain("reference_to_video");
    expect(caps).toContain("const maxVideos = isH3 ? 3");
    expect(caps).toContain("isVidu ? 2");
});

test("画布生成配置会带上 LL2 提示词优化/超分开关，并不归一化 LL2 清晰度", async () => {
    const gen = await read("../src/lib/canvas/canvas-project-generation.ts");
    expect(gen).toContain("ll2PromptOptimizer: node?.metadata?.ll2PromptOptimizer");
    expect(gen).toContain("ll2Upscale: node?.metadata?.ll2UpscaleTarget");
    expect(gen).toContain("workflowProvider === \"model\" && !isLL2Model");
});

test("LL2 的 4K 档不会被上游归一化打回 720p；改分辨率会清掉不合法超分", async () => {
    const cfg = await read("../src/components/canvas/canvas-node-prompt-config.ts");
    expect(cfg).toContain("isLL2Model");
    expect(cfg).toContain("node.metadata?.vquality || globalConfig.vquality");
    expect(cfg).toContain('ll2UpscaleTarget: ""');
});

test("画布的两个 LL2 勾选值会写进节点 metadata 并读回", async () => {
    const cfg = await read("../src/components/canvas/canvas-node-prompt-config.ts");
    expect(cfg).toContain('if (key === "ll2PromptOptimizer") return { ll2PromptOptimizer: value }');
    expect(cfg).toContain('if (key === "ll2Upscale") return { ll2UpscaleTarget: value }');
    expect(cfg).toContain("node.metadata?.ll2PromptOptimizer");
    expect(cfg).toContain("node.metadata?.ll2UpscaleTarget");
    const types = await read("../src/types/canvas.ts");
    expect(types).toContain("ll2PromptOptimizer?: string");
    expect(types).toContain("ll2UpscaleTarget?: string");
});

test("auto-hd 不再出现在模型下拉里，只作为超分选项", async () => {
    const store = await read("../src/stores/use-ll2-store.ts");
    expect(store).toContain('groups.video.filter((model) => model !== "auto-hd")');
    const models = await read("../src/lib/ll2-models.ts");
    // auto-hd 仍然保留在价目/档位表里，只是不作为生成模型注册。
    expect(models).toContain('"auto-hd"');
});

test("画布视频节点走 LL2 直连（和一句话想法同一条客户端链路）", async () => {
    const executor = await read("../src/pages/canvas/canvas-media-generation-executors.ts");
    expect(executor).toContain("isLL2CanvasVideoModel");
    expect(executor).toContain("runLL2CanvasVideo");
    const helper = await read("../src/pages/canvas/canvas-ll2-video-execution.ts");
    expect(helper).toContain("ll2GenerateVideo");
    expect(helper).toContain("ll2RunHd");
    expect(helper).toContain("uploadMediaFile");
    expect(helper).toContain("ll2PromptOptimizer");
    const panel = await read("../src/components/video-settings-panel.tsx");
    expect(panel).toContain("ll2Upscale");
    expect(panel).toContain("提示词优化（H3 先按官方格式整理）");
});

test("H3 提示词优化：勾选才传 prompt_optimizer", async () => {
    const adapters = await read("../src/services/ll2/ll2-video-adapters.ts");
    expect(adapters).toContain("prompt_optimizer");
    const oneshot = await read("../src/components/ll2/ll2-oneshot.tsx");
    expect(oneshot).toContain("提示词优化");
    expect(oneshot).toContain("promptOptimizer");
    const workspace = await read("../src/lib/ll2-workspace.ts");
    expect(workspace).toContain("promptOptimizer: boolean");
});

test("14 个视频模型全部适配，秒数按字符串发，渠道缺失要说人话", async () => {
    const models = await read("../src/lib/ll2-models.ts");
    // 清单里每个非 H3 的视频模型都要在册，不能再退回「只有两个」。
    expect(models).toContain('"Super Vega 1.5-pro"');
    expect(models).toContain('"doubao-seedance-2-5"');
    expect(models).toContain("ll2IsTokenBilled");
    const adapters = await read("../src/services/ll2/ll2-video-adapters.ts");
    expect(adapters).toContain("OPENAI_VIDEO_LABELS");
    // 2026-11-19 实测：数字会 400，必须发字符串。
    expect(adapters).toContain("seconds: String(args.seconds)");
    const video = await read("../src/services/ll2/ll2-video.ts");
    // 503 也可能是「分组没挂这个模型的渠道」，不能笼统说成服务故障。
    expect(video).toContain("model_not_found");
});


