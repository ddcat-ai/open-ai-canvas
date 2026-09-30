import { useEffect, useMemo, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { BookOpenCheck, FileText, Image as ImageIcon, Music2, Pencil, Video } from "lucide-react";

import type { CanvasNodeRenderLOD } from "@/lib/canvas/canvas-node-lod";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { canvasRichTextHTML } from "@/lib/canvas/canvas-rich-text";
import { canvasTextFontSize } from "@/lib/canvas/canvas-text-scale";
import { loadCanvasDrawingPreview } from "@/lib/canvas/canvas-drawing-storage";
import { producedModelLabel } from "@/lib/canvas/produced-model";
import { useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { formatBytes } from "@/lib/image-utils";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { ART_CRITIQUE_NODE_TYPE } from "@/lib/art-critique/contracts";
import { CanvasResourceMentionTextarea } from "./canvas-resource-mention-textarea";
import { CanvasVideoPreviewImage } from "./canvas-video-preview-image";
import { CanvasFileUploadContent } from "./canvas-file-upload-content";
import { MarkdownNodeContent } from "./nodes/markdown-node";
import { ChartNodeContent } from "./nodes/chart-node";
import { CompareNodeContent } from "./nodes/compare-node";
import { ColorGradeNodeContent } from "./nodes/color-grade-node";
import { HtmlNodeContent } from "./nodes/html-node";
import { PanoramaNodeContent } from "./nodes/panorama-node";
import { SvgNodeContent } from "./nodes/svg-node";
import { ArtCritiqueNodeContent } from "./nodes/ai-art-critique-node";
import { MediaConversionNodeContent } from "./nodes/media-conversion-node";
import { MEDIA_CONVERSION_NODE_TYPE } from "@/lib/media-conversion/contracts";
import { AudioNodeContent, EmptyImageContent, ImageNodeContent, VideoNodeContent } from "./canvas-node-media-content";
import { ErrorContent, LoadingContent, UnknownNodeContent } from "./canvas-node-status-content";

export type CanvasNodeContentProps = {
    node: CanvasNodeData;
    theme: CanvasTheme;
    renderLOD?: CanvasNodeRenderLOD;
    isEditingContent: boolean;
    textareaRef: RefObject<HTMLTextAreaElement | null>;
    isBatchRoot: boolean;
    batchCount: number;
    batchPreviewNodes?: CanvasNodeData[];
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
    mediaActive?: boolean;
    onMediaPlayRequest?: (nodeId: string) => void;
};

export function CanvasNodeContent(props: CanvasNodeContentProps) {
    if (props.node.metadata?.fileUpload) return <CanvasFileUploadContent node={props.node} theme={props.theme} reduceMotion={props.reduceMediaEffects} />;
    // Keep the image renderer mounted while node LOD changes. Visibility still gates first load.
    if (props.node.type === CanvasNodeType.Image && props.renderLOD !== "full" && (props.node.metadata?.content || props.node.metadata?.storageKey)) {
        return <ImageNodeContent {...props} />;
    }
    if (props.renderLOD === "shell") return <CanvasNodeShellContent node={props.node} theme={props.theme} />;
    if (props.renderLOD === "preview") return <CanvasNodePreviewContent node={props.node} theme={props.theme} />;
    const hasCustomContent =
        props.node.type === CanvasNodeType.Config ||
        props.node.type === CanvasNodeType.Script ||
        props.node.type === CanvasNodeType.BatchTable ||
        Boolean(props.node.metadata?.directorSceneId) ||
        (props.node.metadata?.workflowKind === "character" && Boolean(props.node.metadata.characterAssetId)) ||
        (props.node.metadata?.workflowKind === "story_input" && !props.isEditingContent) ||
        (props.node.metadata?.workflowKind === "styleboard" && !props.node.metadata.content);
    if (hasCustomContent && props.renderNodeContent) return props.renderNodeContent(props.node);
    if (props.node.type === ART_CRITIQUE_NODE_TYPE) return <ArtCritiqueNodeContent node={props.node} />;
    if (props.node.type === MEDIA_CONVERSION_NODE_TYPE) return <MediaConversionNodeContent node={props.node} theme={props.theme} />;
    if (props.isBatchRoot) return <ImageNodeContent {...props} />;
    if (props.node.metadata?.status === "loading") return <LoadingContent node={props.node} theme={props.theme} onOpenTaskDetails={props.onOpenTaskDetails} />;
    if (props.node.metadata?.status === "error") return <ErrorContent node={props.node} theme={props.theme} onRetry={props.onRetry} onReloadResource={props.onReloadResource} />;

    const pluginDefinition = getNodeDefinition(props.node.type)?.plugin;
    if (pluginDefinition) return <PluginCanvasNodeContent {...props} renderer={pluginDefinition.renderer} schema={pluginDefinition.schema} />;
    const Renderer = nodeContentRenderers[props.node.type];
    return Renderer ? <Renderer {...props} /> : <UnknownNodeContent theme={props.theme} />;
}

function CanvasNodeShellContent({ node, theme }: { node: CanvasNodeData; theme: CanvasTheme }) {
    const Icon = node.type === CanvasNodeType.Video ? Video : node.type === CanvasNodeType.Audio ? Music2 : node.type === CanvasNodeType.Image ? ImageIcon : FileText;
    return (
        <div className="flex size-full flex-col items-center justify-center gap-2 rounded-[var(--node-radius)] px-3 text-center" style={{ background: theme.node.fill, color: theme.node.muted }}>
            <Icon className="size-6 opacity-40" />
            <span className="max-w-full truncate text-xs font-medium" title={node.title}>{node.title || "画布节点"}</span>
        </div>
    );
}

function CanvasNodePreviewContent({ node, theme }: { node: CanvasNodeData; theme: CanvasTheme }) {
    if (node.type === CanvasNodeType.Image && (node.metadata?.content || node.metadata?.storageKey)) {
        return <CachedResourceImage storageKey={node.metadata?.storageKey} src={node.metadata?.previewContent || node.metadata?.content} alt={node.title} loading="lazy" decoding="async" draggable={false} className="pointer-events-none block size-full select-none object-contain" fallback={<CanvasNodeShellContent node={node} theme={theme} />} />;
    }
    if (node.type === CanvasNodeType.Video && (node.metadata?.content || node.metadata?.storageKey)) {
        return <CanvasVideoPreviewImage node={node} alt={node.title} loading="lazy" decoding="async" draggable={false} className="pointer-events-none block size-full select-none object-contain" fallback={<CanvasNodeShellContent node={node} theme={theme} />} />;
    }
    return <CanvasNodeShellContent node={node} theme={theme} />;
}

function PluginCanvasNodeContent({ node, theme, renderer, schema }: CanvasNodeContentProps & { renderer: "declarative" | "sandbox"; schema: Record<string, unknown> }) {
    if (renderer === "sandbox") {
        return (
            <div className="flex h-full w-full items-center justify-center p-4 text-center text-xs" style={{ color: theme.node.placeholder }}>
                插件节点等待隔离运行时
            </div>
        );
    }
    const data = node.metadata?.pluginData || {};
    const fields = Object.keys(schema.properties && typeof schema.properties === "object" ? (schema.properties as Record<string, unknown>) : schema);
    return (
        <div className="flex h-full w-full flex-col gap-3 overflow-auto p-4 pt-10 text-xs" style={{ color: theme.node.text }}>
            {fields.length ? (
                fields.map((field) => (
                    <div key={field} className="flex flex-col gap-1">
                        <span className="font-medium opacity-60">{field}</span>
                        <span className="whitespace-pre-wrap break-words opacity-90">{formatPluginValue(data[field] ?? (field === "content" ? node.metadata?.content : undefined))}</span>
                    </div>
                ))
            ) : (
                <span className="whitespace-pre-wrap break-words">{node.metadata?.content || "插件节点"}</span>
            )}
        </div>
    );
}

function formatPluginValue(value: unknown) {
    if (value === undefined || value === null || value === "") return "未设置";
    return typeof value === "string" ? value : JSON.stringify(value);
}

const nodeContentRenderers: Partial<Record<string, (props: CanvasNodeContentProps) => ReactNode>> = {
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
};

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
        void loadCanvasDrawingPreview(drawingProjectId, drawingId)
            .then((preview) => {
                if (!active) return;
                if (!preview) {
                    setPreviewUrl(fallbackPreview);
                    return;
                }
                objectUrl = URL.createObjectURL(preview);
                setPreviewUrl(objectUrl);
            })
            .catch((error) => console.warn("读取绘图节点预览失败", error));
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
                    <div className="truncate text-xs font-semibold" title={node.title || "绘图"}>
                        {node.title || "绘图"}
                    </div>
                    <div className="mt-0.5 text-[var(--fs-tiny)]" style={{ color: theme.node.muted }}>
                        {shapeCount} 个图形 · {pageCount} 个页面
                    </div>
                </div>
                <Pencil className="size-3.5 shrink-0" style={{ color: theme.accent.primary }} />
            </div>
        </div>
    );
}

function TextContent({ node, theme, isEditingContent, textareaRef, mentionReferences, onContentChange, onStopEditing }: CanvasNodeContentProps) {
    const fontSize = canvasTextFontSize(node.width, node.height, node.metadata?.fontSize);
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
                    className="thin-scrollbar block h-full w-full select-text overflow-y-auto break-words bg-transparent px-4 pb-4 font-mono [&_a]:underline [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:opacity-70 [&_code]:rounded [&_code]:bg-black/6 [&_code]:px-1 dark:[&_code]:bg-white/8 [&_h1]:my-2 [&_h1]:text-[1.55em] [&_h1]:font-semibold [&_h2]:my-2 [&_h2]:text-[1.3em] [&_h2]:font-semibold [&_h3]:my-1.5 [&_h3]:text-[1.12em] [&_h3]:font-semibold [&_hr]:my-3 [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-black/90 [&_pre]:p-2 [&_pre]:text-white [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
                    style={textStyle}
                    onWheel={(event) => event.stopPropagation()}
                    dangerouslySetInnerHTML={{ __html: richTextHTML }}
                />
            ) : (
                <div className="thin-scrollbar block h-full w-full select-text overflow-y-auto whitespace-pre-wrap break-words bg-transparent px-4 pb-4 pt-0 font-mono" style={textStyle} onWheel={(event) => event.stopPropagation()}>
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
                            <div className="truncate text-sm font-semibold" title={skill?.name || node.title || "技能"}>
                                {skill?.name || node.title || "技能"}
                            </div>
                            <div className="mt-0.5 flex items-center gap-1.5 text-[var(--fs-label)]" style={{ color: theme.node.muted }}>
                                <span>{skillCategoryLabel(skill?.category)}</span>
                                <span>·</span>
                                <span>{skillOutputModeLabel(skill?.outputMode)}</span>
                                {skill?.version ? (
                                    <>
                                        <span>·</span>
                                        <span>v{skill.version}</span>
                                    </>
                                ) : null}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            {skill?.description ? (
                <div className="mt-3 line-clamp-2 text-xs leading-5" style={{ color: theme.node.muted }}>
                    {skill.description}
                </div>
            ) : null}
            <div className="thin-scrollbar mt-3 min-h-0 flex-1 overflow-hidden rounded-[var(--r-md)] px-3 py-2 text-xs leading-5" style={{ background: theme.node.panel, color: theme.node.text }}>
                <div className="mb-1 font-semibold opacity-55">模板</div>
                <div className="line-clamp-4 whitespace-pre-wrap break-words">{template || "未配置技能模板"}</div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
                {tags.length ? (
                    tags.map((tag) => (
                        <span key={tag} className="rounded-[var(--r-sm)] bg-black/5 px-1.5 py-0.5 text-[var(--fs-tiny)] dark:bg-white/6" style={{ color: theme.node.muted }}>
                            {tag}
                        </span>
                    ))
                ) : (
                    <span className="text-[var(--fs-label)]" style={{ color: theme.node.muted }}>
                        连接到图片、视频、音频或文本节点后生效
                    </span>
                )}
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

export function CanvasNodeImageInfo({ node }: { node: CanvasNodeData }) {
    const width = Math.round(node.metadata?.naturalWidth || node.width);
    const height = Math.round(node.metadata?.naturalHeight || node.height);
    const size = formatBytes(node.metadata?.bytes || 0);
    return (
        <span className="ml-auto max-w-full shrink-0 truncate rounded-[var(--r-sm)] bg-black/55 px-2 py-1 text-[var(--fs-label)] font-medium leading-none text-white backdrop-blur-sm">
            {width} x {height}
            {size ? ` · ${size}` : ""}
        </span>
    );
}

export function CanvasNodeProducedModel({ stored }: { stored: string }) {
    // Keep catalog subscriptions off the CanvasNode shell and avoid normalizing config per node.
    const channels = useConfigStore((state) => state.config.channels);
    const customChannelsEnabled = useUserStore((state) => state.features.customChannelsEnabled);
    const visibleChannels = useMemo(() => customChannelsEnabled ? channels : channels.filter((channel) => channel.scope === "system"), [channels, customChannelsEnabled]);
    const label = producedModelLabel({ channels: visibleChannels }, stored);
    return <span className="max-w-full min-w-0 truncate rounded-[var(--r-sm)] bg-black/55 px-2 py-1 text-[var(--fs-label)] font-medium leading-none text-white backdrop-blur-sm">{label}</span>;
}
