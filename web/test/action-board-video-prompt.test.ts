import { describe, expect, test } from "bun:test";

import { ACTION_BOARD_VIDEO_DEFAULT_SIZE, ACTION_BOARD_VIDEO_DEFAULT_VQUALITY, buildActionBoardImagePrompt, buildActionBoardVideoPrompt, type ActionBoardPromptMention } from "../src/lib/canvas/action-board-video";
import { CanvasNodeType, type CanvasNodeData, type StoryboardRow } from "../src/types/canvas";
import { videoResolutionForSize, videoSizeForResolution } from "../src/lib/video-generation-options";

function board(composerContent: string): CanvasNodeData {
    return {
        id: "ab-1",
        type: CanvasNodeType.Image,
        title: "镜头 1 · 动作板",
        position: { x: 0, y: 0 },
        width: 420,
        height: 300,
        metadata: {
            workflowKind: "action_board",
            shotIndex: 1,
            composerContent,
            content: "data:image/png;base64,aa",
        },
    };
}

describe("buildActionBoardImagePrompt", () => {
    test("纳入运镜、时间节拍、表演调度等分镜字段，而不只 plotDescription", () => {
        const row = {
            shotNumber: 2,
            durationSeconds: 8,
            plotDescription: "林时按下启动键，机舱灯逐格亮起。",
            dialogue: "启动。",
            characters: [{ characterName: "林时" }],
            narrativeIntent: "建立掌控感",
            viewerPOV: "侧后方跟随",
            performanceBlocking: "右手按下键后停半拍看仪表",
            shotSize: "中近景",
            emotion: "克制的紧张",
            lightingAndAtmosphere: "冷蓝仪表光",
            audioEffects: "开关咔哒",
            camera: "略低机位",
            motion: "缓慢推近后停住",
            timeBeats: "0-2s 起手；2-5s 按下；5-8s 灯光连锁",
            imageGenerationPrompt: "林时半身，手在启动键上",
            videoMotionPrompt: "手指按下，灯光从左到右亮起",
            mustHave: ["同一服装", "仪表可读"],
            optionalDetails: ["细汗"],
            continuityOut: "灯光全亮，目光仍盯仪表",
            negativePrompt: "不要换脸、不要文字水印",
        } as Pick<StoryboardRow,
            | "shotNumber" | "durationSeconds" | "plotDescription" | "dialogue" | "characters"
            | "narrativeIntent" | "viewerPOV" | "performanceBlocking" | "shotSize" | "emotion"
            | "lightingAndAtmosphere" | "audioEffects" | "camera" | "motion" | "timeBeats"
            | "imageGenerationPrompt" | "videoMotionPrompt" | "mustHave" | "optionalDetails"
            | "continuityOut" | "negativePrompt"
        >;
        const prompt = buildActionBoardImagePrompt(row);
        expect(prompt).toContain("12 宫格");
        expect(prompt).toContain("镜头 2 · 8s");
        expect(prompt).toContain("运镜：缓慢推近后停住");
        expect(prompt).toContain("时间节拍：0-2s 起手");
        expect(prompt).toContain("表演调度：右手按下键");
        expect(prompt).toContain("镜头设计：略低机位");
        expect(prompt).toContain("必须包含：同一服装、仪表可读");
        expect(prompt).toContain("负面要求：不要换脸");
        expect(prompt).toContain("落实到 12 格时间轴");
    });
});

describe("buildActionBoardVideoPrompt", () => {
    test("分区自然语言，无 @[node:] UI token", () => {
        const mentions: ActionBoardPromptMention[] = [
            { nodeId: "char-lin", kind: "character", title: "林时" },
            { nodeId: "char-su", kind: "character", title: "苏文" },
            { nodeId: "style-1", kind: "style", title: "项目画风" },
            { nodeId: "chapter-1", kind: "scene", title: "章节 · 第 1 章" },
        ];
        const prompt = buildActionBoardVideoPrompt(board([
            "生成一张电影动作拆分 12 宫格参考图，严格 3 列 4 行。",
            "镜头 1：林时按下启动键。",
            "按时间顺序展示动作起势、推进、转折、落点和结束姿态，不要添加文字、边框标题或额外画面。",
        ].join("\n")), mentions);
        expect(prompt).toContain("【12 宫格动作参考】");
        expect(prompt).toContain("图1");
        expect(prompt).toContain("【角色】");
        expect(prompt).toContain("角色1：林时");
        expect(prompt).toContain("角色2：苏文");
        expect(prompt).toContain("【风格与场景】");
        expect(prompt).toContain("画风：项目画风");
        expect(prompt).toContain("场景：章节 · 第 1 章");
        expect(prompt).not.toContain("@[node:");
        expect(prompt).not.toContain("生成一张电影动作拆分 12 宫格参考图");
    });

    test("默认横屏 480p", () => {
        expect(ACTION_BOARD_VIDEO_DEFAULT_SIZE).toBe("854x480");
        expect(ACTION_BOARD_VIDEO_DEFAULT_VQUALITY).toBe("480");
    });
});

describe("video size/resolution linkage", () => {
    test("分辨率变化按比例改像素", () => {
        expect(videoSizeForResolution("480", "1280x720")).toBe("854x480");
        expect(videoSizeForResolution("720", "854x480")).toBe("1280x720");
        expect(videoSizeForResolution("480", "720x1280")).toBe("480x854");
    });
    test("尺寸变化反推分辨率档", () => {
        expect(videoResolutionForSize("854x480")).toBe("480");
        expect(videoResolutionForSize("1280x720")).toBe("720");
    });
});
