import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from "axios";
import { Window } from "happy-dom";
import Papa from "papaparse";
import type { SiteTrafficHeatmapCell, SiteTrafficInsights, SiteTrafficOverview, SiteTrafficToday } from "../../src/services/api/site-traffic";
import { trafficOperationsFixture } from "./site-traffic-operations.fixture";

const dom = new Window({ url: "http://localhost:3000/admin/traffic" });
const globals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    localStorage: dom.localStorage,
    sessionStorage: dom.sessionStorage,
    HTMLElement: dom.HTMLElement,
    HTMLBodyElement: dom.HTMLBodyElement,
    HTMLHtmlElement: dom.HTMLHtmlElement,
    HTMLInputElement: dom.HTMLInputElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement,
    HTMLButtonElement: dom.HTMLButtonElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    Event: dom.Event,
    CustomEvent: dom.CustomEvent,
    MouseEvent: dom.MouseEvent,
    PointerEvent: dom.PointerEvent,
    KeyboardEvent: dom.KeyboardEvent,
    ResizeObserver: dom.ResizeObserver,
    MutationObserver: dom.MutationObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { MemoryRouter } = await import("react-router");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { App, ConfigProvider } = await import("antd");
const downloads: Array<{ blob: Blob; fileName: string }> = [];
// 只截获文件下载副作用；真实 AdminExportButton、PapaParse 与快照投影继续执行。
mock.module("file-saver", () => ({
    saveAs: (blob: Blob, fileName: string) => {
        downloads.push({ blob, fileName });
    },
}));
// 仅隔离无关导航/品牌依赖；页面、共享admin-ui、日期输入、Select、Table与Query均为真实组件。
mock.module("../../src/pages/admin/components/admin-shell", () => ({
    AdminPageFrame: ({ title, children }: { title: string; children: React.ReactNode }) => (
        <main data-admin-root className="admin-shell" data-admin-density="compact">
            <h1>{title}</h1>
            {children}
        </main>
    ),
}));
// happy-dom无实际图表布局，只替换绘制外壳并保留页面提供的真实曲线/数据/动画属性。
mock.module("recharts", () => ({
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    LineChart: ({ data, children }: { data: unknown[]; children: React.ReactNode }) => (
        <div data-chart="traffic" data-points={JSON.stringify(data)}>
            {children}
        </div>
    ),
    ComposedChart: ({ data, children }: { data: unknown[]; children: React.ReactNode }) => (
        <div data-chart="traffic" data-points={JSON.stringify(data)}>
            {children}
        </div>
    ),
    Area: ({ dataKey, isAnimationActive, connectNulls }: { dataKey: unknown; isAnimationActive: boolean; connectNulls: boolean }) => (
        <span data-area={typeof dataKey === "string" ? dataKey : "fn"} data-animated={String(isAnimationActive)} data-connect-nulls={String(connectNulls)} />
    ),
    Line: ({ dataKey, isAnimationActive, connectNulls }: { dataKey: string; isAnimationActive: boolean; connectNulls: boolean }) => <span data-line={dataKey} data-animated={String(isAnimationActive)} data-connect-nulls={String(connectNulls)} />,
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    Legend: () => null,
}));
const { default: TrafficPage } = await import("../../src/pages/admin/traffic/traffic-page");
const { registerTrafficOperationsCases } = await import("./site-traffic-operations.cases");
const { apiClient } = await import("../../src/services/api/request");
const { siteTrafficPageLabels, siteTrafficActionLabels } = await import("../../src/lib/site-traffic");
const originalAdapter = apiClient.defaults.adapter;
const NOW = Date.parse("2026-11-10T16:05:00.000Z");
const endpoint = "/admin/traffic/overview";
const todayEndpoint = "/admin/traffic/today";
let hidden = false;
Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot> | undefined;
let client: InstanceType<typeof QueryClient>;
let clock: ReturnType<typeof spyOn>;
let calls: InternalAxiosRequestConfig[];
let code: number;
let patch: Partial<SiteTrafficOverview>;
let todayPatch: Partial<SiteTrafficToday>;
let todayCode: number;
let reply: (config: InternalAxiosRequestConfig) => AxiosResponse | Promise<AxiosResponse>;
let todayReply: typeof reply;
const overviewCalls = () => calls.filter((config) => config.url === endpoint);
const todayCalls = () => calls.filter((config) => config.url === todayEndpoint);
function insights(from: string, to: string, cutoff: number): SiteTrafficInsights {
    const hour = 3_600_000;
    const day = 24 * hour;
    const start = Date.parse(`${from}T00:00:00+08:00`);
    const available = Date.parse("2026-11-10T16:00:00Z");
    const cells: SiteTrafficHeatmapCell[] = Array.from({ length: 168 }, (_, index) => ({
        weekday: Math.floor(index / 24) + 1,
        hour: index % 24,
        pageViews: null,
        hours: 0,
        completedHours: 0,
        partial: false,
        historyStatus: "outside_range",
    }));
    const knownHours = new Map<SiteTrafficHeatmapCell, number>();
    for (let time = start; time < cutoff; time += hour) {
        const shanghai = new Date(time + 8 * hour);
        const weekday = (shanghai.getUTCDay() + 6) % 7;
        const cell = cells[weekday * 24 + shanghai.getUTCHours()]!;
        cell.hours++;
        if (time + hour <= cutoff) cell.completedHours++;
        else cell.partial = true;
        if (time >= available) knownHours.set(cell, (knownHours.get(cell) ?? 0) + 1);
    }
    for (const cell of cells) {
        if (!cell.hours) continue;
        const known = knownHours.get(cell) ?? 0;
        cell.historyStatus = !known ? "unknown" : known < cell.hours ? "partial" : "retained";
        cell.pageViews = known ? (cell.partial ? 7 : 0) : null;
    }
    const days = Math.round((Date.parse(`${to}T00:00:00+08:00`) - start) / day) + 1;
    return {
        heatmap: cells,
        featureTrend: Array.from({ length: days }, (_, index) => {
            const date = new Date(start + index * day + 8 * hour).toISOString().slice(0, 10);
            const unknown = start + (index + 1) * day <= available;
            return {
                date,
                partial: date === "2026-11-11",
                historyStatus: unknown ? "unknown" : "retained",
                counts: unknown
                    ? null
                    : {
                          open_create: 2,
                          new_canvas: 2,
                          open_ecommerce: 0,
                          creation_submit_text: 0,
                          creation_submit_image: 0,
                          creation_submit_video: 0,
                          creation_submit_agent: 0,
                      },
            };
        }),
        pageEngagement: [
            { page: "create", measurement: "supported", visits: 4, engagedVisits: 2, rate: 0.5 },
            { page: "canvas_list", measurement: "supported", visits: 2, engagedVisits: 1, rate: 0.5 },
        ],
        depth: {
            visits: 5,
            buckets: [
                { key: "1", visits: 2, rate: 0.4 },
                { key: "2-3", visits: 2, rate: 0.4 },
                { key: "4+", visits: 1, rate: 0.2 },
            ],
        },
        operations: trafficOperationsFixture(),
    };
}
function overview(config: InternalAxiosRequestConfig): SiteTrafficOverview {
    const { from, to } = config.params as { from: string; to: string };
    const day = 86_400_000;
    const start = Date.parse(`${from}T00:00:00+08:00`);
    const end = Date.parse(`${to}T00:00:00+08:00`) + day;
    const cutoff = Math.min(end, NOW);
    const previousStart = start - (end - start);
    const shanghaiDay = (time: number) => new Date(time + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const value: SiteTrafficOverview = {
        range: { from, to, timeZone: "Asia/Shanghai" },
        retentionDays: 365,
        availableFrom: "2026-11-10T16:00:00Z",
        asOf: new Date(NOW).toISOString(),
        effectiveFrom: new Date(start).toISOString(),
        effectiveTo: new Date(cutoff).toISOString(),
        engagement: { visits: 5, engagedVisits: 3, rate: 0.6 },
        comparison: {
            range: { from: shanghaiDay(previousStart), to: shanghaiDay(start - day), timeZone: "Asia/Shanghai" },
            effectiveFrom: new Date(previousStart).toISOString(),
            effectiveTo: new Date(previousStart + cutoff - start).toISOString(),
            status: "insufficient_history",
            kpi: null,
        },
        kpi: { visitors: 9, pageViews: 17, visits: 5, actions: 4 },
        trend: [
            { date: from, visitors: 6, pageViews: 7, visits: 2, actions: 1 },
            { date: to, visitors: 6, pageViews: 10, visits: 3, actions: 3 },
        ],
        pages: [
            { page: "create", pageViews: 10, visitors: 7, visits: 3 },
            { page: "canvas_list", pageViews: 7, visitors: 6, visits: 2 },
        ],
        actions: [
            { action: "open_create", page: "create", count: 2, visitors: 2 },
            { action: "new_canvas", page: "canvas_list", count: 2, visitors: 2 },
        ],
        insights: insights(from, to, cutoff),
        ...patch,
    };
    value.insights.operations = trafficOperationsFixture(value);
    return value;
}
function today(): SiteTrafficToday {
    return {
        date: "2026-11-11",
        timeZone: "Asia/Shanghai",
        asOf: new Date(NOW).toISOString(),
        active: { visitors: 3, windowFrom: new Date(NOW - 300_000).toISOString(), windowTo: new Date(NOW).toISOString() },
        hours: [{ hour: 0, partial: true, visitors: 3, pageViews: 7, visits: 2, actions: 1 }],
        ...todayPatch,
    };
}
function response(config: InternalAxiosRequestConfig): AxiosResponse {
    const recent = config.url === todayEndpoint;
    const statusCode = recent ? todayCode : code;
    return { config, status: 200, statusText: "OK", headers: {}, data: { code: statusCode, data: recent ? today() : overview(config), msg: statusCode ? (recent ? "近期统计专项读取失败" : "访问统计专项读取失败") : "ok" } };
}
const adapter: AxiosAdapter = async (config) => {
    calls.push(config);
    if (config.method !== "get" || (config.url !== endpoint && config.url !== todayEndpoint)) throw new Error("专项禁止真实网络或其他业务请求");
    return config.url === todayEndpoint ? todayReply(config) : reply(config);
};
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((yes) => {
        resolve = yes;
    });
    return { promise, resolve };
}
async function settle() {
    for (let index = 0; index < 4; index++)
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
}
async function render(contents: React.ReactNode = <TrafficPage />) {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
        root!.render(
            <ConfigProvider wave={{ disabled: true }} theme={{ token: { motion: false } }} button={{ autoInsertSpace: false }}>
                <App>
                    <QueryClientProvider client={client}>
                        <MemoryRouter initialEntries={["/admin/traffic"]}>{contents}</MemoryRouter>
                    </QueryClientProvider>
                </App>
            </ConfigProvider>,
        );
    });
    await settle();
}
async function unmount() {
    if (root)
        await act(async () => {
            root!.unmount();
        });
    root = undefined;
    host?.remove();
}
function button(label: string, scope: ParentNode = host) {
    const target = Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find((node) => node.textContent?.trim() === label);
    expect(target).toBeDefined();
    return target!;
}
async function click(label: string, scope: ParentNode = host) {
    const target = button(label, scope);
    expect(target.disabled).toBe(false);
    await act(async () => {
        target.click();
    });
    await settle();
}
async function type(label: string, value: string) {
    const target = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
    expect(target).not.toBeNull();
    await act(async () => {
        Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!.call(target, value);
        target!.dispatchEvent(new dom.Event("input", { bubbles: true }));
        target!.dispatchEvent(new dom.Event("change", { bubbles: true }));
    });
    await settle();
}
function kpis() {
    return Array.from(host.querySelectorAll(".admin-stat-tile-value")).map((node) => node.textContent);
}
function lines() {
    return Array.from(host.querySelectorAll("[data-line]")).map((node) => node.getAttribute("data-line"));
}
function ranking(id: string) {
    return host.querySelector(`#${id}`)!.closest("section")!;
}
async function selectSource(label: string, ariaLabel = "功能排行来源页面") {
    const input = host.querySelector<HTMLInputElement>(`[role="combobox"][aria-label="${ariaLabel}"]`);
    expect(input).not.toBeNull();
    await act(async () => {
        input!.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", keyCode: 40, bubbles: true }));
    });
    await settle();
    const option = Array.from(document.querySelectorAll<HTMLElement>(".ant-select-item-option")).find((node) => node.textContent?.trim() === label);
    expect(option).toBeDefined();
    await act(async () => {
        option!.click();
    });
    await settle();
}
beforeEach(() => {
    clock = spyOn(Date, "now").mockReturnValue(NOW);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    calls = [];
    downloads.length = 0;
    code = 0;
    todayCode = 0;
    patch = {};
    todayPatch = {};
    reply = response;
    todayReply = response;
    hidden = false;
    apiClient.defaults.adapter = adapter;
});
afterEach(async () => {
    try {
        await unmount();
        client.clear();
    } finally {
        clock.mockRestore();
    }
});
afterAll(async () => {
    apiClient.defaults.adapter = originalAdapter;
    mock.restore();
    await dom.happyDOM.abort();
    for (const [key, descriptor] of globals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

test("真实页从共享client读取上海日期，范围UV直接使用服务端而不相加日值", async () => {
    await render();
    expect(overviewCalls()).toHaveLength(1);
    expect(todayCalls()).toHaveLength(1);
    expect(calls[0]!.params).toEqual({ from: "2026-11-05", to: "2026-11-11" });
    expect(calls[0]!.withCredentials).toBe(true);
    expect(calls[0]!.signal).toBeDefined();
    expect(kpis()).toEqual(["9", "17", "5", "4"]);
    expect(lines()).toEqual(["pageViews", "visitors", "visits"]);
    expect(host.textContent).toContain("最早保留事件：2026-11-11 00:00");
    expect(host.textContent).toContain("这不是准确启用时间");
    expect(host.querySelector("details")?.open).toBe(false);
    expect(host.textContent).toContain("DNT / GPC");
    expect(host.querySelectorAll('[aria-label="导出当前成功快照 CSV"] button')).toHaveLength(3);
    for (const node of host.querySelectorAll<HTMLButtonElement>('[aria-label="导出当前成功快照 CSV"] button')) expect(node.disabled).toBe(false);
});

test("快捷与自定义日期发新key，合法365日原样请求，366日及倒序不发请求", async () => {
    await render();
    await click("30 天");
    expect(calls.at(-1)!.params).toEqual({ from: "2026-10-13", to: "2026-11-11" });
    expect(button("30 天").getAttribute("aria-pressed")).toBe("true");
    await click("60 天");
    expect(calls.at(-1)!.params).toEqual({ from: "2026-09-13", to: "2026-11-11" });
    await type("访问统计开始日期", "2025-11-12");
    await click("应用日期");
    expect(calls.at(-1)!.params).toEqual({ from: "2025-11-12", to: "2026-11-11" });
    const length = calls.length;
    await type("访问统计开始日期", "2025-11-11");
    await click("应用日期");
    expect(calls).toHaveLength(length);
    expect(host.textContent).toContain("含今日最多 365 个自然日");
    expect(kpis()).toEqual(["未查询", "未查询", "未查询", "未查询"]);
    await type("访问统计开始日期", "2026-11-11");
    await type("访问统计结束日期", "2026-11-10");
    await click("应用日期");
    expect(host.textContent).toContain("开始日期不能晚于结束日期");
    expect(calls).toHaveLength(length);
});

test("两类趋势独立切换，只有对应曲线，真实零趋势仍绘制且遵守动画偏好", async () => {
    patch = { kpi: { visitors: 0, pageViews: 0, visits: 0, actions: 0 }, engagement: { visits: 0, engagedVisits: 0, rate: null }, pages: [], actions: [] };
    reply = (config) => {
        const result = response(config);
        result.data.data.trend = [{ date: config.params.to, visitors: 0, pageViews: 0, visits: 0, actions: 0 }];
        return result;
    };
    await render();
    expect(kpis()).toEqual(["0", "0", "0", "0"]);
    expect(host.textContent).toContain("零值表示读取成功");
    expect(lines()).toEqual(["pageViews", "visitors", "visits"]);
    await click("关键操作", host.querySelector('[aria-label="趋势视图"]')!);
    expect(lines()).toEqual(["actions"]);
    expect(button("关键操作", host.querySelector('[aria-label="趋势视图"]')!).getAttribute("aria-pressed")).toBe("true");
    for (const line of host.querySelectorAll("[data-line]")) {
        expect(line.getAttribute("data-animated")).toBe("true");
        expect(line.getAttribute("data-connect-nulls")).toBe("false");
    }
    expect(overviewCalls()).toHaveLength(1);
    expect(todayCalls()).toHaveLength(1);
});

test("初次读取与无记录不同，loading不显示零且卸载取消在途signal", async () => {
    const pending = deferred<AxiosResponse>();
    reply = () => pending.promise;
    await render();
    expect(kpis()).toEqual(["读取中…", "读取中…", "读取中…", "读取中…"]);
    expect(host.textContent).not.toContain("零值表示读取成功");
    const signal = calls[0]!.signal;
    await unmount();
    expect(signal!.aborted).toBe(true);
    pending.resolve(response(calls[0]!));
    await settle();
});

test("成功的空范围与读取中区分，最早保留事件为空不声称已有365天历史", async () => {
    patch = { availableFrom: null, kpi: { visitors: 0, pageViews: 0, visits: 0, actions: 0 }, trend: [], pages: [], actions: [] };
    await render();
    expect(kpis()).toEqual(["0", "0", "0", "0"]);
    expect(host.querySelector("[data-chart]")).toBeNull();
    expect(host.textContent).toContain("当前范围暂无采集记录");
    expect(host.textContent).toContain("最早保留事件：暂无保留事件");
    expect(host.textContent).not.toContain("正在读取当前范围");
    expect(host.textContent).toContain("不补录过去 365 天");
});

test("刷新失败不以旧KPI和排行冒充成功，重试成功后恢复真实值", async () => {
    await render();
    code = 1;
    await click("刷新");
    expect(host.textContent).toContain("访问统计读取失败");
    expect(host.textContent).toContain("访问统计专项读取失败");
    expect(kpis()).toEqual(["不可用", "不可用", "不可用", "不可用"]);
    expect(host.querySelector("[data-chart]")).toBeNull();
    expect(ranking("admin-traffic-pages-title").querySelectorAll("tbody .ant-table-row")).toHaveLength(0);
    code = 0;
    await click("重试");
    expect(kpis()).toEqual(["9", "17", "5", "4"]);
});

test("换范围取消旧请求，迟到旧范围不会替换当前结果", async () => {
    const pending = deferred<AxiosResponse>();
    reply = () => pending.promise;
    await render();
    const old = calls[0]!;
    reply = response;
    await click("30 天");
    expect(old.signal!.aborted).toBe(true);
    expect(calls.at(-1)!.params.from).toBe("2026-10-13");
    expect(kpis()).toEqual(["9", "17", "5", "4"]);
    await act(async () => {
        pending.resolve(response(old));
    });
    await settle();
    expect(host.textContent).toContain("统计范围：2026-10-13 至 2026-11-11");
    expect(JSON.parse(host.querySelector("[data-chart]")!.getAttribute("data-points")!)[0].date).toBe("2026-10-13");
});

test("来源只筛功能排行，不重查全页且KPI/趋势与热门页面保持", async () => {
    await render();
    const chart = host.querySelector("[data-chart]")!.getAttribute("data-points");
    await selectSource(siteTrafficPageLabels.create);
    expect(overviewCalls()).toHaveLength(1);
    expect(todayCalls()).toHaveLength(1);
    expect(kpis()).toEqual(["9", "17", "5", "4"]);
    expect(host.querySelector("[data-chart]")!.getAttribute("data-points")).toBe(chart);
    expect(ranking("admin-traffic-pages-title").querySelectorAll("tbody .ant-table-row")).toHaveLength(2);
    const actions = ranking("admin-traffic-actions-title");
    expect(actions.querySelectorAll("tbody .ant-table-row")).toHaveLength(1);
    expect(actions.textContent).toContain(siteTrafficActionLabels.open_create);
    expect(actions.querySelector("tbody")?.textContent).not.toContain(siteTrafficActionLabels.new_canvas);
});

test("未知页面/操作键及原型属性被真实API合同拒绝，错误态不泄漏原始输入", async () => {
    const secret = "/share/private-token?prompt=fixture-sensitive-input";
    patch = {
        pages: [
            { page: secret, pageViews: 1, visitors: 1, visits: 1 },
            { page: "constructor", pageViews: 1, visitors: 1, visits: 1 },
        ] as unknown as SiteTrafficOverview["pages"],
        actions: [
            { action: secret, page: secret, count: 1, visitors: 1 },
            { action: "__proto__", page: "toString", count: 1, visitors: 1 },
        ] as unknown as SiteTrafficOverview["actions"],
    };
    await render();
    expect(host.innerHTML).not.toContain(secret);
    expect(host.innerHTML).not.toContain("__proto__");
    expect(host.innerHTML).not.toContain('data-row-key="constructor"');
    expect(host.textContent).toContain("访问统计读取失败");
    expect(host.textContent).toContain("访问统计概览响应无效");
    expect(kpis()).toEqual(["不可用", "不可用", "不可用", "不可用"]);
    expect(ranking("admin-traffic-pages-title").querySelectorAll("tbody .ant-table-row")).toHaveLength(0);
    expect(ranking("admin-traffic-actions-title").querySelectorAll("tbody .ant-table-row")).toHaveLength(0);
});

test("四KPI等时段比较显示上期/绝对变化/增长，零基数不编百分比", async () => {
    reply = (config) => {
        const result = response(config);
        result.data.data.availableFrom = "2026-10-01T00:00:00+08:00";
        result.data.data.comparison = { ...result.data.data.comparison, status: "ready", kpi: { visitors: 6, pageViews: 0, visits: 10, actions: 4 } };
        result.data.data.insights.operations = trafficOperationsFixture(result.data.data);
        return result;
    };
    await render();
    const comparisons = Array.from(host.querySelectorAll(".admin-traffic-comparison")).map((node) => node.textContent);
    expect(comparisons[0]).toContain("上期 6变化 +3增长 +50.0%");
    expect(comparisons[1]).toContain("上期 0变化 +17上期为 0，不计算增长率");
    expect(comparisons[1]).not.toContain("%");
    expect(comparisons[2]).toContain("变化 -5增长 -50.0%");
    expect(comparisons[3]).toContain("变化 0增长 0.0%");
    expect(host.textContent).toContain("等时段比较");
    expect(host.textContent).toContain("含今日按已过去时长截取");
});

test("比较不足/保留窗外不编0或百分比，零分母参与度明确暂无访问会话", async () => {
    patch = { engagement: { visits: 0, engagedVisits: 0, rate: null } };
    await render();
    expect(host.querySelector("#admin-traffic-engagement-title")!.closest("article")!.textContent).toContain("暂无访问会话");
    for (const node of host.querySelectorAll(".admin-traffic-comparison")) {
        expect(node.textContent).toBe("历史不足，暂不可比");
        expect(node.textContent).not.toContain("%");
    }
    reply = (config) => {
        const result = response(config);
        result.data.data.comparison = { ...result.data.data.comparison, status: "outside_retention", kpi: null };
        result.data.data.insights.operations = trafficOperationsFixture(result.data.data);
        return result;
    };
    await click("刷新");
    expect(host.querySelector(".admin-traffic-comparison")!.textContent).toBe("上期超出保留窗口，暂不可比");
    expect(host.textContent).not.toMatch(/NaN|Infinity/);
});

test("今日小时与访问/操作正交，使用服务端今天且不随日期或来源重查", async () => {
    todayPatch = {
        date: "2026-11-12",
        asOf: "2026-11-11T16:02:00Z",
        active: { visitors: 3, windowFrom: "2026-11-11T15:57:00Z", windowTo: "2026-11-11T16:02:00Z" },
    };
    await render();
    expect(todayCalls()[0]!.params).toBeUndefined();
    expect(todayCalls()[0]!.signal).toBeDefined();
    expect(todayCalls()[0]!.withCredentials).toBe(true);
    await click("今日小时");
    const points = JSON.parse(host.querySelector("[data-chart]")!.getAttribute("data-points")!);
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ date: "2026-11-12 00:00", hour: 0, partial: true, pageViews: 7 });
    expect(host.textContent).toContain("进行中");
    expect(host.textContent).toContain("非准确在线人数");
    expect(host.textContent).toContain("2026-11-12 00:02");
    await click("关键操作", host.querySelector('[aria-label="趋势视图"]')!);
    expect(lines()).toEqual(["actions"]);
    await click("30 天");
    await selectSource(siteTrafficPageLabels.create);
    expect(todayCalls()).toHaveLength(1);
    expect(host.querySelector("[data-chart]")!.getAttribute("data-points")).toBe(JSON.stringify(points));
    expect(host.querySelector("#admin-traffic-engagement-title")!.closest("article")!.textContent).toContain("60.0%");
    await click("范围日趋势");
    expect(lines()).toEqual(["actions"]);
    expect(JSON.parse(host.querySelector("[data-chart]")!.getAttribute("data-points")!)[0].date).toBe("2026-10-13");
    await click("访问", host.querySelector('[aria-label="趋势视图"]')!);
    await click("PV 浏览量", host.querySelector('[aria-label="趋势图例筛选"]')!);
    expect(lines()).toEqual(["visitors", "visits"]);
    await click("UV 访客", host.querySelector('[aria-label="趋势图例筛选"]')!);
    await click("会话", host.querySelector('[aria-label="趋势图例筛选"]')!);
    expect(lines()).toEqual(["visits"]);
});

test("近期失败清空旧活跃值/小时图但不影响范围；范围失败也不清空独立今日", async () => {
    await render();
    todayCode = 1;
    await click("刷新");
    expect(kpis()).toEqual(["9", "17", "5", "4"]);
    const active = host.querySelector("#admin-traffic-active-title")!.closest("article")!;
    expect(active.querySelector(".admin-traffic-insight-value")!.textContent).toBe("不可用");
    expect(active.textContent).toContain("近期统计专项读取失败");
    await click("今日小时");
    expect(host.querySelector("[data-chart]")).toBeNull();
    todayCode = 0;
    await click("重试近期统计");
    expect(host.querySelector("[data-chart]")).not.toBeNull();
    code = 1;
    await click("刷新");
    expect(kpis()).toEqual(["不可用", "不可用", "不可用", "不可用"]);
    expect(active.querySelector(".admin-traffic-insight-value")!.textContent).toBe("3");
    expect(host.querySelector("[data-chart]")).not.toBeNull();
    await click("范围日趋势");
    expect(host.querySelector("[data-chart]")).toBeNull();
});

test("每日明细默认收起，复用日趋势前端分页并标记早期零值历史覆盖未知", async () => {
    reply = (config) => {
        const result = response(config);
        const start = Date.parse(`${config.params.from}T00:00:00Z`);
        const days = Math.round((Date.parse(`${config.params.to}T00:00:00Z`) - start) / 86_400_000) + 1;
        result.data.data.trend = Array.from({ length: days }, (_, index) => ({ date: new Date(start + index * 86_400_000).toISOString().slice(0, 10), visitors: 0, pageViews: 0, visits: 0, actions: 0 }));
        return result;
    };
    await render();
    await click("30 天");
    const daily = host.querySelector<HTMLDetailsElement>('[aria-label="每日明细"]')!;
    expect(daily.open).toBe(false);
    expect(daily.querySelectorAll("tbody .ant-table-row")).toHaveLength(10);
    expect(daily.querySelector("tbody .ant-table-row")!.textContent).toContain("2026-10-13历史覆盖未知");
    const before = calls.length;
    await act(async () => {
        daily.querySelector<HTMLButtonElement>('[aria-label="下一页"]')!.click();
    });
    await settle();
    expect(daily.querySelector("tbody .ant-table-row")!.textContent).toContain("2026-10-23");
    expect(daily.querySelectorAll("tbody .ant-table-row")).toHaveLength(10);
    expect(calls).toHaveLength(before);
    expect(kpis()).toEqual(["9", "17", "5", "4"]);
    expect(daily.textContent).toContain("会话不能累计冒充范围总计");
});

test("动态默认关闭，统一15s单飞并保留背景快照，隐藏及卸载取消两路请求", async () => {
    const scheduled = new Map<number, () => void>();
    let timerId = 800_000;
    const nativeInterval = window.setInterval.bind(window);
    const nativeClear = window.clearInterval.bind(window);
    const intervalSpy = spyOn(window, "setInterval").mockImplementation((handler, delay, ...args) => {
        if (delay !== 15_000) return nativeInterval(handler, delay, ...args);
        const id = ++timerId;
        scheduled.set(id, handler as () => void);
        return id;
    });
    const clearSpy = spyOn(window, "clearInterval").mockImplementation((id) => {
        if (!scheduled.delete(Number(id))) nativeClear(id);
    });
    try {
        await render();
        expect(button("动态刷新").getAttribute("aria-pressed")).toBe("false");
        expect(scheduled.size).toBe(0);
        await click("动态刷新");
        expect(scheduled.size).toBe(1);
        const pending = deferred<AxiosResponse>();
        reply = todayReply = () => pending.promise;
        const chart = host.querySelector("[data-chart]");
        await act(async () => {
            for (const tick of scheduled.values()) tick();
        });
        await settle();
        expect(overviewCalls()).toHaveLength(2);
        expect(todayCalls()).toHaveLength(2);
        expect(kpis()).toEqual(["9", "17", "5", "4"]);
        expect(host.querySelector("[data-chart]")).toBe(chart);
        expect(host.textContent).toContain("更新中…");
        await act(async () => {
            for (const tick of scheduled.values()) tick();
        });
        await settle();
        expect(overviewCalls()).toHaveLength(2);
        expect(todayCalls()).toHaveLength(2);
        const rangeSignal = overviewCalls().at(-1)!.signal!;
        const recentSignal = todayCalls().at(-1)!.signal!;
        await act(async () => {
            hidden = true;
            document.dispatchEvent(new dom.Event("visibilitychange"));
        });
        await settle();
        expect(rangeSignal.aborted).toBe(true);
        expect(recentSignal.aborted).toBe(true);
        expect(scheduled.size).toBe(0);
        pending.resolve(response(overviewCalls().at(-1)!));
        reply = todayReply = response;
        await act(async () => {
            hidden = false;
            document.dispatchEvent(new dom.Event("visibilitychange"));
        });
        await settle();
        expect(scheduled.size).toBe(1);
        await click("动态刷新中 · 15s");
        expect(scheduled.size).toBe(0);
        const last = deferred<AxiosResponse>();
        reply = todayReply = () => last.promise;
        await click("刷新");
        const signals = [overviewCalls().at(-1)!.signal!, todayCalls().at(-1)!.signal!];
        await unmount();
        for (const signal of signals) expect(signal.aborted).toBe(true);
        last.resolve(response(overviewCalls().at(-1)!));
        await settle();
    } finally {
        intervalSpy.mockRestore();
        clearSpy.mockRestore();
    }
});

test("减少动画偏好传入抽出的真实曲线与Area，图例显隐继续生效", async () => {
    const original = window.matchMedia.bind(window);
    const mediaSpy = spyOn(window, "matchMedia").mockImplementation((query) => {
        const media = original(query);
        if (query === "(prefers-reduced-motion: reduce)") Object.defineProperty(media, "matches", { configurable: true, value: true });
        return media;
    });
    try {
        await render();
        for (const node of host.querySelectorAll("[data-line], [data-area]")) expect(node.getAttribute("data-animated")).toBe("false");
        await click("PV 浏览量", host.querySelector('[aria-label="趋势图例筛选"]')!);
        expect(lines()).toEqual(["visitors", "visits"]);
    } finally {
        mediaSpy.mockRestore();
    }
});

test("热力图固定168格，真零/未知/无窗口分开且键盘提示包含累计与小时覆盖", async () => {
    reply = (config) => {
        const result = response(config);
        const zero = result.data.data.insights.heatmap.find((cell: SiteTrafficHeatmapCell) => cell.hours > 0 && !cell.partial)!;
        zero.historyStatus = "retained";
        zero.pageViews = 0;
        return result;
    };
    await render();
    const panel = host.querySelector(".admin-traffic-heatmap")!;
    const cells = panel.querySelectorAll<HTMLButtonElement>(".admin-traffic-heatmap-cell");
    expect(cells).toHaveLength(168);
    expect(cells[0]!.getAttribute("aria-label")).toContain("周一 00:00");
    expect(cells[167]!.getAttribute("aria-label")).toContain("周日 23:00");
    const zero = Array.from(cells).find((cell) => cell.textContent === "0")!;
    const unknown = panel.querySelector<HTMLButtonElement>('[data-history="unknown"]')!;
    const outside = panel.querySelector<HTMLButtonElement>('[data-history="outside_range"]')!;
    expect(zero.getAttribute("aria-label")).toContain("累计 0 PV，非小时平均值");
    expect(unknown.textContent).toBe("？");
    expect(unknown.getAttribute("aria-label")).toContain("历史覆盖未知");
    expect(outside.textContent).toBe("—");
    expect(outside.getAttribute("aria-label")).toContain("所选范围没有此时段");
    const current = panel.querySelector<HTMLButtonElement>('[data-partial="true"]')!;
    await act(async () => {
        current.focus();
    });
    expect(panel.querySelector('[role="tooltip"]')!.textContent).toContain("累计 7 PV");
    expect(panel.querySelector('[role="tooltip"]')!.textContent).toContain("时段出现 1 次，完整小时 0 次，含进行中小时");
    expect(document.activeElement).toBe(current);
    const before = calls.length;
    await act(async () => {
        unknown.focus();
    });
    expect(panel.querySelector('[role="tooltip"]')!.textContent).toContain("不可用，不视作 0");
    expect(calls).toHaveLength(before);
    expect(panel.querySelector('[role="region"]')!.getAttribute("tabindex")).toBe("0");
});

test("七项功能日趋势保留未知断点、图例与减少动画，切回原视图仍是独立今日小时", async () => {
    const original = window.matchMedia.bind(window);
    const mediaSpy = spyOn(window, "matchMedia").mockImplementation((query) => {
        const media = original(query);
        if (query === "(prefers-reduced-motion: reduce)") Object.defineProperty(media, "matches", { configurable: true, value: true });
        return media;
    });
    try {
        await render();
        await click("今日小时");
        await click("功能使用", host.querySelector('[aria-label="趋势视图"]')!);
        const featureKeys = Object.keys(siteTrafficActionLabels).map((key) => `features.${key}`);
        expect(lines()).toEqual(featureKeys);
        expect(button("今日小时").disabled).toBe(true);
        const points = JSON.parse(host.querySelector("[data-chart]")!.getAttribute("data-points")!);
        expect(points).toHaveLength(7);
        expect(points[0].features).toBeNull();
        expect(points[0].actions).toBeNull();
        expect(points.at(-1).features).toMatchObject({ open_create: 2, creation_submit_video: 0 });
        expect(host.textContent).toContain("未知 6 天");
        for (const line of host.querySelectorAll("[data-line]")) {
            expect(line.getAttribute("data-connect-nulls")).toBe("false");
            expect(line.getAttribute("data-animated")).toBe("false");
        }
        const legend = host.querySelector('[aria-label="趋势图例筛选"]')!;
        for (const [key, label] of Object.entries(siteTrafficActionLabels)) {
            const target = legend.querySelector<HTMLButtonElement>(`button[data-series="${key}"]`);
            expect(target).not.toBeNull();
            expect(target!.textContent).toContain(label);
            await act(async () => {
                target!.click();
            });
            await settle();
        }
        expect(lines()).toHaveLength(1);
        await click("关键操作", host.querySelector('[aria-label="趋势视图"]')!);
        expect(lines()).toEqual(["actions"]);
        expect(button("今日小时").disabled).toBe(false);
        expect(button("今日小时").getAttribute("aria-pressed")).toBe("true");
        expect(JSON.parse(host.querySelector("[data-chart]")!.getAttribute("data-points")!)).toHaveLength(1);
        expect(overviewCalls()).toHaveLength(1);
        expect(todayCalls()).toHaveLength(1);
    } finally {
        mediaSpy.mockRestore();
    }
});

test("页面参与度按键合并，独立分母/部分支持/N-A/无PV/待同步并存且可排序", async () => {
    reply = (config) => {
        const result = response(config);
        result.data.data.pages.push({ page: "inspirations", pageViews: 1, visitors: 1, visits: 1 }, { page: "assets", pageViews: 0, visitors: 0, visits: 0 }, { page: "history", pageViews: 1, visitors: 1, visits: 1 });
        // mixed/unsupported 仅覆盖渲染边界；不是当前后端会返回的合法页面状态。
        result.data.data.insights.pageEngagement = [
            { page: "create", measurement: "mixed", visits: 12, engagedVisits: null, rate: null },
            { page: "canvas_list", measurement: "supported", visits: 2, engagedVisits: 2, rate: 1 },
            { page: "inspirations", measurement: "unsupported", visits: 1, engagedVisits: null, rate: null },
            { page: "assets", measurement: "supported", visits: 0, engagedVisits: 0, rate: null },
            { page: "tools_image", measurement: "supported", visits: 0, engagedVisits: 0, rate: null },
        ];
        return result;
    };
    await render();
    const panel = ranking("admin-traffic-pages-title");
    const rows = () => Array.from(panel.querySelectorAll("tbody .ant-table-row"));
    expect(rows()).toHaveLength(6);
    expect(rows()[0]!.textContent).toContain("创作");
    expect(rows()[0]!.textContent).toContain("N/A · 部分支持操作采集");
    expect(rows()[0]!.textContent).toContain("不可用 / 12 个会话");
    expect(rows()[0]!.textContent).not.toContain("无 PV 会话");
    expect(rows()[0]!.querySelector(".admin-traffic-page-engagement")!.textContent).not.toContain("0.0%");
    expect(rows().find((row) => row.textContent?.includes(siteTrafficPageLabels.inspirations))!.textContent).toContain("N/A · 未支持操作采集");
    expect(rows().find((row) => row.textContent?.includes("素材"))!.textContent).toContain("无 PV 会话");
    expect(rows().find((row) => row.textContent?.includes("历史记录"))!.textContent).toContain("待同步");
    expect(rows().find((row) => row.textContent?.includes(siteTrafficPageLabels.tools_image))!.textContent).toContain("待同步");
    await selectSource("按参与度排序", "页面排行排序");
    expect(rows()[0]!.textContent).toContain("画布列表");
    expect(rows()[0]!.textContent).toContain("100.0%");
    expect(overviewCalls()).toHaveLength(1);
    expect(kpis()).toEqual(["9", "17", "5", "4"]);
});

test("两工具分别显示在排行和来源筛选，CSV只导出所选工具来源", async () => {
    reply = (config) => {
        const result = response(config);
        const toolPages = ["tools_image", "tools_video"] as const;
        result.data.data.pages.push(...toolPages.map((page) => ({ page, pageViews: 1, visitors: 1, visits: 1 })));
        result.data.data.actions = toolPages.map((page) => ({ page, action: "open_create" as const, count: 1, visitors: 1 }));
        result.data.data.insights.pageEngagement.push(...toolPages.map((page) => ({ page, measurement: "supported" as const, visits: 1, engagedVisits: 1, rate: 1 })));
        return result;
    };
    await render();
    const panel = ranking("admin-traffic-pages-title");
    expect(panel.textContent).toContain(siteTrafficPageLabels.tools_image);
    expect(panel.textContent).toContain(siteTrafficPageLabels.tools_video);
    const excludedLabels = ["欢迎页", "插件", "分享画布", "资源库", "RunningHub", "其他页面", "工具箱", "登录与注册", "账号设置"];
    for (const label of excludedLabels) expect(panel.textContent).not.toContain(label);
    const source = host.querySelector<HTMLInputElement>('[role="combobox"][aria-label="功能排行来源页面"]')!;
    await act(async () => {
        source.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", keyCode: 40, bubbles: true }));
    });
    await settle();
    const sourceLabels = Array.from(document.querySelectorAll<HTMLElement>(".ant-select-item-option")).map((node) => node.textContent?.trim());
    expect(sourceLabels).toContain(siteTrafficPageLabels.tools_image);
    expect(sourceLabels).toContain(siteTrafficPageLabels.tools_video);
    for (const label of excludedLabels) expect(sourceLabels).not.toContain(label);
    await act(async () => {
        source.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
    });
    await settle();
    const before = calls.length;
    for (const [index, page] of (["tools_image", "tools_video"] as const).entries()) {
        await selectSource(siteTrafficPageLabels[page]);
        await click("功能排行 CSV");
        const rows = await downloadedCsv(index);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ page, pageLabel: siteTrafficPageLabels[page], sourceFilter: siteTrafficPageLabels[page] });
    }
    expect(calls).toHaveLength(before);
});

test("深度紧凑分布固定三档并用自己的会话分母，零分母不造百分比", async () => {
    reply = (config) => {
        const result = response(config);
        result.data.data.insights.depth = {
            visits: 10,
            buckets: [
                { key: "1", visits: 4, rate: 0.4 },
                { key: "2-3", visits: 3, rate: 0.3 },
                { key: "4+", visits: 3, rate: 0.3 },
            ],
        };
        return result;
    };
    await render();
    const panel = host.querySelector(".admin-traffic-depth")!;
    expect(panel.textContent).toContain("分布内 10 个访问会话");
    expect(panel.textContent).toContain("不是独立页数或跳出率");
    expect(panel.querySelectorAll("li")).toHaveLength(3);
    expect(Array.from(panel.querySelectorAll("li strong")).map((node) => node.textContent)).toEqual(["1 PV", "2–3 PV", "4+ PV"]);
    expect(Array.from(panel.querySelectorAll<HTMLElement>(".admin-traffic-depth-bar span")).map((node) => node.style.width)).toEqual(["40%", "30%", "30%"]);
    expect(kpis()).toHaveLength(4);
    reply = (config) => {
        const result = response(config);
        result.data.data.insights.depth = {
            visits: 0,
            buckets: [
                { key: "1", visits: 0, rate: null },
                { key: "2-3", visits: 0, rate: null },
                { key: "4+", visits: 0, rate: null },
            ],
        };
        return result;
    };
    await click("刷新");
    expect(panel.querySelector("ul")!.textContent).not.toContain("%");
    expect(panel.querySelector("ul")!.textContent).toContain("无 PV 会话");
    expect(panel.textContent).not.toMatch(/NaN|Infinity/);
});

async function downloadedCsv(index: number) {
    const file = downloads[index]!;
    expect(file).toBeDefined();
    expect(file.blob.type).toBe("text/csv;charset=utf-8");
    const bytes = new Uint8Array(await file.blob.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
    expect(text.startsWith("\uFEFF")).toBe(true);
    expect(text.match(/\uFEFF/g)).toHaveLength(1);
    const result = Papa.parse<Record<string, string>>(text, { header: true });
    expect(result.errors).toEqual([]);
    return result.data;
}

test("三类CSV点击捕获成功快照，每日导出全部日期且来源仅影响功能，不发新请求", async () => {
    reply = (config) => {
        const result = response(config);
        const start = Date.parse(`${config.params.from}T00:00:00Z`);
        const days = Math.round((Date.parse(`${config.params.to}T00:00:00Z`) - start) / 86_400_000) + 1;
        result.data.data.trend = Array.from({ length: days }, (_, index) => ({ date: new Date(start + index * 86_400_000).toISOString().slice(0, 10), visitors: 0, pageViews: 0, visits: 0, actions: 0 }));
        return result;
    };
    await render();
    await click("30 天");
    await selectSource(siteTrafficPageLabels.create);
    const daily = host.querySelector('[aria-label="每日明细"]')!;
    await act(async () => {
        daily.querySelector<HTMLButtonElement>('[aria-label="下一页"]')!.click();
    });
    await settle();
    const before = calls.length;
    await click("每日明细 CSV");
    await click("页面排行 CSV");
    await click("功能排行 CSV");
    expect(calls).toHaveLength(before);
    const days = await downloadedCsv(0);
    expect(days).toHaveLength(30);
    expect(days[0]).toMatchObject({ rangeFrom: "2026-10-13", rangeTo: "2026-11-11", timeZone: "Asia/Shanghai", date: "2026-10-13", pageViews: "0", historyStatus: "unknown", sourceFilter: "不适用" });
    expect(days.at(-1)).toMatchObject({ date: "2026-11-11", partial: "true", asOf: new Date(NOW).toISOString() });
    expect(await downloadedCsv(1)).toHaveLength(2);
    const actions = await downloadedCsv(2);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ sourceFilter: siteTrafficPageLabels.create, page: "create", action: "open_create", scope: "应用日期与当前来源筛选" });
    expect(downloads[0]!.fileName).toContain("traffic-daily-2026-10-13-2026-11-11");
});

test("CSV未成功/错误/无效日期禁用，刷新可导成功旧快照带asOf，不使用独立today", async () => {
    const pending = deferred<AxiosResponse>();
    reply = () => pending.promise;
    await render();
    const exportButtons = () => Array.from(host.querySelectorAll<HTMLButtonElement>('[aria-label="导出当前成功快照 CSV"] button'));
    expect(exportButtons().every((node) => node.disabled)).toBe(true);
    await act(async () => {
        pending.resolve(response(overviewCalls()[0]!));
    });
    await settle();
    expect(exportButtons().every((node) => !node.disabled)).toBe(true);
    const refreshing = deferred<AxiosResponse>();
    reply = () => refreshing.promise;
    await click("刷新");
    expect(exportButtons().every((node) => !node.disabled)).toBe(true);
    await click("每日明细 CSV");
    expect((await downloadedCsv(0))[0]!.asOf).toBe(new Date(NOW).toISOString());
    const newer = response(overviewCalls().at(-1)!);
    newer.data.data.kpi.pageViews = 999;
    newer.data.data.insights.operations = trafficOperationsFixture(newer.data.data);
    await act(async () => {
        refreshing.resolve(newer);
    });
    await settle();
    expect((await downloadedCsv(0))[0]!.pageViews).toBe("7");
    code = 1;
    reply = response;
    await click("刷新");
    expect(exportButtons().every((node) => node.disabled)).toBe(true);
    expect(host.querySelector(".admin-traffic-heatmap-cell")).toBeNull();
    code = 0;
    await click("重试");
    await type("访问统计开始日期", "2025-11-11");
    expect(exportButtons().every((node) => node.disabled)).toBe(true);
    await click("应用日期");
    expect(exportButtons().every((node) => node.disabled)).toBe(true);
    expect(downloads).toHaveLength(1);
});

registerTrafficOperationsCases({ host: () => host, requestCount: () => calls.length, render, click, selectSource });
