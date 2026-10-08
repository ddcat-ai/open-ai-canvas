import { describe, expect, it } from "bun:test";
import { appendAgentPromptPrefill } from "@/lib/canvas/agent-prompt-prefill";

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
});
