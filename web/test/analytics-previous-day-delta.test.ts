import { describe, expect, test } from "bun:test";
import { formatCountDelta, formatRateDelta } from "@/pages/admin/components/analytics-trend-delta";

describe("运营总览「较前一日」", () => {
    test("今天还没有数据时不显示 ↓100%", () => {
        expect(formatCountDelta(0, 42)).toBeUndefined();
        expect(formatCountDelta(0, 0)).toBeUndefined();
    });

    test("两天都有数据时照常比较；前一日为 0 时仍显示增量", () => {
        expect(formatCountDelta(15, 10)).toEqual({ value: "较前一日 ↑ 50.0%", tone: "success" });
        expect(formatCountDelta(5, 10)).toEqual({ value: "较前一日 ↓ 50.0%", tone: "warning" });
        expect(formatCountDelta(3, 0)).toEqual({ value: "较前一日 ↑ 3", tone: "success" });
    });

    test("任一天没有已完成请求（成功率为 null）时不比较", () => {
        expect(formatRateDelta(null, 99.3)).toBeUndefined();
        expect(formatRateDelta(98, null)).toBeUndefined();
        expect(formatRateDelta(null, null)).toBeUndefined();
        expect(formatRateDelta(undefined, 98)).toBeUndefined();
    });

    test("两天都有请求时照常显示 pp 差值，真实的 0% 也参与比较", () => {
        expect(formatRateDelta(95, 97.5)).toEqual({ value: "较前一日 ↓ 2.5pp", tone: "warning" });
        expect(formatRateDelta(99, 98)).toEqual({ value: "较前一日 ↑ 1.0pp", tone: "success" });
        expect(formatRateDelta(0, 50)).toEqual({ value: "较前一日 ↓ 50.0pp", tone: "warning" });
    });
});
