import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { trafficDateBounds, trafficEventTime, trafficPresetRange, trafficRangeError } from "../src/pages/admin/traffic/traffic-range";

const now = Date.parse("2026-11-10T16:05:00.000Z");

test("上海自然日不受机器时区影响，快捷范围含首尾且保持7/30/60天", () => {
    expect(trafficDateBounds(now)).toEqual({ today: "2026-11-11", earliest: "2025-11-12" });
    expect(trafficPresetRange(7, now)).toEqual({ from: "2026-11-05", to: "2026-11-11" });
    expect(trafficPresetRange(30, now)).toEqual({ from: "2026-10-13", to: "2026-11-11" });
    expect(trafficPresetRange(60, now)).toEqual({ from: "2026-09-13", to: "2026-11-11" });
    expect(trafficDateBounds(Date.parse("2026-11-10T15:59:59Z")).today).toBe("2026-11-10");
});

test("仅允许含今日近365日，非法/倒序/未来和过早日期明确拒绝而不截断", () => {
    expect(trafficRangeError({ from: "2025-11-12", to: "2026-11-11" }, now)).toBe("");
    for (const range of [
        { from: "2025-11-11", to: "2026-11-11" },
        { from: "2026-11-11", to: "2026-11-12" },
        { from: "2026-11-10", to: "2026-11-09" },
        { from: "2026-02-30", to: "2026-03-01" },
        { from: "2026-2-01", to: "2026-03-01" },
        { from: "", to: "2026-11-11" },
    ])
        expect(trafficRangeError(range, now)).not.toBe("");
    const leapNow = Date.parse("2024-03-01T12:00:00Z");
    expect(trafficRangeError({ from: "2024-02-29", to: "2024-03-01" }, leapNow)).toBe("");
    expect(trafficEventTime("2026-11-10T16:05:00Z")).toBe("2026-11-11 00:05");
    expect(trafficEventTime(null)).toBe("暂无保留事件");
});

test("访问统计独立懒加载、导航紧接运行总览且旧index接线不变", async () => {
    const router = await Bun.file(new URL("../src/router.tsx", import.meta.url)).text();
    const shell = await Bun.file(new URL("../src/pages/admin/components/admin-shell.tsx", import.meta.url)).text();
    expect(router).toContain('const TrafficPage = lazyAdminPage(() => import("@/pages/admin/traffic/traffic-page"))');
    expect(router).toContain('{ path: "traffic", element: <TrafficPage /> }');
    expect(router).toContain("{ index: true, element: <AnalyticsPage /> }");
    expect(shell).toMatch(/path: "\/admin", [^\n]*label: "运行总览"[^\n]*\r?\n\s*\{ path: "\/admin\/traffic", [^\n]*label: "访问统计", shortLabel: "访问", icon: <MousePointerClick/);
    const page = await Bun.file(new URL("../src/pages/admin/traffic/traffic-page.tsx", import.meta.url)).text();
    expect(page).toContain('<AdminPageFrame title="访问统计"');
    expect(page).toContain('queryKey: ["admin", "site-traffic", range.from, range.to]');
    expect(page).toContain("getSiteTrafficOverview(range, { signal })");
    expect(page).not.toContain("refetchInterval");
    expect(page).toContain("AdminExportButton");
    expect(page).toContain("createTrafficCsv(snapshot, kind, sourcePage)");
    expect(page).toContain("const snapshot = data");
    expect(page).toContain("!rangeError && query.isSuccess ? query.data : undefined");
});

test("趋势图职责局部抽取，保留动态系列/650ms/减少动画及两组正交切换", async () => {
    const page = await Bun.file(new URL("../src/pages/admin/traffic/traffic-page.tsx", import.meta.url)).text();
    const chart = await Bun.file(new URL("../src/pages/admin/traffic/traffic-trend-chart.tsx", import.meta.url)).text();
    expect(page).toContain('import { TrafficTrendChart } from "./traffic-trend-chart"');
    expect(page).toContain("getSiteTrafficToday({ signal })");
    expect(page).toContain("useState(false)");
    expect(page).toContain("15_000");
    expect(page).toContain("cancelRefetch: false");
    expect(page).not.toContain("ComposedChart");
    expect(chart.split("\n").length).toBeLessThan(500);
    expect(chart).toContain("<ComposedChart");
    expect(chart).toContain("<Area");
    expect(chart).toContain("visitSeriesConfig");
    expect(chart).toContain("animationDuration={650}");
    expect(chart).toContain("isAnimationActive={chartAnimated}");
    expect(chart).toContain("(prefers-reduced-motion: reduce)");
    expect(chart).toContain('aria-label="趋势时间粒度"');
    expect(chart).toContain('aria-label="趋势视图"');
    expect(chart).toContain('aria-label="趋势图例筛选"');
    expect(chart).toContain('id="admin-traffic-trend-title"');
    expect(chart).toContain("onFocus={() => setFocusedSeries(series.key)}");
});

test("页面私有样式无普通卡片装饰边框，复用既有admin token并处理窄屏与减少动画", async () => {
    const css = await Bun.file(new URL("../src/pages/admin/traffic/traffic-page.css", import.meta.url)).text();
    const tokens = await Bun.file(new URL("../src/pages/admin/theme/admin-tokens.css", import.meta.url)).text();
    const definitions = new Set([...(tokens + css).matchAll(/(--admin-[\w-]+)\s*:/g)].map((match) => match[1]));
    for (const match of css.matchAll(/var\((--admin-[\w-]+)\)/g)) expect(definitions.has(match[1]!)).toBe(true);
    expect(css).not.toMatch(/border(?:-left|-right|-top|-bottom)?:\s*1px/);
    for (const match of css.matchAll(/box-shadow:\s*([^;]+);/g)) expect(match[1]!.trim()).toBe("none");
    expect(css).toContain("@media (max-width: 640px)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("height: calc(var(--admin-space) * 35)");
    expect(css).toContain("overflow: hidden");
});

test("五项扩展局限本页，热力图键盘/范围边界、七功能断点与CSV成熟转义有明确实现", async () => {
    const page = await Bun.file(new URL("../src/pages/admin/traffic/traffic-page.tsx", import.meta.url)).text();
    const heatmap = await Bun.file(new URL("../src/pages/admin/traffic/traffic-heatmap.tsx", import.meta.url)).text();
    const chart = await Bun.file(new URL("../src/pages/admin/traffic/traffic-trend-chart.tsx", import.meta.url)).text();
    const csv = await Bun.file(new URL("../src/pages/admin/traffic/traffic-csv.ts", import.meta.url)).text();
    const css = await Bun.file(new URL("../src/pages/admin/traffic/traffic-page.css", import.meta.url)).text();
    expect(heatmap.split("\n").length).toBeLessThan(500);
    expect(csv.split("\n").length).toBeLessThan(500);
    expect(page).toContain("<TrafficHeatmap cells={data?.insights.heatmap}");
    expect(heatmap).toContain("aria-describedby={tooltipId}");
    expect(heatmap).toContain("onFocus={() => setActiveKey(key)}");
    expect(heatmap).toContain("cell.pageViews === null");
    expect(heatmap).toContain("outside_range");
    expect(chart).toContain("dataKey={`features.${series.key}`}");
    expect(chart).toContain("disabled={features}");
    expect(chart).toContain("features: point.counts");
    expect(chart).toContain("connectNulls={false}");
    expect(csv).toContain('import Papa from "papaparse"');
    expect(csv).toContain("Papa.unparse");
    expect(csv).toContain("escapeFormulae: formulaPrefix");
    expect(csv).toContain("snapshot.trend.map");
    expect(csv).not.toContain("...snapshot");
    expect(csv).not.toContain("fetch(");
    expect(csv).not.toContain("apiClient");
    expect(css).toContain("[data-admin-root] .admin-traffic-page .admin-traffic-heatmap-scroll");
    expect(css).toContain("overflow-x: auto");
    expect(css).toContain("admin-traffic-heatmap-cell, .admin-traffic-heatmap-scroll):focus-visible");
});

test("运营分析只展示原概览数据，五项帮助/原生折叠/局部样式及无新副作用保持", async () => {
    const page = await Bun.file(new URL("../src/pages/admin/traffic/traffic-page.tsx", import.meta.url)).text();
    const operations = await Bun.file(new URL("../src/pages/admin/traffic/traffic-operations.tsx", import.meta.url)).text();
    const journeys = await Bun.file(new URL("../src/pages/admin/traffic/traffic-journeys.tsx", import.meta.url)).text();
    const css = await Bun.file(new URL("../src/pages/admin/traffic/traffic-operations.css", import.meta.url)).text();
    const tokens = await Bun.file(new URL("../src/pages/admin/theme/admin-tokens.css", import.meta.url)).text();
    const pageCss = await Bun.file(new URL("../src/pages/admin/traffic/traffic-page.css", import.meta.url)).text();
    expect(page).toMatch(/<TrafficOperations\s+data=\{data\?\.insights\.operations\}/);
    expect(page).toMatch(/<TrafficJourneys\s+data=\{data\?\.insights\.operations\}/);
    for (const source of [operations, journeys]) {
        expect(source.split("\n").length).toBeLessThan(500);
        expect(source).not.toMatch(/useQuery|setInterval|fetch\(|localStorage|createTrafficCsv/);
        expect(source).toContain("口径与运营建议");
        expect(source).toContain("运营帮助：");
    }
    expect(journeys).toContain('aria-pressed={endpoint === "first"}');
    expect(journeys).toContain('aria-pressed={endpoint === "last"}');
    expect((operations + journeys).match(/<details /g)).toHaveLength(5);
    const definitions = new Set([...(tokens + pageCss).matchAll(/(--admin-[\w-]+)\s*:/g)].map((match) => match[1]));
    for (const match of (pageCss + css).matchAll(/var\((--admin-[\w-]+)\)/g)) expect(definitions.has(match[1]!)).toBe(true);
    expect(css).toContain("@media (max-width: 640px)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).not.toMatch(/\.ant-(?:switch|checkbox|radio|segmented)/);
});

// DOM、图表尺寸替身和请求adapter全部限制在独立子进程，真实页面/Query/Input/Table不替换。
test("真实访问统计页的范围切换、取消、错误/零值、来源过滤与安全显示", () => {
    const result = Bun.spawnSync([process.execPath, "test", "--timeout", "10000", "./test/fixtures/site-traffic-admin.harness.tsx"], {
        cwd: resolve(import.meta.dir, ".."),
        env: { ...process.env, TZ: "America/Los_Angeles" },
        timeout: 60000,
    });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("0 fail");
    expect(output).toMatch(/[1-9]\d* pass/);
}, 65000);
