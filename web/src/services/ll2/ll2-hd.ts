/**
 * auto-hd 超分后处理客户端。
 *
 * 协议（官方《超分 API 说明》）：
 *   POST /hd/tasks        { model:"auto-hd", video_url, resolution, duration? }
 *   GET  /hd/tasks/{id}   → { id, status, url(相对路径，需同一个 Bearer Key 下载) }
 *
 * 硬约束：video_url 必须是公网可下载地址（本机文件传不上去）；
 * 所以超分只能接在「生成成功拿到公网直链」之后跑，不能和生成是同一次请求。
 * 失败状态没有原因字段，文案只能说实话（以控制台账单为准）。
 */

import { LL2_GATEWAY_ORIGIN } from "@/services/ll2/ll2-video";
import { ll2UpscaleTargetLabel, type LL2UpscaleTarget } from "@/lib/ll2-upscale";

export type LL2HdProgress = {
    stage: "created" | "polling" | "downloading";
    status: string;
    elapsedMs: number;
    pollCount: number;
    taskId: string;
};

export type LL2HdRequest = {
    apiKey: string;
    videoUrl: string;
    resolution: LL2UpscaleTarget;
    /** 预扣秒数：不传时网关按 60 秒预扣，成功后按成片实际秒数结算。 */
    duration?: number;
    baseUrl?: string;
    signal?: AbortSignal;
    pollIntervalMs?: number;
    maxPolls?: number;
};

export type LL2HdResult = {
    taskId: string;
    resolution: LL2UpscaleTarget;
    /** 拼好网关 origin 的绝对地址；下载仍需 Bearer Key。 */
    url: string;
    finishedAt: number;
};

const DONE = new Set(["finished", "succeeded", "success", "completed"]);
const FAILED = new Set(["failed", "error", "cancelled", "canceled"]);

function originOf(baseUrl?: string) {
    return String(baseUrl || LL2_GATEWAY_ORIGIN).replace(/\/+$/, "");
}

function hdErrorMessage(status: number, payload: Record<string, any>) {
    const message = String(payload?.message || payload?.msg || "").trim();
    if (status === 400) return message ? `超分参数不被接受：${message}` : "超分参数不被接受，请换一档清晰度再试";
    if (status === 401) return "LL2 Key 无效或已过期，请在「连接 LL2」里重新填入";
    if (status === 403) return "这个 Key 没有调用超分的权限，请到 LL2 控制台确认";
    if (status === 404) return "超分任务不存在或已被清理";
    if (status === 429) return "LL2 账户触发限流，请稍后再试";
    if (status >= 500) return `LL2 超分服务暂时不可用（HTTP ${status}），请稍后重试`;
    return `超分请求失败（HTTP ${status}）${message ? `：${message}` : ""}`;
}

async function hdFetch(url: string, init: RequestInit, signal?: AbortSignal) {
    let response: Response;
    try {
        response = await fetch(url, { ...init, signal, credentials: "omit" });
    } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
        throw new Error("连不上 LL2 网关，请检查网络或稍后重试");
    }
    let payload: Record<string, any> = {};
    try {
        payload = (await response.json()) as Record<string, any>;
    } catch {
        payload = {};
    }
    if (!response.ok) throw new Error(hdErrorMessage(response.status, payload));
    return payload;
}

function sleep(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
    });
}

export async function ll2CreateHdTask(req: LL2HdRequest) {
    const payload = await hdFetch(
        `${originOf(req.baseUrl)}/hd/tasks`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${req.apiKey.trim()}` },
            body: JSON.stringify({
                model: "auto-hd",
                video_url: String(req.videoUrl || "").trim(),
                resolution: req.resolution,
                ...(req.duration ? { duration: Math.max(1, Math.round(req.duration)) } : {}),
            }),
        },
        req.signal,
    );
    const taskId = String(payload?.id || payload?.task_id || "").trim();
    if (!taskId) throw new Error("超分请求已受理，但没有返回任务号，请稍后重试");
    return { taskId };
}

export async function ll2QueryHdTask(taskId: string, req: LL2HdRequest) {
    const payload = await hdFetch(
        `${originOf(req.baseUrl)}/hd/tasks/${encodeURIComponent(taskId)}`,
        { method: "GET", headers: { Authorization: `Bearer ${req.apiKey.trim()}` } },
        req.signal,
    );
    const status = String(payload?.status || "").toUpperCase();
    const url = String(payload?.url || "").trim();
    return { status, url: url ? (url.startsWith("http") ? url : `${originOf(req.baseUrl)}${url.startsWith("/") ? "" : "/"}${url}`) : "" };
}

/** 创建 → 轮询 → 拿到成片地址。超分可能几分钟，轮询上限给到 30 分钟。 */
export async function ll2RunHd(req: LL2HdRequest, onProgress?: (progress: LL2HdProgress) => void): Promise<LL2HdResult> {
    const key = String(req.apiKey || "").trim();
    if (!key) throw new Error("还没填 LL2 Key，填一次就能用，不用注册账号");
    if (!/^https:\/\//i.test(String(req.videoUrl || ""))) throw new Error("超分需要一条公网 HTTPS 视频地址；本机文件传不上去");

    const startedAt = Date.now();
    const { taskId } = await ll2CreateHdTask(req);
    onProgress?.({ stage: "created", status: "queued", elapsedMs: Date.now() - startedAt, pollCount: 0, taskId });
    return ll2WaitHdTask(taskId, req, onProgress);
}

/**
 * 刷新恢复：不创建新的超分任务，只按已有 hdTaskId 继续轮询。
 * 超分阶段刷新时用它接上，避免重复提交、重复扣费。
 */
export async function ll2WaitHdTask(taskId: string, req: LL2HdRequest, onProgress?: (progress: LL2HdProgress) => void): Promise<LL2HdResult> {
    const key = String(req.apiKey || "").trim();
    if (!key) throw new Error("还没填 LL2 Key，填一次就能用，不用注册账号");
    const id = String(taskId || "").trim();
    if (!id) throw new Error("缺少超分任务号，无法恢复");

    const startedAt = Date.now();
    const interval = Math.max(1000, req.pollIntervalMs ?? 5000);
    const maxPolls = Math.max(1, req.maxPolls ?? 360);
    for (let attempt = 1; attempt <= maxPolls; attempt += 1) {
        await sleep(interval, req.signal);
        const queried = await ll2QueryHdTask(id, req);
        const status = queried.status.toLowerCase();
        onProgress?.({ stage: "polling", status, elapsedMs: Date.now() - startedAt, pollCount: attempt, taskId: id });
        if (FAILED.has(status)) throw new Error(`超分没成功（${ll2UpscaleTargetLabel(req.resolution)}），再试一次就行`);
        if (DONE.has(status)) {
            if (!queried.url) throw new Error("超分完成了，但 LL2 没有返回成片地址");
            return { taskId: id, resolution: req.resolution, url: queried.url, finishedAt: Date.now() };
        }
    }
    throw new Error("超分超时了，请到 LL2 控制台查看任务状态，或稍后重试");
}

/** 成片地址要带同一个 Bearer Key 下载；<video src> 直连是不行的。 */
export async function ll2FetchHdBlob(url: string, apiKey: string, signal?: AbortSignal) {
    const response = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${String(apiKey || "").trim()}` }, signal, credentials: "omit" });
    if (!response.ok) throw new Error(`下载超分成片失败（HTTP ${response.status}）`);
    return response.blob();
}
