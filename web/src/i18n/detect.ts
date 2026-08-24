import type { LocaleName } from "@/stores/use-locale-store";

/**
 * 首次访问的语言猜测：只看 navigator.languages 的语言主子标签。
 * 中文一律归到 zh-CN（不区分地区变体），英文归到 en；其余回落 zh-CN（源语言）。
 * 只在 locale store 为空时调用一次——猜测结果会立即写回 store，之后以用户显式选择为准。
 */
export function detectLocale(): LocaleName {
    // 非浏览器环境（bun test / SSR）没有 navigator，直接回落源语言
    if (typeof navigator === "undefined") return "zh-CN";
    const candidates = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const tag of candidates) {
        const lower = (tag || "").toLowerCase();
        if (lower.startsWith("zh")) return "zh-CN";
        if (lower.startsWith("en")) return "en";
    }
    return "zh-CN";
}
