import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { RuntimeBrowserRegistration } from "./local-runtime-session.js";

export const LOCAL_RUNTIME_DEFAULT_PORT = 17371;
/** @deprecated Use LOCAL_RUNTIME_DEFAULT_PORT. */
export const DEFAULT_PORT = LOCAL_RUNTIME_DEFAULT_PORT;
export const CONFIG_DIR = startupConfigDirectory();
export const CONFIG_FILE = path.join(CONFIG_DIR, "canvas-agent.json");
export const VERSION = readPackageVersion();
export const AGENT_PROMPT = "你正在帮助用户操作影策网页画布。需要改动画布时优先使用已配置的 yingce MCP 工具：先 canvas_get_state 读取当前画布，再根据任务使用 canvas_create_text_node、canvas_generate_text、canvas_generate_image、canvas_generate_video、canvas_generate_audio、canvas_create_generation_flow、canvas_run_generation、canvas_update_node、canvas_connect_nodes 等通用工具；复杂批量改动再用 canvas_apply_ops，删除连线可用 delete_connections。需要生成内容时直接调用对应生成工具，不要绑定特定业务场景。即使用户明确点名 Dreamina/即梦，本机 Canvas Agent 也必须通过 canvas_generate_image 或 canvas_generate_video 进入共享 GenerationTask；本机图片模型使用 model=local:dreamina-cli:5.0 这类产品模型值，用户选择自动分辨率时使用 quality=auto；禁止调用 direct dreamina_cli provider tool。不要模拟鼠标点击，不要要求用户手动复制 JSON。";

export type CanvasWorkspaceConfig = { workspacePath: string; activeThreadId?: string; pinnedThreadIds?: string[] };
export type LocalRuntimeConfig = {
    url: string;
    token: string;
    ownerId?: string;
    origins?: string[];
    trustedWebOrigins: string[];
    browserRegistrations: RuntimeBrowserRegistration[];
    legacyBootstrap?: boolean;
    canvases?: Record<string, CanvasWorkspaceConfig>;
};
/** @deprecated Use LocalRuntimeConfig. */
export type CanvasAgentConfig = LocalRuntimeConfig;

export function loadConfig(create = false): LocalRuntimeConfig {
    try {
        const config = normalizeLocalRuntimeConfig(JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")));
        if (create) saveConfig(config);
        return config;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const config = normalizeLocalRuntimeConfig({
            url: `http://127.0.0.1:${Number(process.env.PORT) || DEFAULT_PORT}`,
            token: crypto.randomBytes(18).toString("hex"),
            trustedWebOrigins: configuredTrustedOrigins(),
            browserRegistrations: [],
        });
        if (create) saveConfig(config);
        return config;
    }
}

export function normalizeLocalRuntimeConfig(value: unknown): LocalRuntimeConfig {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Local Runtime config is invalid");
    }
    const input = value as Partial<LocalRuntimeConfig>;
    if (typeof input.url !== "string" || !isLoopbackRuntimeUrl(input.url)) {
        throw new Error("Local Runtime URL must use 127.0.0.1");
    }
    if (typeof input.token !== "string" || !input.token) {
        throw new Error("Local Runtime master token is invalid");
    }
    const trustedWebOrigins = process.env.FRAMEFIELD_TRUSTED_WEB_ORIGINS === undefined
        ? input.trustedWebOrigins ?? configuredTrustedOrigins()
        : configuredTrustedOrigins();
    if (!Array.isArray(trustedWebOrigins)) throw new Error("Trusted Web origins are invalid");
    const normalizedOrigins = trustedWebOrigins.map(exactWebOrigin);
    if (new Set(normalizedOrigins).size !== normalizedOrigins.length) {
        throw new Error("Trusted Web origins must be unique");
    }
    if (input.browserRegistrations !== undefined && !Array.isArray(input.browserRegistrations)) {
        throw new Error("Browser registrations are invalid");
    }
    const config: LocalRuntimeConfig = {
        url: new URL(input.url).origin,
        token: input.token,
        trustedWebOrigins: normalizedOrigins,
        browserRegistrations: [...(input.browserRegistrations ?? [])],
        ...(Array.isArray(input.origins) ? { origins: [...input.origins] } : {}),
        ...(input.legacyBootstrap === true ? { legacyBootstrap: true } : {}),
        ...(input.canvases && typeof input.canvases === "object" ? { canvases: input.canvases } : {}),
        ...(typeof input.ownerId === "string" ? { ownerId: input.ownerId } : {}),
    };
    ensureRuntimeOwnerId(config);
    return config;
}

// Runtime ownership stays in Runtime state and never selects a CLI account/home.
export function ensureRuntimeOwnerId(config: LocalRuntimeConfig) {
    if (!config.ownerId || !/^[A-Za-z0-9_-]{24}$/.test(config.ownerId)) {
        config.ownerId = crypto.randomBytes(18).toString("base64url");
    }
    return config.ownerId;
}

/** @deprecated Use ensureRuntimeOwnerId. */
export const ensureOwnerId = ensureRuntimeOwnerId;

export function saveConfig(config: LocalRuntimeConfig) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function ensureCanvasWorkspace(config: LocalRuntimeConfig, canvasId: string) {
    const id = safeSegment(canvasId || "default");
    config.canvases ||= {};
    const current = config.canvases[id];
    if (current?.workspacePath) {
        fs.mkdirSync(resolveWorkspacePath(current.workspacePath), { recursive: true });
        return { canvasId: id, ...current, workspacePath: resolveWorkspacePath(current.workspacePath) };
    }
    const workspacePath = path.join(CONFIG_DIR, "codex-workspaces", id);
    config.canvases[id] = { workspacePath };
    fs.mkdirSync(workspacePath, { recursive: true });
    saveConfig(config);
    return { canvasId: id, workspacePath };
}

export function updateCanvasWorkspace(config: LocalRuntimeConfig, canvasId: string, patch: Partial<CanvasWorkspaceConfig>) {
    const current = ensureCanvasWorkspace(config, canvasId);
    const workspacePath = patch.workspacePath ? resolveWorkspacePath(patch.workspacePath) : current.workspacePath;
    const next = { ...current, ...patch, workspacePath };
    config.canvases ||= {};
    config.canvases[current.canvasId] = { workspacePath: next.workspacePath, activeThreadId: next.activeThreadId, pinnedThreadIds: next.pinnedThreadIds };
    fs.mkdirSync(workspacePath, { recursive: true });
    saveConfig(config);
    return { canvasId: current.canvasId, ...config.canvases[current.canvasId] };
}

function resolveWorkspacePath(value: string) {
    if (value === "~") return os.homedir();
    if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
    return path.resolve(value);
}

function safeSegment(value: string) {
    return value.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120) || "default";
}

function isLoopbackRuntimeUrl(value: string) {
    try {
        const url = new URL(value);
        return url.protocol === "http:"
            && url.hostname === "127.0.0.1"
            && Boolean(url.port)
            && url.pathname === "/"
            && !url.username
            && !url.password
            && !url.search
            && !url.hash;
    } catch {
        return false;
    }
}

function exactWebOrigin(value: unknown) {
    if (typeof value !== "string" || value.includes(",") || value === "null") {
        throw new Error("Trusted Web origin is invalid");
    }
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)
        || url.username
        || url.password
        || url.pathname !== "/"
        || url.search
        || url.hash
        || url.origin !== value) {
        throw new Error("Trusted Web origin is invalid");
    }
    return url.origin;
}

function configuredTrustedOrigins() {
    const configured = process.env.FRAMEFIELD_TRUSTED_WEB_ORIGINS;
    if (!configured) return ["http://127.0.0.1:3000", "http://localhost:3000"];
    return configured.split(",").map((value) => value.trim());
}

function startupConfigDirectory() {
    const configured = process.env.FRAMEFIELD_LOCAL_RUNTIME_CONFIG_DIR;
    if (configured === undefined) return path.join(os.homedir(), ".infinite-canvas");
    if (!configured
        || configured !== configured.trim()
        || configured.length > 2_048
        || !path.isAbsolute(configured)) {
        throw new Error("Local Runtime config directory override must be absolute");
    }
    const resolved = path.resolve(configured);
    if (resolved === path.parse(resolved).root) {
        throw new Error("Local Runtime config directory override cannot be a filesystem root");
    }
    return resolved;
}

function readPackageVersion() {
    try {
        const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
        return pkg.version || "0.0.0";
    } catch {
        return "0.0.0";
    }
}
