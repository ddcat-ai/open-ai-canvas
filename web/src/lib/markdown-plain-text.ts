// 把 Markdown 消息压成一行纯文本，用于历史列表预览和标题：
// 去掉记号本身（##、**、[]() 等），保留可读内容；围栏代码块整体替换为占位词。
export function markdownPlainText(value: string, codePlaceholder = "代码块") {
    return value
        .replace(/```[\s\S]*?(?:```|$)/gu, ` ${codePlaceholder} `)
        .replace(/^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/gmu, " ")
        .replace(/`([^`]*)`/gu, "$1")
        .replace(/!\[([^\]]*)\]\(([^)]*)\)/gu, (_, alt: string, url: string) => ` ${alt || url} `)
        .replace(/\[([^\]]*)\]\(([^)]*)\)/gu, "$1")
        .replace(/^\s{0,3}#{1,6}\s+/gmu, "")
        .replace(/^\s{0,3}>\s?/gmu, "")
        .replace(/^\s{0,3}(?:[-*_]\s*){3,}$/gmu, " ")
        .replace(/^\s*[-*+]\s+/gmu, "")
        .replace(/^\s*\d+[.)]\s+/gmu, "")
        .replace(/(\*\*|__)(.*?)\1/gu, "$2")
        .replace(/~~(.*?)~~/gu, "$1")
        .replace(/(^|\W)(\*|_)(?=\S)([\s\S]*?\S)\2(?=\W|$)/gu, "$1$3")
        .replace(/<[^>]+>/gu, " ")
        .replace(/\|/gu, " ")
        .replace(/\s+/gu, " ")
        .trim();
}
