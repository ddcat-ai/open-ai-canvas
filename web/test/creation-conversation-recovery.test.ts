import { describe, expect, test } from "bun:test";

import { applyRecoveredCreationResult, consumeCreationImageResult, mergeCreationTaskObservations, projectCreationImageFailure, reconcileCreationTaskMessages, type PersistedCreationTask } from "../src/pages/create/creation-conversations";
import { consumeGenerationTaskMessage } from "@/services/project-asset-sync";
import { applyGenerationConsumerEffect } from "@/services/generation-consumer-dedupe";
import type { CreationConversation } from "../src/pages/create/creation-types";
import { pendingCreationTaskIds } from "../src/services/creation-conversation-store";
import type { GenerationTask } from "../src/services/api/task-center";

const timestamp = "2026-10-01T00:00:00Z";
const runtime = { recoverCreationTextTask: () => null } as unknown as Parameters<typeof reconcileCreationTaskMessages>[0];

function conversation(taskIds: string[], batchTotal?: number): CreationConversation[] {
    return [{
        id: "conversation",
        title: "测试对话",
        updatedAt: timestamp,
        messages: [{ id: "result", role: "assistant", mode: "image", status: "pending", content: "", createdAt: timestamp, taskIds, ...(batchTotal ? { batchTotal } : {}) }],
    }];
}

function succeededTask(id: string, batchIndex: number, batchCount: number) {
    return {
        id,
        type: "image",
        status: "succeeded",
        prompt: "测试图片",
        attempts: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        clientContext: { conversationId: "conversation", messageId: "result", batchIndex, batchCount },
        creationResultUrls: [`https://example.invalid/${id}.png`],
        creationResultStorageKeys: [`resource:${id}`],
    } satisfies GenerationTask & { creationResultUrls: string[]; creationResultStorageKeys: string[] };
}

function failedTask(id: string, batchIndex: number, batchCount: number) {
    return {
        id,
        type: "image",
        status: "failed",
        prompt: "测试图片",
        attempts: 1,
        error: "生成失败",
        createdAt: timestamp,
        updatedAt: timestamp,
        clientContext: { conversationId: "conversation", messageId: "result", batchIndex, batchCount },
    } satisfies GenerationTask;
}

function recoverCallbacks(initial: CreationConversation[], deliveries: PersistedCreationTask[]) {
    const observations = new Map<string, PersistedCreationTask>();
    let current = initial;
    const snapshots: CreationConversation[][] = [];
    for (const task of deliveries) {
        const observed = mergeCreationTaskObservations(observations, [task], pendingCreationTaskIds(current));
        current = reconcileCreationTaskMessages(runtime, current, observed);
        snapshots.push(current);
    }
    return snapshots;
}

describe("creation conversation per-task recovery", () => {
    test("真实结果消费回调仅有稳定资源键时保留成功，并在 catch 与重载恢复后不计失败", async () => {
        let message = conversation(["first"], 1)[0].messages[0];
        const task = { ...succeededTask("first", 0, 1), outputs: [{ outputIndex: 0, materializedAssetId: "asset-first" }] } as GenerationTask;
        const fakeRuntime = {
            consumeGenerationTaskMessage: (current: GenerationTask, id: string, callback: Parameters<typeof consumeGenerationTaskMessage>[2]) => consumeGenerationTaskMessage(current, id, callback, {
                managed: true,
                materialize: async (value) => value,
                materializedUrls: () => [],
                materializedStorageKeys: () => ["resource:first"],
                attachMessage: async (_task, _id, _index, consumer) => consumer({ effectKey: "first-effect" }),
            }),
            generationTaskMaterializedUrls: () => [],
            generationTaskMaterializedStorageKeys: () => ["resource:first"],
            applyGenerationConsumerEffect,
        } as unknown as Parameters<typeof consumeCreationImageResult>[0];
        const result = await consumeCreationImageResult(fakeRuntime, task, message.id, 1, async (update) => { message = update(message); });
        expect(result).toEqual({ url: "", storageKey: "resource:first" });
        expect(message.status).toBe("done");
        expect(message.batchFailedCount).toBe(0);
        message = projectCreationImageFailure(message);
        expect(message.status).toBe("done");
        const reloaded = reconcileCreationTaskMessages(runtime, conversation(["first"], 1), [{ ...task, creationResultStorageKeys: ["resource:first"], creationResultUrls: [] }]);
        expect(reloaded[0].messages[0].status).toBe("done");
        expect(reloaded[0].messages[0].batchFailedCount).toBe(0);
    });
    test("keeps a normal two-image result pending after the first task, then retains both results", () => {
        const first = reconcileCreationTaskMessages(runtime, conversation(["first", "second"]), [succeededTask("first", 0, 2)]);
        expect(first[0].messages[0].status).toBe("pending");
        expect(first[0].messages[0].resultUrls).toEqual(["https://example.invalid/first.png"]);
        expect(first[0].messages[0].resultStorageKeys).toEqual(["resource:first"]);
        expect(pendingCreationTaskIds(first)).toEqual(["first", "second"]);

        const second = reconcileCreationTaskMessages(runtime, first, [succeededTask("second", 1, 2)]);
        expect(second[0].messages[0].status).toBe("done");
        expect(second[0].messages[0].resultUrls).toEqual(["https://example.invalid/first.png", "https://example.invalid/second.png"]);
        expect(second[0].messages[0].resultStorageKeys).toEqual(["resource:first", "resource:second"]);
        expect(pendingCreationTaskIds(second)).toEqual([]);
    });

    test("finishes a normal single-image result immediately", () => {
        const next = reconcileCreationTaskMessages(runtime, conversation(["single"]), [succeededTask("single", 0, 1)]);
        expect(next[0].messages[0].status).toBe("done");
        expect(next[0].messages[0].resultStorageKeys).toEqual(["resource:single"]);
        expect(pendingCreationTaskIds(next)).toEqual([]);
    });

    test("keeps a smart-creation batch pending until its second result arrives", () => {
        const first = reconcileCreationTaskMessages(runtime, conversation(["first", "second"], 2), [succeededTask("first", 0, 2)]);
        expect(first[0].messages[0].status).toBe("pending");
        expect(pendingCreationTaskIds(first)).toEqual(["first", "second"]);

        const second = reconcileCreationTaskMessages(runtime, first, [succeededTask("second", 1, 2)]);
        expect(second[0].messages[0].status).toBe("done");
        expect(second[0].messages[0].batchCompletedCount).toBe(2);
        expect(second[0].messages[0].resultStorageKeys).toEqual(["resource:first", "resource:second"]);
    });

    test("consumer callback keeps the normal multi-image message pending after its first attachment", () => {
        const message = conversation(["first", "second"])[0].messages[0];
        const first = applyRecoveredCreationResult(message, ["https://example.invalid/first.png"], ["resource:first"], 2);
        expect(first.status).toBe("pending");
        expect(first.resultStorageKeys).toEqual(["resource:first"]);
        const second = applyRecoveredCreationResult(first, ["https://example.invalid/second.png"], ["resource:second"], 2);
        expect(second.status).toBe("done");
        expect(second.resultStorageKeys).toEqual(["resource:first", "resource:second"]);
    });

    test("counts distinct failures delivered by separate recovery callbacks", () => {
        const [first, second] = recoverCallbacks(conversation(["first", "second"]), [failedTask("first", 0, 2), failedTask("second", 1, 2)]);
        expect(first[0].messages[0].status).toBe("pending");
        expect(first[0].messages[0].batchFailedCount).toBe(1);
        expect(pendingCreationTaskIds(first)).toEqual(["first", "second"]);
        expect(second[0].messages[0].status).toBe("error");
        expect(second[0].messages[0].error).toBe("生成失败");
        expect(pendingCreationTaskIds(second)).toEqual([]);
    });

    test("does not count a repeated callback for the same failed task twice", () => {
        const [first, repeated, second] = recoverCallbacks(conversation(["first", "second"]), [failedTask("first", 0, 2), failedTask("first", 0, 2), failedTask("second", 1, 2)]);
        expect(first[0].messages[0].batchFailedCount).toBe(1);
        expect(repeated[0].messages[0].status).toBe("pending");
        expect(repeated[0].messages[0].batchFailedCount).toBe(1);
        expect(second[0].messages[0].status).toBe("error");
        expect(second[0].messages[0].batchFailedCount).toBe(2);
    });

    test("discards observations after their conversation stops awaiting those task IDs", () => {
        const observations = new Map<string, PersistedCreationTask>();
        mergeCreationTaskObservations(observations, [failedTask("old", 0, 2)], ["old", "other"]);
        const next = mergeCreationTaskObservations(observations, [failedTask("new", 0, 2)], ["new", "another"]);
        expect(next.map((task) => task.id)).toEqual(["new"]);
        expect(observations.has("old")).toBe(false);
    });

    test("settles one successful image and two separately failed tasks", () => {
        const [first, second, third] = recoverCallbacks(conversation(["first", "second", "third"]), [succeededTask("first", 0, 3), failedTask("second", 1, 3), failedTask("third", 2, 3)]);
        expect(first[0].messages[0].status).toBe("pending");
        expect(second[0].messages[0].status).toBe("pending");
        expect(third[0].messages[0].status).toBe("done");
        expect(third[0].messages[0].batchFailedCount).toBe(2);
        expect(third[0].messages[0].resultStorageKeys).toEqual(["resource:first"]);
        expect(pendingCreationTaskIds(third)).toEqual([]);
    });
});
