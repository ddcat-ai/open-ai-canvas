import { useEffect, useState, useCallback } from "react";
import { App, Button, Modal, Tag, Image as AntImage, Segmented } from "antd";
import { Archive, Bug, CheckCircle2, Clock, Inbox, Lightbulb, MessageSquare, Paperclip, Play, Plus, RefreshCw } from "lucide-react";

import { getMyFeedbacks, type FeedbackItem, type FeedbackType, type FeedbackAttachment } from "@/services/api/feedback";
import { FeedbackModal } from "@/components/feedback/feedback-modal";
import { cn } from "@/lib/utils";

export function FeedbackInboxPane() {
    const [loading, setLoading] = useState(false);
    const [feedbacks, setFeedbacks] = useState<FeedbackItem[]>([]);
    const [submitModalOpen, setSubmitModalOpen] = useState(false);
    const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<"active" | "archived">("active");

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const list = await getMyFeedbacks();
            setFeedbacks(list);
        } catch {
            // handled
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    const activeFeedbacks = feedbacks.filter((i) => !i.archived);
    const archivedFeedbacks = feedbacks.filter((i) => i.archived);
    const displayedFeedbacks = activeTab === "active" ? activeFeedbacks : archivedFeedbacks;

    return (
        <section className="space-y-4" aria-label="我的反馈收件箱">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 pb-4">
                <div>
                    <h3 className="text-base font-semibold text-foreground">我的反馈与建议</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">查看您提交的问题缺陷、功能提议、官方回复进展与历史归档。</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button size="small" icon={<RefreshCw className={cn("size-3.5", loading && "animate-spin")} />} onClick={() => void loadData()}>
                        刷新
                    </Button>
                    <Button type="primary" size="small" icon={<Plus className="size-3.5" />} onClick={() => setSubmitModalOpen(true)}>
                        新建反馈
                    </Button>
                </div>
            </div>

            {/* Tabs & Controls */}
            {feedbacks.length > 0 ? (
                <div className="flex items-center justify-between">
                    <Segmented
                        value={activeTab}
                        onChange={(v) => setActiveTab(v as "active" | "archived")}
                        options={[
                            { label: `进行中 (${activeFeedbacks.length})`, value: "active" },
                            { label: `历史归档 (${archivedFeedbacks.length})`, value: "archived" },
                        ]}
                        className="bg-muted/40 text-xs"
                    />
                </div>
            ) : null}

            {/* List */}
            {loading && feedbacks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground text-xs gap-2">
                    <Clock className="size-6 animate-pulse text-primary/60" />
                    <span>正在加载反馈列表…</span>
                </div>
            ) : feedbacks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-xs gap-3 rounded-2xl border border-dashed border-border/60 bg-muted/10">
                    <Inbox className="size-10 text-muted-foreground/30" />
                    <div className="text-center">
                        <p className="font-medium text-foreground">暂无提交记录</p>
                        <p className="text-[var(--fs-label)] text-muted-foreground/80 mt-1">遇到问题或有新想法，可以随时提交反馈。</p>
                    </div>
                    <Button type="primary" size="small" onClick={() => setSubmitModalOpen(true)}>
                        提交第一条反馈
                    </Button>
                </div>
            ) : displayedFeedbacks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-xs gap-3 rounded-2xl border border-dashed border-border/60 bg-muted/10">
                    {activeTab === "active" ? (
                        <>
                            <CheckCircle2 className="size-8 text-green-500/80" />
                            <div className="text-center">
                                <p className="font-medium text-foreground">当前没有进行中的反馈</p>
                                {archivedFeedbacks.length > 0 ? <p className="text-[var(--fs-label)] text-muted-foreground/80 mt-1">您有 {archivedFeedbacks.length} 条已归档的历史反馈</p> : null}
                            </div>
                            {archivedFeedbacks.length > 0 ? (
                                <Button size="small" onClick={() => setActiveTab("archived")}>
                                    查看历史归档
                                </Button>
                            ) : null}
                        </>
                    ) : (
                        <>
                            <Archive className="size-8 text-muted-foreground/40" />
                            <p className="font-medium text-foreground">暂无历史归档记录</p>
                        </>
                    )}
                </div>
            ) : (
                <div className="space-y-3">
                    {displayedFeedbacks.map((item) => (
                        <FeedbackDetailCard key={item.id} item={item} onPreviewVideo={(url) => setPreviewVideoUrl(url)} />
                    ))}
                </div>
            )}

            <FeedbackModal
                open={submitModalOpen}
                onClose={() => {
                    setSubmitModalOpen(false);
                    void loadData();
                }}
            />

            {previewVideoUrl ? (
                <Modal open={Boolean(previewVideoUrl)} onCancel={() => setPreviewVideoUrl(null)} footer={null} width={720} destroyOnClose title="附件视频预览">
                    <div className="py-2">
                        <video src={previewVideoUrl} controls autoPlay className="w-full max-h-[60vh] rounded-lg bg-black" />
                    </div>
                </Modal>
            ) : null}
        </section>
    );
}

function FeedbackDetailCard({ item, onPreviewVideo }: { item: FeedbackItem; onPreviewVideo: (url: string) => void }) {
    let parsedAttachments: FeedbackAttachment[] = [];
    try {
        if (item.attachments) parsedAttachments = JSON.parse(item.attachments);
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
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });

    return (
        <div className="rounded-xl border border-border/70 bg-card p-4 transition-colors duration-150 hover:border-border space-y-3 text-xs">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="space-y-1">
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
            </div>

            <div className="text-foreground/80 leading-relaxed whitespace-pre-wrap rounded-lg bg-muted/20 p-3">{item.content}</div>

            {parsedAttachments.length > 0 ? (
                <div className="space-y-2">
                    <div className="text-[var(--fs-label)] text-muted-foreground flex items-center gap-1">
                        <Paperclip className="size-3" />
                        <span>附件文件 ({parsedAttachments.length})：</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        {parsedAttachments.map((att) => (
                            <div key={att.id} className="inline-flex items-center gap-2 rounded-lg bg-muted/40 p-2 border border-border/50 text-[var(--fs-label)]">
                                {att.type === "image" ? (
                                    <AntImage src={att.url} alt={att.name} width={28} height={28} className="rounded object-cover" />
                                ) : (
                                    <button type="button" onClick={() => onPreviewVideo(att.url)} className="size-7 rounded bg-black/60 flex items-center justify-center text-primary hover:bg-black/80 transition-colors">
                                        <Play className="size-3 fill-current ml-0.5" />
                                    </button>
                                )}
                                <div className="min-w-0 pr-1">
                                    <p className="max-w-[150px] truncate font-medium text-foreground" title={att.name}>
                                        {att.name}
                                    </p>
                                    <p className="text-[var(--fs-label)] text-muted-foreground/60">{(att.size / (1024 * 1024)).toFixed(1)} MB</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}

            {item.adminReply ? (
                <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4 space-y-2">
                    <div className="flex items-center justify-between text-blue-500 dark:text-blue-400 font-semibold text-xs">
                        <span className="flex items-center gap-2">
                            <CheckCircle2 className="size-3.5" />
                            <span>官方处理答复</span>
                        </span>
                        {item.repliedAt ? <span className="font-normal opacity-80 text-[var(--fs-label)]">{new Date(item.repliedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span> : null}
                    </div>
                    <p className="text-foreground/90 whitespace-pre-wrap leading-relaxed">{item.adminReply}</p>
                </div>
            ) : null}
        </div>
    );
}
