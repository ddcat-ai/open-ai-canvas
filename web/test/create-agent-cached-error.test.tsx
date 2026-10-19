import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { applyCreationAgentTaskState, mergeCreationConversationHistory, projectCreationAgentConversation } from "../src/pages/create/creation-agent-conversation";
import { attachCreationTaskContexts, reconcileCreationTaskMessages } from "../src/pages/create/creation-conversations";
import { CreationMessageView } from "../src/pages/create/creation-workspace-messages";
import type { CreationConversation } from "../src/pages/create/creation-types";
import type { GenerationTask } from "../src/services/api/task-center";

const at = "2026-10-17T10:00:00Z";
const runtime = { recoverCreationTextTask: () => null } as unknown as Parameters<typeof reconcileCreationTaskMessages>[0];
const task = (id: string, status: GenerationTask["status"], error?: string): GenerationTask => ({ id, status, error, type: "image", prompt: "产品场景", attempts: 1, createdAt: at, updatedAt: at });

function cachedConversation() {
    const session = { id: "session", title: "产品套图", surface: "creation", status: "active", revision: 1, createdAt: at, updatedAt: at };
    const conversation = projectCreationAgentConversation(session, [
        {
            id: "run",
            sessionId: session.id,
            canvasId: "",
            surface: "creation",
            userPrompt: "生成五张产品图",
            status: "completed",
            permissionMode: "auto",
            createdAt: at,
            updatedAt: at,
            events: Array.from({ length: 5 }, (_, index) => ({
                eventId: `event-${index}`,
                runId: "run",
                seq: index + 1,
                type: "generation_task_created",
                createdAt: at,
                payload: { taskId: `image-${index}`, mode: "image", title: `场景图 ${index + 1}`, imageBatchId: "batch", imageBatchTotal: 5 },
            })),
        },
    ]);
    conversation.messages = conversation.messages.map((message) =>
        message.id === "task-image-0"
            ? { ...message, status: "done", error: "旧超时残留", resultUrls: ["https://example.invalid/done.png"], resultStorageKeys: ["resource:done"] }
            : message.id.startsWith("task-")
              ? { ...message, status: "error", content: "正在生成图片（0/5，失败 1）", error: "图片生成等待超时，请稍后重试。", batchFailedCount: 1 }
              : message,
    );
    return conversation;
}

function render(conversation: CreationConversation, taskSyncFailed = false) {
    return renderToStaticMarkup(
        <CreationMessageView
            item={conversation.messages.find((message) => message.mode === "agent" && message.role === "assistant")!}
            agentTasks={conversation.messages.filter((message) => message.id.startsWith("task-"))}
            taskSyncFailed={taskSyncFailed}
            onRefreshAgentTasks={() => {}}
            outputPreference="concise"
            shotNumber={0}
            openingCanvas={false}
            onRetryFailure={() => {}}
            onCreateVariant={() => {}}
            onEditUserMessage={() => {}}
            onContinueCanvas={() => {}}
        />,
    );
}

test("刷新第一帧不展示缓存旧超时，保留已成功图片并从事件恢复真实场景标题", () => {
    const cached = cachedConversation();
    const restored = mergeCreationConversationHistory([cached], [], cached.id).conversations[0];
    const html = render(restored);
    expect(html).toContain("done.png");
    expect(html).toContain("成功 1/5");
    expect(html).not.toContain("等待超时");
    expect(html).not.toContain("0/5，失败 1");
    expect(html).not.toContain("重试失败项");
    expect(restored.messages.find((message) => message.id === "task-image-1")?.content).toBe("场景图 2");
    expect(cached.messages.find((message) => message.id === "task-image-1")?.error).toContain("等待超时");
});

test("慢任务仍在复核时，已确认失败只展示简短汇总，旧缓存错误不混入", () => {
    let restored = mergeCreationConversationHistory([cachedConversation()], []).conversations[0];
    restored = applyCreationAgentTaskState(restored, task("image-1", "running"));
    restored = applyCreationAgentTaskState(restored, task("image-2", "failed", "模型服务拒绝了请求，请检查模型和参数"));
    const html = render(restored);
    expect(html).toContain("生成失败，请重试失败项。");
    expect(html).not.toContain("等待超时");
    expect(html).not.toContain("0/5，失败 1");
    expect(html.match(/>重试失败项</g)).toHaveLength(1);
    expect(restored.messages.find((message) => message.id === "task-image-1")?.error).toBeUndefined();
});

test("两个恢复订阅无论先后都保持单项失败与场景标题，不来回切换状态", () => {
    for (const agentFirst of [false, true]) {
        const cached = mergeCreationConversationHistory([cachedConversation()], []).conversations[0];
        const failed = task("image-1", "failed", "模型服务拒绝了请求，请检查模型和参数");
        const agent = (value: CreationConversation) => applyCreationAgentTaskState(value, failed);
        const generic = (value: CreationConversation) => reconcileCreationTaskMessages(runtime, [value], attachCreationTaskContexts([failed], [value]))[0];
        const first = agentFirst ? agent(cached) : generic(cached);
        const second = agentFirst ? generic(first) : agent(first);
        for (const current of [first, second, generic(agent(second))]) {
            expect(current.messages.find((message) => message.id === "task-image-1")).toMatchObject({ status: "error", content: "场景图 2", error: failed.error });
            expect(render(current)).toContain("生成失败，请重试失败项。");
            expect(render(current)).not.toContain("等待超时");
        }
    }
});

test("未提交到服务端的真实失败仍可见，不因缓存复核被永久隐藏", () => {
    const cached = cachedConversation();
    cached.messages = cached.messages.map((message) => (message.id === "task-image-1" ? { ...message, taskIds: [], content: "场景图 2", error: "提交校验失败" } : message));
    const restored = mergeCreationConversationHistory([cached], []).conversations[0];
    expect(render(restored)).toContain("生成失败，请重试失败项。");
});

test("复核子任务期间不回退展示父任务旧超时，纯规划失败仍正常显示", () => {
    const cached = cachedConversation();
    cached.messages = cached.messages.map((message) => (message.mode === "agent" && message.role === "assistant" ? { ...message, status: "error", error: "父任务旧超时" } : message));
    let restored = mergeCreationConversationHistory([cached], []).conversations[0];
    expect(render(restored)).not.toContain("父任务旧超时");
    expect(render(restored)).not.toContain("重新生成");
    restored = applyCreationAgentTaskState(restored, task("image-1", "failed", "模型服务拒绝了请求"));
    expect(render(restored)).toContain("生成失败，请重试失败项。");
    expect(render(restored)).not.toContain("父任务旧超时");
    const planning = { ...cached, messages: cached.messages.filter((message) => !message.id.startsWith("task-")) };
    expect(render(planning)).toContain("父任务旧超时");
    expect(render(planning)).toContain("重新生成");
});

test("原任务状态查询失败显示待确认与刷新状态，不能冒充生成中或重试旧失败", () => {
    const restored = mergeCreationConversationHistory([cachedConversation()], []).conversations[0];
    const html = render(restored, true);
    expect(html).toContain("4 项待确认");
    expect(html).toContain("任务状态暂时无法同步");
    expect(html).toContain("刷新状态");
    expect(html).not.toContain("4 项生成中");
    expect(html).not.toContain("等待超时");
    expect(html).not.toContain("重试失败项");
    expect(html).toContain("成功 1/5");
});
