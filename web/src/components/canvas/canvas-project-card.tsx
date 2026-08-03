import { Check, Clapperboard, Download, FileText, Frame, Image as ImageIcon, MoreHorizontal, Music2, Pencil, Settings2, Sparkles, Trash2, Video, X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router";
import { Dropdown, Input } from "antd";

import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { resourceFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import { resolveBackendApiUrl } from "@/stores/use-config-store";
import { cn } from "@/lib/utils";

export function CanvasProjectCard({ project, projectName, variant = "library" }: { project: CanvasProject; projectName?: string; variant?: "library" | "recent" }) {
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
        <article className={cn("app-canvas-project-card group h-full cursor-pointer", compact ? "is-recent" : "is-library overflow-hidden rounded-lg border", selected && "is-selected")} onClick={() => !editing && open()}>
            <div className="app-canvas-project-preview relative">
                <button
                    type="button"
                    className={cn("block w-full overflow-hidden text-left", compact ? "aspect-[16/10]" : "aspect-video")}
                    onClick={(event) => {
                        event.stopPropagation();
                        open();
                    }}
                >
                    <ProjectPreview project={project} />
                </button>
                {!compact ? <span className={`absolute left-2.5 top-2.5 grid size-6 place-items-center rounded-md border border-black/10 bg-white/90 shadow-sm backdrop-blur transition-opacity dark:border-white/10 dark:bg-stone-900/90 ${selected ? "opacity-100" : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"}`} onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={selected} onChange={(event) => toggleSelected(project.id, event.target.checked)} className="app-canvas-project-checkbox size-3.5" aria-label={`选择 ${project.title}`} /></span> : null}
                <span className="absolute bottom-2 right-2 rounded-md border border-white/15 bg-stone-950/80 px-1.5 py-0.5 text-[var(--fs-tiny)] font-medium text-white backdrop-blur-xl">{project.nodes.length} 节点</span>
            </div>

            <div className={cn("app-canvas-project-body", compact ? "px-1 pb-1 pt-2.5" : "px-3 py-2.5")}>
                <div className="flex min-h-7 items-center justify-between gap-2">
                {editing ? (
                    <Input className="min-w-0" value={editingTitle} onClick={(event) => event.stopPropagation()} onChange={(event) => setEditingTitle(event.target.value)} onKeyDown={(event) => event.key === "Enter" && saveTitle()} autoFocus />
                ) : (
                    <button
                        type="button"
                        className="min-w-0 flex-1 cursor-pointer text-left focus-visible:outline-none"
                        onClick={(event) => {
                            event.stopPropagation();
                            open();
                        }}
                    >
                        <h2 className="truncate text-[var(--fs-body)] font-semibold leading-5 text-foreground">{project.title}</h2>
                    </button>
                )}
                    {editing ? (
                        <div className="flex shrink-0 items-center gap-1" onClick={(event) => event.stopPropagation()}>
                            <button type="button" className="grid size-7 place-items-center rounded-md hover:bg-black/5 dark:hover:bg-white/10" onClick={saveTitle} aria-label="保存名称"><Check className="size-3.5" /></button>
                            <button type="button" className="grid size-7 place-items-center rounded-md hover:bg-black/5 dark:hover:bg-white/10" onClick={stopEditing} aria-label="取消重命名"><X className="size-3.5" /></button>
                        </div>
                    ) : (
                        <div className="flex shrink-0 items-center" onClick={(event) => event.stopPropagation()}>
                            <button type="button" className="grid size-7 place-items-center rounded-md text-foreground/38 transition-colors hover:bg-foreground/[.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/10" onClick={() => startEditing(project.id, project.title)} aria-label={`重命名 ${project.title}`} title="重命名"><Pencil className="size-3.5" /></button>
                            <Dropdown
                                trigger={["click"]}
                                menu={{
                                    onClick: ({ domEvent }) => domEvent.stopPropagation(),
                                    items: [
                                        { key: "export", icon: <Download className="size-3.5" />, label: "导出画布", onClick: () => void exportCanvasProjects([project], project.title || "影策画布") },
                                        { type: "divider" },
                                        { key: "delete", danger: true, icon: <Trash2 className="size-3.5" />, label: "删除", onClick: () => setDeleteIds([project.id]) },
                                    ],
                                }}
                            >
                                <button type="button" className="grid size-7 place-items-center rounded-md text-foreground/38 transition-colors hover:bg-foreground/[.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/10" aria-label={`${project.title} 画布操作`} title="更多操作"><MoreHorizontal className="size-4" /></button>
                            </Dropdown>
                        </div>
                    )}
                </div>
                <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[var(--fs-label)] leading-4 text-foreground/52">
                    <span className="truncate">{projectName || "自由画布"}</span>
                    <span className="shrink-0 text-foreground/28" aria-hidden="true">·</span>
                    <span className="shrink-0 tabular-nums">{project.connections.length} 条连线</span>
                </div>
                <p className="mt-1 text-[var(--fs-tiny)] leading-4 tabular-nums text-foreground/38">更新于 {formatProjectTime(project.updatedAt)}</p>
            </div>
        </article>
    );
}

function ProjectPreview({ project }: { project: CanvasProject }) {
    const mediaNodes = project.nodes
        .flatMap((node) => {
            if (node.type !== CanvasNodeType.Image && node.type !== CanvasNodeType.Video) return [];
            const url = getNodeMediaUrl(node);
            return isPreviewUrl(url) ? [{ node, url }] : [];
        });
    const media = mediaNodes.find(({ node }) => node.type === CanvasNodeType.Image) || mediaNodes[0];
    if (media) {
        const { node, url } = media;
        return (
            <div className="size-full bg-stone-900">
                {node.type === CanvasNodeType.Video
                    ? <div className="flex size-full items-center justify-center bg-stone-900 text-stone-300"><Video className="size-8" aria-label={node.title || "项目视频"} /></div>
                    : <img src={url} alt={node.title || "项目图片"} loading="lazy" decoding="async" className="size-full min-h-0 object-cover" />}
            </div>
        );
    }
    const nodes = project.nodes.slice(0, 8);
    if (!nodes.length) return <div className="flex size-full items-center justify-center bg-stone-100 text-xs text-stone-400 dark:bg-stone-900 dark:text-stone-500">空白画布</div>;
    const previewNodes = buildNodePreviewLayout(nodes);

    return (
        <div className="relative size-full overflow-hidden bg-stone-100/80 bg-[linear-gradient(rgba(17,24,39,.05)_1px,transparent_1px),linear-gradient(90deg,rgba(17,24,39,.05)_1px,transparent_1px)] bg-[size:20px_20px] dark:bg-stone-950/80 dark:bg-[linear-gradient(rgba(255,255,255,.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.05)_1px,transparent_1px)]">
            {previewNodes.map(({ node, style }) => {
                const presentation = getNodePresentation(node);
                return (
                    <span key={node.id} className="absolute flex min-w-0 items-center gap-1.5 overflow-hidden rounded-md border border-stone-300/90 bg-white/90 px-2 text-left shadow-sm backdrop-blur-sm dark:border-stone-700 dark:bg-stone-900/92" style={style}>
                        <span className="grid size-5 shrink-0 place-items-center text-stone-500 dark:text-stone-300">{presentation.icon}</span>
                        <span className="min-w-0 truncate text-[var(--fs-micro)] font-semibold text-stone-700 dark:text-stone-200">{node.title || presentation.label}</span>
                    </span>
                );
            })}
        </div>
    );
}

function getNodeMediaUrl(node: CanvasNodeData) {
    const resourceId = resourceIdFromStorageKey(node.metadata?.storageKey);
    if (resourceId) return resourceFileUrl(resourceId);
    return resolveBackendApiUrl(node.metadata?.content || "");
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
    return Boolean(value && (/^(https?:|blob:|data:image\/|data:video\/|\/api\/)/.test(value)));
}

function formatProjectTime(value: string) {
    return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
