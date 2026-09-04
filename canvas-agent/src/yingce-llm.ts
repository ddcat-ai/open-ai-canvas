import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentEmit } from "./types.js";

/**
 * 影策自有渠道后端：让侧栏 Agent 用影策自己配好的模型渠道说话，
 * 替代需要登录态的 Codex CLI / Claude CLI。前端零改动。
 *
 * 两种模式（配置文件 canvas-agent/agent-llm.json，或环境变量优先）：
 *  1) direct  —— 直连 OpenAI 兼容端点：需 apiKey（智谱/DeepSeek/Kimi/硅基流动...）
 *  2) backend —— 走影策后端渠道代理（Key 由后端解密注入，本进程自动登录换 cookie）
 *
 * 事件流与 CodexAppClient 保持同构：
 *   agent_event{type:"item.updated"} → 流式增量
 *   agent_event{type:"turn.completed"} / {type:"stream.summary"} → 完成
 *   agent_done → 结束；agent_error → 失败
 */

const CONFIG_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "agent-llm.json");

type YingceLlmConfig = {
    mode: "direct" | "backend";
    // direct 模式
    baseUrl: string;
    apiKey: string;
    model: string;
    // backend 模式
    backendUrl: string;
    username: string;
    password: string;
    channelId: string;
};

const DEFAULTS = {
    zhipuBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    backendUrl: "http://127.0.0.1:8080",
    channelId: "CHANNEL_000009",
    model: "glm-4.6",
};

function readConfigFile(): Record<string, unknown> {
    try {
        if (!fs.existsSync(CONFIG_FILE)) return {};
        return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) as Record<string, unknown>;
    } catch {
        return {};
    }
}

function pick(env: NodeJS.ProcessEnv, envKey: string, fileValue: unknown): string {
    const fromEnv = String(env[envKey] || "").trim();
    if (fromEnv) return fromEnv;
    return typeof fileValue === "string" ? fileValue.trim() : "";
}

export function readYingceLlmConfig(env: NodeJS.ProcessEnv = process.env): YingceLlmConfig | null {
    const file = readConfigFile();
    const apiKey = pick(env, "YINGCE_AGENT_API_KEY", file.apiKey);
    const model = pick(env, "YINGCE_AGENT_MODEL", file.model) || DEFAULTS.model;
    const username = pick(env, "YINGCE_AGENT_USERNAME", file.username);
    const password = pick(env, "YINGCE_AGENT_PASSWORD", file.password);
    const mode = pick(env, "YINGCE_AGENT_MODE", file.mode);

    if (apiKey) {
        const baseUrl = (pick(env, "YINGCE_AGENT_BASE_URL", file.baseUrl) || DEFAULTS.zhipuBaseUrl).replace(/\/+$/, "");
        return { mode: "direct", baseUrl, apiKey, model, backendUrl: "", username: "", password: "", channelId: "" };
    }
    if (username && password) {
        const backendUrl = (pick(env, "YINGCE_AGENT_BACKEND_URL", file.backendUrl) || DEFAULTS.backendUrl).replace(/\/+$/, "");
        const channelId = pick(env, "YINGCE_AGENT_CHANNEL_ID", file.channelId) || DEFAULTS.channelId;
        return { mode: "backend", baseUrl: "", apiKey: "", model, backendUrl, username, password, channelId };
    }
    return null;
}

export function yingceLlmEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return readYingceLlmConfig(env) !== null;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** 从 SSE 字节流里解析出 data: 载荷 */
async function* iterateSseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() || "";
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith("data:")) continue;
                const payload = trimmed.slice(5).trim();
                if (!payload) continue;
                yield payload;
            }
        }
        const tail = buffer.trim();
        if (tail.startsWith("data:")) yield tail.slice(5).trim();
    } finally {
        reader.releaseLock();
    }
}

function pickDelta(payload: string): string {
    try {
        const parsed = JSON.parse(payload) as Record<string, unknown>;
        const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
        const first = (choices[0] || {}) as Record<string, unknown>;
        const delta = (first.delta || {}) as Record<string, unknown>;
        // 只取 content；reasoning_content 是思考过程，不进正文
        if (typeof delta.content === "string") return delta.content;
        const message = (first.message || {}) as Record<string, unknown>;
        return typeof message.content === "string" ? message.content : "";
    } catch {
        return "";
    }
}

function pickUsage(payload: string): unknown {
    try {
        const parsed = JSON.parse(payload) as Record<string, unknown>;
        return parsed.usage ?? null;
    } catch {
        return null;
    }
}

// ---- backend 模式：自动登录 + cookie 缓存 ----
let backendCookie = "";

async function ensureBackendCookie(config: YingceLlmConfig, emit: AgentEmit): Promise<string> {
    if (backendCookie) return backendCookie;
    const response = await fetch(`${config.backendUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: config.username, password: config.password }),
    });
    if (!response.ok) throw new Error(`影策后端登录失败 ${response.status}`);
    const cookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie") || ""];
    const session = cookies.map((c) => /open_ai_canvas_session=([^;]+)/.exec(c)?.[1] || "").find(Boolean);
    if (!session) throw new Error("影策后端登录成功但未返回会话 cookie");
    backendCookie = session;
    emit("agent_log", { text: "影策后端自动登录成功" });
    return backendCookie;
}

async function callChatCompletions(config: YingceLlmConfig, messages: { role: string; content: string }[], emit: AgentEmit): Promise<Response> {
    const stream = true;
    const body = JSON.stringify({ model: config.model, stream, messages });
    const doCall = async (cookie: string) => {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (config.mode === "direct") headers.Authorization = `Bearer ${config.apiKey}`;
        else headers.Cookie = `open_ai_canvas_session=${cookie}`;
        const url = config.mode === "direct"
            ? `${config.baseUrl}/chat/completions`
            : `${config.backendUrl}/api/ai/system/${config.channelId}/chat/completions`;
        return fetch(url, { method: "POST", headers, body });
    };

    let cookie = "";
    if (config.mode === "backend") cookie = await ensureBackendCookie(config, emit);
    let response = await doCall(cookie);

    // backend 模式下 cookie 失效（401/403）→ 重新登录再试一次
    if (config.mode === "backend" && (response.status === 401 || response.status === 403)) {
        backendCookie = "";
        emit("agent_log", { text: "影策会话失效，自动重新登录" });
        cookie = await ensureBackendCookie(config, emit);
        response = await doCall(cookie);
    }
    return response;
}

export type YingceTurnOptions = {
    systemPrompt?: string;
    history?: { role: "user" | "assistant"; content: string }[];
};

/** 跑一轮对话：流式回吐事件，返回最终文本（供服务端历史记录） */
export async function runYingceTurn(prompt: string, emit: AgentEmit, options: YingceTurnOptions = {}): Promise<{ text: string }> {
    if (!prompt.trim()) return { text: "" };
    const config = readYingceLlmConfig();
    if (!config) {
        emit("agent_error", { message: "影策渠道未配置：请在 canvas-agent/agent-llm.json 里填写（backend 模式填 username/password，direct 模式填 apiKey）" });
        return { text: "" };
    }

    const itemId = `yingce-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let text = "";
    let deltaCount = 0;
    let lastUsage: unknown = null;

    const pushText = (chunk: string) => {
        if (!chunk) return;
        text += chunk;
        deltaCount += 1;
        emit("agent_event", {
            agent: "yingce",
            type: "item.updated",
            item: { id: itemId, type: "agent_message", text },
        });
    };

    try {
        const messages: { role: string; content: string }[] = [];
        if (options.systemPrompt?.trim()) messages.push({ role: "system", content: options.systemPrompt.trim() });
        if (Array.isArray(options.history)) {
            for (const item of options.history) {
                if (item?.content) messages.push({ role: item.role, content: item.content });
            }
        }
        messages.push({ role: "user", content: prompt });

        emit("agent_log", { text: `影策渠道(${config.mode})请求 model=${config.model}` });
        const response = await callChatCompletions(config, messages, emit);
        if (!response.ok || !response.body) {
            const detail = await response.text().catch(() => "");
            throw new Error(`影策渠道返回 ${response.status}${detail ? `：${detail.slice(0, 300)}` : ""}`);
        }

        for await (const payload of iterateSseData(response.body)) {
            if (payload === "[DONE]") break;
            const usage = pickUsage(payload);
            if (usage) lastUsage = usage;
            pushText(pickDelta(payload));
        }

        if (!text.trim()) {
            // 流里没拿到正文：降级非流式兜底一次
            const retry = await callChatCompletions(config, messages.map((m) => ({ ...m })), emit);
            if (retry.ok) {
                const data = (await retry.json().catch(() => null)) as Record<string, unknown> | null;
                const choices = data && Array.isArray(data.choices) ? (data.choices as Record<string, unknown>[]) : [];
                const message = (choices[0]?.message || {}) as Record<string, unknown>;
                const content = typeof message.content === "string" ? message.content : "";
                if (content.trim()) pushText(content);
                lastUsage = data?.usage ?? lastUsage;
            }
        }

        emit("agent_event", { agent: "yingce", type: "turn.completed", usage: lastUsage, item: { id: itemId, type: "agent_message", text } });
        emit("agent_event", { agent: "yingce", type: "stream.summary", delta_count: deltaCount });
        emit("agent_done", { agent: "yingce", usage: lastUsage });
        return { text };
    } catch (error) {
        emit("agent_error", { message: errorMessage(error) });
        return { text };
    }
}
