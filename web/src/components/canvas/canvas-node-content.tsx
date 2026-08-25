import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { AlertCircle, BookOpenCheck, Clock3, Download, FileText, Image as ImageIcon, LoaderCircle, Music2, Pencil, Play, RefreshCw, Video } from "lucide-react";

import { VideoPlayer } from "@/components/video-player";
import { CONTENT_MODERATION_ERROR_CODE, generationErrorMessage, isContentModerationError } from "@/lib/generation-error";
import { generationTaskShowsProgress, generationTaskStageLabel, generationTaskStatusLabel, isGenerationTaskSubmissionUncertain } from "@/lib/generation-task-display";
import { canvasRichTextHTML } from "@/lib/canvas/canvas-rich-text";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { loadCanvasDrawingPreview } from "@/lib/canvas/canvas-drawing-storage";
import { buildLibTVImagePreviewUrl } from "@/lib/canvas/libtv-import";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { formatBytes } from "@/lib/image-utils";
import { resourceIdFromStorageKey } from "@/services/api/resources";
import type { GenerationTask } from "@/services/api/task-center";
import { cacheResourceObjectUrl, getCachedResourceObjectUrl } from "@/services/resource-blob-cache";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { createDefaultSubtitleStyle } from "@/types/timeline";
import { CanvasResourceMentionTextarea } from "./canvas-resource-mention-textarea";
import { useCanvasNodeActions } from "./canvas-node-action-context";
import { CanvasSubtitleOverlay } from "./canvas-subtitle-overlay";
import { MarkdownNodeContent } from "./nodes/markdown-node";
import { ChartNodeContent } from "./nodes/chart-node";
import { CompareNodeContent } from "./nodes/compare-node";
import { ColorGradeNodeContent } from "./nodes/color-grade-node";
import { HtmlNodeContent } from "./nodes/html-node";
import { PanoramaNodeContent } from "./nodes/panorama-node";
import { SvgNodeContent } from "./nodes/svg-node";

type CanvasNodeContentProps = {
    node: CanvasNodeData;
    theme: CanvasTheme;
    isEditingContent: boolean;
    textareaRef: RefObject<HTMLTextAreaElement | null>;
    isBatchRoot: boolean;
    batchCount: number;
    batchExpanded: boolean;
    batchOpening: boolean;
    batchRecovering: boolean;
    renderNodeContent?: (node: CanvasNodeData) => ReactNode;
    drawingProjectId?: string;
    onContentChange: (nodeId: string, content: string) => void;
    onStopEditing: () => void;
    mentionReferences: CanvasResourceReference[];
    onRetry?: (node: CanvasNodeData) => void;
    onReloadResource?: (node: CanvasNodeData) => void;
    onOpenTaskDetails?: (node: CanvasNodeData) => void;
    onToggleBatch?: () => void;
    reduceMediaEffects?: boolean;
};

export function CanvasNodeContent(props: CanvasNodeContentProps) {
    const hasCustomContent = props.node.type === CanvasNodeType.Config
        || props.node.type === CanvasNodeType.Script
        || Boolean(props.node.metadata?.directorSceneId)
        || (props.node.metadata?.workflowKind === "character" && Boolean(props.node.metadata.characterAssetId))
        || (props.node.metadata?.workflowKind === "story_input" && !props.isEditingContent)
        || (props.node.metadata?.workflowKind === "styleboard" && !props.node.metadata.content);
    if (hasCustomContent && props.renderNodeContent) return props.renderNodeContent(props.node);
    if (props.isBatchRoot) return <ImageNodeContent {...props} />;
    if (props.node.metadata?.status === "loading") return <LoadingContent node={props.node} theme={props.theme} onOpenTaskDetails={props.onOpenTaskDetails} />;
    if (props.node.metadata?.status === "error") return <ErrorContent node={props.node} theme={props.theme} onRetry={props.onRetry} onReloadResource={props.onReloadResource} />;

    const Renderer = nodeContentRenderers[props.node.type];
    return Renderer ? <Renderer {...props} /> : <UnknownNodeContent theme={props.theme} />;
}

const nodeContentRenderers = {
    [CanvasNodeType.Text]: TextContent,
    [CanvasNodeType.Script]: UnknownNodeContent,
    [CanvasNodeType.Skill]: SkillContent,
    [CanvasNodeType.Image]: ImageNodeContent,
    [CanvasNodeType.Config]: EmptyImageContent,
    [CanvasNodeType.Video]: VideoNodeContent,
    [CanvasNodeType.Audio]: AudioNodeContent,
    [CanvasNodeType.Drawing]: DrawingContent,
    [CanvasNodeType.Frame]: UnknownNodeContent,
    [CanvasNodeType.Markdown]: MarkdownNodeContent,
    [CanvasNodeType.Svg]: SvgNodeContent,
    [CanvasNodeType.Html]: HtmlNodeContent,
    [CanvasNodeType.Panorama]: PanoramaNodeContent,
    [CanvasNodeType.Compare]: CompareNodeContent,
    [CanvasNodeType.Chart]: ChartNodeContent,
    [CanvasNodeType.ColorGrade]: ColorGradeNodeContent,
} satisfies Record<CanvasNodeType, (props: CanvasNodeContentProps) => ReactNode>;

function DrawingContent({ node, theme, drawingProjectId }: CanvasNodeContentProps) {
    const shapeCount = node.metadata?.drawingShapeCount || 0;
    const pageCount = node.metadata?.drawingPageCount || 1;
    const [previewUrl, setPreviewUrl] = useState(node.metadata?.drawingPreviewUrl || "");

    useEffect(() => {
        const drawingId = node.metadata?.drawingId;
        const fallbackPreview = node.metadata?.drawingPreviewUrl || "";
        setPreviewUrl(fallbackPreview);
        if (!drawingProjectId || !drawingId) return;
        let active = true;
        let objectUrl = "";
        void loadCanvasDrawingPreview(drawingProjectId, drawingId).then((preview) => {
            if (!active) return;
            if (!preview) {
                setPreviewUrl(fallbackPreview);
                return;
            }
            objectUrl = URL.createObjectURL(preview);
            setPreviewUrl(objectUrl);
        }).catch((error) => console.warn("读取绘图节点预览失败", error));
        return () => {
            active = false;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [drawingProjectId, node.metadata?.drawingId, node.metadata?.drawingPreviewUrl, node.metadata?.drawingRevision]);

    return (
        <div className="relative h-full w-full overflow-hidden" style={{ background: theme.node.panel, color: theme.node.text }}>
            {previewUrl ? (
                <img src={previewUrl} alt="绘图预览" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
            ) : (
                <div className="absolute inset-0 grid place-items-center" style={{ background: theme.node.panel, backgroundImage: `radial-gradient(circle, ${theme.node.stroke} 1px, transparent 1px)`, backgroundSize: "18px 18px" }}>
                    <div className="flex flex-col items-center gap-2 rounded-[var(--r-lg)] px-4 py-3" style={{ border: `1px solid ${theme.node.edge}`, background: theme.node.fill, color: theme.node.muted }}>
                        <span className="grid size-10 place-items-center rounded-[var(--r-md)]" style={{ background: theme.toolbar.panel, border: `1px solid ${theme.node.edge}`, color: theme.node.text }}>
                            <Pencil className="size-5" />
                        </span>
                        <span className="text-[var(--fs-tiny)] font-medium">打开绘图</span>
                    </div>
                </div>
            )}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 px-4 pb-3 pt-12" style={{ background: `linear-gradient(to top, ${theme.node.fill}, ${theme.node.fill}e6 55%, transparent)` }}>
                <div className="min-w-0">
                    <div className="truncate text-xs font-semibold" title={node.title || "绘图"}>{node.title || "绘图"}</div>
                    <div className="mt-0.5 text-[var(--fs-tiny)]" style={{ color: theme.node.muted }}>{shapeCount} 个图形 · {pageCount} 个页面</div>
                </div>
                <Pencil className="size-3.5 shrink-0" style={{ color: theme.accent.primary }} />
            </div>
        </div>
    );
}

function LoadingContent({ node, theme, onOpenTaskDetails }: Pick<CanvasNodeContentProps, "node" | "theme" | "onOpenTaskDetails">) {
    const taskId = node.metadata?.taskId;
    const displayTask = {
        provider: node.metadata?.taskProvider,
        status: (node.metadata?.taskStatus || "running") as GenerationTask["status"],
        stage: node.metadata?.taskStage,
        officialStatus: node.metadata?.taskOfficialStatus,
        errorCode: node.metadata?.taskErrorCode,
    };
    const submissionUncertain = Boolean(taskId) && isGenerationTaskSubmissionUncertain(displayTask);
    const showsProgress = Boolean(taskId) && generationTaskShowsProgress(displayTask);
    const progress = showsProgress && typeof node.metadata?.taskProgress === "number" ? Math.max(0, Math.min(100, Math.round(node.metadata.taskProgress))) : null;
    const statusLabel = taskId ? generationTaskStatusLabel(displayTask) : "等待任务状态";
    const stageLabel = taskId ? generationTaskStageLabel(displayTask) : "正在创建任务";
    const elapsed = useTaskElapsed(node.metadata?.taskCreatedAt);
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2.5 px-5 text-center" style={{ color: theme.node.activeStroke }}>
            {submissionUncertain ? <AlertCircle className="size-10" /> : <div className="size-10 animate-spin rounded-full border-2" style={{ borderColor: theme.node.stroke, borderTopColor: theme.node.activeStroke }} />}
            <span className="text-[var(--fs-tiny)] font-semibold">{stageLabel}</span>
            {taskId ? (
                <div className="flex w-full max-w-[210px] flex-col items-center gap-1.5">
                    <div className="max-w-full truncate text-[var(--fs-label)] font-medium" style={{ color: theme.node.text }}>
                        {statusLabel}
                        {progress !== null ? ` · ${progress}%` : ""}
                    </div>
                    {progress !== null ? (
                        <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: theme.node.stroke }}>
                            <div className="h-full rounded-full transition-[width]" style={{ width: `${progress}%`, background: theme.node.activeStroke }} />
                        </div>
                    ) : null}
                    <div className="max-w-full truncate text-[var(--fs-tiny)] tabular-nums" style={{ color: theme.node.muted }}>
                        <Clock3 className="mr-1 inline size-3" />{elapsed} · {shortTaskId(taskId)}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                        <button type="button" className="inline-flex h-7 items-center gap-1 rounded-[var(--r-sm)] px-2 text-[var(--fs-tiny)] font-medium transition-colors" style={{ background: theme.toolbar.itemHover, color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onOpenTaskDetails?.(node); }}><FileText className="size-3" />详情</button>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function useTaskElapsed(createdAt?: string) {
    const [, setTick] = useState(0);
    useEffect(() => {
        if (!createdAt) return;
        const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
        return () => window.clearInterval(timer);
    }, [createdAt]);
    if (!createdAt) return "刚刚";
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000));
    if (seconds < 60) return `${seconds}秒`;
    const minutes = Math.floor(seconds / 60);
    return minutes < 60 ? `${minutes}分${seconds % 60}秒` : `${Math.floor(minutes / 60)}时${minutes % 60}分`;
}

function shortTaskId(id: string) {
    if (id.length <= 20) return id;
    return `${id.slice(0, 14)}...${id.slice(-4)}`;
}

function ErrorContent({ node, theme, onRetry, onReloadResource }: Pick<CanvasNodeContentProps, "node" | "theme" | "onRetry" | "onReloadResource">) {
    const moderationFailure = node.metadata?.generationErrorCode === CONTENT_MODERATION_ERROR_CODE || isContentModerationError(node.metadata?.errorDetails);
    const errorDisplayTask = {
        provider: node.metadata?.taskProvider,
        status: (node.metadata?.taskStatus || "failed") as GenerationTask["status"],
        stage: node.metadata?.taskStage,
        officialStatus: node.metadata?.taskOfficialStatus,
        errorCode: node.metadata?.taskErrorCode,
    };
    const submissionUncertain = isGenerationTaskSubmissionUncertain(errorDisplayTask);
    return (
        <div className="flex max-w-[260px] flex-col items-center gap-3 px-5 text-center">
            <div className="text-xs leading-5" style={{ color: submissionUncertain ? theme.node.text : theme.accent.danger }}>{submissionUncertain ? generationTaskStatusLabel(errorDisplayTask) : generationErrorMessage(node.metadata?.errorDetails)}</div>
            {submissionUncertain ? (
                <div className="rounded-[var(--r-sm)] px-3 py-2 text-[var(--fs-label)] leading-4" style={{ background: theme.toolbar.itemHover, color: theme.node.muted }}>
                    {generationTaskStageLabel(errorDisplayTask)}
                </div>
            ) : moderationFailure ? (
                <div className="rounded-[var(--r-sm)] px-3 py-2 text-[var(--fs-label)] leading-4" style={{ background: theme.toolbar.itemHover, color: theme.node.muted }}>
                    修改节点提示词后，可重新点击生成。
                </div>
            ) : node.metadata?.resourceReloadAvailable ? (
                <div className="flex flex-wrap justify-center gap-2">
                    <button
                        type="button"
                        className="inline-flex h-8 items-center gap-1.5 rounded-[var(--r-md)] px-3 text-xs font-medium transition-colors"
                        style={{ background: theme.accent.primary, color: theme.accent.onPrimary }}
                        onClick={(event) => { event.stopPropagation(); onReloadResource?.(node); }}
                        onMouseDown={(event) => event.stopPropagation()}
                    >
                        <Download className="size-3.5" />
                        重新加载资源
                    </button>
                    <button
                        type="button"
                        className="inline-flex h-8 items-center gap-1.5 rounded-[var(--r-md)] px-3 text-xs font-medium transition-colors"
                        style={{ background: theme.toolbar.itemHover, color: theme.node.text }}
                        onClick={(event) => { event.stopPropagation(); onRetry?.(node); }}
                        onMouseDown={(event) => event.stopPropagation()}
                    >
                        <RefreshCw className="size-3.5" />
                        重新生成
                    </button>
                </div>
            ) : (
                <button
                    type="button"
                    className="inline-flex h-8 items-center gap-1.5 rounded-[var(--r-md)] px-3 text-xs font-medium transition-colors"
                    style={{ background: theme.toolbar.itemHover, color: theme.node.text }}
                    onClick={(event) => {
                        event.stopPropagation();
                        onRetry?.(node);
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                >
                    <RefreshCw className="size-3.5" />
                    {node.metadata?.isBatchRoot ? "重新生成失败项" : "重新生成"}
                </button>
            )}
        </div>
    );
}

function UnknownNodeContent({ theme }: Pick<CanvasNodeContentProps, "theme">) {
    return <div className="flex h-full w-full items-center justify-center text-sm" style={{ color: theme.node.placeholder }}>未知节点</div>;
}

function TextContent({ node, theme, isEditingContent, textareaRef, mentionReferences, onContentChange, onStopEditing }: CanvasNodeContentProps) {
    const fontSize = node.metadata?.fontSize || 14;
    const textStyle = { fontSize: `${fontSize}px`, lineHeight: `${Math.round(fontSize * 1.65)}px`, color: theme.node.text, boxSizing: "border-box" } as CSSProperties;
    const richTextHTML = useMemo(() => canvasRichTextHTML(node.metadata?.richText), [node.metadata?.richText]);

    return (
        <div className="flex h-full w-full flex-col overflow-hidden pt-10">
            {isEditingContent ? (
                <CanvasResourceMentionTextarea
                    ref={textareaRef}
                    className="thin-scrollbar m-0 block h-full w-full resize-none appearance-none overflow-y-auto whitespace-pre-wrap break-words border-none bg-transparent px-4 pb-4 pt-0 font-mono outline-none select-text"
                    style={textStyle}
                    value={node.metadata?.content || ""}
                    references={mentionReferences}
                    highlightLabels={false}
                    onChange={(value) => onContentChange(node.id, value)}
                    onBlur={onStopEditing}
                    onKeyDown={(event) => {
                        if (event.key === "Escape") onStopEditing();
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onWheel={(event) => event.stopPropagation()}
                />
            ) : richTextHTML ? (
                <div
                    className="thin-scrollbar block h-full w-full overflow-y-auto break-words bg-transparent px-4 pb-4 font-mono [&_a]:underline [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:opacity-70 [&_code]:rounded [&_code]:bg-black/6 [&_code]:px-1 dark:[&_code]:bg-white/8 [&_h1]:my-2 [&_h1]:text-[1.55em] [&_h1]:font-semibold [&_h2]:my-2 [&_h2]:text-[1.3em] [&_h2]:font-semibold [&_h3]:my-1.5 [&_h3]:text-[1.12em] [&_h3]:font-semibold [&_hr]:my-3 [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-black/90 [&_pre]:p-2 [&_pre]:text-white [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
                    style={textStyle}
                    onWheel={(event) => event.stopPropagation()}
                    dangerouslySetInnerHTML={{ __html: richTextHTML }}
                />
            ) : (
                <div className="thin-scrollbar block h-full w-full overflow-y-auto whitespace-pre-wrap break-words bg-transparent px-4 pb-4 pt-0 font-mono" style={textStyle} onWheel={(event) => event.stopPropagation()}>
                    {node.metadata?.content || <span style={{ color: theme.node.placeholder }}>双击编辑文字</span>}
                </div>
            )}
        </div>
    );
}

function SkillContent({ node, theme }: CanvasNodeContentProps) {
    const skill = node.metadata?.skillSnapshot;
    const tags = skill?.tags?.slice(0, 4) || [];
    const template = skill?.template || node.metadata?.content || "";

    return (
        <div className="flex h-full w-full flex-col overflow-hidden p-4" style={{ color: theme.node.text }}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="grid size-8 shrink-0 place-items-center rounded-[var(--r-md)]" style={{ background: `${theme.node.activeStroke}18`, color: theme.node.activeStroke }}>
                            <BookOpenCheck className="size-4" />
                        </span>
                        <div className="min-w-0">
                            <div className="truncate text-sm font-semibold" title={skill?.name || node.title || "技能"}>{skill?.name || node.title || "技能"}</div>
                            <div className="mt-0.5 flex items-center gap-1.5 text-[var(--fs-label)]" style={{ color: theme.node.muted }}>
                                <span>{skillCategoryLabel(skill?.category)}</span><span>·</span><span>{skillOutputModeLabel(skill?.outputMode)}</span>
                                {skill?.version ? <><span>·</span><span>v{skill.version}</span></> : null}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            {skill?.description ? <div className="mt-3 line-clamp-2 text-xs leading-5" style={{ color: theme.node.muted }}>{skill.description}</div> : null}
            <div className="thin-scrollbar mt-3 min-h-0 flex-1 overflow-hidden rounded-[var(--r-md)] px-3 py-2 text-xs leading-5" style={{ background: theme.node.panel, color: theme.node.text }}>
                <div className="mb-1 font-semibold opacity-55">模板</div>
                <div className="line-clamp-4 whitespace-pre-wrap break-words">{template || "未配置技能模板"}</div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
                {tags.length ? tags.map((tag) => <span key={tag} className="rounded-[var(--r-sm)] bg-black/5 px-1.5 py-0.5 text-[var(--fs-tiny)] dark:bg-white/6" style={{ color: theme.node.muted }}>{tag}</span>) : <span className="text-[var(--fs-label)]" style={{ color: theme.node.muted }}>连接到图片、视频、音频或文本节点后生效</span>}
            </div>
        </div>
    );
}

function skillCategoryLabel(category?: string) {
    if (category === "writing") return "剧情";
    if (category === "storyboard") return "分镜";
    if (category === "image") return "生图";
    if (category === "video") return "视频";
    return "通用";
}

function skillOutputModeLabel(mode?: string) {
    if (mode === "json") return "JSON";
    if (mode === "image_prompt") return "生图提示词";
    if (mode === "workflow") return "工作流";
    return "文本";
}

function ImageNodeContent(props: CanvasNodeContentProps) {
    if (!props.node.metadata?.content && props.isBatchRoot) {
        const content = props.node.metadata?.status === "loading"
            ? <LoadingContent node={props.node} theme={props.theme} />
            : props.node.metadata?.status === "error"
                ? <ErrorContent node={props.node} theme={props.theme} onRetry={props.onRetry} onReloadResource={props.onReloadResource} />
                : <EmptyImageContent {...props} isBatchRoot={false} />;
        return <BatchFrame batchCount={props.batchCount} batchExpanded={props.batchExpanded} batchOpening={props.batchOpening} batchRecovering={props.batchRecovering} theme={props.theme} onToggleBatch={props.onToggleBatch}>{content}</BatchFrame>;
    }
    if (!props.node.metadata?.content) return <EmptyImageContent {...props} />;
    return <ImageContent node={props.node} theme={props.theme} isBatchRoot={props.isBatchRoot} batchCount={props.batchCount} batchExpanded={props.batchExpanded} batchOpening={props.batchOpening} batchRecovering={props.batchRecovering} onToggleBatch={props.onToggleBatch} />;
}

function EmptyImageContent({ node, theme, isBatchRoot, batchCount, batchExpanded, batchOpening, batchRecovering, onToggleBatch }: CanvasNodeContentProps) {
    const isCharacterReference = node.metadata?.workflowKind === "character" && node.metadata?.characterView === "multi";
    const content = (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3" style={{ color: theme.node.placeholder }}>
            <div className="flex size-14 items-center justify-center rounded-[var(--r-lg)]" style={{ background: theme.toolbar.activeBg }}><ImageIcon className="size-6 opacity-30" /></div>
            {isCharacterReference ? (
                <div className="max-w-[80%] text-center">
                    <div className="truncate text-xs font-medium" title={node.metadata?.characterName || node.title} style={{ color: theme.node.muted }}>{node.metadata?.characterName || node.title}</div>
                    <div className="mt-1 text-[var(--fs-tiny)] tracking-[0.12em] opacity-50">多视角参考 · 待生成</div>
                </div>
            ) : <span className="text-[var(--fs-tiny)] tracking-[0.18em] opacity-50">空图片节点</span>}
        </div>
    );
    if (isBatchRoot) return <BatchFrame batchCount={batchCount} batchExpanded={batchExpanded} batchOpening={batchOpening} batchRecovering={batchRecovering} theme={theme} onToggleBatch={onToggleBatch}>{content}</BatchFrame>;
    return content;
}

function VideoNodeContent({ node, theme, reduceMediaEffects }: CanvasNodeContentProps) {
    const playWhenReadyRef = useRef(false);
    const playerBoxRef = useRef<HTMLDivElement>(null);
    const { url, loading, load } = useNodeResourceUrl(node, false);
    const subtitleEntries = node.metadata?.subtitleEntries || [];
    const subtitleStyle = node.metadata?.subtitleStyle || createDefaultSubtitleStyle();
    const [currentTimeMs, setCurrentTimeMs] = useState(0);
    const [videoSize, setVideoSize] = useState<{ width: number; height: number } | null>(null);

    useEffect(() => {
        const box = playerBoxRef.current;
        const video = box?.querySelector("video");
        if (!video) return;
        const handleLoadedMetadata = () => {
            if (video.videoWidth > 0 && video.videoHeight > 0) setVideoSize({ width: video.videoWidth, height: video.videoHeight });
        };
        video.addEventListener("loadedmetadata", handleLoadedMetadata);
        handleLoadedMetadata();
        if (!subtitleEntries.length) return () => video.removeEventListener("loadedmetadata", handleLoadedMetadata);
        const handleTimeUpdate = () => setCurrentTimeMs(Math.round(video.currentTime * 1000));
        video.addEventListener("timeupdate", handleTimeUpdate);
        return () => {
            video.removeEventListener("timeupdate", handleTimeUpdate);
            video.removeEventListener("loadedmetadata", handleLoadedMetadata);
        };
    }, [subtitleEntries.length, url]);

    if (!node.metadata?.content) return <EmptyMediaContent icon={<Video className="size-7 opacity-35" />} label="空视频节点" color={theme.node.placeholder} />;
    if (!url) return <DeferredMediaLoad icon={loading ? <LoaderCircle className="size-5 animate-spin" /> : <Play className="size-5 fill-current" />} label={loading ? "正在缓存视频" : "加载并缓存视频"} disabled={loading} onClick={() => { playWhenReadyRef.current = true; void load(); }} />;

    const sourceRatio = (videoSize?.width || node.metadata?.naturalWidth || node.width) / Math.max(1, videoSize?.height || node.metadata?.naturalHeight || node.height);
    const fitHeight = Math.min(node.height, node.width / Math.max(0.01, sourceRatio));
    const fitWidth = Math.round(fitHeight * sourceRatio);
    const activeEntry = subtitleEntries.find((entry) => currentTimeMs >= entry.startMs && currentTimeMs < entry.endMs);
    const activeHighlight = activeEntry ? (node.metadata?.subtitleHighlights || []).find((item) => item.entryIndex === activeEntry.index) : undefined;

    return (
        <div ref={playerBoxRef} className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[var(--node-radius)] bg-black">
            <div className="relative" style={{ width: fitWidth, height: Math.round(fitHeight) }}>
                <VideoPlayer src={url} mimeType={node.metadata?.mimeType} title={node.title || "视频"} preload={reduceMediaEffects ? "none" : "metadata"} autoPlay={playWhenReadyRef.current} onCanPlay={() => { playWhenReadyRef.current = false; }} brandColor={theme.accent.primary} className="h-full w-full rounded-[var(--node-radius)] bg-black" dataCanvasNoZoom compactControls />
                {activeEntry && activeEntry.text.trim() ? <CanvasSubtitleOverlay text={activeEntry.text} highlight={activeHighlight} style={subtitleStyle} /> : null}
            </div>
        </div>
    );
}

function AudioNodeContent({ node, theme }: CanvasNodeContentProps) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const playWhenReadyRef = useRef(false);
    const { url, loading, load } = useNodeResourceUrl(node, false);
    useEffect(() => {
        if (!url || !playWhenReadyRef.current) return;
        playWhenReadyRef.current = false;
        void audioRef.current?.play().catch(() => undefined);
    }, [url]);
    if (!node.metadata?.content) return <EmptyMediaContent icon={<Music2 className="size-7 opacity-35" />} label="空音频节点" color={theme.node.placeholder} />;
    if (!url) return <DeferredMediaLoad icon={loading ? <LoaderCircle className="size-5 animate-spin" /> : <Play className="size-5 fill-current" />} label={loading ? "正在缓存音频" : "加载并缓存音频"} disabled={loading} onClick={() => { playWhenReadyRef.current = true; void load(); }} />;
    return (
        <div className="flex h-full w-full flex-col justify-center gap-3 px-4" style={{ background: theme.node.fill, color: theme.node.text }}>
            <div className="flex min-w-0 items-center gap-2 text-sm opacity-70"><Music2 className="size-4 shrink-0" /><span className="min-w-0 truncate" title={node.title || "音频"}>{node.title || "音频"}</span></div>
            <audio ref={audioRef} src={url} controls preload="metadata" className="w-full" data-canvas-no-zoom />
        </div>
    );
}

function EmptyMediaContent({ icon, label, color }: { icon: ReactNode; label: string; color: string }) {
    return <div className="flex h-full w-full flex-col items-center justify-center gap-3" style={{ color }}>{icon}<span className="text-sm">{label}</span></div>;
}

function ImageContent({ node, theme, isBatchRoot, batchCount, batchExpanded, batchOpening, batchRecovering, onToggleBatch }: Pick<CanvasNodeContentProps, "node" | "theme" | "isBatchRoot" | "batchCount" | "batchExpanded" | "batchOpening" | "batchRecovering" | "onToggleBatch">) {
    const imageContainerRef = useRef<HTMLDivElement>(null);
    const nearViewport = useNearViewport(imageContainerRef);
    const { url, loading } = useNodeResourceUrl(node, nearViewport);
    const importedFromLibTV = node.metadata?.importSource?.provider === "libtv";
    const { resizeNode, updateMetadata } = useCanvasNodeActions();

    /**
     * 让节点跟随图片真实比例。
     *
     * 上传接口的 width/height 是可选的（services/api/resources.ts），拿不到时节点会落到
     * 默认的横向比例，竖图就被放进一个宽盒子、两侧留黑。这里在图片解码后量真实尺寸并校正。
     *
     * 判据是「用户有没有手动定过尺寸」，**不是**「有没有量过尺寸」——后者会让所有已经
     * 存过 naturalWidth 的旧节点永远得不到修正（第一版就是这么写的，所以没生效）。
     * 手动拉过（manualSize）或自由比例（freeResize）的节点只补记尺寸、不动宽高。
     */
    const fitToImage = (element: HTMLImageElement) => {
        const naturalWidth = element.naturalWidth;
        const naturalHeight = element.naturalHeight;
        if (!naturalWidth || !naturalHeight) return;
        if (node.metadata?.naturalWidth !== naturalWidth || node.metadata?.naturalHeight !== naturalHeight) {
            updateMetadata?.(node.id, { naturalWidth, naturalHeight });
        }
        if (node.metadata?.freeResize || node.metadata?.manualSize) return;
        const size = fitNodeSize(naturalWidth, naturalHeight);
        // 差不到 1px 就别动，避免无意义的状态写入。
        if (Math.abs(size.width - node.width) < 1 && Math.abs(size.height - node.height) < 1) return;
        resizeNode?.(node.id, size);
    };

    return (
        <BatchFrame batchCount={isBatchRoot ? batchCount : 0} batchExpanded={batchExpanded} batchOpening={batchOpening} batchRecovering={batchRecovering} theme={theme} onToggleBatch={onToggleBatch}>
            <div ref={imageContainerRef} className="h-full w-full overflow-hidden rounded-[var(--node-radius)]">
                {url ? <img src={url} alt={node.title} loading={importedFromLibTV ? "eager" : "lazy"} decoding="async" draggable={false} onDragStart={(event) => event.preventDefault()} onLoad={(event) => fitToImage(event.currentTarget)} className={`pointer-events-none block h-full w-full select-none ${node.metadata?.freeResize ? "object-fill" : "object-contain"}`} /> : <div className="grid size-full place-items-center" style={{ color: theme.node.muted }}>{loading ? <LoaderCircle className="size-5 animate-spin" /> : <ImageIcon className="size-5 opacity-45" />}</div>}
            </div>
        </BatchFrame>
    );
}

function DeferredMediaLoad({ icon, label, disabled, onClick }: { icon: ReactNode; label: string; disabled: boolean; onClick: () => void }) {
    return <button type="button" data-canvas-no-zoom className="flex size-full flex-col items-center justify-center gap-2 rounded-[var(--node-radius)] bg-black text-white/75 transition-colors hover:text-white disabled:cursor-wait" disabled={disabled} onClick={(event) => { event.stopPropagation(); onClick(); }} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}><span className="grid size-10 place-items-center rounded-full bg-white/10">{icon}</span><span className="text-xs font-medium">{label}</span></button>;
}

function useNodeResourceUrl(node: CanvasNodeData, eager: boolean) {
    const storageKey = node.metadata?.storageKey || "";
    const content = node.metadata?.content || "";
    const fallback = node.metadata?.previewContent
        || (node.type === CanvasNodeType.Image && node.metadata?.importSource?.provider === "libtv" ? buildLibTVImagePreviewUrl(content) : content);
    const isRemoteResource = Boolean(resourceIdFromStorageKey(storageKey));
    const [url, setUrl] = useState(isRemoteResource ? "" : fallback);
    const [loading, setLoading] = useState(isRemoteResource && eager);

    useEffect(() => {
        let cancelled = false;
        if (!isRemoteResource) {
            setUrl(fallback);
            setLoading(false);
            return;
        }
        setUrl("");
        setLoading(eager);
        const resolve = eager ? cacheResourceObjectUrl(storageKey) : getCachedResourceObjectUrl(storageKey);
        void resolve.then((cached) => {
            if (!cancelled) setUrl(cached || (eager ? fallback : ""));
        }).catch(() => {
            if (!cancelled && eager) setUrl(fallback);
        }).finally(() => {
            if (!cancelled) setLoading(false);
        });
        return () => { cancelled = true; };
    }, [eager, fallback, isRemoteResource, storageKey]);

    const load = useCallback(async () => {
        if (url) return url;
        if (!isRemoteResource) return fallback;
        setLoading(true);
        try {
            const next = (await cacheResourceObjectUrl(storageKey)) || fallback;
            setUrl(next);
            return next;
        } catch {
            setUrl(fallback);
            return fallback;
        } finally {
            setLoading(false);
        }
    }, [fallback, isRemoteResource, storageKey, url]);
    return { url, loading, load };
}

function useNearViewport(ref: RefObject<Element | null>) {
    const [nearViewport, setNearViewport] = useState(false);
    useEffect(() => {
        const element = ref.current;
        if (!element || typeof IntersectionObserver === "undefined") {
            setNearViewport(true);
            return;
        }
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                setNearViewport(true);
                observer.disconnect();
            }
        }, { rootMargin: "600px" });
        observer.observe(element);
        return () => observer.disconnect();
    }, [ref]);
    return nearViewport;
}

export function CanvasNodeImageInfo({ node }: { node: CanvasNodeData }) {
    const width = Math.round(node.metadata?.naturalWidth || node.width);
    const height = Math.round(node.metadata?.naturalHeight || node.height);
    const size = formatBytes(node.metadata?.bytes || 0);
    return <span className="ml-auto max-w-full shrink-0 truncate rounded-[var(--r-sm)] bg-black/55 px-2 py-1 text-[var(--fs-label)] font-medium leading-none text-white backdrop-blur-sm">{width} x {height}{size ? ` · ${size}` : ""}</span>;
}

function BatchFrame({ batchCount, batchExpanded, batchOpening, batchRecovering, theme, onToggleBatch, children }: { batchCount: number; batchExpanded: boolean; batchOpening: boolean; batchRecovering: boolean; theme: CanvasTheme; onToggleBatch?: () => void; children: ReactNode }) {
    const isBatchRoot = batchCount > 1;
    return (
        <div className="group/batch relative h-full w-full overflow-visible" onDoubleClick={isBatchRoot ? (event) => { event.stopPropagation(); onToggleBatch?.(); } : undefined}>
            {isBatchRoot ? (
                <div className="pointer-events-none absolute inset-0 overflow-visible">
                    {Array.from({ length: Math.min(batchCount - 1, 5) }).map((_, index) => (
                        <div
                            key={index}
                            className="absolute rounded-[inherit] transition-all duration-300 group-hover/batch:translate-x-2"
                            style={{
                                inset: 0,
                                background: theme.node.panel,
                                boxShadow: `inset 0 0 0 1px ${theme.node.stroke}`,
                                opacity: batchExpanded && !batchOpening ? 0.34 : 1,
                                transform: batchOpening || batchRecovering ? `translate(${54 + index * 22}px, ${20 + index * 12}px) rotate(${8 + index * 5}deg) scale(.98)` : `translate(${34 + index * 18}px, ${14 + index * 10}px) rotate(${6 + index * 4}deg)`,
                                zIndex: -index - 1,
                            }}
                        />
                    ))}
                </div>
            ) : null}
            {children}
        </div>
    );
}
