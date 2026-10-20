import { expect, test } from "bun:test";
import { buildCreationAgentRunInput } from "../src/pages/create/creation-agent-request";
import type { CreationMessage } from "../src/pages/create/creation-types";

const base = { prompt: "继续把刚才那张图做成视频", idempotencyKey: "direct-context-test", permissionMode: "request_approval" as const, textSelection: { channelId: "text-channel", channelModelKey: "text-model" } };
const message = (id: string, value: Partial<CreationMessage>): CreationMessage => ({ id, role: "assistant", content: "", mode: "image", createdAt: "2026-10-19T10:00:00Z", ...value });

test("普通生图后切回 Agent，当前可见成品定位最新消息而非旧 Agent 任务", () => {
    const messages = [
        message("old-agent-result", { agentRunId: "old-run", taskIds: ["mug"], resultStorageKeys: ["resource:mug"] }),
        message("new-result", { taskIds: ["street"], resultStorageKeys: ["resource:street"] }),
        message("pending", { taskIds: ["not-finished"], status: "pending" }),
    ];
    const input = buildCreationAgentRunInput({ ...base, prompt: "上面这张图是什么", conversation: { messages } });
    expect(input.latestVisibleResult).toEqual({ messageId: "new-result", taskIds: ["street"] });
    const imported = buildCreationAgentRunInput({ ...base, conversation: { messages, agentRuns: [{ id: "later", creationContextMessageIds: ["new-result"] }] } } as any);
    expect(imported.latestVisibleResult).toEqual(input.latestVisibleResult);
    expect(imported.creationContext?.some((item) => item.messageId === "new-result")).toBe(false);
    expect(buildCreationAgentRunInput({ ...base, conversation: { messages }, retry: { runId: "old-run" } }).latestVisibleResult).toBeUndefined();
});

test("最新结果的位置不依赖提示词关键词，保留一条消息内全部成品任务", () => {
    const conversation = { messages: [message("batch", { taskIds: ["one", "two"], resultUrls: ["blob:one", "blob:two"] })] };
    for (const prompt of ["上面这张图是什么", "继续", "换话题写一首诗"]) {
        const input = buildCreationAgentRunInput({ ...base, prompt, conversation });
        expect(input.latestVisibleResult).toEqual({ messageId: "batch", taskIds: ["one", "two"] });
        expect(input.attachments).toEqual([]);
        expect(input.prompt).toBe(prompt);
    }
});

test("Agent 聚合图片按可见卡片定位，保留整批并按方案顺序排列", () => {
    const conversation = {
        messages: [
            message("direct", { taskIds: ["street"], resultUrls: ["blob:street"] }),
            message("run:assistant", {
                mode: "agent",
                agentRunId: "run",
                status: "done",
                commercePlan: {
                    items: [
                        { id: "one", type: "image" },
                        { id: "two", type: "image" },
                    ],
                } as any,
            }),
            message("task-two", { agentRunId: "run", commerceItemId: "two", status: "done", taskIds: ["two"], resultUrls: ["blob:two"] }),
            message("task-one", { agentRunId: "run", commerceItemId: "one", status: "done", taskIds: ["one"], resultUrls: ["blob:one"] }),
        ],
    };
    const input = buildCreationAgentRunInput({ ...base, conversation });
    expect(input.latestVisibleResult).toEqual({ messageId: "task-batch-run-image", taskIds: ["one", "two"] });
});

test("旧 Agent 的迟到任务仍展示在旧卡片内，不覆盖更新的普通成品位置", () => {
    const conversation = {
        messages: [
            message("run:assistant", { mode: "agent", agentRunId: "run", status: "done" }),
            message("direct", { taskIds: ["street"], resultUrls: ["blob:street"] }),
            message("task-mug", { agentRunId: "run", status: "done", taskIds: ["mug"], resultUrls: ["blob:mug"] }),
        ],
    };
    expect(buildCreationAgentRunInput({ ...base, conversation }).latestVisibleResult).toEqual({ messageId: "direct", taskIds: ["street"] });
});

test("切回 Agent 传入普通模式文本与任务身份，不信任浏览器成品和状态", () => {
    const input = buildCreationAgentRunInput({
        ...base,
        conversation: {
            messages: [
                message("agent", { mode: "agent", agentRunId: "run-one", content: "已有 Agent 历史" }),
                message("user", { role: "user", content: "画一只猫" }),
                message("image", { status: "done", taskIds: ["image-task"], resultUrls: ["https://signed.example/private"], resultStorageKeys: ["resource:forged"], content: "已完成" }),
                message("video", { mode: "video", status: "error", taskIds: ["video-task"], error: "旧错误" }),
            ],
        },
    } as any);
    expect((input as any).creationContext).toEqual([
        { messageId: "user", role: "user", mode: "image", content: "画一只猫" },
        { messageId: "image", role: "assistant", mode: "image", taskIds: ["image-task"] },
        { messageId: "video", role: "assistant", mode: "video", taskIds: ["video-task"] },
    ]);
    expect(JSON.stringify(input)).not.toContain("signed.example");
    expect(JSON.stringify(input)).not.toContain("forged");
    expect(input.prompt).toBe(base.prompt);
    expect(input.permissionMode).toBe(base.permissionMode);
});

test("历史素材保留在上下文，明确引用或换新主题都不自动变成本轮附件", () => {
    const conversation = { messages: [message("reference", { role: "user", content: "照着产品图生成", attachments: [{ id: "reference", name: "产品图", type: "image/png", storageKey: "resource:owned", previewUrl: "blob:local" }] as any })] };
    for (const prompt of [base.prompt, "生成一张无关的太空风景，不参考之前的图片"]) {
        const input = buildCreationAgentRunInput({ ...base, conversation, prompt });
        expect(input.attachmentMode).toBe("replace");
        expect(input.attachments).toEqual([]);
        expect(input.creationContext).toEqual([{ messageId: "reference", role: "user", mode: "image", content: "照着产品图生成", resourceIds: ["owned"] }]);
        expect(JSON.stringify(input)).not.toContain("resource:owned");
    }
});

test("历史素材目录只传受管媒体ID，不静默丢弃较早素材、不传图片内容或下载地址", () => {
    const attachments = Array.from({ length: 40 }, (_, i) => ({ storageKey: `resource:history-${i}`, name: "历史图", type: "image/png", previewUrl: "https://signed.example/history", dataUrl: "data:image/png;base64,private" }));
    const conversation = {
        messages: [
            message("first", { role: "user", attachments: attachments as any }),
            message("latest", { role: "user", attachments: [attachments[39], attachments[39], { storageKey: "https://signed.example/forged", type: "image/png" }, { storageKey: "resource:document", type: "application/pdf" }] as any }),
        ],
    };
    const input = buildCreationAgentRunInput({ ...base, conversation });
    const ids = input.creationContext!.flatMap((entry) => entry.resourceIds || []);
    expect(new Set(ids).size).toBe(40);
    expect(input.creationContext!.at(-1)?.resourceIds).toEqual(["history-39"]);
    expect(input.attachments).toEqual([]);
    expect(JSON.stringify(input)).not.toContain("signed.example");
    expect(JSON.stringify(input)).not.toContain("base64");
    expect(ids).not.toContain("document");
});

test("首次导入保留早期持续约定与完整普通模式历史，重试不重复注入", () => {
    const conversation = { messages: Array.from({ length: 30 }, (_, i) => message(String(i), { role: "user", content: String(i) + "长".repeat(2000) })) };
    const input = buildCreationAgentRunInput({ ...base, conversation } as any) as any;
    expect(input.creationContext.length).toBe(30);
    expect(input.creationContext[0].content).toBe(conversation.messages[0].content);
    expect(input.creationContext[0].messageId).toBe("0");
    expect(input.creationContext.at(-1).content.startsWith("29")).toBe(true);
    expect((buildCreationAgentRunInput({ ...base, conversation, retry: { runId: "run-one" } } as any) as any).creationContext).toBeUndefined();
});

test("已由服务端确认导入的消息不重复发送，本地标记不能伪造导入完成", () => {
    const messages = [message("old", { role: "user", content: "持续约定" }), message("new", { role: "user", content: "这次改成美国站" })];
    const input = buildCreationAgentRunInput({
        ...base,
        conversation: {
            messages,
            agentRuns: [{ id: "run-one", creationContextMessageIds: ["old"] }],
        },
    } as any);
    expect(input.creationContext).toEqual([{ messageId: "new", role: "user", mode: "image", content: "这次改成美国站" }]);
    const unconfirmed = buildCreationAgentRunInput({ ...base, conversation: { messages, importedMessageIds: ["old"] } } as any);
    expect(unconfirmed.creationContext?.map((entry: any) => entry.messageId)).toEqual(["old", "new"]);
});

test("连续切换模式的实际请求只发送新增正文，以当前分支服务端收据为准", () => {
    const old = message("old", { role: "user", content: "长期约定：" + "产品信息".repeat(3000) });
    const fresh = message("fresh", { role: "user", content: "新增加的要求" });
    const first = buildCreationAgentRunInput({ ...base, conversation: { messages: [old] } });
    const second = buildCreationAgentRunInput({
        ...base,
        conversation: {
            messages: [old, fresh],
            agentRunId: "current",
            agentRuns: [
                { id: "current", creationContextMessageIds: ["old"] },
                { id: "discarded", creationContextMessageIds: ["old", "fresh"] },
            ],
        },
    } as any);
    expect(second.creationContext?.map((entry) => entry.messageId)).toEqual(["fresh"]);
    const firstBytes = new TextEncoder().encode(JSON.stringify(first)).length;
    const secondBytes = new TextEncoder().encode(JSON.stringify(second)).length;
    expect(secondBytes).toBeLessThan(firstBytes / 10);
    expect(JSON.stringify(second)).not.toContain("长期约定");
    const third = buildCreationAgentRunInput({
        ...base,
        conversation: {
            messages: [old, fresh],
            agentRuns: [{ id: "next", creationContextMessageIds: ["old", "fresh"] }],
        },
    } as any);
    expect(third.creationContext).toBeUndefined();
    console.info(`ordinary context request bytes: initial=${firstBytes}, delta=${secondBytes}, confirmed=${new TextEncoder().encode(JSON.stringify(third)).length}`);
});

test("历史素材不占用本轮上传名额，新上传只携带用户本轮选择", () => {
    const conversation = { messages: [message("ref", { role: "user", attachments: [{ name: "旧图", type: "image/png", storageKey: "resource:old" }] as any })] };
    const attachments = [{ storageKey: "resource:new", name: "本轮新图", type: "image/png" }];
    const input = buildCreationAgentRunInput({ ...base, conversation, attachments });
    expect(input.attachmentMode).toBe("replace");
    expect(input.attachments?.map((item) => item.resourceId)).toEqual(["new"]);
});
