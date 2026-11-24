import { siteTrafficActionLabels, siteTrafficPageLabels, type SiteTrafficAction, type SiteTrafficPage } from "@/lib/site-traffic";
import { http } from "@/services/api/request";

export type { SiteTrafficAction, SiteTrafficPage } from "@/lib/site-traffic";

export type SiteTrafficEvent = {
    id: string;
    visitorId: string;
    sessionId: string;
    page: SiteTrafficPage;
} & ({ type: "page_view" } | { type: "action"; action: SiteTrafficAction });

export type SiteTrafficQuery = { from: string; to: string };
export type SiteTrafficCounts = { visitors: number; pageViews: number; visits: number; actions: number };
export type SiteTrafficHistoryStatus = "retained" | "partial" | "unknown";
export type SiteTrafficFeaturePoint = {
    date: string;
    partial: boolean;
    historyStatus: SiteTrafficHistoryStatus;
    counts: Record<SiteTrafficAction, number> | null;
};
export type SiteTrafficHeatmapCell = {
    weekday: number;
    hour: number;
    pageViews: number | null;
    hours: number;
    completedHours: number;
    partial: boolean;
    historyStatus: SiteTrafficHistoryStatus | "outside_range";
};
export type SiteTrafficPageEngagement = {
    page: SiteTrafficPage;
    measurement: "supported" | "unsupported" | "mixed";
    visits: number;
    engagedVisits: number | null;
    rate: number | null;
};
export type SiteTrafficDepth = {
    visits: number;
    buckets: Array<{ key: "1" | "2-3" | "4+"; visits: number; rate: number | null }>;
};
export type SiteTrafficEndpoint = {
    undeterminedVisits: number;
    pages: Array<{ page: SiteTrafficPage; visits: number; rate: number | null }>;
};
export type SiteTrafficOperations = {
    visitorMix: {
        status: "ready" | "no_lookback";
        visitors: number;
        firstObservedVisitors: number | null;
        returningVisitors: number | null;
        firstObservedRate: number | null;
        returningRate: number | null;
        lookbackFrom: string;
        lookbackTo: string;
    };
    endpoints: { visits: number; first: SiteTrafficEndpoint; last: SiteTrafficEndpoint };
    paths: {
        visits: number;
        ambiguousVisits: number;
        rows: Array<{ from: SiteTrafficPage; to: SiteTrafficPage; visits: number; rate: number | null }>;
    };
    funnel: {
        steps: Array<{
            key: "inspirations" | "open_create" | "create" | "submit";
            visits: number;
            possibleVisits: number;
            uncertainVisits: number;
            rate: number | null;
            previousRate: number | null;
        }>;
    };
    anomalies: {
        status: "ready" | "outside_retention" | "insufficient_history";
        rules: { minimumBaseline: 30; minimumAbsoluteChange: 10; relativeThreshold: 0.3 };
        metrics: Array<{
            key: "visitors" | "pageViews" | "visits" | "actions";
            current: number;
            previous: number | null;
            relativeChange: number | null;
            status: "increase" | "decrease" | "stable" | "insufficient_sample" | "zero_baseline" | "unavailable";
        }>;
    };
};
export type SiteTrafficInsights = {
    heatmap: SiteTrafficHeatmapCell[];
    featureTrend: SiteTrafficFeaturePoint[];
    pageEngagement: SiteTrafficPageEngagement[];
    depth: SiteTrafficDepth;
    operations: SiteTrafficOperations;
};
export type SiteTrafficOverview = {
    range: { from: string; to: string; timeZone: "Asia/Shanghai" };
    retentionDays: 365;
    availableFrom: string | null;
    asOf: string;
    effectiveFrom: string;
    effectiveTo: string;
    engagement: { visits: number; engagedVisits: number; rate: number | null };
    comparison: {
        range: { from: string; to: string; timeZone: "Asia/Shanghai" };
        effectiveFrom: string;
        effectiveTo: string;
    } & ({ status: "ready"; kpi: SiteTrafficCounts } | { status: "outside_retention" | "insufficient_history"; kpi: null });
    kpi: SiteTrafficCounts;
    trend: Array<SiteTrafficCounts & { date: string }>;
    pages: Array<{ page: SiteTrafficPage; pageViews: number; visitors: number; visits: number }>;
    actions: Array<{ action: SiteTrafficAction; page: SiteTrafficPage; count: number; visitors: number }>;
    insights: SiteTrafficInsights;
};
export type SiteTrafficToday = {
    date: string;
    timeZone: "Asia/Shanghai";
    asOf: string;
    active: { visitors: number; windowFrom: string; windowTo: string };
    hours: Array<SiteTrafficCounts & { hour: number; partial: boolean }>;
};
export type SiteTrafficCollectResult = { accepted: number };
export type SiteTrafficRequestOptions = { signal?: AbortSignal };

export async function collectSiteTraffic(events: readonly SiteTrafficEvent[], options: SiteTrafficRequestOptions = {}) {
    // 显式投影白名单字段，调用方附带的路径、提示词或任意 props 都不能进入报文。
    const payload = events.map((event) => {
        if (!Object.hasOwn(siteTrafficPageLabels, event.page) || (event.type !== "page_view" && event.type !== "action") || (event.type === "action" && !Object.hasOwn(siteTrafficActionLabels, event.action))) {
            throw new TypeError("访问统计事件类型无效");
        }
        return {
            id: event.id,
            visitorId: event.visitorId,
            sessionId: event.sessionId,
            type: event.type,
            page: event.page,
            ...(event.type === "action" ? { action: event.action } : {}),
        };
    });
    // XHR 会默认携带当前页 Referer；仅本采集请求用统一 http 的 fetch adapter 去掉路径和分享 token。
    const result = await http.post<SiteTrafficCollectResult>("/traffic/events", { events: payload }, { signal: options.signal, timeout: 8000, adapter: "fetch", fetchOptions: { referrerPolicy: "no-referrer" } });
    if (!result || !isCount(result.accepted) || result.accepted > events.length) throw new TypeError("访问统计采集响应无效");
    return result;
}

function isCount(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isDay(value: unknown): value is string {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const timestamp = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function isTimestamp(value: unknown): value is string {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) && isDay(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
}

function isCounts(value: SiteTrafficCounts | null | undefined) {
    return value != null && isCount(value.visitors) && isCount(value.pageViews) && isCount(value.visits) && isCount(value.actions);
}

function isInterval(from: unknown, to: unknown, asOf: string) {
    return isTimestamp(from) && isTimestamp(to) && Date.parse(from) <= Date.parse(to) && Date.parse(to) <= Date.parse(asOf);
}

function isEngagement(value: SiteTrafficOverview["engagement"] | null | undefined) {
    if (!value || !isCount(value.visits) || !isCount(value.engagedVisits) || value.engagedVisits > value.visits) return false;
    return value.visits === 0 ? value.rate === null : typeof value.rate === "number" && Number.isFinite(value.rate) && value.rate >= 0 && value.rate <= 1 && Math.abs(value.rate - value.engagedVisits / value.visits) < 1e-9;
}

function isComparison(value: SiteTrafficOverview["comparison"] | null | undefined, query: SiteTrafficQuery, asOf: string) {
    if (!value || !isDay(value.range?.from) || !isDay(value.range?.to) || value.range.timeZone !== "Asia/Shanghai" || value.range.from > value.range.to || !isInterval(value.effectiveFrom, value.effectiveTo, asOf)) return false;
    const day = 86_400_000;
    const start = Date.parse(`${query.from}T00:00:00Z`);
    const end = Date.parse(`${query.to}T00:00:00Z`);
    const previousStart = Date.parse(`${value.range.from}T00:00:00Z`);
    const previousEnd = Date.parse(`${value.range.to}T00:00:00Z`);
    if (previousEnd !== start - day || previousEnd - previousStart !== end - start) return false;
    return value.status === "ready" ? isCounts(value.kpi) : (value.status === "outside_retention" || value.status === "insufficient_history") && value.kpi === null;
}

function isFraction(value: unknown, numerator: number, denominator: number) {
    return denominator === 0 ? value === null : typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 && Math.abs(value - numerator / denominator) < 1e-9;
}

function isEndpoint(value: SiteTrafficEndpoint | null | undefined, visits: number) {
    if (!value || !isCount(value.undeterminedVisits) || value.undeterminedVisits > visits || !Array.isArray(value.pages) || value.pages.length > Object.keys(siteTrafficPageLabels).length) return false;
    const pages = new Set<string>();
    let total = value.undeterminedVisits;
    if (
        !value.pages.every((row) => {
            if (!row || typeof row.page !== "string" || !Object.hasOwn(siteTrafficPageLabels, row.page) || pages.has(row.page) || !isCount(row.visits) || row.visits > visits || !isFraction(row.rate, row.visits, visits)) return false;
            pages.add(row.page);
            total += row.visits;
            return Number.isSafeInteger(total);
        })
    )
        return false;
    return total === visits;
}

function isOperations(value: SiteTrafficOperations | null | undefined, overview: SiteTrafficOverview) {
    if (!value || !value.visitorMix || !value.endpoints || !value.paths || !value.funnel || !value.anomalies) return false;
    const mix = value.visitorMix;
    const day = 86_400_000;
    const localDate = new Date(Date.parse(overview.asOf) + 28_800_000).toISOString().slice(0, 10);
    const retentionStart = Date.parse(`${localDate}T00:00:00+08:00`) - 364 * day;
    if (!isCount(mix.visitors) || !isInterval(mix.lookbackFrom, mix.lookbackTo, overview.asOf) || Date.parse(mix.lookbackFrom) !== retentionStart || Date.parse(mix.lookbackTo) !== Date.parse(overview.effectiveFrom)) return false;
    if (Date.parse(mix.lookbackFrom) === Date.parse(mix.lookbackTo)) {
        if (mix.status !== "no_lookback" || mix.firstObservedVisitors !== null || mix.returningVisitors !== null || mix.firstObservedRate !== null || mix.returningRate !== null) return false;
    } else if (
        mix.status !== "ready" ||
        !isCount(mix.firstObservedVisitors) ||
        !isCount(mix.returningVisitors) ||
        !Number.isSafeInteger(mix.firstObservedVisitors + mix.returningVisitors) ||
        mix.firstObservedVisitors + mix.returningVisitors !== mix.visitors ||
        !isFraction(mix.firstObservedRate, mix.firstObservedVisitors, mix.visitors) ||
        !isFraction(mix.returningRate, mix.returningVisitors, mix.visitors)
    )
        return false;
    if (!isCount(value.endpoints.visits) || !isEndpoint(value.endpoints.first, value.endpoints.visits) || !isEndpoint(value.endpoints.last, value.endpoints.visits)) return false;
    const paths = value.paths;
    if (!isCount(paths.visits) || !isCount(paths.ambiguousVisits) || paths.ambiguousVisits > paths.visits || !Array.isArray(paths.rows) || paths.rows.length > 10) return false;
    const pairs = new Set<string>();
    if (
        !paths.rows.every((row) => {
            if (
                !row ||
                typeof row.from !== "string" ||
                typeof row.to !== "string" ||
                row.from === row.to ||
                !Object.hasOwn(siteTrafficPageLabels, row.from) ||
                !Object.hasOwn(siteTrafficPageLabels, row.to) ||
                !isCount(row.visits) ||
                row.visits === 0 ||
                row.visits > paths.visits ||
                !isFraction(row.rate, row.visits, paths.visits)
            )
                return false;
            const key = `${row.from}:${row.to}`;
            if (pairs.has(key)) return false;
            pairs.add(key);
            return true;
        })
    )
        return false;
    const stepKeys = ["inspirations", "open_create", "create", "submit"];
    const steps = value.funnel.steps;
    if (
        !Array.isArray(steps) ||
        steps.length !== stepKeys.length ||
        !steps.every((step, index) => {
            if (!step || step.key !== stepKeys[index] || !isCount(step.visits) || !isCount(step.possibleVisits) || !isCount(step.uncertainVisits) || step.visits > step.possibleVisits || step.uncertainVisits !== step.possibleVisits - step.visits)
                return false;
            if (index === 0) return step.possibleVisits === step.visits && step.uncertainVisits === 0 && step.previousRate === null && isFraction(step.rate, step.visits, step.visits);
            const previous = steps[index - 1];
            return step.visits <= previous.visits && step.possibleVisits <= previous.possibleVisits && isFraction(step.rate, step.visits, steps[0].visits) && isFraction(step.previousRate, step.visits, previous.visits);
        })
    )
        return false;
    const anomalies = value.anomalies;
    const rules = anomalies.rules;
    const keys = ["visitors", "pageViews", "visits", "actions"] as const;
    if (anomalies.status !== overview.comparison.status || !rules || rules.minimumBaseline !== 30 || rules.minimumAbsoluteChange !== 10 || rules.relativeThreshold !== 0.3 || !Array.isArray(anomalies.metrics) || anomalies.metrics.length !== keys.length)
        return false;
    return anomalies.metrics.every((metric, index) => {
        const key = keys[index];
        if (!metric || metric.key !== key || !isCount(metric.current) || metric.current !== overview.kpi[key]) return false;
        if (overview.comparison.status !== "ready") return metric.status === "unavailable" && metric.previous === null && metric.relativeChange === null;
        const previous = overview.comparison.kpi[key];
        if (metric.previous !== previous) return false;
        if (previous === 0) return metric.status === "zero_baseline" && metric.relativeChange === null;
        const delta = metric.current - previous;
        const relative = delta / previous;
        const status = previous < 30 ? "insufficient_sample" : Math.abs(delta) >= 10 && Math.abs(relative) >= 0.3 ? (delta > 0 ? "increase" : "decrease") : "stable";
        return metric.status === status && typeof metric.relativeChange === "number" && Number.isFinite(metric.relativeChange) && Math.abs(metric.relativeChange - relative) < 1e-9;
    });
}

function isInsights(value: SiteTrafficInsights | null | undefined, overview: SiteTrafficOverview) {
    if (
        !value ||
        !Array.isArray(value.heatmap) ||
        value.heatmap.length !== 168 ||
        !Array.isArray(value.featureTrend) ||
        !Array.isArray(value.pageEngagement) ||
        value.pageEngagement.length > Object.keys(siteTrafficPageLabels).length ||
        !value.depth ||
        !isCount(value.depth.visits) ||
        !Array.isArray(value.depth.buckets) ||
        value.depth.buckets.length !== 3
    )
        return false;
    const historyStatuses = ["retained", "partial", "unknown"];
    const cells = new Set<string>();
    let partialCells = 0;
    const end = new Date(Date.parse(overview.effectiveTo) + 8 * 60 * 60 * 1000);
    const endWeekday = end.getUTCDay() || 7;
    if (
        !value.heatmap.every((cell) => {
            if (
                !cell ||
                !isCount(cell.weekday) ||
                cell.weekday < 1 ||
                cell.weekday > 7 ||
                !isCount(cell.hour) ||
                cell.hour > 23 ||
                !isCount(cell.hours) ||
                !isCount(cell.completedHours) ||
                cell.completedHours > cell.hours ||
                typeof cell.partial !== "boolean"
            )
                return false;
            const key = `${cell.weekday}:${cell.hour}`;
            if (cells.has(key)) return false;
            cells.add(key);
            if (cell.hours === 0) return cell.historyStatus === "outside_range" && cell.pageViews === null && cell.completedHours === 0 && !cell.partial;
            if (!historyStatuses.includes(cell.historyStatus) || cell.hours - cell.completedHours !== (cell.partial ? 1 : 0)) return false;
            if (cell.partial) {
                partialCells += 1;
                if (cell.weekday !== endWeekday || cell.hour !== end.getUTCHours() || Date.parse(overview.effectiveTo) % 3_600_000 === 0) return false;
            }
            return cell.historyStatus === "unknown" ? cell.pageViews === null : isCount(cell.pageViews);
        }) ||
        partialCells > 1
    )
        return false;
    const day = 86_400_000;
    const start = Date.parse(`${overview.range.from}T00:00:00Z`);
    const days = (Date.parse(`${overview.range.to}T00:00:00Z`) - start) / day + 1;
    const serverDate = new Date(Date.parse(overview.asOf) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const actionKeys = Object.keys(siteTrafficActionLabels) as SiteTrafficAction[];
    if (
        !Number.isInteger(days) ||
        days < 1 ||
        days > 365 ||
        value.featureTrend.length !== days ||
        !value.featureTrend.every((point, index) => {
            if (!point || point.date !== new Date(start + index * day).toISOString().slice(0, 10) || point.partial !== (point.date === serverDate) || !historyStatuses.includes(point.historyStatus)) return false;
            if (point.historyStatus === "unknown") return point.counts === null;
            return (
                point.counts != null &&
                typeof point.counts === "object" &&
                !Array.isArray(point.counts) &&
                Object.keys(point.counts).length === actionKeys.length &&
                actionKeys.every((action) => Object.hasOwn(point.counts!, action) && isCount(point.counts![action]))
            );
        })
    )
        return false;
    const pages = new Set<SiteTrafficPage>();
    if (
        !value.pageEngagement.every((row) => {
            if (!row || typeof row.page !== "string" || !Object.hasOwn(siteTrafficPageLabels, row.page) || pages.has(row.page) || !isCount(row.visits)) return false;
            pages.add(row.page);
            if (row.measurement === "unsupported" || row.measurement === "mixed") return row.engagedVisits === null && row.rate === null;
            return row.measurement === "supported" && isCount(row.engagedVisits) && isEngagement({ visits: row.visits, engagedVisits: row.engagedVisits, rate: row.rate });
        })
    )
        return false;
    const depthKeys = ["1", "2-3", "4+"];
    let depthVisits = 0;
    if (
        !value.depth.buckets.every((bucket, index) => {
            if (!bucket || bucket.key !== depthKeys[index] || !isCount(bucket.visits) || bucket.visits > value.depth.visits) return false;
            depthVisits += bucket.visits;
            return value.depth.visits === 0 ? bucket.rate === null : typeof bucket.rate === "number" && Number.isFinite(bucket.rate) && bucket.rate >= 0 && bucket.rate <= 1 && Math.abs(bucket.rate - bucket.visits / value.depth.visits) < 1e-9;
        })
    )
        return false;
    // 只核本条聚合内部合计；独立 SQL 可能看到同截止时间内稍后落库的事件，不能强等另一条 KPI。
    return Number.isSafeInteger(depthVisits) && depthVisits === value.depth.visits && isOperations(value.operations, overview);
}

export async function getSiteTrafficOverview(query: SiteTrafficQuery, options: SiteTrafficRequestOptions = {}) {
    const result = await http.get<SiteTrafficOverview>("/admin/traffic/overview", { params: { from: query.from, to: query.to }, signal: options.signal });
    if (
        !result ||
        !isDay(query.from) ||
        !isDay(query.to) ||
        query.from > query.to ||
        result.range?.from !== query.from ||
        result.range?.to !== query.to ||
        result.range?.timeZone !== "Asia/Shanghai" ||
        result.retentionDays !== 365 ||
        !(result.availableFrom === null || isTimestamp(result.availableFrom)) ||
        !isCounts(result.kpi) ||
        !isTimestamp(result.asOf) ||
        !isInterval(result.effectiveFrom, result.effectiveTo, result.asOf) ||
        !isEngagement(result.engagement) ||
        !isComparison(result.comparison, query, result.asOf) ||
        !isInsights(result.insights, result) ||
        !Array.isArray(result.trend) ||
        !result.trend.every((row) => row != null && isDay(row.date) && row.date >= query.from && row.date <= query.to && isCounts(row)) ||
        !Array.isArray(result.pages) ||
        !result.pages.every((row) => row != null && typeof row.page === "string" && Object.hasOwn(siteTrafficPageLabels, row.page) && isCount(row.pageViews) && isCount(row.visitors) && isCount(row.visits)) ||
        !Array.isArray(result.actions) ||
        !result.actions.every(
            (row) => row != null && typeof row.page === "string" && Object.hasOwn(siteTrafficPageLabels, row.page) && typeof row.action === "string" && Object.hasOwn(siteTrafficActionLabels, row.action) && isCount(row.count) && isCount(row.visitors),
        )
    ) {
        throw new TypeError("访问统计概览响应无效");
    }
    return result;
}

export async function getSiteTrafficToday(options: SiteTrafficRequestOptions = {}) {
    // 今日与近期窗口只由服务器时钟决定，不携带范围或来源筛选。
    const result = await http.get<SiteTrafficToday>("/admin/traffic/today", { signal: options.signal });
    if (
        !result ||
        !isDay(result.date) ||
        result.timeZone !== "Asia/Shanghai" ||
        !isTimestamp(result.asOf) ||
        !result.active ||
        !isCount(result.active.visitors) ||
        !isInterval(result.active.windowFrom, result.active.windowTo, result.asOf) ||
        Date.parse(result.active.windowTo) !== Date.parse(result.asOf) ||
        Date.parse(result.active.windowTo) - Date.parse(result.active.windowFrom) !== 300_000 ||
        !Array.isArray(result.hours)
    )
        throw new TypeError("今日访问统计响应无效");
    const serverTime = new Date(Date.parse(result.asOf) + 8 * 60 * 60 * 1000);
    const currentHour = serverTime.getUTCHours();
    if (
        serverTime.toISOString().slice(0, 10) !== result.date ||
        result.hours.length !== currentHour + 1 ||
        !result.hours.every((row, index) => row != null && isCount(row.hour) && row.hour <= 23 && row.hour === index && row.partial === (index === currentHour) && isCounts(row))
    ) {
        throw new TypeError("今日访问统计响应无效");
    }
    return result;
}
