import { describe, expect, test } from "bun:test";

import { grokImagePromptLimitError } from "../src/lib/grok-image-prompt-limit";

describe("grokImagePromptLimitError", () => {
    test("按完整提示词的 UTF-8 字节数阻止超限请求且不改写原文", () => {
        const prompt = "中".repeat(4001);

        const error = grokImagePromptLimitError(prompt, "grok-image", "grok-imagine-image-quality");

        expect(error).toContain("12003 UTF-8 字节");
        expect(error).toContain("8000");
        expect(error).toContain("系统不会自动删改");
        expect(error).toContain("连线文本");
        expect(prompt).toBe("中".repeat(4001));
    });

    test("不限制其他图片协议、Grok Lite 或未超限的 Quality 提示词", () => {
        expect(grokImagePromptLimitError("中".repeat(4001), "openai-image", "grok-imagine-image-quality")).toBeNull();
        expect(grokImagePromptLimitError("中".repeat(4001), "grok-image", "grok-imagine-image")).toBeNull();
        expect(grokImagePromptLimitError("中".repeat(2000), "grok-image", "grok-imagine-image-quality")).toBeNull();
    });
});
