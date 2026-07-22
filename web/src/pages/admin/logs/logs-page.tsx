import { App, Button, Input, Select, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Download, Eye, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import { ListToolbar, TableSurface } from "@/components/layout/workspace-page";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { exportAdminApiLogs, listAdminApiLogs, type ApiCallLog } from "@/services/api/auth";
import { useAdminContext } from "../admin-context";
import { ApiLogDetailDrawer } from "../components/api-log-detail-drawer";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminBatchBar, AdminTableEmpty, AdminTableSkeleton } from "../components/admin-ui";

export default function LogsPage() {
    const { message } = App.useApp();
    const { references } = useAdminContext();
    const [searchParams, setSearchParams] = useSearchParams();
    const keyword = searchParams.get("filter") || "";
    const status = normalizeStatus(searchParams.get("status"));
    const page = positiveInt(searchParams.get("page"), 1);
    const pageSize = normalizePageSize(searchParams.get("pageSize"));
    const debouncedKeyword = useDebouncedValue(keyword);
    const [logs, setLogs] = useState<ApiCallLog[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [exporting, setExporting] = useState(false);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [detailLogId, setDetailLogId] = useState<string | null>(null);
    const requestSequence = useRef(0);
    const hasFilters = Boolean(keyword || status !== "all");
    const userNameById = useMemo(() => new Map(references.users.map((user) => [user.id, user.displayName || user.username])), [references.users]);

    const updateUrl = (patch: Record<string, string | number>, replace = false) => {
        const next = new URLSearchParams(searchParams);
        Object.entries(patch).forEach(([key, value]) => {
            const isDefault = (key === "filter" && value === "") || (key === "status" && value === "all") || (key === "page" && value === 1) || (key === "pageSize" && value === 20);
            if (isDefault) next.delete(key);
            else next.set(key, String(value));
        });
        setSearchParams(next, { replace });
    };

    useEffect(() => {
        const sequence = ++requestSequence.current;
        setLoading(true);
        void listAdminApiLogs({ keyword: debouncedKeyword || undefined, status: status === "all" ? undefined : status, page, limit: pageSize })
            .then((result) => {
                if (sequence !== requestSequence.current) return;
                setLogs(result.logs);
                setTotal(result.total);
                setSelectedIds([]);
                if (result.total > 0 && result.logs.length === 0 && page > 1) updateUrl({ page: 1 }, true);
            })
            .catch((error) => sequence === requestSequence.current && message.error(error instanceof Error ? error.message : "读取请求明细失败"))
            .finally(() => sequence === requestSequence.current && setLoading(false));
    }, [debouncedKeyword, status, page, pageSize]);

    const exportLogs = async (ids?: string[]) => {
        setExporting(true);
        try {
            const blob = await exportAdminApiLogs({ keyword: ids?.length ? undefined : debouncedKeyword || undefined, status: ids?.length ? undefined : status === "all" ? undefined : status, ids });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = ids?.length ? `请求明细-已选${ids.length}条.csv` : `请求明细-${new Date().toISOString().slice(0, 10)}.csv`;
            link.click();
            URL.revokeObjectURL(url);
            message.success(ids?.length ? `已导出选中的 ${ids.length} 条请求明细` : "已按当前筛选导出请求明细");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "导出请求明细失败");
        } finally {
            setExporting(false);
        }
    };

    const columns: ColumnsType<ApiCallLog> = [
        { title: "时间", dataIndex: "createdAt", width: 170, render: formatTime },
        { title: "用户", dataIndex: "userId", width: 160, render: (id) => userNameById.get(id) || id },
        { title: "渠道", dataIndex: "channelName", width: 170, render: (name, log) => name || log.channelId || <span className="text-foreground/40">未记录</span> },
        { title: "模型", dataIndex: "model", width: 180, render: (model) => model || <span className="text-foreground/40">未识别</span> },
        { title: "能力 / 阶段", width: 125, render: (_, log) => `${capabilityText(log.capability)} / ${requestKindText(log.requestKind)}` },
        { title: "状态", dataIndex: "status", width: 110, render: (value, log) => <Tag bordered={false} color={value === "succeeded" ? "success" : "error"}>{value === "succeeded" ? "成功" : `失败 ${log.statusCode || ""}`}</Tag> },
        { title: "错误码", dataIndex: "errorCode", width: 160, ellipsis: true, render: (value) => value || "--" },
        { title: "耗时", dataIndex: "durationMs", width: 100, render: (value) => `${value}ms` },
        { title: "Token", width: 145, render: (_, log) => log.usageAvailable ? `${log.inputTokens} / ${log.outputTokens}` : "--" },
        { title: "费用", width: 110, render: (_, log) => log.costAvailable ? `${log.currency || "USD"} ${(log.estimatedCostMicros / 1_000_000).toFixed(6)}` : "--" },
        { title: "操作", width: 90, fixed: "right", render: (_, log) => <Button size="small" icon={<Eye className="size-3.5" />} onClick={() => setDetailLogId(log.id)}>详情</Button> },
    ];

    return (
        <AdminPageFrame title="请求明细" description="上游调用与费用" actions={<Button icon={<Download className="size-4" />} loading={exporting} onClick={() => void exportLogs()}>导出当前筛选</Button>}>
            <ListToolbar active={hasFilters} onReset={() => updateUrl({ filter: "", status: "all", page: 1 })}>
                <Input allowClear className="w-full sm:w-80" prefix={<Search className="size-4 text-foreground/40" />} value={keyword} placeholder="搜索用户、渠道、模型、路径或请求号" onChange={(event) => updateUrl({ filter: event.target.value, page: 1 }, true)} />
                <Select className="w-32" value={status} onChange={(value) => updateUrl({ status: value, page: 1 })} options={[{ label: "全部结果", value: "all" }, { label: "成功", value: "succeeded" }, { label: "失败", value: "failed" }]} />
            </ListToolbar>
            <AdminBatchBar count={selectedIds.length} onClear={() => setSelectedIds([])}><Button type="primary" size="small" icon={<Download className="size-3.5" />} loading={exporting} onClick={() => void exportLogs(selectedIds)}>导出已选</Button></AdminBatchBar>
            <TableSurface>
                {loading && logs.length === 0 ? <AdminTableSkeleton rows={8} columns={11} /> : <Table className="app-data-table" size="middle" rowKey="id" loading={loading} rowSelection={{ selectedRowKeys: selectedIds, preserveSelectedRowKeys: false, onChange: (keys) => setSelectedIds(keys.map(String)) }} columns={columns} dataSource={logs} locale={{ emptyText: <AdminTableEmpty filtered={hasFilters} /> }} pagination={{ current: page, pageSize, total, showSizeChanger: true, pageSizeOptions: [20, 50, 100], showTotal: (value, range) => `${range[0]}-${range[1]} / 共 ${value} 条`, onChange: (nextPage, nextSize) => updateUrl({ page: nextSize !== pageSize ? 1 : nextPage, pageSize: nextSize }) }} scroll={{ x: 1280 }} />}
            </TableSurface>
            <ApiLogDetailDrawer logId={detailLogId} onClose={() => setDetailLogId(null)} />
        </AdminPageFrame>
    );
}

function positiveInt(value: string | null, fallback: number) { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback; }
function normalizePageSize(value: string | null) { const parsed = positiveInt(value, 20); return [20, 50, 100].includes(parsed) ? parsed : 20; }
function normalizeStatus(value: string | null): "all" | "succeeded" | "failed" { return value === "succeeded" || value === "failed" ? value : "all"; }
function formatTime(value?: string) { return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "--"; }
function capabilityText(value: string) { return ({ text: "文本", image: "图片", video: "视频", audio: "音频" } as Record<string, string>)[value] || "未知"; }
function requestKindText(value: string) { return ({ create: "创建", poll: "轮询", download: "下载", repair: "修复" } as Record<string, string>)[value] || "请求"; }
