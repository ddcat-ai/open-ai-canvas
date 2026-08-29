import { App, Button, Form, Input, Modal, Select, Switch, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Pin, Plus, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { PaginationBar } from "@/components/layout/workspace-page";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
    closeAdminAnnouncement,
    createAdminAnnouncement,
    listAdminAnnouncements,
    updateAdminAnnouncement,
    type AnnouncementLevel,
    type AnnouncementStatus,
    type SystemAnnouncement,
} from "@/services/api/announcements";
import { AdminDataTable, AdminFilterChip, AdminRowActions, AdminStatusBadge, AdminTableEmpty } from "./admin-ui";

type AnnouncementFormValues = {
    title: string;
    content: string;
    level: AnnouncementLevel;
    pinned: boolean;
};

const levelOptions: Array<{ value: AnnouncementLevel; label: string }> = [
    { value: "info", label: "平台通知" },
    { value: "success", label: "状态恢复" },
    { value: "warning", label: "服务提醒" },
    { value: "critical", label: "重要通知" },
];

const levelMeta: Record<AnnouncementLevel, { label: string; tone: "info" | "success" | "warning" | "error" }> = {
    info: { label: "平台通知", tone: "info" },
    success: { label: "状态恢复", tone: "success" },
    warning: { label: "服务提醒", tone: "warning" },
    critical: { label: "重要通知", tone: "error" },
};

export default function AdminAnnouncementsPanel() {
    const { message } = App.useApp();
    const [form] = Form.useForm<AnnouncementFormValues>();
    const [announcements, setAnnouncements] = useState<SystemAnnouncement[]>([]);
    const [keyword, setKeyword] = useState("");
    const debouncedKeyword = useDebouncedValue(keyword);
    const [status, setStatus] = useState<"all" | AnnouncementStatus>("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    const [editingAnnouncement, setEditingAnnouncement] = useState<SystemAnnouncement | null>(null);
    const [publishing, setPublishing] = useState(false);
    const [closingId, setClosingId] = useState("");

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            const data = await listAdminAnnouncements({ keyword: debouncedKeyword || undefined, status: status === "all" ? undefined : status, page, limit: pageSize });
            setAnnouncements(data.announcements || []);
            setTotal(data.total || 0);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取公告列表失败");
        } finally {
            setLoading(false);
        }
    }, [debouncedKeyword, message, page, pageSize, status]);

    useEffect(() => {
        void reload();
    }, [reload]);

    const openPublishModal = () => {
        setEditingAnnouncement(null);
        form.setFieldsValue({ title: "", content: "", level: "info", pinned: false });
        setModalOpen(true);
    };

    const openEditModal = (announcement: SystemAnnouncement) => {
        setEditingAnnouncement(announcement);
        form.setFieldsValue({ title: announcement.title, content: announcement.content, level: announcement.level, pinned: announcement.pinned });
        setModalOpen(true);
    };

    const publish = async () => {
        const values = await form.validateFields();
        setPublishing(true);
        try {
            const input = { title: values.title.trim(), content: values.content.trim(), level: values.level, pinned: Boolean(values.pinned) };
            if (editingAnnouncement) await updateAdminAnnouncement(editingAnnouncement.id, input);
            else await createAdminAnnouncement(input);
            setModalOpen(false);
            setEditingAnnouncement(null);
            setPage(1);
            await reload();
            message.success(editingAnnouncement ? "公告已更新并重新发布" : "公告已发布");
        } catch (error) {
            message.error(error instanceof Error ? error.message : editingAnnouncement ? "更新公告失败" : "发布公告失败");
        } finally {
            setPublishing(false);
        }
    };

    const closeAnnouncement = async (announcement: SystemAnnouncement) => {
        setClosingId(announcement.id);
        try {
            await closeAdminAnnouncement(announcement.id);
            await reload();
            message.success("公告已关闭");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "关闭公告失败");
        } finally {
            setClosingId("");
        }
    };

    const columns: ColumnsType<SystemAnnouncement> = [
        {
            title: "公告内容",
            dataIndex: "title",
            minWidth: 360,
            render: (_, announcement) => (
                <div className="min-w-0 py-0.5">
                    <div className="truncate text-sm font-medium text-foreground" title={announcement.title}>{announcement.title}</div>
                    <div className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs leading-5 text-foreground/50">{announcement.content}</div>
                </div>
            ),
        },
        {
            title: "置顶",
            dataIndex: "pinned",
            width: 90,
            render: (pinned: boolean) => pinned ? <Tag color="gold" icon={<Pin className="size-3" />}>置顶</Tag> : <span className="text-foreground/35">--</span>,
        },
        {
            title: "级别",
            dataIndex: "level",
            width: 120,
            render: (level: AnnouncementLevel) => {
                const meta = levelMeta[level] || levelMeta.info;
                return <AdminStatusBadge label={meta.label} tone={meta.tone} />;
            },
        },
        {
            title: "状态",
            dataIndex: "status",
            width: 100,
            render: (value: AnnouncementStatus) => <AdminStatusBadge label={value === "active" ? "发布中" : "已关闭"} tone={value === "active" ? "success" : "neutral"} />,
        },
        {
            title: "发布时间",
            dataIndex: "publishedAt",
            width: 170,
            render: formatDateTime,
        },
        {
            title: "关闭时间",
            dataIndex: "closedAt",
            width: 170,
            render: (value?: string) => value ? formatDateTime(value) : "--",
        },
        {
            title: "操作",
            key: "actions",
            width: 160,
            render: (_, announcement) => <AdminRowActions primary={{ label: "编辑", onClick: () => openEditModal(announcement) }} actions={announcement.status === "active" ? [{ key: "close", label: "关闭", danger: true, disabled: closingId === announcement.id, onClick: () => void closeAnnouncement(announcement), confirm: { title: "关闭这条公告？", description: "关闭后用户公告中心将不再展示，历史记录会保留。", okText: "关闭公告" } }] : []} />,
        },
    ];

    return (
        <>
            <AdminDataTable
                toolbar={<Input allowClear className="app-list-search" prefix={<Search className="size-4 text-foreground/40" />} value={keyword} placeholder="搜索公告标题或正文" onChange={(event) => { setKeyword(event.target.value); setPage(1); }} />}
                toolbarActiveFilters={<>{keyword ? <AdminFilterChip label={`搜索：${keyword}`} onRemove={() => { setKeyword(""); setPage(1); }} /> : null}{status !== "all" ? <AdminFilterChip label={`状态：${status === "active" ? "发布中" : "已关闭"}`} onRemove={() => { setStatus("all"); setPage(1); }} /> : null}</>}
                toolbarActive={Boolean(keyword || status !== "all")}
                toolbarFilters={<Select className="w-32" value={status} onChange={(value) => { setStatus(value); setPage(1); }} options={[{ label: "全部状态", value: "all" }, { label: "发布中", value: "active" }, { label: "已关闭", value: "closed" }]} />}
                onReset={() => { setKeyword(""); setStatus("all"); setPage(1); }}
                trailing={<Button type="primary" size="small" icon={<Plus className="size-4" />} onClick={openPublishModal}>发布公告</Button>}
                table={{ rowKey: "id", size: "small", loading, pagination: false, columns, dataSource: announcements, scroll: { x: 1020 } }}
                empty={<AdminTableEmpty filtered={Boolean(keyword || status !== "all")} title="暂无公告" />}
                footer={<PaginationBar alwaysShow current={page} pageSize={pageSize} total={total} onChange={(nextPage, nextPageSize) => { setPage(nextPageSize !== pageSize ? 1 : nextPage); setPageSize(nextPageSize); }} />}
            />

            <Modal title={editingAnnouncement ? "编辑并重新发布公告" : "发布系统公告"} open={modalOpen} width={760} centered okText={editingAnnouncement ? "保存并重新发布" : "立即发布"} cancelText="取消" confirmLoading={publishing} onOk={() => void publish()} onCancel={() => { setModalOpen(false); setEditingAnnouncement(null); }} destroyOnHidden>
                <Form form={form} layout="vertical" className="pt-3" requiredMark={false}>
                    <Form.Item name="title" label="公告标题" rules={[{ required: true, whitespace: true, message: "请填写公告标题" }, { max: 120, message: "标题不能超过 120 个字符" }]}>
                        <Input maxLength={120} showCount placeholder="例如：视频模型已恢复正常使用" />
                    </Form.Item>
                    <Form.Item name="level" label="公告级别" rules={[{ required: true, message: "请选择公告级别" }]}>
                        <Select options={levelOptions} />
                    </Form.Item>
                    <Form.Item name="pinned" label="展示方式" valuePropName="checked" extra="置顶公告会优先展示。">
                        <Switch checkedChildren="置顶" unCheckedChildren="普通" />
                    </Form.Item>
                    <Form.Item name="content" label="公告正文" rules={[{ required: true, whitespace: true, message: "请填写公告正文" }, { max: 4000, message: "正文不能超过 4000 个字符" }]}>
                        <Input.TextArea maxLength={4000} showCount autoSize={{ minRows: 6, maxRows: 12 }} placeholder="填写服务状态、影响范围和用户需要采取的操作" />
                    </Form.Item>
                </Form>
            </Modal>
        </>
    );
}

function formatDateTime(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "--";
    return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date).replaceAll("/", "-");
}
