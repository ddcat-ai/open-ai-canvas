export const OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH = 64;

export function clampOpenAIPromptCacheKey(value?: string) {
    const key = value?.trim();
    if (!key) return undefined;
    return Array.from(key).slice(0, OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH).join("");
}

export function canvasAgentPromptCacheKey(sessionId: string) {
    const value = sessionId.trim();
    return value ? clampOpenAIPromptCacheKey(`canvas-agent:${value}`) : undefined;
}

export function withOpenAIPromptCacheKey<T extends Record<string, unknown>>(body: T, value?: string): T & { prompt_cache_key?: string } {
    const key = clampOpenAIPromptCacheKey(value);
    return key ? { ...body, prompt_cache_key: key } : body;
}
