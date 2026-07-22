import { App, Button, Form, Input, Modal, Popconfirm, Select, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { BellRing, CircleAlert, Info, Plus, Search, ShieldAlert, Wrench } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ListToolbar, TableSurface } from "@/components/layout/workspace-page";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
    closeAdminAnnouncement,
    createAdminAnnouncement,
    listAdminAnnouncements,
    type AnnouncementLevel,
    type AnnouncementStatus,
    type SystemAnnouncement,
} from "@/services/api/announcements";

type AnnouncementFormValues = {
    title: string;
    content: string;
    level: AnnouncementLevel;
};

const levelOptions: Array<{ value: AnnouncementLevel; label: string }> = [
    { value: "info", label: "平台通知" },
    { value: "success", label: "状态恢复" },
    { value: "warning", label: "服务提醒" },
    { value: "critical", label: "重要通知" },
];

const levelMeta: Record<AnnouncementLevel, { label: string; color: string; icon: typeof Info }> = {
    info: { label: "平台通知", color: "blue", icon: Info },
    success: { label: "状态恢复", color: "green", icon: Wrench },
    warning: { label: "服务提醒", color: "orange", icon: CircleAlert },
    critical: { label: "重要通知", color: "red", icon: ShieldAlert },
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
        form.setFieldsValue({ title: "", content: "", level: "info" });
        setModalOpen(true);
    };

    const publish = async () => {
        const values = await form.validateFields();
        setPublishing(true);
        try {
            await createAdminAnnouncement({ title: values.title.trim(), content: values.content.trim(), level: values.level });
            setModalOpen(false);
            setPage(1);
            await reload();
            message.success("公告已发布");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "发布公告失败");
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
            title: "级别",
            dataIndex: "level",
            width: 120,
            render: (level: AnnouncementLevel) => {
                const meta = levelMeta[level] || levelMeta.info;
                const Icon = meta.icon;
                return <Tag color={meta.color} icon={<Icon className="size-3" />}>{meta.label}</Tag>;
            },
        },
        {
            title: "状态",
            dataIndex: "status",
            width: 100,
            render: (value: AnnouncementStatus) => value === "active" ? <Tag color="green">发布中</Tag> : <Tag>已关闭</Tag>,
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
            fixed: "right",
            width: 100,
            render: (_, announcement) => announcement.status === "active" ? (
                <Popconfirm title="关闭这条公告？" description="关闭后用户公告中心将不再展示，历史记录会保留。" okText="关闭公告" cancelText="取消" onConfirm={() => void closeAnnouncement(announcement)}>
                    <Button type="text" danger size="small" loading={closingId === announcement.id}>关闭</Button>
                </Popconfirm>
            ) : <span className="text-xs text-foreground/35">已结束</span>,
        },
    ];

    return (
        <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
                <div className="flex min-w-0 items-center gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full border border-border bg-muted/45 text-foreground"><BellRing className="size-4" /></span>
                    <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground">共保留 {total} 条公告记录</div>
                        <div className="mt-0.5 text-xs text-foreground/50">关闭公告会立即从用户公告中心移除</div>
                    </div>
                </div>
                <Button type="primary" icon={<Plus className="size-4" />} onClick={openPublishModal}>发布公告</Button>
            </div>

            <ListToolbar active={Boolean(keyword || status !== "all")} onReset={() => { setKeyword(""); setStatus("all"); setPage(1); }}>
                <Input allowClear className="w-full sm:w-80" prefix={<Search className="size-4 text-foreground/40" />} value={keyword} placeholder="搜索公告标题或正文" onChange={(event) => { setKeyword(event.target.value); setPage(1); }} />
                <Select className="w-32" value={status} onChange={(value) => { setStatus(value); setPage(1); }} options={[{ label: "全部状态", value: "all" }, { label: "发布中", value: "active" }, { label: "已关闭", value: "closed" }]} />
            </ListToolbar>
            <TableSurface>
                <Table
                    className="app-data-table"
                    size="middle"
                    rowKey="id"
                    loading={loading}
                    columns={columns}
                    dataSource={announcements}
                    pagination={{ current: page, pageSize, total, showSizeChanger: true, pageSizeOptions: [20, 50, 100], showTotal: (value, range) => `${range[0]}-${range[1]} / 共 ${value} 条`, onChange: (nextPage, nextPageSize) => { setPage(nextPageSize !== pageSize ? 1 : nextPage); setPageSize(nextPageSize); } }}
                    scroll={{ x: 1020 }}
                />
            </TableSurface>

            <Modal title="发布系统公告" open={modalOpen} width={680} centered okText="立即发布" cancelText="取消" confirmLoading={publishing} onOk={() => void publish()} onCancel={() => setModalOpen(false)} destroyOnHidden>
                <Form form={form} layout="vertical" className="pt-3" requiredMark={false}>
                    <Form.Item name="title" label="公告标题" rules={[{ required: true, whitespace: true, message: "请填写公告标题" }, { max: 120, message: "标题不能超过 120 个字符" }]}>
                        <Input maxLength={120} showCount placeholder="例如：视频模型已恢复正常使用" />
                    </Form.Item>
                    <Form.Item name="level" label="公告级别" rules={[{ required: true, message: "请选择公告级别" }]}>
                        <Select options={levelOptions} />
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
