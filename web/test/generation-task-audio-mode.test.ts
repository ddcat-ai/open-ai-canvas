import { describe, expect, test } from "bun:test";
import { prepareBackendGenerationTask, runBackendGenerationTask, type GenerationTaskDependencies } from "../src/services/api/generation-task";
import { createModelChannel, defaultConfig, encodeChannelModel } from "../src/stores/use-config-store";
import type { CreateTaskInput } from "../src/services/api/task-center";
import { buildGenerationConfig, buildAudioGenerationMetadata } from "../src/lib/canvas/canvas-project-generation";
import { CanvasNodeType } from "../src/types/canvas";

describe("audio mode reference delivery", () => {
    test("canvas execution honors node tts override and persists it on the output", async () => {
        const channel = createModelChannel({ id: "audio-test", name: "Audio", baseUrl: "https://example.com", apiKey: "test-key", interfaceType: "doubao-streaming-tts", models: ["jimeng-audio-seedaudio-1.0"] });
        const model = encodeChannelModel(channel.id, "jimeng-audio-seedaudio-1.0");
        const config = buildGenerationConfig(
            { ...defaultConfig, channels: [channel], model, audioModel: model, audioMode: "auto" },
            { id: "target", type: CanvasNodeType.Audio, title: "Audio", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { model, audioMode: "tts" } },
            "audio",
        );
        expect(config.audioMode).toBe("tts");
        expect(buildAudioGenerationMetadata(config).audioMode).toBe("tts");
        const task = await prepareBackendGenerationTask({ mode: "audio", prompt: "朗读验收", config, referenceAudios: [{ id: "sample", name: "sample.mp3", type: "audio/mpeg", storageKey: "resource:sample" }] });
        expect((task.input as { referenceAudios: unknown[] }).referenceAudios).toHaveLength(0);
    });
    for (const audioMode of ["auto", "unified_edit", "tts"]) {
        test(`${audioMode} delivers the same references through preparation and execution`, async () => {
            const channel = createModelChannel({ id: "audio-test", name: "Audio", baseUrl: "https://example.com", apiKey: "test-key", interfaceType: "doubao-streaming-tts", models: ["jimeng-audio-seedaudio-1.0"] });
            const options = {
                mode: "audio" as const,
                prompt: "参考声音朗读台词",
                config: { ...defaultConfig, channels: [channel], model: encodeChannelModel(channel.id, "jimeng-audio-seedaudio-1.0"), audioMode },
                referenceAudios: [{ id: "sample", name: "sample.mp3", type: "audio/mpeg", storageKey: "resource:sample" }],
            };
            const expectedCount = audioMode === "tts" ? 0 : 1;
            const prepared = await prepareBackendGenerationTask(options);
            expect((prepared.input as { referenceAudios: unknown[] }).referenceAudios).toHaveLength(expectedCount);
            let submitted: CreateTaskInput | undefined;
            const dependencies = {
                createTask: async (input: CreateTaskInput) => {
                    submitted = input;
                    throw new Error("captured submission");
                },
            } as unknown as GenerationTaskDependencies;
            await expect(runBackendGenerationTask(options, dependencies)).rejects.toThrow("captured submission");
            expect((submitted!.input as { referenceAudios: unknown[] }).referenceAudios).toHaveLength(expectedCount);
        });
    }
    test("explicit unified_edit without an audio reference is rejected before submission", async () => {
        const channel = createModelChannel({ id: "audio-test", name: "Audio", baseUrl: "https://example.com", apiKey: "test-key", interfaceType: "doubao-streaming-tts", models: ["jimeng-audio-seedaudio-1.0"] });
        await expect(
            prepareBackendGenerationTask({
                mode: "audio",
                prompt: "台词",
                config: { ...defaultConfig, channels: [channel], model: encodeChannelModel(channel.id, "jimeng-audio-seedaudio-1.0"), audioMode: "unified_edit" },
            }),
        ).rejects.toThrow("全能配音需要连接参考音频");
    });
});
