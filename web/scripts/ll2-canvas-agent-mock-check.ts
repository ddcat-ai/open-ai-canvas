// @ts-nocheck
/**
 * 画布「文本助手 → Agent 出片」本机 mock 自检。
 * 不连 api.ll2.cn、不产生任何真实费用；验证整理提示词、提交前报价、
 * 创建/轮询/计费、作品库登记、以及提示词 + 视频两个节点写回同一张画布。
 *
 * 运行：cd web && bun run scripts/ll2-canvas-agent-mock-check.ts
 */
import { ll2BuildCanvasNodes, ll2CanvasAgentEstimate, ll2CleanVideoPrompt, ll2RunCanvasAgent } from "../src/services/ll2/ll2-canvas-agent";
import { ll2ListFilms } from "../src/services/ll2/ll2-films";

// ll2-films / ll2-workspace 都读 window.localStorage，Bun 里补一个最小内存实现。
const storage = new Map();
const memoryStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
};
globalThis.window = { localStorage: memoryStorage };
// localforage 初始化时会探测全局 localStorage，Bun 里补上。
// 注：Bun 没有 IndexedDB，导入 ll2-workspace 时仍会打印一条「持久化失败」告警，
// 这是测试环境限制，浏览器里不会发生，也不影响下面的断言。
globalThis.localStorage = memoryStorage;

let scenario = "success";
let created = 0;
let queries = 0;
const server = Bun.serve({
    port: 0,
    fetch(req) {
        const url = new URL(req.url);
        if (req.method === "POST" && url.pathname === "/v2/video_generation") {
            created += 1;
            return Response.json({ task_id: `mock-canvas-${created}` });
        }
        if (req.method === "GET" && url.pathname.startsWith("/v2/query/video_generation/")) {
            queries += 1;
            if (scenario === "hang" || queries < 3) return Response.json({ task: { status: queries % 2 ? "queued" : "processing" } });
            return Response.json({
                task: { status: "success", content: { url: "https://example.invalid/mock-canvas.mp4" }, usage: { total_seconds: 5 } },
            });
        }
        return new Response("not found", { status: 404 });
    },
});
const baseUrl = `http://127.0.0.1:${server.port}`;
const settings = { videoModel: "MiniMax-H3", resolution: "768P", seconds: 5, ratio: "16:9", textModel: "glm-5.3-flash" };
const out = [];

// ① 文本助手输出的是分镜清单 + 标题，交给 Agent 前必须收成一段纯画面描述
const assistantText = [
    "## 第 1 集：雨夜来客",
    "1. 主体：撑伞的人走过老城",
    "2. 光线：路灯光偏暖",
    "3. 镜头：低角度跟拍",
    "",
    "提示词：雨夜老城的石板路，一个撑伞的人缓缓走过，暖黄路灯把水洼照出反光，镜头低角度跟拍，画面安静潮湿",
].join("\n");
const cleaned = ll2CleanVideoPrompt(assistantText);
out.push(`① 整理提示词：${cleaned}`);
out.push(`   标题/Markdown/编号已去掉=${!/##|\d\.|提示词：/.test(cleaned)}，长度=${cleaned.length}`);

// ② 提交前把这次花多少钱算清楚
const estimate = ll2CanvasAgentEstimate(settings);
out.push(`② 提交前报价：${estimate.description} → ${estimate.label}`);
out.push(`   ${estimate.basis}`);

// ③ 走完创建 → 轮询 → 计费 → 登记本机作品库
const progress = [];
const { outcome, film } = await ll2RunCanvasAgent({
    apiKey: "local-mock-key-not-real",
    prompt: cleaned,
    signal: new AbortController().signal,
    settings,
    baseUrl,
    pollIntervalMs: 10,
    maxPolls: 10,
    onProgress: (p) => progress.push(`${p.stage}/${p.status}`),
});
out.push(`③ 出片：进度 ${progress.length} 条（${progress.join(" → ")}），任务号 ${outcome.taskId}`);
out.push(`   实付 ${outcome.actualLabel}（${outcome.actualBasis}），直链 ${film.url}`);
out.push(`   作品库已登记=${ll2ListFilms().some((item) => item.id === film.id)}，共 ${ll2ListFilms().length} 条`);

// ④ 提示词 + 成片落在同一张画布、挨着摆
const nodes = ll2BuildCanvasNodes(cleaned, film, 800);
out.push(`④ 写回画布：${nodes.length} 个节点 → ${nodes.map((node) => `${node.type}:${node.title}`).join(" + ")}`);
out.push(`   文本节点带提示词=${nodes[0].metadata.prompt === cleaned}，视频节点 content=${nodes[1].metadata.content === film.url}，状态=${nodes[1].metadata.status}`);
out.push(`   相邻摆放 x=${nodes[0].position.x} → ${nodes[1].position.x}`);

// ⑤ 取消：只停本机等待，服务端任务已受理
scenario = "hang";
queries = 0;
const controller = new AbortController();
setTimeout(() => controller.abort(), 80);
let cancelMessage = "";
try {
    await ll2RunCanvasAgent({ apiKey: "local-mock-key-not-real", prompt: cleaned, signal: controller.signal, settings, baseUrl, pollIntervalMs: 20, maxPolls: 20 });
} catch (cause) {
    cancelMessage = cause instanceof DOMException && cause.name === "AbortError" ? "AbortError（已停止等待）" : String(cause);
}
out.push(`⑤ 取消：${cancelMessage}，服务端已受理 ${created} 个任务 → 费用以 LL2 控制台账单为准`);

console.log(out.join("\n"));
server.stop(true);
