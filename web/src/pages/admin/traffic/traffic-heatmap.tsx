import { CalendarDays } from "lucide-react";
import { Fragment, useId, useState } from "react";

import type { SiteTrafficHeatmapCell } from "@/services/api/site-traffic";
import { AdminEmpty } from "../components/admin-ui";

const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const count = new Intl.NumberFormat("zh-CN");
const historyLabels = { retained: "保留范围内，不保证完整采集", partial: "历史不足，仅含部分保留时段", unknown: "历史覆盖未知", outside_range: "所选范围没有此时段" };

function describeCell(cell: SiteTrafficHeatmapCell) {
    return `${weekdays[cell.weekday - 1]} ${String(cell.hour).padStart(2, "0")}:00–${String(cell.hour + 1).padStart(2, "0")}:00 · ${cell.pageViews === null ? "PV 不可用，不视作 0" : `累计 ${count.format(cell.pageViews)} PV，非小时平均值`} · 时段出现 ${cell.hours} 次，完整小时 ${cell.completedHours} 次${cell.partial ? "，含进行中小时" : ""} · ${historyLabels[cell.historyStatus]}`;
}

export function TrafficHeatmap({ cells, emptyTitle, updating }: { cells?: SiteTrafficHeatmapCell[]; emptyTitle: string; updating: boolean }) {
    const tooltipId = useId();
    const [activeKey, setActiveKey] = useState<string | null>(null);
    const active = cells?.find((cell) => `${cell.weekday}-${cell.hour}` === activeKey);
    const max = (cells ?? []).reduce((value, cell) => Math.max(value, cell.pageViews ?? 0), 0);
    return (
        <section className="admin-traffic-heatmap" aria-labelledby="admin-traffic-heatmap-title">
            <div className="admin-traffic-heading">
                <div className="admin-traffic-heading-main">
                    <span className="admin-traffic-section-icon" data-accent="cyan">
                        <CalendarDays className="size-4" aria-hidden="true" />
                    </span>
                    <div>
                        <div className="admin-traffic-title-row">
                            <h2 id="admin-traffic-heatmap-title">访问时段热力图</h2>
                            {updating ? (
                                <span className="admin-traffic-section-pill" role="status">
                                    更新中…
                                </span>
                            ) : null}
                        </div>
                        <p>所选范围 · 上海时间 · 周一至周日 × 24 小时的累计 PV，非小时平均值；未知和无窗口不补零。</p>
                    </div>
                </div>
                <div className="admin-traffic-heatmap-legend" aria-label="热力图图例">
                    <span>低</span>
                    {[0, 1, 2, 3, 4].map((level) => (
                        <i key={level} data-level={level} aria-hidden="true" />
                    ))}
                    <span>高</span>
                    <span>？历史未知</span>
                    <span>— 无窗口</span>
                </div>
            </div>
            {cells ? (
                <>
                    <div className="admin-traffic-heatmap-scroll" role="region" aria-label="访问时段网格，可横向滚动" tabIndex={0}>
                        <div className="admin-traffic-heatmap-grid">
                            <span aria-hidden="true" />
                            {Array.from({ length: 24 }, (_, hour) => (
                                <span className="admin-traffic-heatmap-axis" key={hour}>
                                    {String(hour).padStart(2, "0")}
                                </span>
                            ))}
                            {weekdays.map((day, index) => (
                                <Fragment key={day}>
                                    <span className="admin-traffic-heatmap-axis">{day}</span>
                                    {cells
                                        .filter((cell) => cell.weekday === index + 1)
                                        .map((cell) => {
                                            const key = `${cell.weekday}-${cell.hour}`;
                                            const level = cell.pageViews === null || cell.pageViews === 0 ? 0 : Math.max(1, Math.ceil((cell.pageViews / max) * 4));
                                            return (
                                                <button
                                                    key={key}
                                                    type="button"
                                                    className="admin-traffic-heatmap-cell"
                                                    data-level={level}
                                                    data-history={cell.historyStatus}
                                                    data-unknown={cell.pageViews === null}
                                                    data-partial={cell.partial}
                                                    aria-label={describeCell(cell)}
                                                    aria-describedby={tooltipId}
                                                    title={describeCell(cell)}
                                                    onMouseEnter={() => setActiveKey(key)}
                                                    onFocus={() => setActiveKey(key)}
                                                >
                                                    {cell.historyStatus === "outside_range" ? "—" : cell.pageViews === null ? "？" : cell.pageViews === 0 ? "0" : ""}
                                                </button>
                                            );
                                        })}
                                </Fragment>
                            ))}
                        </div>
                    </div>
                    <p id={tooltipId} className="admin-traffic-heatmap-tip" role="tooltip" aria-live="polite">
                        {active ? describeCell(active) : "悬停或键盘聚焦任一时段，查看累计 PV、时段出现次数、进行中及历史覆盖；虚线表示含进行中小时。"}
                    </p>
                </>
            ) : (
                <AdminEmpty title={emptyTitle} description="仅在当前范围读取成功后展示，不用空网格冒充零访问。" />
            )}
        </section>
    );
}
