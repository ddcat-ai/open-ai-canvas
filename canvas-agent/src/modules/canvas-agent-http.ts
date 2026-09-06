import type { NextFunction, Request, RequestHandler, Response } from "express";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import {
    archiveCodexThread,
    listCodexThreads,
    readCodexThread,
    resumeCodexThread,
    runClaudeTurn,
    runCodexTurn,
    runWorkBuddyTurn,
    startCodexThread,
    summarizeCodexThread,
    verifyCodexThreadWorkspace,
    withAgentPrompt,
    workbuddyEnabled,
} from "../agents.js";
import { runYingceTurn, yingceLlmEnabled } from "../yingce-llm.js";
import { CanvasSession } from "../canvas-session.js";
import {
    AGENT_PROMPT,
    CONFIG_DIR,
    ensureCanvasWorkspace,
    updateCanvasWorkspace,
    type LocalRuntimeConfig,
} from "../config.js";
import type { LocalRuntimeModule, LocalRuntimeProtectedRoute } from "../local-runtime.js";
import type { AgentAttachment } from "../types.js";

export type CanvasAgentSession = Pick<
    CanvasSession,
    "health" | "openEvents" | "updateState" | "resolveResult" | "emitAll" | "callTool" | "closeRuntimeSession" | "dispose"
>;

/** WorkBuddy 会话 id 的落盘位置（与 canvas-agent.json 同目录，便于一起备份/排查）。 */
const WORK_BUDDY_SESSION_FILE = path.join(CONFIG_DIR, "workbuddy-sessions.json");

/** 启动时读回上次记住的会话 id。文件不存在/损坏一律当作“没有历史”，绝不让启动失败。 */
function loadWorkbuddySessions(): Record<string, string> {
    try {
        const parsed = JSON.parse(readFileSync(WORK_BUDDY_SESSION_FILE, "utf8")) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        const out: Record<string, string> = {};
        for (const [canvasId, sessionId] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof sessionId === "string" && sessionId) out[canvasId] = sessionId;
        }
        return out;
    } catch {
        return {};
    }
}

export function createCanvasAgentHttpModule(
    config: LocalRuntimeConfig,
    session: CanvasAgentSession = new CanvasSession(),
): LocalRuntimeModule {
    const emit = (type: string, payload: unknown) => session.emitAll(type, payload);
    /** 影策渠道的服务端会话历史（前端不传 history，按 canvasId 在此累积，最近 40 条） */
    const yingceHistory = new Map<string, { role: "user" | "assistant"; content: string }[]>();
    /**
     * WorkBuddy 后端的会话 id（按 canvasId 记忆，供 codebuddy --resume 续接）。
     * PATCH(agent-workbuddy-session-persist): 原先只在内存里，canvas-agent 一重启就全丢
     * ⇒ 每次重启后第一句话都被当成新会话，表现为「多轮对话断片」。
     * 2026-09-06 实测：codebuddy 的会话本体本来就是落盘的
     * （~/.workbuddy/projects/<cwd-slug>/<sessionId>.jsonl），跨进程 --resume 有效，
     * 所以这里只要把 id 也落盘，重启后就能续上。
     */
    const workbuddySessions = new Map<string, string>(Object.entries(loadWorkbuddySessions()));
    if (workbuddySessions.size > 0) {
        console.log(`[workbuddy] 已恢复 ${workbuddySessions.size} 个画布的续接会话（${WORK_BUDDY_SESSION_FILE}）`);
    }
    /** 串行化写盘，避免并发请求交错覆盖；写失败只静默跳过，绝不影响正常对话。 */
    let sessionPersistQueue: Promise<unknown> = Promise.resolve();
    const persistWorkbuddySessions = () => {
        sessionPersistQueue = sessionPersistQueue
            .then(() => writeFile(WORK_BUDDY_SESSION_FILE, JSON.stringify(Object.fromEntries(workbuddySessions), null, 2), "utf8"))
            .catch(() => undefined);
        return sessionPersistQueue;
    };
    const routes: LocalRuntimeProtectedRoute[] = [
        canvasRoute("GET", "/events", (req, res) => {
            session.openEvents(
                new URL(req.originalUrl || req.url, config.url),
                res,
                runtimeSessionId(res),
            );
        }, { queryKeys: ["clientId"], lastEventId: true }),
        canvasRoute("POST", "/canvas/state", (req, res) => {
            const result = session.updateState(jsonBody(req), queryValue(req, "clientId") || undefined);
            if (!result) {
                res.json({ ok: true });
                return;
            }
            if (result && !result.accepted) {
                res.status(409).json({ ok: false, ...result });
                return;
            }
            res.json({ ok: true, ...result });
        }, { queryKeys: ["clientId"] }),
        canvasRoute("POST", "/canvas/result", (req, res) => {
            session.resolveResult(jsonBody(req) as { requestId?: string; error?: string; result?: unknown });
            res.json({ ok: true });
        }, { queryKeys: ["clientId"] }),
        canvasRoute("POST", "/api/tools", async (req, res) => {
            const body = jsonRecord(req);
            res.json({ ok: true, result: await session.callTool(body.name, body.input || {}) });
        }),
        canvasRoute("GET", "/agent/codex/workspace", (req, res) => {
            const workspace = ensureCanvasWorkspace(config, queryValue(req, "canvasId"));
            res.json({ ok: true, workspace });
        }, { queryKeys: ["canvasId"] }),
        canvasRoute("GET", "/agent/codex/threads", async (req, res) => {
            const workspace = ensureCanvasWorkspace(config, queryValue(req, "canvasId"));
            const result = await listCodexThreads(emit, {
                cwd: workspace.workspacePath,
                searchTerm: queryValue(req, "searchTerm"),
            });
            res.json({ ok: true, workspace, ...result });
        }, { queryKeys: ["canvasId", "searchTerm"] }),
        canvasRoute("POST", "/agent/codex/threads/new", async (req, res) => {
            const body = jsonRecord(req);
            const workspace = ensureCanvasWorkspace(config, String(body.canvasId || ""));
            // 「新建会话」= 主动放弃续接，同步清掉落盘的 id
            workbuddySessions.delete(workspace.canvasId);
            void persistWorkbuddySessions();
            const thread = await startCodexThread(emit, workspace.workspacePath);
            const activeThreadId = String((thread as Record<string, unknown>).id || "");
            updateCanvasWorkspace(config, workspace.canvasId, { activeThreadId });
            res.json({
                ok: true,
                workspace: { ...workspace, activeThreadId },
                thread: summarizeCodexThread(thread),
                messages: [],
            });
        }),
        canvasRoute("GET", "/agent/codex/threads/:threadId", async (req, res) => {
            const workspace = ensureCanvasWorkspace(config, queryValue(req, "canvasId"));
            const threadId = routeParam(req.params.threadId);
            res.json({
                ok: true,
                workspace,
                ...(await readCodexThread(emit, threadId, workspace.workspacePath)),
            });
        }, { queryKeys: ["canvasId"] }),
        canvasRoute("POST", "/agent/codex/threads/:threadId/resume", async (req, res) => {
            const body = jsonRecord(req);
            const workspace = ensureCanvasWorkspace(config, String(body.canvasId || ""));
            const threadId = routeParam(req.params.threadId);
            const result = await resumeCodexThread(emit, threadId, workspace.workspacePath);
            updateCanvasWorkspace(config, workspace.canvasId, { activeThreadId: threadId });
            res.json({
                ok: true,
                workspace: { ...workspace, activeThreadId: threadId },
                ...result,
            });
        }),
        canvasRoute("POST", "/agent/codex/threads/:threadId/delete", async (req, res) => {
            const body = jsonRecord(req);
            const workspace = ensureCanvasWorkspace(config, String(body.canvasId || ""));
            const threadId = routeParam(req.params.threadId);
            await archiveCodexThread(emit, threadId, workspace.workspacePath);
            if (workspace.activeThreadId === threadId) {
                updateCanvasWorkspace(config, workspace.canvasId, { activeThreadId: undefined });
            }
            res.json({ ok: true });
        }),
        canvasRoute("POST", "/agent/codex/turn", (req, res) => {
            const body = jsonRecord(req);
            const prompt = withAgentPrompt(String(body.prompt || ""));
            // WorkBuddy 后端优先：codebuddy CLI 是完整 agent（MCP 工具 + 自主多轮），用户钦点
            if (workbuddyEnabled()) {
                const canvasKey = String(body.canvasId || "default");
                const rawPrompt = String(body.prompt || "");
                const resumeSessionId = workbuddySessions.get(canvasKey) || "";
                void runWorkBuddyTurn(prompt, emit, {
                    resumeSessionId,
                    onSessionId: (sessionId) => {
                        if (sessionId) {
                            workbuddySessions.set(canvasKey, sessionId);
                            void persistWorkbuddySessions();
                        }
                    },
                    // 续接失败 ⇒ id 已失效，丢弃它，下一轮自动开新会话（否则永久卡死）
                    onFailure: () => {
                        workbuddySessions.delete(canvasKey);
                        void persistWorkbuddySessions();
                    },
                });
                res.json({ ok: true, agent: "workbuddy" });
                return;
            }
            // 影策自有渠道其次：配了 YINGCE_AGENT_API_KEY 就走直连，不需要 Codex/Claude 登录态
            if (yingceLlmEnabled()) {
                const canvasKey = String(body.canvasId || "default");
                const rawPrompt = String(body.prompt || "");
                const history = [...(yingceHistory.get(canvasKey) || [])];
                void runYingceTurn(rawPrompt, emit, {
                    systemPrompt: AGENT_PROMPT,
                    history,
                }).then((result) => {
                    const list = yingceHistory.get(canvasKey) || [];
                    if (rawPrompt.trim()) list.push({ role: "user", content: rawPrompt.trim().slice(0, 24_000) });
                    if (result.text.trim()) list.push({ role: "assistant", content: result.text.trim().slice(0, 24_000) });
                    yingceHistory.set(canvasKey, list.slice(-40));
                }).catch(() => undefined);
                res.json({ ok: true, agent: "yingce" });
                return;
            }
            const attachments = Array.isArray(body.attachments)
                ? body.attachments as AgentAttachment[]
                : [];
            const skills = parseAgentSkills(body.skills);
            const workspace = ensureCanvasWorkspace(config, String(body.canvasId || ""));
            let threadId = String(body.threadId || workspace.activeThreadId || "");
            void (async () => {
                if (!threadId) {
                    const thread = await startCodexThread(emit, workspace.workspacePath);
                    threadId = String((thread as Record<string, unknown>).id || "");
                    updateCanvasWorkspace(config, workspace.canvasId, { activeThreadId: threadId });
                } else if (threadId !== workspace.activeThreadId) {
                    await verifyCodexThreadWorkspace(emit, threadId, workspace.workspacePath);
                    updateCanvasWorkspace(config, workspace.canvasId, { activeThreadId: threadId });
                }
                void runCodexTurn(
                    prompt,
                    emit,
                    attachments,
                    {
                        skills,
                        threadId,
                        cwd: workspace.workspacePath,
                        onThreadId: (nextThreadId) => updateCanvasWorkspace(
                            config,
                            workspace.canvasId,
                            { activeThreadId: nextThreadId },
                        ),
                    },
                );
                if (!res.headersSent) res.json({ ok: true, threadId });
            })().catch((error) => {
                if (!res.headersSent) res.status(500).json({ ok: false, error: publicCanvasError(error) });
            });
        }),
        canvasRoute("POST", "/agent/claude/turn", (req, res) => {
            const body = jsonRecord(req);
            runClaudeTurn(withAgentPrompt(String(body.prompt || "")), emit);
            res.json({ ok: true });
        }),
    ];

    return {
        descriptor: {
            id: "canvas-agent",
            displayName: "Canvas Agent",
            apiVersion: 1,
            scopes: ["canvas:connect"],
        },
        routes,
        onRuntimeSessionRevoked: (sessionId) => session.closeRuntimeSession(sessionId),
        publicHealth: () => {
            const { ok: _ok, ...health } = session.health();
            return health;
        },
        dispose: () => session.dispose(),
    };
}

function runtimeSessionId(res: Response) {
    const value = (res.locals.runtimeSession as { sessionId?: unknown } | undefined)?.sessionId;
    return typeof value === "string" && value ? value : undefined;
}

function canvasRoute(
    method: "GET" | "POST",
    path: string,
    handler: (req: Request, res: Response) => void | Promise<void>,
    options: { queryKeys?: readonly string[]; lastEventId?: boolean } = {},
): LocalRuntimeProtectedRoute {
    return {
        method,
        path,
        scope: "canvas:connect",
        handler: route(handler),
        legacy: true,
        ...options,
    };
}

function route(handler: (req: Request, res: Response) => void | Promise<void>): RequestHandler {
    return (req, res, next) => void Promise.resolve(handler(req, res)).catch(next);
}

function jsonBody(req: Request) {
    if (!Buffer.isBuffer(req.body)) throw new Error("Canvas request body is invalid");
    return JSON.parse(req.body.toString("utf8")) as unknown;
}

function jsonRecord(req: Request) {
    const value = jsonBody(req);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Canvas request body is invalid");
    }
    return value as Record<string, unknown>;
}

export function parseAgentSkills(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 8).flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const input = item as Record<string, unknown>;
        const name = typeof input.name === "string" ? input.name.trim().slice(0, 120) : "";
        const instruction = typeof input.instruction === "string" ? input.instruction.trim().slice(0, 24_000) : "";
        const files = parseAgentSkillFiles(input.files);
        if (!name || (!instruction && !files.length)) return [];
        return [{
            ...(typeof input.skillId === "string" ? { skillId: input.skillId.trim().slice(0, 120) } : {}),
            name,
            ...(typeof input.description === "string" ? { description: input.description.trim().slice(0, 500) } : {}),
            ...(typeof input.version === "string" ? { version: input.version.trim().slice(0, 120) } : {}),
            ...(files.length ? { files } : { instruction }),
        }];
    });
}

function parseAgentSkillFiles(value: unknown) {
    if (!Array.isArray(value)) return [];
    const files: Array<{ path: string; mimeType?: string; contentBase64: string }> = [];
    const paths = new Set<string>();
    let totalBytes = 0;
    for (const item of value.slice(0, 512)) {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const input = item as Record<string, unknown>;
        const filePath = typeof input.path === "string" ? normalizeAgentSkillPath(input.path) : "";
        const contentBase64 = typeof input.contentBase64 === "string" ? input.contentBase64.trim() : "";
        if (!filePath || paths.has(filePath) || !validBase64(contentBase64)) return [];
        const size = Buffer.from(contentBase64, "base64").byteLength;
        if (size > 8 * 1024 * 1024) return [];
        totalBytes += size;
        if (totalBytes > 20 * 1024 * 1024) return [];
        paths.add(filePath);
        files.push({
            path: filePath,
            ...(typeof input.mimeType === "string" ? { mimeType: input.mimeType.trim().slice(0, 255) } : {}),
            contentBase64,
        });
    }
    return files.some((file) => file.path === "SKILL.md") ? files : [];
}

function normalizeAgentSkillPath(value: string) {
    const normalized = value.trim().replace(/\\/g, "/");
    const segments = normalized.split("/");
    if (!normalized || normalized.startsWith("/") || normalized.length > 1000 || segments.some((segment) => !segment || segment === "." || segment === "..") || normalized.includes("\0")) return "";
    return normalized;
}

function validBase64(value: string) {
    return value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value);
}

function queryValue(req: Request, key: string) {
    const value = req.query[key];
    return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
}

function routeParam(value: string | string[]) {
    return Array.isArray(value) ? value[0] || "" : value;
}

function publicCanvasError(_error: unknown) {
    return "Canvas Agent request failed";
}
