import { useEffect, useState, useCallback } from "react";
import { App, Button, Drawer, Input, Modal, Popconfirm, Select, Space, Table, Tag, Image as AntImage, Segmented } from "antd";
import type { ColumnsType } from "antd/es/table";
import { AlertCircle, Archive, ArchiveRestore, Bug, CheckCircle2, Clock, FileText, Inbox, Lightbulb, MessageSquare, Paperclip, Play, RefreshCw, Search, Send, UserRound, Clock3 } from "lucide-react";

import { getAdminFeedbacks, updateAdminFeedback, archiveAdminFeedback, type FeedbackItem, type FeedbackType, type FeedbackStatus, type FeedbackAttachment } from "@/services/api/feedback";
import { AdminPageFrame } from "../components/admin-shell";
import { cn } from "@/lib/utils";

export default function AdminFeedbacksPage() {
    const { message } = App.useApp();

    const [loading, setLoading] = useState(false);
    const [list, setList] = useState<FeedbackItem[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(15);

    // Filters
    const [typeFilter, setTypeFilter] = useState<string>("all");
    const [statusFilter, setStatusFilter] = useState<string>("all");
    const [archivedTab, setArchivedTab] = useState<"active" | "archived" | "all">("active");
    const [keyword, setKeyword] = useState<string>("");

    // Detail drawer
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [selectedItem, setSelectedItem] = useState<FeedbackItem | null>(null);
    const [replyText, setReplyText] = useState("");
    const [statusChange, setStatusChange] = useState<FeedbackStatus>("pending");
    const [saving, setSaving] = useState(false);

    // Video preview modal
    const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const res = await getAdminFeedbacks({
                type: typeFilter,
                status: statusFilter,
                archived: archivedTab === "all" ? "all" : archivedTab === "archived",
                keyword: keyword.trim() || undefined,
                page,
                limit,
            });
            setList(res.list);
            setTotal(res.total);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "获取反馈列表失败");
        } finally {
            setLoading(false);
        }
    }, [typeFilter, statusFilter, archivedTab, keyword, page, limit, message]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    const handleOpenDetail = (item: FeedbackItem) => {
        setSelectedItem(item);
        setReplyText(item.adminReply || "");
        setStatusChange(item.status);
        setDrawerOpen(true);
    };

    const handleSaveReply = async () => {
        if (!selectedItem) return;
        setSaving(true);
        try {
            const updated = await updateAdminFeedback(selectedItem.id, {
                status: statusChange,
                adminReply: replyText.trim(),
            });
            message.success("已更新反馈状态与答复内容");
            setSelectedItem(updated);
            // Refresh list in place
            setList((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "更新失败");
        } finally {
            setSaving(false);
        }
    };

    const handleArchive = async (id: string, archive: boolean) => {
        try {
            const updated = await archiveAdminFeedback(id, archive);
            message.success(archive ? "已将反馈移入历史归档" : "已将反馈移出归档并恢复活跃");
            if (selectedItem?.id === id) {
                setSelectedItem(updated);
            }
            void loadData();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "操作失败");
        }
    };

    // Calculate metrics
    const pendingCount = list.filter((i) => i.status === "pending" && !i.archived).length;
    const processingCount = list.filter((i) => i.status === "processing" && !i.archived).length;
    const resolvedCount = list.filter((i) => i.status === "resolved" && !i.archived).length;
    const archivedCount = list.filter((i) => i.archived).length;

    const typeConfig: Record<FeedbackType, { label: string; color: string; icon: typeof Bug }> = {
        bug: { label: "Bug 缺陷", color: "error", icon: Bug },
        feature: { label: "功能提议", color: "processing", icon: Lightbulb },
        improvement: { label: "体验建议", color: "cyan", icon: Lightbulb },
        other: { label: "其他反馈", color: "default", icon: MessageSquare },
    };

    const statusConfig: Record<string, { label: string; tagColor: string }> = {
        pending: { label: "待处理", tagColor: "orange" },
        processing: { label: "处理中", tagColor: "blue" },
        resolved: { label: "已解决", tagColor: "green" },
        closed: { label: "已关闭", tagColor: "default" },
        archived: { label: "已归档", tagColor: "default" },
    };

    const columns: ColumnsType<FeedbackItem> = [
        {
            title: "类型",
            dataIndex: "type",
            key: "type",
            width: 100,
            render: (val: FeedbackType) => {
                const conf = typeConfig[val] || typeConfig.other;
                const Icon = conf.icon;
                return (
                    <Tag color={conf.color} className="flex items-center gap-1 w-fit m-0 text-xs">
                        <Icon className="size-3" />
                        <span>{conf.label}</span>
                    </Tag>
                );
            },
        },
        {
            title: "标题与反馈说明",
            dataIndex: "title",
            key: "title",
            render: (_: unknown, record: FeedbackItem) => {
                let attCount = 0;
                try {
                    if (record.attachments) {
                        attCount = JSON.parse(record.attachments).length;
                    }
                } catch {}

                return (
                    <div className="space-y-1 py-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-foreground hover:text-primary cursor-pointer" onClick={() => handleOpenDetail(record)}>
                                {record.title}
                            </span>
                            {record.archived ? <Tag className="text-[var(--fs-label)] px-2 m-0 bg-muted/60 text-muted-foreground border-border/60">已归档</Tag> : null}
                            {attCount > 0 ? (
                                <Tag className="text-[var(--fs-label)] px-1 m-0 flex items-center gap-0.5 border-dashed">
                                    <Paperclip className="size-2.5" />
                                    <span>{attCount} 附件</span>
                                </Tag>
                            ) : null}
                            {record.adminReply ? (
                                <Tag color="blue" className="text-[var(--fs-label)] px-1 m-0 flex items-center gap-0.5">
                                    <CheckCircle2 className="size-2.5" />
                                    <span>已答复</span>
                                </Tag>
                            ) : null}
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-1 max-w-xl">{record.content}</p>
                    </div>
                );
            },
        },
        {
            title: "提交用户",
            key: "user",
            width: 150,
            render: (_: unknown, record: FeedbackItem) => (
                <div className="text-xs space-y-0.5">
                    <div className="font-medium text-foreground">{record.userName || "匿名"}</div>
                    {record.contact ? (
                        <div className="text-[var(--fs-label)] text-muted-foreground truncate max-w-[140px]" title={record.contact}>
                            {record.contact}
                        </div>
                    ) : null}
                </div>
            ),
        },
        {
            title: "状态",
            dataIndex: "status",
            key: "status",
            width: 110,
            render: (val: string, record: FeedbackItem) => {
                const conf = statusConfig[val] || { label: val, tagColor: "default" };
                return (
                    <div className="flex items-center gap-1">
                        <Tag color={conf.tagColor} className="m-0 text-xs font-medium">
                            {conf.label}
                        </Tag>
                    </div>
                );
            },
        },
        {
            title: "提交时间",
            dataIndex: "createdAt",
            key: "createdAt",
            width: 150,
            render: (timeStr: string) => (
                <span className="text-xs text-muted-foreground">
                    {new Date(timeStr).toLocaleString("zh-CN", {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                    })}
                </span>
            ),
        },
        {
            title: "操作",
            key: "action",
            width: 160,
            render: (_: unknown, record: FeedbackItem) => (
                <Space size="small">
                    <Button size="small" type="link" onClick={() => handleOpenDetail(record)}>
                        详情回复
                    </Button>
                    <Popconfirm
                        title={record.archived ? "确定将此反馈移出归档吗？" : "确定归档此反馈吗？"}
                        description={record.archived ? "移出后将重新回到活跃收件箱中跟进" : "归档后移入历史归档，用户与管理员仍可随时完整查阅"}
                        onConfirm={() => handleArchive(record.id, !record.archived)}
                        okText={record.archived ? "移出归档" : "归档"}
                        cancelText="取消"
                    >
                        <Button size="small" type="text" icon={record.archived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />} className={cn(record.archived ? "text-primary" : "text-muted-foreground hover:text-foreground")}>
                            {record.archived ? "移出归档" : "归档"}
                        </Button>
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    let selectedAttachments: FeedbackAttachment[] = [];
    try {
        if (selectedItem?.attachments) selectedAttachments = JSON.parse(selectedItem.attachments);
    } catch {}

    let selectedEnv: Record<string, string> = {};
    try {
        if (selectedItem?.environment) selectedEnv = JSON.parse(selectedItem.environment);
    } catch {}

    return (
        <AdminPageFrame title="用户反馈收件箱" description="集中查阅全站用户提交的 Bug 缺陷、功能提议与体验建议，支持收件箱式答复与历史归档管理" scroll>
            <div className="space-y-4">
                {/* Metrics Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="rounded-xl border border-border/70 bg-card p-4 flex items-center justify-between">
                        <div>
                            <p className="text-xs text-muted-foreground">当前列表数</p>
                            <p className="text-xl font-semibold text-foreground mt-0.5">{total}</p>
                        </div>
                        <Inbox className="size-5 text-primary opacity-60" />
                    </div>
                    <div className="rounded-xl border border-orange-500/30 bg-orange-500/5 p-4 flex items-center justify-between">
                        <div>
                            <p className="text-xs text-orange-600 dark:text-orange-400">待处理</p>
                            <p className="text-xl font-semibold text-orange-600 dark:text-orange-400 mt-0.5">{pendingCount}</p>
                        </div>
                        <Clock className="size-5 text-orange-500 opacity-60" />
                    </div>
                    <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4 flex items-center justify-between">
                        <div>
                            <p className="text-xs text-blue-600 dark:text-blue-400">处理中</p>
                            <p className="text-xl font-semibold text-blue-600 dark:text-blue-400 mt-0.5">{processingCount}</p>
                        </div>
                        <Clock3 className="size-5 text-blue-500 opacity-60" />
                    </div>
                    <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-4 flex items-center justify-between">
                        <div>
                            <p className="text-xs text-green-600 dark:text-green-400">已解决 / 采纳</p>
                            <p className="text-xl font-semibold text-green-600 dark:text-green-400 mt-0.5">{resolvedCount}</p>
                        </div>
                        <CheckCircle2 className="size-5 text-green-500 opacity-60" />
                    </div>
                </div>

                {/* Filter and Search Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-card p-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <Segmented
                            value={archivedTab}
                            onChange={(v) => {
                                setArchivedTab(v as "active" | "archived" | "all");
                                setPage(1);
                            }}
                            options={[
                                { label: "进行中反馈", value: "active" },
                                { label: "历史归档", value: "archived" },
                                { label: "全部反馈", value: "all" },
                            ]}
                            className="bg-muted/40"
                        />
                        <Input
                            placeholder="搜索标题、内容、用户或联系方式"
                            prefix={<Search className="size-3.5 text-muted-foreground mr-1" />}
                            value={keyword}
                            onChange={(e) => setKeyword(e.target.value)}
                            onPressEnter={() => {
                                setPage(1);
                                void loadData();
                            }}
                            allowClear
                            className="w-56 h-8 text-xs"
                        />
                        <Select
                            value={typeFilter}
                            onChange={(v) => {
                                setTypeFilter(v);
                                setPage(1);
                            }}
                            className="w-28 h-8 text-xs"
                            options={[
                                { label: "全部类型", value: "all" },
                                { label: "Bug 缺陷", value: "bug" },
                                { label: "功能提议", value: "feature" },
                                { label: "体验建议", value: "improvement" },
                                { label: "其他意见", value: "other" },
                            ]}
                        />
                        <Select
                            value={statusFilter}
                            onChange={(v) => {
                                setStatusFilter(v);
                                setPage(1);
                            }}
                            className="w-28 h-8 text-xs"
                            options={[
                                { label: "全部状态", value: "all" },
                                { label: "待处理", value: "pending" },
                                { label: "处理中", value: "processing" },
                                { label: "已解决", value: "resolved" },
                                { label: "已关闭", value: "closed" },
                            ]}
                        />
                        <Button
                            size="small"
                            type="primary"
                            onClick={() => {
                                setPage(1);
                                void loadData();
                            }}
                        >
                            查询
                        </Button>
                    </div>

                    <Button size="small" icon={<RefreshCw className={cn("size-3.5", loading && "animate-spin")} />} onClick={() => void loadData()}>
                        刷新
                    </Button>
                </div>

                {/* Feedback Table */}
                <div className="rounded-xl border border-border/70 bg-card overflow-hidden">
                    <Table
                        columns={columns}
                        dataSource={list}
                        rowKey="id"
                        loading={loading}
                        size="small"
                        pagination={{
                            current: page,
                            pageSize: limit,
                            total,
                            showSizeChanger: true,
                            pageSizeOptions: ["15", "30", "50"],
                            onChange: (p, l) => {
                                setPage(p);
                                setLimit(l);
                            },
                        }}
                    />
                </div>
            </div>

            {/* Detail & Reply Drawer */}
            <Drawer
                open={drawerOpen}
                onClose={() => setDrawerOpen(false)}
                width={560}
                title={
                    <div className="flex items-center gap-2">
                        <FileText className="size-4 text-primary" />
                        <span className="font-semibold text-sm">反馈详情与处理回复</span>
                    </div>
                }
            >
                {selectedItem ? (
                    <div className="space-y-4 text-xs">
                        {/* Meta */}
                        <div className="rounded-xl border border-border/70 bg-muted/20 p-4 space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="font-semibold text-sm text-foreground">{selectedItem.title}</span>
                                <div className="flex items-center gap-2">
                                    {selectedItem.archived ? <Tag className="m-0 text-xs bg-muted/80 text-muted-foreground border-border/80">已归档</Tag> : null}
                                    <Tag color={statusConfig[selectedItem.status]?.tagColor || "default"} className="m-0 text-xs">
                                        {statusConfig[selectedItem.status]?.label || selectedItem.status}
                                    </Tag>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-muted-foreground pt-1 border-t border-border/40 text-[var(--fs-label)]">
                                <div>
                                    提交用户：<span className="text-foreground">{selectedItem.userName}</span>
                                </div>
                                <div>
                                    联系方式：<span className="text-foreground">{selectedItem.contact || "未填写"}</span>
                                </div>
                                <div>
                                    反馈类型：<span className="text-foreground">{typeConfig[selectedItem.type]?.label || selectedItem.type}</span>
                                </div>
                                <div>
                                    提交时间：<span className="text-foreground">{new Date(selectedItem.createdAt).toLocaleString("zh-CN")}</span>
                                </div>
                            </div>
                        </div>

                        {/* Content */}
                        <div>
                            <label className="block text-xs font-semibold text-foreground mb-2">反馈内容说明</label>
                            <div className="rounded-xl border border-border/70 bg-muted/10 p-3 text-xs leading-relaxed whitespace-pre-wrap text-foreground/90">{selectedItem.content}</div>
                        </div>

                        {/* Attachments */}
                        {selectedAttachments.length > 0 ? (
                            <div>
                                <label className="block text-xs font-semibold text-foreground mb-2">附件清单 ({selectedAttachments.length})</label>
                                <div className="grid grid-cols-2 gap-2">
                                    {selectedAttachments.map((att) => (
                                        <div key={att.id} className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/25 p-2">
                                            {att.type === "image" ? (
                                                <AntImage src={att.url} alt={att.name} width={36} height={36} className="rounded object-cover" />
                                            ) : (
                                                <button type="button" onClick={() => setPreviewVideoUrl(att.url)} className="size-9 rounded bg-black/70 flex items-center justify-center text-primary hover:bg-black transition-colors">
                                                    <Play className="size-4 fill-current ml-0.5" />
                                                </button>
                                            )}
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate text-xs font-medium" title={att.name}>
                                                    {att.name}
                                                </p>
                                                <p className="text-[var(--fs-label)] text-muted-foreground">{(att.size / (1024 * 1024)).toFixed(1)} MB</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : null}

                        {/* Environment Info */}
                        {Object.keys(selectedEnv).length > 0 ? (
                            <details className="rounded-lg border border-border/50 bg-muted/10 p-2 text-[var(--fs-label)] text-muted-foreground">
                                <summary className="cursor-pointer font-medium hover:text-foreground">客户端诊断环境快照</summary>
                                <div className="mt-2 space-y-1 font-mono text-[var(--fs-label)] bg-black/20 p-2 rounded">
                                    {Object.entries(selectedEnv).map(([k, v]) => (
                                        <div key={k} className="flex gap-2">
                                            <span className="text-muted-foreground">{k}:</span>
                                            <span className="text-foreground/80 break-all">{v}</span>
                                        </div>
                                    ))}
                                </div>
                            </details>
                        ) : null}

                        {/* Admin Action & Reply Section */}
                        <div className="border-t border-border/60 pt-4 space-y-3">
                            <h4 className="font-semibold text-xs text-foreground">处理状态与官方答复</h4>

                            <div>
                                <label className="block text-xs text-muted-foreground mb-1">更新处理状态</label>
                                <Select
                                    value={statusChange}
                                    onChange={(v) => setStatusChange(v as FeedbackStatus)}
                                    className="w-full"
                                    options={[
                                        { label: "待处理 (Pending)", value: "pending" },
                                        { label: "处理中 / 评估中 (Processing)", value: "processing" },
                                        { label: "已解决 / 已采纳 (Resolved)", value: "resolved" },
                                        { label: "已关闭 / 暂不采纳 (Closed)", value: "closed" },
                                    ]}
                                />
                            </div>

                            <div>
                                <label className="block text-xs text-muted-foreground mb-1">官方处理答复 (用户可在其收件箱与历史归档中直接查看)</label>
                                <Input.TextArea rows={4} value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="输入回复内容，例如：已定位问题并将在下一版本发布修复；或者感谢提议，该需求已排入排期计划..." className="rounded-lg" />
                            </div>

                            <div className="flex items-center justify-between pt-1">
                                <Button icon={selectedItem.archived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />} onClick={() => handleArchive(selectedItem.id, !selectedItem.archived)}>
                                    {selectedItem.archived ? "移出归档" : "归档此反馈"}
                                </Button>
                                <div className="flex items-center gap-2">
                                    <Button onClick={() => setDrawerOpen(false)}>取消</Button>
                                    <Button type="primary" loading={saving} onClick={handleSaveReply} icon={<Send className="size-3.5" />}>
                                        保存并答复
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : null}
            </Drawer>

            {/* Video Preview Modal */}
            {previewVideoUrl ? (
                <Modal open={Boolean(previewVideoUrl)} onCancel={() => setPreviewVideoUrl(null)} footer={null} width={720} destroyOnClose title="附件视频预览">
                    <div className="py-2">
                        <video src={previewVideoUrl} controls autoPlay className="w-full max-h-[60vh] rounded-lg bg-black" />
                    </div>
                </Modal>
            ) : null}
        </AdminPageFrame>
    );
}
