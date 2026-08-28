import { describe, expect, test } from "bun:test";

import { canvasGenerationRequestFingerprint, runCanvasGenerationSubmissionOnce } from "@/lib/canvas/canvas-generation-submission";

function fingerprint(overrides: Partial<Parameters<typeof canvasGenerationRequestFingerprint>[0]> = {}) {
    return canvasGenerationRequestFingerprint({
        nodeId: "node-1",
        mode: "video",
        prompt: "夜晚的城市",
        model: "video-model",
        options: { size: "16:9", videoSeconds: 10, vquality: "768p" },
        context: {
            referenceImages: [{ id: "image-1", name: "reference.png", type: "image/png", dataUrl: "", storageKey: "resource:image-1" }],
            referenceVideos: [],
            referenceAudios: [],
            characterReferences: [],
            resolvedCharacterVersions: [],
            resolvedCharacterVoices: [],
        },
        ...overrides,
    });
}

describe("canvas generation submission", () => {
    test("同一节点的并发提交只执行一次", async () => {
        const locks = new Map<string, Promise<unknown>>();
        let executions = 0;
        let duplicates = 0;
        let release!: () => void;
        const pending = new Promise<void>((resolve) => {
            release = resolve;
        });
        const run = () =>
            runCanvasGenerationSubmissionOnce(
                locks,
                "node-1",
                async () => {
                    executions += 1;
                    await pending;
                    return "done";
                },
                () => {
                    duplicates += 1;
                },
            );

        const submissions = [run(), run(), run()];
        await Promise.resolve();
        expect(executions).toBe(1);
        expect(duplicates).toBe(2);
        release();
        expect(await Promise.all(submissions)).toEqual(["done", "done", "done"]);

        await run();
        expect(executions).toBe(2);
    });

    test("相同输入生成稳定指纹，关键内容变化会改变指纹", () => {
        expect(fingerprint({ options: { vquality: "768p", videoSeconds: 10, size: "16:9" } })).toBe(fingerprint());
        expect(fingerprint({ prompt: "白天的城市" })).not.toBe(fingerprint());
        expect(fingerprint({ model: "another-model" })).not.toBe(fingerprint());
        expect(fingerprint({ options: { size: "9:16", videoSeconds: 10, vquality: "768p" } })).not.toBe(fingerprint());
        expect(
            fingerprint({
                context: {
                    referenceImages: [{ id: "image-2", name: "other.png", type: "image/png", dataUrl: "", storageKey: "resource:image-2" }],
                    referenceVideos: [],
                    referenceAudios: [],
                    characterReferences: [],
                    resolvedCharacterVersions: [],
                    resolvedCharacterVoices: [],
                },
            }),
        ).not.toBe(fingerprint());
    });
});
