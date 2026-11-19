// @ts-nocheck
/**
 * 本机 mock 网关自检：不连 api.ll2.cn、不产生任何真实费用。
 * 覆盖「进度 / 取消 / 失败 / 重试计费」四条路径，给 UI 文案提供可复现证据。
 * 运行：cd web && bun run scripts/ll2-video-mock-check.ts
 */
import { LL2_VIDEO_ADAPTERS } from "../src/services/ll2/ll2-video-adapters";
import { LL2_CONNECTED_VIDEO_MODELS } from "../src/lib/ll2-models";
import { ll2GenerateVideo } from "../src/services/ll2/ll2-video";
import { ll2FetchHdBlob, ll2RunHd } from "../src/services/ll2/ll2-hd";

let scenario = "success";
let createCount = 0;
let queryCount = 0;
const idempotencyKeys = [];
let openaiCreateBody = null;
// 超分（/hd/tasks）是独立协议，单独记录请求体与下载鉴权头。
let hdCreateBody = null;
let hdDownloadAuth = "";
let hdQueryCount = 0;
let h3CreateBody = null;
let wan3CreateBody = null;
let seedanceCreateBody = null;
let viduCreateBody = null;
let vegaCreateBody = null;

const server = Bun.serve({
    port: 0,
    async fetch(req) {
        const url = new URL(req.url);
        // 非 H3 的 13 个模型走 /v1/video/generations，字段与 H3 完全不同：
        // seconds 必须是字符串，比例字段叫 aspect_ratio，结果在 data.result_url。
        if (req.method === "POST" && url.pathname === "/super-vega/tasks") {
            vegaCreateBody = await req.json();
            createCount += 1;
            return Response.json({ TaskId: "vega-1", model: "Super Vega 1.0-lite" });
        }
        if (req.method === "GET" && url.pathname === "/super-vega/tasks/vega-1") {
            return Response.json({ Response: { Status: "FINISH", TaskId: "vega-1", TaskType: "AigcVideoTask", AigcVideoTask: { Status: "FINISH", ErrCode: 0, TaskId: "vega-1", Output: { FileInfos: [{ UsageType: "", FileUrl: "/v1/tasks/vega-1/artifacts/video/content" }], Usage: { OutputSeconds: 4, InputSeconds: 0, InputImageCount: 1 } } } } });
        }
        if (req.method === "GET" && url.pathname === "/v1/tasks/vega-1/artifacts/video/content") {
            return new Response(new Uint8Array([0, 1, 2]), { status: 200, headers: { "content-type": "video/mp4" } });
        }
        if (req.method === "POST" && url.pathname === "/vidu/ent/v2/img2video") {
            viduCreateBody = await req.json();
            createCount += 1;
            return Response.json({ task_id: "vidu-1", state: "created" });
        }
        if (req.method === "GET" && url.pathname === "/vidu/ent/v2/tasks/vidu-1/creations") {
            return Response.json({ id: "vidu-1", state: "success", creations: [{ id: "c1", url: "/v1/tasks/vidu-1/artifacts/video/content" }] });
        }
        if (req.method === "GET" && url.pathname === "/v1/tasks/vidu-1/artifacts/video/content") {
            return new Response(new Uint8Array([0, 1, 2]), { status: 200, headers: { "content-type": "video/mp4" } });
        }
        if (req.method === "POST" && url.pathname === "/seedance/api/v3/contents/generations/tasks") {
            seedanceCreateBody = await req.json();
            createCount += 1;
            return Response.json({ id: "seed-1", status: "queued" });
        }
        if (req.method === "GET" && url.pathname === "/seedance/api/v3/contents/generations/tasks/seed-1") {
            return Response.json({ id: "seed-1", status: "succeeded", content: { video_url: "/v1/tasks/seed-1/artifacts/video/content" }, duration: 4 });
        }
        if (req.method === "GET" && url.pathname === "/v1/tasks/seed-1/artifacts/video/content") {
            return new Response(new Uint8Array([0, 1, 2]), { status: 200, headers: { "content-type": "video/mp4" } });
        }
        if (req.method === "POST" && url.pathname === "/ali/api/v1/services/aigc/video-generation/video-synthesis") {
            wan3CreateBody = await req.json();
            createCount += 1;
            return Response.json({ output: { task_id: "wan3-mock-1", task_status: "PENDING" } });
        }
        if (req.method === "GET" && url.pathname.startsWith("/ali/api/v1/tasks/")) {
            return Response.json({ output: { task_id: "wan3-mock-1", task_status: "SUCCEEDED", video_url: "https://example.invalid/wan3.mp4" }, usage: { duration: 4 } });
        }
        if (req.method === "POST" && url.pathname === "/v1/video/generations") {
            createCount += 1;
            openaiCreateBody = await req.json();
            return Response.json({ data: { id: `openai-${createCount}` } });
        }
        if (req.method === "GET" && url.pathname.startsWith("/v1/video/generations/")) {
            queryCount += 1;
            if (queryCount < 2) return Response.json({ data: { status: "processing" } });
            return Response.json({
                data: { status: "succeeded", result_url: "https://example.invalid/openai.mp4", usage: { output_seconds: 2 } },
            });
        }
        if (req.method === "POST" && url.pathname === "/hd/tasks") {
            hdCreateBody = await req.json();
            return Response.json({ id: "hd-1", model: "auto-hd" });
        }
        if (req.method === "GET" && url.pathname === "/hd/tasks/hd-1") {
            hdQueryCount += 1;
            if (hdQueryCount < 2) return Response.json({ id: "hd-1", model: "auto-hd", status: "RUNNING" });
            return Response.json({ id: "hd-1", model: "auto-hd", status: "FINISHED", url: "/v1/tasks/hd-1/artifacts/video/content" });
        }
        if (req.method === "GET" && url.pathname === "/v1/tasks/hd-1/artifacts/video/content") {
            hdDownloadAuth = String(req.headers.get("authorization") || "");
            return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "video/mp4" } });
        }
        if (req.method === "POST" && url.pathname === "/v2/video_generation") {
            if (scenario === "http401") return Response.json({ message: "invalid token" }, { status: 401 });
            h3CreateBody = await req.json();
            createCount += 1;
            idempotencyKeys.push(req.headers.get("Idempotency-Key") || "(无)");
            return Response.json({ task_id: `mock-${createCount}` });
        }
        if (req.method === "GET" && url.pathname.startsWith("/v2/query/video_generation/")) {
            queryCount += 1;
            if (scenario === "taskFail") {
                return Response.json({ task: { status: "failed", error: { code: "content_policy_violation", message: "画面含敏感内容" } } });
            }
            if (scenario === "hang" || queryCount < 3) {
                return Response.json({ task: { status: queryCount % 2 ? "queued" : "processing" } });
            }
            return Response.json({
                task: { status: "success", content: { url: "https://example.invalid/mock.mp4" }, usage: { total_seconds: 5 } },
            });
        }
        return new Response("not found", { status: 404 });
    },
});

const baseUrl = `http://127.0.0.1:${server.port}`;
const common = (extra = {}) => ({
    apiKey: "local-mock-key-not-real",
    baseUrl,
    model: "MiniMax-H3",
    prompt: "一个外卖员意外捡到会说话的猫",
    seconds: 5,
    resolution: "768P",
    pollIntervalMs: 25,
    maxPolls: 10,
    ...extra,
});
const err = (cause) => {
    if (cause instanceof DOMException && cause.name === "AbortError") return "AbortError（已中止）";
    return cause instanceof Error ? cause.message : String(cause);
};
const out = [];

// ① 成功：进度事件序列 + 实付
scenario = "success"; createCount = 0; queryCount = 0;
const progress = [];
const ok = await ll2GenerateVideo(common(), (p) => progress.push({ ...p }));
out.push(`① 进度：${progress.length} 条事件 → ${progress.map((p) => `${p.stage}/${p.status}`).join(" → ")}`);
out.push(`   每条带 taskId / elapsedMs / pollCount，任务号 ${ok.taskId}`);
out.push(`   实付 ${ok.actualLabel}（${ok.actualBasis}），提交前预估 ${ok.estimateCNY} 元`);

// ② 取消
scenario = "hang"; createCount = 0; queryCount = 0;
const controller = new AbortController();
setTimeout(() => controller.abort(), 90);
let cancelMessage = "";
try { await ll2GenerateVideo(common({ signal: controller.signal }), () => {}); }
catch (cause) { cancelMessage = err(cause); }
const atAbort = queryCount;
await new Promise((r) => setTimeout(r, 100));
out.push(`② 取消：${cancelMessage}，轮询停在 ${atAbort} 次（再等 100ms 仍为 ${queryCount} 次）`);
out.push(`   服务端已受理 ${createCount} 个任务 → 取消只停本机等待，费用以 LL2 控制台账单为准`);

// ③ HTTP 失败
scenario = "http401";
let httpMessage = "";
try { await ll2GenerateVideo(common()); } catch (cause) { httpMessage = err(cause); }
out.push(`③ Key 无效：${httpMessage}`);

// ④ 任务失败
scenario = "taskFail"; queryCount = 0;
let taskMessage = "";
try { await ll2GenerateVideo(common()); } catch (cause) { taskMessage = err(cause); }
out.push(`④ 生成失败：${taskMessage}`);

// ⑤ 重试的幂等键 → 是否重复计费
scenario = "success"; createCount = 0; queryCount = 0;
await ll2GenerateVideo(common());
await ll2GenerateVideo(common());
await ll2GenerateVideo(common({ idempotencyKey: "ll2-fixed-retry-key" }));
const last3 = idempotencyKeys.slice(-3);
out.push(`⑤ 重试：两次普通重试的幂等键 ${last3[0] === last3[1] ? "相同" : "不同"} → ${last3[0] === last3[1] ? "可能复用任务" : "会新建任务、重新计费"}`);
out.push(`   显式传同一 key 时为 ${last3[2]}（复用同一任务，可避免重复扣费）`);

// ⑥ 14 个模型全部走专用协议，不再有「通用 openai-video」兜底
const protocols = LL2_CONNECTED_VIDEO_MODELS.map((model) => LL2_VIDEO_ADAPTERS[model]?.createPath || "");
const missing = LL2_CONNECTED_VIDEO_MODELS.filter((model) => !LL2_VIDEO_ADAPTERS[model] || !LL2_VIDEO_ADAPTERS[model].createPath);
out.push(`⑥ 专用协议覆盖：${missing.length ? "FAIL" : "PASS"} ${missing.length ? `缺 ${missing.join(",")}` : "14/14"}`);
if (missing.length) {
    console.error("⑥ 失败：有模型没有专用适配");
    process.exitCode = 1;
}
void protocols;

// ⑦ 超分：独立协议 /hd/tasks，结果要带 Bearer 才能下载
hdCreateBody = null; hdDownloadAuth = ""; hdQueryCount = 0;
const hd = await ll2RunHd({
    apiKey: "local-mock-key-not-real",
    videoUrl: "https://example.invalid/in.mp4",
    resolution: "2k",
    duration: 5,
    baseUrl: baseUrl,
    pollIntervalMs: 10,
    maxPolls: 5,
});
const hdBlob = await ll2FetchHdBlob(hd.url, "local-mock-key-not-real");
const hdOk =
    !!hdCreateBody &&
    hdCreateBody.model === "auto-hd" &&
    hdCreateBody.video_url === "https://example.invalid/in.mp4" &&
    hdCreateBody.resolution === "2k" &&
    hdCreateBody.duration === 5 &&
    hd.url === baseUrl + "/v1/tasks/hd-1/artifacts/video/content" &&
    hdDownloadAuth === "Bearer local-mock-key-not-real" &&
    hdBlob.size === 3;
out.push(`⑦ 超分协议：${hdOk ? "PASS" : "FAIL"} 创建体 ${JSON.stringify(hdCreateBody)}`);
out.push(`   任务 ${hd.taskId} → ${hd.url}，带 Bearer 下载 ${hdBlob.size} 字节`);
if (!hdOk) {
    console.error("⑦ 失败：超分协议 payload / 结果地址 / Bearer 下载不符合契约");
    process.exitCode = 1;
}

// ⑨ H3 提示词优化：只在勾选时显式传 prompt_optimizer=true
scenario = "success"; createCount = 0; queryCount = 0; h3CreateBody = null;
await ll2GenerateVideo(common({ promptOptimizer: true }));
const optOn = h3CreateBody?.prompt_optimizer === true;
h3CreateBody = null; createCount = 0; queryCount = 0;
await ll2GenerateVideo(common());
const optOff = !h3CreateBody || !("prompt_optimizer" in h3CreateBody);
out.push(`⑨ H3 提示词优化：${optOn && optOff ? "PASS" : "FAIL"} 勾选=${optOn}，不勾不传=${optOff}`);
if (!optOn || !optOff) {
    console.error("⑨ 失败：prompt_optimizer 只在勾选时传 true");
    process.exitCode = 1;
}

// ⑩ wan3 图生视频：走 DashScope 透传，图片进 input.img_url
scenario = "success"; createCount = 0; queryCount = 0; h3CreateBody = null; wan3CreateBody = null;
await ll2GenerateVideo(common({ model: "wan3.0-video", resolution: "480P", media: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" }, role: "first_frame" }] }));
const wanOk = wan3CreateBody?.input?.img_url === "data:image/png;base64,AAAA" && wan3CreateBody?.model === "wan3.0-video";
out.push(`⑩ wan3 图生视频：${wanOk ? "PASS" : "FAIL"} ${JSON.stringify(wan3CreateBody)}`);
if (!wanOk) {
    console.error("⑩ 失败：wan3 没有把图片放进 input.img_url");
    process.exitCode = 1;
}

// ⑪ seedance：content[] + 相对 artifact 地址（必须带 Bearer 取 blob）
scenario = "success"; createCount = 0; queryCount = 0; seedanceCreateBody = null;
const seed = await ll2GenerateVideo(common({ model: "doubao-seedance-2-0", resolution: "480P", media: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" }, role: "first_frame" }] }));
const seedOk =
    seedanceCreateBody?.content?.[0]?.type === "text" &&
    seedanceCreateBody?.content?.[1]?.image_url?.url === "data:image/png;base64,AAAA" &&
    seedanceCreateBody?.content?.[1]?.role === "first_frame" &&
    seedanceCreateBody?.resolution === "480p" &&
    seed.requiresAuth === true &&
    Boolean(seed.previewUrl);
out.push(`⑪ seedance 图生视频：${seedOk ? "PASS" : "FAIL"} preview=${Boolean(seed.previewUrl)} body=${JSON.stringify(seedanceCreateBody).slice(0, 120)}`);
if (!seedOk) {
    console.error("⑪ 失败：seedance content/artifact 鉴权不符合预期");
    process.exitCode = 1;
}

// ⑫ vidu：1 张图走 img2video，images[] 原样给 data URI，artifact 鉴权
scenario = "success"; createCount = 0; queryCount = 0; viduCreateBody = null;
const vidu = await ll2GenerateVideo(common({ model: "viduq3-pro", resolution: "720P", media: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" }, role: "first_frame" }] }));
const viduOk =
    viduCreateBody?.model === "viduq3-pro" &&
    Array.isArray(viduCreateBody?.images) && viduCreateBody.images[0] === "data:image/png;base64,AAAA" &&
    viduCreateBody?.resolution === "720p" &&
    vidu.requiresAuth === true && Boolean(vidu.previewUrl);
out.push(`⑫ vidu 图生视频：${viduOk ? "PASS" : "FAIL"} ${JSON.stringify(viduCreateBody).slice(0, 120)}`);
if (!viduOk) {
    console.error("⑫ 失败：vidu payload/artifact 鉴权不符合预期");
    process.exitCode = 1;
}

// ⑬ Super Vega：协议形状已按文档组好，但真机任务返回 FAIL，素材入口暂不放开
const vegaAdapter = LL2_VIDEO_ADAPTERS["Super Vega 1.0-lite"];
const vegaBody = vegaAdapter.buildCreatePayload(
    vegaAdapter.normalize({ model: "Super Vega 1.0-lite", prompt: "一只猫", seconds: 4, resolution: "768P", ratio: "16:9", media: [{ type: "image_url", image_url: { url: "https://example.com/first.png" }, role: "first_frame" }] }),
);
const vegaShapeOk =
    vegaBody.FileInfos?.[0]?.Category === "Image" &&
    vegaBody.FileInfos?.[0]?.Usage === "FirstFrame" &&
    vegaBody.OutputConfig?.Resolution === "768P";
let vegaBlocked = "";
try {
    await ll2GenerateVideo(common({ model: "Super Vega 1.0-lite", resolution: "768P", media: [{ type: "image_url", image_url: { url: "https://example.com/first.png" }, role: "first_frame" }] }));
} catch (error) {
    vegaBlocked = error instanceof Error ? error.message : String(error);
}
const vegaOk = vegaShapeOk && vegaBlocked.includes("还在验证");
out.push(`⑬ Super Vega：协议形状组件 ${vegaShapeOk ? "PASS" : "FAIL"}，素材入口${vegaBlocked.includes("还在验证") ? "已拦截" : "未拦截"}`);
if (!vegaOk) {
    console.error("⑬ 失败：vega 协议形状或素材拦截不符合预期");
    process.exitCode = 1;
}

console.log(out.join("\n"));
server.stop(true);
