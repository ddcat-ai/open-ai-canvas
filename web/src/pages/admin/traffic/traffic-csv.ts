import Papa from "papaparse";

import { siteTrafficActionLabels, siteTrafficPageLabels } from "@/lib/site-traffic";
import type { SiteTrafficOverview } from "@/services/api/site-traffic";

export type TrafficCsvKind = "daily" | "pages" | "actions";
type CsvValue = string | number | boolean | null;

const metadataFields = ["rangeFrom", "rangeTo", "timeZone", "asOf", "effectiveFrom", "effectiveTo", "availableFrom", "retentionDays", "scope", "sourceFilter", "coverageNote"];
const fields: Record<TrafficCsvKind, string[]> = {
    daily: ["recordStatus", "date", "partial", "historyStatus", "pageViews", "visitors", "visits", "actions"],
    pages: ["recordStatus", "page", "pageLabel", "pageViews", "visitors", "pageVisits", "measurement", "engagementVisits", "engagedVisits", "engagementRate", "engagementStatus"],
    actions: ["recordStatus", "action", "actionLabel", "page", "pageLabel", "count", "visitors"],
};

// Papa 负责引号/逗号/换行转义；另覆盖前导空白、控制字符后的公式与 Tab/CR/LF 起始单元格。
const formulaPrefix = /^(?:[\s\x00-\x1f\x7f-\x9f]*[=+\-@]|[\t\r\n])/;
const knownPage = (page: string) => Object.hasOwn(siteTrafficPageLabels, page);
const knownAction = (action: string) => Object.hasOwn(siteTrafficActionLabels, action);

export function createTrafficCsv(snapshot: SiteTrafficOverview, kind: TrafficCsvKind, sourcePage = "all"): string {
    const source = sourcePage === "all" ? "全部来源页面" : Object.values(siteTrafficPageLabels).find((label) => label === sourcePage);
    if (kind === "actions" && !source) throw new TypeError("功能排行来源筛选无效");
    const metadata: CsvValue[] = [
        snapshot.range.from,
        snapshot.range.to,
        snapshot.range.timeZone,
        snapshot.asOf,
        snapshot.effectiveFrom,
        snapshot.effectiveTo,
        snapshot.availableFrom,
        snapshot.retentionDays,
        kind === "actions" ? "应用日期与当前来源筛选" : "仅应用日期范围",
        kind === "actions" ? source! : "不适用",
        "登记13类页面，当前实际路由覆盖11类；灵感嵌于创作，无独立灵感PV起点；电商流水线暂无独立路由；/与/create均计创作；登记7项操作，画布独立Agent提交当前无采集，入口与自动跳转不计该提交；直接创作不补完整漏斗链；停采页面及旧工具箱汇总不参与统计，历史记录保留且不拆分；retained不保证完整采集；unknown/partial不代表零；availableFrom不是启用时间",
    ];
    let rows: CsvValue[][];
    if (kind === "daily") {
        const coverage = new Map(snapshot.insights.featureTrend.map((point) => [point.date, point]));
        // 全部日点来自成功 overview，不读取分页、独立 today 或重新请求。
        rows = snapshot.trend.map((point) => ["record", point.date, coverage.get(point.date)?.partial ?? null, coverage.get(point.date)?.historyStatus ?? "unknown", point.pageViews, point.visitors, point.visits, point.actions]);
    } else if (kind === "pages") {
        const pages = new Map(snapshot.pages.map((page) => [page.page, page]));
        const engagements = new Map(snapshot.insights.pageEngagement.map((page) => [page.page, page]));
        rows = [...new Set([...pages.keys(), ...engagements.keys()])]
            .map((key) => {
                if (!knownPage(key)) throw new TypeError("页面排行字段无效");
                const page = pages.get(key);
                const engagement = engagements.get(key);
                const status = !engagement ? "pending" : engagement.measurement === "unsupported" ? "unsupported" : engagement.visits === 0 ? "no_pv_visits" : engagement.measurement;
                return [
                    "record",
                    key,
                    siteTrafficPageLabels[key],
                    page?.pageViews ?? null,
                    page?.visitors ?? null,
                    page?.visits ?? null,
                    engagement?.measurement ?? null,
                    engagement?.visits ?? null,
                    engagement?.engagedVisits ?? null,
                    engagement?.rate ?? null,
                    status,
                ];
            })
            .sort((a, b) => Number(b[3] ?? -1) - Number(a[3] ?? -1));
    } else {
        rows = snapshot.actions
            .filter((action) => {
                if (!knownPage(action.page) || !knownAction(action.action)) throw new TypeError("功能排行字段无效");
                return sourcePage === "all" || siteTrafficPageLabels[action.page] === source;
            })
            .sort((a, b) => b.count - a.count)
            .map((action) => ["record", action.action, siteTrafficActionLabels[action.action], action.page, siteTrafficPageLabels[action.page], action.count, action.visitors]);
    }
    // 空结果也保留范围和截止元数据；空单元格不假造为真实零记录。
    if (!rows.length) rows = [["empty", ...Array<CsvValue>(fields[kind].length - 1).fill(null)]];
    return (
        "\uFEFF" +
        Papa.unparse(
            { fields: [...metadataFields, ...fields[kind]], data: rows.map((row) => [...metadata, ...row]) },
            {
                header: true,
                newline: "\r\n",
                escapeFormulae: formulaPrefix,
            },
        )
    );
}

export function trafficCsvFileName(snapshot: SiteTrafficOverview, kind: TrafficCsvKind): string {
    return `traffic-${kind}-${snapshot.range.from}-${snapshot.range.to}-${snapshot.asOf.replace(/[:.]/g, "-")}.csv`;
}
