export function appendAgentPromptPrefill(current: string, prefill: string) {
    if (!prefill.trim()) return current;
    if (!current.trim()) return prefill;

    // 追加到末尾，用空格分隔而非换行，保持在同一段落中
    const separator = current.endsWith(" ") ? "" : " ";
    return `${current}${separator}${prefill.trim()}`;
}

/** 保留“讨论镜头”携带的对象身份；用户在预填之后补充要求时仍发送同一目标。 */
export function resolveAgentPromptPrefill<T extends { text: string; displayText?: string }>(draft: string, prefill: T | null): T | null {
    const shown = prefill?.displayText?.trim();
    const value = draft.trim();
    if (!prefill || !shown || !value.startsWith(shown)) return null;
    const suffix = value.slice(shown.length);
    // 修改了预填本身即视为普通新草稿，不能悄悄恢复用户删掉的指令。
    if (suffix && !/^[\s，。,:：;；！!？?]/u.test(suffix)) return null;
    return { ...prefill, text: `${prefill.text.trim()}${suffix}`, displayText: value };
}
