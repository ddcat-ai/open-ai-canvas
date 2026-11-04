const PROMPT_SEPARATORS = new Set(["，", ",", "、", "；", ";", " "]);

export function promptHasPhrase(prompt: string, phrase: string) {
    return Boolean(phrase) && prompt.includes(phrase);
}

/** 描述短语开关：已包含则连同一个相邻分隔符移除，否则用中文逗号追加到末尾。 */
export function togglePromptPhrase(prompt: string, phrase: string) {
    const index = phrase ? prompt.indexOf(phrase) : -1;
    if (index >= 0) {
        let start = index;
        let end = index + phrase.length;
        if (start > 0 && PROMPT_SEPARATORS.has(prompt[start - 1])) start -= 1;
        else if (end < prompt.length && PROMPT_SEPARATORS.has(prompt[end])) end += 1;
        return `${prompt.slice(0, start)}${prompt.slice(end)}`.replace(/^[，,、；;\s]+/, "");
    }
    const trimmed = prompt.replace(/\s+$/, "");
    if (!trimmed) return phrase;
    return /[，,、；;。.!！?？\n]$/.test(trimmed) ? `${trimmed}${phrase}` : `${trimmed}，${phrase}`;
}
