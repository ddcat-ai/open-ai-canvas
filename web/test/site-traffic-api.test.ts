import { describe, expect, test } from "bun:test";
import type { AxiosRequestConfig } from "axios";
import { apiClient, ApiError, type BackendEnvelope } from "../src/services/api/request";
import { collectSiteTraffic, getSiteTrafficOverview, getSiteTrafficToday, type SiteTrafficEvent, type SiteTrafficInsights, type SiteTrafficOperations, type SiteTrafficOverview, type SiteTrafficToday } from "../src/services/api/site-traffic";
import { trafficOperationsFixture } from "./fixtures/site-traffic-operations.fixture";

function insightsFixture(): SiteTrafficInsights {
    const heatmap: SiteTrafficInsights["heatmap"] = Array.from({ length: 168 }, (_, index) => ({
        weekday: Math.floor(index / 24) + 1,
        hour: index % 24,
        pageViews: null,
        hours: 0,
        completedHours: 0,
        partial: false,
        historyStatus: "outside_range",
    }));
    for (let time = Date.parse("2026-11-01T00:00:00+08:00"); time < Date.parse("2026-11-10T16:00:00+08:00"); time += 3_600_000) {
        const local = new Date(time + 28_800_000);
        const cell = heatmap[((local.getUTCDay() || 7) - 1) * 24 + local.getUTCHours()];
        cell.hours += 1;
        cell.completedHours += 1;
        cell.pageViews = 0;
        cell.historyStatus = "retained";
    }
    heatmap[6 * 24].pageViews = 2;
    return {
        heatmap,
        featureTrend: Array.from({ length: 10 }, (_, index) => ({
            date: `2026-11-${String(index + 1).padStart(2, "0")}`,
            partial: index === 9,
            historyStatus: "retained",
            counts: { open_create: 0, new_canvas: 0, open_ecommerce: 0, creation_submit_text: 0, creation_submit_image: 0, creation_submit_video: 0, creation_submit_agent: 0 },
        })),
        pageEngagement: [
            { page: "canvas", measurement: "supported", visits: 1, engagedVisits: 0, rate: 0 },
            // 仅覆盖协议 N/A 边界；当前后端不会返回此合法页面的 unsupported 状态。
            { page: "inspirations", measurement: "unsupported", visits: 0, engagedVisits: null, rate: null },
            { page: "tools_image", measurement: "supported", visits: 0, engagedVisits: 0, rate: null },
        ],
        depth: {
            visits: 1,
            buckets: [
                { key: "1", visits: 0, rate: 0 },
                { key: "2-3", visits: 1, rate: 1 },
                { key: "4+", visits: 0, rate: 0 },
            ],
        },
        operations: trafficOperationsFixture(),
    };
}

const event: SiteTrafficEvent = { id: "765db62e-cb85-4bcc-9f95-f4337594535b", visitorId: "59885ec5-e685-4c5d-b234-81111e3df7ea", sessionId: "01d1f157-c8b6-4b2a-8e97-52d621a97fbf", type: "page_view", page: "canvas" };
const query = { from: "2026-11-01", to: "2026-11-10" };
const valid: SiteTrafficOverview = {
    range: { ...query, timeZone: "Asia/Shanghai" },
    retentionDays: 365,
    availableFrom: "2026-10-22T00:00:00+08:00",
    asOf: "2026-11-10T08:00:00Z",
    effectiveFrom: "2026-11-01T00:00:00+08:00",
    effectiveTo: "2026-11-10T08:00:00Z",
    engagement: { visits: 1, engagedVisits: 0, rate: 0 },
    comparison: {
        range: { from: "2026-10-22", to: "2026-10-31", timeZone: "Asia/Shanghai" },
        effectiveFrom: "2026-10-22T00:00:00+08:00",
        effectiveTo: "2026-10-31T16:00:00+08:00",
        status: "ready",
        kpi: { visitors: 0, pageViews: 0, visits: 0, actions: 0 },
    },
    kpi: { visitors: 1, pageViews: 2, visits: 1, actions: 0 },
    trend: [{ date: "2026-11-01", visitors: 1, pageViews: 2, visits: 1, actions: 0 }],
    pages: [{ page: "canvas", pageViews: 2, visitors: 1, visits: 1 }],
    actions: [{ action: "open_create", page: "inspirations", count: 0, visitors: 0 }],
    insights: insightsFixture(),
};

const today: SiteTrafficToday = {
    date: "2026-11-11",
    timeZone: "Asia/Shanghai",
    asOf: "2026-11-10T16:02:30Z",
    active: { visitors: 3, windowFrom: "2026-11-10T15:57:30Z", windowTo: "2026-11-10T16:02:30Z" },
    hours: [{ hour: 0, partial: true, visitors: 1, pageViews: 2, visits: 1, actions: 1 }],
};

function envelope(data: unknown): { data: BackendEnvelope<unknown>; status: number; headers: Record<string, string> } {
    return { data: { code: 0, data, msg: "ok" }, status: 200, headers: {} };
}

async function withResponse(data: unknown, run: () => Promise<unknown>) {
    const original = apiClient.request;
    apiClient.request = (async () => envelope(data)) as typeof apiClient.request;
    try {
        return await run();
    } finally {
        apiClient.request = original;
    }
}

describe("site traffic API contract", () => {
    test("collect uses shared http, preserves Cookie/signal and strips extra sensitive fields", async () => {
        const controller = new AbortController();
        const original = apiClient.request;
        let observed = false;
        apiClient.request = (async (config) => {
            observed = true;
            expect(config.method).toBe("post");
            expect(config.url).toBe("/traffic/events");
            expect(config.signal?.aborted).toBe(false);
            expect(config.timeout).toBe(8000);
            expect(config.adapter).toBe("fetch");
            expect(config.fetchOptions).toEqual({ referrerPolicy: "no-referrer" });
            expect(apiClient.defaults.withCredentials).toBe(true);
            expect(config.withCredentials).not.toBe(false);
            expect(config.data).toEqual({ events: [event, { ...event, type: "action", action: "new_canvas" }] });
            expect(JSON.stringify(config.data)).not.toContain("private");
            return envelope({ accepted: 2 });
        }) as typeof apiClient.request;
        try {
            const extra = { ...event, pathname: "/canvas/private-id", prompt: "private prompt", userId: "private account", title: "private title", referrer: "private referrer", props: { private: true } };
            await expect(collectSiteTraffic([extra, { ...extra, type: "action", action: "new_canvas" }], { signal: controller.signal })).resolves.toEqual({ accepted: 2 });
            expect(observed).toBe(true);
        } finally {
            apiClient.request = original;
        }
    });

    test("overview serializes only inclusive from/to and preserves cancellation", async () => {
        const controller = new AbortController();
        const original = apiClient.request;
        apiClient.request = (async (config) => {
            expect(config.method).toBe("get");
            expect(config.url).toBe("/admin/traffic/overview");
            expect(config.params).toEqual(query);
            expect(config.signal?.aborted).toBe(false);
            expect(config.withCredentials).not.toBe(false);
            return envelope(valid);
        }) as typeof apiClient.request;
        try {
            await expect(getSiteTrafficOverview({ ...query, secret: "private" } as typeof query, { signal: controller.signal })).resolves.toEqual(valid);
        } finally {
            apiClient.request = original;
        }
    });

    test("today uses the shared client without range/source params and preserves signal", async () => {
        const controller = new AbortController();
        const original = apiClient.request;
        apiClient.request = (async (config) => {
            expect(config.method).toBe("get");
            expect(config.url).toBe("/admin/traffic/today");
            expect(config.params).toBeUndefined();
            expect(config.signal?.aborted).toBe(false);
            expect(config.withCredentials).not.toBe(false);
            return envelope(today);
        }) as typeof apiClient.request;
        try {
            await expect(getSiteTrafficToday({ signal: controller.signal })).resolves.toEqual(today);
        } finally {
            apiClient.request = original;
        }
    });

    test("all APIs preserve shared nonzero-envelope and HTTP errors", async () => {
        const original = apiClient.request;
        apiClient.request = (async () => ({ data: { code: 40301, data: null, msg: "无权查看统计" }, status: 200, headers: {} })) as typeof apiClient.request;
        try {
            for (const call of [() => collectSiteTraffic([event]), () => getSiteTrafficOverview(query), () => getSiteTrafficToday()]) {
                const error = await call().catch((value) => value);
                expect(error).toBeInstanceOf(ApiError);
                expect(error).toMatchObject({ code: 40301, status: 200, retryable: false });
            }
            apiClient.request = (async () => {
                throw { isAxiosError: true, message: "missing", response: { status: 404, data: { code: 404, data: null, msg: "请求不存在" }, headers: {} } };
            }) as typeof apiClient.request;
            await expect(collectSiteTraffic([event])).rejects.toMatchObject({ status: 404, retryable: false });
            await expect(getSiteTrafficOverview(query)).rejects.toMatchObject({ status: 404, retryable: false });
            await expect(getSiteTrafficToday()).rejects.toMatchObject({ status: 404, retryable: false });
        } finally {
            apiClient.request = original;
        }
    });

    test.each(["collect", "overview", "today"] as const)("%s forwards caller cancellation to the active transport", async (kind) => {
        const controller = new AbortController();
        const original = apiClient.request;
        let transportSignal: AxiosRequestConfig["signal"];
        let abortEvents = 0;
        apiClient.request = (async (config) => {
            transportSignal = config.signal;
            return new Promise<never>((_resolve, reject) => {
                config.signal?.addEventListener?.(
                    "abort",
                    () => {
                        abortEvents += 1;
                        reject(new DOMException("The operation was aborted", "AbortError"));
                    },
                    { once: true },
                );
            });
        }) as typeof apiClient.request;
        try {
            const pending = kind === "collect" ? collectSiteTraffic([event], { signal: controller.signal }) : kind === "overview" ? getSiteTrafficOverview(query, { signal: controller.signal }) : getSiteTrafficToday({ signal: controller.signal });
            expect(transportSignal?.aborted).toBe(false);
            controller.abort();
            expect(transportSignal?.aborted).toBe(true);
            expect(abortEvents).toBe(1);
            await expect(pending).rejects.toMatchObject({ name: "AbortError" });
        } finally {
            controller.abort();
            apiClient.request = original;
        }
    });

    test("all APIs preserve AbortError instead of presenting cancellation as business failure", async () => {
        const original = apiClient.request;
        apiClient.request = (async () => {
            throw { __CANCEL__: true, code: "ERR_CANCELED" };
        }) as typeof apiClient.request;
        try {
            await expect(collectSiteTraffic([event])).rejects.toMatchObject({ name: "AbortError" });
            await expect(getSiteTrafficOverview(query)).rejects.toMatchObject({ name: "AbortError" });
            await expect(getSiteTrafficToday()).rejects.toMatchObject({ name: "AbortError" });
        } finally {
            apiClient.request = original;
        }
    });

    test("rejects non-whitelisted events before transport", async () => {
        const original = apiClient.request;
        let calls = 0;
        apiClient.request = (async () => {
            calls += 1;
            return envelope({ accepted: 1 });
        }) as typeof apiClient.request;
        try {
            for (const invalid of [
                { ...event, page: "/canvas/private-id" },
                ...["welcome", "plugins", "share", "library", "runninghub", "other", "tools", "auth", "account"].flatMap((page) => [
                    { ...event, page },
                    { ...event, page, type: "action", action: "open_create" },
                ]),
                { ...event, type: "arbitrary" },
                { ...event, type: "action", action: "private-action" },
            ])
                await expect(collectSiteTraffic([invalid as SiteTrafficEvent])).rejects.toThrow("访问统计事件类型无效");
            expect(calls).toBe(0);
        } finally {
            apiClient.request = original;
        }
    });

    test("image and video tools keep separate keys in collection and overview", async () => {
        const toolPages = ["tools_image", "tools_video"] as const;
        const events = toolPages.map((page, index) => ({ ...event, page, id: index === 0 ? event.id : "b54bcbd7-b897-4315-aa77-99c4c62876f1" }));
        const original = apiClient.request;
        apiClient.request = (async (config) => {
            expect(config.data).toEqual({ events });
            return envelope({ accepted: 2 });
        }) as typeof apiClient.request;
        try {
            await expect(collectSiteTraffic(events)).resolves.toEqual({ accepted: 2 });
        } finally {
            apiClient.request = original;
        }
        const snapshot: SiteTrafficOverview = {
            ...valid,
            pages: toolPages.map((page) => ({ page, pageViews: 1, visitors: 1, visits: 1 })),
            actions: toolPages.map((page) => ({ page, action: "open_create", count: 1, visitors: 1 })),
            insights: { ...insightsFixture(), pageEngagement: toolPages.map((page) => ({ page, measurement: "supported", visits: 1, engagedVisits: 1, rate: 1 })) },
        };
        await expect(withResponse(snapshot, () => getSiteTrafficOverview(query))).resolves.toEqual(snapshot);
        for (const page of ["welcome", "plugins", "share", "library", "runninghub", "other", "tools", "auth", "account"]) {
            for (const invalid of [
                { ...snapshot, pages: [{ ...snapshot.pages[0], page }] },
                { ...snapshot, actions: [{ ...snapshot.actions[0], page }] },
                { ...snapshot, insights: { ...snapshot.insights, pageEngagement: [{ ...snapshot.insights.pageEngagement[0], page }] } },
            ])
                await expect(withResponse(invalid, () => getSiteTrafficOverview(query))).rejects.toThrow("访问统计概览响应无效");
        }
    });

    test("accepted must be a non-negative safe integer within the submitted batch", async () => {
        for (const value of [undefined, null, {}, { accepted: "1" }, { accepted: -1 }, { accepted: 1.5 }, { accepted: 2 }, { accepted: Number.NaN }, { accepted: Number.MAX_SAFE_INTEGER + 1 }]) {
            await expect(withResponse(value, () => collectSiteTraffic([event]))).rejects.toThrow("访问统计采集响应无效");
        }
        await expect(withResponse({ accepted: 0 }, () => collectSiteTraffic([event]))).resolves.toEqual({ accepted: 0 });
    });

    test("overview rejects missing structure, invalid range, timezone, retention and RFC3339 dates", async () => {
        const invalid = [
            undefined,
            null,
            {},
            { ...valid, range: undefined },
            { ...valid, range: { ...valid.range, from: "2026-11-02" } },
            { ...valid, range: { ...valid.range, to: "2026-11-09" } },
            { ...valid, range: { ...valid.range, timeZone: "UTC" } },
            { ...valid, retentionDays: 30 },
            { ...valid, retentionDays: "365" },
            { ...valid, availableFrom: undefined },
            { ...valid, availableFrom: "2026-11-01" },
            { ...valid, availableFrom: "2026-02-30T00:00:00Z" },
            { ...valid, availableFrom: "2026-11-01T25:00:00Z" },
            { ...valid, trend: null },
            { ...valid, pages: {} },
            { ...valid, actions: undefined },
            { ...valid, trend: [{ ...valid.trend[0], date: "2026-10-31" }] },
        ];
        for (const value of invalid) await expect(withResponse(value, () => getSiteTrafficOverview(query))).rejects.toThrow("访问统计概览响应无效");
        await expect(withResponse({ ...valid, availableFrom: null }, () => getSiteTrafficOverview(query))).resolves.toMatchObject({ availableFrom: null });
        await expect(withResponse({ ...valid, availableFrom: "2026-11-01T00:00:00.123Z" }, () => getSiteTrafficOverview(query))).resolves.toMatchObject({ availableFrom: "2026-11-01T00:00:00.123Z" });
    });

    test("comparison and engagement reject incomplete/unavailable fake values but allow independent denominators", async () => {
        for (const value of [
            { ...valid, asOf: undefined },
            { ...valid, asOf: "2026-02-30T00:00:00Z" },
            { ...valid, effectiveFrom: "bad" },
            { ...valid, effectiveTo: "2027-01-01T00:00:00Z" },
            { ...valid, engagement: undefined },
            { ...valid, engagement: { visits: 0, engagedVisits: 0, rate: 0 } },
            { ...valid, engagement: { visits: 1, engagedVisits: 2, rate: 1 } },
            { ...valid, engagement: { visits: 2, engagedVisits: 1, rate: 50 } },
            { ...valid, engagement: { visits: 2, engagedVisits: 1, rate: Number.NaN } },
            { ...valid, comparison: undefined },
            { ...valid, comparison: { ...valid.comparison, status: "unknown" } },
            { ...valid, comparison: { ...valid.comparison, status: "ready", kpi: null } },
            { ...valid, comparison: { ...valid.comparison, status: "insufficient_history" } },
            { ...valid, comparison: { ...valid.comparison, kpi: { ...valid.kpi, actions: -1 } } },
            { ...valid, comparison: { ...valid.comparison, effectiveTo: "bad" } },
            { ...valid, comparison: { ...valid.comparison, range: { ...valid.comparison.range, from: "2026-10-21" } } },
        ])
            await expect(withResponse(value, () => getSiteTrafficOverview(query))).rejects.toThrow("访问统计概览响应无效");
        for (const status of ["outside_retention", "insufficient_history"] as const) {
            const snapshot: SiteTrafficOverview = { ...valid, comparison: { ...valid.comparison, status, kpi: null }, insights: insightsFixture() };
            snapshot.insights.operations = trafficOperationsFixture(snapshot);
            await expect(withResponse(snapshot, () => getSiteTrafficOverview(query))).resolves.toMatchObject({ comparison: { status, kpi: null } });
        }
        await expect(withResponse({ ...valid, engagement: { visits: 2, engagedVisits: 1, rate: 0.5 } }, () => getSiteTrafficOverview(query))).resolves.toMatchObject({ kpi: { visits: 1 }, engagement: { visits: 2, rate: 0.5 } });
        await expect(withResponse({ ...valid, engagement: { visits: 0, engagedVisits: 0, rate: null }, effectiveTo: valid.effectiveFrom }, () => getSiteTrafficOverview(query))).resolves.toMatchObject({ engagement: { rate: null } });
    });

    test("insights rejects missing dimensions, duplicates, invalid counts and false historical zeroes", async () => {
        const mutations: Array<(value: SiteTrafficInsights) => void> = [
            (value) => {
                value.heatmap.pop();
            },
            (value) => {
                value.heatmap[0] = null as never;
            },
            (value) => {
                value.heatmap[1] = { ...value.heatmap[0] };
            },
            (value) => {
                value.heatmap[0].weekday = 0;
            },
            (value) => {
                value.heatmap[0].hour = 24;
            },
            (value) => {
                value.heatmap[0].hours = -1;
            },
            (value) => {
                value.heatmap[0].completedHours = value.heatmap[0].hours + 1;
            },
            (value) => {
                value.heatmap[0].pageViews = Number.MAX_SAFE_INTEGER + 1;
            },
            (value) => {
                value.heatmap[0].historyStatus = "unknown";
            },
            (value) => {
                value.heatmap[0].historyStatus = "outside_range";
            },
            (value) => {
                value.heatmap[0].hours = 0;
                value.heatmap[0].completedHours = 0;
            },
            (value) => {
                value.heatmap[0].partial = true;
            },
            (value) => {
                value.featureTrend.pop();
            },
            (value) => {
                value.featureTrend[1] = { ...value.featureTrend[0] };
            },
            (value) => {
                value.featureTrend[0].partial = true;
            },
            (value) => {
                value.featureTrend[9].partial = false;
            },
            (value) => {
                value.featureTrend[0].historyStatus = "unknown";
            },
            (value) => {
                value.featureTrend[0].counts = null;
            },
            (value) => {
                value.featureTrend[0].counts!.open_create = -1;
            },
            (value) => {
                delete (value.featureTrend[0].counts as { new_canvas?: number }).new_canvas;
            },
            (value) => {
                value.featureTrend[0].counts = { ...value.featureTrend[0].counts!, secret: 1 } as never;
            },
        ];
        for (const mutate of mutations) {
            const insights = insightsFixture();
            mutate(insights);
            await expect(withResponse({ ...valid, insights }, () => getSiteTrafficOverview(query))).rejects.toThrow("访问统计概览响应无效");
        }
        for (const insights of [null, undefined, {}, { ...valid.insights, heatmap: null }, { ...valid.insights, featureTrend: {} }]) {
            await expect(withResponse({ ...valid, insights }, () => getSiteTrafficOverview(query))).rejects.toThrow("访问统计概览响应无效");
        }
        const history = insightsFixture();
        history.heatmap[0] = { ...history.heatmap[0], historyStatus: "unknown", pageViews: null };
        history.featureTrend[0] = { ...history.featureTrend[0], historyStatus: "unknown", counts: null };
        history.featureTrend[1].historyStatus = "partial";
        await expect(withResponse({ ...valid, insights: history }, () => getSiteTrafficOverview(query))).resolves.toMatchObject({ insights: history });
    });

    test("heatmap unfinished hour follows the server cutoff and differs from history coverage", async () => {
        const insights = insightsFixture();
        const cell = insights.heatmap[24 + 16]; // 周二16点：上一周已结束，本周仅经过半小时。
        cell.hours += 1;
        cell.partial = true;
        cell.historyStatus = "partial";
        const current = { ...valid, asOf: "2026-11-10T08:30:00Z", effectiveTo: "2026-11-10T08:30:00Z", insights };
        current.insights.operations = trafficOperationsFixture(current);
        await expect(withResponse(current, () => getSiteTrafficOverview(query))).resolves.toEqual(current);
        for (const patch of [{ weekday: 3 }, { hour: 17 }, { completedHours: cell.hours }, { pageViews: null }]) {
            const invalid = structuredClone(current);
            Object.assign(invalid.insights.heatmap[24 + 16], patch);
            await expect(withResponse(invalid, () => getSiteTrafficOverview(query))).rejects.toThrow(TypeError);
        }
        await expect(withResponse({ ...current, effectiveTo: valid.effectiveTo }, () => getSiteTrafficOverview(query))).rejects.toThrow(TypeError);
        const outside = insightsFixture();
        outside.heatmap = outside.heatmap.map((row) => ({ ...row, hours: 0, completedHours: 0, partial: false, historyStatus: "outside_range", pageViews: null }));
        outside.featureTrend = outside.featureTrend.map((point) => ({ ...point, historyStatus: "unknown", counts: null }));
        await expect(withResponse({ ...valid, effectiveTo: valid.effectiveFrom, insights: outside }, () => getSiteTrafficOverview(query))).resolves.toMatchObject({ insights: outside });
    });

    test("server midnight keeps today's empty window unknown instead of inventing a sampled hour", async () => {
        const midnightQuery = { from: "2026-11-10", to: "2026-11-10" };
        const zeroCounts = { visitors: 0, pageViews: 0, visits: 0, actions: 0 };
        const midnight: SiteTrafficOverview = {
            ...valid,
            range: { ...midnightQuery, timeZone: "Asia/Shanghai" },
            asOf: "2026-11-09T16:00:00Z",
            effectiveFrom: "2026-11-10T00:00:00+08:00",
            effectiveTo: "2026-11-10T00:00:00+08:00",
            kpi: zeroCounts,
            engagement: { visits: 0, engagedVisits: 0, rate: null },
            comparison: { range: { from: "2026-11-09", to: "2026-11-09", timeZone: "Asia/Shanghai" }, effectiveFrom: "2026-11-09T00:00:00+08:00", effectiveTo: "2026-11-09T00:00:00+08:00", status: "ready", kpi: zeroCounts },
            trend: [{ date: "2026-11-10", ...zeroCounts }],
            pages: [],
            actions: [],
            insights: {
                heatmap: insightsFixture().heatmap.map((cell) => ({ ...cell, hours: 0, completedHours: 0, partial: false, historyStatus: "outside_range", pageViews: null })),
                featureTrend: [{ date: "2026-11-10", partial: true, historyStatus: "unknown", counts: null }],
                pageEngagement: [],
                depth: {
                    visits: 0,
                    buckets: [
                        { key: "1", visits: 0, rate: null },
                        { key: "2-3", visits: 0, rate: null },
                        { key: "4+", visits: 0, rate: null },
                    ],
                },
                operations: trafficOperationsFixture(),
            },
        };
        midnight.insights.operations = trafficOperationsFixture(midnight);
        await expect(withResponse(midnight, () => getSiteTrafficOverview(midnightQuery))).resolves.toEqual(midnight);
        const fabricated = structuredClone(midnight);
        fabricated.insights.heatmap[24] = { ...fabricated.insights.heatmap[24], hours: 1, partial: true, historyStatus: "retained", pageViews: 0 };
        await expect(withResponse(fabricated, () => getSiteTrafficOverview(midnightQuery))).rejects.toThrow(TypeError);
    });

    test("page engagement and depth enforce N/A, ratios and their own complete denominators", async () => {
        const mutations: Array<(value: SiteTrafficInsights) => void> = [
            (value) => {
                value.pageEngagement[1] = { ...value.pageEngagement[0] };
            },
            (value) => {
                value.pageEngagement[0].page = "private" as never;
            },
            (value) => {
                value.pageEngagement[0].measurement = "unknown" as never;
            },
            (value) => {
                value.pageEngagement[0].engagedVisits = 2;
            },
            (value) => {
                value.pageEngagement[0].rate = 0.5;
            },
            (value) => {
                value.pageEngagement[0].visits = 0;
            },
            (value) => {
                value.pageEngagement[1].engagedVisits = 0;
            },
            (value) => {
                value.pageEngagement[2].rate = 0;
            },
            (value) => {
                value.depth.buckets.pop();
            },
            (value) => {
                value.depth.buckets[1].key = "1";
            },
            (value) => {
                value.depth.buckets[0].visits = -1;
            },
            (value) => {
                value.depth.buckets[0].rate = Number.NaN;
            },
            (value) => {
                value.depth.buckets[1].rate = 0.5;
            },
            (value) => {
                value.depth.visits = 2;
            },
        ];
        for (const mutate of mutations) {
            const insights = insightsFixture();
            mutate(insights);
            await expect(withResponse({ ...valid, insights }, () => getSiteTrafficOverview(query))).rejects.toThrow(TypeError);
        }
        const independent = insightsFixture();
        independent.pageEngagement[0] = { page: "canvas", measurement: "supported", visits: 7, engagedVisits: 2, rate: 2 / 7 };
        independent.depth = {
            visits: 3,
            buckets: [
                { key: "1", visits: 1, rate: 1 / 3 },
                { key: "2-3", visits: 0, rate: 0 },
                { key: "4+", visits: 2, rate: 2 / 3 },
            ],
        };
        await expect(withResponse({ ...valid, insights: independent }, () => getSiteTrafficOverview(query))).resolves.toMatchObject({ kpi: { visits: 1 }, insights: independent });
        const zero = insightsFixture();
        zero.pageEngagement[0] = { page: "canvas", measurement: "supported", visits: 0, engagedVisits: 0, rate: null };
        zero.depth = { visits: 0, buckets: zero.depth.buckets.map((bucket) => ({ ...bucket, visits: 0, rate: null })) };
        await expect(withResponse({ ...valid, insights: zero }, () => getSiteTrafficOverview(query))).resolves.toMatchObject({ insights: zero });
        zero.depth.buckets[0].rate = 0;
        await expect(withResponse({ ...valid, insights: zero }, () => getSiteTrafficOverview(query))).rejects.toThrow(TypeError);
    });

    test("operations rejects missing blocks, invalid lookback windows and non-conserved visitor mixes", async () => {
        for (const operations of [undefined, null, {}, []]) {
            await expect(withResponse({ ...valid, insights: { ...valid.insights, operations } }, () => getSiteTrafficOverview(query))).rejects.toThrow("访问统计概览响应无效");
        }
        for (const key of ["visitorMix", "endpoints", "paths", "funnel", "anomalies"] as const) {
            const operations = trafficOperationsFixture();
            delete (operations as Partial<SiteTrafficOperations>)[key];
            await expect(withResponse({ ...valid, insights: { ...valid.insights, operations } }, () => getSiteTrafficOverview(query))).rejects.toThrow("访问统计概览响应无效");
        }
        const mutations: Array<(value: SiteTrafficOperations) => void> = [
            (value) => {
                value.visitorMix.status = "unknown" as never;
            },
            (value) => {
                value.visitorMix.visitors = 2;
            },
            (value) => {
                value.visitorMix.firstObservedVisitors = null;
            },
            (value) => {
                value.visitorMix.returningVisitors = null;
            },
            (value) => {
                value.visitorMix.firstObservedVisitors = Number.MAX_SAFE_INTEGER;
                value.visitorMix.returningVisitors = 1;
                value.visitorMix.visitors = Number.MAX_SAFE_INTEGER;
            },
            (value) => {
                value.visitorMix.lookbackFrom = "2025-11-11";
            },
            (value) => {
                value.visitorMix.lookbackFrom = "2025-11-10T00:00:00+08:00";
            },
            (value) => {
                value.visitorMix.lookbackTo = "bad";
            },
            (value) => {
                value.visitorMix.lookbackTo = "2026-11-02T00:00:00+08:00";
            },
            (value) => {
                value.visitorMix.lookbackTo = "2026-11-11T00:00:00+08:00";
            },
            (value) => {
                Object.assign(value.visitorMix, { status: "no_lookback", firstObservedVisitors: null, returningVisitors: null, firstObservedRate: null, returningRate: null });
            },
        ];
        for (const mutate of mutations) {
            const snapshot = structuredClone(valid);
            mutate(snapshot.insights.operations);
            await expect(withResponse(snapshot, () => getSiteTrafficOverview(query))).rejects.toThrow("访问统计概览响应无效");
        }
    });

    test("operations requires safe non-negative counts and exact finite fractions in every dimension", async () => {
        const counts: Array<(value: SiteTrafficOperations, bad: never) => void> = [
            (value, bad) => {
                value.visitorMix.visitors = bad;
            },
            (value, bad) => {
                value.visitorMix.firstObservedVisitors = bad;
            },
            (value, bad) => {
                value.visitorMix.returningVisitors = bad;
            },
            (value, bad) => {
                value.endpoints.visits = bad;
            },
            (value, bad) => {
                value.endpoints.first.undeterminedVisits = bad;
            },
            (value, bad) => {
                value.endpoints.last.undeterminedVisits = bad;
            },
            (value, bad) => {
                value.endpoints.first.pages[0].visits = bad;
            },
            (value, bad) => {
                value.endpoints.last.pages[0].visits = bad;
            },
            (value, bad) => {
                value.paths.visits = bad;
            },
            (value, bad) => {
                value.paths.ambiguousVisits = bad;
            },
            (value, bad) => {
                value.paths.rows[0].visits = bad;
            },
            (value, bad) => {
                value.funnel.steps[1].visits = bad;
            },
            (value, bad) => {
                value.funnel.steps[1].possibleVisits = bad;
            },
            (value, bad) => {
                value.funnel.steps[1].uncertainVisits = bad;
            },
            (value, bad) => {
                value.anomalies.metrics[0].current = bad;
            },
            (value, bad) => {
                value.anomalies.metrics[0].previous = bad;
            },
        ];
        const fractions: Array<(value: SiteTrafficOperations, bad: never) => void> = [
            (value, bad) => {
                value.visitorMix.firstObservedRate = bad;
            },
            (value, bad) => {
                value.visitorMix.returningRate = bad;
            },
            (value, bad) => {
                value.endpoints.first.pages[0].rate = bad;
            },
            (value, bad) => {
                value.endpoints.last.pages[0].rate = bad;
            },
            (value, bad) => {
                value.paths.rows[0].rate = bad;
            },
            (value, bad) => {
                value.funnel.steps[1].rate = bad;
            },
            (value, bad) => {
                value.funnel.steps[2].previousRate = bad;
            },
        ];
        for (const [setters, badValues] of [
            [counts, [-1, 0.5, Number.POSITIVE_INFINITY, Number.NaN, Number.MAX_SAFE_INTEGER + 1, "0", null, undefined]],
            [fractions, [-1, 0, 1, 1.1, Number.POSITIVE_INFINITY, Number.NaN, "0.6", null, undefined]],
        ] as const) {
            for (const bad of badValues)
                for (const set of setters) {
                    const snapshot = structuredClone(valid);
                    set(snapshot.insights.operations, bad as never);
                    await expect(withResponse(snapshot, () => getSiteTrafficOverview(query))).rejects.toThrow("访问统计概览响应无效");
                }
        }
    });

    test("operations rejects retired page keys on first/last endpoints and both path directions", async () => {
        for (const page of ["welcome", "plugins", "share", "library", "runninghub", "other", "tools", "auth", "account", "private-server-key"]) {
            const mutations: Array<(value: SiteTrafficOperations) => void> = [
                (value) => {
                    value.endpoints.first.pages[0].page = page as never;
                },
                (value) => {
                    value.endpoints.last.pages[0].page = page as never;
                },
                (value) => {
                    value.paths.rows[0].from = page as never;
                },
                (value) => {
                    value.paths.rows[0].to = page as never;
                },
            ];
            for (const mutate of mutations) {
                const snapshot = structuredClone(valid);
                mutate(snapshot.insights.operations);
                await expect(withResponse(snapshot, () => getSiteTrafficOverview(query))).rejects.toThrow("访问统计概览响应无效");
            }
        }
    });

    test("operations first and last endpoints require unique pages and full internal conservation", async () => {
        const mutations: Array<(value: SiteTrafficOperations["endpoints"]["first"]) => void> = [
            (value) => {
                value.undeterminedVisits = 6;
            },
            (value) => {
                value.undeterminedVisits += 1;
            },
            (value) => {
                value.pages = null as never;
            },
            (value) => {
                value.pages[0] = null as never;
            },
            (value) => {
                value.pages[1].page = value.pages[0].page;
            },
            (value) => {
                value.pages.pop();
            },
            (value) => {
                value.pages[0].visits = 6;
                value.pages[0].rate = 1;
            },
            (value) => {
                value.pages[0].visits -= 1;
                value.pages[0].rate = value.pages[0].visits / 5;
            },
        ];
        for (const end of ["first", "last"] as const) {
            for (const missing of [undefined, null, {}]) {
                const snapshot = structuredClone(valid);
                snapshot.insights.operations.endpoints[end] = missing as never;
                await expect(withResponse(snapshot, () => getSiteTrafficOverview(query))).rejects.toThrow("访问统计概览响应无效");
            }
            for (const mutate of mutations) {
                const snapshot = structuredClone(valid);
                mutate(snapshot.insights.operations.endpoints[end]);
                await expect(withResponse(snapshot, () => getSiteTrafficOverview(query))).rejects.toThrow("访问统计概览响应无效");
            }
            const overflow = structuredClone(valid);
            overflow.insights.operations.endpoints = {
                visits: Number.MAX_SAFE_INTEGER,
                first: { undeterminedVisits: Number.MAX_SAFE_INTEGER, pages: [] },
                last: { undeterminedVisits: Number.MAX_SAFE_INTEGER, pages: [] },
            };
            overflow.insights.operations.endpoints[end].pages.push({ page: "canvas", visits: 1, rate: 1 / Number.MAX_SAFE_INTEGER });
            await expect(withResponse(overflow, () => getSiteTrafficOverview(query))).rejects.toThrow("访问统计概览响应无效");
        }
    });

    test("operations paths reject more than ten rows, self pairs, duplicates and out-of-bound counts", async () => {
        const mutations: Array<(value: SiteTrafficOperations["paths"]) => void> = [
            (value) => {
                value.rows = null as never;
            },
            (value) => {
                value.rows[0] = null as never;
            },
            (value) => {
                value.ambiguousVisits = value.visits + 1;
            },
            (value) => {
                value.rows[0].from = value.rows[0].to;
            },
            (value) => {
                value.rows.push({ ...value.rows[0] });
            },
            (value) => {
                value.rows[0].visits = 0;
                value.rows[0].rate = 0;
            },
            (value) => {
                value.rows[0].visits = value.visits + 1;
                value.rows[0].rate = 1;
            },
            (value) => {
                const pages = ["inspirations", "create", "canvas", "tools_image"] as const;
                value.rows = pages.flatMap((from) => pages.filter((to) => to !== from).map((to) => ({ from, to, visits: 1, rate: 1 / value.visits }))).slice(0, 11);
            },
        ];
        for (const mutate of mutations) {
            const snapshot = structuredClone(valid);
            mutate(snapshot.insights.operations.paths);
            await expect(withResponse(snapshot, () => getSiteTrafficOverview(query))).rejects.toThrow("访问统计概览响应无效");
        }
    });

    test("operations funnel requires four ordered monotonic steps, exact uncertainty and both rate denominators", async () => {
        const mutations: Array<(value: SiteTrafficOperations["funnel"]) => void> = [
            (value) => {
                value.steps = null as never;
            },
            (value) => {
                value.steps[0] = null as never;
            },
            (value) => {
                value.steps.pop();
            },
            (value) => {
                value.steps.push({ ...value.steps[3] });
            },
            (value) => {
                [value.steps[0], value.steps[1]] = [value.steps[1], value.steps[0]];
            },
            (value) => {
                value.steps[1].key = value.steps[0].key;
            },
            (value) => {
                value.steps[2].key = "unknown" as never;
            },
            (value) => {
                value.steps[0].possibleVisits += 1;
                value.steps[0].uncertainVisits = 1;
            },
            (value) => {
                value.steps[0].previousRate = 1;
            },
            (value) => {
                value.steps[0].rate = null;
            },
            (value) => {
                value.steps[1].possibleVisits = 2;
            },
            (value) => {
                value.steps[1].uncertainVisits = 0;
            },
            (value) => {
                value.steps[2].possibleVisits = 5;
                value.steps[2].uncertainVisits = 3;
            },
            (value) => {
                Object.assign(value.steps[2], { visits: 4, possibleVisits: 4, uncertainVisits: 0, rate: 0.8, previousRate: 4 / 3 });
            },
            (value) => {
                value.steps[1].rate = 3 / 4;
            },
            (value) => {
                value.steps[2].previousRate = 2 / 4;
            },
        ];
        for (const mutate of mutations) {
            const snapshot = structuredClone(valid);
            mutate(snapshot.insights.operations.funnel);
            await expect(withResponse(snapshot, () => getSiteTrafficOverview(query))).rejects.toThrow("访问统计概览响应无效");
        }
        const snapshot = structuredClone(valid);
        Object.assign(snapshot.insights.operations.funnel.steps[2], { visits: 0, uncertainVisits: 3, rate: 0, previousRate: 0 });
        Object.assign(snapshot.insights.operations.funnel.steps[3], { visits: 0, uncertainVisits: 2, rate: 0, previousRate: null });
        await expect(withResponse(snapshot, () => getSiteTrafficOverview(query))).resolves.toEqual(snapshot);
        snapshot.insights.operations.funnel.steps[3].previousRate = 0;
        await expect(withResponse(snapshot, () => getSiteTrafficOverview(query))).rejects.toThrow("访问统计概览响应无效");
    });

    test("operations accepts independent denominators and overlapping path shares above one in total", async () => {
        const operations = trafficOperationsFixture();
        operations.paths.visits = 4;
        operations.paths.rows = operations.paths.rows.map((row) => ({ ...row, rate: row.visits / 4 }));
        Object.assign(operations.funnel.steps[0], { visits: 7, possibleVisits: 7 });
        for (const [index, step] of operations.funnel.steps.entries()) {
            step.rate = step.visits / 7;
            step.previousRate = index === 0 ? null : step.visits / operations.funnel.steps[index - 1].visits;
        }
        expect(operations.paths.rows.reduce((total, row) => total + row.rate!, 0)).toBeGreaterThan(1);
        expect([operations.visitorMix.visitors, operations.endpoints.visits, operations.paths.visits, operations.funnel.steps[0].visits]).toEqual([3, 5, 4, 7]);
        const snapshot = { ...valid, insights: { ...insightsFixture(), operations } };
        await expect(withResponse(snapshot, () => getSiteTrafficOverview(query))).resolves.toMatchObject({ kpi: { visitors: 1, visits: 1 }, insights: { operations } });
    });

    test("operations accepts true zero denominators only with null rates, never fabricated zero fractions", async () => {
        const operations = trafficOperationsFixture();
        Object.assign(operations.visitorMix, { visitors: 0, firstObservedVisitors: 0, returningVisitors: 0, firstObservedRate: null, returningRate: null });
        operations.endpoints = { visits: 0, first: { undeterminedVisits: 0, pages: [{ page: "canvas", visits: 0, rate: null }] }, last: { undeterminedVisits: 0, pages: [] } };
        operations.paths = { visits: 0, ambiguousVisits: 0, rows: [] };
        operations.funnel.steps = operations.funnel.steps.map((step) => ({ ...step, visits: 0, possibleVisits: 0, uncertainVisits: 0, rate: null, previousRate: null }));
        const zero = { ...valid, insights: { ...insightsFixture(), operations } };
        await expect(withResponse(zero, () => getSiteTrafficOverview(query))).resolves.toEqual(zero);
        const mutations: Array<(value: SiteTrafficOperations) => void> = [
            (value) => {
                value.visitorMix.firstObservedRate = 0;
            },
            (value) => {
                value.visitorMix.returningRate = 0;
            },
            (value) => {
                value.endpoints.first.pages[0].rate = 0;
            },
            (value) => {
                value.funnel.steps[0].rate = 0;
            },
            (value) => {
                value.funnel.steps[1].rate = 0;
            },
            (value) => {
                value.funnel.steps[1].previousRate = 0;
            },
            (value) => {
                value.paths.rows = [{ from: "inspirations", to: "create", visits: 0, rate: 0 }];
            },
        ];
        for (const mutate of mutations) {
            const snapshot = structuredClone(zero);
            mutate(snapshot.insights.operations);
            await expect(withResponse(snapshot, () => getSiteTrafficOverview(query))).rejects.toThrow("访问统计概览响应无效");
        }
    });

    test("operations no_lookback derives the retention edge from server date and keeps unknown splits null", async () => {
        const boundaryQuery = { from: "2025-11-11", to: "2025-11-11" };
        const snapshot: SiteTrafficOverview = {
            ...valid,
            range: { ...boundaryQuery, timeZone: "Asia/Shanghai" },
            availableFrom: "2025-11-11T00:00:00+08:00",
            effectiveFrom: "2025-11-11T00:00:00+08:00",
            effectiveTo: "2025-11-12T00:00:00+08:00",
            comparison: { range: { from: "2025-11-10", to: "2025-11-10", timeZone: "Asia/Shanghai" }, effectiveFrom: "2025-11-10T00:00:00+08:00", effectiveTo: "2025-11-11T00:00:00+08:00", status: "outside_retention", kpi: null },
            trend: [{ date: boundaryQuery.from, ...valid.kpi }],
            insights: {
                ...insightsFixture(),
                heatmap: valid.insights.heatmap.map((cell): SiteTrafficInsights["heatmap"][number] => ({
                    ...cell,
                    hours: cell.weekday === 2 ? 1 : 0,
                    completedHours: cell.weekday === 2 ? 1 : 0,
                    partial: false,
                    historyStatus: cell.weekday === 2 ? "retained" : "outside_range",
                    pageViews: cell.weekday === 2 ? (cell.hour === 0 ? 2 : 0) : null,
                })),
                featureTrend: [{ ...valid.insights.featureTrend[0], date: boundaryQuery.from, partial: false }],
            },
        };
        snapshot.insights.operations = trafficOperationsFixture(snapshot);
        await expect(withResponse(snapshot, () => getSiteTrafficOverview(boundaryQuery))).resolves.toMatchObject({
            insights: {
                operations: {
                    visitorMix: { status: "no_lookback", visitors: 3, firstObservedVisitors: null, returningVisitors: null, firstObservedRate: null, returningRate: null, lookbackFrom: "2025-11-10T16:00:00.000Z", lookbackTo: snapshot.effectiveFrom },
                },
            },
        });
        const mutations: Array<(value: SiteTrafficOperations["visitorMix"]) => void> = [
            (value) => {
                value.status = "ready";
            },
            (value) => {
                value.firstObservedVisitors = 0;
            },
            (value) => {
                value.returningVisitors = 0;
            },
            (value) => {
                value.firstObservedRate = 0;
            },
            (value) => {
                value.returningRate = 0;
            },
            (value) => {
                value.lookbackFrom = "2025-11-10T00:00:00+08:00";
            },
        ];
        for (const mutate of mutations) {
            const invalid = structuredClone(snapshot);
            mutate(invalid.insights.operations.visitorMix);
            await expect(withResponse(invalid, () => getSiteTrafficOverview(boundaryQuery))).rejects.toThrow("访问统计概览响应无效");
        }
    });

    test("operations anomalies accepts threshold boundaries, zero baselines and insufficient samples", async () => {
        const examples = [
            { current: { visitors: 40, pageViews: 60, visits: 39, actions: 0 }, previous: { visitors: 30, pageViews: 100, visits: 30, actions: 29 }, statuses: ["increase", "decrease", "stable", "insufficient_sample"] },
            { current: { visitors: 0, pageViews: 110, visits: 70, actions: 0 }, previous: { visitors: 0, pageViews: 100, visits: 100, actions: 30 }, statuses: ["zero_baseline", "stable", "decrease", "decrease"] },
        ];
        for (const { current, previous, statuses } of examples) {
            const snapshot: SiteTrafficOverview = { ...valid, kpi: current, comparison: { ...valid.comparison, status: "ready", kpi: previous }, insights: insightsFixture() };
            snapshot.insights.operations = trafficOperationsFixture(snapshot);
            expect(snapshot.insights.operations.anomalies.metrics.map((metric) => metric.status)).toEqual(statuses);
            await expect(withResponse(snapshot, () => getSiteTrafficOverview(query))).resolves.toEqual(snapshot);
        }
    });

    test("operations anomalies rejects wrong rules, status, metric order and current/previous derivations", async () => {
        const base: SiteTrafficOverview = {
            ...valid,
            kpi: { visitors: 40, pageViews: 60, visits: 39, actions: 0 },
            comparison: { ...valid.comparison, status: "ready", kpi: { visitors: 30, pageViews: 100, visits: 30, actions: 29 } },
            insights: insightsFixture(),
        };
        base.insights.operations = trafficOperationsFixture(base);
        const mutations: Array<(value: SiteTrafficOperations["anomalies"]) => void> = [
            (value) => {
                value.rules = null as never;
            },
            (value) => {
                value.rules.minimumBaseline = 29 as never;
            },
            (value) => {
                value.rules.minimumAbsoluteChange = 9 as never;
            },
            (value) => {
                value.rules.relativeThreshold = 0.31 as never;
            },
            (value) => {
                value.status = "insufficient_history";
            },
            (value) => {
                value.status = "unknown" as never;
            },
            (value) => {
                value.metrics = null as never;
            },
            (value) => {
                value.metrics.pop();
            },
            (value) => {
                value.metrics.push({ ...value.metrics[0] });
            },
            (value) => {
                value.metrics[0] = null as never;
            },
            (value) => {
                value.metrics[1].key = value.metrics[0].key;
            },
            (value) => {
                [value.metrics[0], value.metrics[1]] = [value.metrics[1], value.metrics[0]];
            },
            (value) => {
                value.metrics[0].key = "private-server-key" as never;
            },
            (value) => {
                value.metrics[0].previous = null;
            },
            (value) => {
                value.metrics[0].relativeChange = null;
            },
            (value) => {
                value.metrics[0].relativeChange = Number.NaN;
            },
            (value) => {
                value.metrics[0].relativeChange = Number.POSITIVE_INFINITY;
            },
            (value) => {
                value.metrics[0].relativeChange = -1 / 3;
            },
            (value) => {
                value.metrics[0].status = "stable";
            },
            (value) => {
                value.metrics[1].status = "increase";
            },
            (value) => {
                value.metrics[2].status = "increase";
            },
            (value) => {
                value.metrics[3].status = "decrease";
            },
            (value) => {
                value.metrics[0].status = "unknown" as never;
            },
        ];
        for (const mutate of mutations) {
            const snapshot = structuredClone(base);
            mutate(snapshot.insights.operations.anomalies);
            await expect(withResponse(snapshot, () => getSiteTrafficOverview(query))).rejects.toThrow("访问统计概览响应无效");
        }
        for (const index of [0, 1, 2, 3])
            for (const field of ["current", "previous"] as const) {
                const snapshot = structuredClone(base);
                const metric = snapshot.insights.operations.anomalies.metrics[index];
                metric[field] = metric[field]! + 1;
                await expect(withResponse(snapshot, () => getSiteTrafficOverview(query))).rejects.toThrow("访问统计概览响应无效");
            }
        for (const patch of [{ status: "stable" }, { relativeChange: 0 }]) {
            const snapshot = structuredClone(valid);
            Object.assign(snapshot.insights.operations.anomalies.metrics[0], patch);
            await expect(withResponse(snapshot, () => getSiteTrafficOverview(query))).rejects.toThrow("访问统计概览响应无效");
        }
        for (const status of ["outside_retention", "insufficient_history"] as const) {
            const unavailable: SiteTrafficOverview = { ...valid, comparison: { ...valid.comparison, status, kpi: null }, insights: insightsFixture() };
            unavailable.insights.operations = trafficOperationsFixture(unavailable);
            for (const patch of [{ previous: 0 }, { relativeChange: 0 }, { status: "zero_baseline" }]) {
                const snapshot = structuredClone(unavailable);
                Object.assign(snapshot.insights.operations.anomalies.metrics[0], patch);
                await expect(withResponse(snapshot, () => getSiteTrafficOverview(query))).rejects.toThrow("访问统计概览响应无效");
            }
        }
    });

    test("today validates server date, full cross-midnight window, ordered elapsed hours and partial flags", async () => {
        for (const value of [
            undefined,
            null,
            {},
            { ...today, timeZone: "UTC" },
            { ...today, date: "2026-11-10" },
            { ...today, asOf: "2026-11-11" },
            { ...today, active: null },
            { ...today, active: { ...today.active, visitors: -1 } },
            { ...today, active: { ...today.active, windowFrom: "2026-11-10T16:00:00Z" } },
            { ...today, active: { ...today.active, windowTo: "2026-11-10T16:02:29Z" } },
            { ...today, hours: [] },
            { ...today, hours: null },
            { ...today, hours: [{ ...today.hours[0], hour: 1 }] },
            { ...today, hours: [{ ...today.hours[0], hour: 0.5 }] },
            { ...today, hours: [{ ...today.hours[0], partial: false }] },
            { ...today, hours: [{ ...today.hours[0], partial: "true" }] },
            { ...today, hours: [today.hours[0], { ...today.hours[0], hour: 1, partial: false }] },
        ])
            await expect(withResponse(value, () => getSiteTrafficToday())).rejects.toThrow("今日访问统计响应无效");
        for (const key of ["visitors", "pageViews", "visits", "actions"]) {
            await expect(withResponse({ ...today, hours: [{ ...today.hours[0], [key]: -1 }] }, () => getSiteTrafficToday())).rejects.toThrow(TypeError);
        }
        await expect(withResponse(today, () => getSiteTrafficToday())).resolves.toEqual(today);
        const zero = { ...today, active: { ...today.active, visitors: 0 }, hours: [{ hour: 0, partial: true, visitors: 0, pageViews: 0, visits: 0, actions: 0 }] };
        await expect(withResponse(zero, () => getSiteTrafficToday())).resolves.toEqual(zero);
    });

    test("every metric requires a non-negative finite safe integer and unknown dimensions never reach UI", async () => {
        for (const bad of [-1, 0.5, Number.POSITIVE_INFINITY, Number.NaN, Number.MAX_SAFE_INTEGER + 1, "0", null, undefined]) {
            for (const key of ["visitors", "pageViews", "visits", "actions"]) {
                await expect(withResponse({ ...valid, kpi: { ...valid.kpi, [key]: bad } }, () => getSiteTrafficOverview(query))).rejects.toThrow(TypeError);
                await expect(withResponse({ ...valid, trend: [{ ...valid.trend[0], [key]: bad }] }, () => getSiteTrafficOverview(query))).rejects.toThrow(TypeError);
            }
            for (const key of ["visitors", "pageViews", "visits"]) await expect(withResponse({ ...valid, pages: [{ ...valid.pages[0], [key]: bad }] }, () => getSiteTrafficOverview(query))).rejects.toThrow(TypeError);
            for (const key of ["visitors", "count"]) await expect(withResponse({ ...valid, actions: [{ ...valid.actions[0], [key]: bad }] }, () => getSiteTrafficOverview(query))).rejects.toThrow(TypeError);
        }
        for (const value of [
            { ...valid, pages: [{ ...valid.pages[0], page: "private-server-key" }] },
            { ...valid, actions: [{ ...valid.actions[0], page: "private-server-key" }] },
            { ...valid, actions: [{ ...valid.actions[0], action: "private-server-key" }] },
        ]) {
            const error = await withResponse(value, () => getSiteTrafficOverview(query)).catch((value) => value);
            expect(error).toBeInstanceOf(TypeError);
            expect(error.message).toBe("访问统计概览响应无效");
            expect(error.message).not.toContain("private");
        }
    });
});
