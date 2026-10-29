import { App, Button, Input, Space, Tag } from "antd";
import { AntTooltip as Tooltip } from "@/components/ui/base/tooltip/ant-tooltip";
import type { ColumnsType } from "antd/es/table";
import { RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { agentLessonCategoryLabel, deleteAdminAgentLesson, listAdminAgentLessons, type AdminAgentLesson } from "@/services/api/admin-agent-lessons";
import { AdminDataTable, AdminStatusBadge, AdminTableEmpty } from "./admin-ui";
import { useAdminUserOptions } from "./use-admin-user-options";
import { Select } from "@/components/ui/base/select";

function authorLabel(record: AdminAgentLesson) {
    if (record.authorDisplayName && record.authorUsername) return `${record.authorDisplayName}（${record.authorUsername}）`;
    return record.authorDisplayName || record.authorUsername || record.authorUserId || "未知用户";
}

export default function AgentLessonsPanel() {
    const { message, modal } = App.useApp();
    const [items, setItems] = useState<AdminAgentLesson[]>([]);
    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState<string>("all");
    const [keyword, setKeyword] = useState("");
    const [userId, setUserId] = useState<string | undefined>();
    const userOptions = useAdminUserOptions(userId);
    const debouncedKeyword = useDebouncedValue(keyword.trim(), 250);
    const seqRef = useRef(0);

    const load = useCallback(async () => {
        const seq = ++seqRef.current;
        setLoading(true);
        try {
            const data = await listAdminAgentLessons({
                status: status === "all" ? undefined : status,
                userId,
                keyword: debouncedKeyword || undefined,
                limit: 100,
            });
            if (seq !== seqRef.current) return;
            setItems(data.lessons || []);
        } catch (error) {
            if (seq === seqRef.current) message.error(error instanceof Error ? error.message : "读取记忆失败");
        } finally {
            if (seq === seqRef.current) setLoading(false);
        }
    }, [debouncedKeyword, message, status, userId]);

    useEffect(() => {
        void load();
    }, [load]);

    const remove = (record: AdminAgentLesson) => {
        modal.confirm({
            title: `删除「${record.topic}」`,
            content: `这是 ${authorLabel(record)} 的旧版经验记录。删除只清理历史记录，不会改动该用户的记忆文件。确认删除？`,
            okText: "删除",
            okButtonProps: { danger: true },
            onOk: async () => {
                await deleteAdminAgentLesson(record.id);
                message.success("已删除");
                await load();
            },
        });
    };

    const columns: ColumnsType<AdminAgentLesson> = [
        {
            title: "用户",
            key: "author",
            width: 168,
            render: (_, record) => (
                <div className="flex flex-col gap-0.5">
                    <span className="font-medium">{authorLabel(record)}</span>
                    {record.authorUserId ? <span className="text-[var(--fs-label)] opacity-60">{record.authorUserId}</span> : null}
                </div>
            ),
        },
        {
            title: "分类",
            dataIndex: "category",
            width: 92,
            render: (value: string) => <Tag>{agentLessonCategoryLabel(value)}</Tag>,
        },
        {
            title: "主题",
            dataIndex: "topic",
            width: 180,
            render: (value: string, record) => (
                <div className="flex flex-col gap-0.5">
                    <span className="font-medium">{value}</span>
                    {record.source ? <span className="text-[var(--fs-label)] opacity-60">来源：{record.source}</span> : null}
                </div>
            ),
        },
        {
            title: "适用场景 / 做法",
            dataIndex: "situation",
            render: (_: string, record) => {
                const steps = record.steps || [];
                return (
                    <div className="flex flex-col gap-1 text-xs">
                        <span className="opacity-80">{record.situation}</span>
                        {record.lesson ? <span>{record.lesson}</span> : null}
                        {steps.length ? (
                            <ol className="ml-4 list-decimal space-y-0.5 opacity-80">
                                {steps.map((step, index) => (
                                    <li key={`${record.id}-${index}`}>
                                        <span className="font-medium">{step.tool}</span>
                                        {" — "}
                                        {step.action}
                                        {step.note ? <span className="opacity-60">（{step.note}）</span> : null}
                                    </li>
                                ))}
                            </ol>
                        ) : null}
                    </div>
                );
            },
        },
        {
            title: "状态",
            dataIndex: "status",
            width: 96,
            render: (value: string) => <AdminStatusBadge label={value === "approved" ? "已批准" : value === "rejected" ? "已拒绝" : "待审"} tone={value === "approved" ? "success" : value === "rejected" ? "error" : "warning"} />,
        },
        {
            title: (
                <Tooltip title="被附进该用户 Agent 上下文的次数">
                    <span>注入</span>
                </Tooltip>
            ),
            dataIndex: "injected",
            width: 64,
            render: (value: number) => <span className="tabular-nums opacity-80">{value ?? 0}</span>,
        },
        {
            title: (
                <Tooltip title="旧版 Agent 用 recall_lessons 取全文的次数（该工具已下线）">
                    <span>查阅</span>
                </Tooltip>
            ),
            dataIndex: "hits",
            width: 64,
            render: (value: number) => <span className="tabular-nums opacity-80">{value ?? 0}</span>,
        },
        {
            title: "操作",
            key: "actions",
            width: 72,
            render: (_, record) => (
                <Space size={4}>
                    <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => remove(record)} />
                </Space>
            ),
        },
    ];

    return (
        <div className="flex flex-col gap-3">
            <p className="text-xs text-foreground/60">旧版经验条目已不再注入 Agent，也不会新增；首次打开记忆文件时，已批准的条目会导入为可撤销的一次修改。这里保留历史记录供巡查，必要时删除违规内容。</p>
            <AdminDataTable
                toolbar={
                    <div className="flex flex-wrap items-center gap-2">
                        <Select
                            value={status}
                            onChange={setStatus}
                            className="w-[120px]"
                            options={[
                                { label: "全部", value: "all" },
                                { label: "待审", value: "pending" },
                                { label: "已批准", value: "approved" },
                                { label: "已拒绝", value: "rejected" },
                            ]}
                        />
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
                        <Input.Search allowClear placeholder="主题、内容或用户名" className="w-[220px]" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
                        <Button icon={<RefreshCw className="size-4" />} onClick={() => void load()}>
                            刷新
                        </Button>
                        <span className="text-xs opacity-60">共 {items.length} 条</span>
                    </div>
                }
                table={{
                    rowKey: "id",
                    size: "small",
                    loading,
                    columns,
                    dataSource: items,
                    pagination: { defaultPageSize: 20, showSizeChanger: true },
                }}
                empty={<AdminTableEmpty title="没有匹配的旧版经验" description="换一个用户或关键词再查。新的记忆内容在「记忆文件」里查看。" />}
            />
        </div>
    );
}
