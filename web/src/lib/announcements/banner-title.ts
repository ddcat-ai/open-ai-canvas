/**
 * 首页常驻通知条的标题样式模型。
 *
 * 标题按「样式分段」存储：每段是一串连续文本加可选的字号 / 字重 / 字体 / 颜色覆盖。
 * 后端只接受这里的白名单取值（字号 10-20、字重 400/500/600/700、字体 sans|serif|mono、颜色 #RRGGBB），
 * 所以通知条渲染时不会出现任意 CSS 值。
 */

export type BannerTitleFontFamilyKey = "sans" | "serif" | "mono";

export type BannerTitleRun = {
    text: string;
    fontSize?: number;
    fontWeight?: number;
    fontFamily?: BannerTitleFontFamilyKey;
    color?: string;
};

export const BANNER_TITLE_MAX_CHARS = 120;

export const BANNER_TITLE_MIN_FONT_SIZE = 10;
export const BANNER_TITLE_MAX_FONT_SIZE = 20;

/** 通知条标题默认字号，与前台 `text-xs` 一致。 */
export const BANNER_TITLE_DEFAULT_FONT_SIZE = 12;
/** 通知条标题默认字重，与前台 `font-semibold` 一致。 */
export const BANNER_TITLE_DEFAULT_FONT_WEIGHT = 600;

export const BANNER_TITLE_FONT_SIZES = [10, 11, 12, 13, 14, 15, 16, 18, 20];

export const BANNER_TITLE_FONT_WEIGHTS = [
    { value: 400, label: "常规" },
    { value: 500, label: "中等" },
    { value: 600, label: "半粗" },
    { value: 700, label: "粗体" },
];

export const BANNER_TITLE_FONT_FAMILIES: { key: BannerTitleFontFamilyKey; label: string; css: string }[] = [
    { key: "sans", label: "默认", css: "" },
    { key: "serif", label: "衬线", css: 'Georgia, "Songti SC", "SimSun", serif' },
    { key: "mono", label: "等宽", css: "var(--font-mono)" },
];

export function bannerTitleFontFamilyCSS(key?: BannerTitleFontFamilyKey) {
    if (!key) return "";
    return BANNER_TITLE_FONT_FAMILIES.find((item) => item.key === key)?.css || "";
}

/** 由 CSS 值反查字体档位；未知字体返回空，调用方按未设置处理。 */
export function bannerTitleFontFamilyKey(css?: string) {
    const value = (css || "").trim();
    if (!value) return "" as const;
    return BANNER_TITLE_FONT_FAMILIES.find((item) => item.css === value)?.key || ("" as const);
}

/** 清洗单个分段：非法取值一律丢弃，不调用方兜底。 */
export function normalizeBannerTitleRun(run: BannerTitleRun): BannerTitleRun | null {
    const text = typeof run.text === "string" ? run.text : "";
    if (!text) return null;
    const normalized: BannerTitleRun = { text };
    const size = Number.isInteger(run.fontSize) ? (run.fontSize as number) : undefined;
    if (size && size >= BANNER_TITLE_MIN_FONT_SIZE && size <= BANNER_TITLE_MAX_FONT_SIZE) normalized.fontSize = size;
    const weight = BANNER_TITLE_FONT_WEIGHTS.find((item) => item.value === run.fontWeight)?.value;
    if (weight) normalized.fontWeight = weight;
    const family = BANNER_TITLE_FONT_FAMILIES.find((item) => item.key === run.fontFamily)?.key;
    if (family && family !== "sans") normalized.fontFamily = family;
    const color = normalizeBannerTitleHex(run.color);
    if (color) normalized.color = color;
    return normalized;
}

/** 清洗整段标题并合并相邻同样式分段，与后端 normalizeBannerTitleRuns 保持同一套规则。 */
export function normalizeBannerTitleRuns(runs?: BannerTitleRun[] | null): BannerTitleRun[] {
    const normalized: BannerTitleRun[] = [];
    for (const run of runs || []) {
        const next = normalizeBannerTitleRun(run);
        if (!next) continue;
        const previous = normalized[normalized.length - 1];
        if (previous && sameBannerTitleRunStyle(previous, next)) {
            previous.text += next.text;
            continue;
        }
        normalized.push(next);
    }
    return normalized;
}

export function sameBannerTitleRunStyle(left: BannerTitleRun, right: BannerTitleRun) {
    return left.fontSize === right.fontSize && left.fontWeight === right.fontWeight && left.fontFamily === right.fontFamily && left.color === right.color;
}

export function bannerTitlePlainText(runs?: BannerTitleRun[] | null) {
    return (runs || []).map((run) => run.text).join("");
}

/** 按码点计数，与后端 utf8.RuneCountInString 一致（emoji 等代理对按 1 个字符算）。 */
export function bannerTitleCharCount(runs?: BannerTitleRun[] | null) {
    return Array.from(bannerTitlePlainText(runs)).length;
}

export function normalizeBannerTitleHex(value?: string) {
    const raw = (value || "").trim().toUpperCase();
    if (!raw) return "";
    const hex = raw.startsWith("#") ? raw.slice(1) : raw;
    if (/^[0-9A-F]{3}$/.test(hex)) {
        return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
    }
    return /^[0-9A-F]{6}$/.test(hex) ? `#${hex}` : "";
}

/** 分段对应的内联样式；未设置的维度交给外层类名（通知条默认白色文字、12px）。 */
export function bannerTitleRunStyle(run: BannerTitleRun) {
    const style: Record<string, string | number> = {};
    if (run.fontSize) {
        style.fontSize = `${run.fontSize}px`;
    }
    if (run.fontWeight) style.fontWeight = run.fontWeight;
    const family = bannerTitleFontFamilyCSS(run.fontFamily);
    if (family) style.fontFamily = family;
    if (run.color) style.color = run.color;
    return style;
}

/** 解析 #RGB / #RRGGBB / rgb() 为 0-255 三元组；无法解析时返回 null。 */
export function parseBannerTitleColor(value?: string): [number, number, number] | null {
    const raw = (value || "").trim();
    if (!raw) return null;
    const hex = normalizeBannerTitleHex(raw);
    if (hex) {
        return [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16)];
    }
    const rgb = raw.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
    if (!rgb) return null;
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
}

/** WCAG 对比度；任一颜色无法解析时返回 null。 */
export function bannerTitleContrastRatio(foreground?: string, background?: string) {
    const front = parseBannerTitleColor(foreground);
    const back = parseBannerTitleColor(background);
    if (!front || !back) return null;
    const frontLuminance = relativeLuminance(front);
    const backLuminance = relativeLuminance(back);
    const lighter = Math.max(frontLuminance, backLuminance);
    const darker = Math.min(frontLuminance, backLuminance);
    return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance([red, green, blue]: [number, number, number]) {
    const channels = [red, green, blue].map((channel) => {
        const value = channel / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** 返回该主题下对比度不足 4.5:1 的文字颜色（去重），用于编辑时的可读性提示。 */
export function lowContrastBannerTitleColors(runs: BannerTitleRun[] | null | undefined, background: string) {
    if (!background) return [];
    const failing = new Set<string>();
    for (const run of runs || []) {
        if (!run.color) continue;
        const ratio = bannerTitleContrastRatio(run.color, background);
        if (ratio !== null && ratio < 4.5) failing.add(run.color);
    }
    return Array.from(failing);
}
