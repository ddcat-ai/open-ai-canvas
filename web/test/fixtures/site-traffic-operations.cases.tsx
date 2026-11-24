import { expect, test } from "bun:test";
import type { ReactNode } from "react";

import { TrafficJourneys } from "../../src/pages/admin/traffic/traffic-journeys";
import { TrafficOperations } from "../../src/pages/admin/traffic/traffic-operations";
import { trafficOperationsFixture } from "./site-traffic-operations.fixture";

type TrafficOperationsCaseContext = {
    host: () => HTMLDivElement;
    requestCount: () => number;
    render: (contents?: ReactNode) => Promise<void>;
    click: (label: string, scope?: ParentNode) => Promise<void>;
    selectSource: (label: string) => Promise<void>;
};

export function registerTrafficOperationsCases(context: TrafficOperationsCaseContext) {
    const section = (id: string) => context.host().querySelector(`#${id}`)!.closest("section")!;
    const rows = (id: string) => section(id).querySelectorAll("tbody .ant-table-row");

    test("真实页五项均有运营帮助、关键限制与原生可展开口径，不扩请求", async () => {
        await context.render();
        expect(context.requestCount()).toBe(2);
        for (const id of ["visitor-mix", "anomalies", "endpoints", "paths", "funnel"]) {
            const panel = section(`admin-traffic-${id}-title`);
            expect(panel.querySelector(".admin-traffic-ops-help")!.textContent).toContain("运营帮助：");
            const details = panel.querySelector<HTMLDetailsElement>("details")!;
            expect(details.open).toBe(false);
            const summary = details.querySelector("summary")!;
            expect(summary.textContent).toContain("口径与运营建议");
            expect(summary.getAttribute("tabindex")).not.toBe("-1");
        }
        expect(section("admin-traffic-paths-title").textContent).toContain("占比不能相加");
        expect(section("admin-traffic-funnel-title").textContent).toContain("不代表任务、生成或收费成功");
        expect(section("admin-traffic-funnel-title").textContent).toContain("同秒顺序待定不等于永久流失");
        expect(section("admin-traffic-anomalies-title").textContent).toContain("未触发不等于无故障");
        expect(rows("admin-traffic-funnel-title")).toHaveLength(4);
    });

    test("首末切换只改本地展示且来源筛选不改变运营聚合", async () => {
        await context.render();
        const panel = section("admin-traffic-endpoints-title");
        const first = Array.from(panel.querySelectorAll("button")).find((node) => node.textContent?.includes("首个观察页"))!;
        const last = Array.from(panel.querySelectorAll("button")).find((node) => node.textContent?.includes("末个观察页"))!;
        expect(first.getAttribute("aria-pressed")).toBe("true");
        expect(rows("admin-traffic-endpoints-title")[0]!.textContent).toContain("灵感");
        const before = context.requestCount();
        await context.click("末个观察页", panel);
        expect(last.getAttribute("aria-pressed")).toBe("true");
        expect(first.getAttribute("aria-pressed")).toBe("false");
        expect(rows("admin-traffic-endpoints-title")[0]!.textContent).toContain("画布");
        expect(panel.textContent).toContain("歧义未分配 0 个会话");
        const journey = context.host().querySelector('[aria-label="访问路径与创作意图漏斗"]')!.textContent;
        await context.selectSource("创作");
        expect(context.requestCount()).toBe(before);
        expect(context.host().querySelector('[aria-label="访问路径与创作意图漏斗"]')!.textContent).toBe(journey);
    });

    test("无前置窗不显示虚构新访比例，小样本和零基数不标正常", async () => {
        const data = trafficOperationsFixture();
        Object.assign(data.visitorMix, { status: "no_lookback", firstObservedVisitors: null, returningVisitors: null, firstObservedRate: null, returningRate: null });
        data.anomalies.metrics[0] = { key: "visitors", current: 20, previous: 10, relativeChange: 1, status: "insufficient_sample" };
        await context.render(<TrafficOperations data={data} loading={false} unavailableValue="不可用" partial={false} />);
        const mix = section("admin-traffic-visitor-mix-title");
        expect(mix.textContent).toContain("无前置回看窗口，无法划分");
        expect(mix.querySelector("dl")).toBeNull();
        const anomalyRows = rows("admin-traffic-anomalies-title");
        expect(anomalyRows[0]!.textContent).toContain("样本不足，暂不可判断");
        expect(anomalyRows[1]!.textContent).toContain("上期为 0，暂不可判断");
        expect(context.host().querySelector('[data-tone="success"]')).toBeNull();
        expect(context.requestCount()).toBe(0);
    });

    test("历史不可比与未触发规则分开，进行中提示保留", async () => {
        const data = trafficOperationsFixture({
            asOf: "2026-11-10T08:00:00Z",
            effectiveFrom: "2026-11-01T00:00:00+08:00",
            kpi: { visitors: 50, pageViews: 100, visits: 60, actions: 30 },
            comparison: { status: "ready", kpi: { visitors: 50, pageViews: 100, visits: 60, actions: 30 } },
        });
        await context.render(<TrafficOperations data={data} loading={false} unavailableValue="不可用" partial />);
        expect(rows("admin-traffic-anomalies-title")[0]!.textContent).toContain("未触发当前规则");
        expect(context.host().textContent).toContain("时段进行中");
        expect(context.requestCount()).toBe(0);
    });

    test("无数据不伪造计数或百分比", async () => {
        await context.render(
            <>
                <TrafficOperations loading={false} unavailableValue="不可用" partial={false} />
                <TrafficJourneys loading={false} unavailableValue="不可用" partial={false} />
            </>,
        );
        expect(rows("admin-traffic-endpoints-title")).toHaveLength(0);
        expect(rows("admin-traffic-funnel-title")).toHaveLength(0);
        expect(context.host().textContent).toContain("不可用");
        expect(context.host().querySelector(".admin-traffic-ops-mix")).toBeNull();
        expect(context.requestCount()).toBe(0);
    });

    test("历史不可比不补上期基数，也不误标稳定", async () => {
        const data = trafficOperationsFixture({
            asOf: "2026-11-10T08:00:00Z",
            effectiveFrom: "2026-11-01T00:00:00+08:00",
            kpi: { visitors: 1, pageViews: 2, visits: 1, actions: 0 },
            comparison: { status: "outside_retention", kpi: null },
        });
        await context.render(<TrafficOperations data={data} loading={false} unavailableValue="不可用" partial={false} />);
        expect(rows("admin-traffic-anomalies-title")[0]!.textContent).toContain("不可比");
        expect(rows("admin-traffic-anomalies-title")[0]!.textContent).not.toContain("未触发当前规则");
        expect(section("admin-traffic-anomalies-title").textContent).toContain("上期超出保留窗口，暂不可判断");
    });

    test("无漏斗起点不渲染伪转化率", async () => {
        const data = trafficOperationsFixture();
        for (const step of data.funnel.steps) Object.assign(step, { visits: 0, possibleVisits: 0, uncertainVisits: 0, rate: null, previousRate: null });
        await context.render(<TrafficJourneys data={data} loading={false} unavailableValue="不可用" partial={false} />);
        expect(section("admin-traffic-funnel-title").textContent).toContain("当前范围暂无漏斗起点会话");
        expect(section("admin-traffic-funnel-title").textContent).toContain("没有独立灵感 PV 起点");
        expect(rows("admin-traffic-funnel-title")).toHaveLength(0);
    });

    test("漏斗严格和可能值并列、歧义数量及自有分母保留", async () => {
        const data = trafficOperationsFixture();
        await context.render(<TrafficJourneys data={data} loading={false} unavailableValue="不可用" partial />);
        const funnel = section("admin-traffic-funnel-title");
        expect(funnel.textContent).toContain("起点到达率");
        expect(funnel.textContent).toContain("相对上步比例");
        expect(funnel.textContent).toContain("时段进行中 · 尚非最终结果");
        expect(rows("admin-traffic-funnel-title")[1]!.textContent).toContain("允许同秒 4");
        expect(section("admin-traffic-endpoints-title").textContent).toContain("PV 会话分母 5");
        expect(section("admin-traffic-paths-title").textContent).toContain("含歧义的会话 1");
        expect(context.requestCount()).toBe(0);
    });
}
