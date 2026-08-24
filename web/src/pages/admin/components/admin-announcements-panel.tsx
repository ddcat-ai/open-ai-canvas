import { App, Button, Form, Input, Modal, Select } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Plus, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { PaginationBar } from "@/components/layout/workspace-page";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { closeAdminAnnouncement, createAdminAnnouncement, listAdminAnnouncements, updateAdminAnnouncement, type AnnouncementLevel, type AnnouncementStatus, type SystemAnnouncement } from "@/services/api/announcements";
import { AdminDataTable, AdminFilterChip, AdminRowActions, AdminStatusBadge, AdminTableEmpty } from "./admin-ui";
import { useTranslation } from "react-i18next";
import { t } from "@/i18n";

type AnnouncementFormValues = {
    title: string;
    content: string;
    level: AnnouncementLevel;
};

const levelOptions: Array<{ value: AnnouncementLevel; label: string }> = [
    { value: "info", label: t("admin:platform-announcements") },
    { value: "success", label: t("admin:status-recovery") },
    { value: "warning", label: t("admin:service-alerts") },
    { value: "critical", label: t("admin:important-notices") },
];

const levelMeta: Record<AnnouncementLevel, { label: string; tone: "info" | "success" | "warning" | "error" }> = {
    info: { label: t("admin:platform-announcements"), tone: "info" },
    success: { label: t("admin:status-recovery"), tone: "success" },
    warning: { label: t("admin:service-alerts"), tone: "warning" },
    critical: { label: t("admin:important-notices"), tone: "error" },
};

export default function AdminAnnouncementsPanel() {
    const { t } = useTranslation("canvas");
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
            message.error(error instanceof Error ? error.message : t("admin:failed-to-load-announcements"));
        } finally {
            setLoading(false);
        }
    }, [debouncedKeyword, message, page, pageSize, status]);

    useEffect(() => {
        void reload();
    }, [reload]);

    const openPublishModal = () => {
        setEditingAnnouncement(null);
        form.setFieldsValue({ title: "", content: "", level: "info" });
        setModalOpen(true);
    };

    const openEditModal = (announcement: SystemAnnouncement) => {
        setEditingAnnouncement(announcement);
        form.setFieldsValue({ title: announcement.title, content: announcement.content, level: announcement.level });
        setModalOpen(true);
    };

    const publish = async () => {
        const values = await form.validateFields();
        setPublishing(true);
        try {
            const input = { title: values.title.trim(), content: values.content.trim(), level: values.level };
            if (editingAnnouncement) await updateAdminAnnouncement(editingAnnouncement.id, input);
            else await createAdminAnnouncement(input);
            setModalOpen(false);
            setEditingAnnouncement(null);
            setPage(1);
            await reload();
            message.success(editingAnnouncement ? t("admin:announcement-updated-and-republished") : t("admin:announcement-published"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : editingAnnouncement ? t("admin:failed-to-update-announcement") : t("admin:failed-to-publish-announcement"));
        } finally {
            setPublishing(false);
        }
    };

    const closeAnnouncement = async (announcement: SystemAnnouncement) => {
        setClosingId(announcement.id);
        try {
            await closeAdminAnnouncement(announcement.id);
            await reload();
            message.success(t("admin:announcement-closed"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:failed-to-close-announcement"));
        } finally {
            setClosingId("");
        }
    };

    const columns: ColumnsType<SystemAnnouncement> = [
        {
            title: t("admin:announcement-content"),
            dataIndex: "title",
            minWidth: 360,
            render: (_, announcement) => (
                <div className="min-w-0 py-0.5">
                    <div className="truncate text-sm font-medium text-foreground" title={announcement.title}>
                        {announcement.title}
                    </div>
                    <div className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs leading-5 text-foreground/50">{announcement.content}</div>
                </div>
            ),
        },
        {
            title: t("admin:level"),
            dataIndex: "level",
            width: 120,
            render: (level: AnnouncementLevel) => {
                const meta = levelMeta[level] || levelMeta.info;
                return <AdminStatusBadge label={meta.label} tone={meta.tone} />;
            },
        },
        {
            title: t("admin:status"),
            dataIndex: "status",
            width: 100,
            render: (value: AnnouncementStatus) => <AdminStatusBadge label={value === "active" ? t("admin:published") : t("admin:closed")} tone={value === "active" ? "success" : "neutral"} />,
        },
        {
            title: t("admin:published-at"),
            dataIndex: "publishedAt",
            width: 170,
            render: formatDateTime,
        },
        {
            title: t("admin:closed-at"),
            dataIndex: "closedAt",
            width: 170,
            render: (value?: string) => (value ? formatDateTime(value) : "--"),
        },
        {
            title: t("admin:actions"),
            key: "actions",
            width: 160,
            render: (_, announcement) => (
                <AdminRowActions
                    primary={{ label: t("admin:edit-2"), onClick: () => openEditModal(announcement) }}
                    actions={
                        announcement.status === "active"
                            ? [
                                  {
                                      key: "close",
                                      label: t("admin:close-4"),
                                      danger: true,
                                      disabled: closingId === announcement.id,
                                      onClick: () => void closeAnnouncement(announcement),
                                      confirm: { title: t("admin:close-this-announcement"), description: t("admin:it-disappears-from-the-user-announcement-center-once-closed-history-is-k"), okText: t("admin:close-announcement") },
                                  },
                              ]
                            : []
                    }
                />
            ),
        },
    ];

    return (
        <>
            <AdminDataTable
                toolbar={
                    <Input
                        allowClear
                        className="app-list-search"
                        prefix={<Search className="size-4 text-foreground/40" />}
                        value={keyword}
                        placeholder={t("admin:search-announcement-titles-or-body-text")}
                        onChange={(event) => {
                            setKeyword(event.target.value);
                            setPage(1);
                        }}
                    />
                }
                toolbarActiveFilters={
                    <>
                        {keyword ? (
                            <AdminFilterChip
                                label={t("admin:search-param", { keyword: keyword })}
                                onRemove={() => {
                                    setKeyword("");
                                    setPage(1);
                                }}
                            />
                        ) : null}
                        {status !== "all" ? (
                            <AdminFilterChip
                                label={`状态：${status === "active" ? t("admin:published") : t("admin:closed")}`}
                                onRemove={() => {
                                    setStatus("all");
                                    setPage(1);
                                }}
                            />
                        ) : null}
                    </>
                }
                toolbarActive={Boolean(keyword || status !== "all")}
                toolbarFilters={
                    <Select
                        className="w-32"
                        value={status}
                        onChange={(value) => {
                            setStatus(value);
                            setPage(1);
                        }}
                        options={[
                            { label: t("admin:all-statuses"), value: "all" },
                            { label: t("admin:published"), value: "active" },
                            { label: t("admin:closed"), value: "closed" },
                        ]}
                    />
                }
                onReset={() => {
                    setKeyword("");
                    setStatus("all");
                    setPage(1);
                }}
                trailing={
                    <Button type="primary" size="small" icon={<Plus className="size-4" />} onClick={openPublishModal}>
                        {t("admin:publish-announcement")}
                    </Button>
                }
                table={{ rowKey: "id", size: "small", loading, pagination: false, columns, dataSource: announcements, scroll: { x: 1020 } }}
                empty={<AdminTableEmpty filtered={Boolean(keyword || status !== "all")} title={t("admin:no-announcements-yet")} />}
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

            <Modal
                title={editingAnnouncement ? t("admin:edit-and-republish-announcement") : t("admin:publish-system-announcement")}
                open={modalOpen}
                width={760}
                centered
                okText={editingAnnouncement ? t("admin:save-and-republish") : t("admin:publish-now")}
                cancelText={t("admin:cancel-4")}
                confirmLoading={publishing}
                onOk={() => void publish()}
                onCancel={() => {
                    setModalOpen(false);
                    setEditingAnnouncement(null);
                }}
                destroyOnHidden
            >
                <Form form={form} layout="vertical" className="pt-3" requiredMark={false}>
                    <Form.Item
                        name="title"
                        label={t("admin:title")}
                        rules={[
                            { required: true, whitespace: true, message: t("admin:enter-a-title") },
                            { max: 120, message: t("admin:title-cannot-exceed-120-characters") },
                        ]}
                    >
                        <Input maxLength={120} showCount placeholder={t("admin:e-g-video-models-have-fully-recovered")} />
                    </Form.Item>
                    <Form.Item name="level" label={t("admin:level-2")} rules={[{ required: true, message: t("admin:choose-a-level") }]}>
                        <Select options={levelOptions} />
                    </Form.Item>
                    <Form.Item
                        name="content"
                        label={t("admin:body")}
                        rules={[
                            { required: true, whitespace: true, message: t("admin:enter-the-body-text") },
                            { max: 4000, message: t("admin:body-cannot-exceed-4000-characters") },
                        ]}
                    >
                        <Input.TextArea maxLength={4000} showCount autoSize={{ minRows: 6, maxRows: 12 }} placeholder={t("admin:describe-service-status-impact-scope-and-any-action-users-should-take")} />
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
