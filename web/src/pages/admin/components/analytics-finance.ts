import type { ColumnsType } from "antd/es/table";
import type { AdminAnalytics, AnalyticsFinance } from "@/services/api/auth";

export function formatCredits(value: number | null | undefined) {
    return value == null ? "--" : new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 6 }).format(value / 1_000_000);
}

export function formatFinanceCost(finance: AnalyticsFinance | null | undefined) {
    if (!finance?.costedOrders) return "--";
    return `${formatCredits(finance.costMicrocredits)}${finance.costedOrders < finance.settledOrders ? "（部分）" : ""}`;
}

export function formatFinanceMargin(value: number | null | undefined) {
    return value == null ? "--" : `${value.toFixed(1)}%`;
}

export const analyticsFinanceColumns: ColumnsType<AdminAnalytics["models"][number]> = [
    { title: "收入（积分）", width: 130, render: (_, row) => formatCredits(row.finance?.revenueMicrocredits) },
    { title: "成本（积分）", width: 150, render: (_, row) => formatFinanceCost(row.finance) },
    { title: "利润（积分）", width: 130, render: (_, row) => formatCredits(row.finance?.profitMicrocredits) },
    { title: "利润率", width: 100, render: (_, row) => formatFinanceMargin(row.finance?.profitMargin) },
];
