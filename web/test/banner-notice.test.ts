import { describe, expect, test } from "bun:test";

import {
    BANNER_NOTICE_DEFAULT_TYPE,
    BANNER_NOTICE_EMOJI_GROUPS,
    BANNER_NOTICE_EMOJIS,
    BANNER_NOTICE_TYPE_VALUES,
    BANNER_NOTICE_TYPES,
    bannerNoticeSurfaceCSS,
    bannerNoticeTypeLabel,
    normalizeBannerNoticeType,
    searchBannerNoticeEmojis,
} from "@/lib/announcements/banner-notice";
import { bannerTitleContrastRatio } from "@/lib/announcements/banner-title";

async function readSource(relativePath: string) {
    return Bun.file(new URL(relativePath, import.meta.url)).text();
}

/** 从 Go 的 `var X = map[string]struct{}{...}` 字面量里取出键集合。 */
function goMapKeys(source: string, variable: string) {
    const start = source.indexOf(`var ${variable} = map[string]struct{}{`);
    if (start < 0) throw new Error(`未找到 ${variable}`);
    const end = source.indexOf("\n}", start);
    if (end < 0) throw new Error(`${variable} 字面量未闭合`);
    const body = source.slice(start, end);
    return Array.from(body.matchAll(/"([a-z0-9-]+)"/g)).map((match) => match[1]);
}

describe("通知类型", () => {
    test("未知或空值回落到默认类型", () => {
        expect(normalizeBannerNoticeType(undefined)).toBe(BANNER_NOTICE_DEFAULT_TYPE);
        expect(normalizeBannerNoticeType("")).toBe(BANNER_NOTICE_DEFAULT_TYPE);
        expect(normalizeBannerNoticeType("rainbow")).toBe(BANNER_NOTICE_DEFAULT_TYPE);
        expect(normalizeBannerNoticeType(" ACTIVITY ")).toBe("activity");
    });

    test("每种类型都有中文名与独立的底色 token", () => {
        const vars = BANNER_NOTICE_TYPES.map((item) => item.surfaceVar);
        expect(new Set(vars).size).toBe(vars.length);
        for (const type of BANNER_NOTICE_TYPES) {
            expect(bannerNoticeTypeLabel(type.key)).toBe(type.label);
            expect(bannerNoticeSurfaceCSS(type.key)).toBe(`var(${type.surfaceVar})`);
        }
        // 未知类型也必须拿到可用底色，不能渲染成透明条。
        expect(bannerNoticeSurfaceCSS("rainbow")).toBe(bannerNoticeSurfaceCSS(BANNER_NOTICE_DEFAULT_TYPE));
    });
});

describe("emoji 图标素材库", () => {
    test("字符唯一、非空，每个素材都有中文名", () => {
        const chars = BANNER_NOTICE_EMOJIS.map((item) => item.char);
        expect(new Set(chars).size).toBe(chars.length);
        expect(chars.length).toBeGreaterThanOrEqual(50);
        for (const item of BANNER_NOTICE_EMOJIS) {
            expect(item.char.trim().length).toBeGreaterThan(0);
            expect(item.label.trim().length).toBeGreaterThan(0);
            expect(item.groupLabel.trim().length).toBeGreaterThan(0);
        }
    });

    test("用户点名的素材必须在库内", () => {
        for (const char of ["💰", "🚀", "🔥", "📢"]) {
            expect(BANNER_NOTICE_EMOJIS.some((item) => item.char === char)).toBe(true);
        }
    });

    test("搜索同时匹配中文名、分组名与字符本身", () => {
        expect(searchBannerNoticeEmojis("火箭").map((item) => item.char)).toContain("🚀");
        expect(searchBannerNoticeEmojis("钱袋").map((item) => item.char)).toContain("💰");
        // 分组名搜索命中整组。
        const statusHits = searchBannerNoticeEmojis("状态");
        expect(statusHits.length).toBeGreaterThanOrEqual(BANNER_NOTICE_EMOJI_GROUPS.find((g) => g.key === "status")!.emoji.length);
        // 字符本身也能搜到（支持从别处粘贴检索）。
        expect(searchBannerNoticeEmojis("🔥").map((item) => item.char)).toContain("🔥");
        expect(searchBannerNoticeEmojis("  ").length).toBe(BANNER_NOTICE_EMOJIS.length);
        expect(searchBannerNoticeEmojis("不存在的素材")).toEqual([]);
    });

    test("emoji 是普通文本：标题纯文本拼接函数必须原样保留它", async () => {
        // 防止未来有人给 run.text 做字符过滤，把 emoji 丢掉。
        const { bannerTitlePlainText } = await import("@/lib/announcements/banner-title");
        const runs = [
            { text: "🔥", fontSize: 20 },
            { text: "限时", color: "#FFE58F" },
            { text: "大促" },
        ];
        expect(bannerTitlePlainText(runs as never)).toBe("🔥限时大促");
    });
});

describe("与后端白名单保持一致", () => {
    test("通知类型的后端白名单逐项等于前端注册表", async () => {
        const goSource = await readSource("../../backend/internal/app/announcement.go");
        expect(new Set(goMapKeys(goSource, "bannerNoticeTypes"))).toEqual(new Set(BANNER_NOTICE_TYPE_VALUES));
    });

    test("后端默认值常量与前端一致", async () => {
        const goSource = await readSource("../../backend/internal/app/announcement.go");
        expect(goSource).toContain(`bannerNoticeDefaultType = "${BANNER_NOTICE_DEFAULT_TYPE}"`);
    });

    test("后端不保存独立图标字段：emoji 必须内嵌在标题分段里", async () => {
        const [goModel, goApp, goRepo] = await Promise.all([
            readSource("../../backend/internal/model/models_project.go"),
            readSource("../../backend/internal/app/announcement.go"),
            readSource("../../backend/internal/repository/announcement.go"),
        ]);
        // 防止 icon 字段被加回来却没人维护白名单：图标的存储形态就是 TitleRuns 的文本。
        expect(goModel).not.toMatch(/\bIcon\s+string/);
        expect(goApp).not.toContain("normalizeBannerIcon");
        expect(goRepo).not.toContain('"icon"');
    });
});

describe("通知条主题色", () => {
    test("四种类型在明暗两档都满足白字对比度要求", async () => {
        const css = await readSource("../src/styles/globals.css");
        const value = (token: string) => {
            const match = css.match(new RegExp(`--${token}:\\s*(#[0-9a-fA-F]{6})`));
            if (!match) throw new Error(`globals.css 缺少 --${token}`);
            return match[1];
        };
        for (const type of BANNER_NOTICE_TYPES) {
            // 浅色档是正文级底色，必须达到 WCAG AA 的 4.5:1；
            // 深色档统一压到 7:1 以上，避免暗色主题里底色过亮。
            const light = value(`palette-banner-${type.key}-500`);
            const dark = value(`palette-banner-${type.key}-700`);
            expect(bannerTitleContrastRatio("#FFFFFF", light)).toBeGreaterThanOrEqual(4.5);
            expect(bannerTitleContrastRatio("#FFFFFF", dark)).toBeGreaterThanOrEqual(7);
        }
    });

    test("前台与预览都引用按类型取值的语义 token", async () => {
        const [globals, adminUi] = await Promise.all([readSource("../src/styles/globals.css"), readSource("../src/styles/admin-ui.css")]);
        for (const type of BANNER_NOTICE_TYPES) {
            // surfaceVar 自带 `--` 前缀，拼接时不要再加一次。
            const name = type.surfaceVar.replace(/^--/, "");
            // 语义层明暗各定义一次：:root 一次、.dark 一次。
            const semantic = new RegExp(`--${name}: var\\(--palette-banner-${type.key}-\\d00\\)`, "g");
            expect(globals.match(semantic)?.length).toBe(2);
            // 后台预览强制两套底色，不受页面当前主题影响。
            expect(adminUi).toContain(`--${name}: var(--palette-banner-${type.key}-500)`);
            expect(adminUi).toContain(`--${name}: var(--palette-banner-${type.key}-700)`);
        }
    });
});
