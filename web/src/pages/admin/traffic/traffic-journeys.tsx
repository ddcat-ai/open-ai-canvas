import type { ColumnsType } from "antd/es/table";
import { ArrowRight, ChevronDown, Filter, Flag, Info, LogIn, LogOut, Route } from "lucide-react";
import { useState } from "react";

import { siteTrafficPageLabels } from "@/lib/site-traffic";
import type { SiteTrafficOperations, SiteTrafficPage } from "@/services/api/site-traffic";
import { AdminDataTable, AdminEmpty } from "../components/admin-ui";
import { Tooltip } from "../ui/controls";
import "./traffic-operations.css";

export type TrafficJourneysProps = {
    data?: SiteTrafficOperations;
    loading: boolean;
    unavailableValue: string;
    partial: boolean;
};

type EndpointPage = SiteTrafficOperations["endpoints"]["first"]["pages"][number];
type PathRow = SiteTrafficOperations["paths"]["rows"][number] & { key: string; rank: number };
type FunnelStep = SiteTrafficOperations["funnel"]["steps"][number];

const count = new Intl.NumberFormat("zh-CN");
const ratio = new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const percent = (value: number | null) => (value === null ? "无可用分母" : `${ratio.format(value * 100)}%`);
const pageLabel = (page: SiteTrafficPage) => (Object.hasOwn(siteTrafficPageLabels, page) ? siteTrafficPageLabels[page] : "未登记页面");
const funnelKeys = ["inspirations", "open_create", "create", "submit"] as const;
const funnelLabels: Record<FunnelStep["key"], string> = {
    inspirations: "浏览灵感",
    open_create: "灵感点击进入创作",
    create: "创作 PV",
    submit: "提交任意模式意图",
};

export function TrafficJourneys({ data, loading, unavailableValue, partial }: TrafficJourneysProps) {
    const [endpoint, setEndpoint] = useState<"first" | "last">("first");
    const selectedEndpoint = data?.endpoints[endpoint];
    const endpointLabel = endpoint === "first" ? "首个观察页" : "末个观察页";
    const paths: PathRow[] = (data?.paths.rows ?? []).slice(0, 10).map((row, index) => ({ ...row, key: `${row.from}:${row.to}`, rank: index + 1 }));
    const steps = data ? funnelKeys.flatMap((key) => data.funnel.steps.filter((step) => step.key === key)) : [];
    const endpointColumns: ColumnsType<EndpointPage> = [
        { title: "页面", dataIndex: "page", width: 188, render: (page: SiteTrafficPage) => <span className="admin-traffic-ops-name">{pageLabel(page)}</span> },
        { title: "会话", dataIndex: "visits", align: "center", width: 88, render: (value: number) => count.format(value) },
        { title: "占 PV 会话", dataIndex: "rate", align: "center", width: 112, render: percent },
    ];
    const pathColumns: ColumnsType<PathRow> = [
        {
            title: "相邻观察路径",
            key: "path",
            width: 300,
            render: (_, row) => (
                <div className="admin-traffic-ops-path">
                    <span className="admin-traffic-ops-rank">{row.rank}</span>
                    <div className="admin-traffic-ops-route">
                        <span className="admin-traffic-ops-name">{pageLabel(row.from)}</span>
                        <ArrowRight className="size-3.5" aria-hidden="true" />
                        <span className="sr-only">到</span>
                        <span className="admin-traffic-ops-name">{pageLabel(row.to)}</span>
                    </div>
                </div>
            ),
        },
        { title: "涉及会话", dataIndex: "visits", align: "center", width: 96, render: (value: number) => count.format(value) },
        { title: "占 PV 会话", dataIndex: "rate", align: "center", width: 112, render: percent },
    ];
    const funnelColumns: ColumnsType<FunnelStep> = [
        {
            title: "固定步骤",
            dataIndex: "key",
            width: 212,
            render: (key: FunnelStep["key"]) => (
                <div className="admin-traffic-ops-path">
                    <span className="admin-traffic-ops-rank">{funnelKeys.indexOf(key) + 1}</span>
                    <span className="admin-traffic-ops-name">{funnelLabels[key]}</span>
                </div>
            ),
        },
        {
            title: (
                <Tooltip title="同一会话按固定四步匹配，每一步的服务端接收秒都必须严格递增。">
                    <span tabIndex={0} className="admin-traffic-ops-definition">
                        严格确认会话
                    </span>
                </Tooltip>
            ),
            key: "confirmed",
            align: "center",
            width: 136,
            render: (_, row) => (
                <span className="admin-traffic-ops-cell-stack">
                    <strong>{count.format(row.visits)}</strong>
                    <small>允许同秒 {count.format(row.possibleVisits)}</small>
                </span>
            ),
        },
        {
            title: (
                <Tooltip title="允许同秒的可能到达会话减去严格确认会话；这些会话的步骤顺序仍待确定。">
                    <span tabIndex={0} className="admin-traffic-ops-definition">
                        同秒顺序待定
                    </span>
                </Tooltip>
            ),
            dataIndex: "uncertainVisits",
            align: "center",
            width: 128,
            render: (value: number) => count.format(value),
        },
        { title: "起点到达率", dataIndex: "rate", align: "center", width: 120, render: percent },
        { title: "相对上步比例", key: "previousRate", align: "center", width: 128, render: (_, row) => (row.key === "inspirations" ? "起点" : percent(row.previousRate)) },
    ];

    return (
        <div className="admin-traffic-ops" aria-label="访问路径与创作意图漏斗" aria-busy={loading}>
            <div className="admin-traffic-ops-grid">
                <section className="admin-traffic-ops-panel" aria-labelledby="admin-traffic-endpoints-title">
                    <header className="admin-traffic-ops-heading">
                        <div>
                            <span className="admin-traffic-ops-icon" data-accent="cyan">
                                <Flag className="size-4" aria-hidden="true" />
                            </span>
                            <h2 id="admin-traffic-endpoints-title">会话首末观察页</h2>
                        </div>
                        <div className="admin-traffic-ops-toggle" role="group" aria-label="切换首末观察页">
                            <button type="button" aria-pressed={endpoint === "first"} onClick={() => setEndpoint("first")}>
                                <LogIn className="size-3.5" aria-hidden="true" />
                                首个观察页
                            </button>
                            <button type="button" aria-pressed={endpoint === "last"} onClick={() => setEndpoint("last")}>
                                <LogOut className="size-3.5" aria-hidden="true" />
                                末个观察页
                            </button>
                        </div>
                    </header>
                    <p className="admin-traffic-ops-help">运营帮助：用首个观察页检查引流承接，用末个观察页定位值得补充下一步入口或内容衔接的位置。</p>
                    <p className="admin-traffic-ops-note">仅范围内最早／最晚接收秒的 PV；非真实入口或退出，末页不代表跳出率或停留时长。</p>
                    {data && selectedEndpoint ? (
                        <p className="admin-traffic-ops-note">
                            PV 会话分母 {count.format(data.endpoints.visits)} · {endpointLabel}歧义未分配 {count.format(selectedEndpoint.undeterminedVisits)} 个会话
                        </p>
                    ) : null}
                    <AdminDataTable<EndpointPage>
                        skeletonColumns={3}
                        table={{ rowKey: "page", size: "small", loading, columns: endpointColumns, dataSource: selectedEndpoint?.pages ?? [], pagination: false, tableLayout: "fixed", scroll: { x: 388 } }}
                        empty={<AdminEmpty title={data ? `当前范围暂无可确定的${endpointLabel}` : unavailableValue} description={data ? "同秒多页面歧义单独保留，不强行分配到页面。" : undefined} />}
                    />
                    <details className="admin-traffic-ops-details">
                        <summary>
                            <span>
                                <Info className="size-3.5" aria-hidden="true" />
                                口径与运营建议
                            </span>
                            <ChevronDown className="size-3.5" aria-hidden="true" />
                        </summary>
                        <ul>
                            <li>按范围内每个有 PV 的会话，取服务端最早／最晚接收秒对应的页面。该秒有多个页面时计为歧义，不分配页面；占比以范围内 PV 会话为分母，含未分配会话。</li>
                            <li>登记 13 类页面，当前实际路由覆盖 11 类；仅观察所选时段，范围截断、跨标签共用会话与采集缺失都可能改变首末页；不能据末页推算真实退出、跳出或停留。</li>
                            <li>先核对活动是否承接到预期页面；对高频末页检查下一步按钮与相关内容是否清晰，再结合下方观察路径判断，不把末页多直接当作体验差。</li>
                        </ul>
                    </details>
                </section>

                <section className="admin-traffic-ops-panel" aria-labelledby="admin-traffic-paths-title">
                    <header className="admin-traffic-ops-heading">
                        <div>
                            <span className="admin-traffic-ops-icon">
                                <Route className="size-4" aria-hidden="true" />
                            </span>
                            <h2 id="admin-traffic-paths-title">Top 10 相邻观察路径</h2>
                        </div>
                    </header>
                    <p className="admin-traffic-ops-help">运营帮助：找出常见页面衔接，优先优化高频路径的导航入口，并核对预期路径是否容易被发现。</p>
                    <p className="admin-traffic-ops-note">登记 13 类页面，当前实际路由覆盖 11 类的观察投影，非直接跳转或完整单标签轨迹；各路径会话可重叠，占比不能相加。</p>
                    {data ? (
                        <p className="admin-traffic-ops-note">
                            PV 会话分母 {count.format(data.paths.visits)} · 含歧义的会话 {count.format(data.paths.ambiguousVisits)}，路径不跨歧义点串接
                        </p>
                    ) : null}
                    <AdminDataTable<PathRow>
                        skeletonColumns={3}
                        table={{ rowKey: "key", size: "small", loading, columns: pathColumns, dataSource: paths, pagination: false, tableLayout: "fixed", scroll: { x: 508 } }}
                        empty={<AdminEmpty title={data ? "当前范围暂无可确认的相邻观察路径" : unavailableValue} description={data ? "单页会话或存在同秒歧义时，不补造页面衔接。" : undefined} />}
                    />
                    <details className="admin-traffic-ops-details">
                        <summary>
                            <span>
                                <Info className="size-3.5" aria-hidden="true" />
                                口径与运营建议
                            </span>
                            <ChevronDown className="size-3.5" aria-hidden="true" />
                        </summary>
                        <ul>
                            <li>按服务端接收秒观察相邻 PV 页面对，按涉及会话数展示前 10 条。同一会话同一路径只计一次，但可同时出现在多条路径中，比例以本条聚合的 PV 会话为分母。</li>
                            <li>歧义点不跨越串接；未采集的页面、范围外事件、跨标签行为和接收延迟都可能改变投影，不代表真实直接点击顺序。</li>
                            <li>高频路径可优先放置便捷入口；预期衔接较弱时核对按钮命名、位置和内容关联，再观察调整前后变化，不凭排名认定因果或流失。</li>
                        </ul>
                    </details>
                </section>
            </div>

            <section className="admin-traffic-ops-panel" aria-labelledby="admin-traffic-funnel-title">
                <header className="admin-traffic-ops-heading">
                    <div>
                        <span className="admin-traffic-ops-icon" data-accent="cyan">
                            <Filter className="size-4" aria-hidden="true" />
                        </span>
                        <h2 id="admin-traffic-funnel-title">创作意图漏斗</h2>
                    </div>
                    {data && partial ? (
                        <span className="admin-traffic-ops-badge" data-tone="warning">
                            时段进行中 · 尚非最终结果
                        </span>
                    ) : null}
                </header>
                <p className="admin-traffic-ops-help">运营帮助：沿固定四步找到尚未确认衔接的环节，优先核对灵感内容、进入创作入口与提交引导。</p>
                <p className="admin-traffic-ops-note">严格确认要求接收秒递增；同秒顺序待定不等于永久流失。提交仅为意图，不代表任务、生成或收费成功。</p>
                <p className="admin-traffic-ops-note">两种比例均按严格确认会话计算：相对漏斗起点、相对上一步；“允许同秒”只表示可能到达。</p>
                {data && steps[0]?.visits === 0 ? (
                    <AdminEmpty title="当前范围暂无漏斗起点会话" description="灵感嵌于创作页，没有独立灵感 PV 起点；直接进入创作或使用内嵌灵感不补造完整四步链路。" />
                ) : (
                    <AdminDataTable<FunnelStep>
                        skeletonColumns={5}
                        table={{ rowKey: "key", size: "small", loading, columns: funnelColumns, dataSource: steps, pagination: false, tableLayout: "fixed", scroll: { x: 724 } }}
                        empty={<AdminEmpty title={data ? "当前范围暂无漏斗数据" : unavailableValue} />}
                    />
                )}
                <details className="admin-traffic-ops-details">
                    <summary>
                        <span>
                            <Info className="size-3.5" aria-hidden="true" />
                            口径与运营建议
                        </span>
                        <ChevronDown className="size-3.5" aria-hidden="true" />
                    </summary>
                    <ul>
                        <li>只统计所选范围内、同一会话依次到达“浏览灵感 → 灵感点击进入创作 → 创作 PV → 提交任意模式意图”的链路；直接进入创作但没有前置灵感步骤的会话不计入后续步骤。</li>
                        <li>当前灵感嵌于创作页，没有独立灵感 PV 起点；使用内嵌灵感仅填入创作内容，不新增页面浏览或导航意图，也不补造完整链路。画布独立 Agent 提交当前无采集。</li>
                        <li>严格确认要求每一步接收秒严格递增；允许同秒的可能到达会话减去严格确认会话，就是同秒顺序待定。接收顺序不保证等于实际操作顺序，可能到达也不能当作已确认转化。</li>
                        <li>起点到达率为本步严格确认会话／起点会话；相对上步比例为本步严格确认会话／上步严格确认会话。零分母不计算，起点没有上步比例。</li>
                        <li>差距较大的步骤适合优先核对入口与内容承接，但未确认不等于永久流失；时段进行中应待相同截止口径再比较。最后一步是任意创作模式的提交意图，不是成功任务或计费结果。</li>
                    </ul>
                </details>
            </section>
        </div>
    );
}
