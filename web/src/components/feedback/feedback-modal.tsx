import { useEffect, useState, useCallback, useRef, type ClipboardEvent, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { App, Button, Checkbox, Input, Tag, Image as AntImage, Segmented } from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import { Archive, Bug, CheckCircle2, Clock, Inbox, Info, Lightbulb, ListChecks, MessageSquare, MessageSquarePlus, MousePointerClick, Paperclip, Play, RefreshCw, Send, UploadCloud, X, type LucideIcon } from "lucide-react";

import { AntTooltip as Tooltip } from "@/components/ui/base/tooltip/ant-tooltip";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { AppModal } from "@/components/ui/product/app-modal";
import { submitFeedback, getMyFeedbacks, uploadFeedbackAttachment, type FeedbackItem, type FeedbackType, type FeedbackAttachment } from "@/services/api/feedback";
import { useUserStore } from "@/stores/use-user-store";
import { currentLocale } from "@/i18n";
import { cn } from "@/lib/utils";

import "./feedback-modal.css";

interface FeedbackModalProps {
    open: boolean;
    onClose: () => void;
    initialTab?: "submit" | "inbox";
}

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

type FeedbackTypeOption = {
    value: FeedbackType;
    icon: LucideIcon;
    labelKey: string;
    hintKey: string;
    /** 选中类型后展示的「写清楚这几点」清单和一键套用的模板。 */
    guide: { titleKey: string; itemKeys: string[]; templateKey: string };
    titlePlaceholderKey: string;
};

const FEEDBACK_TYPES: FeedbackTypeOption[] = [
    {
        value: "bug",
        icon: Bug,
        labelKey: "account.feedback.types.bug",
        hintKey: "account.feedback.types.bugHint",
        guide: { titleKey: "account.feedback.guide.bug.title", itemKeys: ["where", "steps", "result", "frequency"].map((key) => `account.feedback.guide.bug.${key}`), templateKey: "account.feedback.guide.bug.template" },
        titlePlaceholderKey: "account.feedback.titlePlaceholderBug",
    },
    {
        value: "feature",
        icon: Lightbulb,
        labelKey: "account.feedback.types.feature",
        hintKey: "account.feedback.types.featureHint",
        guide: { titleKey: "account.feedback.guide.feature.title", itemKeys: ["scene", "expect", "current", "priority"].map((key) => `account.feedback.guide.feature.${key}`), templateKey: "account.feedback.guide.feature.template" },
        titlePlaceholderKey: "account.feedback.titlePlaceholderFeature",
    },
    {
        value: "improvement",
        icon: MousePointerClick,
        labelKey: "account.feedback.types.improvement",
        hintKey: "account.feedback.types.improvementHint",
        guide: { titleKey: "account.feedback.guide.improvement.title", itemKeys: ["where", "problem", "expect"].map((key) => `account.feedback.guide.improvement.${key}`), templateKey: "account.feedback.guide.improvement.template" },
        titlePlaceholderKey: "account.feedback.titlePlaceholderImprovement",
    },
    {
        value: "other",
        icon: MessageSquare,
        labelKey: "account.feedback.types.otherOpinion",
        hintKey: "account.feedback.types.otherHint",
        guide: { titleKey: "account.feedback.guide.other.title", itemKeys: ["content", "related"].map((key) => `account.feedback.guide.other.${key}`), templateKey: "account.feedback.guide.other.template" },
        titlePlaceholderKey: "account.feedback.titlePlaceholderOther",
    },
];

export function FeedbackModal({ open, onClose, initialTab = "submit" }: FeedbackModalProps) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const user = useUserStore((state) => state.user);

    const [activeTab, setActiveTab] = useState<"submit" | "inbox">(initialTab);
    const [submitting, setSubmitting] = useState(false);
    const [loadingInbox, setLoadingInbox] = useState(false);
    const [myFeedbacks, setMyFeedbacks] = useState<FeedbackItem[]>([]);

    // Form fields
    const [type, setType] = useState<FeedbackType>("bug");
    const [title, setTitle] = useState("");
    const [content, setContent] = useState("");
    const [contact, setContact] = useState("");
    const [includeEnv, setIncludeEnv] = useState(true);
    const [attachments, setAttachments] = useState<FeedbackAttachment[]>([]);
    const [uploading, setUploading] = useState(false);
    const [dragging, setDragging] = useState(false);

    // Video preview modal
    const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const contentRef = useRef<TextAreaRef>(null);
    const wasOpenRef = useRef(false);

    // 每次打开时切到调用方指定的页签；联系方式只在打开那一刻预填账号邮箱，用户清空后不再被填回。
    useEffect(() => {
        const opening = open && !wasOpenRef.current;
        wasOpenRef.current = open;
        if (!opening) return;
        setActiveTab(initialTab);
        if (user?.email) setContact((current) => current || user.email || "");
    }, [open, initialTab, user]);

    // Fetch user inbox
    const fetchInbox = useCallback(async () => {
        if (!user) return;
        setLoadingInbox(true);
        try {
            const list = await getMyFeedbacks();
            setMyFeedbacks(list);
        } catch {
            // Silently handle if unauthenticated or network issue
        } finally {
            setLoadingInbox(false);
        }
    }, [user]);

    useEffect(() => {
        if (open && activeTab === "inbox") {
            void fetchInbox();
        }
    }, [open, activeTab, fetchInbox]);

    // 诊断信息只记录页面路径，不带查询参数和锚点：分享链接、邀请码等可能放在 URL 里。
    const getEnvironmentInfo = () => {
        if (typeof window === "undefined") return "{}";
        return JSON.stringify({
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            language: navigator.language,
            screen: `${window.screen.width}x${window.screen.height}`,
            viewport: `${window.innerWidth}x${window.innerHeight}`,
            currentUrl: `${window.location.origin}${window.location.pathname}`,
            pathname: window.location.pathname,
            timestamp: new Date().toISOString(),
        });
    };

    const handleUploadFiles = async (files: FileList | File[]) => {
        const fileList = Array.from(files);
        if (!fileList.length) return;

        if (attachments.length + fileList.length > MAX_ATTACHMENTS) {
            message.warning(t("account.feedback.maxAttachments"));
            return;
        }

        setUploading(true);
        try {
            let added = 0;
            for (const file of fileList) {
                if (file.size > MAX_ATTACHMENT_BYTES) {
                    message.error(t("account.feedback.fileTooLarge", { name: file.name }));
                    continue;
                }
                if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
                    message.error(t("account.feedback.fileUnsupported", { name: file.name }));
                    continue;
                }
                const res = await uploadFeedbackAttachment(file);
                setAttachments((prev) => [...prev, res]);
                added += 1;
            }
            if (added) message.success(t("account.feedback.attachmentAdded"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("account.feedback.attachmentFailed"));
        } finally {
            setUploading(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = "";
            }
        }
    };

    // 在弹窗任意位置粘贴截图都会作为附件上传。
    const handlePaste = (e: ClipboardEvent<HTMLDivElement>) => {
        if (activeTab !== "submit") return;
        const pastedFiles: File[] = [];
        for (const item of Array.from(e.clipboardData.items)) {
            if (!item.type.startsWith("image/")) continue;
            const file = item.getAsFile();
            if (file) pastedFiles.push(file);
        }
        if (pastedFiles.length > 0) {
            e.preventDefault();
            void handleUploadFiles(pastedFiles);
        }
    };

    const handleDrop = (event: DragEvent<HTMLButtonElement>) => {
        event.preventDefault();
        setDragging(false);
        if (event.dataTransfer.files.length) void handleUploadFiles(event.dataTransfer.files);
    };

    const removeAttachment = (id: string) => {
        setAttachments((prev) => prev.filter((a) => a.id !== id));
    };

    const currentType = FEEDBACK_TYPES.find((item) => item.value === type) || FEEDBACK_TYPES[0];

    // 内容为空或仍是某个未改动的模板时直接替换；已经写了内容就把模板接在后面，不覆盖用户的文字。
    const applyTemplate = () => {
        const template = t(currentType.guide.templateKey);
        const current = content.trim();
        const untouched = !current || FEEDBACK_TYPES.some((item) => t(item.guide.templateKey).trim() === current);
        setContent(untouched ? template : `${content.trimEnd()}\n\n${template}`);
        window.requestAnimationFrame(() => contentRef.current?.focus({ cursor: "end" }));
    };

    const handleSubmit = async () => {
        if (!title.trim()) {
            message.warning(t("account.feedback.titleRequired"));
            return;
        }
        if (!content.trim()) {
            message.warning(t("account.feedback.contentRequired"));
            return;
        }

        setSubmitting(true);
        try {
            await submitFeedback({
                type,
                title: title.trim(),
                content: content.trim(),
                contact: contact.trim(),
                attachments: JSON.stringify(attachments),
                environment: includeEnv ? getEnvironmentInfo() : "{}",
            });

            message.success(t("account.feedback.submitted"));
            setTitle("");
            setContent("");
            setAttachments([]);
            // 提交后切到「我的反馈」，用户能马上看到刚提交的记录。
            setActiveTab("inbox");
            void fetchInbox();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("account.feedback.submitFailed"));
        } finally {
            setSubmitting(false);
        }
    };

    const [inboxFilter, setInboxFilter] = useState<"active" | "archived">("active");

    const activeFeedbacks = myFeedbacks.filter((item) => !item.archived);
    const archivedFeedbacks = myFeedbacks.filter((item) => item.archived);
    const displayedFeedbacks = inboxFilter === "active" ? activeFeedbacks : archivedFeedbacks;
    const countWithReply = activeFeedbacks.filter((f) => Boolean(f.adminReply)).length;
    const inboxCount = activeFeedbacks.length > 0 ? activeFeedbacks.length : archivedFeedbacks.length;
    const isBug = type === "bug";

    return (
        <AppModal open={open} onCancel={onClose} footer={null} title={null} closable={false} centered destroyOnHidden={false} width="min(720px, calc(100vw - 24px))" rootClassName="feedback-modal-root" className="feedback-modal" flush>
            <div className="feedback-shell" onPaste={handlePaste}>
                <header className="feedback-header">
                    <span className="feedback-header-icon" aria-hidden="true">
                        <MessageSquarePlus />
                    </span>
                    <div className="feedback-header-copy">
                        <h2>{t("account.feedback.heading")}</h2>
                        <p>{t("account.feedback.subtitle")}</p>
                    </div>
                    <SegmentedControl
                        size="sm"
                        className="feedback-tabs"
                        ariaLabel={t("account.feedback.heading")}
                        value={activeTab}
                        onChange={setActiveTab}
                        options={[
                            { value: "submit", label: t("account.feedback.tabSubmit") },
                            {
                                value: "inbox",
                                label: (
                                    <span className="feedback-tab-label">
                                        {t("account.feedback.tabInboxShort")}
                                        {myFeedbacks.length > 0 ? <span className="feedback-tab-count">{inboxCount}</span> : null}
                                        {countWithReply > 0 && activeTab !== "inbox" ? <span className="feedback-tab-dot" aria-hidden="true" /> : null}
                                    </span>
                                ),
                            },
                        ]}
                    />
                    <button type="button" onClick={onClose} className="feedback-close" aria-label={t("common.close")}>
                        <X />
                    </button>
                </header>

                <div className="feedback-body">
                    {activeTab === "submit" ? (
                        <div className="feedback-form">
                            <section className="feedback-field">
                                <span className="feedback-label" id="feedback-type-label">
                                    {t("account.feedback.type")}
                                </span>
                                <div className="feedback-types" role="radiogroup" aria-labelledby="feedback-type-label">
                                    {FEEDBACK_TYPES.map((item) => {
                                        const Icon = item.icon;
                                        const selected = type === item.value;
                                        return (
                                            <button key={item.value} type="button" role="radio" aria-checked={selected} className="feedback-type" onClick={() => setType(item.value)}>
                                                <span className="feedback-type-icon" aria-hidden="true">
                                                    <Icon />
                                                </span>
                                                <span className="feedback-type-copy">
                                                    <strong>{t(item.labelKey)}</strong>
                                                    <span>{t(item.hintKey)}</span>
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </section>

                            {/* 按类型告诉用户要写哪些信息；模板一键填进详细说明。 */}
                            <section className="feedback-guide" aria-live="polite">
                                <div className="feedback-guide-head">
                                    <ListChecks aria-hidden="true" />
                                    <strong>{t(currentType.guide.titleKey)}</strong>
                                    <button type="button" className="feedback-guide-action" onClick={applyTemplate}>
                                        {t("account.feedback.guide.useTemplate")}
                                    </button>
                                </div>
                                <ol className="feedback-guide-list">
                                    {currentType.guide.itemKeys.map((key) => (
                                        <li key={key}>{t(key)}</li>
                                    ))}
                                </ol>
                            </section>

                            <label className="feedback-field">
                                <span className="feedback-label">
                                    {t("account.feedback.titleLabel")}
                                    <em aria-hidden="true">*</em>
                                </span>
                                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t(currentType.titlePlaceholderKey)} maxLength={200} aria-required="true" />
                            </label>

                            <label className="feedback-field">
                                <span className="feedback-label">
                                    {t("account.feedback.contentLabel")}
                                    <em aria-hidden="true">*</em>
                                </span>
                                <Input.TextArea
                                    ref={contentRef}
                                    value={content}
                                    onChange={(e) => setContent(e.target.value)}
                                    autoSize={{ minRows: 5, maxRows: 12 }}
                                    placeholder={isBug ? t("account.feedback.contentPlaceholderBug") : t("account.feedback.contentPlaceholder")}
                                    maxLength={10000}
                                    aria-required="true"
                                />
                            </label>

                            <section className="feedback-field">
                                <span className="feedback-label">
                                    {t("account.feedback.attachments", { count: attachments.length, max: MAX_ATTACHMENTS })}
                                    <span className="feedback-label-note">{isBug ? t("account.feedback.attachmentHintBug") : t("account.feedback.attachmentHint")}</span>
                                </span>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    multiple
                                    accept="image/*,video/*"
                                    hidden
                                    onChange={(e) => {
                                        if (e.target.files) void handleUploadFiles(e.target.files);
                                    }}
                                />
                                <div className="feedback-attachments">
                                    {attachments.map((att) => (
                                        <div key={att.id} className="feedback-attachment" title={att.name}>
                                            {att.type === "image" ? (
                                                <AntImage src={att.url} alt={att.name} rootClassName="feedback-attachment-media" preview={{ mask: t("account.feedback.preview") }} />
                                            ) : (
                                                <button type="button" className="feedback-attachment-media is-video" onClick={() => setPreviewVideoUrl(att.url)} aria-label={t("account.feedback.previewVideo")}>
                                                    <Play aria-hidden="true" />
                                                </button>
                                            )}
                                            <span className="feedback-attachment-size">{(att.size / (1024 * 1024)).toFixed(1)} MB</span>
                                            <button type="button" className="feedback-attachment-remove" onClick={() => removeAttachment(att.id)} aria-label={t("account.feedback.removeAttachment")} title={t("account.feedback.removeAttachment")}>
                                                <X aria-hidden="true" />
                                            </button>
                                        </div>
                                    ))}
                                    {attachments.length < MAX_ATTACHMENTS ? (
                                        <button
                                            type="button"
                                            className="feedback-dropzone"
                                            data-dragging={dragging || undefined}
                                            data-compact={attachments.length > 0 || undefined}
                                            disabled={uploading}
                                            aria-busy={uploading}
                                            onClick={() => fileInputRef.current?.click()}
                                            onDragOver={(event) => {
                                                event.preventDefault();
                                                setDragging(true);
                                            }}
                                            onDragLeave={() => setDragging(false)}
                                            onDrop={handleDrop}
                                        >
                                            <UploadCloud aria-hidden="true" />
                                            <span className="feedback-dropzone-copy">
                                                <strong>{uploading ? t("account.feedback.uploading") : t("account.feedback.uploadHint")}</strong>
                                                <span>{t("account.feedback.maxFileSize")}</span>
                                            </span>
                                        </button>
                                    ) : null}
                                </div>
                            </section>

                            <label className="feedback-field">
                                <span className="feedback-label">
                                    {t("account.feedback.contact")}
                                    <span className="feedback-label-note">{t("account.feedback.contactHelp")}</span>
                                </span>
                                <Input value={contact} onChange={(e) => setContact(e.target.value)} placeholder={t("account.feedback.contactPlaceholder")} maxLength={200} />
                            </label>
                        </div>
                    ) : (
                        /* Inbox View */
                        <div className="space-y-3">
                            <div className="flex items-center justify-between pb-1 flex-wrap gap-2">
                                <Segmented
                                    size="small"
                                    value={inboxFilter}
                                    onChange={(v) => setInboxFilter(v as "active" | "archived")}
                                    options={[
                                        { label: t("account.feedback.filterActive", { count: activeFeedbacks.length }), value: "active" },
                                        { label: t("account.feedback.filterArchived", { count: archivedFeedbacks.length }), value: "archived" },
                                    ]}
                                    className="bg-muted/40 text-xs"
                                />
                                <Button size="small" icon={<RefreshCw className={cn("size-3", loadingInbox && "animate-spin")} />} onClick={() => void fetchInbox()}>
                                    {t("common.refresh")}
                                </Button>
                            </div>

                            {loadingInbox && myFeedbacks.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-xs gap-2">
                                    <Clock className="size-6 animate-pulse text-primary/60" />
                                    <span>{t("account.feedback.loading")}</span>
                                </div>
                            ) : myFeedbacks.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-xs gap-2 border border-dashed rounded-xl border-border/60">
                                    <Inbox className="size-8 text-muted-foreground/40" />
                                    <span>{t("account.feedback.empty")}</span>
                                    <Button size="small" type="link" onClick={() => setActiveTab("submit")}>
                                        {t("account.feedback.submitFirst")}
                                    </Button>
                                </div>
                            ) : displayedFeedbacks.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-14 text-muted-foreground text-xs gap-2 border border-dashed rounded-xl border-border/60 bg-muted/10">
                                    {inboxFilter === "active" ? (
                                        <>
                                            <CheckCircle2 className="size-7 text-green-500/80" />
                                            <span>{t("account.feedback.emptyActive")}</span>
                                            {archivedFeedbacks.length > 0 ? (
                                                <Button size="small" type="link" onClick={() => setInboxFilter("archived")}>
                                                    {t("account.feedback.viewArchived", { count: archivedFeedbacks.length })}
                                                </Button>
                                            ) : null}
                                        </>
                                    ) : (
                                        <>
                                            <Archive className="size-7 text-muted-foreground/50" />
                                            <span>{t("account.feedback.emptyArchived")}</span>
                                        </>
                                    )}
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {displayedFeedbacks.map((item) => (
                                        <FeedbackInboxCard key={item.id} item={item} onPreviewVideo={(url) => setPreviewVideoUrl(url)} />
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {activeTab === "submit" ? (
                    <footer className="feedback-footer">
                        <div className="feedback-env">
                            <Checkbox checked={includeEnv} onChange={(e) => setIncludeEnv(e.target.checked)}>
                                {t("account.feedback.includeEnv")}
                            </Checkbox>
                            <Tooltip title={t("account.feedback.envHelp")}>
                                <button type="button" className="feedback-env-info" aria-label={t("account.feedback.envHelp")}>
                                    <Info aria-hidden="true" />
                                </button>
                            </Tooltip>
                        </div>
                        <div className="feedback-actions">
                            <Button onClick={onClose}>{t("common.cancel")}</Button>
                            <Button type="primary" loading={submitting} disabled={uploading} onClick={() => void handleSubmit()} icon={<Send className="size-3.5" />}>
                                {t("account.feedback.submit")}
                            </Button>
                        </div>
                    </footer>
                ) : null}
            </div>

            {previewVideoUrl ? (
                <AppModal open={Boolean(previewVideoUrl)} onCancel={() => setPreviewVideoUrl(null)} footer={null} width={720} title={t("account.feedback.videoPreview")}>
                    <div className="py-2">
                        <video src={previewVideoUrl} controls autoPlay className="w-full max-h-[60vh] rounded-lg bg-black" />
                    </div>
                </AppModal>
            ) : null}
        </AppModal>
    );
}

function FeedbackInboxCard({ item, onPreviewVideo }: { item: FeedbackItem; onPreviewVideo: (url: string) => void }) {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(false);

    let parsedAttachments: FeedbackAttachment[] = [];
    try {
        if (item.attachments) {
            parsedAttachments = JSON.parse(item.attachments);
        }
    } catch {
        parsedAttachments = [];
    }

    const typeConfig: Record<FeedbackType, { label: string; color: string; icon: typeof Bug }> = {
        bug: { label: t("account.feedback.types.bug"), color: "error", icon: Bug },
        feature: { label: t("account.feedback.types.feature"), color: "processing", icon: Lightbulb },
        improvement: { label: t("account.feedback.types.improvement"), color: "cyan", icon: Lightbulb },
        other: { label: t("account.feedback.types.other"), color: "default", icon: MessageSquare },
    };

    const statusConfig: Record<string, { label: string; tagColor: string }> = {
        pending: { label: t("account.feedback.status.pending"), tagColor: "orange" },
        processing: { label: t("account.feedback.status.processing"), tagColor: "blue" },
        resolved: { label: t("account.feedback.status.resolved"), tagColor: "green" },
        closed: { label: t("account.feedback.status.closed"), tagColor: "default" },
    };

    const typeInfo = typeConfig[item.type] || typeConfig.other;
    const statusInfo = statusConfig[item.status] || { label: item.status, tagColor: "default" };
    const TypeIcon = typeInfo.icon;

    const formattedTime = new Date(item.createdAt).toLocaleString(currentLocale(), {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });

    return (
        <div className="rounded-xl border border-border/70 bg-muted/20 p-4 transition-colors duration-150 hover:border-border space-y-3">
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
                <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        {item.archived ? (
                            <Tag className="flex items-center gap-1 m-0 text-[var(--fs-label)] px-2 py-0.5 bg-muted/60 text-muted-foreground border-border/60">
                                <Archive className="size-3" />
                                <span>{t("account.feedback.archived")}</span>
                            </Tag>
                        ) : null}
                        <Tag color={typeInfo.color} className="flex items-center gap-1 m-0 text-[var(--fs-label)] px-2 py-0.5">
                            <TypeIcon className="size-3" />
                            <span>{typeInfo.label}</span>
                        </Tag>
                        <Tag color={statusInfo.tagColor} className="m-0 text-[var(--fs-label)] px-2 py-0.5 font-medium">
                            {statusInfo.label}
                        </Tag>
                        <span className="text-[var(--fs-label)] text-muted-foreground/60">{formattedTime}</span>
                    </div>
                    <h4 className="text-sm font-semibold text-foreground pt-1">{item.title}</h4>
                </div>

                <Button size="small" type="text" onClick={() => setExpanded(!expanded)} className="text-xs text-muted-foreground">
                    {expanded ? t("account.feedback.collapse") : t("account.layout.banner.details")}
                </Button>
            </div>

            {/* Brief / Expanded Content */}
            <div className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap">{expanded ? item.content : item.content.length > 120 ? `${item.content.slice(0, 120)}...` : item.content}</div>

            {/* Attachments preview */}
            {parsedAttachments.length > 0 ? (
                <div className="flex items-center gap-2 flex-wrap pt-1">
                    <span className="text-[var(--fs-label)] text-muted-foreground flex items-center gap-1">
                        <Paperclip className="size-3" />
                        <span>{t("account.feedback.attachmentCount", { count: parsedAttachments.length })}</span>
                    </span>
                    {parsedAttachments.map((att) => (
                        <div key={att.id} className="inline-flex items-center gap-2 rounded bg-muted/40 px-2 py-1 text-[var(--fs-label)] border border-border/40">
                            {att.type === "image" ? (
                                <AntImage src={att.url} alt={att.name} width={18} height={18} className="rounded object-cover" />
                            ) : (
                                <button type="button" onClick={() => onPreviewVideo(att.url)} className="text-primary hover:underline flex items-center gap-1">
                                    <Play className="size-3 fill-current" />
                                    <span>{t("account.feedback.video")}</span>
                                </button>
                            )}
                            <span className="max-w-[140px] truncate" title={att.name}>
                                {att.name}
                            </span>
                        </div>
                    ))}
                </div>
            ) : null}

            {/* Admin Reply Highlight Box */}
            {item.adminReply ? (
                <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 text-xs space-y-2 mt-2">
                    <div className="flex items-center justify-between text-blue-500 dark:text-blue-400 font-semibold text-[var(--fs-label)]">
                        <span className="flex items-center gap-2">
                            <CheckCircle2 className="size-3.5" />
                            <span>{t("account.feedback.reply")}</span>
                        </span>
                        {item.repliedAt ? <span className="font-normal opacity-80 text-[var(--fs-label)]">{new Date(item.repliedAt).toLocaleString(currentLocale(), { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span> : null}
                    </div>
                    <p className="text-foreground/90 whitespace-pre-wrap leading-relaxed">{item.adminReply}</p>
                </div>
            ) : null}
        </div>
    );
}
