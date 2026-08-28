import { useCallback, useEffect, useRef, useState } from "react";
import { App, Button, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Activity, RefreshCw, Server } from "lucide-react";

import { getAdminSystemInstances, type SystemInstance } from "@/services/api/admin-system";

function formatPercent(value: number) {
    return `${Math.max(0, Math.min(100, value)).toFixed(1)}%`;
}

function formatGb(used: number, total: number) {
    return `${used.toFixed(2)} / ${total.toFixed(2)} GB`;
}

function Metric({ value }: { value: number }) {
    return <span className="tabular-nums text-foreground/75">{formatPercent(value)}</span>;
}

export default function SystemInfoPanel() {
    const { message } = App.useApp();
    const [instances, setInstances] = useState<SystemInstance[]>([]);
    const [loading, setLoading] = useState(true);
    const [intervalSeconds, setIntervalSeconds] = useState(30);
    const requestVersion = useRef(0);

    const refresh = useCallback(async () => {
        const version = ++requestVersion.current;
        try {
            const result = await getAdminSystemInstances();
            if (version !== requestVersion.current) return;
            setInstances(result.instances || []);
            setIntervalSeconds(result.intervalSeconds || 30);
        } catch (error) {
            if (version !== requestVersion.current) return;
            message.error(error instanceof Error ? error.message : "读取系统信息失败");
        } finally {
            if (version === requestVersion.current) setLoading(false);
        }
    }, [message]);

    useEffect(() => {
        void refresh();
        const timer = window.setInterval(() => void refresh(), intervalSeconds * 1000);
        return () => window.clearInterval(timer);
    }, [intervalSeconds, refresh]);

    const columns: ColumnsType<SystemInstance> = [
        {
            title: "实例",
            dataIndex: "name",
            render: (_, record) => (
                <div className="flex min-w-0 items-center gap-2">
                    <span className="grid size-8 shrink-0 place-items-center rounded-md bg-foreground/[.06] text-foreground/65">
                        <Server className="size-4" />
                    </span>
                    <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{record.name}</div>
                        <div className="truncate text-xs text-foreground/45">{record.ip || record.id}</div>
                    </div>
                </div>
            ),
        },
        { title: "状态", dataIndex: "status", render: (_, record) => <span className={record.online ? "text-emerald-600" : "text-foreground/45"}>{record.online ? "在线" : "离线"}</span> },
        { title: "角色", dataIndex: "role", width: 100, render: (value: string) => <Tag color="blue">{value === "master" ? "主节点" : value}</Tag> },
        { title: "CPU", dataIndex: "cpuPercent", width: 100, render: (value: number) => <Metric value={value} /> },
        {
            title: "内存",
            dataIndex: "memoryPercent",
            width: 190,
            render: (value: number, record) => (
                <span>
                    <Metric value={value} /> <span className="ml-1 text-xs text-foreground/45">{formatGb(record.memoryUsedGb, record.memoryTotalGb)}</span>
                </span>
            ),
        },
        {
            title: "磁盘",
            dataIndex: "diskPercent",
            width: 190,
            render: (value: number, record) => (
                <span>
                    <Metric value={value} /> <span className="ml-1 text-xs text-foreground/45">{formatGb(record.diskUsedGb, record.diskTotalGb)}</span>
                </span>
            ),
        },
        { title: "版本", dataIndex: "version", width: 180, ellipsis: true },
        { title: "运行环境", dataIndex: "platform", width: 230, ellipsis: true },
        { title: "最后上报", dataIndex: "reportedAt", width: 170, render: (value: string) => <span className="text-xs tabular-nums text-foreground/55">{formatDateTime(value)}</span> },
    ];

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/40 px-4 py-3">
                <div className="flex items-center gap-3">
                    <span className="grid size-9 place-items-center rounded-md bg-foreground/[.05] text-foreground/65">
                        <Activity className="size-4" />
                    </span>
                    <div>
                        <div className="text-sm font-medium">服务器实例</div>
                        <div className="text-xs text-foreground/50">CPU、内存和磁盘指标每 {intervalSeconds} 秒自动刷新。</div>
                    </div>
                </div>
                <Button icon={<RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />} loading={loading} onClick={() => void refresh()}>
                    刷新
                </Button>
            </div>
            <Table<SystemInstance>
                rowKey="id"
                size="middle"
                loading={loading && instances.length === 0}
                pagination={false}
                dataSource={instances}
                columns={columns}
                scroll={{ x: 1250 }}
                locale={{ emptyText: loading ? "正在读取节点指标..." : "暂无实例数据" }}
            />
        </div>
    );
}

function formatDateTime(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "--" : date.toLocaleString("zh-CN", { hour12: false }).replaceAll("/", "-");
}
