import { describe, expect, it } from "bun:test";
import { appendAgentPromptPrefill, resolveAgentPromptPrefill } from "@/lib/canvas/agent-prompt-prefill";

describe("Agent prompt node prefill", () => {
    it("preserves a long composer draft and appends the node reference with space separator", () => {
        const draft = "请继续按下面的拍摄方案调整画面。".repeat(20).trimEnd();
        const reference = "@[node:image-reference-123] ";

        expect(appendAgentPromptPrefill(draft, reference)).toBe(`${draft} @[node:image-reference-123]`);
    });

    it("uses the prefill directly when the composer is empty", () => {
        expect(appendAgentPromptPrefill("", "@[node:text-reference-123] ")).toBe("@[node:text-reference-123] ");
    });

    it("appends with single space separator, no forced line breaks", () => {
        expect(appendAgentPromptPrefill("已有要求", "@[node:text-reference-123] ")).toBe("已有要求 @[node:text-reference-123]");
        expect(appendAgentPromptPrefill("已有要求 ", "@[node:text-reference-123] ")).toBe("已有要求 @[node:text-reference-123]");
    });

    it("keeps the selected shot when a user adds requirements and drops hidden text when the draft is replaced", () => {
        const prefill = { text: "读取节点script-1、镜头row-1后修改", displayText: "讨论镜头 1", target: { canvasId: "canvas" } };
        expect(resolveAgentPromptPrefill("讨论镜头 1，把对白缩短", prefill)).toMatchObject({ text: "读取节点script-1、镜头row-1后修改，把对白缩短", displayText: "讨论镜头 1，把对白缩短", target: prefill.target });
        expect(resolveAgentPromptPrefill("讨论镜头 10", prefill)).toBeNull();
        expect(resolveAgentPromptPrefill("重新讨论另一个问题", prefill)).toBeNull();
    });
});
