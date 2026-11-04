import { afterEach, describe, expect, test } from "bun:test";

import { i18n } from "@/i18n";
import { AREA_CATALOGS } from "@/i18n/areas";
import { detectBrowserLocale, matchAppLocale, SUPPORTED_LOCALES } from "@/i18n/locales";
import { deDE } from "@/i18n/messages/de-DE";
import { enUS } from "@/i18n/messages/en-US";
import { frFR } from "@/i18n/messages/fr-FR";
import { jaJP } from "@/i18n/messages/ja-JP";
import { koKR } from "@/i18n/messages/ko-KR";
import { zhCN } from "@/i18n/messages/zh-CN";
import { formatRelativeTime } from "@/lib/relative-time";
import { localizedApiErrorMessage } from "@/services/api/error-codes";
import { useLocaleStore } from "@/stores/use-locale-store";

function flatten(value: unknown, prefix = ""): Record<string, string> {
    if (typeof value === "string") return { [prefix]: value };
    return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>((result, [key, child]) => ({ ...result, ...flatten(child, prefix ? `${prefix}.${key}` : key) }), {});
}

const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort();

afterEach(() => useLocaleStore.getState().setLocale("zh-CN"));

describe("i18n catalogs", () => {
    const source = flatten(zhCN);
    const catalogs = { "en-US": enUS, "fr-FR": frFR, "de-DE": deDE, "ja-JP": jaJP, "ko-KR": koKR };

    test("every locale is registered and has the same keys and placeholders as zh-CN", () => {
        expect(SUPPORTED_LOCALES.map((locale) => locale.code).sort()).toEqual(["de-DE", "en-US", "fr-FR", "ja-JP", "ko-KR", "zh-CN"]);
        for (const [code, catalog] of Object.entries(catalogs)) {
            const flat = flatten(catalog);
            expect(Object.keys(flat).sort(), code).toEqual(Object.keys(source).sort());
            for (const [key, text] of Object.entries(flat)) {
                expect(text.trim().length, `${code} ${key}`).toBeGreaterThan(0);
                expect(placeholders(text), `${code} ${key}`).toEqual(placeholders(source[key]));
            }
        }
    });

    test("every page-area catalog matches its zh-CN keys and placeholders in all locales", () => {
        for (const [area, catalog] of Object.entries(AREA_CATALOGS)) {
            const areaSource = flatten(catalog["zh-CN"]);
            for (const { code } of SUPPORTED_LOCALES) {
                const flat = flatten(catalog[code]);
                expect(Object.keys(flat).sort(), `${area} ${code}`).toEqual(Object.keys(areaSource).sort());
                for (const [key, text] of Object.entries(flat)) {
                    expect(text.trim().length, `${area} ${code} ${key}`).toBeGreaterThan(0);
                    expect(placeholders(text), `${area} ${code} ${key}`).toEqual(placeholders(areaSource[key]));
                }
            }
        }
    });

    test("page-area namespaces do not collide with core namespaces", () => {
        for (const area of Object.keys(AREA_CATALOGS)) expect(Object.keys(zhCN)).not.toContain(area);
    });

    test("browser languages map to supported locales", () => {
        expect(matchAppLocale("en")).toBe("en-US");
        expect(matchAppLocale("ja-jp")).toBe("ja-JP");
        expect(matchAppLocale("zh-TW")).toBe("zh-CN");
        expect(matchAppLocale("es-ES")).toBeUndefined();
        expect(detectBrowserLocale(["es-ES", "de-AT"])).toBe("de-DE");
        expect(detectBrowserLocale(["pt-BR"])).toBe("zh-CN");
        expect(detectBrowserLocale(undefined)).toBe("zh-CN");
    });

    test("switching locale updates i18next and rejects unsupported values", () => {
        useLocaleStore.getState().setLocale("ko-KR");
        expect(i18n.language).toBe("ko-KR");
        expect(i18n.t("nav.tools.canvas")).toBe("캔버스");
        useLocaleStore.getState().setLocale("xx-XX" as never);
        expect(useLocaleStore.getState().locale).toBe("ko-KR");
    });
});

describe("localized API errors", () => {
    test("Chinese keeps the backend message; other locales translate well-defined reasons only", () => {
        expect(localizedApiErrorMessage("rate_limited", "操作太频繁")).toBe("操作太频繁");
        useLocaleStore.getState().setLocale("en-US");
        expect(localizedApiErrorMessage("rate_limited", "操作太频繁")).toBe("Too many requests. Try again later.");
        expect(localizedApiErrorMessage("invalid_argument", "名称不能为空")).toBe("名称不能为空");
        expect(localizedApiErrorMessage(undefined, "原文")).toBe("原文");
    });

    test("relative time follows the interface language", () => {
        const now = Date.parse("2026-11-04T12:00:00Z");
        expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5 分钟前");
        useLocaleStore.getState().setLocale("en-US");
        expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5 min ago");
        expect(formatRelativeTime(undefined, now)).toBe("Unknown time");
    });
});
