// 当前镜头的媒体核查与引用来源；复用画布媒体、批次和 AntD 控件，明暗样式由 workspace/text/status token 提供。
import { Button } from "antd";
import { ArrowUpRight, Film, Image as ImageIcon, Link2, Play, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { CachedResourceImage } from "@/components/cached-resource-image";
import { AppModal } from "@/components/ui/product/app-modal";
import { getGenerationResourceNodes } from "@/lib/canvas/canvas-resource-references";
import { storyboardAssetRoleForNode } from "@/lib/canvas/canvas-storyboard-assets";
import { isStoryboardPreviewAsset, storyboardRowReferenceNodeIds } from "@/lib/canvas/canvas-storyboard-materializer";
import { generationErrorMessage } from "@/lib/generation-error";
import { getActiveUserScope } from "@/lib/user-scope";
import { resolveMediaUrl, resolveVideoMediaUrl } from "@/services/file-storage";
import { CanvasNodeType, type CanvasConnection, type CanvasGenerationBatch, type CanvasGenerationBatchItem, type CanvasNodeData, type StoryboardRow } from "@/types/canvas";
import { storyboardGenerationTargets } from "./canvas-script-editor-model";
import { generationBatchItemLabel } from "./canvas-script-node-parts";
import { CanvasVideoPreviewImage } from "./canvas-video-preview-image";
import { AssetThumbnail, STORYBOARD_ASSET_ROLE_LABELS } from "./storyboard-assets-cell";
import "./canvas-script-editor-production.css";

type StoryboardShotProductionProps = {
    script: CanvasNodeData;
    row: StoryboardRow;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    batch?: CanvasGenerationBatch;
    readOnly: boolean;
    onEditAssets: () => void;
    onFocusOutput: (nodeId: string) => void;
    onGenerateImages: () => void;
    onGenerateVideos: () => void;
    onRetryBatchItem?: (batchId: string, itemId: string) => void;
};

type ShotBatchItem = { batch: CanvasGenerationBatch; item: CanvasGenerationBatchItem };

const ACTIVE_ITEM_STATUSES = new Set<CanvasGenerationBatchItem["status"]>(["waiting", "submitting", "queued", "running"]);

export function StoryboardShotProduction({ script, row, nodes, connections, batch, readOnly, onEditAssets, onFocusOutput, onGenerateImages, onGenerateVideos, onRetryBatchItem }: StoryboardShotProductionProps) {
    const [preview, setPreview] = useState<{ scriptId: string; rowId: string; nodeId: string } | null>(null);
    const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
    const imageNode = row.imageNodeId ? nodeById.get(row.imageNodeId) : undefined;
    const videoNode = row.videoNodeId ? nodeById.get(row.videoNodeId) : undefined;
    const keyframeMode = script.metadata?.storyboardVideoInputMode === "keyframe";
    const locked = readOnly || Boolean(script.metadata?.locked);
    const targets = storyboardGenerationTargets(script, [row], nodes);
    const imageBatch = shotBatchItem(script, row, "storyboard_image", row.imageNodeId, batch);
    const videoBatch = shotBatchItem(script, row, "storyboard_video", row.videoNodeId, batch);
    const originalVideoInputIssue = videoNode && videoBatch?.item.costUncertain ? originalVideoFrameIssue(videoNode, nodes, connections) : "";
    const references = useMemo(() => shotReferences(script, row, nodes, connections), [script, row, nodes, connections]);
    const previewNode = preview?.scriptId === script.id && preview.rowId === row.id ? nodeById.get(preview.nodeId) : undefined;

    useEffect(() => setPreview(null), [script.id, row.id]);

    const openPreview = (nodeId: string) => setPreview({ scriptId: script.id, rowId: row.id, nodeId });
    return (
        <section className="storyboard-shot-production" aria-label={`镜头 ${row.shotNumber} 的画面与资产`} data-slot="storyboard-shot-production">
            {imageNode?.metadata?.content || imageNode?.metadata?.storageKey || videoNode?.metadata?.content || videoNode?.metadata?.storageKey ? (
                <p className="canvas-script-editor-detail-note">表格修改将在后续生成时使用；进入画布后显示已有作品和配置，可继续调整。</p>
            ) : null}
            <ShotOutput
                label="镜头视频"
                kind="video"
                shotNumber={row.shotNumber}
                node={videoNode?.type === CanvasNodeType.Video ? videoNode : undefined}
                batchItem={videoBatch}
                readOnly={locked}
                canGenerate={targets.videoIds.includes(row.id) || targets.uncertainVideoIds.includes(row.id)}
                originalInputIssue={originalVideoInputIssue}
                emptyHint={!(row.videoMotionPrompt || row.plotDescription).trim() ? "请先在镜头内容中补充画面或视频提示词。" : targets.missingKeyframeCount ? "生成并核对本镜首帧后，再制作视频。" : "依据当前镜头内容和引用资产制作视频。"}
                onGenerate={onGenerateVideos}
                onPreview={openPreview}
                onFocusOutput={onFocusOutput}
                onRetryBatchItem={onRetryBatchItem}
            />
            <ShotOutput
                label={keyframeMode ? "视频首帧" : "分镜图"}
                kind="image"
                shotNumber={row.shotNumber}
                node={imageNode?.type === CanvasNodeType.Image ? imageNode : undefined}
                batchItem={imageBatch}
                readOnly={locked}
                canGenerate={targets.imageIds.includes(row.id) || targets.uncertainImageIds.includes(row.id)}
                emptyHint={!(row.imageGenerationPrompt || row.plotDescription).trim() ? "请先在镜头内容中补充画面或图片提示词。" : keyframeMode ? "先检查人物、服装与场景，再以这张图生成视频。" : "可先生成画面，核对人物、服装与场景。"}
                onGenerate={onGenerateImages}
                onPreview={openPreview}
                onFocusOutput={onFocusOutput}
                onRetryBatchItem={onRetryBatchItem}
            />
            <section className="storyboard-shot-production-section" aria-label="当前镜头引用资产">
                <div className="storyboard-shot-production-heading">
                    <h3>
                        引用资产 <span>{references.length}</span>
                    </h3>
                    <Button size="small" type="text" onClick={onEditAssets} disabled={locked}>
                        配置资产
                    </Button>
                </div>
                {references.length ? (
                    <>
                        <p className="storyboard-shot-production-hint">当前配置；用途和来源显示在资产下方。</p>
                        <ul className="storyboard-shot-production-references">
                            {references.map((reference) => (
                                <li key={reference.id} className="storyboard-shot-production-reference" data-missing={!reference.node || undefined}>
                                    {reference.node && isStoryboardPreviewAsset(reference.node) ? (
                                        <button type="button" className="storyboard-shot-production-thumbnail" onClick={() => openPreview(reference.id)} aria-label={`预览资产 ${reference.node.title || "未命名资产"}`}>
                                            <AssetThumbnail node={reference.node} />
                                        </button>
                                    ) : (
                                        <span className="storyboard-shot-production-thumbnail" aria-hidden="true">
                                            <Link2 />
                                        </span>
                                    )}
                                    <div className="storyboard-shot-production-reference-copy">
                                        <strong>{reference.node?.title || (reference.node ? "未命名资产" : "资产已失效")}</strong>
                                        <span>
                                            {reference.role}
                                            {reference.targets.length ? ` · 用于${reference.targets.join("、")}` : " · 未参与当前生成"}
                                        </span>
                                        <span className="storyboard-shot-production-reference-source">{reference.sources.join(" · ")}</span>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </>
                ) : (
                    <p className="storyboard-shot-production-hint">尚未关联参考资产，可配置人物、场景或道具。</p>
                )}
            </section>
            <AppModal title={previewNode?.title || "媒体预览"} open={Boolean(previewNode)} onCancel={() => setPreview(null)} footer={null} width="min(960px, calc(100vw - 32px))" centered rootClassName="storyboard-shot-production-preview-modal">
                {previewNode ? <ShotMediaPreview key={previewNode.id} node={previewNode} /> : null}
            </AppModal>
        </section>
    );
}

function ShotOutput({
    label,
    kind,
    shotNumber,
    node,
    batchItem,
    readOnly,
    canGenerate,
    originalInputIssue = "",
    emptyHint,
    onGenerate,
    onPreview,
    onFocusOutput,
    onRetryBatchItem,
}: {
    label: string;
    kind: "image" | "video";
    shotNumber: number;
    node?: CanvasNodeData;
    batchItem?: ShotBatchItem;
    readOnly: boolean;
    canGenerate: boolean;
    originalInputIssue?: string;
    emptyHint: string;
    onGenerate: () => void;
    onPreview: (nodeId: string) => void;
    onFocusOutput: (nodeId: string) => void;
    onRetryBatchItem?: (batchId: string, itemId: string) => void;
}) {
    const hasResult = Boolean(node?.metadata?.content || node?.metadata?.storageKey);
    const activeBatchItem = batchItem && ACTIVE_ITEM_STATUSES.has(batchItem.item.status) ? batchItem.item : undefined;
    const busy = node?.metadata?.status === "loading" || Boolean(activeBatchItem);
    const failed = !busy && (node?.metadata?.status === "error" || (!hasResult && batchItem?.item.status === "failed"));
    const error = failed ? generationErrorMessage(batchItem?.item.status === "failed" ? batchItem.item.errorDetails || node?.metadata?.errorDetails : node?.metadata?.errorDetails) : "";
    const costUncertain = Boolean(batchItem?.item.costUncertain);
    const retryOriginal = node && batchItem?.item.status === "failed" && onRetryBatchItem ? () => onRetryBatchItem(batchItem.batch.id, batchItem.item.id) : undefined;
    const status = busy
        ? activeBatchItem
            ? generationBatchItemLabel(activeBatchItem)
            : "生成中"
        : failed
          ? "生成失败"
          : hasResult
            ? "已有结果"
            : batchItem?.item.status === "cancelled"
              ? "已停止"
              : batchItem?.item.status === "succeeded"
                ? "结果暂不可用"
                : "尚未生成";
    const Icon = kind === "video" ? Film : ImageIcon;
    return (
        <section className="storyboard-shot-production-section" aria-label={label}>
            <div className="storyboard-shot-production-heading">
                <h3>
                    <Icon />
                    {label}
                </h3>
                <span className="storyboard-shot-production-status" data-tone={failed ? "error" : busy ? "loading" : hasResult ? "success" : "idle"} role="status">
                    {status}
                </span>
            </div>
            {hasResult && node ? (
                <button type="button" className={`storyboard-shot-production-result is-${kind}`} onClick={() => onPreview(node.id)} aria-label={`预览镜头 ${shotNumber} ${label}`}>
                    {kind === "video" ? (
                        <>
                            <CanvasVideoPreviewImage
                                node={node}
                                alt={`镜头 ${shotNumber} 视频封面`}
                                fallback={
                                    <span className="storyboard-shot-production-result-fallback">
                                        <Film />
                                        查看视频
                                    </span>
                                }
                            />
                            <span className="storyboard-shot-production-play">
                                <Play />
                            </span>
                        </>
                    ) : (
                        <CachedResourceImage
                            storageKey={node.metadata?.storageKey}
                            src={node.metadata?.content}
                            alt={`镜头 ${shotNumber} ${label}`}
                            loading="lazy"
                            loadingFallback={<span className="storyboard-shot-production-result-fallback">正在载入画面…</span>}
                            fallback={<span className="storyboard-shot-production-result-fallback">图片暂时无法载入</span>}
                        />
                    )}
                </button>
            ) : (
                <p className="storyboard-shot-production-hint">{busy ? "任务已提交，生成结果会显示在这里。" : failed ? "本镜头还没有可用结果。" : batchItem?.item.status === "succeeded" ? "任务已完成，但媒体暂不可用，可前往画布检查。" : emptyHint}</p>
            )}
            {error ? (
                <p className="storyboard-shot-production-error" role="status">
                    {error}
                </p>
            ) : null}
            {failed && !canGenerate ? <p className="storyboard-shot-production-hint">{emptyHint}</p> : null}
            {failed && costUncertain ? <p className="storyboard-shot-production-hint">本次任务费用待确认。重试原任务会继续使用画布任务中的提示词和引用，不会同步本次分镜修改；提交前会再次确认费用。</p> : null}
            {failed && costUncertain && originalInputIssue ? <p className="storyboard-shot-production-error">{originalInputIssue}</p> : null}
            <div className="storyboard-shot-production-actions">
                {!hasResult ? (
                    costUncertain ? (
                        <Button size="small" icon={<RefreshCw />} onClick={retryOriginal} disabled={readOnly || busy || !canGenerate || !retryOriginal || Boolean(originalInputIssue)}>
                            重试原任务
                        </Button>
                    ) : (
                        <Button size="small" type={kind === "video" ? "primary" : "default"} icon={failed ? <RefreshCw /> : <Icon />} onClick={onGenerate} disabled={readOnly || busy || !canGenerate}>
                            {failed ? "按当前分镜重试" : kind === "video" ? "生成本镜视频" : `生成${label}`}
                        </Button>
                    )
                ) : null}
                {node ? (
                    <Button size="small" type="text" icon={<ArrowUpRight />} onClick={() => onFocusOutput(node.id)}>
                        {readOnly ? "在画布中查看" : hasResult ? "在画布中微调" : "在画布中检查"}
                    </Button>
                ) : null}
            </div>
        </section>
    );
}

function originalVideoFrameIssue(node: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const frames = [
        [node.metadata?.videoStartFrameNodeId, "首帧"],
        [node.metadata?.videoEndFrameNodeId, "尾帧"],
    ] as const;
    const inputs = getGenerationResourceNodes(node.id, nodes, connections);
    for (const [id, label] of frames) {
        if (id && !inputs.some((input) => input.id === id && (input.type === CanvasNodeType.Image || input.type === CanvasNodeType.Drawing) && Boolean(input.metadata?.content || input.metadata?.storageKey || input.metadata?.drawingPreviewUrl))) {
            return `原任务的${label}已失效或未连接，请先在画布中修复。`;
        }
    }
    return "";
}

function shotBatchItem(script: CanvasNodeData, row: StoryboardRow, mode: CanvasGenerationBatch["mode"], outputNodeId: string | undefined, supplied?: CanvasGenerationBatch): ShotBatchItem | undefined {
    const batches = [...(script.metadata?.generationBatches || [])];
    if (supplied) {
        const index = batches.findIndex((batch) => batch.id === supplied.id);
        if (index < 0) batches.push(supplied);
        else batches[index] = supplied;
    }
    let latest: ShotBatchItem | undefined;
    for (let index = batches.length - 1; index >= 0; index -= 1) {
        const batch = batches[index];
        if (batch.sourceNodeId !== script.id || batch.mode !== mode) continue;
        const item = batch.items.find((candidate) => candidate.rowId === row.id && (!outputNodeId || candidate.nodeId === outputNodeId));
        if (!item) continue;
        latest ??= { batch, item };
        if (ACTIVE_ITEM_STATUSES.has(item.status)) return { batch, item };
    }
    return latest;
}

function shotReferences(script: CanvasNodeData, row: StoryboardRow, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const imageIds = new Set(storyboardRowReferenceNodeIds(script, row, nodes, connections, false, row.imageNodeId));
    const keyframeMode = script.metadata?.storyboardVideoInputMode === "keyframe";
    const videoIds = new Set(storyboardRowReferenceNodeIds(script, row, nodes, connections, keyframeMode, row.videoNodeId));
    const sharedIds = new Set(script.metadata?.storyboard?.referenceNodeIds || []);
    const bindings = new Map((row.assetBindings || []).map((binding) => [binding.nodeId, binding]));
    const rowInputIds = new Set(connections.filter((connection) => connection.toNodeId === script.id && connection.toHandleId === `row:${row.id}`).map((connection) => connection.fromNodeId));
    const imageInputIds = new Set(connections.filter((connection) => !connection.relation && connection.toNodeId === row.imageNodeId).map((connection) => connection.fromNodeId));
    const videoInputIds = new Set(connections.filter((connection) => !connection.relation && connection.toNodeId === row.videoNodeId).map((connection) => connection.fromNodeId));
    const characterIds = new Set((row.characters || []).map((character) => character.characterAssetId).filter(Boolean));
    const explicitlyBoundCharacters = new Set(
        nodes
            .filter((node) => bindings.has(node.id))
            .map((node) => node.metadata?.characterAssetId)
            .filter(Boolean),
    );
    const configuredIds = new Set([...sharedIds, ...bindings.keys(), ...rowInputIds, ...imageInputIds, ...videoInputIds]);
    const missingIds = [...configuredIds].filter((id) => !nodeById.has(id));
    const referenceIds = [...new Set([...imageIds, ...videoIds, ...missingIds])].filter((id) => id !== script.id);
    return referenceIds.map((id) => {
        const node = nodeById.get(id);
        const binding = bindings.get(id);
        const role = binding?.role || (node ? storyboardAssetRoleForNode(node) : null);
        const sources: string[] = [];
        if (sharedIds.has(id)) sources.push("剧本共用");
        if (binding) sources.push("本镜关联");
        if (node?.metadata?.workflowKind === "character" && characterIds.has(node.metadata.characterAssetId) && !explicitlyBoundCharacters.has(node.metadata.characterAssetId)) sources.push("角色设定");
        if (rowInputIds.has(id)) sources.push("镜头连线");
        if (imageInputIds.has(id)) sources.push("分镜图连线");
        if (videoInputIds.has(id)) sources.push("视频连线");
        if (keyframeMode && id === row.imageNodeId) sources.push("视频首帧");
        return {
            id,
            node,
            role: role ? STORYBOARD_ASSET_ROLE_LABELS[role] : "参考素材",
            sources,
            targets: [imageIds.has(id) ? "分镜图" : "", videoIds.has(id) ? "视频" : ""].filter(Boolean),
        };
    });
}

function ShotMediaPreview({ node }: { node: CanvasNodeData }) {
    if (node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio) return <PlayableShotMedia node={node} />;
    const src = node.metadata?.workflowKind === "character" ? node.metadata.characterCoverUrl : node.type === CanvasNodeType.Drawing ? node.metadata?.drawingPreviewUrl || node.metadata?.content : node.metadata?.content;
    return (
        <div className="storyboard-shot-production-media" data-canvas-no-zoom data-canvas-wheel-scroll>
            {src || node.metadata?.storageKey ? (
                <CachedResourceImage
                    storageKey={node.metadata?.storageKey}
                    src={src}
                    eager
                    alt={node.title || "资产预览"}
                    loadingFallback={
                        <p className="storyboard-shot-production-hint" role="status">
                            正在载入画面…
                        </p>
                    }
                    fallback={<p className="storyboard-shot-production-hint">图片暂时无法载入，请在画布中检查资源。</p>}
                />
            ) : (
                <p className="storyboard-shot-production-hint">这个资产暂时没有可预览的画面。</p>
            )}
        </div>
    );
}

function PlayableShotMedia({ node }: { node: CanvasNodeData }) {
    const scope = getActiveUserScope();
    const storageKey = node.metadata?.storageKey;
    const fallback = node.metadata?.content || "";
    const video = node.type === CanvasNodeType.Video;
    const identity = `${scope}:${node.id}:${storageKey || ""}:${fallback}`;
    const [media, setMedia] = useState({ identity: "", url: "", error: "" });
    useEffect(() => {
        let cancelled = false;
        const resolve = video ? resolveVideoMediaUrl : resolveMediaUrl;
        void resolve(storageKey, fallback)
            .then((url) => {
                if (!cancelled && getActiveUserScope() === scope) setMedia({ identity, url, error: url ? "" : "没有可播放的媒体，请在画布中检查资源。" });
            })
            .catch(() => {
                if (!cancelled && getActiveUserScope() === scope) setMedia({ identity, url: "", error: "媒体暂时无法载入，请在画布中检查资源。" });
            });
        return () => {
            cancelled = true;
        };
    }, [scope, identity, storageKey, fallback, video]);
    const current = media.identity === identity ? media : undefined;
    const onError = () => setMedia({ identity, url: "", error: "媒体播放失败，请在画布中检查资源。" });
    return (
        <div className="storyboard-shot-production-media" data-canvas-no-zoom data-canvas-wheel-scroll>
            {current?.error ? (
                <p className="storyboard-shot-production-error" role="status">
                    {current.error}
                </p>
            ) : current?.url ? (
                video ? (
                    <video src={current.url} controls autoPlay playsInline preload="metadata" aria-label={node.title || "镜头视频"} onError={onError} />
                ) : (
                    <audio src={current.url} controls autoPlay preload="metadata" aria-label={node.title || "音频参考"} onError={onError} />
                )
            ) : (
                <p className="storyboard-shot-production-hint" role="status">
                    正在载入媒体…
                </p>
            )}
        </div>
    );
}
