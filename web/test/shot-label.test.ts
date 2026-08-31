import { describe, expect, test } from "bun:test";

import { customShotTitle, formatShotOrdinal, normalizeDefaultShotTitle } from "@/lib/shot-label";

describe("shot labels", () => {
    test("使用中文两位镜头编号", () => {
        expect(formatShotOrdinal(0)).toBe("镜头01");
        expect(formatShotOrdinal(11)).toBe("镜头12");
    });

    test("只转换精确匹配的历史默认标题", () => {
        expect(normalizeDefaultShotTitle("SC.01", 0)).toBe("镜头01");
        expect(normalizeDefaultShotTitle("SC.01 雨夜", 0)).toBe("SC.01 雨夜");
        expect(normalizeDefaultShotTitle("雨夜追逐", 0)).toBe("雨夜追逐");
    });

    test("默认标题不会在编号旁重复展示", () => {
        expect(customShotTitle("SC.01", 0)).toBe("");
        expect(customShotTitle("镜头01", 0)).toBe("");
        expect(customShotTitle("雨夜追逐", 0)).toBe("雨夜追逐");
    });
});
