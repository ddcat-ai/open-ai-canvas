// 创作页消息流：用户消息、媒体结果、生成中占位、引用素材与预览。

import { conversationTimeFormatter, type CreationMessage } from "./creation-types";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { Copy, Download, FileText, Film, Image as ImageIcon, Maximize2, Music2, Pencil, RefreshCw, Sparkles, UserRound, X } from "lucide-react";
import { GenerationToolCard, type GenerationToolStatus } from "@/components/ai/generation-tool-card";
import { MessageReasoning } from "@/components/ai/message-reasoning";
import { AIMessageMarkdown } from "@/components/ai/ai-message-markdown";
import { WorkingDots } from "@/components/ai/working-indicator";
import { UserAvatar } from "@/components/layout/user-avatar";
import { generationErrorMessage } from "@/lib/generation-error";
import { useEffect, useState } from "react";
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
import { creationResultEntries } from "./creation-result-urls";

export function CreationMessageView({
    item,
    shotNumber,
    onRetryFailure,
    onCreateVariant,
    onEditUserMessage,
    onContinueCanvas,
    openingCanvas,
}: {
    item: CreationMessage;
    shotNumber: number;
    onRetryFailure: () => void;
    onCreateVariant: () => void;
    onEditUserMessage: (message: CreationMessage) => void;
    onContinueCanvas: (ids?: string[]) => void;
    openingCanvas: boolean;
}) {
    const brandName = useAppearanceStore((state) => state.appearance.brandName);
    if (item.role === "user") return <CreationUserMessage item={item} shotNumber={shotNumber} onEditUserMessage={onEditUserMessage} />;
    const mode = item.mode || "text";
    const stateLabel = item.status === "pending" ? "生成中" : item.status === "cancelled" ? "已停止" : item.status === "error" ? "生成失败" : "";
    const heading =
        mode !== "text" ? (
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
                {item.status === "done" ? (
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
                </>
            ) : (
                <GenerationToolCard status={toolStatus} heading={heading}>
                    <MediaResult item={item} onRetryFailure={onRetryFailure} onCreateVariant={onCreateVariant} onContinueCanvas={onContinueCanvas} openingCanvas={openingCanvas} />
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

export function CreationUserMessage({ item, shotNumber, onEditUserMessage }: { item: CreationMessage; shotNumber: number; onEditUserMessage: (message: CreationMessage) => void }) {
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
                    <button type="button" className="creation-user-message-edit" aria-label="编辑并重新发送" onClick={() => onEditUserMessage(item)}>
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
    const { entries: resultEntries, resolving } = creationResultEntries({ storageKeys: resultStorageKeys, storedUrls: storedResultUrls, resolvedByKey, failedByKey, isVideo, isRemoteKey: (storageKey) => Boolean(resourceIdFromStorageKey(storageKey)) });
    const alignedResultUrls = resultStorageKeys.length ? resultStorageKeys.map((storageKey) => resultEntries.find((entry) => entry.key === storageKey)?.url || "") : resultEntries.map((entry) => entry.url);
    const displayResultUrls = resultEntries.map((entry) => entry.url);
    const resultAssetIds = alignedResultUrls.length || resultStorageKeys.length ? creationResultAssetIds(assets, { messageId: item.id, taskIds: item.taskIds || [], resultUrls: alignedResultUrls, resultStorageKeys }) : [];
    const expectedResultCount = resultStorageKeys.length || alignedResultUrls.length;
    const canContinueWithResults = expectedResultCount > 0 && resultAssetIds.length === expectedResultCount;
    if (item.status === "pending") return <CreationMediaPending mode={item.mode || "image"} ratio={item.settings?.ratio} />;
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
    // 远端结果首次解析中不显示空态，避免先闪「没有返回可预览结果」再出现结果。
    if (!expectedResultCount || (!displayResultUrls.length && !resolving))
        return (
            <div className="creation-media-empty">
                没有返回可预览结果{" "}
                <button type="button" onClick={onRetryFailure}>
                    重试
                </button>
            </div>
        );
    return (
        <div className="creation-media-result">
            {isVideo ? (
                <button
                    type="button"
                    className="creation-video-result"
                    onClick={() => {
                        if (!displayResultUrls[0]) return;
                        setPreviewType("video");
                        setPreviewUrl(displayResultUrls[0]);
                    }}
                    aria-label="预览生成视频"
                >
                    {displayResultUrls[0] ? <video muted preload="metadata" src={displayResultUrls[0]} /> : null}
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
                            onClick={() => {
                                setPreviewType("image");
                                setPreviewUrl(url);
                            }}
                            aria-label="预览生成图片"
                        >
                            <img src={url} alt="生成结果" />
                            <span>
                                <Maximize2 />
                            </span>
                        </button>
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

export function CreationMediaPending({ mode, ratio }: { mode: CreationMode; ratio?: string }) {
    const brandName = useAppearanceStore((state) => state.appearance.brandName);
    return (
        <div className={`creation-media-pending is-${mode}`} style={{ aspectRatio: creationMediaAspectRatio(ratio, mode) }} aria-live="polite">
            <span className="creation-media-pending-icon">
                <WorkingDots dotSize={7} gap={3} minOpacity={0.3} />
            </span>
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
