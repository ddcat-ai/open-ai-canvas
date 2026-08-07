import express, { type NextFunction, type Request, type Response } from "express";
import { randomBytes } from "node:crypto";

import { DEFAULT_PORT, ensureCanvasWorkspace, loadConfig, saveConfig, updateCanvasWorkspace, type CanvasAgentConfig } from "./config.js";
import { CanvasSession } from "./canvas-session.js";
import { archiveCodexThread, listCodexThreads, readCodexThread, resumeCodexThread, runClaudeTurn, runCodexTurn, startCodexThread, summarizeCodexThread, verifyCodexThreadWorkspace, withAgentPrompt } from "./agents.js";
import type { AgentAttachment } from "./types.js";

const EVENT_SESSION_COOKIE = "canvas_agent_event_session";
const EVENT_SESSION_TTL_MS = 10 * 60 * 1000;
const eventSessions = new Map<string, number>();

export function startHttpServer() {
    const config = loadConfig(true);
    const port = Number(process.env.PORT) || Number(new URL(config.url).port) || DEFAULT_PORT;
    config.url = `http://127.0.0.1:${port}`;
    saveConfig(config);

    const session = new CanvasSession();
    const emit = (type: string, payload: unknown) => session.emitAll(type, payload);
    const app = express();
    app.disable("x-powered-by");
    app.use(express.json({ limit: "30mb" }));
    app.use((req, res, next) => {
        const url = requestUrl(req, config);
        if (!setCors(req, res, url, config)) return void res.status(403).json({ ok: false, error: "origin not allowed" });
        if (req.method === "OPTIONS") return void res.json({});
        next();
    });
    app.get("/health", (_req, res) => res.json(session.health()));
    app.get("/config", (_req, res) => res.json({ ok: true, url: config.url, hasToken: true }));
    app.post("/events/session", (req, res) => {
        const header = req.headers["x-canvas-agent-token"];
        const headerMatches = header === config.token || (Array.isArray(header) && header.includes(config.token));
        if (!headerMatches) return void res.status(401).json({ ok: false, error: "invalid token" });
        pruneEventSessions();
        const sessionToken = randomBytes(24).toString("hex");
        eventSessions.set(sessionToken, Date.now() + EVENT_SESSION_TTL_MS);
        res.setHeader("Set-Cookie", `${EVENT_SESSION_COOKIE}=${sessionToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(EVENT_SESSION_TTL_MS / 1000)}`);
        res.json({ ok: true });
    });
    app.use((req, res, next) => {
        if (validToken(req, requestUrl(req, config), config.token)) return next();
        res.status(401).json({ ok: false, error: "invalid token" });
    });
    app.get("/events", (req, res) => session.openEvents(requestUrl(req, config), res));
    app.post("/canvas/state", (req, res) => {
        session.updateState(req.body, String(req.query.clientId || "") || undefined);
        res.json({ ok: true });
    });
    app.post("/canvas/result", (req, res) => {
        session.resolveResult(req.body);
        res.json({ ok: true });
    });
    app.post("/api/tools", route(async (req, res) => res.json({ ok: true, result: await session.callTool(req.body?.name, req.body?.input || {}) })));
    app.get("/agent/codex/workspace", (req, res) => {
        const workspace = ensureCanvasWorkspace(config, String(req.query.canvasId || ""));
        res.json({ ok: true, workspace });
    });
    app.get("/agent/codex/threads", route(async (req, res) => {
        const workspace = ensureCanvasWorkspace(config, String(req.query.canvasId || ""));
        const result = await listCodexThreads(emit, { cwd: workspace.workspacePath, searchTerm: String(req.query.searchTerm || "") });
        res.json({ ok: true, workspace, ...result });
    }));
    app.post("/agent/codex/threads/new", route(async (req, res) => {
        const workspace = ensureCanvasWorkspace(config, String(req.body?.canvasId || ""));
        const thread = await startCodexThread(emit, workspace.workspacePath);
        const activeThreadId = String((thread as Record<string, unknown>).id || "");
        updateCanvasWorkspace(config, workspace.canvasId, { activeThreadId });
        res.json({ ok: true, workspace: { ...workspace, activeThreadId }, thread: summarizeCodexThread(thread), messages: [] });
    }));
    app.get("/agent/codex/threads/:threadId", route(async (req, res) => {
        const workspace = ensureCanvasWorkspace(config, String(req.query.canvasId || ""));
        const threadId = routeParam(req.params.threadId);
        res.json({ ok: true, workspace, ...(await readCodexThread(emit, threadId, workspace.workspacePath)) });
    }));
    app.post("/agent/codex/threads/:threadId/resume", route(async (req, res) => {
        const workspace = ensureCanvasWorkspace(config, String(req.body?.canvasId || ""));
        const threadId = routeParam(req.params.threadId);
        const result = await resumeCodexThread(emit, threadId, workspace.workspacePath);
        updateCanvasWorkspace(config, workspace.canvasId, { activeThreadId: threadId });
        res.json({ ok: true, workspace: { ...workspace, activeThreadId: threadId }, ...result });
    }));
    app.post("/agent/codex/threads/:threadId/delete", route(async (req, res) => {
        const workspace = ensureCanvasWorkspace(config, String(req.body?.canvasId || ""));
        const threadId = routeParam(req.params.threadId);
        await archiveCodexThread(emit, threadId, workspace.workspacePath);
        if (workspace.activeThreadId === threadId) updateCanvasWorkspace(config, workspace.canvasId, { activeThreadId: undefined });
        res.json({ ok: true });
    }));
    app.post("/agent/codex/turn", route(async (req, res) => {
        const attachments = Array.isArray(req.body?.attachments) ? (req.body.attachments as AgentAttachment[]) : [];
        const workspace = ensureCanvasWorkspace(config, String(req.body?.canvasId || ""));
        let threadId = String(req.body?.threadId || workspace.activeThreadId || "");
        if (!threadId) {
            const thread = await startCodexThread(emit, workspace.workspacePath);
            threadId = String((thread as Record<string, unknown>).id || "");
            updateCanvasWorkspace(config, workspace.canvasId, { activeThreadId: threadId });
        } else if (threadId !== workspace.activeThreadId) {
            await verifyCodexThreadWorkspace(emit, threadId, workspace.workspacePath);
            updateCanvasWorkspace(config, workspace.canvasId, { activeThreadId: threadId });
        }
        void runCodexTurn(withAgentPrompt(String(req.body?.prompt || "")), emit, attachments, {
            threadId,
            cwd: workspace.workspacePath,
            onThreadId: (nextThreadId) => updateCanvasWorkspace(config, workspace.canvasId, { activeThreadId: nextThreadId }),
        });
        res.json({ ok: true, threadId });
    }));
    app.post("/agent/claude/turn", (req, res) => {
        runClaudeTurn(withAgentPrompt(String(req.body?.prompt || "")), emit);
        res.json({ ok: true });
    });
    app.use((_req, res) => res.status(404).json({ ok: false, error: "not found" }));
    app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => res.status(500).json({ ok: false, error: error.message }));

    app.listen(port, "127.0.0.1", () => {
        console.log("影策 Canvas Agent");
        console.log(`Local URL: ${config.url}`);
        console.log(`Connect token: ${config.token}`);
        console.log("Codex MCP: codex mcp add infinite-canvas -- npx -y @ddcat666/open-ai-canvas-agent mcp");
    });
}

function route(handler: (req: Request, res: Response) => Promise<unknown>) {
    return (req: Request, res: Response, next: NextFunction) => void handler(req, res).catch(next);
}

function routeParam(value: string | string[]) {
    return Array.isArray(value) ? value[0] || "" : value;
}

function requestUrl(req: Request, config: CanvasAgentConfig) {
    return new URL(req.originalUrl || req.url || "/", config.url);
}

function setCors(req: Request, res: Response, url: URL, config: CanvasAgentConfig) {
    const origin = req.headers.origin;
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    if (origin) res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "content-type,x-canvas-agent-token");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Private-Network", "true");
    if (!origin || req.method === "OPTIONS" || url.pathname === "/health" || url.pathname === "/config") return true;
    config.origins ||= [];
    if (validToken(req, url, config.token) && !config.origins.includes(origin)) {
        config.origins.push(origin);
        saveConfig(config);
    }
    res.setHeader("Vary", "Origin");
    return config.origins.includes(origin);
}

function validToken(req: Request, _url: URL, token: string) {
    const header = req.headers["x-canvas-agent-token"];
    const headerMatches = header === token || (Array.isArray(header) && header.includes(token));
    return headerMatches || validEventSession(sessionTokenFromCookie(req));
}

function sessionTokenFromCookie(req: Request) {
    const cookie = req.headers.cookie || "";
    for (const part of cookie.split(";")) {
        const [name, ...rest] = part.trim().split("=");
        if (name === EVENT_SESSION_COOKIE) return rest.join("=") || "";
    }
    return "";
}

function validEventSession(value: string) {
    if (!value) return false;
    const expiresAt = eventSessions.get(value);
    if (!expiresAt) return false;
    if (Date.now() > expiresAt) {
        eventSessions.delete(value);
        return false;
    }
    eventSessions.set(value, Date.now() + EVENT_SESSION_TTL_MS);
    return true;
}

function pruneEventSessions() {
    if (eventSessions.size < 100) return;
    const now = Date.now();
    for (const [key, expiresAt] of eventSessions) {
        if (expiresAt <= now) eventSessions.delete(key);
    }
}
