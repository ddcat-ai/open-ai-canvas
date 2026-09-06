import { getProject, type ProjectDetail } from "./projects";
import { submitBackendGenerationTask } from "./generation-task";
import { useConfigStore, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

/* ------------------------------------------------------------------ *
 * D-055 第二阶段（H3 Production Vertical Slice）
 * project_generate_shot 的前端执行体：镜头 → H3 生成任务。
 *
 * 设计边界（D-054A / D-055 工单）：
 * - 提示词只来自镜头当前修订版的 videoPrompt（用户创作），Agent 不改写、
 *   不拼装 prompt——nxf 是编译器，硬规则不允许模型在调用侧重新组织提示词。
 * - 模型自动使用系统渠道里的 MiniMax H3（渠道直连 config，不带 logicalModelId，
 *   与 D-055 第一阶段实测可用的 payload 形态一致；FeatureFrontendModels 关闭时
 *   logicalModelId 路由会被拒）。
 * - 带 referenceImageUrls ⇒ operation 自动判 image_to_video（与后端
 *   model_capability 强制规则一致），渠道模型画像 operations 已含该模式。
 * - 任务带 metadata.shotId/unitId/artifactType，成功收口后由后端
 *   RegisterTaskOutputFromTask 自动落 ShotArtifact（G2 修复后的链回写兜底）。
 * ------------------------------------------------------------------ */

export type GenerateShotInput = {
    shotId: string;
    videoSeconds?: number;
    resolution?: string;
    referenceImageUrls?: string[];
};

export type GenerateShotResult = {
    taskId: string;
    shotId: string;
    unitId?: string;
    model: string;
    channelId: string;
    operation: string;
    videoSeconds: number;
    resolution: string;
    status: string;
    promptSource: "revision";
};

const DEFAULT_RESOLUTION = "768p横";
/** v5（非 15s 版）的时长上限是 10s；no_pic 与 v5_15s 都是 15s。 */
const H3_MODEL_SECOND_LIMITS: Array<{ match: RegExp; maxSeconds: number }> = [
    { match: /_v5_15s$/i, maxSeconds: 15 },
    { match: /_no_pic$/i, maxSeconds: 15 },
    { match: /_v5$/i, maxSeconds: 10 },
];
const H3_FALLBACK_MAX_SECONDS = 5;

/** 从配置 store 的渠道目录里发现 MiniMax H3 视频模型（系统渠道同步进来的 minimax_h3_*）。 */
export function discoverH3VideoModel(config: AiConfig, withReferences: boolean): { channelId: string; model: string } {
    const candidates = config.channels.flatMap((channel) =>
        channel.models
            .filter((model) => /^minimax_h3_/i.test(model))
            .map((model) => ({ channelId: channel.id, model })),
    );
    if (!candidates.length) {
        throw new Error("模型目录里没有 MiniMax H3 视频模型：请先在后台配置 AutoDL 渠道并同步模型目录（D-055 第一阶段）");
    }
    const ordered = withReferences
        ? [/^minimax_h3_lightx2v_v5_15s$/i, /^minimax_h3_lightx2v_v5$/i]
        : [/^minimax_h3_lightx2v_no_pic$/i, /^minimax_h3_lightx2v_/i];
    for (const pattern of ordered) {
        const hit = candidates.find((candidate) => pattern.test(candidate.model));
        if (hit) return hit;
    }
    return candidates[0];
}

function maxSecondsForModel(model: string): number {
    return H3_MODEL_SECOND_LIMITS.find((entry) => entry.match.test(model))?.maxSeconds ?? H3_FALLBACK_MAX_SECONDS;
}

function clampSeconds(value: number, maxSeconds: number): number {
    if (!Number.isFinite(value) || value <= 0) return Math.min(5, maxSeconds);
    return Math.max(1, Math.min(Math.round(value), maxSeconds));
}

/** 从项目蒸馏里取镜头 + 当前修订版；校验提示词存在。 */
export function resolveShotPrompt(detail: ProjectDetail, shotId: string): {
    shot: ProjectDetail["shots"][number];
    videoPrompt: string;
    durationMs: number;
} {
    const shot = (detail.shots || []).find((item) => item.id === shotId);
    if (!shot) throw new Error(`镜头不存在或不属于该项目：${shotId}`);
    const revision = (detail.shotRevisions || [])
        .filter((item) => item.shotId === shotId)
        .slice()
        .sort((left, right) => right.version - left.version)[0];
    const videoPrompt = (revision?.videoPrompt || "").trim();
    if (!videoPrompt) {
        throw new Error(`镜头「${shot.title || shotId}」的当前版本还没有视频提示词（videoPrompt），请先在镜头编辑里填写后再生成`);
    }
    return { shot, videoPrompt, durationMs: revision?.durationMs || shot.durationMs || 0 };
}

/**
 * project_generate_shot 执行体：从镜头当前修订版发起 H3 视频生成。
 * 返回创建好的任务（不等待完成；进度由项目工作区轮询，产物自动挂镜头）。
 */
export async function generateShot(projectId: string, rawInput: GenerateShotInput): Promise<GenerateShotResult> {
    const detail = await getProject(projectId);
    const { shot, videoPrompt, durationMs } = resolveShotPrompt(detail, String(rawInput.shotId || "").trim());

    const referenceUrls = (rawInput.referenceImageUrls || []).map((url) => url.trim()).filter(Boolean);
    const baseConfig = useConfigStore.getState().config;
    const selection = discoverH3VideoModel(baseConfig, referenceUrls.length > 0);
    const maxSeconds = maxSecondsForModel(selection.model);
    const videoSeconds = clampSeconds(rawInput.videoSeconds ?? (durationMs > 0 ? durationMs / 1000 : 5), maxSeconds);
    const resolution = (rawInput.resolution || DEFAULT_RESOLUTION).trim();

    const config: AiConfig = {
        ...baseConfig,
        model: selection.model,
        size: "16:9",
        vquality: resolution,
        videoSeconds: String(videoSeconds),
    };
    const referenceImages: ReferenceImage[] = referenceUrls.map((url, index) => ({
        id: crypto.randomUUID(),
        name: `shot-reference-${index + 1}`,
        type: "image/jpeg",
        dataUrl: "",
        url,
    }));

    const task = await submitBackendGenerationTask({
        projectId,
        mode: "video",
        prompt: videoPrompt,
        config,
        referenceImages,
        metadata: {
            shotId: shot.id,
            ...(shot.unitId ? { unitId: shot.unitId } : {}),
            artifactType: "video",
            source: "agent-generate-shot",
        },
    });
    return {
        taskId: task.id,
        shotId: shot.id,
        ...(shot.unitId ? { unitId: shot.unitId } : {}),
        model: selection.model,
        channelId: selection.channelId,
        operation: referenceImages.length ? "image_to_video" : "text_to_video",
        videoSeconds,
        resolution,
        status: task.status,
        promptSource: "revision",
    };
}
