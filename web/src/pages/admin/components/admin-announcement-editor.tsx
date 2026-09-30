// 公告编辑器与弹层焦点管理（打开时锁定焦点，关闭后还原到触发元素）。

import { type AnnouncementLevel, type SystemAnnouncement } from "@/services/api/announcements";
import { Button, Form, Input, type InputRef, Modal } from "antd";
import { type ChangeEvent, useEffect, useRef } from "react";
import { Pin, Send, Upload, X } from "lucide-react";
import { Select } from "@/components/ui/base/select";
import { Switch } from "@/pages/admin/ui/controls";
import { AdminStatusBadge } from "./admin-ui";
import { AnnouncementContent } from "@/components/ui/announcement-content";
import { type AnnouncementFormValues, DEFAULT_ANNOUNCEMENT, type PendingAnnouncement, formatDateTime, levelMeta, levelOptions } from "./admin-announcement-results";

export function AnnouncementEditor({
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
                            <Form.Item name="content" label="公告正文（可选）" rules={[{ max: 4000, message: "正文不能超过 4000 个字符" }]}>
                                <Input.TextArea maxLength={4000} showCount autoSize={{ minRows: 14, maxRows: 24 }} placeholder="可选填写服务状态、影响范围和用户需要采取的操作" />
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
                            {watchedContent?.trim() ? <AnnouncementContent content={watchedContent.trim()} className="admin-announcement-preview-content" /> : <p className="admin-announcement-preview-placeholder">此公告仅展示标题。</p>}
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
                                <dd>{pending.content ? <AnnouncementContent content={pending.content} className="admin-announcement-confirm-content" /> : "无正文"}</dd>
                            </div>
                        </dl>
                    </div>
                ) : null}
            </Modal>
        </>
    );
}

export function useAnnouncementOverlayFocus(activeOverlay: "editor" | "confirm" | null, titleInputRef: { current: InputRef | null }, returnFocusElement: HTMLElement | null) {
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

export function resolveAnnouncementReturnFocus(preferred: HTMLElement | null) {
    if (preferred?.isConnected && !(preferred instanceof HTMLButtonElement && preferred.disabled)) return preferred;
    const publishTrigger = document.getElementById("admin-announcement-publish-trigger");
    if (publishTrigger instanceof HTMLElement && !(publishTrigger instanceof HTMLButtonElement && publishTrigger.disabled)) return publishTrigger;
    return document.querySelector<HTMLElement>(".admin-announcement-uncertain-actions button:not(:disabled)");
}

export function findVisibleOverlay(selector: string) {
    return Array.from(document.querySelectorAll<HTMLElement>(selector)).find((element) => element.getClientRects().length > 0) || null;
}

export function getOverlayFocusableElements(root: HTMLElement) {
    const selector = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter((element) => {
        if (element.getAttribute("aria-hidden") === "true" || element.closest('[aria-hidden="true"]')) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 1 && rect.height > 1 && window.getComputedStyle(element).visibility !== "hidden";
    });
}
