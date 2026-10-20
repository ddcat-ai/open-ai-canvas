export function appendAgentPromptPrefill(current: string, prefill: string) {
    if (!prefill.trim()) return current;
    if (!current.trim()) return prefill;

    // 追加到末尾，用空格分隔而非换行，保持在同一段落中
    const separator = current.endsWith(" ") ? "" : " ";
    return `${current}${separator}${prefill.trim()}`;
}

export function appendAgentPromptMentions(current: string, incoming: string): string {
    const existing = new Set(current.match(/@\[[^\]]+\]/g) ?? []);
    const additions = (incoming.match(/@\[[^\]]+\]/g) ?? []).filter((token) => {
        if (existing.has(token)) return false;
        existing.add(token);
        return true;
    });
    if (!additions.length) return current;
    const separator = current && !/\s$/.test(current) ? " " : "";
    return `${current}${separator}${additions.join(" ")} `;
}
