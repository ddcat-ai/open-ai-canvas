import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { DreaminaGenerationAdapter, LocalDreaminaGenerationError } from "../src/dreamina-generation.js";
import { projectDreaminaModelCatalog } from "../src/dreamina-model-catalog.js";

test("Dreamina generation coalesces an equal idempotency request before invoking the official CLI", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-generation-test-"));
    const calls: string[] = [];
    const adapter = new DreaminaGenerationAdapter({
        root,
        models: projectDreaminaModelCatalog(),
        runtime: {
            async generateToResult(input) {
                calls.push(input.idempotencyKey);
                return { mode: "video", video: { dataUrl: "data:video/mp4;base64,AAAA", mimeType: "video/mp4", bytes: 3 } };
            },
        },
    });
    const request = {
        idempotencyKey: "seedance-mini-key-0001",
        operation: "text-to-video",
        model: "seedance2.0mini",
        prompt: "A short test clip",
        settings: { aspect: "16:9", resolution: "720p", duration: 4 },
        references: [],
    };

    try {
        const [first, second] = await Promise.all([adapter.run(request), adapter.run(request)]);
        assert.deepEqual(first, second);
        assert.deepEqual(calls, ["seedance-mini-key-0001"]);
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("Dreamina generation rejects a Seedance mini duration below the official four-second minimum", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-generation-test-"));
    const adapter = new DreaminaGenerationAdapter({
        root,
        models: projectDreaminaModelCatalog(),
        runtime: { async generateToResult() { throw new Error("must not execute"); } },
    });

    try {
        await assert.rejects(
            adapter.run({
                idempotencyKey: "seedance-mini-key-0002",
                operation: "text-to-video",
                model: "seedance2.0mini",
                prompt: "A short test clip",
                settings: { resolution: "720p", duration: 3 },
                references: [],
            }),
            (error: unknown) => error instanceof LocalDreaminaGenerationError
                && error.code === "local_generation_model_unavailable",
        );
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("Dreamina image generation maps auto or omitted product resolution to the official cross-model two-k tier", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-generation-test-"));
    const runtimeInputs: unknown[] = [];
    const adapter = new DreaminaGenerationAdapter({
        root,
        models: projectDreaminaModelCatalog(),
        runtime: {
            async generateToResult(input) {
                runtimeInputs.push(input);
                return { mode: "image", images: [{ dataUrl: "data:image/png;base64,AAAA", mimeType: "image/png", bytes: 3 }] };
            },
        },
    });

    try {
        const models = ["3.0", "3.1", "4.0", "4.1", "4.5", "4.6", "4.7", "5.0", "5.0Pro"] as const;
        for (const productResolution of [undefined, "auto"] as const) {
            for (const model of models) {
                const index = runtimeInputs.length;
                await adapter.run({
                    idempotencyKey: `dreamina-image-default-${String(index + 1).padStart(4, "0")}`,
                    operation: "text-to-image",
                    model,
                    prompt: "A small test image",
                    settings: { aspect: "1:1", ...(productResolution ? { resolution: productResolution } : {}), count: 1 },
                    references: [],
                });
                assert.deepEqual(runtimeInputs[index] && {
                    operation: (runtimeInputs[index] as { operation: string }).operation,
                    modelVersion: (runtimeInputs[index] as { modelVersion: string }).modelVersion,
                    resolutionType: (runtimeInputs[index] as { resolutionType: string }).resolutionType,
                }, { operation: "text2image", modelVersion: model, resolutionType: "2k" });
            }
        }
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("Dreamina image generation preserves an explicit unsupported tier for strict model validation", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-generation-test-"));
    let runtimeCalls = 0;
    const adapter = new DreaminaGenerationAdapter({
        root,
        models: projectDreaminaModelCatalog(),
        runtime: {
            async generateToResult() {
                runtimeCalls += 1;
                return { mode: "image", images: [{ dataUrl: "data:image/png;base64,AAAA", mimeType: "image/png", bytes: 3 }] };
            },
        },
    });

    try {
        await assert.rejects(adapter.run({
            idempotencyKey: "dreamina-image-explicit-0001",
            operation: "text-to-image",
            model: "5.0",
            prompt: "A small test image",
            settings: { aspect: "1:1", resolution: "1k", count: 1 },
            references: [],
        }), (error: unknown) => error instanceof LocalDreaminaGenerationError
            && error.code === "local_generation_request_invalid");
        assert.equal(runtimeCalls, 0);
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("Dreamina video generation maps product resolution values only in the final CLI adapter", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-generation-test-"));
    const runtimeInputs: unknown[] = [];
    const adapter = new DreaminaGenerationAdapter({
        root,
        models: projectDreaminaModelCatalog(),
        runtime: {
            async generateToResult(input) {
                runtimeInputs.push(input);
                return { mode: "video", video: { dataUrl: "data:video/mp4;base64,AAAA", mimeType: "video/mp4", bytes: 3 } };
            },
        },
    });

    try {
        const cases = [["480", "480p", "seedance2.5"], ["720", "720p", "seedance2.0mini"], ["1080", "1080p", "seedance2.0_vip"], ["2160", "4k", "seedance2.0_vip"]] as const;
        for (const [index, [productResolution, cliResolution, model]] of cases.entries()) {
            await adapter.run({
                idempotencyKey: `dreamina-video-resolution-${String(index + 1).padStart(4, "0")}`,
                operation: "text-to-video",
                model,
                prompt: "A short test clip",
                settings: { aspect: "16:9", resolution: productResolution, duration: 4 },
                references: [],
            });
            assert.equal((runtimeInputs[index] as { videoResolution: string }).videoResolution, cliResolution);
        }
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("Dreamina adapter returns the Runtime task after references are durably staged, before result polling", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-generation-test-"));
    let referencePath = "";
    const adapter = new DreaminaGenerationAdapter({
        root,
        models: projectDreaminaModelCatalog(),
        runtime: {
            async enqueue(input) {
                referencePath = "referenceImages" in input ? input.referenceImages[0] : "";
                assert(referencePath && await fs.stat(referencePath).then((item) => item.isFile()));
                return {
                    id: input.idempotencyKey,
                    provider: "dreamina-cli",
                    mode: "video",
                    operation: input.operation,
                    model: "seedance2.0mini",
                    status: "running",
                    stage: "submitted",
                    progress: 10,
                    receiptRecorded: true,
                    createdAt: "2026-08-12T00:00:00.000Z",
                    updatedAt: "2026-08-12T00:00:00.000Z",
                };
            },
            async waitForTask() { throw new Error("submit must not wait for query_result"); },
            async generateToResult() { throw new Error("submit must not use legacy generation"); },
        },
    });
    try {
        const task = await adapter.submit({
            idempotencyKey: "dreamina-adapter-async-0001",
            operation: "image-to-video",
            model: "seedance2.0mini",
            prompt: "Animate the reference",
            settings: { resolution: "720", duration: 4 },
            references: [{ kind: "image", mimeType: "image/png", contentBase64: Buffer.from("89504e470d0a1a0a", "hex").toString("base64") }],
        });
        assert.equal(task.stage, "submitted");
        await assert.rejects(fs.access(referencePath));
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("Dreamina final adapter selects multimodal2video and keeps typed references in separate staged groups", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-generation-test-"));
    let observedInput: Record<string, unknown> | undefined;
    let observedOptions: Record<string, unknown> | undefined;
    const stagedExtensions: string[] = [];
    const adapter = new DreaminaGenerationAdapter({
        root,
        models: projectDreaminaModelCatalog(),
        runtime: {
            async enqueue(input, options) {
                observedInput = input as unknown as Record<string, unknown>;
                observedOptions = options as unknown as Record<string, unknown>;
                const paths = [
                    ...("referenceImages" in input ? input.referenceImages : []),
                    ...("referenceVideos" in input ? input.referenceVideos : []),
                    ...("referenceAudios" in input ? input.referenceAudios : []),
                ];
                for (const reference of paths) {
                    assert.equal((await fs.stat(reference)).isFile(), true);
                    stagedExtensions.push(path.extname(reference));
                }
                return {
                    id: input.idempotencyKey,
                    provider: "dreamina-cli",
                    mode: "video",
                    operation: input.operation,
                    model: "seedance2.5",
                    status: "running",
                    stage: "submitted",
                    receiptRecorded: true,
                    createdAt: "2026-08-13T00:00:00.000Z",
                    updatedAt: "2026-08-13T00:00:00.000Z",
                };
            },
            async waitForTask() { throw new Error("submit must not wait"); },
            async generateToResult() { throw new Error("submit must not use legacy generation"); },
        },
    });
    try {
        await adapter.submit({
            idempotencyKey: "retry-client-operation-0001",
            clientOperationId: "retry-client-operation-0001",
            context: {
                scope: "scoped",
                projectId: "project-agent-multimodal",
                nodeId: "node-agent-multimodal",
                retryOf: "dreamina:prior-agent-0001",
                attemptGroupId: "dreamina:prior-agent-0001",
            },
            operation: "reference-to-video",
            model: "seedance2.5",
            prompt: "Use every reference",
            settings: { aspect: "16:9", resolution: "720", duration: 4 },
            references: [
                { kind: "image", mimeType: "image/png", contentBase64: Buffer.from("89504e470d0a1a0a", "hex").toString("base64"), metadata: { name: "image.png", width: 16, height: 9 } },
                { kind: "video", mimeType: "video/mp4", contentBase64: Buffer.from("000000106674797069736f6d", "hex").toString("base64"), metadata: { name: "video.mp4", durationMs: 1000 } },
                { kind: "audio", mimeType: "audio/mpeg", contentBase64: Buffer.from("49443304", "hex").toString("base64"), metadata: { name: "audio.mp3", durationMs: 1000 } },
            ],
        });

        assert.equal(observedInput?.operation, "multimodal2video");
        assert.equal((observedInput?.referenceImages as unknown[])?.length, 1);
        assert.equal((observedInput?.referenceVideos as unknown[])?.length, 1);
        assert.equal((observedInput?.referenceAudios as unknown[])?.length, 1);
        assert.deepEqual(stagedExtensions.sort(), [".mp3", ".mp4", ".png"]);
        assert.equal(observedOptions?.clientOperationId, "retry-client-operation-0001");
        assert.deepEqual(observedOptions?.taskContext, {
            scope: "scoped",
            projectId: "project-agent-multimodal",
            nodeId: "node-agent-multimodal",
            retryOf: "dreamina:prior-agent-0001",
            attemptGroupId: "dreamina:prior-agent-0001",
        });
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("only the final Dreamina adapter selects video CLI operations for every reference shape", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-operation-table-"));
    const observed: Array<Record<string, unknown>> = [];
    const adapter = new DreaminaGenerationAdapter({
        root,
        models: projectDreaminaModelCatalog(),
        runtime: {
            async generateToResult(input) {
                observed.push(input as unknown as Record<string, unknown>);
                return { mode: "video", video: { dataUrl: "data:video/mp4;base64,AAAA", mimeType: "video/mp4", bytes: 3 } };
            },
        },
    });
    const image = { kind: "image", mimeType: "image/png", contentBase64: Buffer.from("89504e470d0a1a0a", "hex").toString("base64") };
    const video = { kind: "video", mimeType: "video/mp4", contentBase64: Buffer.from("000000106674797069736f6d", "hex").toString("base64") };
    const audio = { kind: "audio", mimeType: "audio/mpeg", contentBase64: Buffer.from("49443304", "hex").toString("base64") };
    const cases = [
        { name: "zero-image", operation: "text-to-video", references: [], expected: "text2video", groups: [0, 0, 0] },
        { name: "one-image", operation: "image-to-video", references: [image], expected: "image2video", groups: [1, 0, 0] },
        { name: "two-images", operation: "image-to-video", references: [image, image], expected: "frames2video", groups: [2, 0, 0] },
        { name: "three-images", operation: "reference-to-video", references: [image, image, image], expected: "multimodal2video", groups: [3, 0, 0] },
        { name: "video-only", operation: "reference-to-video", references: [video], expected: "multimodal2video", groups: [0, 1, 0] },
        { name: "audio-only", operation: "reference-to-video", references: [audio], expected: "multimodal2video", groups: [0, 0, 1] },
        { name: "mixed", operation: "reference-to-video", references: [image, video, audio], expected: "multimodal2video", groups: [1, 1, 1] },
    ] as const;

    try {
        for (const [index, item] of cases.entries()) {
            await adapter.run({
                idempotencyKey: `operation-table-${String(index).padStart(2, "0")}-0001`,
                operation: item.operation,
                model: "seedance2.5",
                prompt: "fixture",
                settings: { aspect: "16:9", resolution: "720", duration: 4 },
                references: item.references,
            });
            const input = observed.at(-1)!;
            assert.equal(input.operation, item.expected, item.name);
            assert.deepEqual([
                (input.referenceImages as unknown[] | undefined)?.length ?? 0,
                (input.referenceVideos as unknown[] | undefined)?.length ?? 0,
                (input.referenceAudios as unknown[] | undefined)?.length ?? 0,
            ], item.groups, item.name);
        }

        await adapter.run({
            idempotencyKey: "operation-table-max-groups-0001",
            operation: "reference-to-video",
            model: "seedance2.5",
            prompt: "fixture",
            settings: { aspect: "16:9", resolution: "720", duration: 4 },
            references: [
                ...Array.from({ length: 30 }, () => image),
                ...Array.from({ length: 10 }, () => video),
                ...Array.from({ length: 10 }, () => audio),
            ],
        });
        assert.deepEqual([
            (observed.at(-1)?.referenceImages as unknown[] | undefined)?.length ?? 0,
            (observed.at(-1)?.referenceVideos as unknown[] | undefined)?.length ?? 0,
            (observed.at(-1)?.referenceAudios as unknown[] | undefined)?.length ?? 0,
        ], [30, 10, 10]);

        for (const [name, references] of [
            ["images", Array.from({ length: 31 }, () => image)],
            ["videos", Array.from({ length: 11 }, () => video)],
            ["audios", Array.from({ length: 11 }, () => audio)],
        ] as const) {
            await assert.rejects(adapter.run({
                idempotencyKey: `operation-limit-${name}-0001`,
                operation: "reference-to-video",
                model: "seedance2.5",
                prompt: "fixture",
                settings: { aspect: "16:9", resolution: "720", duration: 4 },
                references,
            }), (error: unknown) => error instanceof LocalDreaminaGenerationError
                && error.code === "local_generation_request_invalid");
        }
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});
