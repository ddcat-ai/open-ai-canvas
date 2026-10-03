// 创作页消息流：用户消息、媒体结果、生成中占位、引用素材与预览。

import { conversationTimeFormatter, type CreationMessage } from "./creation-types";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Copy, Download, FileText, Film, Image as ImageIcon, Maximize2, Music2, Pencil, RefreshCw, Sparkles, UserRound, X } from "lucide-react";
import { GenerationToolCard, type GenerationToolStatus } from "@/components/ai/generation-tool-card";
import { MessageReasoning } from "@/components/ai/message-reasoning";
import { AIMessageMarkdown } from "@/components/ai/ai-message-markdown";
import { WorkingDots } from "@/components/ai/working-indicator";
import { generationErrorMessage } from "@/lib/generation-error";
import { useEffect, useId, useState, type ReactNode } from "react";
import type { AgentOutputPreference } from "@/services/api/agent";
import { useCopyText } from "@/hooks/use-copy-text";
import { type CreationReference, displayCreationPrompt } from "./creation-references";
import { useUserStore } from "@/stores/use-user-store";
import { type CreationAttachment, creationAttachmentKind, creationMediaAspectRatio, type CreationMode } from "./creation-assets";
import { getResourceAccess, resolveResourceAccessURL, resolveResourceUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { Tooltip } from "@/components/ui/base/tooltip";
import { useAssetStore } from "@/stores/use-asset-store";
import { creationResultAssetIds, creationResultStorageKeys } from "@/lib/canvas/canvas-asset-handoff";
import { resolveMediaUrl } from "@/services/file-storage";
import { resolveImageUrl } from "@/services/image-storage";
import { Button } from "antd";
import { CanvasImagePreview } from "@/components/canvas/canvas-image-preview";
import { AppModal } from "@/components/ui/product/app-modal";
import { creationAgentLatestMediaTasks, projectCreationAgentMediaBatches } from "./creation-agent-conversation";
import { saveAs } from "file-saver";
import { createCreationImagesZip, creationImageDownloadBaseName, creationImagesZipName, downloadCreationImage } from "./creation-media-download";

export function CreationMessageView({
    item,
    shotNumber,
    onRetryFailure,
    onCreateVariant,
    onEditUserMessage,
    onContinueCanvas,
    openingCanvas,
    agentReview,
    agentTasks,
    outputPreference = "detailed",
    onRetryAgentTask,
    onCreateAgentTaskVariant,
    nested = false,
}: {
    item: CreationMessage;
    shotNumber: number;
    onRetryFailure: () => void;
    onCreateVariant: () => void;
    onEditUserMessage: (text: string) => void;
    onContinueCanvas: (ids?: string[]) => void;
    openingCanvas: boolean;
    agentReview?: ReactNode;
    agentTasks?: CreationMessage[];
    outputPreference?: AgentOutputPreference;
    onRetryAgentTask?: (task: CreationMessage) => void;
    onCreateAgentTaskVariant?: (task: CreationMessage) => void;
    nested?: boolean;
}) {
    const brandName = useAppearanceStore((state) => state.appearance.brandName);
    const [replyExpanded, setReplyExpanded] = useState(false);
    const replyId = useId();
    useEffect(() => { setReplyExpanded(false); }, [outputPreference, item.id]);
    if (item.role === "user") return <CreationUserMessage item={item} shotNumber={shotNumber} onEditUserMessage={onEditUserMessage} />;
    const mode = item.mode || "text";
    const compactOutput = mode === "agent" && outputPreference === "concise";
    const compactStructuredOutput = compactOutput && !item.agentQuestion && Boolean(item.commercePlan || agentTasks?.length);
    const mediaTasks = creationAgentLatestMediaTasks(agentTasks || []);
    const agentRunning = item.status === "pending" || item.status === "streaming";
    const taskSummary = ([
        ["done", "完成"], ["error", "失败"], ["pending", "生成中"], ["cancelled", "已停止"],
    ] as const).map(([status, label]) => {
        const count = mediaTasks.filter((task) => {
            const taskStatus = agentRunning && task.mode === "image" && task.status === "error" ? "pending" : task.status;
            return taskStatus === status || (status === "pending" && taskStatus === "streaming");
        }).length;
        return count ? `${count} 项${label}` : "";
    }).filter(Boolean).join("，");
    const compactSummary = mediaTasks.length ? `${mediaTasks.length} 项交付${taskSummary ? `：${taskSummary}` : "，状态待确认"}。` : `创作方案已准备，共 ${item.commercePlan?.items.length || 0} 项交付。`;
    const stateLabel = item.status === "pending" ? mode === "agent" ? "思考中" : "生成中" : item.status === "cancelled" ? "已停止" : item.status === "error" ? "生成失败" : "";
    const heading =
        mode !== "text" && mode !== "agent" ? (
            <>
                {shotNumber > 0 ? <span className="creation-shot-badge">镜 {shotNumber}</span> : null}
                <span className="creation-message-mark">
                    <Sparkles />
                </span>
                <strong>{mode === "image" ? "图像生成" : "视频生成"}</strong>
                {item.status === "pending" ? (
                    <span className="creation-message-progress-copy">
                        {brandName}正在生成{mode === "video" ? "视频" : "图像"}……
                    </span>
                ) : item.status === "done" ? (
                    <span className="creation-message-progress-copy">你的{mode === "video" ? "视频" : "图像"}已创建</span>
                ) : null}
                {item.status === "done" && !item.agentRunId ? (
                    <button type="button" className="creation-message-variant-action" onClick={onCreateVariant}>
                        <RefreshCw />
                        生成同款
                    </button>
                ) : null}
                {item.createdAt ? <time dateTime={item.createdAt}>{formatMessageTime(item.createdAt)}</time> : null}
                {stateLabel ? <span className={`creation-message-state is-${item.status}`}>{stateLabel}</span> : null}
            </>
        ) : (
            <>
                {shotNumber > 0 ? <span className="creation-shot-badge">镜 {shotNumber}</span> : null}
                <span className="creation-message-mark">
                    <Sparkles />
                </span>
                <strong>{brandName}</strong>
                {item.createdAt ? <time dateTime={item.createdAt}>{formatMessageTime(item.createdAt)}</time> : null}
                {stateLabel ? <span className={`creation-message-state is-${item.status}`}>{stateLabel}</span> : null}
            </>
        );
    const toolStatus: GenerationToolStatus = item.status === "pending" ? "running" : item.status === "error" ? "error" : item.status === "cancelled" ? "cancelled" : "completed";
    const Container = nested ? "div" : "article";
    const agentMediaResults = mode === "agent" ? projectCreationAgentMediaBatches(item, mediaTasks).map((task) => {
        const sources = task.batchId ? mediaTasks.filter((source) => source.agentRunId === item.agentRunId && source.mode === "image") : [task];
        const failed = !agentRunning && task.status !== "pending" ? sources.filter((source) => source.status === "error") : [];
        const failureTitles = failed.map((source) => source.content).join("、");
        const failureReasons = [...new Set(failed.map((source) => generationErrorMessage(source.error || "生成失败")))].join("；");
        return <div key={task.id} className="creation-agent-media-batch" role="group" aria-label={sources.map((source) => source.content).filter(Boolean).join("、") || "整套媒体生成"}>
            <CreationMessageView nested item={task} shotNumber={0} onRetryFailure={() => onRetryAgentTask?.(failed[0] || sources[0])} onCreateVariant={() => onCreateAgentTaskVariant?.(sources[0])} onEditUserMessage={onEditUserMessage} onContinueCanvas={onContinueCanvas} openingCanvas={openingCanvas} />
            {failed.length > 0 && <div className="creation-message-error"><span>{failureTitles}：{failureReasons}</span>{failed.map((source) => <button key={source.id} type="button" aria-label={`重试${source.content}`} onClick={() => onRetryAgentTask?.(source)}><RefreshCw />重试此项</button>)}</div>}
        </div>;
    }) : null;
    return (
        <Container className={`creation-assistant-message is-${mode}`}>
            {mode === "text" || mode === "agent" ? (
                <>
                    <div className="creation-message-heading">{heading}</div>
                    {item.reasoning && !compactOutput ? (
                        <div className="creation-message-reasoning-wrap">
                            <MessageReasoning reasoning={item.reasoning} isStreaming={item.status === "streaming"} />
                        </div>
                    ) : null}
                    <div className="creation-message-content">
                        {compactStructuredOutput ? <p className="creation-agent-output-summary" role="status">{compactSummary}</p> : null}
                        {item.content ? (
                            compactStructuredOutput ? <div className="creation-agent-full-reply"><button type="button" className="creation-agent-plan-toggle" aria-expanded={replyExpanded} aria-controls={replyId} onClick={() => setReplyExpanded((value) => !value)}>{replyExpanded ? "收起完整回复" : "查看完整回复"}{replyExpanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}</button><div id={replyId} hidden={!replyExpanded}>{replyExpanded ? <AIMessageMarkdown isStreaming={item.status === "streaming"} smoothStreaming>{item.content}</AIMessageMarkdown> : null}</div></div> : <AIMessageMarkdown isStreaming={item.status === "streaming"} smoothStreaming={mode === "agent"}>{item.content}</AIMessageMarkdown>
                        ) : !item.agentQuestion && (item.status === "streaming" || item.status === "pending") ? (
                            <span role="status" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                                <WorkingDots dotSize={5} gap={2} />
                                <span>{mode === "agent" ? "正在思考…" : "正在生成…"}</span>
                            </span>
                        ) : null}
                    </div>
                    {mode === "agent" && item.agentQuestion ? <section className="creation-agent-question" aria-label="待确认的问题">
                        <h3>需要你确认</h3>
                        <p>{item.agentQuestion.question}</p>
                        {item.agentQuestion.fields?.length ? <ul>{item.agentQuestion.fields.map((field, index) => <li key={`${field.title}-${index}`}>
                            <strong>{field.title}{field.required ? "（必填）" : ""}</strong>
                            {field.options?.length ? <span>：{field.options.map((option) => `${option.label}${option.detail ? `（${option.detail}）` : ""}`).join("、")}</span> : field.placeholder ? <span>：{field.placeholder}</span> : null}
                        </li>)}</ul> : item.agentQuestion.options.length ? <ol>{item.agentQuestion.options.map((option, index) => <li key={`${option.label}-${index}`}><strong>{option.label}</strong>{option.detail ? <span> — {option.detail}</span> : null}</li>)}</ol> : null}
                        <small>{item.agentQuestion.allowFreeform ? "请在输入框回复选项或补充说明。" : "请在输入框回复一个选项。"}</small>
                    </section> : null}
                    {compactOutput ? agentMediaResults : null}
                    {mode === "agent" ? agentReview : null}
                    {!compactOutput ? agentMediaResults : null}
                </>
            ) : (
                <GenerationToolCard status={toolStatus} heading={heading}>
                    <MediaResult item={item} onRetryFailure={onRetryFailure} onCreateVariant={onCreateVariant} onContinueCanvas={onContinueCanvas} openingCanvas={openingCanvas} />
                </GenerationToolCard>
            )}
            {item.error && (mode === "text" || mode === "agent") ? (
                <div className="creation-message-error">
                    <span>{generationErrorMessage(item.error)}</span>
                    <button type="button" onClick={onRetryFailure}>
                        <RefreshCw />
                        重新生成
                    </button>
                </div>
            ) : null}
        </Container>
    );
}

export function CreationUserMessage({ item, shotNumber, onEditUserMessage }: { item: CreationMessage; shotNumber: number; onEditUserMessage: (text: string) => void }) {
    const [previewUrl, setPreviewUrl] = useState("");
    const [previewType, setPreviewType] = useState<"image" | "video">("image");
    const copyText = useCopyText();
    const visiblePrompt = displayCreationPrompt(item.content, item.references || []);
    const user = useUserStore((state) => state.user);
    const userAvatarUrl = user?.avatarUrl?.trim();
    return (
        <article className="creation-user-message">
            <div className="creation-user-message-meta">
                {shotNumber > 0 ? <span className="creation-shot-badge">镜 {shotNumber}</span> : null}
                {item.createdAt ? <time dateTime={item.createdAt}>{formatMessageTime(item.createdAt)}</time> : null}
                <strong>{user?.displayName || "你"}</strong>
                <span className="creation-user-avatar">{userAvatarUrl ? <img src={userAvatarUrl} alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" /> : <UserRound />}</span>
            </div>
            <div className="creation-user-message-copy-wrap">
                <p>{visiblePrompt}</p>
            </div>
            {item.references?.length ? <CreationMessageReferences references={item.references} /> : null}
            {item.attachments?.length ? (
                <div className="creation-user-message-attachments">
                    {item.attachments.map((attachment) => {
                        const kind = creationAttachmentKind(attachment);
                        const previewable = kind === "image" || kind === "video";
                        const url = attachment.previewUrl || ("dataUrl" in attachment ? attachment.dataUrl : attachment.url) || "";
                        const imageUrl = kind === "image" ? resolveResourceUrl(attachment.storageKey, url) : "";
                        const previewUrl = kind === "image" ? imageUrl : url;
                        return (
                            <button
                                key={attachment.id}
                                type="button"
                                className={!previewable ? "is-file" : undefined}
                                onClick={() => {
                                    if (!previewable) return;
                                    setPreviewType(kind === "video" ? "video" : "image");
                                    setPreviewUrl(kind === "video" ? attachment.url || "" : previewUrl);
                                }}
                                aria-label={previewable ? `预览 ${attachment.name || "附件"}` : attachment.name || "附件"}
                                disabled={previewable && !previewUrl}
                            >
                                {kind === "video" ? (
                                    <video src={attachment.url || ""} poster={url !== attachment.url ? url : undefined} muted playsInline preload="metadata" />
                                ) : kind === "image" ? (
                                    <CachedResourceImage storageKey={attachment.storageKey} src={imageUrl} alt={attachment.name || "附件"} width={44} height={44} loading="lazy" decoding="async" />
                                ) : kind === "audio" ? (
                                    <Music2 />
                                ) : (
                                    <FileText />
                                )}
                                {previewable ? (
                                    <span aria-hidden="true">
                                        <Maximize2 />
                                    </span>
                                ) : null}
                            </button>
                        );
                    })}
                </div>
            ) : null}
            <div className="creation-user-message-actions">
                <Tooltip title="复制提示词">
                    <button type="button" className="creation-user-message-copy" aria-label="复制提示词" onClick={() => copyText(visiblePrompt, "提示词已复制")}>
                        <Copy />
                    </button>
                </Tooltip>
                <Tooltip title="编辑并重新发送">
                    <button type="button" className="creation-user-message-edit" aria-label="编辑提示词" onClick={() => onEditUserMessage(visiblePrompt)}>
                        <Pencil />
                    </button>
                </Tooltip>
            </div>
            <CreationMediaPreviewModal url={previewUrl} type={previewType} onClose={() => setPreviewUrl("")} />
        </article>
    );
}

export function MediaResult({
    item,
    onRetryFailure,
    onCreateVariant,
    onContinueCanvas,
    openingCanvas,
}: {
    item: CreationMessage;
    onRetryFailure: () => void;
    onCreateVariant: () => void;
    onContinueCanvas: (ids?: string[]) => void;
    openingCanvas: boolean;
}) {
    const [previewUrl, setPreviewUrl] = useState("");
    const [previewType, setPreviewType] = useState<"image" | "video">("image");
    const [batchPreviewOpen, setBatchPreviewOpen] = useState(false);
    const [batchPreviewIndex, setBatchPreviewIndex] = useState(0);
    const [batchExpanded, setBatchExpanded] = useState(false);
    const [downloadingBatch, setDownloadingBatch] = useState(false);
    const [downloadingImage, setDownloadingImage] = useState<number | null>(null);
    const [downloadError, setDownloadError] = useState("");
    const assets = useAssetStore((state) => state.assets);
    const storedResultUrls = item.resultUrls || [];
    const resultStorageKeys = item.resultStorageKeys?.length ? item.resultStorageKeys : creationResultStorageKeys(assets, { messageId: item.id, taskIds: item.taskIds || [], resultUrls: storedResultUrls });
    const [resolvedResultUrls, setResolvedResultUrls] = useState(storedResultUrls);

    useEffect(() => {
        let active = true;
        const timers: ReturnType<typeof setTimeout>[] = [];
        const updateResultUrl = (index: number, url: string) => {
            if (!active) return;
            setResolvedResultUrls((current) => {
                const next = [...current];
                next[index] = url;
                return next;
            });
        };
        const refreshRemote = async (index: number, storageKey: string): Promise<void> => {
            try {
                const access = await getResourceAccess(storageKey, "display");
                if (!active) return;
                updateResultUrl(index, resolveResourceAccessURL(access.url));
                const refreshAt = access.refreshAt ? new Date(access.refreshAt).getTime() : Number.NaN;
                const expiresAt = access.expiresAt ? new Date(access.expiresAt).getTime() : Number.NaN;
                const nextRefreshAt = Number.isFinite(refreshAt) ? refreshAt : expiresAt;
                const delay = Number.isFinite(nextRefreshAt) ? Math.max(10_000, nextRefreshAt - Date.now()) : 4 * 60_000;
                timers.push(setTimeout(() => void refreshRemote(index, storageKey), delay));
            } catch {
                if (active) timers.push(setTimeout(() => void refreshRemote(index, storageKey), 60_000));
            }
        };
        if (!resultStorageKeys.length) {
            setResolvedResultUrls(storedResultUrls);
            return () => {
                active = false;
            };
        }
        // 历史记录只把 URL 当作短期 hint；真正恢复依赖稳定 storageKey，展示 URL 由访问缓存按需续签。
        setResolvedResultUrls(storedResultUrls);
        const resolver = item.mode === "video" ? resolveMediaUrl : resolveImageUrl;
        void Promise.all(
            resultStorageKeys.map(async (storageKey, index) => {
                if (resourceIdFromStorageKey(storageKey)) {
                    await refreshRemote(index, storageKey);
                    return;
                }
                const url = await resolver(storageKey, storedResultUrls[index] || "");
                updateResultUrl(index, url);
            }),
        ).catch(() => {
            // 保留当前页面已有的 URL hint；若已过期，页面会走明确的媒体空态而不是回退到平台正文代理。
        });
        return () => {
            active = false;
            timers.forEach((timer) => clearTimeout(timer));
        };
    }, [item.id, item.mode, resultStorageKeys.join("|"), storedResultUrls.join("|")]);

    const alignedResultUrls = resultStorageKeys.length ? resolvedResultUrls : storedResultUrls;
    const downloadImages = alignedResultUrls.map((url, index) => ({ url, storageKey: resultStorageKeys[index], name: item.resultDownloadNames?.[index] || creationImageDownloadBaseName(item.content, index + 1) })).filter((image) => image.url);
    const displayResultUrls = downloadImages.map((image) => image.url);
    useEffect(() => {
        setBatchPreviewIndex((current) => displayResultUrls.length ? Math.min(current, displayResultUrls.length - 1) : 0);
    }, [displayResultUrls.length]);
    const resultAssetIds = alignedResultUrls.length || resultStorageKeys.length ? creationResultAssetIds(assets, { messageId: item.id, taskIds: item.taskIds || [], resultUrls: alignedResultUrls, resultStorageKeys }) : [];
    const expectedResultCount = resultStorageKeys.length || alignedResultUrls.length;
    const canContinueWithResults = expectedResultCount > 0 && resultAssetIds.length === expectedResultCount;
    if (item.status === "pending" && !displayResultUrls.length) return <CreationMediaPending mode={item.mode || "image"} ratio={item.settings?.ratio} progress={item.batchTotal ? `${item.batchCompletedCount || 0}/${item.batchTotal}${item.batchFailedCount ? `（${item.batchFailedCount} 项未成功）` : ""}` : undefined} />;
    if ((item.status === "error" || item.status === "cancelled") && !expectedResultCount)
        return (
            <div className="creation-media-error">
                <span>{item.status === "cancelled" ? item.content || "已停止" : generationErrorMessage(item.error || "生成失败")}</span>
                <button type="button" onClick={onRetryFailure}>
                    <RefreshCw />
                    重新生成
                </button>
            </div>
        );
    if (!expectedResultCount || !displayResultUrls.length)
        return (
            <div className="creation-media-empty">
                没有返回可预览结果{" "}
                <button type="button" onClick={onRetryFailure}>
                    重试
                </button>
            </div>
        );
    const isVideo = item.mode === "video";
    const activeBatchUrl = displayResultUrls[batchPreviewIndex] || displayResultUrls[0];
    const stackedUrls = displayResultUrls.length > 1
        ? Array.from({ length: Math.min(2, displayResultUrls.length - 1) }, (_, offset) => displayResultUrls[(batchPreviewIndex + offset + 1) % displayResultUrls.length])
        : [];
    const moveBatchPreview = (direction: -1 | 1) => setBatchPreviewIndex((current) => (current + direction + displayResultUrls.length) % displayResultUrls.length);
    const downloadImage = async (index: number) => {
        if (downloadingBatch || downloadingImage !== null) return;
        setDownloadingImage(index);
        setDownloadError("");
        try {
            const image = downloadImages[index];
            await downloadCreationImage(image);
        } catch (error) {
            setDownloadError(error instanceof Error ? error.message : "图片下载失败，请重试");
        } finally {
            setDownloadingImage(null);
        }
    };
    const downloadBatch = async () => {
        if (downloadingBatch || downloadingImage !== null) return;
        setDownloadingBatch(true);
        setDownloadError("");
        try {
            saveAs(await createCreationImagesZip(downloadImages), creationImagesZipName(item));
        } catch (error) {
            setDownloadError(error instanceof Error ? error.message : "批量下载失败，请重试");
        } finally {
            setDownloadingBatch(false);
        }
    };
    const imageResult = (url: string, index: number) => <div key={`${url}-${index}`} className="creation-image-result">
        <button type="button" className="creation-image-result-preview" onClick={() => { setPreviewType("image"); setPreviewUrl(url); }} aria-label={displayResultUrls.length === 1 ? "预览生成图片" : `预览生成图片 ${index + 1}`}><img src={url} alt={`生成结果 ${index + 1}`} /></button>
        <button type="button" className="creation-image-result-download" onClick={() => void downloadImage(index)} disabled={downloadingBatch || downloadingImage !== null} aria-label={`下载生成图片 ${index + 1}`} title="下载图片"><Download aria-hidden="true" /></button>
    </div>;
    return (
        <div className="creation-media-result">
            {isVideo ? (
                <button
                    type="button"
                    className="creation-video-result"
                    onClick={() => {
                        setPreviewType("video");
                        setPreviewUrl(displayResultUrls[0]);
                    }}
                    aria-label="预览生成视频"
                >
                    <video muted preload="metadata" src={displayResultUrls[0]} />
                    <span>
                        <Maximize2 />
                        预览视频
                    </span>
                </button>
            ) : displayResultUrls.length > 1 ? batchExpanded ? (
                <div className="creation-image-result-grid creation-image-result-grid-expanded">
                    {displayResultUrls.map(imageResult)}
                </div>
            ) : (
                <div className="creation-image-result-stack" role="group" aria-label={`第 ${batchPreviewIndex + 1} 张，共 ${displayResultUrls.length} 张生成图片`}>
                    <span className="creation-image-result-stack-cards">
                        {stackedUrls.map((url, index) => <img key={`${url}-${index}`} className={`creation-image-result-stack-back is-back-${index + 1}`} src={url} alt="" aria-hidden="true" />)}
                        <button type="button" className="creation-image-result-stack-front" onClick={() => setBatchPreviewOpen(true)} aria-label={`展开预览第 ${batchPreviewIndex + 1} 张图片`}><img src={activeBatchUrl} alt={`生成结果 ${batchPreviewIndex + 1}`} /></button>
                    </span>
                    <span className="creation-image-result-stack-controls" aria-label="切换批次图片">
                        <button type="button" onClick={() => moveBatchPreview(-1)} aria-label="上一张生成图片" title="上一张"><ChevronLeft aria-hidden="true" /></button>
                        <button type="button" onClick={() => moveBatchPreview(1)} aria-label="下一张生成图片" title="下一张"><ChevronRight aria-hidden="true" /></button>
                    </span>
                    <button type="button" className="creation-image-result-stack-download" onClick={() => void downloadImage(batchPreviewIndex)} disabled={downloadingBatch || downloadingImage !== null} aria-label="下载当前生成图片" title="下载当前图片"><Download aria-hidden="true" /></button>
                </div>
            ) : (
                <div className="creation-image-result-grid is-single">{imageResult(displayResultUrls[0], 0)}</div>
            )}
            <div className="creation-media-actions">
                <span>{isVideo ? "视频结果" : `${displayResultUrls.length} 张图片${item.agentRunId && item.batchTotal ? ` · 成功 ${item.batchCompletedCount || 0}/${item.batchTotal}` : ""}`}</span>
                <Button type="link" size="small" loading={openingCanvas} disabled={!canContinueWithResults} title={canContinueWithResults ? undefined : "素材保存完成后才能转入画布"} onClick={() => onContinueCanvas(resultAssetIds)}>
                    添加到画布
                </Button>
                {!isVideo && displayResultUrls.length > 1 ? <Button type="link" size="small" onClick={() => setBatchExpanded((expanded) => !expanded)}>{batchExpanded ? "收起" : "展开"}</Button> : null}
                {isVideo ? <a href={displayResultUrls[0]} download><Download />下载</a> : <Button type="link" size="small" loading={downloadingBatch} disabled={downloadingImage !== null} onClick={() => void downloadBatch()}><Download />批量下载</Button>}
            </div>
            {downloadError ? <div className="creation-message-error" role="alert">{downloadError}</div> : null}
            <CreationMediaPreviewModal url={previewUrl} type={previewType} onClose={() => setPreviewUrl("")} />
            <AppModal open={batchPreviewOpen} centered destroyOnHidden title={`生成图片（${displayResultUrls.length} 张）`} footer={null} width="min(1120px, calc(100vw - 32px))" onCancel={() => setBatchPreviewOpen(false)} className="creation-image-batch-preview-modal">
                <div className="creation-image-batch-preview-viewer">
                    <div className="creation-image-batch-preview-stage">
                        <button type="button" className="creation-image-batch-preview-nav is-prev" onClick={() => moveBatchPreview(-1)} aria-label="上一张生成图片" title="上一张"><ChevronLeft aria-hidden="true" /></button>
                        <img src={activeBatchUrl} alt={`生成结果 ${batchPreviewIndex + 1}`} />
                        <button type="button" className="creation-image-batch-preview-nav is-next" onClick={() => moveBatchPreview(1)} aria-label="下一张生成图片" title="下一张"><ChevronRight aria-hidden="true" /></button>
                    </div>
                    <div className="creation-image-batch-preview-thumbs" aria-label="生成图片缩略图">
                        {displayResultUrls.map((url, index) => <button key={`${url}-${index}`} type="button" className={index === batchPreviewIndex ? "is-active" : undefined} onClick={() => setBatchPreviewIndex(index)} aria-label={`预览第 ${index + 1} 张图片`} aria-current={index === batchPreviewIndex ? "true" : undefined}><img src={url} alt={`生成结果缩略图 ${index + 1}`} /><span>{index + 1}</span></button>)}
                    </div>
                </div>
            </AppModal>
        </div>
    );
}

export function CreationMediaPending({ mode, ratio, progress }: { mode: CreationMode; ratio?: string; progress?: string }) {
    const brandName = useAppearanceStore((state) => state.appearance.brandName);
    return (
        <div className={`creation-media-pending is-${mode}`} style={{ aspectRatio: creationMediaAspectRatio(ratio, mode) }} aria-live="polite">
            <span className="creation-media-pending-icon">
                <WorkingDots dotSize={7} gap={3} minOpacity={0.3} />
            </span>
            <span>{brandName}正在生成{mode === "video" ? "视频" : "图像"}{progress ? ` · ${progress}` : ""}</span>
            <span className="sr-only">
                {brandName}正在生成{mode === "video" ? "视频" : "图像"}
            </span>
        </div>
    );
}

export function CreationMessageReferences({ references }: { references: CreationReference[] }) {
    return (
        <div className="creation-user-message-references" aria-label="本次引用">
            {references.map((reference) => {
                const Icon = reference.kind === "skill" ? Sparkles : reference.kind === "image" ? ImageIcon : reference.kind === "video" ? Film : reference.kind === "audio" ? Music2 : FileText;
                const imageUrl = reference.kind === "image" ? resolveResourceUrl(reference.storageKey, reference.previewUrl) : reference.previewUrl;
                return (
                    <span key={reference.id} className="creation-user-message-reference">
                        {imageUrl && reference.kind === "video" ? (
                            <video src={imageUrl} muted playsInline preload="metadata" aria-label={reference.label} />
                        ) : imageUrl && reference.kind === "image" ? (
                            <CachedResourceImage storageKey={reference.storageKey} src={imageUrl} alt="" loading="lazy" decoding="async" />
                        ) : (
                            <Icon />
                        )}
                        <span>{reference.label}</span>
                    </span>
                );
            })}
        </div>
    );
}

export function CreationMediaPreviewModal({ url, type, onClose }: { url: string; type: "image" | "video"; onClose: () => void }) {
    if (type === "image") return <CanvasImagePreview src={url} alt="媒体预览" onClose={onClose} />;

    return (
        <AppModal flush open={Boolean(url)} title={null} footer={null} centered destroyOnHidden width="min(1160px, calc(100vw - 32px))" onCancel={onClose} className="creation-media-preview-modal">
            {url ? <video controls autoPlay className="creation-media-preview-video" src={url} /> : null}
        </AppModal>
    );
}

export function CreationAttachmentThumbnail({ item, onPreview, onRemove }: { item: CreationAttachment; onPreview: (type: "image" | "video", url: string) => void; onRemove: (id: string) => void }) {
    const kind = creationAttachmentKind(item);
    const previewable = kind === "image" || kind === "video";
    const url = (kind === "video" ? item.url : item.previewUrl) || "";
    const imageUrl = kind === "image" ? resolveResourceUrl(item.storageKey, item.previewUrl) : "";
    const previewUrl = kind === "image" ? imageUrl : url;
    const content =
        kind === "video" ? (
            <video src={item.url} poster={item.previewUrl !== item.url ? item.previewUrl : undefined} muted playsInline preload="metadata" aria-label={item.name} />
        ) : kind === "image" ? (
            <CachedResourceImage
                storageKey={item.storageKey}
                src={imageUrl}
                alt={item.name}
                loading="lazy"
                decoding="async"
                fallback={
                    <span className="creation-chat-file-icon">
                        <ImageIcon />
                    </span>
                }
            />
        ) : (
            <span className="creation-chat-file-icon">
                {kind === "audio" ? <Music2 /> : <FileText />}
                <em>{item.name}</em>
            </span>
        );
    return (
        <div className="creation-reference-card-content">
            {previewable ? (
                <button type="button" className="creation-reference-card-preview" onClick={() => onPreview(kind === "video" ? "video" : "image", previewUrl)} aria-label={`放大预览 ${item.name}`} disabled={!previewUrl}>
                    {content}
                    <span aria-hidden="true">
                        <Maximize2 />
                    </span>
                </button>
            ) : (
                <div className="creation-reference-card-preview is-file" aria-label={item.name}>
                    {content}
                </div>
            )}
            <button
                type="button"
                className="creation-reference-card-remove"
                onPointerDownCapture={(event) => event.stopPropagation()}
                onMouseDownCapture={(event) => event.stopPropagation()}
                onClick={(event) => {
                    event.stopPropagation();
                    onRemove(item.id);
                }}
                aria-label={`移除 ${item.name}`}
            >
                <X />
            </button>
        </div>
    );
}

export type CreationThinking = { title: string; hint: string; steps: string[]; activity: string };

export function thinkingFor(mode: CreationMode, brandName: string): CreationThinking {
    if (mode === "image") return { title: "正在为你画这一镜", hint: `${brandName}正在理解你的构图意图，并把画面交给模型出图。`, steps: ["理解构图", "定调画风", "生成画面"], activity: "正在理解构图并把画面交给模型出图" };
    if (mode === "text") return { title: "正在为你写这段", hint: `${brandName}正在梳理你的创作脉络，组织语言与结构。`, steps: ["梳理脉络", "组织语言", "输出段落"], activity: "正在梳理脉络并组织语言" };
    return { title: "正在为你拍这一镜", hint: `${brandName}正在拆解你的镜头脚本，设计运镜与光线，并交给模型渲染成片。`, steps: ["拆解镜头", "设计运镜", "定调布光", "渲染成片"], activity: "正在按导演思路拆解镜头并渲染" };
}

export function formatMessageTime(value: string) {
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? conversationTimeFormatter.format(timestamp) : "";
}
