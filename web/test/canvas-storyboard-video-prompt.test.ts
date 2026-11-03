import { describe, expect, test } from "bun:test";

import { buildNodeGenerationContext } from "../src/components/canvas/canvas-node-generation";
import { attachNodeToStoryboardRow, createCanvasNode, createStoryboardRow, storyboardRowVideoPrompt, syncStoryboardVideoNode } from "../src/lib/canvas/canvas-project-domain";
import { nodeGenerationPrompt, synchronizeGenerationSpec } from "../src/lib/canvas/generation-contract";
import { CanvasNodeType } from "../src/types/canvas";

describe("storyboard row video prompt assembly", () => {
    test("combines motion prompt with dialogue and audio effects while skipping empty placeholders and duplicates", () => {
        const fullRow = createStoryboardRow(1, {
            videoMotionPrompt: "镜头从铁桥缓慢推近，雨丝飘落",
            dialogue: "深蓝 VO：第二百年，人类造网络，网络替人跑腿。",
            audioEffects: "暴雨声渐起、密集的外卖派单提示音",
        });
        expect(storyboardRowVideoPrompt(fullRow)).toBe(["镜头从铁桥缓慢推近，雨丝飘落", "台词/旁白：深蓝 VO：第二百年，人类造网络，网络替人跑腿。", "音效：暴雨声渐起、密集的外卖派单提示音"].join("\n"));

        const placeholderRow = createStoryboardRow(2, {
            plotDescription: "霓虹街口骑手急刹",
            dialogue: "无台词",
            audioEffects: "—",
        });
        expect(storyboardRowVideoPrompt(placeholderRow)).toBe("霓虹街口骑手急刹");

        const deduplicatedRow = createStoryboardRow(3, {
            videoMotionPrompt: "特写角色抬头说「快走！」，远处雷声轰鸣",
            dialogue: "快走！",
            audioEffects: "雷声轰鸣",
        });
        expect(storyboardRowVideoPrompt(deduplicatedRow)).toBe("特写角色抬头说「快走！」，远处雷声轰鸣");

        const missingVisualRow = createStoryboardRow(4, {
            dialogue: "只有台词没有画面",
            audioEffects: "风声",
        });
        expect(storyboardRowVideoPrompt(missingVisualRow)).toBe("");
    });

    test("attaching a storyboard row to a video node syncs dialogue, audio effects, references and generationSpec", () => {
        const row = createStoryboardRow(5, {
            id: "shot-5",
            durationSeconds: 8,
            videoMotionPrompt: "固定高机位俯拍大桥，画面从黄昏过渡到暴雨夜",
            dialogue: "旁白：时间向前推进了一百年。",
            audioEffects: "汽笛声渐变为暴雨声",
            assetBindings: [{ nodeId: "era-frame", role: "environment", priority: 90 }],
        });
        const script = createCanvasNode(
            CanvasNodeType.Script,
            { x: 0, y: 0 },
            {
                storyboard: {
                    rows: [row],
                    visibleColumns: ["shotNumber", "durationSeconds", "videoMotionPrompt", "dialogue", "assets"],
                    referenceNodeIds: [],
                },
            },
        );
        const eraFrame = {
            ...createCanvasNode(CanvasNodeType.Image, { x: -400, y: 0 }, { content: "data:image/png;base64,AA==" }),
            id: "era-frame",
        };
        const existingVideo = synchronizeGenerationSpec(createCanvasNode(CanvasNodeType.Video, { x: 600, y: 0 }, { composerContent: "旧提示词", seconds: "5" }), { composerContent: "旧提示词", seconds: "5" });

        const nextNodes = attachNodeToStoryboardRow([eraFrame, script, existingVideo], {
            fromNodeId: script.id,
            toNodeId: existingVideo.id,
            fromHandleId: "row:shot-5",
        });
        const updatedVideo = nextNodes.find((item) => item.id === existingVideo.id)!;
        const expectedComposer = ["参考资产：@图片1", "固定高机位俯拍大桥，画面从黄昏过渡到暴雨夜", "台词/旁白：旁白：时间向前推进了一百年。", "音效：汽笛声渐变为暴雨声"].join("\n");

        expect(updatedVideo.title).toBe("镜头 5 · 视频");
        expect(updatedVideo.metadata?.composerContent).toBe(expectedComposer);
        expect(nodeGenerationPrompt(updatedVideo)).toBe(expectedComposer);
        expect(updatedVideo.metadata?.generationSpec?.options.durationSeconds).toBe(8);
    });

    test("syncStoryboardVideoNode preserves committed prompt snapshot when updating an existing generated video", () => {
        const committed = synchronizeGenerationSpec(
            createCanvasNode(
                CanvasNodeType.Video,
                { x: 0, y: 0 },
                {
                    content: "https://example.com/shot.mp4",
                    prompt: "首版已提交提示词",
                    composerContent: "首版已提交提示词",
                    seconds: "6",
                },
            ),
            { composerContent: "首版已提交提示词", seconds: "6" },
        );
        const synced = syncStoryboardVideoNode(committed, {
            ...committed.metadata,
            prompt: "新版运动\n台词/旁白：你好",
            composerContent: "新版运动\n台词/旁白：你好",
            seconds: "10",
        });

        expect(synced.metadata?.prompt).toBe("首版已提交提示词");
        expect(synced.metadata?.composerContent).toBe("新版运动\n台词/旁白：你好");
        expect(nodeGenerationPrompt(synced)).toBe("新版运动\n台词/旁白：你好");
        expect(synced.metadata?.generationSpec?.options.durationSeconds).toBe(10);
    });

    test("storyboard row handle feeds structured shot text to non-media targets without polluting image or video nodes", () => {
        const row = createStoryboardRow(2, {
            id: "shot-2",
            durationSeconds: 6,
            plotDescription: "实验室屏幕亮起",
            dialogue: "许望舒：去吧。",
            audioEffects: "清脆的机械键盘回车声",
            videoMotionPrompt: "缓慢推向终端屏幕",
        });
        const script = createCanvasNode(
            CanvasNodeType.Script,
            { x: 0, y: 0 },
            {
                storyboard: {
                    rows: [row],
                    visibleColumns: ["shotNumber", "durationSeconds", "videoMotionPrompt", "dialogue", "assets"],
                    referenceNodeIds: [],
                },
            },
        );
        const textTarget = createCanvasNode(CanvasNodeType.Text, { x: 500, y: 0 }, {});
        const imageTarget = createCanvasNode(CanvasNodeType.Image, { x: 500, y: 300 }, {});
        const videoTarget = createCanvasNode(CanvasNodeType.Video, { x: 500, y: 600 }, {});

        const textContext = buildNodeGenerationContext(textTarget.id, [script, textTarget], [{ id: "c-text", fromNodeId: script.id, toNodeId: textTarget.id, fromHandleId: "row:shot-2" }], "根据该分镜扩写旁白台本", []);
        expect(textContext.textCount).toBe(1);
        expect(textContext.prompt).toContain("台词/旁白：许望舒：去吧。");
        expect(textContext.prompt).toContain("音效：清脆的机械键盘回车声");

        const imageContext = buildNodeGenerationContext(imageTarget.id, [script, imageTarget], [{ id: "c-img", fromNodeId: script.id, toNodeId: imageTarget.id, fromHandleId: "row:shot-2" }], "实验室屏幕亮起", []);
        expect(imageContext.textCount).toBe(0);
        expect(imageContext.prompt).toBe("实验室屏幕亮起");

        const videoPrompt = storyboardRowVideoPrompt(row);
        const videoContext = buildNodeGenerationContext(videoTarget.id, [script, videoTarget], [{ id: "c-vid", fromNodeId: script.id, toNodeId: videoTarget.id, fromHandleId: "row:shot-2" }], videoPrompt, [], true);
        expect(videoContext.textCount).toBe(0);
        expect(videoContext.prompt).toBe(videoPrompt);
    });
});
