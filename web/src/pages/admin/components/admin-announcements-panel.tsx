import { resourceFileUrl } from "@/services/api/resources";
import { type ColumnsType } from "antd/es/table";
import { AnnouncementContent } from "@/components/ui/announcement-content";
import { RefreshCw, PencilLine, Search, Plus } from "lucide-react";
import { Select } from "@/components/ui/base/select";
import { AnnouncementEditor } from "./admin-announcement-editor";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { App, Form, Button, Input } from "antd";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
    listAdminAnnouncements,
    type AnnouncementLevel,
    type AnnouncementStatus,
    type SystemAnnouncement, discardAdminAnnouncementImage, uploadAdminAnnouncementImage, announcementImageUrl, updateAdminAnnouncement, createAdminAnnouncement, closeAdminAnnouncement } from "@/services/api/announcements";
import { readAnnouncementPendingReview, type AnnouncementPendingReview, writeAnnouncementPendingReview, clearAnnouncementPendingReview } from "./admin-announcement-safety";
import { AdminStatusBadge, AdminRowActions, AdminDataTable, AdminTableEmpty, PaginationBar } from "./admin-ui";
import { assertAnnouncementListResult, inspectPendingReview, DEFAULT_ANNOUNCEMENT, levelOptions, isKnownAnnouncementStatus, assertAnnouncementMutationResult, isMutationResultUncertain, formatPendingReviewOperation } from "./admin-announcement-results";
import { type AnnouncementFormValues, type PendingAnnouncement, formatDateTime, levelMeta } from "./admin-announcement-results";

export { type AnnouncementFormValues, DEFAULT_ANNOUNCEMENT, type PendingAnnouncement, formatDateTime, levelMeta, levelOptions } from "./admin-announcement-results";

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
                    pageSize: targetPageSize,
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
