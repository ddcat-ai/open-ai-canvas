const GROK_IMAGE_PROMPT_MAX_BYTES = 8000;

export function grokImagePromptLimitError(prompt: string, interfaceType?: string, model?: string) {
    const modelName = model?.trim().toLowerCase().replace(/^models\//, "");
    if (interfaceType !== "grok-image" || modelName !== "grok-imagine-image-quality") return null;
    const promptBytes = new TextEncoder().encode(prompt).byteLength;
    if (promptBytes <= GROK_IMAGE_PROMPT_MAX_BYTES) return null;
    return `Grok 图片完整提示词为 ${promptBytes} UTF-8 字节，超过上游 ${GROK_IMAGE_PROMPT_MAX_BYTES} 字节限制。完整提示词包含当前输入及自动展开的连线文本、角色卡、画风和模板；系统不会自动删改，请回到相应节点精简后重试。`;
}
