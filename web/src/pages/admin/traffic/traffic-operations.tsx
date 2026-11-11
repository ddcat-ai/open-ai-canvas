import type { ColumnsType } from "antd/es/table";
import { Activity, ChevronDown, Info, Users } from "lucide-react";

import type { SiteTrafficOperations } from "@/services/api/site-traffic";
import { AdminDataTable, AdminEmpty } from "../components/admin-ui";
import { Tooltip } from "../ui/controls";
import { trafficEventTime } from "./traffic-range";
import "./traffic-operations.css";

export type TrafficOperationsProps = {
    data?: SiteTrafficOperations;
    loading: boolean;
    unavailableValue: string;
    partial: boolean;
};

type AnomalyMetric = SiteTrafficOperations["anomalies"]["metrics"][number];

const count = new Intl.NumberFormat("zh-CN");
const ratio = new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const percent = (value: number | null) => (value === null ? "无可用分母" : `${ratio.format(value * 100)}%`);
const metricLabels: Record<AnomalyMetric["key"], string> = {
    visitors: "UV 访客",
    pageViews: "PV 浏览量",
    visits: "访问会话",
    actions: "关键操作（含导航）",
};
const statusLabels: Record<AnomalyMetric["status"], string> = {
    increase: "上升触发提示",
    decrease: "下降触发提示",
    stable: "未触发当前规则",
    insufficient_sample: "样本不足，暂不可判断",
    zero_baseline: "上期为 0，暂不可判断",
    unavailable: "历史不可比，暂不可判断",
};

export function TrafficOperations({ data, loading, unavailableValue, partial }: TrafficOperationsProps) {
    const mix = data?.visitorMix;
    const anomalies = data?.anomalies;
    const comparable = anomalies?.status === "ready";
    const historyNote = anomalies?.status === "outside_retention" ? "上期超出保留窗口，暂不可判断" : "历史不足，暂不可判断";
    const columns: ColumnsType<AnomalyMetric> = [
        { title: "指标", dataIndex: "key", width: 160, render: (key: AnomalyMetric["key"]) => metricLabels[key] },
        { title: "本期", dataIndex: "current", align: "center", width: 88, render: (value: number) => count.format(value) },
        {
            title: "上期基线",
            dataIndex: "previous",
            align: "center",
            width: 96,
            render: (value: number | null) => (comparable && value !== null ? count.format(value) : "不可比"),
        },
        {
            title: "等时段变化",
            key: "change",
            align: "center",
            width: 116,
            render: (_, row) => {
                if (!comparable || row.previous === null) return "不可比";
                const delta = row.current - row.previous;
                return (
                    <span className="admin-traffic-ops-cell-stack">
                        <strong>
                            {delta > 0 ? "+" : ""}
                            {count.format(delta)}
                        </strong>
                        <small>{row.previous === 0 ? "基数为 0" : row.relativeChange === null ? "比例不可算" : `${row.relativeChange > 0 ? "+" : ""}${percent(row.relativeChange)}`}</small>
                    </span>
                );
            },
        },
        {
            title: (
                <Tooltip title="只有满足全部阈值才提示波动；样本不足或历史不可比时不能判断。">
                    <span tabIndex={0} className="admin-traffic-ops-definition">
                        规则判断
                    </span>
                </Tooltip>
            ),
            key: "status",
            align: "center",
            width: 192,
            render: (_, row) => (
                <span className="admin-traffic-ops-badge" data-tone={comparable && (row.status === "increase" || row.status === "decrease") ? "warning" : undefined}>
                    {comparable ? statusLabels[row.status] : historyNote}
                </span>
            ),
        },
    ];

    return (
        <div className="admin-traffic-ops admin-traffic-ops-grid" aria-label="访客结构与异常波动" aria-busy={loading}>
            <section className="admin-traffic-ops-panel" aria-labelledby="admin-traffic-visitor-mix-title">
                <header className="admin-traffic-ops-heading">
                    <div>
                        <span className="admin-traffic-ops-icon">
                            <Users className="size-4" aria-hidden="true" />
                        </span>
                        <h2 id="admin-traffic-visitor-mix-title">访客结构</h2>
                    </div>
                    {data && partial ? (
                        <span className="admin-traffic-ops-badge" data-tone="warning">
                            时段进行中
                        </span>
                    ) : null}
                </header>
                <p className="admin-traffic-ops-help">运营帮助：对照首次观测与回访的数量和占比，判断应优先改善拉新入口，还是安排内容更新与召回。</p>
                <p className="admin-traffic-ops-note">按有 PV 的匿名浏览器标识估算，非准确人数；首次观测不等于首次使用。</p>
                {!mix ? (
                    <p className="admin-traffic-ops-note" role="status">
                        {loading ? "正在读取访客结构…" : unavailableValue}
                    </p>
                ) : (
                    <>
                        <p className="admin-traffic-ops-note">
                            范围内 PV 访客：<strong>{count.format(mix.visitors)}</strong>
                        </p>
                        {mix.status === "no_lookback" ? (
                            <p className="admin-traffic-ops-notice" role="status">
                                无前置回看窗口，无法划分首次观测与回访；不视为 100% 新访客。
                            </p>
                        ) : mix.visitors === 0 ? (
                            <AdminEmpty title="当前范围暂无 PV 访客" description="读取成功，但没有可用于访客结构分析的页面浏览。" />
                        ) : (
                            <>
                                <dl className="admin-traffic-ops-mix">
                                    <div>
                                        <dt>首次观测访客</dt>
                                        <dd>
                                            <strong>{mix.firstObservedVisitors === null ? "不可用" : count.format(mix.firstObservedVisitors)}</strong>
                                            <small>{percent(mix.firstObservedRate)}</small>
                                        </dd>
                                    </div>
                                    <div>
                                        <dt>回访访客</dt>
                                        <dd>
                                            <strong>{mix.returningVisitors === null ? "不可用" : count.format(mix.returningVisitors)}</strong>
                                            <small>{percent(mix.returningRate)}</small>
                                        </dd>
                                    </div>
                                </dl>
                                {mix.firstObservedRate !== null && mix.returningRate !== null ? (
                                    <div className="admin-traffic-ops-mix-track" aria-hidden="true">
                                        <span style={{ width: `${mix.firstObservedRate * 100}%` }} />
                                        <span style={{ width: `${mix.returningRate * 100}%` }} />
                                    </div>
                                ) : null}
                            </>
                        )}
                    </>
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
                        <li>范围开始前、仍在保留窗口内已有 PV 的匿名标识记为回访；其他记为首次观测。没有前置回看窗口时，两类数量与占比均不可判断。</li>
                        {mix?.status === "ready" ? (
                            <li>
                                前置回看区间（上海时间）：{trafficEventTime(mix.lookbackFrom)} 至 {trafficEventTime(mix.lookbackTo)}，不含结束时刻；只代表仍保留的历史。
                            </li>
                        ) : null}
                        <li>清理浏览器缓存、多设备使用及历史保留期限都会改变分组，不能据此认定真实新增人数或长期留存率。</li>
                        <li>首次观测减少时先核对活动入口与落地承接；回访减少时核对内容更新和召回节奏。先比较两类数量，再看占比，避免把另一类减少造成的占比上升当作增长。</li>
                    </ul>
                </details>
            </section>

            <section className="admin-traffic-ops-panel" aria-labelledby="admin-traffic-anomalies-title">
                <header className="admin-traffic-ops-heading">
                    <div>
                        <span className="admin-traffic-ops-icon" data-accent="amber">
                            <Activity className="size-4" aria-hidden="true" />
                        </span>
                        <h2 id="admin-traffic-anomalies-title">异常波动提示</h2>
                    </div>
                    {data && partial ? (
                        <span className="admin-traffic-ops-badge" data-tone="warning">
                            时段进行中
                        </span>
                    ) : null}
                </header>
                <p className="admin-traffic-ops-help">运营帮助：用四项指标的等时段变化定位优先核对的环节，再结合活动、入口和功能发布逐项排查。</p>
                <p className="admin-traffic-ops-note">规则：上期 ≥ 30、绝对变化 ≥ 10 且相对幅度 ≥ 30% 同时满足；变化不能推断原因，未触发不等于无故障。</p>
                {anomalies && !comparable ? (
                    <p className="admin-traffic-ops-notice" role="status">
                        {historyNote}；不标为正常。
                    </p>
                ) : null}
                {data && partial ? <p className="admin-traffic-ops-note">当前时段尚未结束，按已过去时长与上期比较，数值仍会变化。</p> : null}
                <AdminDataTable<AnomalyMetric>
                    skeletonColumns={5}
                    table={{ rowKey: "key", size: "small", loading, columns, dataSource: anomalies?.metrics ?? [], pagination: false, tableLayout: "fixed", scroll: { x: 652 } }}
                    empty={<AdminEmpty title={data ? "暂无可比较指标" : unavailableValue} />}
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
                        <li>固定比较 UV 访客、PV 浏览量、访问会话与关键操作。关键操作包含导航意图，不是生成提交数，更不是生成成功数。</li>
                        <li>以上期同长度时段为基线，同时满足上期值至少 30、变化数量至少 10、变化幅度至少 30% 才触发上升或下降提示；本页不新增通知或定时器。</li>
                        <li>历史不足、上期超出保留窗口、上期为 0 或样本不足均暂不可判断。“未触发当前规则”只说明本条规则未命中，不证明采集完整或业务无故障。</li>
                        <li>访客与 PV 同降时先核对活动与入口；访客平稳但操作减少时再核对功能入口及意图采集。先确认时间范围和基线，勿把相关变化直接归因为某次发布。</li>
                    </ul>
                </details>
            </section>
        </div>
    );
}
