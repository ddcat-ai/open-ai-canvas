import { App, Button, DatePicker, Form, Input, Modal, Popconfirm, Select, Switch } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Trash2, Edit3, Search } from "lucide-react";
import dayjs, { type Dayjs } from "dayjs";
import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
    createAdminBanner,
    deleteAdminBanner,
    listAdminBanners,
    updateAdminBanner,
    type BannerAnnouncement,
} from "@/services/api/announcements";
import {
    BANNER_NOTICE_DEFAULT_TYPE,
    bannerNoticeTypeLabel,
    normalizeBannerNoticeType,
    type BannerNoticeType,
} from "@/lib/announcements/banner-notice";
import { bannerAnnouncementBarStyle } from "@/components/layout/banner-announcement-content";
import { BANNER_TITLE_MAX_CHARS, bannerTitleCharCount, bannerTitlePlainText, normalizeBannerTitleRuns, type BannerTitleRun } from "@/lib/announcements/banner-title";
import { AdminDataTable } from "./admin-ui";
import { BannerNoticeTypeSelector } from "./banner-notice-type-selector";
import { BannerNoticePreview, BannerTitleEditor } from "./banner-title-editor";

type FormValues = {
    noticeType: BannerNoticeType;
    link?: string;
    status: boolean;
    dateRange?: [Dayjs | null, Dayjs | null] | null;
};

type BannerDialog = { mode: "create" } | { mode: "edit"; banner: BannerAnnouncement };

export default function AdminBannerAnnouncementsPanel({
    createOpen,
    onCreateOpenChange,
}: {
    createOpen: boolean;
    onCreateOpenChange: (open: boolean) => void;
}) {
    const { message, modal } = App.useApp();
    const queryClient = useQueryClient();
    const [form] = Form.useForm<FormValues>();
    const linkValue = Form.useWatch("link", form);
    const [banners, setBanners] = useState<BannerAnnouncement[]>([]);
    const [keyword, setKeyword] = useState("");
    const [status, setStatus] = useState<string>("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [dialog, setDialog] = useState<BannerDialog | null>(null);
    const [titleRuns, setTitleRuns] = useState<BannerTitleRun[]>([]);
    const [noticeType, setNoticeType] = useState<BannerNoticeType>(BANNER_NOTICE_DEFAULT_TYPE);
    const [titleTouched, setTitleTouched] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const reload = async (targetPage = page, targetPageSize = pageSize) => {
        setLoading(true);
        try {
            const data = await listAdminBanners({
                keyword: keyword.trim() || undefined,
                status: status === "all" ? undefined : status,
                page: targetPage,
                pageSize: targetPageSize,
            });
            setBanners(data.banners || []);
            setTotal(data.total || 0);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取常驻通知列表失败");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void reload(1, pageSize);
    }, [keyword, status]);

    const openCreate = useCallback(() => {
        setTitleRuns([]);
        setNoticeType(BANNER_NOTICE_DEFAULT_TYPE);
        setTitleTouched(false);
        setDirty(false);
        form.resetFields();
        form.setFieldsValue({
            noticeType: BANNER_NOTICE_DEFAULT_TYPE,
            status: true,
        });
        setDialog({ mode: "create" });
    }, [form]);

    // 父级的 createOpen 只是「请求新建」信号：消费后立即复位，避免它再次触发时把编辑中的内容重置掉。
    useEffect(() => {
        if (!createOpen) return;
        onCreateOpenChange(false);
        openCreate();
    }, [createOpen, onCreateOpenChange, openCreate]);

    const openEdit = (banner: BannerAnnouncement) => {
        const initialRuns = banner.titleRuns?.length ? banner.titleRuns : banner.title ? [{ text: banner.title }] : [];
        const type = normalizeBannerNoticeType(banner.noticeType);
        setTitleRuns(initialRuns);
        setNoticeType(type);
        setTitleTouched(false);
        setDirty(false);
        form.setFieldsValue({
            noticeType: type,
            link: banner.link || undefined,
            status: banner.status === "active",
            dateRange: banner.startsAt || banner.endsAt ? [banner.startsAt ? dayjs(banner.startsAt) : null, banner.endsAt ? dayjs(banner.endsAt) : null] : null,
        });
        setDialog({ mode: "edit", banner });
    };

    const requestClose = () => {
        if (submitting) return;
        if (!dirty) {
            setDialog(null);
            return;
        }
        modal.confirm({
            title: "放弃未保存的修改？",
            content: "关闭后本次编辑的内容不会保留。",
            okText: "放弃修改",
            cancelText: "继续编辑",
            okButtonProps: { danger: true },
            onOk: () => setDialog(null),
        });
    };

    const handleDelete = async (id: string) => {
        try {
            await deleteAdminBanner(id);
            message.success("常驻通知已删除");
            void queryClient.invalidateQueries({ queryKey: ["active-banner-announcements"] });
            void reload(page, pageSize);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "删除失败");
        }
    };

    const handleToggleStatus = async (banner: BannerAnnouncement, nextStatus: boolean) => {
        try {
            await updateAdminBanner(banner.id, {
                title: banner.title,
                // 必须带上样式分段与通知类型：后端更新走显式字段表，漏传会把它们清空。
                titleRuns: banner.titleRuns,
                noticeType: normalizeBannerNoticeType(banner.noticeType),
                link: banner.link,
                status: nextStatus ? "active" : "disabled",
                startsAt: banner.startsAt,
                endsAt: banner.endsAt,
            });
            message.success(nextStatus ? "常驻通知已启用" : "常驻通知已禁用");
            void queryClient.invalidateQueries({ queryKey: ["active-banner-announcements"] });
            void reload(page, pageSize);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "更新状态失败");
        }
    };

    const handleSubmit = async (values: FormValues) => {
        setTitleTouched(true);
        const runs = normalizeBannerTitleRuns(titleRuns);
        const plain = bannerTitlePlainText(runs).trim();
        if (!plain || !runs.length) {
            message.error("请填写通知标题");
            return;
        }
        if (bannerTitleCharCount(runs) > BANNER_TITLE_MAX_CHARS) {
            message.error(`通知标题不能超过 ${BANNER_TITLE_MAX_CHARS} 个字符`);
            return;
        }
        setSubmitting(true);
        try {
            const startsAt = values.dateRange?.[0] ? values.dateRange[0].toISOString() : undefined;
            const endsAt = values.dateRange?.[1] ? values.dateRange[1].toISOString() : undefined;
            const selectedNoticeType = values.noticeType || noticeType;
            const payload = {
                title: plain,
                titleRuns: runs,
                noticeType: selectedNoticeType,
                link: values.link?.trim() || undefined,
                status: (values.status ? "active" : "disabled") as "active" | "disabled",
                startsAt,
                endsAt,
            };

            if (dialog?.mode === "edit") {
                await updateAdminBanner(dialog.banner.id, payload);
                message.success("常驻通知已更新");
            } else {
                await createAdminBanner(payload);
                message.success("常驻通知已新建");
            }
            setDialog(null);
            form.resetFields();
            void queryClient.invalidateQueries({ queryKey: ["active-banner-announcements"] });
            void reload(1, pageSize);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存常驻通知失败");
        } finally {
            setSubmitting(false);
        }
    };

    const columns: ColumnsType<BannerAnnouncement> = [
        {
            title: "通知标题",
            dataIndex: "title",
            key: "title",
            render: (text: string, record) => (
                <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-foreground">{text}</span>
                    {record.link ? (
                        <span className="font-mono text-[var(--fs-label)] text-foreground/45" title={record.link}>
                            {record.link.length > 44 ? `${record.link.slice(0, 44)}…` : record.link}
                        </span>
                    ) : null}
                </div>
            ),
        },
        {
            title: "类型",
            key: "noticeType",
            width: 92,
            // 用真实底色渲染类型，和前台/预览看到的是同一个 token。
            render: (_, record) => (
                <span
                    className="inline-flex items-center rounded-full px-2 py-0.5 text-[var(--fs-micro)] font-semibold text-white"
                    style={bannerAnnouncementBarStyle(record.noticeType)}
                >
                    {bannerNoticeTypeLabel(record.noticeType)}
                </span>
            ),
        },
        {
            title: "状态",
            dataIndex: "status",
            key: "status",
            width: 110,
            render: (value: string, record) => (
                <Switch
                    size="small"
                    checked={value === "active"}
                    onChange={(checked) => void handleToggleStatus(record, checked)}
                />
            ),
        },
        {
            title: "有效期",
            key: "validity",
            width: 280,
            render: (_, record) => {
                if (!record.startsAt && !record.endsAt) {
                    return <span className="text-foreground/45">长期有效</span>;
                }
                const startStr = record.startsAt ? dayjs(record.startsAt).format("YYYY-MM-DD HH:mm") : "不限";
                const endStr = record.endsAt ? dayjs(record.endsAt).format("YYYY-MM-DD HH:mm") : "不限";
                return (
                    <span className="text-xs text-foreground/75 font-mono">
                        {startStr} 至 {endStr}
                    </span>
                );
            },
        },
        {
            title: "创建时间",
            dataIndex: "createdAt",
            key: "createdAt",
            width: 160,
            render: (date: string) => <span className="text-xs text-foreground/60 font-mono">{dayjs(date).format("YYYY-MM-DD HH:mm")}</span>,
        },
        {
            title: "操作",
            key: "action",
            width: 120,
            align: "right",
            render: (_, record) => (
                <div className="flex justify-end gap-1">
                    <Button type="text" size="small" icon={<Edit3 className="size-3.5" />} onClick={() => openEdit(record)}>
                        编辑
                    </Button>
                    <Popconfirm title="确认删除此常驻通知？" onConfirm={() => void handleDelete(record.id)}>
                        <Button type="text" size="small" danger icon={<Trash2 className="size-3.5" />}>
                            删除
                        </Button>
                    </Popconfirm>
                </div>
            ),
        },
    ];

    const hasFilters = Boolean(keyword.trim() || status !== "all");
    const titleMissing = titleTouched && (!titleRuns.length || !bannerTitlePlainText(titleRuns).trim());
    const titleTooLong = bannerTitleCharCount(titleRuns) > BANNER_TITLE_MAX_CHARS;

    return (
        <div className="flex min-h-0 flex-1 flex-col pb-4">
            <AdminDataTable
                toolbar={
                    <Input
                        allowClear
                        aria-label="搜索常驻通知标题"
                        className="app-list-search"
                        prefix={<Search className="size-4 text-foreground/40" />}
                        value={keyword}
                        placeholder="搜索常驻通知标题"
                        onChange={(event) => {
                            setKeyword(event.target.value);
                            setPage(1);
                        }}
                    />
                }
                toolbarActive={hasFilters}
                toolbarFilters={
                    <Select
                        aria-label="按状态筛选常驻通知"
                        className="w-32"
                        value={status}
                        onChange={(value) => {
                            setStatus(value);
                            setPage(1);
                        }}
                        options={[
                            { label: "全部状态", value: "all" },
                            { label: "已启用", value: "active" },
                            { label: "已禁用", value: "disabled" },
                        ]}
                    />
                }
                onReset={() => {
                    setKeyword("");
                    setStatus("all");
                    setPage(1);
                }}
                table={{
                    rowKey: "id",
                    size: "small",
                    loading,
                    columns,
                    dataSource: banners,
                    pagination: {
                        current: page,
                        pageSize,
                        total,
                        onChange: (p, ps) => {
                            setPage(p);
                            setPageSize(ps);
                            void reload(p, ps);
                        },
                    },
                }}
            />

            <Modal
                title={dialog?.mode === "edit" ? "编辑常驻通知" : "新建常驻通知"}
                open={Boolean(dialog)}
                onCancel={requestClose}
                onOk={() => form.submit()}
                confirmLoading={submitting}
                centered
                destroyOnHidden
                width="min(880px, calc(100vw - 32px))"
                rootClassName="admin-modal-root"
            >
                <Form
                    form={form}
                    layout="vertical"
                    // 表单比弹窗高时在表单内部滚动，底部按钮始终可见；下拉层由 AntD 挂到 body，不会被裁剪。
                    style={{ maxHeight: "68vh", overflowY: "auto", paddingRight: 4 }}
                    onFinish={(values) => void handleSubmit(values)}
                    onValuesChange={() => setDirty(true)}
                >
                    <Form.Item name="noticeType" label="通知类型" extra="决定通知条底色；浅色 / 深色主题各有一档取值">
                        <BannerNoticeTypeSelector
                            value={noticeType}
                            onChange={(next) => {
                                setNoticeType(next);
                                form.setFieldValue("noticeType", next);
                                setDirty(true);
                            }}
                        />
                    </Form.Item>

                    <Form.Item
                        label="通知标题"
                        required
                        validateStatus={titleMissing || titleTooLong ? "error" : undefined}
                        help={
                            titleMissing
                                ? "请输入常驻通知标题"
                                : titleTooLong
                                  ? `已超出 ${BANNER_TITLE_MAX_CHARS} 个字符上限`
                                  : "支持按选区设置字号、字重、字体与颜色，用「图标」插入 emoji 素材；标题在通知条内固定单行展示"
                        }
                    >
                        <BannerTitleEditor
                            key={dialog?.mode === "edit" ? dialog.banner.id : "create"}
                            value={titleRuns}
                            onChange={(runs) => {
                                setTitleRuns(runs);
                                setDirty(true);
                            }}
                        />
                    </Form.Item>

                    {/* 预览放在 Form 内但不用 Form.Item：避免 AntD 向非表单控件注入 value/onChange/ref。 */}
                    <div className="mb-6">
                        <div className="mb-2 text-sm text-foreground/85">前台效果预览</div>
                        <BannerNoticePreview runs={titleRuns} hasLink={Boolean(linkValue?.trim())} noticeType={noticeType} />
                    </div>

                    <Form.Item
                        name="link"
                        label="跳转链接（可选）"
                        extra="支持 https:// 外链或以 / 开头的站内路径（如 /projects）；留空表示不可点击"
                        rules={[{ max: 500, message: "链接最多 500 字符" }]}
                    >
                        <Input maxLength={500} placeholder="https://… 或 /projects" />
                    </Form.Item>

                    <Form.Item name="status" label="发布状态" valuePropName="checked">
                        <Switch checkedChildren="启用" unCheckedChildren="禁用" />
                    </Form.Item>

                    <Form.Item name="dateRange" label="有效期（可选）" extra="留空表示长期有效；设置时间段后仅在有效期内于前台展示">
                        <DatePicker.RangePicker showTime format="YYYY-MM-DD HH:mm" className="w-full" />
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
}
