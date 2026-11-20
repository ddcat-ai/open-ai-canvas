/**
 * 无限画布里「文本助手 → Agent 出片」的衔接层。
 *
 * 2026-11-18 用户口径：文本助手负责想清楚、写清楚（用我们自己的文本模型），
 * Agent 负责生成视频，两者在同一张画布里衔接。
 *
 * 这一层只做三件事：
 *   1. 把助手聊出来的内容收成一段能直接提交的画面提示词；
 *   2. 在提交前把这次要花多少钱算清楚（不先扣费、不静默提交）；
 *   3. 调我们自己的视频链路，并把片子登记进本机作品库。
 * 节点写回交给画布编辑器发布的回调，避免和编辑器本地的 nodes 状态打架。
 *
 * 不接第三方平台，不引外部画布，Key 只从调用方传入。
 */

import { nanoid } from "nanoid";
import { ll2PreciseCNY } from "@/lib/ll2-models";
import { ll2ReadSettings, type LL2WorkspaceSettings } from "@/lib/ll2-workspace";
import { ll2AddFilm, type LL2Film } from "./ll2-films";
import { ll2GenerateVideo, type LL2VideoProgress, type LL2VideoResult } from "./ll2-video";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export type LL2CanvasAgentRequest = {
    apiKey: string;
    prompt: string;
    signal: AbortSignal;
    onProgress?: (progress: LL2VideoProgress) => void;
    settings?: LL2WorkspaceSettings;
    /** 以下三项只给本机 mock 自检用，生产不传，默认走 LL2 官方网关与正常轮询节奏。 */
    baseUrl?: string;
    pollIntervalMs?: number;
    maxPolls?: number;
};

export { ll2CleanVideoPrompt } from "@/lib/ll2-video-prompt";

/** 提交前给 C 端看的一行白话价格：几秒、什么清晰度、一共多少钱。 */
export function ll2CanvasAgentEstimate(settings: LL2WorkspaceSettings = ll2ReadSettings()) {
    const price = ll2PreciseCNY(settings.videoModel, settings.seconds, settings.resolution);
    return {
        settings,
        label: price.label,
        basis: price.basis,
        description: `${settings.seconds} 秒 · ${settings.resolution} · ${settings.videoModel}`,
    };
}

/**
 * 兜底节点：画布还没发布上下文时，提示词和片子仍要落在同一张画布里、挨着摆。
 * 正常路径走画布编辑器发布的 insertAgentText / insertAgentVideo 回调。
 */
export function ll2BuildCanvasNodes(prompt: string, film: LL2Film, rightmost = 80): CanvasNodeData[] {
    const now = new Date().toISOString();
    return [
        {
            id: `text-${nanoid()}`,
            type: CanvasNodeType.Text,
            title: "交给 Agent 的提示词",
            createdAt: now,
            updatedAt: now,
            position: { x: rightmost + 80, y: 80 },
            width: 360,
            height: 220,
            metadata: { content: prompt, textFormat: "plain", prompt, status: "success" },
        },
        {
            id: `video-${nanoid()}`,
            type: CanvasNodeType.Video,
            title: "Agent 生成的片子",
            createdAt: now,
            updatedAt: now,
            position: { x: rightmost + 480, y: 80 },
            width: 360,
            height: 220,
            metadata: {
                content: film.url,
                status: "success",
                mimeType: "video/mp4",
                prompt,
                model: film.model,
                seconds: String(film.seconds),
                taskId: film.taskId,
            },
        },
    ];
}

/** Agent 出片：创建 → 轮询 → 精确计费 → 登记本机作品库。 */
export async function ll2RunCanvasAgent(req: LL2CanvasAgentRequest): Promise<{ outcome: LL2VideoResult; film: LL2Film }> {
    const settings = req.settings || ll2ReadSettings();
    const outcome = await ll2GenerateVideo(
        {
            apiKey: req.apiKey,
            model: settings.videoModel,
            prompt: req.prompt,
            seconds: settings.seconds,
            resolution: settings.resolution,
            ratio: settings.ratio,
            signal: req.signal,
            ...(req.baseUrl ? { baseUrl: req.baseUrl } : {}),
            ...(typeof req.pollIntervalMs === "number" ? { pollIntervalMs: req.pollIntervalMs } : {}),
            ...(typeof req.maxPolls === "number" ? { maxPolls: req.maxPolls } : {}),
        },
        req.onProgress,
    );
    const film: LL2Film = {
        id: outcome.taskId,
        taskId: outcome.taskId,
        model: outcome.model,
        prompt: outcome.prompt,
        seconds: outcome.seconds,
        chargedSeconds: outcome.chargedSeconds,
        resolution: outcome.resolution,
        ratio: outcome.ratio,
        estimateCNY: outcome.estimateCNY,
        actualCNY: outcome.actualCNY,
        url: outcome.url,
        createdAt: outcome.createdAt,
    };
    ll2AddFilm(film);
    return { outcome, film };
}