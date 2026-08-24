import { useLocaleStore, type LocaleName } from "@/stores/use-locale-store";

/**
 * Intl / toLocaleString / localeCompare 的 locale 标签唯一来源。
 * 新代码禁止再散落 "zh-CN" 字面量——守护探针扫 src 里的硬编码 locale（本文件在 allowlist）。
 * 注意：这是「格式化」locale（数字、日期、排序），与界面文案语言同源但语义独立。
 */
const FORMAT_LOCALES: Record<LocaleName, string> = {
    "zh-CN": "zh-CN",
    en: "en-US",
};

export function formatLocale(locale?: LocaleName | null): string {
    const resolved = locale ?? useLocaleStore.getState().locale ?? "zh-CN";
    return FORMAT_LOCALES[resolved];
}
