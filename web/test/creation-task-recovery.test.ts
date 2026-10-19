import { expect, test } from "bun:test";
import { reconcileCreationTaskMessages } from "../src/pages/create/creation-conversations";
import type { CreationConversation } from "../src/pages/create/creation-types";
import type { GenerationTask } from "../src/services/api/task-center";

const runtime = {} as Parameters<typeof reconcileCreationTaskMessages>[0];
const conversation = (): CreationConversation[] => [
    {
        id: "conversation",
        title: "套图",
        updatedAt: "2026-10-15T00:00:00Z",
        messages: [{ id: "batch", role: "assistant", mode: "image", content: "正在生成", status: "pending", createdAt: "2026-10-15T00:00:00Z", batchTotal: 2, taskIds: ["first", "second"] }],
    },
];
const task = (id: string, status: GenerationTask["status"]) =>
    ({
        id,
        status,
        type: "canvas_image",
        updatedAt: "2026-10-15T00:01:00Z",
        clientContext: { conversationId: "conversation", messageId: "batch", batchCount: 1 },
        ...(status === "succeeded" ? { creationResultStorageKeys: [`resource:${id}`] } : {}),
    }) as GenerationTask & { creationResultStorageKeys?: string[] };

test("单条已完成事件不能把还有另一真实任务的智能套图标记完成", () => {
    const updated = reconcileCreationTaskMessages(runtime, conversation(), [task("first", "succeeded")]);
    expect(updated[0].messages[0].status).toBe("pending");
});

test("整批真实终态收敛计数并保存每个任务状态，成功和失败都释放生成态", () => {
    const updated = reconcileCreationTaskMessages(runtime, conversation(), [task("first", "succeeded"), task("second", "failed")]);
    expect(updated[0].messages[0]).toMatchObject({
        status: "done",
        batchCompletedCount: 1,
        batchFailedCount: 1,
        taskStatuses: { first: "succeeded", second: "failed" },
        resultStorageKeys: ["resource:first"],
    });
});

test("全部取消的套图进入终态，同会话后续轮次无需新建对话", () => {
    const updated = reconcileCreationTaskMessages(runtime, conversation(), [task("first", "cancelled"), task("second", "cancelled")]);
    expect(updated[0].messages[0]).toMatchObject({ status: "cancelled", taskStatuses: { first: "cancelled", second: "cancelled" } });
});
