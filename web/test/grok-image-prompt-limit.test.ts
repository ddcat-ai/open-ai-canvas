import { describe, expect, test } from "bun:test";

import { grokImagePromptLimitError } from "../src/lib/grok-image-prompt-limit";

describe("grokImagePromptLimitError", () => {
    test("按完整提示词的 UTF-8 字节数阻止超限请求且不改写原文", () => {
        const prompt = "中".repeat(4001);

        const error = grokImagePromptLimitError(prompt, "grok-image", "grok-imagine-image-quality");

        // i18n 迁移后，测试环境未初始化 i18next，t() 返回 key 字符串；断言锚定稳定 key 前缀
        expect(error).toContain("lib:");
        expect(error).toContain("the-full-grok-image-prompt");
        expect(prompt).toBe("中".repeat(4001));
    });

    test("不限制其他图片协议、Grok Lite 或未超限的 Quality 提示词", () => {
        expect(grokImagePromptLimitError("中".repeat(4001), "openai-image", "grok-imagine-image-quality")).toBeNull();
        expect(grokImagePromptLimitError("中".repeat(4001), "grok-image", "grok-imagine-image")).toBeNull();
        expect(grokImagePromptLimitError("中".repeat(2000), "grok-image", "grok-imagine-image-quality")).toBeNull();
    });
});
