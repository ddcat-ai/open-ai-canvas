import { expect, test } from "bun:test";
import Papa from "papaparse";

import { siteTrafficPageLabels } from "../src/lib/site-traffic";
import { createTrafficCsv, trafficCsvFileName, type TrafficCsvKind } from "../src/pages/admin/traffic/traffic-csv";
import type { SiteTrafficOverview } from "../src/services/api/site-traffic";
import { trafficOperationsFixture } from "./fixtures/site-traffic-operations.fixture";

function snapshot(): SiteTrafficOverview {
    const zeroActions = { open_create: 0, new_canvas: 0, open_ecommerce: 0, creation_submit_text: 0, creation_submit_image: 0, creation_submit_video: 0, creation_submit_agent: 0 };
    const value: SiteTrafficOverview = {
        range: { from: "2026-11-10", to: "2026-11-11", timeZone: "Asia/Shanghai" },
        retentionDays: 365,
        availableFrom: "2026-11-10T16:00:00Z",
        asOf: "2026-11-10T16:05:00Z",
        effectiveFrom: "2026-11-09T16:00:00Z",
        effectiveTo: "2026-11-10T16:05:00Z",
        comparison: { range: { from: "2026-11-08", to: "2026-11-09", timeZone: "Asia/Shanghai" }, effectiveFrom: "2026-11-07T16:00:00Z", effectiveTo: "2026-11-08T16:05:00Z", status: "insufficient_history", kpi: null },
        kpi: { pageViews: 4, visitors: 2, visits: 2, actions: 1 },
        engagement: { visits: 2, engagedVisits: 1, rate: 0.5 },
        trend: [
            { date: "2026-11-10", pageViews: 4, visitors: 2, visits: 2, actions: 1 },
            { date: "2026-11-11", pageViews: 0, visitors: 0, visits: 0, actions: 0 },
        ],
        pages: [
            { page: "create", pageViews: 4, visitors: 2, visits: 2 },
            { page: "inspirations", pageViews: 1, visitors: 1, visits: 1 },
            { page: "assets", pageViews: 0, visitors: 0, visits: 0 },
            { page: "history", pageViews: 1, visitors: 1, visits: 1 },
        ],
        actions: [
            { page: "create", action: "open_create", count: 2, visitors: 2 },
            { page: "canvas_list", action: "new_canvas", count: 1, visitors: 1 },
        ],
        insights: {
            heatmap: Array.from({ length: 168 }, (_, index) => ({ weekday: Math.floor(index / 24) + 1, hour: index % 24, pageViews: null, hours: 0, completedHours: 0, partial: false, historyStatus: "outside_range" })),
            featureTrend: [
                { date: "2026-11-10", partial: false, historyStatus: "unknown", counts: null },
                { date: "2026-11-11", partial: true, historyStatus: "retained", counts: zeroActions },
            ],
            // unsupported/mixed 仅隔离 CSV 协议投影；不是当前后端会返回的页面状态。
            pageEngagement: [
                { page: "create", measurement: "supported", visits: 4, engagedVisits: 1, rate: 0.25 },
                { page: "inspirations", measurement: "unsupported", visits: 1, engagedVisits: null, rate: null },
                { page: "assets", measurement: "supported", visits: 0, engagedVisits: 0, rate: null },
                { page: "tools_image", measurement: "mixed", visits: 12, engagedVisits: null, rate: null },
            ],
            depth: {
                visits: 3,
                buckets: [
                    { key: "1", visits: 1, rate: 1 / 3 },
                    { key: "2-3", visits: 1, rate: 1 / 3 },
                    { key: "4+", visits: 1, rate: 1 / 3 },
                ],
            },
            operations: trafficOperationsFixture(),
        },
    };
    value.insights.operations = trafficOperationsFixture(value);
    return value;
}

function parse(csv: string) {
    const result = Papa.parse<Record<string, string>>(csv, { header: true });
    expect(result.errors).toEqual([]);
    return result;
}

const commonFields = ["rangeFrom", "rangeTo", "timeZone", "asOf", "effectiveFrom", "effectiveTo", "availableFrom", "retentionDays", "scope", "sourceFilter", "coverageNote"];

test("每日CSV固定白名单列、全日期与覆盖元数据，真零和未知状态分别保留", () => {
    const value = snapshot();
    const csv = createTrafficCsv(value, "daily", siteTrafficPageLabels.create);
    const result = parse(csv);
    expect(result.meta.fields).toEqual([...commonFields, "recordStatus", "date", "partial", "historyStatus", "pageViews", "visitors", "visits", "actions"]);
    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toMatchObject({
        rangeFrom: "2026-11-10",
        rangeTo: "2026-11-11",
        timeZone: "Asia/Shanghai",
        asOf: value.asOf,
        effectiveFrom: value.effectiveFrom,
        effectiveTo: value.effectiveTo,
        availableFrom: value.availableFrom,
        retentionDays: "365",
        scope: "仅应用日期范围",
        sourceFilter: "不适用",
        historyStatus: "unknown",
        partial: "false",
        pageViews: "4",
    });
    expect(result.data[1]).toMatchObject({ date: "2026-11-11", historyStatus: "retained", partial: "true", pageViews: "0", visitors: "0", visits: "0", actions: "0" });
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv.match(/\uFEFF/g)).toHaveLength(1);
    expect(csv).toContain("\r\n");
    expect(trafficCsvFileName(value, "daily")).toBe("traffic-daily-2026-11-10-2026-11-11-2026-11-10T16-05-00Z.csv");
});

test("页面CSV按键合并独立分母，N-A/null/真零/待同步不互相伪装且不随来源筛选", () => {
    const value = snapshot();
    const result = parse(createTrafficCsv(value, "pages", siteTrafficPageLabels.create));
    expect(result.meta.fields).toEqual([...commonFields, "recordStatus", "page", "pageLabel", "pageViews", "visitors", "pageVisits", "measurement", "engagementVisits", "engagedVisits", "engagementRate", "engagementStatus"]);
    expect(result.data).toHaveLength(5);
    expect(result.data.find((row) => row.page === "create")).toMatchObject({ pageViews: "4", pageVisits: "2", engagementVisits: "4", engagedVisits: "1", engagementRate: "0.25", measurement: "supported" });
    expect(result.data.find((row) => row.page === "inspirations")).toMatchObject({ engagementStatus: "unsupported", measurement: "unsupported", engagementVisits: "1", engagedVisits: "", engagementRate: "" });
    expect(result.data.find((row) => row.page === "assets")).toMatchObject({ pageViews: "0", engagementStatus: "no_pv_visits", engagedVisits: "0", engagementRate: "" });
    expect(result.data.find((row) => row.page === "history")).toMatchObject({ engagementStatus: "pending", measurement: "", engagementRate: "" });
    expect(result.data.find((row) => row.page === "tools_image")).toMatchObject({ pageViews: "", pageVisits: "", engagementStatus: "mixed", measurement: "mixed", engagementVisits: "12", engagedVisits: "", engagementRate: "" });
    for (const row of result.data) expect(row.sourceFilter).toBe("不适用");
});

test("仅功能CSV继承当前来源筛选并注明作用域，真零次数照常导出", () => {
    const value = snapshot();
    value.actions[0]!.count = 0;
    const filtered = parse(createTrafficCsv(value, "actions", siteTrafficPageLabels.create));
    expect(filtered.meta.fields).toEqual([...commonFields, "recordStatus", "action", "actionLabel", "page", "pageLabel", "count", "visitors"]);
    expect(filtered.data).toHaveLength(1);
    expect(filtered.data[0]).toMatchObject({ scope: "应用日期与当前来源筛选", sourceFilter: siteTrafficPageLabels.create, action: "open_create", page: "create", count: "0" });
    expect(parse(createTrafficCsv(value, "actions")).data).toHaveLength(2);
    expect(() => createTrafficCsv(value, "actions", "__proto__")).toThrow("来源筛选无效");
});

test("两工具分别导出并独立筛选来源，停采与旧工具箱键拒绝进入排行CSV", () => {
    const value = snapshot();
    const toolPages = ["tools_image", "tools_video"] as const;
    value.pages = toolPages.map((page) => ({ page, pageViews: 1, visitors: 1, visits: 1 }));
    value.actions = toolPages.map((page) => ({ page, action: "open_create", count: 1, visitors: 1 }));
    value.insights.pageEngagement = toolPages.map((page) => ({ page, measurement: "supported", visits: 1, engagedVisits: 1, rate: 1 }));
    const pages = parse(createTrafficCsv(value, "pages")).data;
    expect(pages.map((row) => [row.page, row.pageLabel])).toEqual([
        ["tools_image", "图片生成"],
        ["tools_video", "视频生成"],
    ]);
    for (const page of toolPages) {
        const rows = parse(createTrafficCsv(value, "actions", siteTrafficPageLabels[page])).data;
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ page, pageLabel: siteTrafficPageLabels[page], sourceFilter: siteTrafficPageLabels[page] });
        expect(rows[0]!.coverageNote).toContain("旧工具箱汇总不参与统计");
    }
    for (const page of ["welcome", "plugins", "share", "library", "runninghub", "other", "tools", "auth", "account"]) {
        const invalidPages = snapshot();
        invalidPages.pages[0]!.page = page as (typeof value.pages)[number]["page"];
        expect(() => createTrafficCsv(invalidPages, "pages")).toThrow("字段无效");
        const invalidActions = snapshot();
        invalidActions.actions[0]!.page = page as (typeof value.actions)[number]["page"];
        expect(() => createTrafficCsv(invalidActions, "actions")).toThrow("字段无效");
        const invalidEngagement = snapshot();
        invalidEngagement.insights.pageEngagement[0]!.page = page as (typeof value.insights.pageEngagement)[number]["page"];
        expect(() => createTrafficCsv(invalidEngagement, "pages")).toThrow("字段无效");
    }
    for (const source of ["欢迎页", "插件", "分享画布", "资源库", "RunningHub", "其他页面", "工具箱", "登录与注册", "账号设置"]) {
        expect(() => createTrafficCsv(snapshot(), "actions", source)).toThrow("来源筛选无效");
    }
});

test("Papa成熟转义往返引号/逗号/CRLF，UTF8 BOM只写一次且无手工协议替代", () => {
    const value = snapshot();
    const text = '普通文本,"双引号"\r\n下一行\n末行';
    value.availableFrom = text;
    const csv = createTrafficCsv(value, "daily");
    expect(csv).toContain('"普通文本,""双引号""\r\n下一行\n末行"');
    expect(parse(csv).data[0]!.availableFrom).toBe(text);
    expect(csv.match(/\uFEFF/g)).toHaveLength(1);
    expect(Array.from(new TextEncoder().encode(csv).slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
});

test("CSV公式防护覆盖前导空白/控制字符后的=+-@与Tab/CR/LF，正常文本不误改", () => {
    const unsafe = ["=1+1", "+SUM(1,2)", "-1+2", "@SUM(1)", "  =1", "\t\u0000+1", "\u0001\u0002-1", "\u007f\u0085@1", "\u00a0\u2003=1", "\t正文", "\r正文", "\n正文", " \r\n =1"];
    for (const input of unsafe) {
        const value = snapshot();
        value.availableFrom = input;
        expect(parse(createTrafficCsv(value, "daily")).data[0]!.availableFrom).toBe(`'${input}`);
    }
    for (const input of ["普通文本", "1+2", "safe=value", "  ordinary", "O'Reilly", "0"]) {
        const value = snapshot();
        value.availableFrom = input;
        expect(parse(createTrafficCsv(value, "daily")).data[0]!.availableFrom).toBe(input);
    }
});

test("显式投影拒绝传播任意响应附带私密字段，页面/操作非白名单键不能导出", () => {
    const value = snapshot();
    const secret = "fixture-private-never-export";
    const privateFields = { visitorId: secret, sessionId: secret, eventId: secret, accountId: secret, ip: secret, url: secret, token: secret, prompt: secret, unknown: secret };
    Object.assign(value, privateFields);
    Object.assign(value.range, privateFields);
    Object.assign(value.trend[0]!, privateFields);
    Object.assign(value.pages[0]!, privateFields);
    Object.assign(value.actions[0]!, privateFields);
    Object.assign(value.insights.pageEngagement[0]!, privateFields);
    Object.assign(value.insights.operations, privateFields);
    Object.assign(value.insights.operations.visitorMix, privateFields);
    Object.assign(value.insights.operations.endpoints.first.pages[0]!, privateFields);
    Object.assign(value.insights.operations.paths.rows[0]!, privateFields);
    Object.assign(value.insights.operations.funnel.steps[0]!, privateFields);
    Object.assign(value.insights.operations.anomalies.metrics[0]!, privateFields);
    for (const kind of ["daily", "pages", "actions"] as const) {
        const csv = createTrafficCsv(value, kind);
        expect(csv).not.toContain(secret);
        const columns = parse(csv).meta.fields!;
        for (const key of Object.keys(privateFields)) expect(columns).not.toContain(key);
    }
    value.pages[0]!.page = "__proto__" as (typeof value.pages)[number]["page"];
    expect(() => createTrafficCsv(value, "pages")).toThrow("字段无效");
    value.actions[0]!.action = "constructor" as (typeof value.actions)[number]["action"];
    expect(() => createTrafficCsv(value, "actions")).toThrow("字段无效");
});

test("空结果导出元数据行且无伪造零记录，不修改成功快照原对象", () => {
    const value = snapshot();
    value.trend = [];
    value.pages = [];
    value.actions = [];
    value.insights.pageEngagement = [];
    const before = JSON.stringify(value);
    for (const kind of ["daily", "pages", "actions"] as const satisfies readonly TrafficCsvKind[]) {
        const row = parse(createTrafficCsv(value, kind)).data[0]!;
        expect(row.recordStatus).toBe("empty");
        expect(row.rangeFrom).toBe(value.range.from);
        expect(row.asOf).toBe(value.asOf);
        expect(row[kind === "daily" ? "pageViews" : kind === "pages" ? "engagementRate" : "count"]).toBe("");
    }
    expect(JSON.stringify(value)).toBe(before);
});
