import { describe, expect, test } from "bun:test";

import { agentPromptCacheKey, clampOpenAIPromptCacheKey, OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH, withOpenAIPromptCacheKey } from "../src/lib/openai-prompt-cache";

describe("Agent prompt cache", () => {
    test("同一会话生成稳定且隔离的缓存键", () => {
        expect(agentPromptCacheKey("session-a")).toBe("cloud-agent:session-a");
        expect(agentPromptCacheKey("session-a")).toBe(agentPromptCacheKey("session-a"));
        expect(agentPromptCacheKey("session-a")).not.toBe(agentPromptCacheKey("session-b"));
        expect(agentPromptCacheKey(" ")).toBeUndefined();
    });

    test("缓存键按 OpenAI 上限截断", () => {
        const key = clampOpenAIPromptCacheKey(`cloud-agent:${"x".repeat(100)}`);
        expect(Array.from(key || "")).toHaveLength(OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH);
    });

    test("Responses 请求体携带缓存键", () => {
        const body = withOpenAIPromptCacheKey({ model: "test-model", input: [] }, " cloud-agent:session-a ");
        expect(body.prompt_cache_key).toBe("cloud-agent:session-a");
    });

    test("空缓存键不会写入 Responses 请求体", () => {
        const body = withOpenAIPromptCacheKey({ model: "test-model", input: [] }, " ");
        expect(body).not.toHaveProperty("prompt_cache_key");
    });
});
