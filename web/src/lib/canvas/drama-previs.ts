import { nanoid } from "nanoid";

import { dramaSegmentPrompt } from "@/lib/canvas/drama-canvas-projection";
import { createPrevisSceneFromTemplate } from "@/lib/canvas/previs/previs-templates";
import type { DramaEpisode, DramaSegment, DramaShot } from "@/services/api/drama";
import type { CanvasNodeData } from "@/types/canvas";
import type { PrevisAspectRatio, PrevisScene, PrevisShotSize } from "@/types/previs";

export type DramaPrevisRequest = {
    episode: Pick<DramaEpisode, "id" | "projectId" | "number">;
    segment: DramaSegment;
    shots: DramaShot[];
    aspectRatio: string;
    sourceNodeId: string;
};

const ASPECT_RATIOS: ReadonlySet<string> = new Set(["auto", "2.39:1", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]);
const SHOT_SIZES: Record<string, PrevisShotSize> = {
    大远景: "extreme_wide",
    远景: "wide",
    全景: "full",
    中景: "medium",
    近景: "close_up",
    特写: "close_up",
    大特写: "extreme_close_up",
};

export function findDramaPrevisDraft(nodes: CanvasNodeData[], scenes: PrevisScene[], projectId: string, segmentId: string) {
    for (const node of nodes) {
        const metadata = node.metadata;
        const source = metadata?.dramaRef;
        if (metadata?.workflowKind !== "shot" || source?.projectId !== projectId || source.kind !== "segment" || source.id !== segmentId) continue;
        const scene = scenes.find((item) => item.id === metadata.previsSceneId);
        if (scene) return { node, scene };
    }
    return undefined;
}

/** 保留制作台的逐镜头脚本；空间布局从空场景开始，不把文本推测为人物站位或摄影机轨迹。 */
export function buildDramaPrevisScene({ episode, segment, shots, aspectRatio }: DramaPrevisRequest): PrevisScene {
    const segmentShots = shots.filter((shot) => shot.episodeId === episode.id && shot.segmentIndex === segment.index).sort((left, right) => left.position - right.position);
    if (!episode.projectId || !episode.id || !segment.id || !segmentShots.length) throw new Error("本段镜头数据不完整，请刷新制作台后重试");
    if (!ASPECT_RATIOS.has(aspectRatio)) throw new Error("当前画幅尚不支持 3D 预演，请先调整作品画幅");
    if (segmentShots.some((shot) => !Number.isFinite(shot.durationMs) || shot.durationMs <= 0)) throw new Error("镜头时长无效，请先在制作台修正");

    const title = `第 ${episode.number} 集 · 第 ${segment.index + 1} 段 · ${segment.title}`;
    const scene = createPrevisSceneFromTemplate("empty", title);
    const baseCamera = scene.cameras[0];
    const cameras = segmentShots.map((shot) => ({ ...structuredClone(baseCamera), id: nanoid(), name: `镜头 ${shot.position + 1} 摄影机` }));
    const prompt = dramaSegmentPrompt(segment);
    const projectedShots = segmentShots.map((shot, index) => ({
        ...scene.shots[0],
        id: nanoid(),
        name: `镜头 ${shot.position + 1}${shot.scene ? ` · ${shot.scene}` : ""}`,
        cameraId: cameras[index].id,
        duration: shot.durationMs / 1000,
        aspectRatio: aspectRatio as PrevisAspectRatio,
        shotSize: SHOT_SIZES[shot.shotSize] || scene.shots[0].shotSize,
        prompt: [
            "【制作台镜头脚本】",
            shot.scene && `场景：${shot.scene}`,
            shot.shotSize && `景别：${shot.shotSize}`,
            shot.camera && `运镜要求：${shot.camera}`,
            shot.action && `动作：${shot.action}`,
            shot.dialogue && `对白${shot.speaker ? `（${shot.speaker}）` : ""}：${shot.dialogue}`,
            shot.imagePrompt && `画面提示词：${shot.imagePrompt}`,
            shot.videoPrompt && `镜头视频提示词：${shot.videoPrompt}`,
            shot.sourceQuote && `剧本原文：${shot.sourceQuote}`,
            prompt && `\n【完整段视频提示词】\n${prompt}`,
        ]
            .filter(Boolean)
            .join("\n"),
    }));
    return { ...scene, cameras, shots: projectedShots, activeShotId: projectedShots[0].id };
}
