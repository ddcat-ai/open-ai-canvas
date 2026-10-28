import { BUILTIN_SUPDANCE_I18N_ENTRIES } from "../locales";
import type { SupDanceI18nEntry, SupDanceLocaleCode } from "../types";

export type CompiledTemplateRule = {
    key: string;
    regex: RegExp;
    paramNames: string[];
    entry: SupDanceI18nEntry;
};

export type CompiledI18nDictionary = {
    byKey: Map<string, SupDanceI18nEntry>;
    bySourceText: Map<string, SupDanceI18nEntry>;
    templateRules: CompiledTemplateRule[];
};

type DynamicPatternRule = {
    regex: RegExp;
    format: Record<SupDanceLocaleCode, (...groups: string[]) => string>;
};

const BUILTIN_SOURCE_BY_KEY = new Map<string, string>(BUILTIN_SUPDANCE_I18N_ENTRIES.map((item) => [item.key, item.sourceText.trim()]));

const PLACEHOLDER_TOKEN_REGEX = /\{([a-zA-Z0-9_]+)\}/g;
const HAN_CHARACTER_REGEX = /[\u4e00-\u9fff]/;

const DYNAMIC_PATTERN_RULES: readonly DynamicPatternRule[] = [
    {
        regex: /^共\s*(\d+)\s*条$/,
        format: {
            "zh-CN": (total) => `共 ${total} 条`,
            "en-US": (total) => `Total ${total}`,
            "zh-TW": (total) => `共 ${total} 條`,
            "ja-JP": (total) => `全 ${total} 件`,
            "ko-KR": (total) => `총 ${total}개`,
            "es-ES": (total) => `Total ${total}`,
        },
    },
    {
        regex: /^(\d+)-(\d+)\s*\/\s*共\s*(\d+)\s*条$/,
        format: {
            "zh-CN": (start, end, total) => `${start}-${end} / 共 ${total} 条`,
            "en-US": (start, end, total) => `${start}-${end} of ${total}`,
            "zh-TW": (start, end, total) => `${start}-${end} / 共 ${total} 條`,
            "ja-JP": (start, end, total) => `${start}-${end} / 全 ${total} 件`,
            "ko-KR": (start, end, total) => `${start}-${end} / 총 ${total}개`,
            "es-ES": (start, end, total) => `${start}-${end} de ${total}`,
        },
    },
    {
        regex: /^(\d+)\s*条\/页$/,
        format: {
            "zh-CN": (size) => `${size} 条/页`,
            "en-US": (size) => `${size} / page`,
            "zh-TW": (size) => `${size} 條/頁`,
            "ja-JP": (size) => `${size} 件/ページ`,
            "ko-KR": (size) => `${size}개/페이지`,
            "es-ES": (size) => `${size} / pág.`,
        },
    },
    {
        regex: /^(\d+)\s*位已启用$/,
        format: {
            "zh-CN": (count) => `${count} 位已启用`,
            "en-US": (count) => `${count} users enabled`,
            "zh-TW": (count) => `${count} 位已啟用`,
            "ja-JP": (count) => `${count} 名が有効化`,
            "ko-KR": (count) => `${count}명 활성화됨`,
            "es-ES": (count) => `${count} usuarios activos`,
        },
    },
    {
        regex: /^已选择\s*(\d+)\s*项$/,
        format: {
            "zh-CN": (count) => `已选择 ${count} 项`,
            "en-US": (count) => `${count} selected`,
            "zh-TW": (count) => `已選擇 ${count} 項`,
            "ja-JP": (count) => `${count} 件を選択中`,
            "ko-KR": (count) => `${count}개 선택됨`,
            "es-ES": (count) => `${count} seleccionados`,
        },
    },
    {
        regex: /^打开积分中心，可用\s*([\d,.+-]+|--)\s*积分$/,
        format: {
            "zh-CN": (bal) => `打开积分中心，可用 ${bal} 积分`,
            "en-US": (bal) => `Open Credits Center, ${bal} available`,
            "zh-TW": (bal) => `打開積分中心，可用 ${bal} 積分`,
            "ja-JP": (bal) => `クレジットセンターを開く（利用可能: ${bal}）`,
            "ko-KR": (bal) => `크레딧 센터 열기 (사용 가능: ${bal})`,
            "es-ES": (bal) => `Abrir centro de créditos, ${bal} disponibles`,
        },
    },
];

function escapeRegexLiteral(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildTemplateRule(patternText: string, entry: SupDanceI18nEntry): CompiledTemplateRule | null {
    if (!patternText.includes("{")) return null;
    const paramNames: string[] = [];
    let lastIndex = 0;
    let regexBody = "";
    let match: RegExpExecArray | null;
    const tokenRegex = new RegExp(PLACEHOLDER_TOKEN_REGEX.source, "g");

    while ((match = tokenRegex.exec(patternText)) !== null) {
        const literalSlice = patternText.slice(lastIndex, match.index);
        // Allow flexible whitespace around placeholders when literal has spaces
        regexBody += escapeRegexLiteral(literalSlice).replace(/\s+/g, "\\s*");
        paramNames.push(match[1]!);
        regexBody += "(.+?)";
        lastIndex = match.index + match[0].length;
    }

    if (paramNames.length === 0) return null;
    const trailingLiteral = patternText.slice(lastIndex);
    regexBody += escapeRegexLiteral(trailingLiteral).replace(/\s+/g, "\\s*");

    // Avoid degenerate pattern that is purely `{x}` with no literal anchor
    const strippedLiterals = patternText.replace(PLACEHOLDER_TOKEN_REGEX, "").trim();
    if (!strippedLiterals) return null;

    try {
        return {
            key: entry.key,
            regex: new RegExp(`^${regexBody}$`),
            paramNames,
            entry,
        };
    } catch {
        return null;
    }
}

export function compileI18nDictionary(entries: readonly SupDanceI18nEntry[]): CompiledI18nDictionary {
    const byKey = new Map<string, SupDanceI18nEntry>();
    const bySourceText = new Map<string, SupDanceI18nEntry>();
    const templateRules: CompiledTemplateRule[] = [];
    const seenTemplatePatterns = new Set<string>();

    for (const entry of entries) {
        byKey.set(entry.key, entry);

        const builtinOriginal = BUILTIN_SOURCE_BY_KEY.get(entry.key);
        if (builtinOriginal) {
            bySourceText.set(builtinOriginal, entry);
        }

        const source = entry.sourceText.trim();
        if (source) {
            bySourceText.set(source, entry);
        }

        const zhCN = entry.translations["zh-CN"]?.trim();
        if (zhCN && !bySourceText.has(zhCN)) {
            bySourceText.set(zhCN, entry);
        }

        for (const candidatePattern of [builtinOriginal, source, zhCN]) {
            if (!candidatePattern || seenTemplatePatterns.has(`${entry.key}::${candidatePattern}`)) continue;
            const rule = buildTemplateRule(candidatePattern, entry);
            if (rule) {
                seenTemplatePatterns.add(`${entry.key}::${candidatePattern}`);
                templateRules.push(rule);
            }
        }
    }

    return { byKey, bySourceText, templateRules };
}

export function interpolateTemplate(template: string, vars?: Record<string, string | number>): string {
    if (!vars) return template;
    return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (full, key: string) => {
        const value = vars[key];
        return value === undefined || value === null ? full : String(value);
    });
}

export function resolveEntryTranslation(entry: SupDanceI18nEntry, locale: SupDanceLocaleCode, fallbackLocale: SupDanceLocaleCode = "zh-CN"): string {
    const direct = entry.translations[locale]?.trim();
    if (direct) return direct;
    const fallback = entry.translations[fallbackLocale]?.trim();
    if (fallback) return fallback;
    const zh = entry.translations["zh-CN"]?.trim();
    if (zh) return zh;
    return entry.sourceText;
}

export function translateByKey(dictionary: CompiledI18nDictionary, key: string, locale: SupDanceLocaleCode, fallbackLocale: SupDanceLocaleCode = "zh-CN", vars?: Record<string, string | number>, fallbackText?: string): string {
    const entry = dictionary.byKey.get(key);
    if (!entry) {
        return interpolateTemplate(fallbackText ?? key, vars);
    }
    const resolved = resolveEntryTranslation(entry, locale, fallbackLocale);
    return interpolateTemplate(resolved, vars);
}

export function translateSourceText(dictionary: CompiledI18nDictionary, rawText: string, locale: SupDanceLocaleCode, fallbackLocale: SupDanceLocaleCode = "zh-CN"): string | null {
    if (!rawText) return null;
    const match = rawText.match(/^(\s*)([\s\S]*?)(\s*)$/);
    if (!match) return null;
    const [, leading, core, trailing] = match;
    if (!core) return null;

    const exact = dictionary.bySourceText.get(core);
    if (exact) {
        const translated = resolveEntryTranslation(exact, locale, fallbackLocale);
        return `${leading}${translated}${trailing}`;
    }

    if (dictionary.templateRules?.length) {
        for (const rule of dictionary.templateRules) {
            const groups = core.match(rule.regex);
            if (groups) {
                const vars: Record<string, string> = {};
                for (let i = 0; i < rule.paramNames.length; i++) {
                    const paramName = rule.paramNames[i];
                    if (paramName) {
                        vars[paramName] = (groups[i + 1] ?? "").trim();
                    }
                }
                const resolvedTemplate = resolveEntryTranslation(rule.entry, locale, fallbackLocale);
                const interpolated = interpolateTemplate(resolvedTemplate, vars);
                return `${leading}${interpolated}${trailing}`;
            }
        }
    }

    for (const rule of DYNAMIC_PATTERN_RULES) {
        const groups = core.match(rule.regex);
        if (groups) {
            const formatter = rule.format[locale] || rule.format[fallbackLocale] || rule.format["zh-CN"];
            return `${leading}${formatter(...groups.slice(1))}${trailing}`;
        }
    }

    return null;
}

export function isCandidateUntranslatedChinese(rawText: string): boolean {
    const trimmed = rawText.trim();
    if (trimmed.length < 2 || trimmed.length > 64) return false;
    if (!HAN_CHARACTER_REGEX.test(trimmed)) return false;
    if (/^https?:\/\//i.test(trimmed)) return false;
    if (/^[{[\]<>/\\]+/.test(trimmed)) return false;
    return true;
}
