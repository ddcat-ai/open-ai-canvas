import { expect, test } from "bun:test";
import { buildCreationAgentRunInput } from "../src/pages/create/creation-agent-request";
import type { CreationMessage } from "../src/pages/create/creation-types";

const base = { prompt: "继续把刚才那张图做成视频", idempotencyKey: "direct-context-test", permissionMode: "request_approval" as const, textSelection: { channelId: "text-channel", channelModelKey: "text-model" } };
const message = (id: string, value: Partial<CreationMessage>): CreationMessage => ({ id, role: "assistant", content: "", mode: "image", createdAt: "2026-10-19T10:00:00Z", ...value });

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
        { role: "user", mode: "image", content: "画一只猫" },
        { role: "assistant", mode: "image", taskIds: ["image-task"] },
        { role: "assistant", mode: "video", taskIds: ["video-task"] },
    ]);
    expect(JSON.stringify(input)).not.toContain("signed.example");
    expect(JSON.stringify(input)).not.toContain("forged");
    expect(input.prompt).toBe(base.prompt);
    expect(input.permissionMode).toBe(base.permissionMode);
});

test("普通模式历史参考素材走受管追加校验，显式替换不恢复旧图", () => {
    const conversation = { messages: [message("reference", { role: "user", content: "照着产品图生成", attachments: [{ id: "reference", name: "产品图", type: "image/png", storageKey: "resource:owned", previewUrl: "blob:local" }] as any })] };
    const input = buildCreationAgentRunInput({ ...base, conversation, attachmentMode: "inherit" } as any);
    expect(input.attachmentMode).toBe("append");
    expect(input.attachments).toEqual([{ resourceId: "owned", storageKey: "resource:owned", name: "产品图", kind: "image", role: "reference" }]);
    expect(buildCreationAgentRunInput({ ...base, conversation, attachmentMode: "replace", attachments: [] } as any).attachments).toEqual([]);
});

test("上下文限制在最近20条和12000字符，重试不重复注入历史", () => {
    const conversation = { messages: Array.from({ length: 30 }, (_, i) => message(String(i), { role: "user", content: String(i) + "长".repeat(2000) })) };
    const input = buildCreationAgentRunInput({ ...base, conversation } as any) as any;
    expect(input.creationContext.length).toBeLessThanOrEqual(20);
    expect(input.creationContext.reduce((n: number, m: any) => n + (m.content?.length || 0), 0)).toBeLessThanOrEqual(12000);
    expect(input.creationContext.at(-1).content.startsWith("29")).toBe(true);
    expect((buildCreationAgentRunInput({ ...base, conversation, retry: { runId: "run-one" } } as any) as any).creationContext).toBeUndefined();
});

test("历史参考只补剩余名额，当前选择和已有Agent素材优先", () => {
    const conversation = { messages: [message("ref", { role: "user", attachments: [{ name: "旧图", type: "image/png", storageKey: "resource:old" }] as any })] };
    const inheritedAttachments = Array.from({ length: 15 }, (_, i) => ({ storageKey: `resource:prior-${i}`, resourceId: `prior-${i}`, kind: "image", name: "已有素材", role: "reference" }));
    const attachments = [{ storageKey: "resource:new", name: "本轮新图", type: "image/png" }];
    const input = buildCreationAgentRunInput({ ...base, conversation, attachments, inheritedAttachments, attachmentMode: "append" } as any);
    expect(input.attachments?.map((item) => item.resourceId)).toEqual(["new"]);
});
