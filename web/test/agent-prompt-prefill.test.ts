import { describe, expect, it, test } from "bun:test";
import { appendAgentPromptMentions, appendAgentPromptPrefill } from "@/lib/canvas/agent-prompt-prefill";

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

test("sending another node preserves references and text", () => {
    const first = appendAgentPromptMentions("Compare", "@[node:first]");
    expect(appendAgentPromptMentions(first, "@[node:second]")).toBe("Compare @[node:first] @[node:second] ");
});

test("multi-selection appends only new references", () => {
    expect(appendAgentPromptMentions("@[node:first] ", "@[node:first] @[node:second] @[node:second]")).toBe("@[node:first] @[node:second] ");
});

test("existing references preserve whitespace exactly", () => {
    const draft = "  @[node:first]\nKeep this text\n";
    expect(appendAgentPromptMentions(draft, "@[node:first]")).toBe(draft);
});

test("removed references and submitted drafts allow re-adding", () => {
    expect(appendAgentPromptMentions("Edited draft", "@[node:first]")).toBe("Edited draft @[node:first] ");
    expect(appendAgentPromptMentions("", "@[node:first]")).toBe("@[node:first] ");
});

test("appending preserves newlines and empty input", () => {
    expect(appendAgentPromptMentions("Compare\n", "@[node:first]")).toBe("Compare\n@[node:first] ");
    expect(appendAgentPromptMentions("Draft", "")).toBe("Draft");
});
