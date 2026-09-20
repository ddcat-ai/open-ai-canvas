import { expect, test } from "bun:test";
import type { AdminAnalytics, AnalyticsFinance } from "../src/services/api/auth";
import { analyticsFinanceColumns } from "../src/pages/admin/components/analytics-finance";

function renderFinanceCells(finance?: AnalyticsFinance | null) {
    const row: AdminAnalytics["models"][number] = {
        model: "example",
        capability: "text",
        tasks: 1,
        requests: 1,
        uniqueUsers: 1,
        taskSuccessRate: 100,
        requestSuccessRate: 100,
        p50DurationMs: 100,
        p95DurationMs: 100,
        inputTokens: 10,
        outputTokens: 10,
        cachedTokens: 0,
        usageAvailable: true,
        mediaCount: 0,
        videoSeconds: 0,
        ...(finance === undefined ? {} : { finance }),
    };
    return analyticsFinanceColumns.map((column) => ("render" in column ? column.render?.(undefined, row, 0) : undefined));
}

test("model finance cells tolerate missing and null backend finance", () => {
    expect(renderFinanceCells()).toEqual(["--", "--", "--", "--"]);
    expect(renderFinanceCells(null)).toEqual(["--", "--", "--", "--"]);
});

test("model finance cells preserve real zero values and unknown margins", () => {
    expect(renderFinanceCells({ settledOrders: 1, costedOrders: 1, revenueMicrocredits: 0, costMicrocredits: 0, profitMicrocredits: 0, profitMargin: null })).toEqual(["0", "0", "0", "--"]);
});

test("model finance cells show partial costs without inventing profits", () => {
    expect(renderFinanceCells({ settledOrders: 2, costedOrders: 1, revenueMicrocredits: 1500000, costMicrocredits: 250000, profitMicrocredits: null, profitMargin: null })).toEqual(["1.5", "0.25（部分）", "--", "--"]);
});

test("model finance cells display known losses", () => {
    expect(renderFinanceCells({ settledOrders: 1, costedOrders: 1, revenueMicrocredits: 1000000, costMicrocredits: 1500000, profitMicrocredits: -500000, profitMargin: -50 })).toEqual(["1", "1.5", "-0.5", "-50.0%"]);
});
