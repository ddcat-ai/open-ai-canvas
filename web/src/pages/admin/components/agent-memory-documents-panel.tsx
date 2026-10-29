import { App, Button, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Select } from "@/components/ui/base/select";
import { listAdminAgentMemoryDocuments, type AdminAgentMemoryDocument } from "@/services/api/admin-agent-lessons";
import { AGENT_MEMORY_MODES, AGENT_MEMORY_SECTIONS } from "@/services/api/agent-memory";
import { AdminDataTable, AdminStatusBadge, AdminTableEmpty } from "./admin-ui";
import { useAdminUserOptions } from "./use-admin-user-options";

function ownerLabel(record: AdminAgentMemoryDocument) {
    if (record.displayName && record.username) return `${record.displayName}（${record.username}）`;
    return record.displayName || record.username || record.userId;
}

function sourceLabel(source?: string) {
    if (source === "agent") return "Agent";
    if (source === "lesson_import") return "旧版导入";
    return "用户";
}

function DocumentEntries({ record }: { record: AdminAgentMemoryDocument }) {
    if (!record.entries.length) return <p className="py-2 text-xs text-muted-foreground">记忆文件为空。</p>;
    return (
        <div className="grid gap-4 py-2 md:grid-cols-2">
            {AGENT_MEMORY_SECTIONS.map((section) => {
                const entries = record.entries.filter((entry) => entry.section === section.key);
                return (
                    <section key={section.key} aria-label={section.label} className="min-w-0">
                        <h4 className="mb-2 text-xs font-semibold">
                            {section.label}
                            <span className="ml-2 font-normal text-muted-foreground">{entries.length} 条</span>
                        </h4>
                        {entries.length ? (
                            <ul className="space-y-1.5 text-xs leading-5">
                                {entries.map((entry) => (
                                    <li key={entry.id} className="flex min-w-0 gap-2">
                                        <span className="shrink-0 text-muted-foreground">{sourceLabel(entry.source)}</span>
                                        <span className="min-w-0 [overflow-wrap:anywhere]">{entry.text}</span>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="text-xs text-muted-foreground">暂无</p>
                        )}
                    </section>
                );
            })}
        </div>
    );
}

/** 管理员只读查看用户的长期记忆文件；修改、撤销和确认都只能由用户本人完成。 */
export default function AgentMemoryDocumentsPanel() {
    const { message } = App.useApp();
    const [items, setItems] = useState<AdminAgentMemoryDocument[]>([]);
    const [loading, setLoading] = useState(true);
    const [userId, setUserId] = useState<string | undefined>();
    const userOptions = useAdminUserOptions(userId);
    const seqRef = useRef(0);

    const load = useCallback(async () => {
        const seq = ++seqRef.current;
        setLoading(true);
        try {
            const data = await listAdminAgentMemoryDocuments({ userId, limit: 200 });
            if (seq !== seqRef.current) return;
            setItems(data.documents || []);
        } catch (error) {
            if (seq === seqRef.current) message.error(error instanceof Error ? error.message : "读取记忆文件失败");
        } finally {
            if (seq === seqRef.current) setLoading(false);
        }
    }, [message, userId]);

    useEffect(() => {
        void load();
    }, [load]);

    const columns: ColumnsType<AdminAgentMemoryDocument> = [
        {
            title: "用户",
            key: "owner",
            render: (_, record) => (
                <div className="flex flex-col gap-0.5">
                    <span className="font-medium">{ownerLabel(record)}</span>
                    <span className="text-[var(--fs-label)] opacity-60">{record.userId}</span>
                </div>
            ),
        },
        {
            title: "模式",
            dataIndex: "mode",
            width: 104,
            render: (value: string) => <Tag>{AGENT_MEMORY_MODES.find((mode) => mode.value === value)?.label || value}</Tag>,
        },
        {
            title: "用量",
            key: "usage",
            width: 128,
            render: (_, record) => (
                <span className="tabular-nums opacity-80">
                    {record.charCount.toLocaleString()} / {record.capacity.toLocaleString()} 字
                </span>
            ),
        },
        {
            title: "条目",
            key: "entries",
            width: 72,
            render: (_, record) => <span className="tabular-nums opacity-80">{record.entries.length}</span>,
        },
        {
            title: "待确认",
            dataIndex: "pendingCount",
            width: 88,
            render: (value: number) => (value ? <AdminStatusBadge label={`${value} 条`} tone="warning" /> : <span className="opacity-50">—</span>),
        },
        {
            title: "更新时间",
            dataIndex: "updatedAt",
            width: 176,
            render: (value: string) => <span className="tabular-nums opacity-80">{value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "--"}</span>,
        },
    ];

    return (
        <div className="flex flex-col gap-3">
            <p className="text-xs text-foreground/60">每个用户一份记忆文件，由该用户的 Agent 在对话中维护，用户可随时编辑和撤销。这里只读，展开行查看正文。</p>
            <AdminDataTable
                toolbar={
                    <div className="flex flex-wrap items-center gap-2">
                        <Select
                            allowClear
                            showSearch
                            filterOption={false}
                            loading={userOptions.searching}
                            placeholder="筛选用户"
                            className="w-[220px]"
                            value={userId}
                            onSearch={userOptions.onSearch}
                            onChange={(value) => setUserId(value)}
                            options={userOptions.options}
                        />
                        <Button icon={<RefreshCw className="size-4" />} onClick={() => void load()}>
                            刷新
                        </Button>
                        <span className="text-xs opacity-60">
                            共 {items.length} 份{userId ? "" : "（按最近更新，最多 200 份）"}
                        </span>
                    </div>
                }
                table={{
                    rowKey: "userId",
                    size: "small",
                    loading,
                    columns,
                    dataSource: items,
                    expandable: { expandedRowRender: (record) => <DocumentEntries record={record} />, rowExpandable: () => true },
                    pagination: { defaultPageSize: 20, showSizeChanger: true },
                }}
                empty={<AdminTableEmpty title="还没有记忆文件" description="用户第一次打开记忆设置或 Agent 第一次运行后才会创建。" />}
            />
        </div>
    );
}
