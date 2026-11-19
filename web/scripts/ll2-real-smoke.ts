/**
 * LL2 真实网关冒烟（**会产生真实费用**）。默认 H3 纯文字 1 秒，约 ¥0.05。
 *
 * Key 只从环境变量读，绝不写进任何输出。候选：
 *   LL2_TEST_API_KEY > DMC_MONITOR_KEY
 *
 * 用法：
 *   bun run scripts/ll2-real-smoke.ts --scenario=text
 *   bun run scripts/ll2-real-smoke.ts --all
 *   bun run scripts/ll2-real-smoke.ts --model=wan3.0-video --resolution=480P --seconds=2
 *   bun run scripts/ll2-real-smoke.ts --model=viduq3-turbo --scenario=text
 *   bun run scripts/ll2-real-smoke.ts --all --probe-idempotency
 *   bun run scripts/ll2-real-smoke.ts --all --create-only
 *
 * 关键点：payload / 查询路径 / 查询解析**都走产品里的适配器**
 * （services/ll2/ll2-video-adapters.ts），所以这里通了就代表线上那段代码能通，
 * 不是另写一套请求。
 *
 * 四种素材形态只对 MiniMax-H3 成立（H3 的 content[] 契约）；
 * 其它 13 个模型按纯文字出片，带素材会被产品自己拦住。
 */

import { IMAGE_A, IMAGE_B, VIDEO_A } from "./data/ll2-smoke-media";
import { LL2_VIDEO_TIERS, ll2PreciseCNY, type LL2ConnectedVideoModel } from "../src/lib/ll2-models";
import { ll2VideoAdapter } from "../src/services/ll2/ll2-video-adapters";
import type { LL2MediaContent } from "../src/services/ll2/ll2-media";

const ORIGIN = "https://api.ll2.cn";
const API_KEY = (process.env.LL2_TEST_API_KEY || process.env.DMC_MONITOR_KEY || "").trim();

const args = new Set(process.argv.slice(2));
const flag = (name: string) => args.has(`--${name}`);
const valueOf = (name: string, fallback: string) => {
    const hit = [...args].find((item) => item.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
};

if (!API_KEY) {
    console.error("缺 Key：请先设置 LL2_TEST_API_KEY（或 DMC_MONITOR_KEY）环境变量");
    process.exit(1);
}

const MODEL = (valueOf("model", "MiniMax-H3") || "MiniMax-H3").trim() as LL2ConnectedVideoModel;
const SECONDS = Number(valueOf("seconds", "1")) || 1;
const TIMEOUT_MS = Number(valueOf("timeout-ms", "480000")) || 480000;
const POLL_MS = 5000;
const CREATE_ONLY = flag("create-only");
const RESOLUTION = (valueOf("resolution", "") || LL2_VIDEO_TIERS[MODEL]?.[0]?.resolution || "768P").trim();

type Scenario = {
    name: string;
    label: string;
    prompt: string;
    media: Record<string, unknown>[];
};

const imageItem = (media: { dataUrl: string }, role: string) => ({ type: "image_url", image_url: { url: media.dataUrl }, role });
const videoItem = (media: { dataUrl: string }, role: string) => ({ type: "video_url", video_url: { url: media.dataUrl }, role });

const SCENARIOS: Scenario[] = [
    {
        name: "text",
        label: "纯文字 · 文生视频",
        prompt: "黄昏的海面，镜头缓缓向前推进，远处有一艘小船，金色反光从水面扫过",
        media: [],
    },
    {
        name: "first",
        label: "1 张图 · 首帧",
        prompt: "照着这张图，让云缓慢移动，镜头轻轻推近",
        media: [imageItem(IMAGE_A, "first_frame")],
    },
    {
        name: "frames",
        label: "2 张图 · 首尾帧",
        prompt: "从第一张画面平滑过渡到第二张画面，镜头缓慢向右摇",
        media: [imageItem(IMAGE_A, "first_frame"), imageItem(IMAGE_B, "last_frame")],
    },
    {
        name: "ref",
        label: "3 图 + 1 视频 · 多参考",
        prompt: "参考 <Picture 1> 的色调、<Picture 2> 的构图、<Picture 3> 的光线，模仿 <Video 1> 的镜头运动，拍一条安静的街景",
        media: [
            imageItem(IMAGE_A, "reference_image"),
            imageItem(IMAGE_B, "reference_image"),
            imageItem(IMAGE_A, "reference_image"),
            videoItem(VIDEO_A, "reference_video"),
        ],
    },
];

const requested = valueOf("scenario", "");
const requestedNames = new Set(requested.split(",").map((item) => item.trim()).filter(Boolean));
const allSelected = flag("all") ? SCENARIOS : SCENARIOS.filter((item) => requestedNames.has(item.name));

// 非 H3 没有 content[] 契约：带素材的场景直接跳过，别发一个注定失败的请求。
const mediaSupported = MODEL === "MiniMax-H3";
const selected = mediaSupported ? allSelected : allSelected.filter((item) => item.media.length === 0);
const skipped = allSelected.length - selected.length;

if (!selected.length) {
    console.error(
        mediaSupported
            ? "请用 --all 或 --scenario=text|first|frames|ref 指定场景"
            : `${MODEL} 目前只做纯文字，请用 --scenario=text 或去掉 --scenario 让脚本自己跳过带素材的场景`,
    );
    process.exit(1);
}

function headers(extra: Record<string, string> = {}) {
    return { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json", ...extra };
}

async function request(path: string, init: RequestInit) {
    const response = await fetch(`${ORIGIN}${path}`, init);
    const raw = await response.text();
    let payload: any = null;
    try { payload = raw ? JSON.parse(raw) : null; } catch { /* 非 JSON 响应原样保留 */ }
    return { status: response.status, ok: response.ok, payload, raw: raw.slice(0, 600) };
}

function isDone(status: string) {
    return ["success", "succeeded", "completed", "done", "finished"].some((word) => status.includes(word));
}
function isFailed(status: string) {
    return ["fail", "error", "cancel", "reject", "timeout"].some((word) => status.includes(word));
}

const adapter = ll2VideoAdapter(MODEL);

async function create(scenario: Scenario, idempotencyKey: string) {
    const normalized = adapter.normalize({
        model: MODEL,
        prompt: scenario.prompt,
        seconds: SECONDS,
        resolution: RESOLUTION,
        ratio: "16:9",
        media: scenario.media as unknown as LL2MediaContent[],
    });
    const body = adapter.buildCreatePayload(normalized);
    const result = await request(adapter.createPath, {
        method: "POST",
        headers: headers({ "Idempotency-Key": idempotencyKey }),
        body: JSON.stringify(body),
    });
    return { ...result, idempotencyKey, taskId: result.ok ? adapter.taskIdOf(result.payload) : "" };
}

async function poll(taskId: string, startedAt: number) {
    let lastStatus = "queued";
    let polls = 0;
    while (Date.now() - startedAt < TIMEOUT_MS) {
        await Bun.sleep(POLL_MS);
        polls += 1;
        const result = await request(adapter.queryPath(taskId), { method: "GET", headers: headers() });
        if (!result.ok) return { phase: "query_error", status: result.status, polls, detail: result.raw, url: "", chargedSeconds: 0 };
        const queried = adapter.parseQuery(result.payload);
        lastStatus = queried.status || lastStatus;
        if (isDone(queried.status)) {
            return { phase: "succeeded", status: queried.status, polls, url: queried.url, chargedSeconds: queried.chargedSeconds, detail: "" };
        }
        if (isFailed(queried.status)) {
            return {
                phase: "failed", status: queried.status, polls, url: queried.url, chargedSeconds: queried.chargedSeconds,
                detail: queried.errorMessage || queried.errorCode || result.raw,
            };
        }
        if (polls % 6 === 0) console.log(`    … ${taskId.slice(0, 12)} 仍在 ${lastStatus}，已等 ${Math.round((Date.now() - startedAt) / 1000)}s`);
    }
    return { phase: "timeout", status: lastStatus, polls, url: "", chargedSeconds: 0, detail: `超过 ${TIMEOUT_MS / 1000}s` };
}

type Row = {
    scenario: string;
    http: number;
    taskId: string;
    phase: string;
    status: string;
    polls: number;
    url: string;
    chargedSeconds: number;
    estimateLabel: string;
    detail: string;
};

const rows: Row[] = [];
const startedAt = Date.now();
const estimate = ll2PreciseCNY(MODEL, SECONDS, RESOLUTION);
console.log(`真网关冒烟 · ${MODEL} · ${RESOLUTION} · ${selected.length} 个场景 · ${SECONDS}s/条 · Key 已隐藏`);
console.log(`单条预估：${estimate.label}（${estimate.basis}）`);
if (skipped > 0) console.log(`已跳过 ${skipped} 个带素材场景：${MODEL} 目前按纯文字出片`);
console.log("");

// 先并行创建，避免串行等待把总时长拉长。
const creations = await Promise.all(selected.map(async (scenario) => ({ scenario, result: await create(scenario, crypto.randomUUID()) })));

for (const { scenario, result } of creations) {
    const base: Row = {
        scenario: scenario.name,
        http: result.status,
        taskId: result.taskId,
        phase: result.ok ? (result.taskId ? "created" : "no_task_id") : "create_error",
        status: "",
        polls: 0,
        url: "",
        chargedSeconds: 0,
        estimateLabel: estimate.label,
        detail: result.ok ? "" : result.raw,
    };
    console.log(`[${scenario.name}] 创建 HTTP ${result.status} task=${result.taskId || "—"}`);
    if (!result.ok || !result.taskId || CREATE_ONLY) { rows.push(base); continue; }
    const outcome = await poll(result.taskId, startedAt);
    rows.push({
        ...base,
        phase: outcome.phase,
        status: outcome.status || "",
        polls: outcome.polls,
        url: outcome.url,
        chargedSeconds: outcome.chargedSeconds,
        detail: outcome.detail,
    });
    console.log(`[${scenario.name}] ${outcome.phase} · status=${outcome.status} · 计费秒=${outcome.chargedSeconds} · url=${outcome.url ? "有" : "无"}`);
}

if (flag("probe-idempotency")) {
    // 固定用纯文字场景，排除素材差异，只验证网关层对 Idempotency-Key 的处理。
    const scenario = SCENARIOS[0];
    const key = crypto.randomUUID();
    const first = await create(scenario, key);
    const second = await create(scenario, key);
    const same = Boolean(first.taskId && first.taskId === second.taskId);
    console.log(`\n[幂等重放] 同 Idempotency-Key 两次创建：HTTP ${first.status}/${second.status}，task 相同=${same}`);
    console.log(`  → ${same ? "网关幂等，重试不会重复建单/重复扣费" : "网关不幂等，重试会新建任务，会再扣一次费"}`);
}

console.log("\n===== 汇总 =====");
console.log(`模型 ${MODEL} · ${RESOLUTION}`);
for (const row of rows) {
    console.log([
        row.scenario.padEnd(7),
        `HTTP ${row.http}`,
        row.phase.padEnd(12),
        `计费 ${row.chargedSeconds}s`,
        row.estimateLabel,
        row.url ? "有片" : "无片",
        row.detail ? `| ${row.detail.replace(/\s+/g, " ").slice(0, 110)}` : "",
    ].join("  "));
}
console.log(`\n总耗时 ${Math.round((Date.now() - startedAt) / 1000)}s；账单最终以 LL2 控制台为准。`);
