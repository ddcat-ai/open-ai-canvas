import path from "node:path";

import type { Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";

import { CONFIG_DIR } from "../config.js";
import type { LocalRuntimeModule } from "../local-runtime.js";
import { createPortraitClearanceTaskRequestSchema, PORTRAIT_ERROR_MESSAGES } from "../portrait-clearance/contracts.js";
import { PortraitFaceEngine } from "../portrait-clearance/face-engine.js";
import { detectPortraitBrowser } from "../portrait-clearance/baidu-search.js";
import { installPortraitModels, portraitModelStatus } from "../portrait-clearance/model-store.js";
import { PortraitTaskRunner } from "../portrait-clearance/task-runner.js";
import { PortraitTaskStore, PortraitTaskStoreError } from "../portrait-clearance/task-store.js";

export type PortraitClearanceHttpModuleOptions = {
    ownerId: string;
    configDir?: string;
    fetch?: typeof fetch;
};

export function createPortraitClearanceHttpModule(options: PortraitClearanceHttpModuleOptions = { ownerId: "runtime-owner", configDir: CONFIG_DIR }): LocalRuntimeModule {
    const configDir = options.configDir ?? CONFIG_DIR;
    const moduleRoot = path.join(configDir, "portrait-clearance");
    const store = new PortraitTaskStore(moduleRoot, options.ownerId);
    const faceEngine = new PortraitFaceEngine({ modelRoot: moduleRoot });
    const runner = new PortraitTaskRunner(store, faceEngine);

    const withOwner = (response: Response) => {
        const session = response.locals.runtimeSession as { keyId?: unknown; origin?: unknown } | undefined;
        if (typeof session?.keyId !== "string" || typeof session.origin !== "string") throw new Error("portrait_runtime_session_missing");
        return { keyId: session.keyId, origin: session.origin };
    };
    const status = async (owner: { keyId: string; origin: string }) => {
        const models = await portraitModelStatus(moduleRoot);
        const { root: _root, ...publicModels } = models;
        const browser = await detectPortraitBrowser();
        return { models: publicModels, browser: { available: browser.available, ...(browser.browserName ? { browserName: browser.browserName } : {}), ...(browser.available ? {} : { reason: "未找到系统 Chrome、Edge 或 Chromium" }) }, tasks: await store.counts(owner) };
    };

    const module: LocalRuntimeModule = {
        descriptor: {
            id: "portrait-clearance",
            displayName: "肖像可识别性本机引擎",
            apiVersion: 1,
            scopes: ["portrait:status", "portrait:model", "portrait:run", "portrait:read"],
        },
        routes: [
            {
                method: "GET",
                path: "/portrait-clearance/status",
                scope: "portrait:status",
                handler: asyncRoute(async (_request, response) => {
                    const current = await status(withOwner(response));
                    response.json({ ok: true, module: "portrait-clearance", apiVersion: 1, ready: current.models.ready, ...current });
                }),
            },
            {
                method: "POST",
                path: "/portrait-clearance/model/install",
                scope: "portrait:model",
                handler: asyncRoute(async (_request, response) => {
                    assertEmptyBody(_request);
                    const result = await installPortraitModels(moduleRoot, { fetch: options.fetch });
                    response.json({ ok: true, result: { ...result, root: undefined } });
                }),
            },
            {
                method: "POST",
                path: "/portrait-clearance/tasks",
                scope: "portrait:run",
                handler: asyncRoute(async (request, response) => {
                    const body = parseBody(request);
                    const parsed = createPortraitClearanceTaskRequestSchema.safeParse(body);
                    if (!parsed.success) return sendError(response, "portrait_input_invalid", 400);
                    const owner = withOwner(response);
                    const created = await store.create(parsed.data, owner);
                    runner.start(created.record);
                    response.status(created.created ? 201 : 200).json({ ok: true, task: publicTask(created.record) });
                }),
            },
            {
                method: "GET",
                path: "/portrait-clearance/tasks",
                scope: "portrait:read",
                queryKeys: ["projectId", "nodeId", "ownerScopeHash", "limit", "cursor"],
                handler: asyncRoute(async (request, response) => {
                    const owner = withOwner(response);
                    const query = request.query as Record<string, unknown>;
                    const limit = parseLimit(query.limit);
                    const result = await store.list({ limit, ...optionalQuery(query, "projectId"), ...optionalQuery(query, "nodeId"), ...optionalQuery(query, "ownerScopeHash"), ...optionalQuery(query, "cursor") }, owner);
                    for (const task of result.tasks) if (task.status === "queued" || task.status === "running") {
                        const record = await store.get(task.taskId, owner);
                        runner.start(record);
                    }
                    response.json({ ok: true, ...result });
                }),
            },
            {
                method: "GET",
                path: "/portrait-clearance/tasks/:taskId",
                scope: "portrait:read",
                handler: asyncRoute(async (request, response) => {
                    const task = await store.get(requiredParam(request, "taskId"), withOwner(response));
                    response.json({ ok: true, task: publicTask(task) });
                }),
            },
            {
                method: "GET",
                path: "/portrait-clearance/tasks/:taskId/events",
                scope: "portrait:read",
                lastEventId: true,
                handler: asyncRoute(async (request, response) => {
                    const owner = withOwner(response);
                    const taskId = requiredParam(request, "taskId");
                    response.status(200).setHeader("content-type", "text/event-stream").setHeader("cache-control", "no-store").setHeader("connection", "keep-alive");
                    let cursor = request.headers["last-event-id"] as string | undefined;
                    let closed = false;
                    request.on("close", () => { closed = true; });
                    const deadline = Date.now() + 60_000;
                    while (!closed && Date.now() < deadline) {
                        const events = await store.events(taskId, owner, cursor);
                        for (const event of events) {
                            response.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
                            cursor = event.id;
                        }
                        const current = await store.get(taskId, owner);
                        if (current.status === "completed" || current.status === "partial" || current.status === "failed" || current.status === "cancelled") break;
                        await delay(500);
                    }
                    if (!closed) response.end();
                }),
            },
            {
                method: "POST",
                path: "/portrait-clearance/tasks/:taskId/cancel",
                scope: "portrait:run",
                handler: asyncRoute(async (request, response) => {
                    assertEmptyBody(request);
                    const task = await store.requestCancel(requiredParam(request, "taskId"), withOwner(response));
                    response.json({ ok: true, task: publicTask(task) });
                }),
            },
            {
                method: "POST",
                path: "/portrait-clearance/tasks/:taskId/retry",
                scope: "portrait:run",
                handler: asyncRoute(async (request, response) => {
                    assertEmptyBody(request);
                    const owner = withOwner(response);
                    const current = await store.get(requiredParam(request, "taskId"), owner);
                    if (current.status !== "failed" && current.status !== "cancelled") return sendError(response, "portrait_retry_not_allowed", 409);
                    const task = await store.prepareRetry(current.taskId, owner);
                    runner.start(task);
                    response.json({ ok: true, task: publicTask(task) });
                }),
            },
            {
                method: "POST",
                path: "/portrait-clearance/tasks/:taskId/delete",
                scope: "portrait:run",
                handler: asyncRoute(async (request, response) => {
                    assertEmptyBody(request);
                    const result = await store.delete(requiredParam(request, "taskId"), withOwner(response));
                    response.json({ ok: true, result });
                }),
            },
            {
                method: "POST",
                path: "/portrait-clearance/tasks/:taskId/model-jobs/claim",
                scope: "portrait:run",
                handler: asyncRoute(async (request, response) => {
                    assertEmptyBody(request);
                    const taskId = requiredParam(request, "taskId");
                    const owner = withOwner(response);
                    const task = await store.get(taskId, owner);
                    if (task.status !== "waiting_model") {
                        response.json({ ok: true, job: null });
                        return;
                    }
                    await store.ensureModelJobs(taskId, owner);
                    const job = await store.claimModelJob(taskId, owner);
                    response.json({ ok: true, job: job ? publicJob(job) : null });
                }),
            },
            {
                method: "POST",
                path: "/portrait-clearance/tasks/:taskId/model-jobs/:jobId/complete",
                scope: "portrait:run",
                handler: asyncRoute(async (request, response) => {
                    const result = await store.completeModelJob(requiredParam(request, "taskId"), withOwner(response), requiredParam(request, "jobId"), parseBody(request));
                    response.json({ ok: true, task: publicTask(result.record), job: publicJob(result.job) });
                }),
            },
            {
                method: "POST",
                path: "/portrait-clearance/tasks/:taskId/model-jobs/:jobId/fail",
                scope: "portrait:run",
                handler: asyncRoute(async (request, response) => {
                    const result = await store.failModelJob(requiredParam(request, "taskId"), withOwner(response), requiredParam(request, "jobId"), parseBody(request));
                    response.json({ ok: true, task: publicTask(result.record), job: publicJob(result.job) });
                }),
            },
            {
                method: "GET",
                path: "/portrait-clearance/tasks/:taskId/images/:imageId",
                scope: "portrait:read",
                handler: asyncRoute(async (request, response) => {
                    const taskId = requiredParam(request, "taskId");
                    const imageId = requiredParam(request, "imageId");
                    const file = await store.readImageArtifact(taskId, withOwner(response), imageId);
                    response.type(file.mimeType).send(file.bytes);
                }),
            },
            {
                method: "GET",
                path: "/portrait-clearance/tasks/:taskId/artifacts/:artifactId",
                scope: "portrait:read",
                handler: asyncRoute(async (request, response) => {
                    const task = await store.get(requiredParam(request, "taskId"), withOwner(response));
                    const artifactId = requiredParam(request, "artifactId");
                    if (artifactId === "clearance-result.json") {
                        if (!task.resultRelativePath) return sendError(response, "portrait_artifact_not_found", 404);
                        const result = await store.readResult(task.taskId, withOwner(response));
                        if (!result) return sendError(response, "portrait_artifact_not_found", 404);
                        response.type("application/json").send(JSON.stringify(result));
                        return;
                    }
                    if (!["clearance-report.md", "clearance-report.html", "clearance-report.docx"].includes(artifactId)) return sendError(response, "portrait_artifact_not_found", 404);
                    const report = await store.readReport(task.taskId, withOwner(response), artifactId);
                    response.type(report.mimeType).send(report.bytes);
                }),
            },
        ],
        start: async () => {
            for (const record of await store.recoverableRecords()) runner.start(record);
        },
        publicHealth: () => ({ portraitClearance: "available" }),
    };
    return module;
}

function asyncRoute(action: (request: Request, response: Response) => Promise<void>): RequestHandler {
    return (request, response, next) => {
        void action(request, response).catch((error) => {
            if (response.headersSent) return next(error);
            if (error instanceof PortraitTaskStoreError) return sendError(response, error.code, error.status);
            if (error instanceof ZodError) return sendError(response, "portrait_input_invalid", 400);
            return sendError(response, "portrait_runtime_unavailable", 503);
        });
    };
}

function parseBody(request: Request) {
    if (!Buffer.isBuffer(request.body) || request.body.length === 0) return {};
    try {
        const value = JSON.parse(request.body.toString("utf8")) as unknown;
        return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch {
        return {};
    }
}

function assertEmptyBody(request: Request) {
    const body = parseBody(request);
    if (Object.keys(body).length) throw new PortraitTaskStoreError("portrait_input_invalid", "请求字段无效", 400);
}

function requiredParam(request: Request, name: string) {
    const value = request.params[name];
    if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,160}$/.test(value)) throw new PortraitTaskStoreError("portrait_task_not_found", "任务不存在", 404);
    return value;
}

function parseLimit(value: unknown) {
    if (value === undefined) return 30;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 60) throw new PortraitTaskStoreError("portrait_input_invalid", "分页参数无效", 400);
    return parsed;
}

function optionalQuery(query: Record<string, unknown>, key: string) {
    const value = query[key];
    return typeof value === "string" && value ? { [key]: value } : {};
}

function publicTask(task: { taskId: string; projectId: string; nodeId: string; mode: string; analysisMode: string; modelRef?: string; status: string; stage: string; progress: number; processedCandidates: number; totalCandidates?: number; errorCode?: string; errorMessage?: string; createdAt: string; updatedAt: string; completedAt?: string; detailsAvailable: boolean }) {
    return {
        taskId: task.taskId,
        projectId: task.projectId,
        nodeId: task.nodeId,
        mode: task.mode,
        analysisMode: task.analysisMode,
        ...(task.modelRef ? { modelRef: task.modelRef } : {}),
        status: task.status,
        stage: task.stage,
        progress: task.progress,
        processedCandidates: task.processedCandidates,
        ...(task.totalCandidates === undefined ? {} : { totalCandidates: task.totalCandidates }),
        ...(task.errorCode ? { errorCode: task.errorCode } : {}),
        ...(task.errorMessage ? { errorMessage: task.errorMessage } : {}),
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        ...(task.completedAt ? { completedAt: task.completedAt } : {}),
        detailsAvailable: task.detailsAvailable,
    };
}

function publicJob(job: { jobId: string; taskId: string; pairId: string; queryImageId: string; comparisonImageId: string; status: string; attempt: number; leaseToken?: string; leaseExpiresAt?: string; errorCode?: string; errorMessage?: string }) {
    const { leaseToken, leaseExpiresAt, ...safe } = job;
    return { ...safe, ...(leaseToken ? { leaseToken } : {}), ...(leaseExpiresAt ? { leaseExpiresAt } : {}) };
}

function sendError(response: Response, code: string, status: number) {
    response.status(status).json({ ok: false, code, message: PORTRAIT_ERROR_MESSAGES[code] || "肖像排查本机任务失败" });
}

function delay(milliseconds: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
