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

test("历史素材保留在上下文，明确引用或换新主题都不自动变成本轮附件", () => {
    const conversation = { messages: [message("reference", { role: "user", content: "照着产品图生成", attachments: [{ id: "reference", name: "产品图", type: "image/png", storageKey: "resource:owned", previewUrl: "blob:local" }] as any })] };
    for (const prompt of [base.prompt, "生成一张无关的太空风景，不参考之前的图片"]) {
        const input = buildCreationAgentRunInput({ ...base, conversation, prompt });
        expect(input.attachmentMode).toBe("replace");
        expect(input.attachments).toEqual([]);
        expect(input.creationContext).toEqual([{ role: "user", mode: "image", content: "照着产品图生成", resourceIds: ["owned"] }]);
        expect(JSON.stringify(input)).not.toContain("resource:owned");
    }
});

test("历史素材目录只传受管媒体ID，去重并限制数量，不传图片内容或下载地址", () => {
    const attachments = Array.from({ length: 40 }, (_, i) => ({ storageKey: `resource:history-${i}`, name: "历史图", type: "image/png", previewUrl: "https://signed.example/history", dataUrl: "data:image/png;base64,private" }));
    const conversation = {
        messages: [
            message("first", { role: "user", attachments: attachments as any }),
            message("latest", { role: "user", attachments: [attachments[39], attachments[39], { storageKey: "https://signed.example/forged", type: "image/png" }, { storageKey: "resource:document", type: "application/pdf" }] as any }),
        ],
    };
    const input = buildCreationAgentRunInput({ ...base, conversation });
    const ids = input.creationContext!.flatMap((entry) => entry.resourceIds || []);
    expect(ids).toHaveLength(32);
    expect(new Set(ids).size).toBe(32);
    expect(input.creationContext!.at(-1)?.resourceIds).toEqual(["history-39"]);
    expect(input.attachments).toEqual([]);
    expect(JSON.stringify(input)).not.toContain("signed.example");
    expect(JSON.stringify(input)).not.toContain("base64");
    expect(ids).not.toContain("document");
});

test("上下文限制在最近20条和12000字符，重试不重复注入历史", () => {
    const conversation = { messages: Array.from({ length: 30 }, (_, i) => message(String(i), { role: "user", content: String(i) + "长".repeat(2000) })) };
    const input = buildCreationAgentRunInput({ ...base, conversation } as any) as any;
    expect(input.creationContext.length).toBeLessThanOrEqual(20);
    expect(input.creationContext.reduce((n: number, m: any) => n + (m.content?.length || 0), 0)).toBeLessThanOrEqual(12000);
    expect(input.creationContext.at(-1).content.startsWith("29")).toBe(true);
    expect((buildCreationAgentRunInput({ ...base, conversation, retry: { runId: "run-one" } } as any) as any).creationContext).toBeUndefined();
});

test("历史素材不占用本轮上传名额，新上传只携带用户本轮选择", () => {
    const conversation = { messages: [message("ref", { role: "user", attachments: [{ name: "旧图", type: "image/png", storageKey: "resource:old" }] as any })] };
    const attachments = [{ storageKey: "resource:new", name: "本轮新图", type: "image/png" }];
    const input = buildCreationAgentRunInput({ ...base, conversation, attachments });
    expect(input.attachmentMode).toBe("replace");
    expect(input.attachments?.map((item) => item.resourceId)).toEqual(["new"]);
});
