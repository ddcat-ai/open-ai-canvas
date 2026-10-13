import { createHash } from "node:crypto";

/** 原文变更必须重新确认译文，不能只按 id 套用已过期的中文。 */
export function localizeInspirationEntries(entries, translations) {
    return entries.map(({ promptZh, ...entry }) => {
        const translation = translations[entry.id];
        const sourceHash = createHash("sha256").update(entry.prompt).digest("hex");
        if (!translation || translation.sourceHash !== sourceHash) {
            throw new Error(`灵感缺少匹配当前原文的中文正文：${entry.id}。请更新 scripts/data/inspiration-prompts-zh.json 后再导入。`);
        }
        const prompt = translation.prompt?.trim();
        if (!prompt || !/[㐀-䶿一-鿿]/.test(prompt)) throw new Error(`灵感中文正文无效：${entry.id}`);
        return {
            ...entry,
            ...(translation?.title ? { title: translation.title } : {}),
            ...(translation?.description ? { description: translation.description } : {}),
            prompt,
        };
    });
}
