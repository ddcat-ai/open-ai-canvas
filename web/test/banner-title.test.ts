import { describe, expect, test } from "bun:test";

import {
    BANNER_TITLE_FONT_FAMILIES,
    bannerTitleCharCount,
    bannerTitleContrastRatio,
    bannerTitlePlainText,
    bannerTitleRunStyle,
    lowContrastBannerTitleColors,
    normalizeBannerTitleHex,
    normalizeBannerTitleRuns,
    parseBannerTitleColor,
} from "@/lib/announcements/banner-title";

describe("通知标题样式分段清洗", () => {
    test("合并相邻同样式分段，跳过空文本", () => {
        const runs = normalizeBannerTitleRuns([
            { text: "限时", fontSize: 16, color: "#FF0000" },
            { text: "活动", fontSize: 16, color: "#ff0000" },
            { text: "", fontSize: 16 },
            { text: "上线", fontSize: 20 },
        ]);
        expect(runs).toEqual([
            { text: "限时活动", fontSize: 16, color: "#FF0000" },
            { text: "上线", fontSize: 20 },
        ]);
    });

    test("丢弃白名单外的字号、字重、字体与颜色", () => {
        expect(normalizeBannerTitleRuns([{ text: "标题", fontSize: 9 }])).toEqual([{ text: "标题" }]);
        expect(normalizeBannerTitleRuns([{ text: "标题", fontSize: 21 }])).toEqual([{ text: "标题" }]);
        expect(normalizeBannerTitleRuns([{ text: "标题", fontWeight: 6000 }])).toEqual([{ text: "标题" }]);
        expect(normalizeBannerTitleRuns([{ text: "标题", fontFamily: "comic" as never }])).toEqual([{ text: "标题" }]);
        expect(normalizeBannerTitleRuns([{ text: "标题", color: "red" }])).toEqual([{ text: "标题" }]);
        expect(normalizeBannerTitleRuns([{ text: "标题", color: "#fff;background:url(x)" }])).toEqual([{ text: "标题" }]);
    });

    test("sans 视为默认字体，不写入分段", () => {
        expect(normalizeBannerTitleRuns([{ text: "标题", fontFamily: "sans" }])).toEqual([{ text: "标题" }]);
        expect(normalizeBannerTitleRuns([{ text: "标题", fontFamily: "mono" }])).toEqual([{ text: "标题", fontFamily: "mono" }]);
    });

    test("纯文本与字符数按码点统计", () => {
        const runs = [{ text: "限时" }, { text: "活动🎉" }];
        expect(bannerTitlePlainText(runs)).toBe("限时活动🎉");
        expect(bannerTitleCharCount(runs)).toBe(5);
    });
});

describe("通知标题样式输出", () => {
    test("只输出已设置的维度", () => {
        expect(bannerTitleRunStyle({ text: "标题" })).toEqual({});
        expect(bannerTitleRunStyle({ text: "标题", fontSize: 20, fontWeight: 700, color: "#FF0000" })).toEqual({
            fontSize: "20px",
            fontWeight: 700,
            color: "#FF0000",
        });
    });

    test("字体档位输出对应字体栈", () => {
        const serif = BANNER_TITLE_FONT_FAMILIES.find((item) => item.key === "serif");
        expect(bannerTitleRunStyle({ text: "标题", fontFamily: "serif" }).fontFamily).toBe(serif?.css);
    });

    test("十六进制颜色归一化", () => {
        expect(normalizeBannerTitleHex("#abc")).toBe("#AABBCC");
        expect(normalizeBannerTitleHex("5f6ae4")).toBe("#5F6AE4");
        expect(normalizeBannerTitleHex("#12345")).toBe("");
        expect(parseBannerTitleColor("rgb(95, 106, 228)")).toEqual([95, 106, 228]);
        expect(parseBannerTitleColor("not-a-color")).toBeNull();
    });
});

describe("通知标题对比度检查", () => {
    test("白字在通知条两种底色上的对比度", () => {
        expect(bannerTitleContrastRatio("#FFFFFF", "#5C67E2")).toBeCloseTo(4.67, 2);
        expect(bannerTitleContrastRatio("#FFFFFF", "#3F4590")).toBeCloseTo(8.52, 2);
        expect(bannerTitleContrastRatio("not-a-color", "#3F4590")).toBeNull();
        expect(bannerTitleContrastRatio("#FFFFFF", "")).toBeNull();
    });

    test("通知条底色 token 的白字对比度必须达到 AA（改 token 时同步更新此处）", () => {
        // globals.css 的 --palette-banner-notice-500 / -700（「公告」类型）；默认标题为白色 12px 正文，需 >= 4.5:1。
        // 四种类型的完整覆盖见 test/banner-notice.test.ts。
        expect(bannerTitleContrastRatio("#FFFFFF", "#5C67E2")).toBeGreaterThanOrEqual(4.5);
        expect(bannerTitleContrastRatio("#FFFFFF", "#3F4590")).toBeGreaterThanOrEqual(4.5);
    });

    test("挑出对比度不足的颜色并去重，默认无色不参与检查", () => {
        const runs = [
            { text: "低", color: "#808BF5" },
            { text: "也低", color: "#808BF5" },
            { text: "足够", color: "#FFFFFF" },
            { text: "没设颜色" },
        ];
        expect(lowContrastBannerTitleColors(runs, "#5C67E2")).toEqual(["#808BF5"]);
        expect(lowContrastBannerTitleColors(runs, "#3F4590")).toEqual(["#808BF5"]);
        expect(lowContrastBannerTitleColors([{ text: "足够", color: "#FFFFFF" }], "#5C67E2")).toEqual([]);
        expect(lowContrastBannerTitleColors(runs, "")).toEqual([]);
    });
});
