import { Check, Clapperboard, CloudUpload, Download, FileText, Frame, Image as ImageIcon, MoreHorizontal, Music2, Pencil, Plus, Settings2, Sparkles, Trash2, Video, X } from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Dropdown, Input } from "antd";

import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { resourceFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import { resolveBackendApiUrl } from "@/stores/use-config-store";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { cn } from "@/lib/utils";
import { useSyncProgressStore } from "@/stores/use-sync-progress-store";

type ProjectPreviewMedia = { node: CanvasNodeData; url: string; storageKey?: string };
const projectPreviewMediaCache = new WeakMap<CanvasNodeData[], { first?: ProjectPreviewMedia; latest?: ProjectPreviewMedia }>();

export function CanvasCreateCard({ disabled, onClick }: { disabled?: boolean; onClick: () => void }) {
    return (
        <button type="button" className="app-canvas-create-card" disabled={disabled} onClick={onClick}>
            <span className="app-canvas-create-preview">
                <Plus className="app-canvas-create-icon" />
            </span>
            <span className="app-canvas-create-title">新建画布</span>
            <span className="app-canvas-create-meta">从空白开始</span>
        </button>
    );
}

export function CanvasProjectCard({ project, projectName, variant = "library", readOnly = false, footer }: { project: CanvasProject; projectName?: string; variant?: "library" | "recent"; readOnly?: boolean; footer?: ReactNode }) {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const renameProject = useCanvasStore((state) => state.renameProject);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const editingId = useCanvasUiStore((state) => state.editingProjectId);
    const editingTitle = useCanvasUiStore((state) => state.editingProjectTitle);
    const startEditing = useCanvasUiStore((state) => state.startEditingProject);
    const setEditingTitle = useCanvasUiStore((state) => state.setEditingProjectTitle);
    const stopEditing = useCanvasUiStore((state) => state.stopEditingProject);
    const toggleSelected = useCanvasUiStore((state) => state.toggleSelectedProjectId);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const editing = editingId === project.id;
    const selected = selectedIds.includes(project.id);
    const open = () => navigate(`/canvas/${project.id}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`);
    const saveTitle = () => {
        renameProject(project.id, editingTitle);
        stopEditing();
    };

    const compact = variant === "recent";
    return (
        <article className={cn("app-canvas-project-card group h-full cursor-pointer", compact ? "is-recent" : "is-library", selected && "is-selected")} onClick={() => (!editing || readOnly) && open()}>
            <div className="app-canvas-project-preview relative">
                <button
                    type="button"
                    className={cn("canvas-project-preview-button block w-full overflow-hidden text-left", compact ? "aspect-[16/10]" : "aspect-video")}
                    onClick={(event) => {
                        event.stopPropagation();
                        open();
                    }}
                >
                    <ProjectPreview project={project} />
                </button>
                {!compact && !readOnly ? (
                    <span className={`canvas-project-select ${selected ? "is-visible" : ""}`} onClick={(event) => event.stopPropagation()}>
                        <input type="checkbox" checked={selected} onChange={(event) => toggleSelected(project.id, event.target.checked)} className="app-canvas-project-checkbox" aria-label={`选择 ${project.title}`} />
                    </span>
                ) : null}
                <div className="canvas-project-cover-meta" aria-hidden="true">
                    <span className="canvas-project-node-count">{project.nodes.length} 节点</span>
                </div>
            </div>

            <div className={cn("app-canvas-project-body", compact ? "is-compact" : "")}>
                <div className="canvas-project-heading-row">
                    {editing && !readOnly ? (
                        <Input
                            className="canvas-project-title-input"
                            value={editingTitle}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => setEditingTitle(event.target.value)}
                            onKeyDown={(event) => event.key === "Enter" && saveTitle()}
                            autoFocus
                        />
                    ) : (
                        <button
                            type="button"
                            className="canvas-project-title-button"
                            onClick={(event) => {
                                event.stopPropagation();
                                open();
                            }}
                        >
                            <h2>{project.title}</h2>
                        </button>
                    )}
                    {editing && !readOnly ? (
                        <div className="canvas-project-actions" onClick={(event) => event.stopPropagation()}>
                            <button type="button" onClick={saveTitle} aria-label="保存名称">
                                <Check className="size-3.5" />
                            </button>
                            <button type="button" onClick={stopEditing} aria-label="取消重命名">
                                <X className="size-3.5" />
                            </button>
                        </div>
                    ) : !readOnly ? (
                        <div className="canvas-project-actions" onClick={(event) => event.stopPropagation()}>
                            <button type="button" onClick={() => startEditing(project.id, project.title)} aria-label={`重命名 ${project.title}`} title="重命名">
                                <Pencil className="size-3.5" />
                            </button>
                            <Dropdown
                                trigger={["click"]}
                                menu={{
                                    onClick: ({ domEvent }) => domEvent.stopPropagation(),
                                    items: [
                                        { key: "export", icon: <Download className="size-3.5" />, label: "导出画布", onClick: () => void exportCanvasProjects([project], project.title || "画布") },
                                        { type: "divider" },
                                        { key: "delete", danger: true, icon: <Trash2 className="size-3.5" />, label: "删除", onClick: () => setDeleteIds([project.id]) },
                                    ],
                                }}
                            >
                                <button type="button" aria-label={`${project.title} 画布操作`} title="更多操作">
                                    <MoreHorizontal className="size-4" />
                                </button>
                            </Dropdown>
                        </div>
                    ) : null}
                </div>
                <div className="canvas-project-stats">
                    <span>{projectName || "自由画布"}</span>
                    <span aria-hidden="true">·</span>
                    <time dateTime={project.updatedAt}>{formatProjectTime(project.updatedAt)}</time>
                </div>
                {footer ? (
                    <div className="canvas-project-card-footer" onClick={(event) => event.stopPropagation()}>
                        {footer}
                    </div>
                ) : null}
            </div>
        </article>
    );
}

export function ProjectPreview({ project, preferLatestImage = false }: { project: Pick<CanvasProject, "id" | "nodes">; preferLatestImage?: boolean }) {
    const syncProgress = useSyncProgressStore((state) => state.syncingProjects[project.id]);
    const isSyncing = Boolean(syncProgress && (syncProgress.phase === "uploading" || syncProgress.phase === "saving"));
    const media = projectPreviewMedia(project.nodes, preferLatestImage);

    const content = media ? (
        <div className="canvas-project-media size-full">
            {media.node.type === CanvasNodeType.Video ? (
                <div className="canvas-project-video size-full">
                    <Video className="size-8" aria-label={media.node.title || "项目视频"} />
                </div>
            ) : (
                <CachedResourceImage storageKey={media.storageKey} src={media.url} alt={media.node.title || "项目图片"} loading="lazy" decoding="async" className="size-full min-h-0 object-cover" />
            )}
        </div>
    ) : !project.nodes.length ? (
        <div className="canvas-project-empty size-full">
            <Plus className="canvas-project-empty-icon" />
            <span>空白画布</span>
            <small>等待第一幕</small>
        </div>
    ) : (
        <div className="canvas-project-preview-canvas relative size-full overflow-hidden">
            {buildNodePreviewLayout(project.nodes.slice(0, 8)).map(({ node, style }) => {
                const presentation = getNodePresentation(node);
                return (
                    <span key={node.id} className="canvas-project-preview-node absolute flex min-w-0 items-center gap-1.5 overflow-hidden" style={style}>
                        <span className="canvas-project-preview-node-icon">{presentation.icon}</span>
                        <span className="canvas-project-preview-node-label">{node.title || presentation.label}</span>
                    </span>
                );
            })}
        </div>
    );

    return (
        <div className="relative size-full overflow-hidden">
            {content}
            {isSyncing && syncProgress ? (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-stone-950/75 p-3 text-center backdrop-blur-sm transition-all duration-300 pointer-events-none select-none" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1.5 text-amber-400">
                        <CloudUpload className="size-4 animate-bounce" />
                        <span className="text-xs font-medium tracking-wide">云端同步中</span>
                    </div>
                    <div className="w-full max-w-[150px] space-y-1">
                        {syncProgress.total > 0 ? (
                            <>
                                <div className="flex items-center justify-between text-[10px] text-white/80">
                                    <span>媒体上传</span>
                                    <span className="font-mono text-amber-300">
                                        {syncProgress.completed}/{syncProgress.total}
                                    </span>
                                </div>
                                <div className="h-1 w-full overflow-hidden rounded-full bg-white/20">
                                    <div
                                        className="h-full bg-gradient-to-r from-amber-400 to-orange-400 transition-all duration-200"
                                        style={{
                                            width: `${Math.max(8, Math.round((syncProgress.completed / syncProgress.total) * 100))}%`,
                                        }}
                                    />
                                </div>
                            </>
                        ) : (
                            <div className="text-[10px] text-white/80">正在写入云端结构...</div>
                        )}
                        <div className="text-[9px] text-white/60">请勿关闭或刷新浏览器</div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

export function projectPreviewMedia(nodes: CanvasNodeData[], preferLatestImage = false) {
    let cached = projectPreviewMediaCache.get(nodes);
    if (!cached) {
        let firstMedia: ProjectPreviewMedia | undefined;
        let firstImage: ProjectPreviewMedia | undefined;
        let latestMedia: ProjectPreviewMedia | undefined;
        let latestImage: ProjectPreviewMedia | undefined;
        for (const node of nodes) {
            if (node.type !== CanvasNodeType.Image && node.type !== CanvasNodeType.Video) continue;
            const url = getNodeMediaUrl(node);
            if (!isPreviewUrl(url)) continue;
            const media = { node, url, storageKey: node.metadata?.storageKey };
            firstMedia ||= media;
            latestMedia = media;
            if (node.type === CanvasNodeType.Image) {
                firstImage ||= media;
                latestImage = media;
            }
        }
        cached = { first: firstImage || firstMedia, latest: latestImage || latestMedia };
        projectPreviewMediaCache.set(nodes, cached);
    }
    return preferLatestImage ? cached.latest : cached.first;
}

function getNodeMediaUrl(node: CanvasNodeData) {
    const resourceId = resourceIdFromStorageKey(node.metadata?.storageKey);
    if (resourceId) return resourceFileUrl(resourceId);
    return resolveBackendApiUrl(node.metadata?.previewContent || node.metadata?.content || "");
}

function buildNodePreviewLayout(nodes: CanvasNodeData[]) {
    const minX = Math.min(...nodes.map((node) => node.position.x));
    const minY = Math.min(...nodes.map((node) => node.position.y));
    const maxX = Math.max(...nodes.map((node) => node.position.x + node.width));
    const maxY = Math.max(...nodes.map((node) => node.position.y + node.height));
    const spanX = Math.max(maxX - minX, 1);
    const spanY = Math.max(maxY - minY, 1);
    return nodes.map((node) => {
        const left = 6 + ((node.position.x - minX) / spanX) * 70;
        const top = 8 + ((node.position.y - minY) / spanY) * 66;
        const width = Math.min(92 - left, Math.max(16, Math.min(38, (node.width / spanX) * 78)));
        const height = Math.min(94 - top, Math.max(13, Math.min(24, (node.height / spanY) * 72)));
        return { node, style: { left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` } };
    });
}

function getNodePresentation(node: CanvasNodeData) {
    switch (node.type) {
        case CanvasNodeType.Text:
            return { label: "文本", icon: <FileText className="size-3.5" /> };
        case CanvasNodeType.Script:
            return { label: "分镜脚本", icon: <Clapperboard className="size-3.5" /> };
        case CanvasNodeType.Image:
            return { label: "图片", icon: <ImageIcon className="size-3.5" /> };
        case CanvasNodeType.Video:
            return { label: "视频", icon: <Video className="size-3.5" /> };
        case CanvasNodeType.Audio:
            return { label: "音频", icon: <Music2 className="size-3.5" /> };
        case CanvasNodeType.Drawing:
            return { label: "绘图", icon: <Pencil className="size-3.5" /> };
        case CanvasNodeType.Frame:
            return { label: "背板", icon: <Frame className="size-3.5" /> };
        case CanvasNodeType.Config:
            return { label: "生成配置", icon: <Settings2 className="size-3.5" /> };
        default:
            return { label: "技能", icon: <Sparkles className="size-3.5" /> };
    }
}

function isPreviewUrl(value?: string) {
    return Boolean(value && /^(https?:|blob:|data:image\/|data:video\/|\/api\/)/.test(value));
}

export function formatProjectTime(value: string) {
    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp)) return "刚刚修改";
    const elapsed = Math.max(0, Date.now() - timestamp);
    const minutes = Math.floor(elapsed / 60000);
    if (minutes < 1) return "刚刚修改";
    if (minutes < 60) return `${minutes} 分钟前修改`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} 小时前修改`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} 天前修改`;
    return new Date(value).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }) + " 修改";
}
