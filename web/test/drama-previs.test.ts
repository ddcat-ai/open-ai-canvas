import { describe, expect, test } from "bun:test";

import { buildDramaPrevisScene, findDramaPrevisDraft, type DramaPrevisRequest } from "../src/lib/canvas/drama-previs";
import { createCanvasNode } from "../src/lib/canvas/canvas-project-domain";
import type { DramaShot } from "../src/services/api/drama";
import { CanvasNodeType } from "../src/types/canvas";

function shot(position: number, durationMs: number, patch: Partial<DramaShot> = {}): DramaShot {
    return {
        id: `shot-${position}`,
        projectId: "project-a",
        episodeId: "episode-a",
        position,
        segmentIndex: 1,
        segmentTitle: "重逢",
        scene: "车站",
        castIdsJson: '["character-a"]',
        lookCastIdsJson: "[]",
        propIdsJson: "[]",
        speaker: "林雨",
        dialogue: "好久不见",
        action: "林雨抬头看向站台",
        shotSize: "近景",
        camera: "缓慢推进",
        transition: "",
        durationMs,
        imagePrompt: "傍晚车站",
        videoPrompt: "人物转身",
        sourceQuote: "她在站台等着。",
        ...patch,
    };
}

function request(): DramaPrevisRequest {
    return {
        episode: { id: "episode-a", projectId: "project-a", number: 2 },
        sourceNodeId: "source-video",
        aspectRatio: "9:16",
        segment: {
            id: "segment-a",
            revision: 1,
            index: 1,
            title: "重逢",
            shotIds: ["shot-2", "shot-3"],
            durationMs: 6750,
            videoPrompt: "参考图1的林雨走到站台",
            generated: "",
            custom: true,
            promptStatus: "ready",
            videoStatus: "ready",
            videoResourceId: "video-a",
            videoModel: {},
            referenceMode: "auto",
            audioReferenceMode: "auto",
            request: { operation: "reference_to_video", seconds: 6.75, maxVideoSeconds: 15, aspectRatio: "9:16", generateAudio: true, firstFramePending: false, references: [], referenceCapacity: 5, modelMaxImages: 5, header: "参考图1：林雨" },
        },
        shots: [shot(3, 4250), shot(2, 2500)],
    };
}

describe("制作台到 3D 预演场景", () => {
    test("保留镜头顺序、精确时长、画幅和来源文本，并从空布局开始", () => {
        const input = request();
        input.shots.push(shot(4, 1200, { segmentIndex: 2 }), shot(5, 3000, { episodeId: "another-episode" }));
        const scene = buildDramaPrevisScene(input);
        expect(scene.title).toBe("第 2 集 · 第 2 段 · 重逢");
        expect(scene.shots.map((item) => item.name)).toEqual(["镜头 3 · 车站", "镜头 4 · 车站"]);
        expect(scene.shots.map((item) => item.duration)).toEqual([2.5, 4.25]);
        expect(scene.shots.map((item) => item.aspectRatio)).toEqual(["9:16", "9:16"]);
        expect(scene.activeShotId).toBe(scene.shots[0].id);
        expect(new Set(scene.shots.map((item) => item.cameraId)).size).toBe(2);
        expect(scene.objects).toEqual([]);
        expect(scene.cameras.every((camera) => camera.keyframes.length === 0)).toBe(true);
        for (const item of scene.shots) {
            expect(item.prompt).toContain("运镜要求：缓慢推进");
            expect(item.prompt).toContain("对白（林雨）：好久不见");
            expect(item.prompt).toContain("剧本原文：她在站台等着。");
            expect(item.prompt).toContain("参考图1：林雨\n\n参考图1的林雨走到站台");
        }
    });

    test("无镜头、无效时长和不支持画幅会中止，不写入伪造的默认数据", () => {
        expect(() => buildDramaPrevisScene({ ...request(), shots: [] })).toThrow("镜头数据不完整");
        expect(() => buildDramaPrevisScene({ ...request(), shots: [shot(1, 0)] })).toThrow("镜头时长无效");
        expect(() => buildDramaPrevisScene({ ...request(), shots: [shot(1, Number.NaN)] })).toThrow("镜头时长无效");
        expect(() => buildDramaPrevisScene({ ...request(), aspectRatio: "unsupported" })).toThrow("画幅尚不支持");
    });

    test("重复进入复用已有场景与节点，不覆盖时长、提示词和摄影机编辑", () => {
        const input = request();
        const scene = buildDramaPrevisScene(input);
        scene.shots[0].duration = 9.5;
        scene.shots[0].prompt = "编导修改后的动作";
        scene.cameras[0].transform.position = [2, 3, 4];
        const node = createCanvasNode(
            CanvasNodeType.Video,
            { x: 24, y: 32 },
            { workflowKind: "shot", previsSceneId: scene.id, dramaRef: { projectId: input.episode.projectId, kind: "segment", id: input.segment.id, episodeId: input.episode.id, segmentIndex: input.segment.index } },
        );
        const result = findDramaPrevisDraft([node], [scene], input.episode.projectId, input.segment.id);
        expect(result?.node).toBe(node);
        expect(result?.scene).toBe(scene);
        expect(result?.scene.shots[0].duration).toBe(9.5);
        expect(result?.scene.shots[0].prompt).toBe("编导修改后的动作");
        expect(result?.scene.cameras[0].transform.position).toEqual([2, 3, 4]);
        expect(findDramaPrevisDraft([node], [scene], "another-project", input.segment.id)).toBeUndefined();
        expect(findDramaPrevisDraft([node], [], input.episode.projectId, input.segment.id)).toBeUndefined();
    });
});
