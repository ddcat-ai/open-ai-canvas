import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* ------------------------------------------------------------------ *
 * D-057B —— Server Executor（Agent 自主生产通道）
 *
 * 架构定位（D-056 / D-057A 专家裁决）：
 *   - Domain Tool 是**语义接口**，Agent 只说"我要 generateShot"；
 *     执行体有两条通道：Browser（Interactive）与 Server（Autonomous）。
 *   - 浏览器关闭 ≠ 生产工具不可用 —— 本文件就是关闭 R0 的那只"服务端手"。
 *   - **语义锚点只有一处**：生产语义实现在 Go 生产域
 *     （backend/internal/service/agent_shot_generation.go）。本文件只做
 *     HTTP 搬运与错误翻译，**不重新实现任何业务规则**（不挑模型、不钳时长、
 *     不拼 prompt），避免退化成两套生产语义。
 *   - **零凭据构造**：渠道 baseUrl/apiKey 等供应链字段由后端以 DB 渠道表为准
 *     强制覆盖，本进程既不读取也不传递任何密钥。
 *
 * 凭据形态（D-057A 定死）：Agent Service Token（ycat_ 前缀），
 * **禁止**用户名密码换 cookie。令牌落本地文件 canvas-agent/agent-server.json
 * （已 gitignore，不进仓库），环境变量优先：
 *   YINGCE_SERVER_BACKEND_URL  影策后端地址（默认 http://127.0.0.1:8080）
 *   YINGCE_AGENT_SERVICE_TOKEN Agent 服务令牌明文（仅签发时可见一次）
 * ------------------------------------------------------------------ */

const CONFIG_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "agent-server.json");
const DEFAULT_BACKEND_URL = "http://127.0.0.1:8080";
/** 建任务属于提交动作，给足握手时间；长耗时出片由后端任务链异步推进，这里不等待。 */
const REQUEST_TIMEOUT_MS = 30_000;

export type YingceServerConfig = { backendUrl: string; agentToken: string };

export type ServerGenerateShotInput = {
    videoSeconds?: number;
    resolution?: string;
    referenceImageUrls?: string[];
    workflowStepId?: string;
};

/** Server 通道返回值与 Browser 通道 GenerateShotResult 对齐，多一个 executor 标记便于可观测。 */
export type ServerGenerateShotResult = {
    taskId: string;
    shotId: string;
    unitId?: string;
    model: string;
    channelId: string;
    operation: string;
    videoSeconds: number;
    resolution: string;
    status: string;
    promptSource: string;
    executor: "server";
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

export function readYingceServerConfig(env: NodeJS.ProcessEnv = process.env): YingceServerConfig | null {
    const file = readConfigFile();
    const agentToken = pick(env, "YINGCE_AGENT_SERVICE_TOKEN", file.agentToken);
    if (!agentToken) return null;
    const backendUrl = (pick(env, "YINGCE_SERVER_BACKEND_URL", file.backendUrl) || DEFAULT_BACKEND_URL).replace(/\/+$/, "");
    return { backendUrl, agentToken };
}

export function yingceServerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return readYingceServerConfig(env) !== null;
}

/**
 * 调用后端 Server Executor 端点生成镜头视频。
 * 只建任务不等待完成（与 Browser 通道一致）：进度由项目工作区轮询，产物自动挂镜头。
 */
export async function serverGenerateShot(
    projectId: string,
    shotId: string,
    input: ServerGenerateShotInput,
    env: NodeJS.ProcessEnv = process.env,
): Promise<ServerGenerateShotResult> {
    const config = readYingceServerConfig(env);
    if (!config) {
        throw new Error("Server Executor 未配置 Agent 服务令牌：请在 canvas-agent/agent-server.json 写入 agentToken，或设置环境变量 YINGCE_AGENT_SERVICE_TOKEN");
    }
    const body: Record<string, unknown> = {};
    if (typeof input.videoSeconds === "number" && Number.isFinite(input.videoSeconds)) body.videoSeconds = input.videoSeconds;
    if (input.resolution) body.resolution = input.resolution;
    if (input.referenceImageUrls?.length) body.referenceImageUrls = input.referenceImageUrls;
    if (input.workflowStepId) body.workflowStepId = input.workflowStepId;

    const url = `${config.backendUrl}/api/agent/projects/${encodeURIComponent(projectId)}/shots/${encodeURIComponent(shotId)}/generate`;
    let response: Response;
    try {
        response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.agentToken}` },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
    } catch (error) {
        throw new Error(`无法连接影策后端（${config.backendUrl}）：${error instanceof Error ? error.message : String(error)}`);
    }
    const text = await response.text();
    const payload = parseJson(text);
    if (!response.ok) {
        throw new Error(translateError(response.status, payload));
    }
    const data = (payload && typeof payload === "object" && "data" in payload ? (payload as { data: unknown }).data : payload) as Record<string, unknown> | null;
    if (!data || typeof data.taskId !== "string") throw new Error("Server Executor 返回结构异常：缺少 taskId");
    return {
        taskId: data.taskId,
        shotId: String(data.shotId || shotId),
        ...(typeof data.unitId === "string" && data.unitId ? { unitId: data.unitId } : {}),
        model: String(data.model || ""),
        channelId: String(data.channelId || ""),
        operation: String(data.operation || ""),
        videoSeconds: Number(data.videoSeconds || 0),
        resolution: String(data.resolution || ""),
        status: String(data.status || ""),
        promptSource: String(data.promptSource || ""),
        executor: "server",
    };
}

function parseJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

/** 把后端错误翻成 Agent 能直接理解的中文，且明确区分"凭据问题"与"业务问题"。 */
function translateError(status: number, payload: unknown): string {
    const message = extractMessage(payload);
    if (status === 401) return message || "Agent 服务令牌无效、已过期或已吊销（401）";
    if (status === 403) return message || "Agent 服务令牌缺少所需 scope（403）：Server Executor 需要 yingce.generation.submit";
    if (status === 404) return message || "Server Executor 端点不存在：请确认后端已部署 D-057B";
    return message || `Server Executor 调用失败（HTTP ${status}）`;
}

function extractMessage(payload: unknown): string {
    if (!payload || typeof payload !== "object") return "";
    const record = payload as Record<string, unknown>;
    // 后端响应封装（internal/handler/response.go）：成功 {code:0,data,msg:"ok"}，
    // 失败 {code:status,data:null,msg:message} —— 错误文案在 msg 字段，不是 error。
    const candidates = [record.error, record.message, record.msg, (record.data as Record<string, unknown> | undefined)?.msg];
    for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }
    return "";
}
