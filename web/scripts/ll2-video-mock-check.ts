// @ts-nocheck
/**
 * 本机 mock 网关自检：不连 api.ll2.cn、不产生任何真实费用。
 * 覆盖「进度 / 取消 / 失败 / 重试计费」四条路径，给 UI 文案提供可复现证据。
 * 运行：cd web && bun run scripts/ll2-video-mock-check.ts
 */
import { ll2GenerateVideo } from "../src/services/ll2/ll2-video";

let scenario = "success";
let createCount = 0;
let queryCount = 0;
const idempotencyKeys = [];
let openaiCreateBody = null;

const server = Bun.serve({
    port: 0,
    async fetch(req) {
        const url = new URL(req.url);
        // 非 H3 的 13 个模型走 /v1/video/generations，字段与 H3 完全不同：
        // seconds 必须是字符串，比例字段叫 aspect_ratio，结果在 data.result_url。
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
        if (req.method === "POST" && url.pathname === "/v2/video_generation") {
            if (scenario === "http401") return Response.json({ message: "invalid token" }, { status: 401 });
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

// ⑥ 非 H3 模型：走 /v1/video/generations，同一个工厂适配器，验证 payload 与查询解析。
// 用户点名先测 seedance 2.0 / viduq3-pro / Super Vega 1.0-pro 三档。
const OPENAI_MODELS = [
    { model: "doubao-seedance-2-0", resolution: "720p" },
    { model: "viduq3-pro", resolution: "720p" },
    { model: "Super Vega 1.0-pro", resolution: "720P" },
];
let openaiFails = 0;
for (const item of OPENAI_MODELS) {
    scenario = "success"; createCount = 0; queryCount = 0; openaiCreateBody = null;
    const result = await ll2GenerateVideo(common({ model: item.model, resolution: item.resolution, seconds: 2 }));
    const bodyOk =
        !!openaiCreateBody &&
        openaiCreateBody.model === item.model &&
        openaiCreateBody.seconds === "2" &&
        openaiCreateBody.aspect_ratio === "16:9" &&
        openaiCreateBody.resolution === item.resolution;
    out.push(`⑥ ${item.model}：${bodyOk ? "PASS" : "FAIL"} 创建体 ${JSON.stringify(openaiCreateBody)}`);
    out.push(`   任务号 ${result.taskId} · 协议 ${result.protocol} · 结果 ${result.url} · 实付 ${result.actualLabel}`);
    // 豆包四款按 Token 计费：出片后不能显示「实付 ¥0」，必须说「按 Token 计费」。
    const tokenBilledOk = !item.model.startsWith("doubao") || String(result.actualLabel).includes("Token");
    if (tokenBilledOk) out.push(`   实付口径 ${result.actualLabel}（${result.actualBasis.slice(0, 40)}…）`);
    if (!bodyOk || !tokenBilledOk || String(result.taskId) !== "openai-1" || result.url !== "https://example.invalid/openai.mp4") openaiFails += 1;
}
if (openaiFails) {
    console.error(`⑥ 失败：${openaiFails} 个非 H3 模型的 payload 或查询解析不符合契约`);
    process.exitCode = 1;
}

console.log(out.join("\n"));
server.stop(true);
