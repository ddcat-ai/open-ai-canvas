import { t } from "@/i18n";
const GROK_IMAGE_PROMPT_MAX_BYTES = 8000;

export function grokImagePromptLimitError(prompt: string, interfaceType?: string, model?: string) {
    const modelName = model
        ?.trim()
        .toLowerCase()
        .replace(/^models\//, "");
    if (interfaceType !== "grok-image" || modelName !== "grok-imagine-image-quality") return null;
    const promptBytes = new TextEncoder().encode(prompt).byteLength;
    if (promptBytes <= GROK_IMAGE_PROMPT_MAX_BYTES) return null;
    return t("lib:the-full-grok-image-prompt-is-param-utf-8-bytes-exceeding-the-upstream-l", { promptBytes: promptBytes, GROK_IMAGE_PROMPT_MAX_BYTES: GROK_IMAGE_PROMPT_MAX_BYTES });
}
