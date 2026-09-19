import { App, Button, Input } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Check, Eye, RefreshCw, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { listAdminCanvasTemplates, updateAdminCanvasTemplate, type CanvasTemplateRecord } from "@/services/api/canvas-templates";
import { AdminPageFrame } from "./components/admin-shell";
import { AdminDataTable, AdminRowActions, AdminStatusBadge, AdminTableEmpty, PaginationBar } from "./components/admin-ui";
import { Select } from "./ui/controls";

const categoryLabels: Record<string, string> = {
    image: "图片",
    video: "视频",
    storyboard: "分镜",
    commerce: "电商",
};

function formatTime(value: string) {
    return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function sourceLabel(template: CanvasTemplateRecord) {
    if (template.id === "nodyhub-import" || template.tags.includes("NodyHub")) return "NodyHub 导入";
    return template.owned ? "用户模板" : "平台模板";
}

export default function CanvasTemplatesPage() {
    const { message } = App.useApp();
    const [templates, setTemplates] = useState<CanvasTemplateRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [keyword, setKeyword] = useState("");
    const [status, setStatus] = useState("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [total, setTotal] = useState(0);
    const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([]);
    const [updatingID, setUpdatingID] = useState("");

    const load = async (options: { page?: number; query?: string; status?: string } = {}) => {
        const targetPage = options.page ?? page;
        const targetQuery = options.query ?? keyword;
        const targetStatus = options.status ?? status;
        setLoading(true);
        try {
            const result = await listAdminCanvasTemplates({ page: targetPage, pageSize, query: targetQuery.trim() || undefined, status: targetStatus === "all" ? undefined : targetStatus });
            setTemplates(result.templates);
            setTotal(result.total);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取画布模板失败");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
    }, [page, pageSize, status]);

    const filteredTemplates = useMemo(() => {
        const normalized = keyword.trim().toLowerCase();
        if (!normalized) return templates;
        return templates.filter((template) => `${template.title} ${template.description} ${template.tags.join(" ")}`.toLowerCase().includes(normalized));
    }, [keyword, templates]);

    const applySearch = () => {
        setPage(1);
        void load({ page: 1 });
    };

    const updateStatus = async (template: CanvasTemplateRecord, nextStatus: "draft" | "published") => {
        setUpdatingID(template.id);
        try {
            await updateAdminCanvasTemplate(template.id, { status: nextStatus, visibility: nextStatus === "published" ? "public" : "private" });
            await load();
            message.success(nextStatus === "published" ? "画布模板已发布" : "画布模板已下架");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "更新画布模板状态失败");
        } finally {
            setUpdatingID("");
        }
    };

    const columns: ColumnsType<CanvasTemplateRecord> = [
        {
            title: "模板",
            dataIndex: "title",
            render: (title: string, template) => (
                <div>
                    <div className="font-medium">{title}</div>
                    <div className="mt-1 line-clamp-2 text-xs text-foreground/50">{template.description || "暂无描述"}</div>
                </div>
            ),
        },
        { title: "分类", dataIndex: "category", width: 100, render: (category: string) => categoryLabels[category] || category },
        { title: "版本", dataIndex: "currentVersion", width: 90, align: "center", render: (version: number) => `v${version}` },
        { title: "来源", width: 130, render: (_, template) => <span className="text-xs text-foreground/65">{sourceLabel(template)}</span> },
        {
            title: "状态",
            dataIndex: "status",
            width: 110,
            align: "center",
            render: (value: CanvasTemplateRecord["status"]) => <AdminStatusBadge label={value === "published" ? "已发布" : "草稿"} tone={value === "published" ? "success" : "warning"} />,
        },
        { title: "更新时间", dataIndex: "updatedAt", width: 180, align: "center", render: formatTime },
        {
            title: "操作",
            width: 230,
            align: "center",
            render: (_, template) => (
                <AdminRowActions
                    visibleActionCount={2}
                    primary={{
                        label: template.status === "published" ? "下架" : "发布",
                        icon: template.status === "published" ? <X className="size-3.5" /> : <Check className="size-3.5" />,
                        disabled: updatingID === template.id,
                        onClick: () => void updateStatus(template, template.status === "published" ? "draft" : "published"),
                    }}
                    actions={[{ key: "preview", label: "查看结构", icon: <Eye className="size-3.5" />, onClick: () => setExpandedRowKeys((keys) => (keys.includes(template.id) ? keys.filter((key) => key !== template.id) : [...keys, template.id])) }]}
                />
            ),
        },
    ];

    return (
        <AdminPageFrame
            title="画布模板"
            description="管理自由画布的公共工作流、用户模板和 NodyHub 导入模板。"
            scroll
            actions={
                <Button icon={<RefreshCw className="size-4" />} onClick={() => void load()}>
                    刷新
                </Button>
            }
        >
            <AdminDataTable
                toolbar={
                    <div className="flex w-full flex-wrap items-center gap-2">
                        <Input allowClear prefix={<Search className="size-3.5 text-foreground/45" />} value={keyword} placeholder="搜索模板名称、描述或标签" onChange={(event) => setKeyword(event.target.value)} onPressEnter={applySearch} />
                        <Button type="primary" onClick={applySearch}>
                            搜索
                        </Button>
                    </div>
                }
                toolbarFilters={
                    <Select
                        ariaLabel="模板状态"
                        value={status}
                        onChange={(value) => {
                            setStatus(value);
                            setPage(1);
                        }}
                        options={[
                            { label: "全部状态", value: "all" },
                            { label: "已发布", value: "published" },
                            { label: "草稿", value: "draft" },
                        ]}
                    />
                }
                toolbarActive={status !== "all" || Boolean(keyword.trim())}
                onReset={() => {
                    setStatus("all");
                    setKeyword("");
                    setPage(1);
                    void load({ page: 1, query: "", status: "all" });
                }}
                table={{
                    className: "app-data-table",
                    size: "small",
                    rowKey: "id",
                    loading,
                    pagination: false,
                    columns,
                    dataSource: filteredTemplates,
                    scroll: { x: 1100 },
                    expandable: {
                        expandedRowKeys,
                        onExpandedRowsChange: (keys) => setExpandedRowKeys(keys.map(String)),
                        expandedRowRender: (template) => (
                            <div className="grid gap-2 text-xs text-foreground/65 md:grid-cols-3">
                                <span>节点：{template.document?.nodes.length || 0}</span>
                                <span>连线：{template.document?.connections.length || 0}</span>
                                <span>标签：{template.tags.join("、") || "无"}</span>
                            </div>
                        ),
                    },
                }}
                empty={<AdminTableEmpty filtered={Boolean(keyword || status !== "all")} title="还没有可管理的画布模板" />}
                footer={
                    <PaginationBar
                        alwaysShow
                        current={page}
                        pageSize={pageSize}
                        total={total}
                        onChange={(nextPage, nextPageSize) => {
                            setPage(nextPageSize !== pageSize ? 1 : nextPage);
                            setPageSize(nextPageSize);
                        }}
                    />
                }
            />
        </AdminPageFrame>
    );
}
