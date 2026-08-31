import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { App, Button, Form, Input, Modal, Select, Switch } from "antd";
import type { InputRef } from "antd";
import type { ColumnsType } from "antd/es/table";
import { PencilLine, Pin, Plus, RefreshCw, Search, Send, Upload, X } from "lucide-react";

import { PaginationBar } from "@/components/layout/workspace-page";
import { AnnouncementContent } from "@/components/ui/announcement-content";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { ApiError } from "@/services/api/request";
import {
    announcementImageUrl,
    closeAdminAnnouncement,
    createAdminAnnouncement,
    discardAdminAnnouncementImage,
    listAdminAnnouncements,
    updateAdminAnnouncement,
    uploadAdminAnnouncementImage,
    type AnnouncementLevel,
    type AnnouncementStatus,
    type SystemAnnouncement,
} from "@/services/api/announcements";
import { resourceFileUrl } from "@/services/api/resources";
import { clearAnnouncementPendingReview, readAnnouncementPendingReview, writeAnnouncementPendingReview, type AnnouncementPendingReview } from "./admin-announcement-safety";
import { AdminDataTable, AdminRowActions, AdminStatusBadge, AdminTableEmpty } from "./admin-ui";

type AnnouncementFormValues = {
    title: string;
    content: string;
    imageResourceId?: string;
    level: AnnouncementLevel;
    pinned: boolean;
};

type PendingAnnouncement =
    | (AnnouncementFormValues & { mode: "create" })
    | (AnnouncementFormValues & {
          mode: "update";
          id: string;
          previousStatus: AnnouncementStatus;
          previousPublishedAt: string;
          previousTitle: string;
      });

const DEFAULT_ANNOUNCEMENT: AnnouncementFormValues = { title: "", content: "", imageResourceId: "", level: "info", pinned: false };
const levelOptions: Array<{ value: AnnouncementLevel; label: string }> = [
    { value: "info", label: "平台通知" },
    { value: "success", label: "状态恢复" },
    { value: "warning", label: "服务提醒" },
    { value: "critical", label: "重要通知" },
];

const levelMeta: Record<AnnouncementLevel, { label: string; tone: "info" | "success" | "warning" | "error"; guidance: string }> = {
    info: { label: "平台通知", tone: "info", guidance: "常规功能、活动或规则说明。" },
    success: { label: "状态恢复", tone: "success", guidance: "此前受影响的服务已经恢复。" },
    warning: { label: "服务提醒", tone: "warning", guidance: "可能影响使用，需要用户留意。" },
    critical: { label: "重要通知", tone: "error", guidance: "高优先级事件或必须执行的操作。" },
};

export default function AdminAnnouncementsPanel({
    publishOpen,
    publishBlocked,
    publishReturnFocus,
    onPublishOpenChange,
    onPublishBlockedChange,
}: {
    publishOpen: boolean;
    publishBlocked: boolean;
    publishReturnFocus: HTMLElement | null;
    onPublishOpenChange: (open: boolean) => void;
    onPublishBlockedChange: (blocked: boolean) => void;
}) {
    const { message } = App.useApp();
    const [form] = Form.useForm<AnnouncementFormValues>();
    const [announcements, setAnnouncements] = useState<SystemAnnouncement[]>([]);
    const [keyword, setKeyword] = useState("");
    const debouncedKeyword = useDebouncedValue(keyword);
    const [status, setStatus] = useState<"all" | AnnouncementStatus>("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [listError, setListError] = useState("");
    const [editingAnnouncement, setEditingAnnouncement] = useState<SystemAnnouncement | null>(null);
    const [pendingSave, setPendingSave] = useState<PendingAnnouncement | null>(null);
    const [saving, setSaving] = useState(false);
    const [imagePreviewUrl, setImagePreviewUrl] = useState("");
    const [draftImageResourceId, setDraftImageResourceId] = useState("");
    const [imageUploading, setImageUploading] = useState(false);
    const [closingIds, setClosingIds] = useState<Set<string>>(() => new Set());
    const [pendingReview, setPendingReview] = useState<AnnouncementPendingReview | null>(() => readAnnouncementPendingReview());
    const [uncertainListReady, setUncertainListReady] = useState(false);
    const [reconciliationLoading, setReconciliationLoading] = useState(false);
    const [reconciliationSummary, setReconciliationSummary] = useState("");
    const [listRefreshNonce, setListRefreshNonce] = useState(0);
    const listRequestRef = useRef(0);
    const reconciliationRequestRef = useRef(0);
    const saveInFlightRef = useRef(false);
    const closeInFlightRef = useRef(new Set<string>());
    const writeBlockedRef = useRef(publishBlocked);
    const editorReturnFocusRef = useRef<HTMLElement | null>(null);
    const imageInputRef = useRef<HTMLInputElement | null>(null);
    writeBlockedRef.current = publishBlocked;
    const watchedTitle = Form.useWatch("title", form);
    const watchedContent = Form.useWatch("content", form);
    const watchedLevel = Form.useWatch("level", form);
    const watchedPinned = Form.useWatch("pinned", form);

    const reload = async (targetPage = page, targetPageSize = pageSize, queryOverride?: { keyword?: string; status?: "all" | AnnouncementStatus }) => {
        const requestId = ++listRequestRef.current;
        const queryKeyword = (queryOverride?.keyword ?? debouncedKeyword).trim();
        const queryStatus = queryOverride?.status ?? status;
        setLoading(true);
        setListError("");
        setAnnouncements([]);
        setTotal(0);
        try {
            const data = assertAnnouncementListResult(
                await listAdminAnnouncements({
                    keyword: queryKeyword || undefined,
                    status: queryStatus === "all" ? undefined : queryStatus,
                    page: targetPage,
                    limit: targetPageSize,
                }),
                targetPage,
                targetPageSize,
            );
            if (requestId !== listRequestRef.current) return false;
            const lastPage = Math.max(1, Math.ceil(data.total / targetPageSize));
            if (targetPage > lastPage) {
                setPage(lastPage);
                return true;
            }
            setAnnouncements(data.announcements);
            setTotal(data.total);
            return true;
        } catch (error) {
            if (requestId === listRequestRef.current) {
                const detail = error instanceof Error ? error.message : "读取公告列表失败";
                setListError(detail);
                message.error(detail);
            }
            return false;
        } finally {
            if (requestId === listRequestRef.current) setLoading(false);
        }
    };

    useEffect(() => {
        const reconciliationRequestId = ++reconciliationRequestRef.current;
        const shouldReconcile = publishBlocked && Boolean(pendingReview) && page === 1 && !debouncedKeyword.trim() && status === "all";
        if (!shouldReconcile) setReconciliationLoading(false);
        void (async () => {
            const loaded = await reload(page, pageSize);
            if (!shouldReconcile || !pendingReview) return;
            setUncertainListReady(false);
            if (!loaded || reconciliationRequestId !== reconciliationRequestRef.current) return;
            setReconciliationLoading(true);
            setReconciliationSummary("正在定位待核对公告…");
            try {
                const summary = await inspectPendingReview(pendingReview);
                if (reconciliationRequestId !== reconciliationRequestRef.current) return;
                setReconciliationSummary(summary);
                setUncertainListReady(true);
            } catch (error) {
                if (reconciliationRequestId !== reconciliationRequestRef.current) return;
                setReconciliationSummary(error instanceof Error ? `自动核对失败：${error.message}` : "自动核对失败，请重新刷新。");
            } finally {
                if (reconciliationRequestId === reconciliationRequestRef.current) setReconciliationLoading(false);
            }
        })();
    }, [debouncedKeyword, listRefreshNonce, page, pageSize, pendingReview, publishBlocked, status]);

    useEffect(() => {
        if (!publishOpen) return;
        if (publishReturnFocus) editorReturnFocusRef.current = publishReturnFocus;
        setEditingAnnouncement(null);
        form.setFieldsValue(DEFAULT_ANNOUNCEMENT);
        setImagePreviewUrl("");
        setDraftImageResourceId("");
    }, [form, publishOpen, publishReturnFocus]);

    const editorOpen = publishOpen || Boolean(editingAnnouncement);
    const discardDraftImage = async () => {
        if (!draftImageResourceId) return;
        await discardAdminAnnouncementImage(draftImageResourceId);
        setDraftImageResourceId("");
    };

    const uploadAnnouncementImage = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        if (!file.type.startsWith("image/")) {
            message.warning("公告配图必须是图片文件");
            return;
        }
        if (file.size > 10 * 1024 * 1024) {
            message.warning("公告配图不能超过 10MB");
            return;
        }
        setImageUploading(true);
        try {
            if (draftImageResourceId) await discardDraftImage();
            const { resource } = await uploadAdminAnnouncementImage(file);
            form.setFieldValue("imageResourceId", resource.id);
            setDraftImageResourceId(resource.id);
            setImagePreviewUrl(resourceFileUrl(resource.id));
            message.success("公告配图已上传");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "公告配图上传失败");
        } finally {
            setImageUploading(false);
        }
    };

    const clearAnnouncementImage = async () => {
        setImageUploading(true);
        try {
            await discardDraftImage();
            form.setFieldValue("imageResourceId", "");
            setImagePreviewUrl("");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "公告配图清理失败");
        } finally {
            setImageUploading(false);
        }
    };

    const closeEditor = async () => {
        if (saving || pendingSave || imageUploading) return;
        setImageUploading(true);
        try {
            await discardDraftImage();
            onPublishOpenChange(false);
            setEditingAnnouncement(null);
            setImagePreviewUrl("");
            form.resetFields();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "公告配图草稿清理失败，请重试");
        } finally {
            setImageUploading(false);
        }
    };

    const openEditDrawer = (announcement: SystemAnnouncement) => {
        if (publishBlocked || !isKnownAnnouncementStatus(announcement.status)) return;
        if (document.activeElement instanceof HTMLElement) editorReturnFocusRef.current = document.activeElement;
        onPublishOpenChange(false);
        setEditingAnnouncement(announcement);
        form.setFieldsValue({
            title: announcement.title,
            content: announcement.content,
            imageResourceId: announcement.imageResourceId || "",
            level: announcement.level,
            pinned: announcement.pinned,
        });
        setImagePreviewUrl(announcementImageUrl(announcement));
        setDraftImageResourceId("");
    };

    const previewSave = (values: AnnouncementFormValues) => {
        if (writeBlockedRef.current) {
            message.warning("请先完成上一次公告操作的核对");
            return;
        }
        const normalized: AnnouncementFormValues = {
            title: values.title.trim(),
            content: values.content.trim(),
            imageResourceId: values.imageResourceId?.trim() || "",
            level: values.level,
            pinned: Boolean(values.pinned),
        };
        if (editingAnnouncement) {
            setPendingSave({
                ...normalized,
                mode: "update",
                id: editingAnnouncement.id,
                previousStatus: editingAnnouncement.status,
                previousPublishedAt: editingAnnouncement.publishedAt,
                previousTitle: editingAnnouncement.title,
            });
        } else {
            setPendingSave({ ...normalized, mode: "create" });
        }
    };

    const saveAnnouncement = async () => {
        if (!pendingSave || saveInFlightRef.current) return;
        if (writeBlockedRef.current) {
            message.warning("请先完成上一次公告操作的核对");
            return;
        }
        saveInFlightRef.current = true;
        setSaving(true);
        const isUpdate = pendingSave.mode === "update";
        const requestedAt = new Date().toISOString();
        try {
            const input = {
                title: pendingSave.title,
                content: pendingSave.content,
                imageResourceId: pendingSave.imageResourceId?.trim() || "",
                level: pendingSave.level,
                pinned: pendingSave.pinned,
            };
            const result = isUpdate ? await updateAdminAnnouncement(pendingSave.id, input) : await createAdminAnnouncement(input);
            assertAnnouncementMutationResult(result, "active", isUpdate ? pendingSave.id : undefined, input);
            setDraftImageResourceId("");
            setImagePreviewUrl("");
            setPendingSave(null);
            setEditingAnnouncement(null);
            onPublishOpenChange(false);
            form.resetFields();
            setKeyword("");
            setStatus("all");
            setPage(1);
            setListRefreshNonce((value) => value + 1);
            message.success(isUpdate ? "公告已更新并重新发布" : "公告已发布");
        } catch (error) {
            const detail = error instanceof Error ? error.message : isUpdate ? "重新发布公告失败" : "发布公告失败";
            if (isMutationResultUncertain(error)) {
                writeBlockedRef.current = true;
                setPendingSave(null);
                setEditingAnnouncement(null);
                onPublishOpenChange(false);
                form.resetFields();
                setDraftImageResourceId("");
                setImagePreviewUrl("");
                onPublishBlockedChange(true);
                setKeyword("");
                setStatus("all");
                setPage(1);
                setUncertainListReady(false);
                const notice = `上一次${isUpdate ? "重新发布" : "发布"}请求的结果暂时无法确认：${detail}。系统已切换到未筛选列表，请核对最新发布时间与内容。核对完成前，公告写操作已暂停。`;
                const review: AnnouncementPendingReview = {
                    operation: isUpdate ? "update" : "create",
                    targetId: isUpdate ? pendingSave.id : undefined,
                    previousTitle: isUpdate ? pendingSave.previousTitle : undefined,
                    title: pendingSave.title,
                    content: pendingSave.content,
                    imageResourceId: pendingSave.imageResourceId,
                    level: pendingSave.level,
                    pinned: pendingSave.pinned,
                    notice,
                    requestedAt,
                };
                setPendingReview(review);
                setReconciliationSummary("");
                writeAnnouncementPendingReview(review);
                setListRefreshNonce((value) => value + 1);
                message.warning({ content: "公告发布结果待核对，系统没有自动重试。请检查完整列表后再继续。", duration: 7 });
            } else {
                message.error(detail);
            }
        } finally {
            saveInFlightRef.current = false;
            setSaving(false);
        }
    };

    const closeAnnouncement = async (announcement: SystemAnnouncement) => {
        if (closeInFlightRef.current.has(announcement.id)) return;
        if (writeBlockedRef.current) {
            message.warning("请先完成上一次公告操作的核对");
            return;
        }
        closeInFlightRef.current.add(announcement.id);
        setClosingIds((current) => new Set(current).add(announcement.id));
        let reconciliationRequired = false;
        const requestedAt = new Date().toISOString();
        try {
            const result = await closeAdminAnnouncement(announcement.id);
            assertAnnouncementMutationResult(result, "closed", announcement.id, announcement);
            message.success("公告已关闭");
        } catch (error) {
            const detail = error instanceof Error ? error.message : "关闭公告失败";
            if (isMutationResultUncertain(error)) {
                writeBlockedRef.current = true;
                reconciliationRequired = true;
                onPublishBlockedChange(true);
                setKeyword("");
                setStatus("all");
                setPage(1);
                setUncertainListReady(false);
                const notice = `上一次关闭请求的结果暂时无法确认：${detail}。系统已切换到未筛选列表，请核对该公告的最新状态。核对完成前，公告写操作已暂停。`;
                const review: AnnouncementPendingReview = {
                    operation: "close",
                    targetId: announcement.id,
                    title: announcement.title,
                    content: announcement.content,
                    level: announcement.level,
                    notice,
                    requestedAt,
                };
                setPendingReview(review);
                setReconciliationSummary("");
                writeAnnouncementPendingReview(review);
                setListRefreshNonce((value) => value + 1);
                message.warning({ content: "公告关闭结果待核对，系统没有自动重试。", duration: 7 });
            } else message.error(detail);
        } finally {
            if (!reconciliationRequired) setListRefreshNonce((value) => value + 1);
            closeInFlightRef.current.delete(announcement.id);
            setClosingIds((current) => {
                const next = new Set(current);
                next.delete(announcement.id);
                return next;
            });
        }
    };

    const columns: ColumnsType<SystemAnnouncement> = [
        {
            title: "公告",
            dataIndex: "title",
            width: 390,
            render: (_, announcement) => (
                <div className="flex min-w-0 items-center gap-3 py-0.5">
                    {announcement.imageUrl ? <img src={announcementImageUrl(announcement)} alt="" loading="lazy" decoding="async" className="size-12 shrink-0 rounded-md border border-border/70 bg-muted/20 object-contain p-0.5" /> : null}
                    <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground" title={announcement.title}>
                            {announcement.title}
                        </div>
                        <AnnouncementContent content={announcement.content} className="admin-announcement-list-content mt-1 text-xs leading-5 text-foreground/50" />
                    </div>
                </div>
            ),
        },
        {
            title: "展示",
            dataIndex: "pinned",
            width: 90,
            align: "center",
            render: (pinned: boolean) => (pinned ? <AdminStatusBadge label="置顶" tone="warning" /> : <span className="text-xs text-foreground/35">普通</span>),
        },
        {
            title: "类型",
            dataIndex: "level",
            width: 105,
            align: "center",
            render: renderAnnouncementLevel,
        },
        {
            title: "发布状态",
            width: 225,
            align: "center",
            render: (_, announcement) => <AnnouncementLifecycle announcement={announcement} />,
        },
        {
            title: "操作",
            key: "actions",
            width: 200,
            align: "center",
            render: (_, announcement) => (
                <div className="flex justify-center">
                    <AdminRowActions
                        primary={{
                            label: !isKnownAnnouncementStatus(announcement.status) ? "状态待核对" : announcement.status === "closed" ? "重新发布" : "编辑发布",
                            icon: announcement.status === "closed" ? <RefreshCw className="size-3.5" /> : <PencilLine className="size-3.5" />,
                            disabled: publishBlocked || closingIds.has(announcement.id) || !isKnownAnnouncementStatus(announcement.status),
                            onClick: () => openEditDrawer(announcement),
                        }}
                        actions={
                            announcement.status === "active"
                                ? [
                                      {
                                          key: "close",
                                          label: "关闭公告",
                                          danger: true,
                                          disabled: publishBlocked || closingIds.has(announcement.id),
                                          confirm: {
                                              title: `关闭“${announcement.title}”？`,
                                              description: "关闭后服务端将不再下发该公告；已打开的页面会在下一次同步后移除（通常 5 分钟内），历史记录仍会保留。",
                                              okText: "确认关闭",
                                          },
                                          onClick: () => closeAnnouncement(announcement),
                                      },
                                  ]
                                : []
                        }
                    />
                </div>
            ),
        },
    ];
    const hasFilters = Boolean(keyword.trim() || status !== "all");

    return (
        <div className="admin-announcements flex min-h-0 flex-1 flex-col">
            {pendingReview ? (
                <div className="admin-announcement-uncertain-notice" role="alert">
                    <div className="admin-announcement-uncertain-copy">
                        <strong>公告结果待核对</strong>
                        <p>{pendingReview.notice}</p>
                        <dl className="admin-announcement-review-target">
                            <div>
                                <dt>待核对操作</dt>
                                <dd>{formatPendingReviewOperation(pendingReview.operation)}</dd>
                            </div>
                            <div>
                                <dt>公告标题</dt>
                                <dd>{pendingReview.title}</dd>
                            </div>
                            <div>
                                <dt>目标 ID</dt>
                                <dd>{pendingReview.targetId || "新公告（响应中未取得 ID）"}</dd>
                            </div>
                            <div>
                                <dt>请求时间</dt>
                                <dd>{formatDateTime(pendingReview.requestedAt)}</dd>
                            </div>
                            <div className="is-wide">
                                <dt>请求正文</dt>
                                <dd>
                                    <AnnouncementContent content={pendingReview.content} className="admin-announcement-review-content" />
                                </dd>
                            </div>
                            <div className="is-wide" aria-live="polite">
                                <dt>自动定位结果</dt>
                                <dd>{reconciliationSummary || "刷新完整列表后将自动定位待核对记录。"}</dd>
                            </div>
                        </dl>
                    </div>
                    <div className="admin-announcement-uncertain-actions">
                        <Button
                            loading={loading || reconciliationLoading}
                            onClick={() => {
                                setKeyword("");
                                setStatus("all");
                                setPage(1);
                                setUncertainListReady(false);
                                setReconciliationSummary("");
                                setListRefreshNonce((value) => value + 1);
                            }}
                        >
                            刷新完整列表
                        </Button>
                        <Button
                            type="primary"
                            disabled={!uncertainListReady || loading || reconciliationLoading}
                            onClick={() => {
                                setPendingReview(null);
                                setUncertainListReady(false);
                                setReconciliationSummary("");
                                clearAnnouncementPendingReview();
                                onPublishBlockedChange(false);
                                message.success("已恢复公告发布操作");
                            }}
                        >
                            我已核对，恢复发布
                        </Button>
                    </div>
                </div>
            ) : null}

            <section className="flex min-h-0 flex-1" aria-label="系统公告列表">
                <AdminDataTable
                    toolbar={
                        <Input
                            allowClear
                            disabled={publishBlocked}
                            aria-label="搜索系统公告"
                            className="app-list-search"
                            prefix={<Search className="size-4 text-foreground/40" />}
                            value={keyword}
                            placeholder="搜索公告标题或正文"
                            onChange={(event) => {
                                setKeyword(event.target.value);
                                setPage(1);
                            }}
                        />
                    }
                    toolbarActive={hasFilters}
                    toolbarFilters={
                        <Select<"all" | AnnouncementStatus>
                            aria-label="按公告状态筛选"
                            className="admin-announcement-status-filter w-32"
                            disabled={publishBlocked}
                            value={status}
                            onChange={(value) => {
                                setStatus(value);
                                setPage(1);
                            }}
                            options={[
                                { label: "全部状态", value: "all" },
                                { label: "发布中", value: "active" },
                                { label: "已关闭", value: "closed" },
                            ]}
                        />
                    }
                    onReset={() => {
                        setKeyword("");
                        setStatus("all");
                        setPage(1);
                    }}
                    trailing={
                        <Button
                            type="text"
                            size="small"
                            icon={<RefreshCw className="size-3.5" />}
                            loading={loading || reconciliationLoading}
                            onClick={() => {
                                if (publishBlocked) {
                                    setUncertainListReady(false);
                                    setReconciliationSummary("");
                                    setListRefreshNonce((value) => value + 1);
                                } else void reload();
                            }}
                        >
                            刷新
                        </Button>
                    }
                    table={{ rowKey: "id", size: "small", loading, pagination: false, columns, dataSource: announcements }}
                    empty={
                        <AdminTableEmpty
                            filtered={hasFilters}
                            title={listError ? "公告读取失败" : !hasFilters ? "暂无系统公告" : undefined}
                            description={listError || (!hasFilters ? "发布后的公告会在这里展示状态和历史记录。" : undefined)}
                            action={
                                !listError && !hasFilters && !publishBlocked ? (
                                    <Button
                                        type="primary"
                                        icon={<Plus className="size-4" />}
                                        onClick={(event) => {
                                            editorReturnFocusRef.current = event.currentTarget;
                                            onPublishOpenChange(true);
                                        }}
                                    >
                                        发布首条公告
                                    </Button>
                                ) : undefined
                            }
                        />
                    }
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
            </section>

            <AnnouncementEditor
                open={editorOpen}
                editingAnnouncement={editingAnnouncement}
                form={form}
                pending={pendingSave}
                saving={saving}
                publishBlocked={publishBlocked}
                returnFocusElement={editorReturnFocusRef.current || publishReturnFocus}
                watchedTitle={watchedTitle}
                watchedContent={watchedContent}
                watchedLevel={watchedLevel}
                watchedPinned={watchedPinned}
                imagePreviewUrl={imagePreviewUrl}
                imageUploading={imageUploading}
                imageInputRef={imageInputRef}
                onClose={closeEditor}
                onPreview={previewSave}
                onPendingChange={setPendingSave}
                onUploadImage={uploadAnnouncementImage}
                onClearImage={() => void clearAnnouncementImage()}
                onConfirm={() => void saveAnnouncement()}
            />
        </div>
    );
}

function AnnouncementEditor({
    open,
    editingAnnouncement,
    form,
    pending,
    saving,
    publishBlocked,
    returnFocusElement,
    watchedTitle,
    watchedContent,
    watchedLevel,
    watchedPinned,
    imagePreviewUrl,
    imageUploading,
    imageInputRef,
    onClose,
    onPreview,
    onPendingChange,
    onUploadImage,
    onClearImage,
    onConfirm,
}: {
    open: boolean;
    editingAnnouncement: SystemAnnouncement | null;
    form: ReturnType<typeof Form.useForm<AnnouncementFormValues>>[0];
    pending: PendingAnnouncement | null;
    saving: boolean;
    publishBlocked: boolean;
    returnFocusElement: HTMLElement | null;
    watchedTitle?: string;
    watchedContent?: string;
    watchedLevel?: AnnouncementLevel;
    watchedPinned?: boolean;
    imagePreviewUrl: string;
    imageUploading: boolean;
    imageInputRef: { current: HTMLInputElement | null };
    onClose: () => void;
    onPreview: (values: AnnouncementFormValues) => void;
    onPendingChange: (pending: PendingAnnouncement | null) => void;
    onUploadImage: (event: ChangeEvent<HTMLInputElement>) => void;
    onClearImage: () => void;
    onConfirm: () => void;
}) {
    const previewMeta = levelMeta[watchedLevel || "info"] || levelMeta.info;
    const titleInputRef = useRef<InputRef>(null);
    const activeOverlay = pending ? "confirm" : open ? "editor" : null;
    useAnnouncementOverlayFocus(activeOverlay, titleInputRef, returnFocusElement);
    return (
        <>
            <Modal
                title={editingAnnouncement ? "编辑并重新发布公告" : "发布系统公告"}
                open={open && !pending}
                centered
                width="min(1120px, calc(100vw - 32px))"
                onCancel={onClose}
                rootClassName="admin-modal-root admin-announcement-editor-modal"
                forceRender
                afterOpenChange={(isOpen) => {
                    if (!isOpen) return;
                    document.querySelector<HTMLElement>(".admin-announcement-editor-modal .ant-modal-body")?.scrollTo({ top: 0 });
                    titleInputRef.current?.focus({ cursor: "end" });
                }}
                mask={{ closable: !saving && !pending }}
                keyboard={!saving && !pending}
                closable={!saving && !pending}
                footer={
                    <div className="flex justify-end gap-2">
                        <Button disabled={saving || imageUploading || Boolean(pending)} onClick={onClose}>
                            取消
                        </Button>
                        <Button type="primary" loading={saving} disabled={publishBlocked || imageUploading || Boolean(pending)} icon={<Send className="size-4" />} onClick={() => form.submit()}>
                            核对并继续
                        </Button>
                    </div>
                }
                styles={{ body: { maxHeight: "calc(100vh - 190px)", overflowY: "auto" } }}
            >
                <div className={`admin-announcement-editor-intro${editingAnnouncement ? " is-warning" : ""}`}>
                    <strong>{editingAnnouncement ? "保存会重新向全体用户发布" : "发布成功后会进入用户公告中心"}</strong>
                    <p>{editingAnnouncement ? "无论当前公告是否已关闭，保存都会刷新发布时间、恢复为发布中，并清除所有用户的旧已读状态。" : "已打开的页面会在下一次同步后看到（通常 5 分钟内）；请写清影响范围、所需操作和预计恢复时间。"}</p>
                </div>
                <Form form={form} layout="vertical" requiredMark={false} disabled={publishBlocked} initialValues={DEFAULT_ANNOUNCEMENT} scrollToFirstError={{ focus: true, block: "center" }} onFinish={onPreview}>
                    <div className="admin-announcement-editor-layout">
                        <section className="admin-announcement-editor-section">
                            <div className="admin-announcement-editor-section-heading">
                                <h2>公告内容</h2>
                                <p>支持换行以及链接、强调、列表等受控 HTML；Markdown 不会被解析。</p>
                            </div>
                            <div className="admin-announcement-form-grid">
                                <Form.Item
                                    name="title"
                                    label="公告标题"
                                    rules={[
                                        { required: true, whitespace: true, message: "请填写公告标题" },
                                        { max: 120, message: "标题不能超过 120 个字符" },
                                    ]}
                                >
                                    <Input ref={titleInputRef} maxLength={120} showCount placeholder="例如：视频模型已恢复正常使用" />
                                </Form.Item>
                                <Form.Item name="level" label="公告类型" extra={previewMeta.guidance} rules={[{ required: true, message: "请选择公告类型" }]}>
                                    <Select aria-label="选择公告类型" options={levelOptions} />
                                </Form.Item>
                            </div>
                            <Form.Item name="pinned" label="展示方式" valuePropName="checked" extra="置顶公告会优先于普通公告展示。">
                                <Switch checkedChildren="置顶" unCheckedChildren="普通" />
                            </Form.Item>
                            <Form.Item name="imageResourceId" hidden>
                                <Input />
                            </Form.Item>
                            <Form.Item label="公告配图" extra="可选，图片文件不超过 10MB；取消、替换或移除时会回收未发布草稿。">
                                <div className="space-y-2">
                                    {imagePreviewUrl ? (
                                        <div className="relative flex min-h-28 items-center justify-center overflow-hidden rounded-md border border-border/70 bg-muted/20 p-2">
                                            <img src={imagePreviewUrl} alt="公告配图预览" className="max-h-44 w-full object-contain" />
                                            <Button
                                                type="text"
                                                size="small"
                                                danger
                                                disabled={imageUploading}
                                                icon={<X className="size-3.5" />}
                                                className="!absolute right-1 top-1 !size-7 !min-w-7 !p-0"
                                                onClick={onClearImage}
                                                aria-label="移除公告配图"
                                                title="移除公告配图"
                                            />
                                        </div>
                                    ) : (
                                        <div className="flex min-h-24 items-center justify-center rounded-md border border-dashed border-border/80 bg-muted/10 text-xs text-foreground/45">暂未添加配图</div>
                                    )}
                                    <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={onUploadImage} />
                                    <Button icon={<Upload className="size-3.5" />} loading={imageUploading} onClick={() => imageInputRef.current?.click()}>
                                        {imagePreviewUrl ? "更换配图" : "上传配图"}
                                    </Button>
                                </div>
                            </Form.Item>
                            <Form.Item
                                name="content"
                                label="公告正文"
                                rules={[
                                    { required: true, whitespace: true, message: "请填写公告正文" },
                                    { max: 4000, message: "正文不能超过 4000 个字符" },
                                ]}
                            >
                                <Input.TextArea maxLength={4000} showCount autoSize={{ minRows: 14, maxRows: 24 }} placeholder="填写服务状态、影响范围和用户需要采取的操作" />
                            </Form.Item>
                        </section>

                        <section className="admin-announcement-preview" data-level={watchedLevel || "info"} aria-label="用户端公告预览">
                            <div className="admin-announcement-preview-heading">
                                <span>用户端预览</span>
                                <div className="flex items-center gap-2">
                                    <AdminStatusBadge label={previewMeta.label} tone={previewMeta.tone} />
                                    {watchedPinned ? (
                                        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-500">
                                            <Pin className="size-3" />
                                            置顶
                                        </span>
                                    ) : null}
                                </div>
                            </div>
                            <h3>{watchedTitle?.trim() || "公告标题将在这里显示"}</h3>
                            {imagePreviewUrl ? <img src={imagePreviewUrl} alt="公告配图预览" className="mt-4 max-h-56 w-full rounded-lg border border-border/70 bg-muted/20 object-contain p-1" /> : null}
                            {watchedContent?.trim() ? <AnnouncementContent content={watchedContent.trim()} className="admin-announcement-preview-content" /> : <p className="admin-announcement-preview-placeholder">公告正文将在这里显示。</p>}
                        </section>
                    </div>
                </Form>
            </Modal>

            <Modal
                title={pending?.mode === "update" ? "确认编辑并重新发布" : "确认发布系统公告"}
                open={Boolean(pending)}
                okText={pending?.mode === "update" ? "确认重新发布" : "确认发布"}
                cancelText="返回修改"
                onCancel={() => {
                    if (!saving) onPendingChange(null);
                }}
                onOk={onConfirm}
                confirmLoading={saving}
                mask={{ closable: !saving }}
                closable={!saving}
                keyboard={!saving}
                destroyOnHidden
                rootClassName="admin-modal-root admin-announcement-confirm-modal"
                okButtonProps={{ danger: pending?.level === "critical", disabled: publishBlocked }}
            >
                {pending ? (
                    <div className="admin-operation-confirmation">
                        <p className="admin-operation-confirmation-copy">
                            {pending.mode === "update"
                                ? `这会把公告重新置为发布中、刷新发布时间，并清除所有用户对 ${formatDateTime(pending.previousPublishedAt)} 版本的已读记录。`
                                : "确认后公告会进入所有用户的公告中心并计入未读提醒；已打开的页面会在下一次同步后看到（通常 5 分钟内）。"}
                        </p>
                        <dl className="admin-operation-confirmation-grid">
                            <div>
                                <dt>操作</dt>
                                <dd>{pending.mode === "update" ? (pending.previousStatus === "closed" ? "重新开启并发布" : "更新并重新发布") : "发布新公告"}</dd>
                            </div>
                            <div>
                                <dt>公告类型</dt>
                                <dd>{(levelMeta[pending.level] || levelMeta.info).label}</dd>
                            </div>
                            <div>
                                <dt>展示方式</dt>
                                <dd>{pending.pinned ? "置顶" : "普通"}</dd>
                            </div>
                            <div>
                                <dt>公告配图</dt>
                                <dd>{pending.imageResourceId ? "已配置" : "无配图"}</dd>
                            </div>
                            <div className="is-wide">
                                <dt>公告标题</dt>
                                <dd>{pending.title}</dd>
                            </div>
                            <div className="is-wide">
                                <dt>公告正文</dt>
                                <dd>
                                    <AnnouncementContent content={pending.content} className="admin-announcement-confirm-content" />
                                </dd>
                            </div>
                        </dl>
                    </div>
                ) : null}
            </Modal>
        </>
    );
}

function useAnnouncementOverlayFocus(activeOverlay: "editor" | "confirm" | null, titleInputRef: { current: InputRef | null }, returnFocusElement: HTMLElement | null) {
    const previousOverlayRef = useRef<typeof activeOverlay>(null);
    const returnFocusRef = useRef<HTMLElement | null>(returnFocusElement);
    if (returnFocusElement) returnFocusRef.current = returnFocusElement;

    useEffect(() => {
        const previousOverlay = previousOverlayRef.current;
        previousOverlayRef.current = activeOverlay;
        if (!activeOverlay) {
            if (!previousOverlay) return;
            const restoreFocus = () => {
                const activeElement = document.activeElement;
                if (activeElement === document.body || activeElement === null || activeElement?.closest(".admin-announcement-editor-modal, .admin-announcement-confirm-modal")) resolveAnnouncementReturnFocus(returnFocusRef.current)?.focus();
            };
            const frame = window.requestAnimationFrame(restoreFocus);
            const transitionFallback = window.setTimeout(restoreFocus, 360);
            return () => {
                window.cancelAnimationFrame(frame);
                window.clearTimeout(transitionFallback);
            };
        }

        const selector = activeOverlay === "confirm" ? ".admin-announcement-confirm-modal" : ".admin-announcement-editor-modal";
        const focusOverlay = () => {
            const root = findVisibleOverlay(selector);
            if (!root) return;
            if (activeOverlay === "editor") {
                root.querySelector<HTMLElement>(".ant-modal-body")?.scrollTo({ top: 0 });
                titleInputRef.current?.focus({ cursor: "end" });
                return;
            }
            if (!root.contains(document.activeElement)) getOverlayFocusableElements(root)[0]?.focus();
        };
        const frame = window.requestAnimationFrame(focusOverlay);
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Tab") return;
            const root = findVisibleOverlay(selector);
            if (!root) return;
            const focusableElements = getOverlayFocusableElements(root);
            if (!focusableElements.length) {
                event.preventDefault();
                root.focus();
                return;
            }
            const activeElement = document.activeElement as HTMLElement | null;
            const currentIndex = activeElement ? focusableElements.indexOf(activeElement) : -1;
            if (event.shiftKey && currentIndex <= 0) {
                event.preventDefault();
                focusableElements[focusableElements.length - 1]?.focus();
            } else if (!event.shiftKey && (currentIndex < 0 || currentIndex === focusableElements.length - 1)) {
                event.preventDefault();
                focusableElements[0]?.focus();
            }
        };
        document.addEventListener("keydown", handleKeyDown, true);
        return () => {
            window.cancelAnimationFrame(frame);
            document.removeEventListener("keydown", handleKeyDown, true);
        };
    }, [activeOverlay, titleInputRef]);
}

function resolveAnnouncementReturnFocus(preferred: HTMLElement | null) {
    if (preferred?.isConnected && !(preferred instanceof HTMLButtonElement && preferred.disabled)) return preferred;
    const publishTrigger = document.getElementById("admin-announcement-publish-trigger");
    if (publishTrigger instanceof HTMLElement && !(publishTrigger instanceof HTMLButtonElement && publishTrigger.disabled)) return publishTrigger;
    return document.querySelector<HTMLElement>(".admin-announcement-uncertain-actions button:not(:disabled)");
}

function findVisibleOverlay(selector: string) {
    return Array.from(document.querySelectorAll<HTMLElement>(selector)).find((element) => element.getClientRects().length > 0) || null;
}

function getOverlayFocusableElements(root: HTMLElement) {
    const selector = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter((element) => {
        if (element.getAttribute("aria-hidden") === "true" || element.closest('[aria-hidden="true"]')) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 1 && rect.height > 1 && window.getComputedStyle(element).visibility !== "hidden";
    });
}

function AnnouncementLifecycle({ announcement }: { announcement: SystemAnnouncement }) {
    const active = announcement.status === "active";
    const closed = announcement.status === "closed";
    return (
        <div className="admin-announcement-lifecycle">
            <AdminStatusBadge label={active ? "发布中" : closed ? "已关闭" : "未知状态"} tone={active ? "success" : "neutral"} />
            <span>发布 {formatDateTime(announcement.publishedAt)}</span>
            {closed ? <span>关闭 {formatDateTime(announcement.closedAt)}</span> : null}
        </div>
    );
}

function renderAnnouncementLevel(level: AnnouncementLevel) {
    const meta = levelMeta[level] || levelMeta.info;
    return <AdminStatusBadge label={meta.label} tone={meta.tone} />;
}

function isMutationResultUncertain(error: unknown) {
    if (!(error instanceof ApiError)) return true;
    return error.status === undefined || error.retryable || error.status >= 500;
}

function assertAnnouncementMutationResult(
    result: unknown,
    expectedStatus: AnnouncementStatus,
    expectedId: string | undefined,
    expectedContent: Pick<SystemAnnouncement, "title" | "content" | "level" | "pinned"> & Pick<Partial<SystemAnnouncement>, "imageResourceId">,
) {
    const announcement = (result as { announcement?: Partial<SystemAnnouncement> } | null)?.announcement;
    const publishedAt = announcement?.publishedAt;
    const closedAt = announcement?.closedAt;
    const validPublishedAt = typeof publishedAt === "string" && !Number.isNaN(new Date(publishedAt).getTime());
    const validClosedAt = expectedStatus === "closed" ? typeof closedAt === "string" && !Number.isNaN(new Date(closedAt).getTime()) : closedAt === null || closedAt === undefined;
    const contentMatches =
        announcement?.title === expectedContent.title &&
        announcement?.content === expectedContent.content &&
        announcement?.level === expectedContent.level &&
        announcement?.pinned === expectedContent.pinned &&
        (announcement?.imageResourceId || "") === (expectedContent.imageResourceId || "");
    if (!announcement || typeof announcement.id !== "string" || !announcement.id || (expectedId && announcement.id !== expectedId) || announcement.status !== expectedStatus || !validPublishedAt || !validClosedAt || !contentMatches) {
        throw new Error("服务返回的公告状态不完整，无法确认操作结果");
    }
}

function assertAnnouncementListResult(result: unknown, expectedPage: number, expectedLimit: number) {
    if (!isRecord(result) || !Array.isArray(result.announcements) || !Number.isInteger(result.total) || (result.total as number) < 0 || result.page !== expectedPage || result.limit !== expectedLimit) {
        throw new Error("公告列表返回格式不完整");
    }
    const announcements = result.announcements.map((value) => normalizeAnnouncementListItem(value));
    if ((result.total as number) < announcements.length) throw new Error("公告列表总数与当前页数据不一致");
    return { announcements, total: result.total as number, page: expectedPage, limit: expectedLimit };
}

function normalizeAnnouncementListItem(value: unknown): SystemAnnouncement {
    if (
        !isRecord(value) ||
        typeof value.id !== "string" ||
        !value.id ||
        typeof value.title !== "string" ||
        typeof value.content !== "string" ||
        !isKnownAnnouncementLevel(value.level) ||
        !isKnownAnnouncementStatus(value.status) ||
        typeof value.pinned !== "boolean" ||
        (value.imageResourceId !== null && value.imageResourceId !== undefined && typeof value.imageResourceId !== "string") ||
        (value.imageUrl !== null && value.imageUrl !== undefined && typeof value.imageUrl !== "string") ||
        typeof value.createdBy !== "string" ||
        !isValidDateTimeString(value.publishedAt) ||
        !isValidDateTimeString(value.createdAt) ||
        !isValidDateTimeString(value.updatedAt) ||
        (value.closedAt !== null && value.closedAt !== undefined && !isValidDateTimeString(value.closedAt))
    ) {
        throw new Error("公告列表包含无法识别的记录");
    }
    return {
        id: value.id,
        title: value.title,
        content: value.content,
        imageResourceId: typeof value.imageResourceId === "string" ? value.imageResourceId : undefined,
        imageUrl: typeof value.imageUrl === "string" ? value.imageUrl : undefined,
        level: value.level,
        pinned: value.pinned,
        status: value.status,
        createdBy: value.createdBy,
        publishedAt: value.publishedAt as string,
        closedAt: typeof value.closedAt === "string" ? value.closedAt : undefined,
        createdAt: value.createdAt as string,
        updatedAt: value.updatedAt as string,
    };
}

async function inspectPendingReview(review: AnnouncementPendingReview) {
    const queryTitles = Array.from(new Set([review.title, review.previousTitle].filter((value): value is string => Boolean(value?.trim()))));
    const candidates = new Map<string, SystemAnnouncement>();
    for (const title of queryTitles) {
        let targetPage = 1;
        while (targetPage <= 50) {
            const data = assertAnnouncementListResult(await listAdminAnnouncements({ keyword: title, page: targetPage, limit: 100 }), targetPage, 100);
            data.announcements.forEach((announcement) => candidates.set(announcement.id, announcement));
            if (targetPage >= Math.max(1, Math.ceil(data.total / data.limit))) break;
            if (targetPage === 50) throw new Error("同名匹配记录过多，无法安全定位目标；请稍后重试。");
            targetPage += 1;
        }
    }

    const records = Array.from(candidates.values());
    if (review.targetId) {
        const target = records.find((announcement) => announcement.id === review.targetId);
        if (!target) return `按请求前后标题检索后，未找到目标 ID ${review.targetId}。该请求可能未生效，请结合完整列表再人工确认。`;
        const contentMatches =
            target.title === review.title &&
            target.content === review.content &&
            target.level === review.level &&
            (review.pinned === undefined || target.pinned === review.pinned) &&
            (review.imageResourceId === undefined || (target.imageResourceId || "") === review.imageResourceId);
        const expectedStatus: AnnouncementStatus = review.operation === "close" ? "closed" : "active";
        const statusMatches = target.status === expectedStatus;
        return `已定位目标 ID ${target.id}：当前为${target.status === "active" ? "发布中" : "已关闭"}，标题、正文与类型${contentMatches ? "与请求一致" : "与请求不一致"}，${statusMatches ? "状态符合预期" : "状态不符合预期"}。`;
    }

    const requestedAt = new Date(review.requestedAt).getTime();
    const matchingRecords = records.filter(
        (announcement) =>
            announcement.title === review.title &&
            announcement.content === review.content &&
            announcement.level === review.level &&
            (review.pinned === undefined || announcement.pinned === review.pinned) &&
            (review.imageResourceId === undefined || (announcement.imageResourceId || "") === review.imageResourceId) &&
            new Date(announcement.publishedAt).getTime() >= requestedAt - 5 * 60_000,
    );
    if (!matchingRecords.length) return "未找到请求时间附近与标题、正文和类型完全一致的新公告；该发布请求可能未生效。";
    const resultSummary = matchingRecords
        .slice(0, 3)
        .map((announcement) => `${announcement.id} · ${formatDateTime(announcement.publishedAt)} · ${announcement.status === "active" ? "发布中" : "已关闭"}`)
        .join("；");
    return `找到 ${matchingRecords.length} 条与请求内容完全一致的近期记录：${resultSummary}${matchingRecords.length > 3 ? "；其余记录请在列表中核对" : ""}。`;
}

function formatPendingReviewOperation(operation: AnnouncementPendingReview["operation"]) {
    if (operation === "create") return "发布新公告";
    if (operation === "update") return "编辑并重新发布";
    return "关闭公告";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object";
}

function isValidDateTimeString(value: unknown): value is string {
    return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

function isKnownAnnouncementLevel(value: unknown): value is AnnouncementLevel {
    return value === "info" || value === "success" || value === "warning" || value === "critical";
}

function isKnownAnnouncementStatus(value: unknown): value is AnnouncementStatus {
    return value === "active" || value === "closed";
}

function formatDateTime(value?: string | null) {
    if (!value) return "--";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "--";
    return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date).replaceAll("/", "-");
}
