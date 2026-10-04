export function appendAgentPromptPrefill(current: string, prefill: string) {
    if (!prefill.trim()) return current;
    if (!current.trim()) return prefill;

    // 追加到末尾，用空格分隔而非换行，保持在同一段落中
    const separator = current.endsWith(" ") ? "" : " ";
    return `${current}${separator}${prefill.trim()}`;
}
