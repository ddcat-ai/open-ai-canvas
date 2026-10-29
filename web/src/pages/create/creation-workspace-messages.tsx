// 创作页消息流：用户消息、媒体结果、生成中占位、引用素材与预览。

import { conversationTimeFormatter, type CreationMessage } from "./creation-types";
import { creationMessageNeedsResultSync } from "./creation-conversations";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { AlertCircle, AlertTriangle, CircleStop, CloudOff, Copy, Download, FileText, Film, Image as ImageIcon, ImageOff, Maximize2, Music2, Pencil, RefreshCw, RotateCcw, UserRound, X, type LucideIcon, Blocks, Orbit } from "lucide-react";
import { GenerationToolCard, type GenerationToolStatus } from "@/components/ai/generation-tool-card";
import { GenerationPhaseSteps } from "@/components/ai/generation-phase-steps";
import { MessageReasoning } from "@/components/ai/message-reasoning";
import { AIMessageMarkdown } from "@/components/ai/ai-message-markdown";
import { WorkingDots } from "@/components/ai/working-indicator";
import { UserAvatar } from "@/components/layout/user-avatar";
import { generationErrorMessage } from "@/lib/generation-error";
import { generationPhaseHint, generationPhaseLabel, generationPhaseStep, generationTaskPhase, generationTaskSavingState, generationTaskShowsProgress, type GenerationPhase } from "@/lib/generation-task-display";
import { useTaskElapsed } from "@/hooks/use-task-elapsed";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useCopyText } from "@/hooks/use-copy-text";
import { type CreationReference, displayCreationPrompt } from "./creation-references";
import { useUserStore } from "@/stores/use-user-store";
import { type CreationAttachment, creationAttachmentKind, creationMediaAspectRatio, type CreationMode } from "./creation-assets";
import { getResourceAccess, resolveResourceAccessURL, resolveResourceUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { Tooltip } from "@/components/ui/base/tooltip";
import { useAssetStore, type Asset, type ImageAsset, type VideoAsset } from "@/stores/use-asset-store";
import { creationResultAssetIds, creationResultStorageKeys } from "@/lib/canvas/canvas-asset-handoff";
import { resolveMediaUrl } from "@/services/file-storage";
import { resolveImageUrl } from "@/services/image-storage";
import { Button } from "antd";
import { CanvasImagePreview } from "@/components/canvas/canvas-image-preview";
import { AppModal } from "@/components/ui/product/app-modal";
import { creationResultEntries } from "./creation-result-urls";

export function CreationMessageView({
    item,
    shotNumber,
    onRetryFailure,
    onRefreshResult,
    onRecoverMedia,
    refreshingResult = false,
    onCreateVariant,
    onEditUserMessage,
    onContinueCanvas,
    openingCanvas,
}: {
    item: CreationMessage;
    shotNumber: number;
    onRetryFailure: () => void;
    onRefreshResult: () => void;
    onRecoverMedia: () => void;
    refreshingResult?: boolean;
    onCreateVariant: () => void;
    onEditUserMessage: (text: string) => void;
    onContinueCanvas: (ids?: string[]) => void;
    openingCanvas: boolean;
}) {
    const brandName = useAppearanceStore((state) => state.appearance.brandName);
    if (item.role === "user") return <CreationUserMessage item={item} shotNumber={shotNumber} onEditUserMessage={onEditUserMessage} />;
    const mode = item.mode || "text";
    const messageState = creationMessageState(item);
    const stateChip = messageState ? (
        <span className={`creation-message-state is-${messageState.tone}`}>
            {messageState.tone === "pending" || messageState.tone === "syncing" ? <i aria-hidden="true" /> : null}
            {messageState.label}
        </span>
    ) : null;
    const heading =
        mode !== "text" ? (
            <>
                {shotNumber > 0 ? <span className="creation-shot-badge">镜 {shotNumber}</span> : null}
                <span className="creation-message-mark">
                    <Orbit />
                </span>
                <strong>{mode === "image" ? "图像生成" : "视频生成"}</strong>
                {item.status === "done" ? <span className="creation-message-progress-copy">你的{mode === "video" ? "视频" : "图像"}已创建</span> : null}
                {item.status === "done" ? (
                    <button type="button" className="creation-message-variant-action" onClick={onCreateVariant}>
                        <RefreshCw />
                        生成同款
                    </button>
                ) : null}
                {item.createdAt ? <time dateTime={item.createdAt}>{formatMessageTime(item.createdAt)}</time> : null}
                {stateChip}
            </>
        ) : (
            <>
                {shotNumber > 0 ? <span className="creation-shot-badge">镜 {shotNumber}</span> : null}
                <span className="creation-message-mark">
                    <Orbit />
                </span>
                <strong>{brandName}</strong>
                {item.createdAt ? <time dateTime={item.createdAt}>{formatMessageTime(item.createdAt)}</time> : null}
                {stateChip}
            </>
        );
    const toolStatus: GenerationToolStatus = item.status === "pending" ? "running" : item.status === "error" ? "error" : item.status === "cancelled" ? "cancelled" : "completed";
    return (
        <article className={`creation-assistant-message is-${mode}`}>
            {mode === "text" ? (
                <>
                    <div className="creation-message-heading">{heading}</div>
                    {item.reasoning ? (
                        <div className="creation-message-reasoning-wrap">
                            <MessageReasoning reasoning={item.reasoning} isStreaming={item.status === "streaming"} />
                        </div>
                    ) : null}
                    <div className="creation-message-content">
                        {item.content ? (
                            <AIMessageMarkdown isStreaming={item.status === "streaming"}>{item.content}</AIMessageMarkdown>
                        ) : (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                                <WorkingDots dotSize={5} gap={2} />
                                <span>正在生成…</span>
                            </span>
                        )}
                    </div>
                    {item.syncInterrupted && (item.status === "pending" || item.status === "streaming") ? (
                        <div className="creation-message-content">
                            <CreationSyncNotice refreshing={refreshingResult} onRefresh={onRefreshResult} onRetry={onRetryFailure} />
                        </div>
                    ) : null}
                </>
            ) : (
                <GenerationToolCard status={toolStatus} heading={heading}>
                    <MediaResult
                        item={item}
                        onRetryFailure={onRetryFailure}
                        onRefreshResult={onRefreshResult}
                        onRecoverMedia={onRecoverMedia}
                        refreshingResult={refreshingResult}
                        onCreateVariant={onCreateVariant}
                        onContinueCanvas={onContinueCanvas}
                        openingCanvas={openingCanvas}
                    />
                </GenerationToolCard>
            )}
            {item.error && mode === "text" ? (
                <div className="creation-message-error">
                    <span>{generationErrorMessage(item.error)}</span>
                    <button type="button" onClick={onRetryFailure}>
                        <RefreshCw />
                        重新生成
                    </button>
                </div>
            ) : null}
        </article>
    );
}

type CreationMessageStateTone = "pending" | "syncing" | "sync" | "error" | "cancelled";

// 消息头部的状态标签：区分“生成中 / 重新连接中 / 结果待同步 / 生成失败 / 已停止”，不把页面没跟上说成生成失败。
function creationMessageState(item: CreationMessage): { tone: CreationMessageStateTone; label: string } | null {
    if (item.status === "pending" || item.status === "streaming") return item.syncInterrupted ? { tone: "syncing", label: "重新连接中" } : item.status === "pending" ? { tone: "pending", label: "生成中" } : null;
    if (item.status === "cancelled") return { tone: "cancelled", label: "已停止" };
    if (item.status === "error") {
        if (creationMessageNeedsResultSync(item)) return { tone: "sync", label: "结果待同步" };
        return item.mediaRecoverable ? { tone: "sync", label: "保存未完成" } : { tone: "error", label: "生成失败" };
    }
    return null;
}

function CreationSyncNotice({ refreshing, onRefresh, onRetry }: { refreshing: boolean; onRefresh: () => void; onRetry: () => void }) {
    return (
        <div className="creation-sync-notice" role="status">
            <span>
                <CloudOff aria-hidden="true" />
                连接中断，正在自动重连
            </span>
            <button type="button" onClick={onRefresh} disabled={refreshing} aria-busy={refreshing || undefined}>
                <RefreshCw aria-hidden="true" className={refreshing ? "animate-spin" : undefined} />
                {refreshing ? "正在刷新" : "立即刷新"}
            </button>
            {/* 原任务一直拿不到（例如已在任务中心删除）时的出口；点击后会先确认再次扣费。 */}
            <button type="button" className="is-quiet" onClick={onRetry}>
                重新生成
            </button>
        </div>
    );
}

export function CreationUserMessage({ item, shotNumber, onEditUserMessage }: { item: CreationMessage; shotNumber: number; onEditUserMessage: (text: string) => void }) {
    const [previewUrl, setPreviewUrl] = useState("");
    const [previewType, setPreviewType] = useState<"image" | "video">("image");
    const copyText = useCopyText();
    const visiblePrompt = displayCreationPrompt(item.content, item.references || []);
    const user = useUserStore((state) => state.user);
    return (
        <article className="creation-user-message">
            <div className="creation-user-message-meta">
                {shotNumber > 0 ? <span className="creation-shot-badge">镜 {shotNumber}</span> : null}
                {item.createdAt ? <time dateTime={item.createdAt}>{formatMessageTime(item.createdAt)}</time> : null}
                <strong>{user?.displayName || "你"}</strong>
                {user ? (
                    <UserAvatar user={user} className="creation-user-avatar" />
                ) : (
                    <span className="creation-user-avatar">
                        <UserRound />
                    </span>
                )}
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
    onRefreshResult,
    onRecoverMedia,
    refreshingResult = false,
    onCreateVariant,
    onContinueCanvas,
    openingCanvas,
}: {
    item: CreationMessage;
    onRetryFailure: () => void;
    onRefreshResult: () => void;
    onRecoverMedia: () => void;
    refreshingResult?: boolean;
    onCreateVariant: () => void;
    onContinueCanvas: (ids?: string[]) => void;
    openingCanvas: boolean;
}) {
    const [previewUrl, setPreviewUrl] = useState("");
    const [previewType, setPreviewType] = useState<"image" | "video">("image");
    const assets = useAssetStore((state) => state.assets);
    const storedResultUrls = item.resultUrls || [];
    const resultStorageKeys = item.resultStorageKeys?.length ? item.resultStorageKeys : creationResultStorageKeys(assets, { messageId: item.id, taskIds: item.taskIds || [], resultUrls: storedResultUrls });
    // 展示地址按 storageKey 保存；effect 重跑（素材库更新、续签）时不回退到历史 hint。
    const [resolvedByKey, setResolvedByKey] = useState<Record<string, string>>({});
    const [failedByKey, setFailedByKey] = useState<Record<string, boolean>>({});

    useEffect(() => {
        let active = true;
        const timers: ReturnType<typeof setTimeout>[] = [];
        const updateResultUrl = (storageKey: string, url: string) => {
            if (!active || !url) return;
            setResolvedByKey((current) => (current[storageKey] === url ? current : { ...current, [storageKey]: url }));
        };
        const refreshRemote = async (index: number, storageKey: string): Promise<void> => {
            try {
                const access = await getResourceAccess(storageKey, "display");
                if (!active) return;
                updateResultUrl(storageKey, resolveResourceAccessURL(access.url));
                const refreshAt = access.refreshAt ? new Date(access.refreshAt).getTime() : Number.NaN;
                const expiresAt = access.expiresAt ? new Date(access.expiresAt).getTime() : Number.NaN;
                const nextRefreshAt = Number.isFinite(refreshAt) ? refreshAt : expiresAt;
                const delay = Number.isFinite(nextRefreshAt) ? Math.max(10_000, nextRefreshAt - Date.now()) : 4 * 60_000;
                timers.push(setTimeout(() => void refreshRemote(index, storageKey), delay));
            } catch {
                if (!active) return;
                setFailedByKey((current) => (current[storageKey] ? current : { ...current, [storageKey]: true }));
                timers.push(setTimeout(() => void refreshRemote(index, storageKey), 60_000));
            }
        };
        if (!resultStorageKeys.length) {
            return () => {
                active = false;
            };
        }
        // 历史记录只把 URL 当作短期 hint；真正恢复依赖稳定 storageKey，展示 URL 由访问缓存按需续签。
        const resolver = item.mode === "video" ? resolveMediaUrl : resolveImageUrl;
        void Promise.all(
            resultStorageKeys.map(async (storageKey, index) => {
                if (resourceIdFromStorageKey(storageKey)) {
                    await refreshRemote(index, storageKey);
                    return;
                }
                const url = await resolver(storageKey, storedResultUrls[index] || "");
                updateResultUrl(storageKey, url);
            }),
        ).catch(() => {
            // 保留当前页面已有的 URL hint；若已过期，页面会走明确的媒体空态而不是回退到平台正文代理。
        });
        return () => {
            active = false;
            timers.forEach((timer) => clearTimeout(timer));
        };
    }, [item.id, item.mode, resultStorageKeys.join("|"), storedResultUrls.join("|")]);

    const isVideo = item.mode === "video";
    // 每个结果的加载状态与重试次数按 storageKey 记录；重试会换一个元素重新请求，并强制续签访问地址。
    const [mediaStates, setMediaStates] = useState<Record<string, "loaded" | "error">>({});
    const [mediaAttempts, setMediaAttempts] = useState<Record<string, number>>({});
    const [naturalRatios, setNaturalRatios] = useState<Record<string, number>>({});
    const markResultMedia = (key: string, state: "loaded" | "error") => setMediaStates((current) => (current[key] === state ? current : { ...current, [key]: state }));
    const retryResultMedia = (key: string) => {
        setMediaStates(({ [key]: _failed, ...rest }) => rest);
        setMediaAttempts((current) => ({ ...current, [key]: (current[key] || 0) + 1 }));
        if (!resourceIdFromStorageKey(key)) return;
        void getResourceAccess(key, "display", "original", "", { forceRefresh: true })
            .then((access) => setResolvedByKey((current) => ({ ...current, [key]: resolveResourceAccessURL(access.url) })))
            .catch(() => markResultMedia(key, "error"));
    };
    const fallbackRatio = creationAspectRatioValue(creationMediaAspectRatio(item.settings?.ratio, item.mode || "image"));
    const { entries: resultEntries, resolving } = creationResultEntries({ storageKeys: resultStorageKeys, storedUrls: storedResultUrls, resolvedByKey, failedByKey, isVideo, isRemoteKey: (storageKey) => Boolean(resourceIdFromStorageKey(storageKey)) });
    const alignedResultUrls = resultStorageKeys.length ? resultStorageKeys.map((storageKey) => resultEntries.find((entry) => entry.key === storageKey)?.url || "") : resultEntries.map((entry) => entry.url);
    const displayResultUrls = resultEntries.map((entry) => entry.url);
    const resultAssetIds = alignedResultUrls.length || resultStorageKeys.length ? creationResultAssetIds(assets, { messageId: item.id, taskIds: item.taskIds || [], resultUrls: alignedResultUrls, resultStorageKeys }) : [];
    const expectedResultCount = resultStorageKeys.length || alignedResultUrls.length;
    const canContinueWithResults = expectedResultCount > 0 && resultAssetIds.length === expectedResultCount;
    if (item.status === "pending") return <CreationMediaPending item={item} refreshing={refreshingResult} onRefresh={onRefreshResult} onRetry={onRetryFailure} />;
    if ((item.status === "error" || item.status === "cancelled") && !expectedResultCount) return <CreationMediaFailure item={item} refreshing={refreshingResult} onRefresh={onRefreshResult} onRecoverMedia={onRecoverMedia} onRetry={onRetryFailure} />;
    // 远端结果首次解析中不显示空态，避免先闪「没有返回可预览结果」再出现结果。
    if (!expectedResultCount || (!displayResultUrls.length && !resolving))
        return (
            <CreationMediaNotice
                tone="neutral"
                icon={ImageOff}
                title="暂时没有可预览的结果"
                description={item.taskIds?.length ? "结果可能还在载入或链接已过期，重新获取不会重新生成。" : "这次生成没有返回可预览的内容。"}
                actions={
                    item.taskIds?.length ? (
                        <>
                            <CreationNoticeButton primary icon={RefreshCw} busy={refreshingResult} busyLabel="正在获取" onClick={onRefreshResult}>
                                重新获取结果
                            </CreationNoticeButton>
                            <CreationNoticeButton icon={RotateCcw} onClick={onRetryFailure}>
                                重新生成
                            </CreationNoticeButton>
                        </>
                    ) : (
                        <CreationNoticeButton primary icon={RotateCcw} onClick={onRetryFailure}>
                            重新生成
                        </CreationNoticeButton>
                    )
                }
            />
        );
    const videoKey = resultEntries[0]?.key || resultStorageKeys[0] || "video";
    const videoState = displayResultUrls[0] ? mediaStates[videoKey] || "loading" : "loading";
    // 远端地址还在解析的结果位先按同样尺寸占位，不让结果区塌成一行操作按钮。
    const pendingImageKeys = !isVideo && resolving ? resultStorageKeys.filter((storageKey) => !resultEntries.some((entry) => entry.key === storageKey)) : [];
    return (
        <div className="creation-media-result">
            {isVideo ? (
                <button
                    type="button"
                    className="creation-video-result"
                    data-media-state={videoState}
                    onClick={() => {
                        if (videoState === "error") return retryResultMedia(videoKey);
                        if (!displayResultUrls[0]) return;
                        setPreviewType("video");
                        setPreviewUrl(displayResultUrls[0]);
                    }}
                    aria-label={videoState === "error" ? "视频加载失败，点击重新加载" : "预览生成视频"}
                >
                    {displayResultUrls[0] ? (
                        <video key={`${videoKey}:${mediaAttempts[videoKey] || 0}`} muted preload="metadata" src={displayResultUrls[0]} onLoadedMetadata={() => markResultMedia(videoKey, "loaded")} onError={() => markResultMedia(videoKey, "error")} />
                    ) : null}
                    {videoState === "error" ? <CreationResultMediaError label="视频加载失败，点击重试" /> : null}
                    <span>
                        <Maximize2 />
                        预览视频
                    </span>
                </button>
            ) : (
                <div className="creation-image-result-grid">
                    {resultEntries.map(({ key, url }) => (
                        <button
                            key={key}
                            type="button"
                            className="creation-image-result"
                            data-media-state={mediaStates[key] || "loading"}
                            style={creationResultTileStyle(naturalRatios[key] || creationResultAssetRatio(assets, key) || fallbackRatio)}
                            onClick={() => {
                                if (mediaStates[key] === "error") return retryResultMedia(key);
                                if (mediaStates[key] !== "loaded") return;
                                setPreviewType("image");
                                setPreviewUrl(url);
                            }}
                            aria-label={mediaStates[key] === "error" ? "图片加载失败，点击重新加载" : mediaStates[key] === "loaded" ? "预览生成图片" : "图片加载中"}
                            aria-busy={mediaStates[key] === "loaded" || mediaStates[key] === "error" ? undefined : true}
                        >
                            <img
                                key={`${key}:${mediaAttempts[key] || 0}`}
                                src={url}
                                alt="生成结果"
                                decoding="async"
                                onLoad={(event) => {
                                    const { naturalWidth, naturalHeight } = event.currentTarget;
                                    if (naturalWidth > 0 && naturalHeight > 0) setNaturalRatios((current) => (current[key] === naturalWidth / naturalHeight ? current : { ...current, [key]: naturalWidth / naturalHeight }));
                                    markResultMedia(key, "loaded");
                                }}
                                onError={() => markResultMedia(key, "error")}
                            />
                            {mediaStates[key] === "error" ? <CreationResultMediaError label="图片加载失败，点击重试" /> : null}
                            <span>
                                <Maximize2 />
                            </span>
                        </button>
                    ))}
                    {pendingImageKeys.map((storageKey) => (
                        <i key={`pending:${storageKey}`} className="creation-image-result" data-media-state="loading" style={creationResultTileStyle(creationResultAssetRatio(assets, storageKey) || fallbackRatio)} aria-hidden="true" />
                    ))}
                </div>
            )}
            <div className="creation-media-actions">
                <span>{isVideo ? "视频结果" : `${displayResultUrls.length} 张图片`}</span>
                <Button type="link" size="small" loading={openingCanvas} disabled={!canContinueWithResults} title={canContinueWithResults ? undefined : "素材保存完成后才能转入画布"} onClick={() => onContinueCanvas(resultAssetIds)}>
                    添加到画布
                </Button>
                {displayResultUrls.map((url, index) => (
                    <a key={`download-${index}`} href={url} download>
                        {displayResultUrls.length > 1 ? (
                            `下载 ${index + 1}`
                        ) : (
                            <>
                                <Download />
                                下载
                            </>
                        )}
                    </a>
                ))}
            </div>
            <CreationMediaPreviewModal url={previewUrl} type={previewType} onClose={() => setPreviewUrl("")} />
        </div>
    );
}

/**
 * 生成中卡片：按最终画面比例占位，标题跟随真实任务阶段（排队 / 生成 / 保存 / 载入），
 * 底部三段进度与耗时；页面与任务连接中断时给出“立即刷新”，不把等待中断说成失败。
 */
export function CreationMediaPending({ item, refreshing, onRefresh, onRetry }: { item: CreationMessage; refreshing: boolean; onRefresh: () => void; onRetry: () => void }) {
    const mode: CreationMode = item.mode || "image";
    const kind = mode === "video" ? "video" : "image";
    const phase: GenerationPhase = item.taskIds?.length ? generationTaskPhase({ status: item.generationStatus || "running", stage: item.generationStage, mediaStage: item.generationMediaStage }) : "submitting";
    const uncertain = phase === "uncertain";
    const progress =
        item.taskIds?.length &&
        typeof item.generationProgress === "number" &&
        generationTaskShowsProgress({ status: item.generationStatus || "running", stage: item.generationStage, mediaStage: item.generationMediaStage, progress: item.generationProgress })
            ? item.generationProgress
            : null;
    const elapsed = useTaskElapsed(item.createdAt);
    const hint = generationPhaseHint(phase, kind, item.generationStage);
    const aspectRatio = creationMediaAspectRatio(item.settings?.ratio, mode);
    const specs = creationPendingSpecs(item);
    const Icon = mode === "video" ? Film : ImageIcon;
    return (
        <div
            className={`creation-media-pending is-${mode}`}
            data-phase={phase}
            data-saving={phase === "saving" ? generationTaskSavingState(item.generationStage) : undefined}
            data-sync={item.syncInterrupted ? "interrupted" : undefined}
            style={{ aspectRatio, "--creation-media-ratio": creationAspectRatioValue(aspectRatio) } as CSSProperties}
        >
            <span className="creation-media-pending-surface" aria-hidden="true" />
            {specs ? (
                <span className="creation-media-pending-spec">
                    <Icon aria-hidden="true" />
                    {specs}
                </span>
            ) : null}
            <span className="creation-media-pending-body">
                <span className="creation-media-pending-title" role="status">
                    {generationPhaseLabel(phase, kind, item.generationStage)}
                </span>
                <span className="creation-media-pending-meta">{[progress !== null ? `${progress}%` : "", item.createdAt ? `已用时 ${elapsed}` : ""].filter(Boolean).join(" · ")}</span>
                {hint ? <span className="creation-media-pending-hint">{hint}</span> : null}
            </span>
            <span className="creation-media-pending-foot">
                {item.syncInterrupted ? <CreationSyncNotice refreshing={refreshing} onRefresh={onRefresh} onRetry={onRetry} /> : uncertain ? null : <GenerationPhaseSteps step={generationPhaseStep(phase)} progress={progress} />}
            </span>
        </div>
    );
}

function creationAspectRatioValue(aspectRatio: string) {
    const [width, height] = aspectRatio.split("/").map((value) => Number(value.trim()));
    return width > 0 && height > 0 ? width / height : 1;
}

export function creationResultAssetRatio(assets: Asset[], storageKey: string) {
    const asset = assets.find((candidate): candidate is ImageAsset | VideoAsset => (candidate.kind === "image" || candidate.kind === "video") && candidate.data.storageKey === storageKey);
    return asset && asset.data.width > 0 && asset.data.height > 0 ? asset.data.width / asset.data.height : undefined;
}

// 结果图块按真实比例预留宽高：已知素材尺寸优先，其次生成时选的画面比例；竖图按最大高度收窄宽度。
function creationResultTileStyle(ratio: number): CSSProperties {
    return { aspectRatio: String(ratio), "--creation-result-ratio": ratio } as CSSProperties;
}

function CreationResultMediaError({ label }: { label: string }) {
    return (
        <em className="creation-result-media-error">
            <ImageOff aria-hidden="true" />
            {label}
        </em>
    );
}

function creationPendingSpecs(item: CreationMessage) {
    const settings = item.settings;
    if (!settings) return "";
    const ratio = settings.ratio && settings.ratio.toLowerCase() !== "auto" ? settings.ratio : "";
    if (item.mode === "video") return [ratio, settings.seconds ? `${settings.seconds} 秒` : "", settings.videoQuality ? `${settings.videoQuality.replace(/p$/i, "")}P` : ""].filter(Boolean).join(" · ");
    const count = Number(settings.count) || 1;
    return [ratio, count > 1 ? `${count} 张` : ""].filter(Boolean).join(" · ");
}

/**
 * 失败卡片按“下一步该做什么”分三类：
 * 作品可能已生成（页面没拿到结果）→ 重新获取；作品已生成但保存失败 → 重新保存；后端确认失败 → 重新生成。
 */
function CreationMediaFailure({ item, refreshing, onRefresh, onRecoverMedia, onRetry }: { item: CreationMessage; refreshing: boolean; onRefresh: () => void; onRecoverMedia: () => void; onRetry: () => void }) {
    const reason = generationErrorMessage(item.error || "生成失败");
    if (item.status === "cancelled") {
        return (
            <CreationMediaNotice
                tone="neutral"
                icon={CircleStop}
                title="已停止生成"
                description={item.content && item.content !== "已停止" ? item.content : "可以调整后重新生成。"}
                actions={
                    <CreationNoticeButton icon={RotateCcw} onClick={onRetry}>
                        重新生成
                    </CreationNoticeButton>
                }
            />
        );
    }
    if (creationMessageNeedsResultSync(item)) {
        return (
            <CreationMediaNotice
                tone="warning"
                icon={CloudOff}
                title="结果暂未同步"
                description="作品可能已在后台生成，只是页面没有及时拿到。重新获取不会重新生成，也不会重复扣费。"
                detail={reason ? `原因：${reason}` : undefined}
                actions={
                    <>
                        <CreationNoticeButton primary icon={RefreshCw} busy={refreshing} busyLabel="正在获取" onClick={onRefresh}>
                            重新获取结果
                        </CreationNoticeButton>
                        <CreationNoticeButton icon={RotateCcw} onClick={onRetry}>
                            重新生成
                        </CreationNoticeButton>
                    </>
                }
            />
        );
    }
    if (item.mediaRecoverable) {
        return (
            <CreationMediaNotice
                tone="warning"
                icon={AlertTriangle}
                title="作品已生成，保存未完成"
                description="保存到素材库时出错。重新保存会接着上次的进度，不会重新生成，也不会重复扣费。"
                detail={reason ? `原因：${reason}` : undefined}
                actions={
                    <>
                        <CreationNoticeButton primary icon={RefreshCw} busy={refreshing} busyLabel="正在保存" onClick={onRecoverMedia}>
                            重新保存
                        </CreationNoticeButton>
                        <CreationNoticeButton icon={RotateCcw} onClick={onRetry}>
                            重新生成
                        </CreationNoticeButton>
                    </>
                }
            />
        );
    }
    const started = Boolean(item.taskIds?.length);
    return (
        <CreationMediaNotice
            tone="error"
            icon={AlertCircle}
            title={started ? "生成失败" : "未能开始生成"}
            description={reason}
            actions={
                <CreationNoticeButton primary icon={RotateCcw} onClick={onRetry}>
                    {started ? "重新生成" : "重新编辑"}
                </CreationNoticeButton>
            }
        />
    );
}

function CreationMediaNotice({ tone, icon: Icon, title, description, detail, actions }: { tone: "warning" | "error" | "neutral"; icon: LucideIcon; title: string; description: string; detail?: string; actions: ReactNode }) {
    return (
        <div className={`creation-media-notice is-${tone}`}>
            <span className="creation-media-notice-icon" aria-hidden="true">
                <Icon />
            </span>
            <div className="creation-media-notice-copy">
                <strong>{title}</strong>
                <p>{description}</p>
                {detail ? <small>{detail}</small> : null}
            </div>
            <div className="creation-media-notice-actions">{actions}</div>
        </div>
    );
}

function CreationNoticeButton({ primary = false, icon: Icon, busy = false, busyLabel, onClick, children }: { primary?: boolean; icon: LucideIcon; busy?: boolean; busyLabel?: string; onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" className={primary ? "is-primary" : undefined} onClick={onClick} disabled={busy} aria-busy={busy || undefined}>
            <Icon aria-hidden="true" className={busy ? "animate-spin" : undefined} />
            {busy && busyLabel ? busyLabel : children}
        </button>
    );
}

export function CreationMessageReferences({ references }: { references: CreationReference[] }) {
    return (
        <div className="creation-user-message-references" aria-label="本次引用">
            {references.map((reference) => {
                const Icon = reference.kind === "skill" ? Blocks : reference.kind === "image" ? ImageIcon : reference.kind === "video" ? Film : reference.kind === "audio" ? Music2 : FileText;
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
