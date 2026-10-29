import { useEffect, useState, useCallback, useRef, type ClipboardEvent } from "react";
import { App, Button, Checkbox, Input, Modal, Radio, Tag, Image as AntImage, Segmented } from "antd";
import { AntTooltip as Tooltip } from "@/components/ui/base/tooltip/ant-tooltip";
import { AlertCircle, Archive, Bug, CheckCircle2, Clock, Inbox, Lightbulb, MessageSquare, Paperclip, Play, Plus, RefreshCw, Send, Trash2, UploadCloud, X } from "lucide-react";

import { submitFeedback, getMyFeedbacks, uploadFeedbackAttachment, type FeedbackItem, type FeedbackType, type FeedbackAttachment } from "@/services/api/feedback";
import { useUserStore } from "@/stores/use-user-store";
import { cn } from "@/lib/utils";

interface FeedbackModalProps {
    open: boolean;
    onClose: () => void;
    initialTab?: "submit" | "inbox";
}

export function FeedbackModal({ open, onClose, initialTab = "submit" }: FeedbackModalProps) {
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

    // Video preview modal
    const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);

    // File input ref
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Sync initialTab when modal opens
    useEffect(() => {
        if (open) {
            setActiveTab(initialTab);
            if (!contact && user) {
                setContact(user.email || user.username || "");
            }
        }
    }, [open, initialTab, user, contact]);

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

    // Collect environment info
    const getEnvironmentInfo = () => {
        if (typeof window === "undefined") return "{}";
        return JSON.stringify({
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            language: navigator.language,
            screen: `${window.screen.width}x${window.screen.height}`,
            viewport: `${window.innerWidth}x${window.innerHeight}`,
            currentUrl: window.location.href,
            pathname: window.location.pathname,
            timestamp: new Date().toISOString(),
        });
    };

    // Handle file upload
    const handleUploadFiles = async (files: FileList | File[]) => {
        const fileList = Array.from(files);
        if (!fileList.length) return;

        if (attachments.length + fileList.length > 5) {
            message.warning("最多添加 5 个附件文件");
            return;
        }

        setUploading(true);
        try {
            for (const file of fileList) {
                if (file.size > 50 * 1024 * 1024) {
                    message.error(`文件 ${file.name} 超过 50MB 限制`);
                    continue;
                }
                const isImage = file.type.startsWith("image/");
                const isVideo = file.type.startsWith("video/");
                if (!isImage && !isVideo) {
                    message.error(`文件 ${file.name} 不是支持的图片或视频格式`);
                    continue;
                }

                const res = await uploadFeedbackAttachment(file);
                setAttachments((prev) => [...prev, res]);
            }
            message.success("附件添加成功");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "附件上传失败");
        } finally {
            setUploading(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = "";
            }
        }
    };

    // Handle paste event (support pasting screenshots directly!)
    const handlePaste = (e: ClipboardEvent<HTMLDivElement>) => {
        const items = e.clipboardData.items;
        const pastedFiles: File[] = [];
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.startsWith("image/")) {
                const file = items[i].getAsFile();
                if (file) {
                    pastedFiles.push(file);
                }
            }
        }
        if (pastedFiles.length > 0) {
            e.preventDefault();
            void handleUploadFiles(pastedFiles);
        }
    };

    const removeAttachment = (id: string) => {
        setAttachments((prev) => prev.filter((a) => a.id !== id));
    };

    const handleSubmit = async () => {
        if (!title.trim()) {
            message.warning("请填写反馈简述");
            return;
        }
        if (!content.trim()) {
            message.warning("请填写详细反馈说明");
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

            message.success("反馈已提交，我们会尽快评估处理");
            // Reset form
            setTitle("");
            setContent("");
            setAttachments([]);
            // Switch to inbox tab to see the submitted item
            setActiveTab("inbox");
            void fetchInbox();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "提交反馈失败，请重试");
        } finally {
            setSubmitting(false);
        }
    };

    const [inboxFilter, setInboxFilter] = useState<"active" | "archived">("active");

    const activeFeedbacks = myFeedbacks.filter((item) => !item.archived);
    const archivedFeedbacks = myFeedbacks.filter((item) => item.archived);
    const displayedFeedbacks = inboxFilter === "active" ? activeFeedbacks : archivedFeedbacks;
    const countWithReply = activeFeedbacks.filter((f) => Boolean(f.adminReply)).length;

    return (
        <Modal
            open={open}
            onCancel={onClose}
            footer={null}
            width={680}
            style={{ maxWidth: "calc(100vw - 20px)", top: 20, margin: "0 auto" }}
            destroyOnClose={false}
            title={null}
            closable={false}
            className="feedback-dialog-modal p-0"
            styles={{
                body: { padding: 0, overflow: "hidden" },
            }}
        >
            <div className="flex flex-col max-h-[85vh] text-foreground" onPaste={handlePaste}>
                {/* Header with Navigation Tabs */}
                <div className="flex items-center justify-between border-b border-border/60 px-4 py-2 sm:px-5 sm:py-4 bg-muted/20">
                    <div className="inline-flex items-center gap-1 rounded-xl bg-muted/40 p-1 border border-border/40 min-w-0">
                        <button
                            id="feedback-tab-submit"
                            type="button"
                            onClick={() => setActiveTab("submit")}
                            className={cn(
                                "flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-[color,background-color,border-color,box-shadow] duration-150 whitespace-nowrap shrink-0",
                                activeTab === "submit" ? "bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30 shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-muted/40 border border-transparent",
                            )}
                        >
                            <Plus className="size-3.5 shrink-0" />
                            <span>新建反馈</span>
                        </button>
                        <button
                            id="feedback-tab-inbox"
                            type="button"
                            onClick={() => setActiveTab("inbox")}
                            className={cn(
                                "flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-[color,background-color,border-color,box-shadow] duration-150 relative whitespace-nowrap shrink-0",
                                activeTab === "inbox" ? "bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30 shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-muted/40 border border-transparent",
                            )}
                        >
                            <Inbox className="size-3.5 shrink-0" />
                            <span>
                                <span className="hidden sm:inline">我的</span>反馈收件箱
                            </span>
                            {myFeedbacks.length > 0 ? (
                                <span className={cn("px-2 py-0.2 rounded-full text-[var(--fs-label)] font-semibold leading-tight shrink-0", activeTab === "inbox" ? "bg-blue-500/25 text-blue-600 dark:text-blue-300" : "bg-muted text-muted-foreground")}>
                                    {activeFeedbacks.length > 0 ? activeFeedbacks.length : archivedFeedbacks.length}
                                </span>
                            ) : null}
                            {countWithReply > 0 && activeTab !== "inbox" ? <span className="absolute -top-1 -right-1 size-2 rounded-full bg-blue-500 animate-pulse" /> : null}
                        </button>
                    </div>

                    <button type="button" onClick={onClose} className="rounded-lg p-2 text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors shrink-0 ml-1" aria-label="关闭">
                        <X className="size-4" />
                    </button>
                </div>

                {/* Body Content */}
                <div className="overflow-y-auto px-4 py-4 sm:px-6 sm:py-5 flex-1 min-h-0 space-y-4">
                    {activeTab === "submit" ? (
                        <div className="space-y-4">
                            {/* Feedback Type Selector */}
                            <div>
                                <label className="block text-xs font-medium text-muted-foreground mb-2">反馈类型</label>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                    {[
                                        { value: "bug", label: "Bug 缺陷", icon: Bug, desc: "功能异常或报错" },
                                        { value: "feature", label: "功能提议", icon: Lightbulb, desc: "希望增加新能力" },
                                        { value: "improvement", label: "体验建议", icon: Lightbulb, desc: "操作与排版优化" },
                                        { value: "other", label: "其他意见", icon: MessageSquare, desc: "其他咨询与反馈" },
                                    ].map((item) => {
                                        const Icon = item.icon;
                                        const selected = type === item.value;
                                        return (
                                            <button
                                                key={item.value}
                                                type="button"
                                                onClick={() => setType(item.value as FeedbackType)}
                                                className={cn(
                                                    "flex flex-col items-start p-2 sm:p-2 rounded-xl border text-left transition-[color,background-color,border-color,box-shadow] duration-150",
                                                    selected ? "border-primary bg-primary/10 text-foreground ring-1 ring-primary/40" : "border-border/60 bg-muted/20 hover:border-border text-muted-foreground hover:text-foreground",
                                                )}
                                            >
                                                <div className="flex items-center gap-2 font-medium text-xs mb-1">
                                                    <Icon className={cn("size-3.5 shrink-0", selected ? "text-primary" : "text-muted-foreground")} />
                                                    <span className={selected ? "text-primary font-semibold" : ""}>{item.label}</span>
                                                </div>
                                                <span className="text-[var(--fs-label)] sm:text-[var(--fs-label)] text-muted-foreground/75 leading-tight">{item.desc}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Title */}
                            <div>
                                <label className="block text-xs font-medium text-muted-foreground mb-2">
                                    标题 / 简述 <span className="text-red-500">*</span>
                                </label>
                                <Input
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    placeholder={type === "bug" ? "例如：在画布中拖拽连线时偶尔出现闪烁" : type === "feature" ? "例如：希望在工作台增加批量导出全部镜头功能" : "简明扼要概括您的反馈内容"}
                                    maxLength={200}
                                    className="rounded-lg h-9 text-xs"
                                />
                            </div>

                            {/* Detailed Content */}
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label className="block text-xs font-medium text-muted-foreground">
                                        详细说明 <span className="text-red-500">*</span>
                                    </label>
                                    <span className="hidden sm:inline text-[var(--fs-label)] text-muted-foreground/60">可直接截图并在窗口内按 Ctrl+V 粘贴</span>
                                </div>
                                <Input.TextArea
                                    value={content}
                                    onChange={(e) => setContent(e.target.value)}
                                    rows={4}
                                    placeholder={type === "bug" ? "请尽可能描述问题发生时的操作步骤、实际现象与预期结果，有助于我们快速复现和修复..." : "请描述具体的使用场景或期望的效果，便于评估并纳入产品路线图..."}
                                    maxLength={10000}
                                    className="rounded-lg py-2 text-xs"
                                />
                            </div>

                            {/* Attachment Uploader */}
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label className="text-xs font-medium text-muted-foreground">图片或视频附件 ({attachments.length}/5)</label>
                                    <span className="text-[var(--fs-label)] sm:text-[var(--fs-label)] text-muted-foreground/60">单文件最高 50MB</span>
                                </div>

                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    multiple
                                    accept="image/*,video/*"
                                    className="hidden"
                                    onChange={(e) => {
                                        if (e.target.files) void handleUploadFiles(e.target.files);
                                    }}
                                />

                                {/* Attachment list */}
                                {attachments.length > 0 ? (
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-2">
                                        {attachments.map((att) => (
                                            <div key={att.id} className="group relative flex items-center gap-2 rounded-lg border border-border/80 bg-muted/30 p-2 overflow-hidden">
                                                {att.type === "image" ? (
                                                    <div className="size-10 rounded shrink-0 overflow-hidden bg-black/40 flex items-center justify-center">
                                                        <AntImage src={att.url} alt={att.name} className="size-10 object-cover" preview={{ mask: "预览" }} />
                                                    </div>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => setPreviewVideoUrl(att.url)}
                                                        className="size-10 rounded shrink-0 bg-black/60 flex items-center justify-center text-primary hover:bg-black/80 transition-colors"
                                                        title="点击预览视频"
                                                    >
                                                        <Play className="size-4 fill-current ml-0.5" />
                                                    </button>
                                                )}

                                                <div className="min-w-0 flex-1">
                                                    <p className="truncate text-xs font-medium leading-tight" title={att.name}>
                                                        {att.name}
                                                    </p>
                                                    <p className="text-[var(--fs-label)] text-muted-foreground/70 mt-0.5">
                                                        {(att.size / (1024 * 1024)).toFixed(1)} MB · {att.type === "video" ? "视频" : "图片"}
                                                    </p>
                                                </div>

                                                <button
                                                    type="button"
                                                    onClick={() => removeAttachment(att.id)}
                                                    className="size-6 rounded flex items-center justify-center text-muted-foreground hover:bg-destructive/15 hover:text-destructive transition-colors shrink-0"
                                                    title="移除附件"
                                                >
                                                    <X className="size-3.5" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                ) : null}

                                {/* Upload button dropzone */}
                                {attachments.length < 5 ? (
                                    <button
                                        type="button"
                                        disabled={uploading}
                                        onClick={() => fileInputRef.current?.click()}
                                        className={cn(
                                            "w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-border/80 bg-muted/10 hover:bg-muted/25 hover:border-primary/50 text-xs text-muted-foreground transition-[color,background-color,border-color,opacity] duration-150",
                                            uploading && "opacity-60 cursor-not-allowed",
                                        )}
                                    >
                                        <UploadCloud className="size-4 text-primary shrink-0" />
                                        <span className="text-center">{uploading ? "正在上传附件..." : "点击选择图片/视频文件，或直接在窗口粘贴截图 (Ctrl+V)"}</span>
                                    </button>
                                ) : null}
                            </div>

                            {/* Contact Info */}
                            <div>
                                <label className="block text-xs font-medium text-muted-foreground mb-2">联系方式 (选填)</label>
                                <Input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="留下邮箱或微信号，方便我们进一步反馈处理进展" className="rounded-lg h-9 text-xs" />
                            </div>
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
                                        { label: `进行中 (${activeFeedbacks.length})`, value: "active" },
                                        { label: `历史归档 (${archivedFeedbacks.length})`, value: "archived" },
                                    ]}
                                    className="bg-muted/40 text-xs"
                                />
                                <Button size="small" icon={<RefreshCw className={cn("size-3", loadingInbox && "animate-spin")} />} onClick={() => void fetchInbox()}>
                                    刷新
                                </Button>
                            </div>

                            {loadingInbox && myFeedbacks.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-xs gap-2">
                                    <Clock className="size-6 animate-pulse text-primary/60" />
                                    <span>正在加载反馈记录…</span>
                                </div>
                            ) : myFeedbacks.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-xs gap-2 border border-dashed rounded-xl border-border/60">
                                    <Inbox className="size-8 text-muted-foreground/40" />
                                    <span>暂无任何反馈记录</span>
                                    <Button size="small" type="link" onClick={() => setActiveTab("submit")}>
                                        提交第一条反馈
                                    </Button>
                                </div>
                            ) : displayedFeedbacks.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-14 text-muted-foreground text-xs gap-2 border border-dashed rounded-xl border-border/60 bg-muted/10">
                                    {inboxFilter === "active" ? (
                                        <>
                                            <CheckCircle2 className="size-7 text-green-500/80" />
                                            <span>当前没有进行中的反馈</span>
                                            {archivedFeedbacks.length > 0 ? (
                                                <Button size="small" type="link" onClick={() => setInboxFilter("archived")}>
                                                    查看 {archivedFeedbacks.length} 条已归档的历史反馈 →
                                                </Button>
                                            ) : null}
                                        </>
                                    ) : (
                                        <>
                                            <Archive className="size-7 text-muted-foreground/50" />
                                            <span>暂无已归档的历史反馈</span>
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

                {/* Fixed Footer for Submit Tab */}
                {activeTab === "submit" ? (
                    <div className="border-t border-border/60 px-4 py-3 sm:px-6 sm:py-4 bg-muted/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-muted-foreground">
                            <Checkbox checked={includeEnv} onChange={(e) => setIncludeEnv(e.target.checked)} />
                            <span>附带诊断环境信息（推荐）</span>
                        </label>
                        <div className="flex items-center justify-end gap-2 w-full sm:w-auto">
                            <Button onClick={onClose} className="flex-1 sm:flex-none">
                                取消
                            </Button>
                            <Button id="feedback-submit-btn" type="primary" loading={submitting || uploading} onClick={handleSubmit} icon={<Send className="size-3.5" />} className="flex-1 sm:flex-none font-medium">
                                提交反馈
                            </Button>
                        </div>
                    </div>
                ) : null}
            </div>

            {/* Video Preview Modal */}
            {previewVideoUrl ? (
                <Modal open={Boolean(previewVideoUrl)} onCancel={() => setPreviewVideoUrl(null)} footer={null} width={720} destroyOnClose title="附件视频预览">
                    <div className="py-2">
                        <video src={previewVideoUrl} controls autoPlay className="w-full max-h-[60vh] rounded-lg bg-black" />
                    </div>
                </Modal>
            ) : null}
        </Modal>
    );
}

function FeedbackInboxCard({ item, onPreviewVideo }: { item: FeedbackItem; onPreviewVideo: (url: string) => void }) {
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
        bug: { label: "Bug 缺陷", color: "error", icon: Bug },
        feature: { label: "功能提议", color: "processing", icon: Lightbulb },
        improvement: { label: "体验建议", color: "cyan", icon: Lightbulb },
        other: { label: "其他反馈", color: "default", icon: MessageSquare },
    };

    const statusConfig: Record<string, { label: string; tagColor: string }> = {
        pending: { label: "待处理", tagColor: "orange" },
        processing: { label: "处理中", tagColor: "blue" },
        resolved: { label: "已解决 / 已采纳", tagColor: "green" },
        closed: { label: "已关闭", tagColor: "default" },
    };

    const typeInfo = typeConfig[item.type] || typeConfig.other;
    const statusInfo = statusConfig[item.status] || { label: item.status, tagColor: "default" };
    const TypeIcon = typeInfo.icon;

    const formattedTime = new Date(item.createdAt).toLocaleString("zh-CN", {
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
                                <span>已归档</span>
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
                    {expanded ? "收起" : "详情"}
                </Button>
            </div>

            {/* Brief / Expanded Content */}
            <div className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap">{expanded ? item.content : item.content.length > 120 ? `${item.content.slice(0, 120)}...` : item.content}</div>

            {/* Attachments preview */}
            {parsedAttachments.length > 0 ? (
                <div className="flex items-center gap-2 flex-wrap pt-1">
                    <span className="text-[var(--fs-label)] text-muted-foreground flex items-center gap-1">
                        <Paperclip className="size-3" />
                        <span>附件 ({parsedAttachments.length})：</span>
                    </span>
                    {parsedAttachments.map((att) => (
                        <div key={att.id} className="inline-flex items-center gap-2 rounded bg-muted/40 px-2 py-1 text-[var(--fs-label)] border border-border/40">
                            {att.type === "image" ? (
                                <AntImage src={att.url} alt={att.name} width={18} height={18} className="rounded object-cover" />
                            ) : (
                                <button type="button" onClick={() => onPreviewVideo(att.url)} className="text-primary hover:underline flex items-center gap-1">
                                    <Play className="size-3 fill-current" />
                                    <span>视频</span>
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
                            <span>官方答复</span>
                        </span>
                        {item.repliedAt ? <span className="font-normal opacity-80 text-[var(--fs-label)]">{new Date(item.repliedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span> : null}
                    </div>
                    <p className="text-foreground/90 whitespace-pre-wrap leading-relaxed">{item.adminReply}</p>
                </div>
            ) : null}
        </div>
    );
}
