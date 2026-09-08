import assert from "node:assert/strict";
import fs from "node:fs";
import http, { type Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { CanvasSession } from "../src/canvas-session.js";
import { readYingceServerConfig, serverGenerateShot } from "../src/yingce-server-executor.js";

const AGENT_SERVER_CONFIG_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "agent-server.json");

/* ------------------------------------------------------------------ *
 * D-057B —— Server Executor（自主生产通道）单测
 *
 * 这些用例守的是 R0 的关闭条件：**浏览器不存在时，生产工具必须仍然可用**。
 * 全部用本地 http 假后端，不连生产、不花钱、不依赖真实渠道。
 * ------------------------------------------------------------------ */

type Captured = { url?: string; auth?: string; body?: Record<string, unknown> };

async function withFakeBackend(
    handler: (req: http.IncomingMessage, body: string) => { status: number; payload: unknown },
    run: (captured: Captured, baseUrl: string) => Promise<void>,
) {
    const captured: Captured = {};
    const server: Server = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf8");
            captured.url = req.url;
            captured.auth = req.headers.authorization;
            try {
                captured.body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
            } catch {
                captured.body = {};
            }
            const outcome = handler(req, raw);
            res.writeHead(outcome.status, { "Content-Type": "application/json" });
            res.end(JSON.stringify(outcome.payload));
        });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    try {
        await run(captured, `http://127.0.0.1:${port}`);
    } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
}

const envWith = (extra: Record<string, string>): NodeJS.ProcessEnv => ({ ...process.env, ...extra }) as NodeJS.ProcessEnv;

function restoreEnv(key: string, value: string | undefined) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
}

// 1. 没有令牌 ⇒ 通道不可用（绝不能退化成匿名调用后端）
test("Server Executor 未配置令牌时不可用", () => {
    // 本地配置文件存在时该断言不适用（那是正常配置态），跳过即可
    if (fs.existsSync(AGENT_SERVER_CONFIG_FILE)) return;
    const env = envWith({ YINGCE_AGENT_SERVICE_TOKEN: "", YINGCE_SERVER_BACKEND_URL: "" });
    delete env.YINGCE_AGENT_SERVICE_TOKEN;
    assert.equal(readYingceServerConfig(env), null);
});

// 2. 令牌来自环境变量，后端地址可覆盖且有默认值
test("Server Executor 读取环境变量配置", () => {
    const config = readYingceServerConfig(envWith({ YINGCE_AGENT_SERVICE_TOKEN: "ycat_test", YINGCE_SERVER_BACKEND_URL: "http://127.0.0.1:9999/" }));
    assert.equal(config?.agentToken, "ycat_test");
    assert.equal(config?.backendUrl, "http://127.0.0.1:9999");
});

// 3. 成功路径：Bearer 头、路径参数、结果字段、executor 标记
test("serverGenerateShot 以 Bearer 令牌调用后端并回传结构化结果", async () => {
    await withFakeBackend(
        () => ({
            status: 200,
            payload: {
                code: 0,
                msg: "ok",
                data: {
                    taskId: "TASK_1",
                    shotId: "SHOT_1",
                    unitId: "UNIT_1",
                    model: "minimax_h3_lightx2v_no_pic",
                    channelId: "CHANNEL_000015",
                    operation: "text_to_video",
                    videoSeconds: 1,
                    resolution: "768p横",
                    status: "queued",
                    promptSource: "revision",
                    executor: "server",
                },
            },
        }),
        async (captured, baseUrl) => {
            const result = await serverGenerateShot(
                "PROJ_1",
                "SHOT_1",
                { videoSeconds: 1, resolution: "768p横" },
                envWith({ YINGCE_AGENT_SERVICE_TOKEN: "ycat_test", YINGCE_SERVER_BACKEND_URL: baseUrl }),
            );
            assert.equal(result.taskId, "TASK_1");
            assert.equal(result.executor, "server");
            assert.equal(captured.auth, "Bearer ycat_test");
            assert.equal(captured.url, "/api/agent/projects/PROJ_1/shots/SHOT_1/generate");
            assert.equal(captured.body?.videoSeconds, 1);
        },
    );
});

// 4. 错误翻译：401/403 必须给出可行动中文，而不是干巴巴的 HTTP 状态码
test("serverGenerateShot 把 401/403 翻译成可行动错误", async () => {
    const cases: Array<{ status: number; payload: unknown; expect: RegExp }> = [
        { status: 401, payload: { code: 401, data: null, msg: "令牌已吊销" }, expect: /令牌已吊销|401/ },
        { status: 403, payload: { code: 403, data: null, msg: "缺少 scope" }, expect: /缺少 scope|403/ },
    ];
    for (const item of cases) {
        await withFakeBackend(
            () => ({ status: item.status, payload: item.payload }),
            async (_captured, baseUrl) => {
                await assert.rejects(
                    () => serverGenerateShot("PROJ_1", "SHOT_1", {}, envWith({ YINGCE_AGENT_SERVICE_TOKEN: "ycat_test", YINGCE_SERVER_BACKEND_URL: baseUrl })),
                    (error: Error) => {
                        assert.match(error.message, item.expect);
                        return true;
                    },
                );
            },
        );
    }
});

// 5. ★ R0 关闭条件：没有连接任何浏览器画布时，project_generate_shot 仍可执行
test("无浏览器画布时 project_generate_shot 走 Server Executor 而不是直接抛错", async () => {
    await withFakeBackend(
        () => ({
            status: 200,
            payload: { code: 0, msg: "ok", data: { taskId: "TASK_2", shotId: "SHOT_9", model: "m", channelId: "c", operation: "text_to_video", videoSeconds: 1, resolution: "768p横", status: "queued", promptSource: "revision", executor: "server" } },
        }),
        async (captured, baseUrl) => {
            // callTool 内部统一走 process.env，这里临时注入令牌与假后端地址
            const previousUrl = process.env.YINGCE_SERVER_BACKEND_URL;
            const previousToken = process.env.YINGCE_AGENT_SERVICE_TOKEN;
            process.env.YINGCE_SERVER_BACKEND_URL = baseUrl;
            process.env.YINGCE_AGENT_SERVICE_TOKEN = "ycat_test";
            try {
                const session = new CanvasSession();
                const result = (await session.callTool("project_generate_shot", {
                    projectId: "PROJ_1",
                    shotId: "SHOT_9",
                    videoSeconds: 1,
                })) as { taskId: string; executor: string };
                assert.equal(result.taskId, "TASK_2");
                assert.equal(result.executor, "server");
            } finally {
                restoreEnv("YINGCE_SERVER_BACKEND_URL", previousUrl);
                restoreEnv("YINGCE_AGENT_SERVICE_TOKEN", previousToken);
            }
            assert.equal(captured.url, "/api/agent/projects/PROJ_1/shots/SHOT_9/generate");
        },
    );
});

// 6. Server 模式要求显式 projectId：没有画布上下文时不能靠猜
test("无画布且缺 projectId 时报错而不是盲目执行", async () => {
    const session = new CanvasSession();
    await assert.rejects(
        () => session.callTool("project_generate_shot", { shotId: "SHOT_9" }),
        /projectId/,
    );
});

// 7. 尚未支持 Server 执行的工具必须明确告知，不能静默成功也不能伪装成画布错误
test("未迁移的工具在无画布时给出明确不支持提示", async () => {
    const session = new CanvasSession();
    await assert.rejects(
        () => session.callTool("project_get_context", { projectId: "PROJ_1" }),
        /暂不支持 Server 执行/,
    );
});
