import type { SiteTrafficOperations, SiteTrafficOverview } from "../../src/services/api/site-traffic";

type OperationsContext = Pick<SiteTrafficOverview, "asOf" | "effectiveFrom" | "kpi"> & {
    comparison: Pick<SiteTrafficOverview["comparison"], "status" | "kpi">;
};

const defaultContext: OperationsContext = {
    asOf: "2026-11-10T08:00:00Z",
    effectiveFrom: "2026-11-01T00:00:00+08:00",
    kpi: { visitors: 1, pageViews: 2, visits: 1, actions: 0 },
    comparison: { status: "ready", kpi: { visitors: 0, pageViews: 0, visits: 0, actions: 0 } },
};

// 聚合分母刻意不同于 KPI；只随概览上下文同步回看窗口和比较派生字段。
export function trafficOperationsFixture(context: OperationsContext = defaultContext): SiteTrafficOperations {
    const day = 86_400_000;
    const localDate = new Date(Date.parse(context.asOf) + 28_800_000).toISOString().slice(0, 10);
    const lookbackFrom = new Date(Date.parse(`${localDate}T00:00:00+08:00`) - 364 * day).toISOString();
    const noLookback = Date.parse(lookbackFrom) === Date.parse(context.effectiveFrom);
    return {
        visitorMix: {
            status: noLookback ? "no_lookback" : "ready",
            visitors: 3,
            firstObservedVisitors: noLookback ? null : 2,
            returningVisitors: noLookback ? null : 1,
            firstObservedRate: noLookback ? null : 2 / 3,
            returningRate: noLookback ? null : 1 / 3,
            lookbackFrom,
            lookbackTo: context.effectiveFrom,
        },
        endpoints: {
            visits: 5,
            first: {
                undeterminedVisits: 1,
                pages: [
                    { page: "inspirations", visits: 3, rate: 0.6 },
                    { page: "create", visits: 1, rate: 0.2 },
                ],
            },
            last: {
                undeterminedVisits: 0,
                pages: [
                    { page: "canvas", visits: 3, rate: 0.6 },
                    { page: "create", visits: 2, rate: 0.4 },
                ],
            },
        },
        paths: {
            visits: 5,
            ambiguousVisits: 1,
            rows: [
                { from: "inspirations", to: "create", visits: 3, rate: 0.6 },
                { from: "create", to: "canvas", visits: 3, rate: 0.6 },
            ],
        },
        funnel: {
            steps: [
                { key: "inspirations", visits: 5, possibleVisits: 5, uncertainVisits: 0, rate: 1, previousRate: null },
                { key: "open_create", visits: 3, possibleVisits: 4, uncertainVisits: 1, rate: 0.6, previousRate: 0.6 },
                { key: "create", visits: 2, possibleVisits: 3, uncertainVisits: 1, rate: 0.4, previousRate: 2 / 3 },
                { key: "submit", visits: 1, possibleVisits: 2, uncertainVisits: 1, rate: 0.2, previousRate: 0.5 },
            ],
        },
        anomalies: {
            status: context.comparison.status,
            rules: { minimumBaseline: 30, minimumAbsoluteChange: 10, relativeThreshold: 0.3 },
            metrics: (["visitors", "pageViews", "visits", "actions"] as const).map((key) => {
                const current = context.kpi[key];
                const previous = context.comparison.status === "ready" ? (context.comparison.kpi?.[key] ?? null) : null;
                const relativeChange = previous === null || previous === 0 ? null : (current - previous) / previous;
                const status: SiteTrafficOperations["anomalies"]["metrics"][number]["status"] =
                    previous === null
                        ? "unavailable"
                        : previous === 0
                          ? "zero_baseline"
                          : previous < 30
                            ? "insufficient_sample"
                            : Math.abs(current - previous) >= 10 && Math.abs(relativeChange!) >= 0.3
                              ? current > previous
                                  ? "increase"
                                  : "decrease"
                              : "stable";
                return { key, current, previous, relativeChange, status };
            }),
        },
    };
}
