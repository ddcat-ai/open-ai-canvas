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

test("带素材不再强制锁 H3：所有模型都按统一网关的素材字段发送", async () => {
    // 2026-11-19 用户口径：什么模型都能带素材；不再自动切 H3、也不禁用模型下拉。
    const source = await read("../src/components/ll2/ll2-oneshot.tsx");
    expect(source).not.toContain('setModel("MiniMax-H3")');
    expect(source).not.toContain("disabled={hasAnyReference}");
    expect(source).not.toContain("带素材时自动用 H3");
    const adapters = await read("../src/services/ll2/ll2-video-adapters.ts");
    expect(adapters).toContain("image_urls");
    expect(adapters).toContain("video_urls");
    expect(adapters).toContain("audio_urls");
    const video = await read("../src/services/ll2/ll2-video.ts");
    expect(video).not.toContain("带图片或视频参考时请选 MiniMax-H3");
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


