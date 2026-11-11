import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { AxiosError, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { Window } from "happy-dom";
import type { RainyunMonitorInput, RainyunMonitorSetting, RainyunPerformance, RainyunRealtime, SystemPerformance } from "../../src/services/api/system-performance";

// 所有全局对象与 spy 均局限于 spawn 子进程；不替换 Router、Form 或 Progress。
const dom = new Window({ url: "http://localhost:3000/admin/settings/performance" });
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
    HTMLAnchorElement: dom.HTMLAnchorElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    Event: dom.Event,
    CustomEvent: dom.CustomEvent,
    MouseEvent: dom.MouseEvent,
    PointerEvent: dom.PointerEvent,
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
const { App, ConfigProvider } = await import("antd");
// 只隔离与本专项无关的后台导航外壳，页面、卡片与共享 admin-ui 均使用真实实现。
mock.module("../../src/pages/admin/components/admin-shell", () => ({
    AdminPageFrame: ({ title, actions, children }: { title: string; actions?: React.ReactNode; children: React.ReactNode }) => (
        <main>
            <h1>{title}</h1>
            {actions}
            {children}
        </main>
    ),
}));
// 仅替换 Recharts 的尺寸/绘制外壳；数据、时间窗口和轮询仍由真实组件生成。
mock.module("recharts", () => ({
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    LineChart: ({ data, children }: { data: unknown[]; children: React.ReactNode }) => (
        <div data-recharts="chart" data-points={JSON.stringify(data)}>
            {children}
        </div>
    ),
    ComposedChart: ({ data, children }: { data: unknown[]; children: React.ReactNode }) => (
        <div data-recharts="chart" data-points={JSON.stringify(data)}>
            {children}
        </div>
    ),
    XAxis: ({ domain }: { domain: number[] }) => <span data-recharts="axis" data-domain={JSON.stringify(domain)} />,
    Line: ({ dataKey, dot, connectNulls }: { dataKey: string; dot: boolean; connectNulls: boolean }) => <span data-recharts="line" data-key={dataKey} data-dot={String(Boolean(dot))} data-connect-nulls={String(connectNulls)} />,
    Area: () => null,
    CartesianGrid: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    Legend: () => null,
}));
const success = mock((_text: string) => undefined);
const error = mock((_text: string) => undefined);
spyOn(App, "useApp").mockReturnValue({ message: { success, error }, modal: {}, notification: {} } as unknown as ReturnType<typeof App.useApp>);
const { default: SystemPerformancePage, RainyunPerformanceCard } = await import("../../src/pages/admin/settings/system-performance-page");
const { default: RainyunMonitorSettings } = await import("../../src/pages/admin/settings/rainyun-monitor-settings");
const { RainyunRealtimeChart } = await import("../../src/pages/admin/settings/rainyun-realtime-chart");
const api = await import("../../src/services/api/system-performance");
const { apiClient } = await import("../../src/services/api/request");
const originalAdapter = apiClient.defaults.adapter;
const NOW = Date.parse("2026-11-09T12:00:00.000Z"),
    DAY = 86_400_000,
    GiB = 1024 ** 3;
const stamp = (offset = 0) => new Date(NOW + offset).toISOString();
const SECRET = "fixture-management-key-never-echo";
const endpoint = "/admin/settings/rainyun-monitor";
const realtimeEndpoint = "/admin/system-performance/rainyun-realtime";
const onDirtyChange = (dirty: boolean) => {
    dirtyFlags.push(dirty);
};
let root: ReturnType<typeof createRoot> | undefined;
let host: HTMLDivElement;
let clock: ReturnType<typeof spyOn>;
let now: number;
let dirtyFlags: boolean[];
let setting: RainyunMonitorSetting;
let patchCode: number, performanceCode: number, realtimeCode: number;
let patchOverride: RainyunMonitorSetting | undefined;
let snapshot: SystemPerformance;
let realtimeData: RainyunRealtime;
let realtimeReply: (config: InternalAxiosRequestConfig) => AxiosResponse | Promise<AxiosResponse>;
let restorePolling: (() => void) | undefined;
let pageHidden = false;
const pollingTimers = new Map<number, { run: () => void; delay: number; at: number }>();
type Call = { method?: string; url?: string; body?: RainyunMonitorInput; signal?: InternalAxiosRequestConfig["signal"]; withCredentials?: boolean; timeout?: number; at: number };
let calls: Call[];
function rainyun(patch: Partial<RainyunPerformance> = {}): RainyunPerformance {
    return {
        enabled: true,
        configured: true,
        status: "healthy",
        statusMessage: "实例级采集正常",
        checkedAt: stamp(),
        instanceId: 12345,
        planName: "测试套餐",
        cloudStatus: "运行中",
        latencyMs: 12,
        sourceStatus: "healthy",
        sourceMessage: "源站只读可达",
        sourceLatencyMs: 8,
        expiresAt: stamp(30 * DAY),
        storageUsedBytes: 0.5 * GiB,
        storageQuotaBytes: 10 * GiB,
        trafficUsedBytes: 2.25 * GiB,
        trafficQuotaBytes: 100 * GiB,
        periodStart: stamp(-10 * DAY),
        periodEnd: stamp(20 * DAY),
        extraAccounting: true,
        statisticsMessage: "实例下全部存储桶",
        ...patch,
    };
}
function performance(): SystemPerformance {
    return {
        collectedAt: stamp(),
        status: "healthy",
        rainyun: rainyun(),
        agents: [],
        build: { version: "fixture", commit: "fixture", buildTime: stamp(), goVersion: "go1.25" },
        host: {
            hostname: "fixture",
            os: "linux",
            arch: "amd64",
            cpuCores: 2,
            cpu: { status: "sampling", usagePercent: null, sampleSeconds: 0 },
            gomaxprocs: 2,
            processId: 1,
            uptimeSeconds: 60,
            goroutines: 1,
            activeWorkerTasks: 0,
            loadAverage: [0, 0, 0],
            loadAverageAvailable: false,
        },
        memory: { systemAvailable: false, totalBytes: 0, usedBytes: 0, availableBytes: 0, usagePercent: 0, heapAllocBytes: 0, heapSysBytes: 0, sysBytes: 0, heapObjects: 0, gcCount: 0 },
        disk: { available: false, writable: true, totalBytes: 0, usedBytes: 0, freeBytes: 0, usagePercent: 0 },
        database: {
            driver: "sqlite",
            connected: true,
            latencyMs: 0,
            schema: { current: 1, expected: 1, ready: true },
            pool: { maxOpenConnections: 1, openConnections: 0, inUse: 0, idle: 0, waitCount: 0, waitDurationMs: 0, maxIdleClosed: 0, maxLifetimeClosed: 0 },
        },
        redis: { configured: false, connected: false, mode: "local", cacheGroups: [], pool: { hits: 0, misses: 0, timeouts: 0, totalConnections: 0, idleConnections: 0, staleConnections: 0, pendingRequests: 0 } },
    };
}
function realtime(patch: Partial<RainyunRealtime> = {}): RainyunRealtime {
    return {
        enabled: true,
        configured: true,
        status: "healthy",
        statusMessage: "官方实时采样",
        instanceId: 12345,
        checkedAt: stamp(),
        sampleIntervalSeconds: 10,
        retryAfterSeconds: 1,
        points: [{ time: stamp(), receivedBytesPerSecond: 0, sentBytesPerSecond: 0, requestsTotal: 0 }],
        ...patch,
    };
}
function response(config: InternalAxiosRequestConfig, data: unknown, code = 0): AxiosResponse {
    return { config, status: 200, statusText: "OK", headers: {}, data: { code, data, msg: code ? "监控请求失败" : "ok" } };
}
const adapter: AxiosAdapter = async (config) => {
    const body = typeof config.data === "string" ? JSON.parse(config.data) : config.data;
    calls.push({ method: config.method, url: config.url, body, signal: config.signal, withCredentials: config.withCredentials, timeout: config.timeout, at: now });
    if (config.url === realtimeEndpoint && config.method === "get") return realtimeReply(config);
    if (config.url === "/admin/system-performance" && config.method === "get") return response(config, snapshot, performanceCode);
    if (config.url === endpoint && config.method === "get") return response(config, setting);
    if (config.url === endpoint && config.method === "patch") {
        const input = body as RainyunMonitorInput;
        return response(config, patchOverride ?? { enabled: input.enabled, instanceId: input.instanceId, hasApiKey: Boolean(input.apiKey) || setting.hasApiKey }, patchCode);
    }
    throw new Error(`禁止真实网络或其他设置请求：${config.method} ${config.url}`);
};
async function settle() {
    for (let index = 0; index < 2; index++)
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
}
async function render(node: React.ReactNode) {
    if (!root) {
        host = document.createElement("div");
        document.body.append(host);
        root = createRoot(host);
    }
    await act(async () => {
        root!.render(
            <ConfigProvider wave={{ disabled: true }} theme={{ token: { motion: false } }} button={{ autoInsertSpace: false }}>
                <MemoryRouter>{node}</MemoryRouter>
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
function card() {
    const heading = Array.from(host.querySelectorAll("h2")).find((node) => node.textContent === "雨云 OSS");
    expect(heading).not.toBeUndefined();
    return heading!.closest("section")!;
}
function fact(label: string, scope: Element = card()) {
    const dt = Array.from(scope.querySelectorAll("dt")).find((node) => node.textContent === label);
    expect(dt).not.toBeUndefined();
    const dd = dt!.nextElementSibling!;
    expect(dd.tagName).toBe("DD");
    return dd as HTMLElement;
}
function button(label: string) {
    const result = Array.from(host.querySelectorAll("button")).find((node) => node.textContent?.trim() === label);
    expect(result).not.toBeUndefined();
    return result!;
}
async function click(label: string) {
    const target = button(label);
    expect(target.disabled).toBe(false);
    await act(async () => {
        target.click();
    });
    await settle();
}
function input(selector: string) {
    const result = host.querySelector<HTMLInputElement>(selector);
    expect(result).not.toBeNull();
    return result!;
}
const idInput = () => input('input[aria-label="ROS 实例 ID"]');
const keyInput = () => input('input[autocomplete="new-password"]');
async function type(target: HTMLInputElement, value: string) {
    await act(async () => {
        Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!.call(target, value);
        target.dispatchEvent(new dom.Event("input", { bubbles: true }));
        target.dispatchEvent(new dom.Event("change", { bubbles: true }));
    });
    await settle();
}
const patches = () => calls.filter((call) => call.method === "patch");
const renderSettings = () => render(<RainyunMonitorSettings onDirtyChange={onDirtyChange} />);
const realtimeCalls = () => calls.filter((call) => call.url === realtimeEndpoint);
const renderRealtime = (autoRefresh = true) => render(<RainyunRealtimeChart instanceId={12345} autoRefresh={autoRefresh} />);
function realtimeSection() {
    const section = host.querySelector<HTMLElement>('section[aria-label="雨云实时流量与请求监控"]');
    expect(section).not.toBeNull();
    return section!;
}
type PlottedPoint = { timestamp: number; received: number | null; sent: number | null; requests: number | null };
function plottedPoints(index = 0): PlottedPoint[] {
    const chart = host.querySelectorAll('[data-recharts="chart"]')[index];
    expect(chart).toBeDefined();
    return JSON.parse(chart!.getAttribute("data-points")!);
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((yes) => {
        resolve = yes;
    });
    return { promise, resolve };
}
// 只接管组件的 window interval；全局 setTimeout/React/表单队列仍保持真实。
function controlPolling() {
    let sequence = 0;
    pageHidden = false;
    const hidden = Object.getOwnPropertyDescriptor(document, "hidden");
    Object.defineProperty(document, "hidden", { configurable: true, get: () => pageHidden });
    const interval = spyOn(window, "setInterval").mockImplementation((handler, delay = 0, ...args) => {
        if (typeof handler !== "function") throw new TypeError("专项仅接受函数 interval");
        const id = ++sequence;
        pollingTimers.set(id, { run: () => handler(...args), delay, at: now + delay });
        return id;
    });
    const clear = spyOn(window, "clearInterval").mockImplementation((id) => {
        pollingTimers.delete(Number(id));
    });
    restorePolling = () => {
        interval.mockRestore();
        clear.mockRestore();
        pollingTimers.clear();
        if (hidden) Object.defineProperty(document, "hidden", hidden);
        else Reflect.deleteProperty(document, "hidden");
    };
}
async function advance(seconds = 1) {
    for (let second = 0; second < seconds; second++) {
        now += 1_000;
        await act(async () => {
            for (const [id, timer] of [...pollingTimers]) {
                if (pollingTimers.has(id) && timer.at <= now) {
                    timer.at += timer.delay;
                    timer.run();
                }
            }
        });
    }
}
async function setHidden(hidden: boolean) {
    pageHidden = hidden;
    await act(async () => {
        document.dispatchEvent(new dom.Event("visibilitychange"));
    });
    await settle();
}
beforeEach(() => {
    now = NOW;
    clock = spyOn(Date, "now").mockImplementation(() => now);
    calls = [];
    dirtyFlags = [];
    patchCode = performanceCode = realtimeCode = 0;
    patchOverride = undefined;
    setting = { enabled: false, instanceId: 0, hasApiKey: false };
    snapshot = performance();
    realtimeData = realtime();
    realtimeReply = (config) => response(config, realtimeData, realtimeCode);
    success.mockClear();
    error.mockClear();
    apiClient.defaults.adapter = adapter;
});
afterEach(async () => {
    try {
        await unmount();
    } finally {
        restorePolling?.();
        restorePolling = undefined;
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

test("真实性能页卡内展示 GiB、余量、全部实例信息及配置链接，不回显额外密钥字段", async () => {
    snapshot.rainyun = { ...rainyun(), apiKey: SECRET, accessKeySecret: SECRET } as RainyunPerformance;
    await render(<SystemPerformancePage />);
    expect(fact("存储空间").textContent).toContain("已用 0.5 GiB / 套餐 10 GiB");
    expect(fact("存储空间").textContent).toContain("套餐内剩余 9.5 GiB · 使用率 5.0%");
    expect(fact("周期下载流量").textContent).toContain("已用 2.25 GiB / 套餐 100 GiB");
    expect(fact("周期下载流量").textContent).toContain("套餐内剩余 97.75 GiB · 使用率 2.3%");
    for (const [label, value] of [
        ["监控说明", "实例级采集正常"],
        ["实例 / 云端状态", "12345 · 运行中"],
        ["管理接口耗时", "12 ms"],
        ["源站只读访问", "源站只读可达 · 8 ms"],
        ["当前套餐", "测试套餐"],
        ["统计说明", "实例下全部存储桶"],
    ])
        expect(fact(label).textContent).toBe(value);
    for (const label of ["套餐到期时间", "流量统计周期", "超额弹性计费", "最近采集"]) expect(fact(label).textContent?.length).toBeGreaterThan(0);
    expect(card().querySelector("a")?.getAttribute("href")).toBe("/admin/settings/storage#admin-rainyun-monitor");
    expect(card().innerHTML).not.toContain(SECRET);
    expect(card().querySelector("input")).toBeNull();
    expect(card().textContent).not.toMatch(/apiKey|API Key|accessKeySecret/);
});

test("真实零用量和零毫秒保留，正额度产生真实 0% 进度", async () => {
    await render(<RainyunPerformanceCard data={rainyun({ storageUsedBytes: 0, trafficUsedBytes: 0, latencyMs: 0, sourceLatencyMs: 0 })} />);
    for (const label of ["存储空间", "周期下载流量"]) {
        expect(fact(label).textContent).toContain("已用 0 GiB");
        expect(fact(label).textContent).toContain("使用率 0.0%");
        expect(fact(label).querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("0");
    }
    expect(fact("管理接口耗时").textContent).toBe("0 ms");
    expect(fact("源站只读访问").textContent).toContain("0 ms");
});

test("缺用量、缺额度及无效数值显示未知，不造剩余、百分比或假进度", async () => {
    for (const [used, quota] of [
        [undefined, 10 * GiB],
        [0, undefined],
        [NaN, GiB],
        [-1, GiB],
        [GiB, Infinity],
    ]) {
        await render(<RainyunPerformanceCard data={rainyun({ storageUsedBytes: used, storageQuotaBytes: quota, trafficUsedBytes: used, trafficQuotaBytes: quota })} />);
        for (const label of ["存储空间", "周期下载流量"]) {
            expect(fact(label).textContent).toContain("未知");
            expect(fact(label).textContent).toContain("套餐内剩余 未知");
            expect(fact(label).textContent).not.toContain("使用率");
            expect(fact(label).querySelector('[role="progressbar"]')).toBeNull();
        }
    }
});

test("超额余量为零但文本使用率保留超过100%，只有视觉进度封顶且额度不是硬上限", async () => {
    await render(<RainyunPerformanceCard data={rainyun({ storageUsedBytes: 12.5 * GiB, storageQuotaBytes: 10 * GiB, trafficUsedBytes: 150 * GiB })} />);
    for (const [label, percent] of [
        ["存储空间", "125.0%"],
        ["周期下载流量", "150.0%"],
    ]) {
        expect(fact(label).textContent).toContain("套餐内剩余 0 GiB");
        expect(fact(label).textContent).toContain(`使用率 ${percent}`);
        expect(fact(label).querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("100");
    }
    expect(fact("超额弹性计费").textContent).toBe("已开启，套餐额度不是硬上限");
});

test("零额度保持已知零但不除零或捏造100%进度，弹性未开启说明独立", async () => {
    await render(<RainyunPerformanceCard data={rainyun({ storageUsedBytes: 0, storageQuotaBytes: 0, trafficUsedBytes: GiB, trafficQuotaBytes: 0, extraAccounting: false })} />);
    for (const label of ["存储空间", "周期下载流量"]) {
        expect(fact(label).textContent).toContain("套餐 0 GiB");
        expect(fact(label).textContent).toContain("套餐内剩余 0 GiB");
        expect(fact(label).querySelector('[role="progressbar"]')).toBeNull();
        expect(fact(label).textContent).not.toMatch(/使用率|NaN|Infinity/);
    }
    expect(fact("超额弹性计费").textContent).toBe("未开启，超额可能停止访问");
});

test("到期未知、无效时间、过期、恰好7天及超过7天的标签和颜色角色准确", async () => {
    const cases = [
        { expiresAt: undefined, label: "到期时间未知", tone: "neutral" },
        { expiresAt: "invalid", label: "到期时间未知", tone: "neutral" },
        { expiresAt: stamp(-1), label: "已过期", tone: "error" },
        { expiresAt: stamp(), label: "已过期", tone: "error" },
        { expiresAt: stamp(DAY), label: "剩余 1 天", tone: "warning" },
        { expiresAt: stamp(7 * DAY), label: "剩余 7 天", tone: "warning" },
        { expiresAt: stamp(7 * DAY + 1), label: "剩余 8 天", tone: "success" },
    ];
    for (const item of cases) {
        await render(<RainyunPerformanceCard data={rainyun({ expiresAt: item.expiresAt })} />);
        const badge = fact("套餐到期时间").querySelector(".admin-status-badge")!;
        expect(badge.textContent).toBe(item.label);
        expect(badge.classList.contains(`is-${item.tone}`)).toBe(item.tone !== "neutral");
    }
});

test("真实周期起止时间完整显示，任一端缺失不伪造自然月周期", async () => {
    const local = (value: string) => new Date(value).toLocaleString("zh-CN", { hour12: false });
    await render(<RainyunPerformanceCard data={rainyun()} />);
    expect(fact("流量统计周期").textContent).toBe(`${local(stamp(-10 * DAY))} 至 ${local(stamp(20 * DAY))}`);
    for (const period of [{ periodStart: undefined }, { periodEnd: undefined }]) {
        await render(<RainyunPerformanceCard data={rainyun(period)} />);
        expect(fact("流量统计周期").textContent).toBe("未知（以雨云实际重置周期为准）");
    }
});

test("正常缓存、超过120秒及外层stale三态均在同一卡内表达", async () => {
    for (const item of [
        { age: 60_000, stale: false, expired: false },
        { age: 120_001, stale: false, expired: true },
        { age: 0, stale: true, expired: true },
    ]) {
        await render(<RainyunPerformanceCard data={rainyun({ checkedAt: stamp(-item.age) })} stale={item.stale} />);
        expect(card().querySelector(".admin-status-badge")?.textContent).toBe(item.expired ? "快照已过期" : "监控正常");
        expect(fact("最近采集").textContent).toContain(item.expired ? "已过期，非当前状态" : "60 秒缓存");
    }
});

test("没有监控数据时所有未知项留在性能卡，未探测不等于零或正常", async () => {
    await render(<RainyunPerformanceCard />);
    expect(fact("监控说明").textContent).toBe("雨云监控数据暂不可用");
    expect(fact("实例 / 云端状态").textContent).toContain("未配置");
    expect(fact("管理接口耗时").textContent).toBe("未探测");
    expect(fact("最近采集").textContent).toBe("尚未采集");
    expect(fact("超额弹性计费").textContent).toBe("未知");
    expect(card().querySelectorAll('[role="progressbar"]').length).toBe(0);
});

test("服务器资源首屏展示真实CPU零值及整机已用总量和可用内存", async () => {
    snapshot.host.cpu = { status: "ready", usagePercent: 0, sampledAt: stamp(), sampleSeconds: 15 };
    snapshot.memory = { ...snapshot.memory, systemAvailable: true, totalBytes: 8 * GiB, usedBytes: 3 * GiB, availableBytes: 5 * GiB, usagePercent: 37.5, heapAllocBytes: GiB };
    await render(<SystemPerformancePage />);
    const resources = host.querySelector('section[aria-label="服务器资源"]')!;
    const tiles = resources.querySelectorAll("article");
    expect(tiles).toHaveLength(2);
    expect(tiles[0].textContent).toContain("服务器 CPU");
    expect(tiles[0].querySelector("strong")?.textContent).toBe("0.0%");
    expect(tiles[0].textContent).toContain("2 逻辑核 · 15.0 秒区间平均");
    expect(tiles[0].textContent).toContain("采样于");
    expect(tiles[0].querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("0");
    expect(tiles[1].textContent).toContain("服务器内存");
    expect(tiles[1].querySelector("strong")?.textContent).toBe("37.5%");
    expect(tiles[1].textContent).toContain("已用 3.0 GB / 总量 8.0 GB");
    expect(tiles[1].textContent).toContain("可用 5.0 GB");
    expect(tiles[1].querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("37");
    expect(resources.textContent).not.toContain("1.0 GB");
    expect(host.textContent).toContain("Heap Alloc1.0 GB");
});

test("CPU采样中与不可用不显示假零，整机内存不可用不拿Go堆顶替", async () => {
    for (const status of ["sampling", "unavailable"] as const) {
        await unmount();
        snapshot.host.cpu = { status, usagePercent: null, sampleSeconds: 0 };
        snapshot.memory.heapAllocBytes = GiB;
        await render(<SystemPerformancePage />);
        const resources = host.querySelector('section[aria-label="服务器资源"]')!;
        const tiles = resources.querySelectorAll("article");
        expect(tiles[0].querySelector("strong")?.textContent).toBe(status === "sampling" ? "采样中" : "不可用");
        expect(tiles[1].querySelector("strong")?.textContent).toBe("不可用");
        expect(tiles[1].textContent).toContain("服务器内存");
        expect(tiles[1].textContent).toContain("无法采集整机内存");
        expect(resources.querySelectorAll('[role="progressbar"]')).toHaveLength(0);
        expect(resources.textContent).not.toMatch(/0\.0%|1\.0 GB|进程堆内存/);
    }
});

test("CPU沿原刷新由采样中变为有效使用率，失败保留旧值并提示快照过期", async () => {
    await render(<SystemPerformancePage />);
    snapshot.host.cpu = { status: "ready", usagePercent: 42.5, sampledAt: stamp(), sampleSeconds: 15 };
    await click("刷新");
    expect(host.querySelector('section[aria-label="服务器资源"] article strong')?.textContent).toBe("42.5%");
    performanceCode = 1001;
    await click("刷新");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("上次采集的快照，非当前状态");
    expect(host.querySelector('section[aria-label="服务器资源"] article strong')?.textContent).toBe("42.5%");
    expect(calls.filter((call) => call.url === "/admin/system-performance")).toHaveLength(3);
});

test("真实性能页刷新失败保留旧雨云数据，但显式标记快照过期", async () => {
    await render(<SystemPerformancePage />);
    performanceCode = 1001;
    await click("刷新");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("刷新失败");
    expect(fact("实例 / 云端状态").textContent).toContain("12345");
    expect(card().querySelector(".admin-status-badge")?.textContent).toBe("快照已过期");
    expect(fact("最近采集").textContent).toContain("已过期，非当前状态");
    expect(calls.filter((call) => call.url === "/admin/system-performance")).toHaveLength(2);
    expect(realtimeCalls()).toHaveLength(1);
});

test("真实Form启用必须有ID和key，合法新key成功后清空输入及dirty", async () => {
    await renderSettings();
    expect(button("保存监控配置").disabled).toBe(true);
    const toggle = host.querySelector<HTMLButtonElement>('button[role="switch"]')!;
    await act(async () => {
        toggle.click();
    });
    await settle();
    expect(dirtyFlags.at(-1)).toBe(true);
    await click("保存监控配置");
    expect(host.textContent).toContain("请填写有效的正整数实例 ID");
    expect(host.textContent).toContain("请填写雨云管理 API Key");
    expect(patches()).toHaveLength(0);
    await type(idInput(), "67890");
    await click("保存监控配置");
    expect(patches()).toHaveLength(0);
    expect(host.textContent).toContain("请填写雨云管理 API Key");
    await type(keyInput(), `  ${SECRET}  `);
    await click("保存监控配置");
    expect(patches()).toHaveLength(1);
    expect(patches()[0].body).toEqual({ enabled: true, instanceId: 67890, apiKey: SECRET });
    expect(keyInput().value).toBe("");
    expect(dirtyFlags.at(-1)).toBe(false);
    expect(button("保存监控配置").disabled).toBe(true);
    expect(success).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
});

test("已有密钥留空不回显，独立保存仅提交监控接口，不触发存储保存", async () => {
    setting = { enabled: true, instanceId: 12345, hasApiKey: true, apiKey: SECRET } as RainyunMonitorSetting;
    await renderSettings();
    expect(keyInput().value).toBe("");
    expect(keyInput().placeholder).toBe("留空保留原管理密钥");
    expect(host.innerHTML).not.toContain(SECRET);
    await type(idInput(), "67890");
    await click("保存监控配置");
    expect(calls.map(({ method, url }) => [method, url])).toEqual([
        ["get", endpoint],
        ["patch", endpoint],
    ]);
    expect(patches()[0].body).toEqual({ enabled: true, instanceId: 67890, apiKey: "" });
    expect(keyInput().value).toBe("");
    expect(dirtyFlags.at(-1)).toBe(false);
    expect(success).toHaveBeenCalledTimes(1);
});

test("独立保存业务失败保留ID/key草稿和dirty，不重试或显示成功", async () => {
    setting = { enabled: true, instanceId: 12345, hasApiKey: true };
    patchCode = 1001;
    await renderSettings();
    await type(idInput(), "99999");
    await type(keyInput(), SECRET);
    await click("保存监控配置");
    expect(patches()).toHaveLength(1);
    expect(idInput().value).toBe("99999");
    expect(keyInput().value).toBe(SECRET);
    expect(dirtyFlags.at(-1)).toBe(true);
    expect(button("保存监控配置").disabled).toBe(false);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("未自动重试，草稿已保留");
    expect(success).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
});

test("成功信封但返回实例与草稿不一致时不假报保存成功", async () => {
    setting = { enabled: true, instanceId: 12345, hasApiKey: true };
    patchOverride = { ...setting, instanceId: 88888 };
    await renderSettings();
    await type(idInput(), "99999");
    await click("保存监控配置");
    expect(idInput().value).toBe("99999");
    expect(dirtyFlags.at(-1)).toBe(true);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("配置与保存内容不一致");
    expect(success).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
});

test("卸载实际abort读取signal，迟到响应不能清草稿或显示通知", async () => {
    let resolveRead!: (value: RainyunMonitorSetting) => void;
    const pending = new Promise<RainyunMonitorSetting>((resolve) => {
        resolveRead = resolve;
    });
    let signal: InternalAxiosRequestConfig["signal"];
    apiClient.defaults.adapter = async (config) => {
        signal = config.signal;
        return response(config, await pending);
    };
    await renderSettings();
    expect(signal).toBeDefined();
    expect(signal!.aborted).toBe(false);
    await unmount();
    expect(signal!.aborted).toBe(true);
    const flags = [...dirtyFlags];
    await act(async () => {
        resolveRead({ enabled: true, instanceId: 12345, hasApiKey: true });
    });
    await settle();
    expect(dirtyFlags).toEqual(flags);
    expect(success).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
});

test("共享apiClient保留Cookie/signal、真实GET/PATCH路径和响应解包，裁掉意外密钥字段", async () => {
    setting = { enabled: true, instanceId: 12345, hasApiKey: true, apiKey: SECRET } as RainyunMonitorSetting;
    const controller = new AbortController();
    expect(await api.getRainyunMonitorSetting(controller.signal)).toEqual({ enabled: true, instanceId: 12345, hasApiKey: true });
    expect(calls[0].signal).toBe(controller.signal);
    expect(calls[0].withCredentials).toBe(true);
    const payload = { enabled: true, instanceId: 12345, apiKey: "" };
    expect(await api.updateRainyunMonitorSetting(payload)).toEqual({ enabled: true, instanceId: 12345, hasApiKey: true });
    expect(calls[1]).toMatchObject({ method: "patch", url: endpoint, withCredentials: true, body: payload });
});

test("共享API不把HTTP200非零业务码解包成保存成功", async () => {
    patchCode = 1001;
    await expect(api.updateRainyunMonitorSetting({ enabled: false, instanceId: 0, apiKey: "" })).rejects.toMatchObject({ code: 1001, message: "监控请求失败" });
});

test("共享API拒绝缺失hasApiKey或不合法实例ID的响应，不能默认已配置", async () => {
    for (const malformed of [
        { enabled: true, instanceId: 1 },
        { enabled: true, instanceId: 0, hasApiKey: true },
        { enabled: false, instanceId: -1, hasApiKey: false },
    ]) {
        setting = malformed as RainyunMonitorSetting;
        await expect(api.getRainyunMonitorSetting()).rejects.toThrow("配置格式无效");
    }
});

test("共享API保持取消的AbortError语义，已取消请求不进入adapter", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(api.getRainyunMonitorSetting(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toHaveLength(0);
});

test("实时API走共享GET、Cookie、signal和5秒timeout，原样解包零及可选字段", async () => {
    realtimeData = realtime({ points: [{ time: stamp(), receivedBytesPerSecond: 0, requestsTotal: 0 }] });
    const controller = new AbortController();
    expect(await api.getRainyunRealtime(controller.signal)).toEqual(realtimeData);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "get", url: realtimeEndpoint, withCredentials: true, timeout: 5_000 });
    expect(calls[0].signal).toBe(controller.signal);
    expect(calls[0].body).toBeUndefined();
    expect(calls[0].signal?.aborted).toBe(false);
});

test("实时API拒绝业务失败、HTTP错误及Axios超时，不将失败当空采样或自动重试", async () => {
    realtimeCode = 1001;
    await expect(api.getRainyunRealtime()).rejects.toMatchObject({ name: "ApiError", code: 1001, message: "监控请求失败" });
    realtimeReply = (config) => {
        const failed = response(config, null, 503);
        failed.status = 503;
        failed.data.msg = "雨云服务暂不可用";
        throw new AxiosError("HTTP 503", AxiosError.ERR_BAD_RESPONSE, config, undefined, failed);
    };
    await expect(api.getRainyunRealtime()).rejects.toMatchObject({ status: 503, code: 503, message: "雨云服务暂不可用", retryable: true });
    realtimeReply = (config) => {
        throw new AxiosError("timeout of 5000ms exceeded", AxiosError.ECONNABORTED, config);
    };
    await expect(api.getRainyunRealtime()).rejects.toMatchObject({ name: "ApiError", message: "timeout of 5000ms exceeded", retryable: true, cause: { code: "ECONNABORTED" } });
    expect(realtimeCalls()).toHaveLength(3);
    expect(realtimeCalls().every((call) => call.timeout === 5_000)).toBe(true);
});

test("实时API保留预取消和在途取消的AbortError，不接收迟到数据", async () => {
    const canceled = new AbortController();
    canceled.abort();
    await expect(api.getRainyunRealtime(canceled.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toHaveLength(0);
    const pending = deferred<RainyunRealtime>();
    realtimeReply = async (config) => response(config, await pending.promise);
    const controller = new AbortController();
    const rejected = api.getRainyunRealtime(controller.signal).catch((error: unknown) => error);
    await settle();
    expect(realtimeCalls()[0].signal).toBe(controller.signal);
    controller.abort();
    pending.resolve(realtimeData);
    expect(await rejected).toMatchObject({ name: "AbortError" });
    expect(realtimeCalls()).toHaveLength(1);
});

test("单独雨云卡默认暂停且没有timer/API，未启用或未配置也不挂实时轮询", async () => {
    controlPolling();
    await render(<RainyunPerformanceCard data={rainyun()} />);
    expect(realtimeSection().textContent).toContain("实时刷新已暂停");
    expect(pollingTimers.size).toBe(0);
    await advance(3);
    expect(calls).toHaveLength(0);
    for (const patch of [{ enabled: false }, { configured: false }, { instanceId: undefined }]) {
        await render(<RainyunPerformanceCard data={rainyun(patch)} autoRefresh />);
        expect(host.querySelector('section[aria-label="雨云实时流量与请求监控"]')).toBeNull();
    }
    expect(pollingTimers.size).toBe(0);
    expect(calls).toHaveLength(0);
});

test("真实性能页的自动刷新开关联动实时图表，暂停后恢复即时请求", async () => {
    controlPolling();
    await render(<SystemPerformancePage />);
    expect(realtimeCalls()).toHaveLength(1);
    const toggle = host.querySelector<HTMLButtonElement>('button[role="switch"]')!;
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await act(async () => {
        toggle.click();
    });
    expect(realtimeSection().textContent).toContain("实时刷新已暂停");
    expect(pollingTimers.size).toBe(0);
    await advance(3);
    expect(realtimeCalls()).toHaveLength(1);
    await act(async () => {
        toggle.click();
    });
    await settle();
    expect(realtimeCalls()).toHaveLength(2);
    expect(calls.filter((call) => call.url === "/admin/system-performance")).toHaveLength(1);
});

test("真实零与未知分开，两个真实图接收原始时间和null缺口，不沿用前值或补零", async () => {
    controlPolling();
    await renderRealtime();
    const section = realtimeSection();
    for (const label of ["入站流量（接收）", "出站流量（发送）"]) expect(fact(label, section).textContent).toBe("0 B/s");
    expect(fact("请求总数（官方采样值）", section).textContent).toBe("0");
    expect(Array.from(section.querySelectorAll('[role="img"]'), (image) => image.getAttribute("aria-label"))).toEqual(["雨云收发流量实时折线图", "雨云请求总数实时折线图"]);
    expect(plottedPoints()).toEqual([{ timestamp: NOW, received: 0, sent: 0, requests: 0 }]);
    realtimeData = realtime({ sampleIntervalSeconds: undefined, points: [...realtimeData.points, { time: stamp(1_000) }] });
    await advance();
    for (const label of ["入站流量（接收）", "出站流量（发送）", "请求总数（官方采样值）"]) expect(fact(label, section).textContent).toBe("未知");
    expect(section.textContent).toContain("云端采样间隔未知");
    expect(plottedPoints()).toEqual([
        { timestamp: NOW, received: 0, sent: 0, requests: 0 },
        { timestamp: NOW + 1_000, received: null, sent: null, requests: null },
    ]);
    expect(plottedPoints(1)).toEqual(plottedPoints());
    const lines = [...section.querySelectorAll('[data-recharts="line"]')];
    expect(lines.map((line) => line.getAttribute("data-key"))).toEqual(["received", "sent", "requests"]);
    expect(lines.every((line) => line.getAttribute("data-connect-nulls") === "false")).toBe(true);
});

test("流量按B/KiB/MiB每秒展示，请求数只取官方原值且不累计或差分", async () => {
    controlPolling();
    realtimeData = realtime({
        points: [
            { time: stamp(-4_000), requestsTotal: 1000 },
            { time: stamp(), receivedBytesPerSecond: 1536, sentBytesPerSecond: 2.5 * 1024 ** 2, requestsTotal: 23 },
        ],
    });
    await renderRealtime();
    const section = realtimeSection();
    expect(fact("入站流量（接收）", section).textContent).toBe("1.5 KiB/s");
    expect(fact("出站流量（发送）", section).textContent).toBe("2.5 MiB/s");
    expect(fact("请求总数（官方采样值）", section).textContent).toBe("23");
    expect(plottedPoints(1).map((point) => point.requests)).toEqual([1000, 23]);
    realtimeData = realtime({ points: [{ time: stamp(1_000), receivedBytesPerSecond: 1023, sentBytesPerSecond: 1024, requestsTotal: 1234 }] });
    await advance();
    expect(fact("入站流量（接收）", section).textContent).toBe("1,023 B/s");
    expect(fact("出站流量（发送）", section).textContent).toBe("1 KiB/s");
    expect(fact("请求总数（官方采样值）", section).textContent).toBe("1,234");
});

test("三指标被缺失夹住的孤立0/7保留真实点和null，各Line开启dot但不连接缺口", async () => {
    controlPolling();
    for (const value of [0, 7]) {
        realtimeData = realtime({ points: [{ time: stamp(-2_000) }, { time: stamp(-1_000), receivedBytesPerSecond: value, sentBytesPerSecond: value, requestsTotal: value }, { time: stamp() }] });
        await renderRealtime();
        const expected = [
            { timestamp: NOW - 2_000, received: null, sent: null, requests: null },
            { timestamp: NOW - 1_000, received: value, sent: value, requests: value },
            { timestamp: NOW, received: null, sent: null, requests: null },
        ];
        expect(plottedPoints()).toEqual(expected);
        expect(plottedPoints(1)).toEqual(expected);
        expect([...realtimeSection().querySelectorAll('[data-recharts="line"]')].map((line) => [line.getAttribute("data-key"), line.getAttribute("data-dot"), line.getAttribute("data-connect-nulls")])).toEqual([
            ["received", "true", "false"],
            ["sent", "true", "false"],
            ["requests", "true", "false"],
        ]);
        await unmount();
    }
});

test("样本age按真实time而非checkedAt递增，陈旧阈值遵循采样间隔并展示实际实例", async () => {
    controlPolling();
    realtimeData = realtime({ instanceId: 67890, points: [{ time: stamp(-21_000), requestsTotal: 7 }] });
    await renderRealtime();
    const section = realtimeSection();
    expect(section.textContent).toContain("实例 67890");
    expect(section.textContent).toContain(`最新样本 ${new Date(stamp(-21_000)).toLocaleTimeString("zh-CN", { hour12: false })}`);
    expect(section.textContent).toContain("距今 21 秒");
    expect(section.textContent).toContain("样本间隔约 10 秒");
    expect(section.querySelector(".admin-status-badge")?.textContent).toBe("采样较旧");
    await advance();
    expect(section.textContent).toContain("距今 22 秒");
    realtimeData = { ...realtimeData, sampleIntervalSeconds: 60 };
    await advance();
    expect(section.textContent).toContain("样本间隔约 60 秒");
    expect(section.querySelector(".admin-status-badge")?.textContent).toBe("每秒刷新界面");
});

test("5分钟窗口剔除超窗/无效/未来时间且保留不均匀真实时间，不插值补点", async () => {
    controlPolling();
    realtimeData = realtime({ points: [-300_001, -300_000, -90_000, -1_000, 60_000].map((offset, index) => ({ time: stamp(offset), requestsTotal: index + 1 })).concat([{ time: "invalid", requestsTotal: 99 }]) });
    await renderRealtime();
    expect(plottedPoints().map((point) => point.timestamp)).toEqual([NOW - 300_000, NOW - 90_000, NOW - 1_000]);
    expect(plottedPoints(1).map((point) => point.requests)).toEqual([2, 3, 4]);
    await advance();
    expect(plottedPoints().map((point) => point.timestamp)).toEqual([NOW - 90_000, NOW - 1_000]);
    for (const axis of host.querySelectorAll('[data-recharts="axis"]')) expect(JSON.parse(axis.getAttribute("data-domain")!)).toEqual([NOW + 1_000 - 300_000, NOW + 1_000]);
});

test("1秒UItick与重复响应不为同一时间点追加假样本，曲线保持一个点", async () => {
    controlPolling();
    await renderRealtime();
    await advance(3);
    expect(realtimeCalls().map((call) => call.at)).toEqual([NOW, NOW + 1_000, NOW + 2_000, NOW + 3_000]);
    expect(realtimeSection().textContent).toContain("距今 3 秒");
    expect(plottedPoints()).toEqual([{ timestamp: NOW, received: 0, sent: 0, requests: 0 }]);
    expect(plottedPoints(1)).toEqual(plottedPoints());
});

test("在途请求跨多个tick保持单飞，完成后只发下一次请求而不追补积压tick", async () => {
    controlPolling();
    const pending = deferred<RainyunRealtime>();
    realtimeReply = async (config) => response(config, await pending.promise);
    await renderRealtime();
    expect(realtimeSection().textContent).toContain("等待真实采样");
    expect(plottedPoints()).toEqual([]);
    await advance(5);
    expect(realtimeCalls()).toHaveLength(1);
    expect(realtimeCalls()[0].signal?.aborted).toBe(false);
    realtimeReply = (config) => response(config, realtimeData);
    await act(async () => {
        pending.resolve(realtimeData);
    });
    await settle();
    expect(realtimeCalls()).toHaveLength(1);
    expect(plottedPoints()).toHaveLength(1);
    await advance();
    expect(realtimeCalls()).toHaveLength(2);
});

test("暂停立即取消在途请求和timer，迟到响应不能覆写保留样本，恢复重新读取", async () => {
    controlPolling();
    await renderRealtime();
    const pending = deferred<RainyunRealtime>();
    realtimeReply = async (config) => response(config, await pending.promise);
    await advance();
    const signal = realtimeCalls()[1].signal!;
    expect(signal.aborted).toBe(false);
    await renderRealtime(false);
    expect(signal.aborted).toBe(true);
    expect(pollingTimers.size).toBe(0);
    await advance(3);
    await act(async () => {
        pending.resolve(realtime({ points: [{ time: stamp(1_000), requestsTotal: 999 }] }));
    });
    await settle();
    expect(realtimeCalls()).toHaveLength(2);
    expect(realtimeSection().textContent).toContain("实时刷新已暂停");
    expect(fact("请求总数（官方采样值）", realtimeSection()).textContent).toBe("0");
    expect(realtimeSection().querySelector('[role="alert"]')).toBeNull();
    realtimeReply = (config) => response(config, realtimeData);
    await renderRealtime();
    expect(realtimeCalls()).toHaveLength(3);
});

test("初始隐藏不请求，隐藏时取消在途且不误报失败，恢复可见后继续真实采样", async () => {
    controlPolling();
    await setHidden(true);
    await renderRealtime();
    await advance(2);
    expect(realtimeCalls()).toHaveLength(0);
    expect(realtimeSection().textContent).toContain("实时刷新已暂停");
    await setHidden(false);
    const pending = deferred<RainyunRealtime>();
    realtimeReply = async (config) => response(config, await pending.promise);
    await advance();
    expect(realtimeCalls()).toHaveLength(2);
    await setHidden(true);
    expect(realtimeCalls()[1].signal?.aborted).toBe(true);
    await advance(4);
    expect(realtimeCalls()).toHaveLength(2);
    await act(async () => {
        pending.resolve(realtime({ points: [{ time: stamp(3_000), requestsTotal: 999 }] }));
    });
    await settle();
    expect(realtimeSection().querySelector('[role="alert"]')).toBeNull();
    realtimeReply = (config) => response(config, realtimeData);
    await setHidden(false);
    expect(realtimeCalls()).toHaveLength(3);
    expect(fact("请求总数（官方采样值）", realtimeSection()).textContent).toBe("0");
});

test("卸载取消在途请求并清除interval/visibility监听，迟到响应不再触发轮询", async () => {
    controlPolling();
    const pending = deferred<RainyunRealtime>();
    realtimeReply = async (config) => response(config, await pending.promise);
    await renderRealtime();
    const remove = spyOn(document, "removeEventListener");
    try {
        await unmount();
        expect(realtimeCalls()[0].signal?.aborted).toBe(true);
        expect(pollingTimers.size).toBe(0);
        expect(remove).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
        await act(async () => {
            pending.resolve(realtimeData);
        });
        await advance(3);
        await setHidden(true);
        await setHidden(false);
        expect(realtimeCalls()).toHaveLength(1);
        expect(error).not.toHaveBeenCalled();
    } finally {
        remove.mockRestore();
    }
});

test("服务端cooldown期间仍每秒更新age但不请求，可见性变化不绕过退避", async () => {
    controlPolling();
    realtimeData = realtime({ status: "warning", statusMessage: "云端限流，稍后重试", retryAfterSeconds: 4 });
    await renderRealtime();
    expect(realtimeSection().querySelector(".admin-status-badge")?.textContent).toBe("采集退避中");
    await advance(3);
    expect(realtimeCalls()).toHaveLength(1);
    expect(realtimeSection().textContent).toContain("距今 3 秒");
    await setHidden(true);
    await setHidden(false);
    expect(realtimeCalls()).toHaveLength(1);
    realtimeData = realtime({ status: "error", statusMessage: "官方监控采集失败", retryAfterSeconds: 4 });
    await advance();
    expect(realtimeCalls().map((call) => call.at)).toEqual([NOW, NOW + 4_000]);
    expect(realtimeSection().querySelector(".admin-status-badge")?.textContent).toBe("实时采集失败");
    expect(realtimeSection().querySelector('[role="alert"]')?.textContent).toBe("官方监控采集失败");
    expect(plottedPoints()).toHaveLength(1);
});

test("请求失败保留样本并按2/4/8/16/30秒退避，成功后清错误并重置失败计数", async () => {
    controlPolling();
    await renderRealtime();
    realtimeCode = 1001;
    await advance();
    expect(realtimeSection().querySelector('[role="alert"]')?.textContent).toBe("监控请求失败");
    const saved = plottedPoints();
    for (const delay of [2, 4, 8, 16, 30, 30]) {
        const count = realtimeCalls().length;
        await advance(delay - 1);
        expect(realtimeCalls()).toHaveLength(count);
        expect(plottedPoints()).toEqual(saved);
        await advance();
        expect(realtimeCalls()).toHaveLength(count + 1);
    }
    realtimeCode = 0;
    await advance(30);
    expect(realtimeSection().querySelector('[role="alert"]')).toBeNull();
    const recovered = realtimeCalls().length;
    await advance();
    expect(realtimeCalls()).toHaveLength(recovered + 1);
    realtimeCode = 1001;
    await advance();
    const failedAgain = realtimeCalls().length;
    await advance();
    expect(realtimeCalls()).toHaveLength(failedAgain);
    await advance();
    expect(realtimeCalls()).toHaveLength(failedAgain + 1);
});
