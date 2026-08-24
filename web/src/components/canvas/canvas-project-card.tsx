import { Check, Clapperboard, Download, FileText, Frame, Image as ImageIcon, MoreHorizontal, Music2, Pencil, Plus, Settings2, Sparkles, Trash2, Video, X } from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Dropdown, Input } from "antd";

import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { formatLocale } from "@/lib/format-locale";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { resourceFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import { resolveBackendApiUrl } from "@/stores/use-config-store";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

export function CanvasCreateCard({ disabled, onClick }: { disabled?: boolean; onClick: () => void }) {
    const { t } = useTranslation("canvas");
    return (
        <button type="button" className="app-canvas-create-card" disabled={disabled} onClick={onClick}>
            <span className="app-canvas-create-preview">
                <Plus className="app-canvas-create-icon" />
            </span>
            <span className="app-canvas-create-title">{t("canvas:new-canvas-2")}</span>
            <span className="app-canvas-create-meta">{t("domain:start-blank")}</span>
        </button>
    );
}

export function CanvasProjectCard({ project, projectName, variant = "library", readOnly = false, footer }: { project: CanvasProject; projectName?: string; variant?: "library" | "recent"; readOnly?: boolean; footer?: ReactNode }) {
    const { t } = useTranslation("canvas");
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
                        <input type="checkbox" checked={selected} onChange={(event) => toggleSelected(project.id, event.target.checked)} className="app-canvas-project-checkbox" aria-label={t("domain:select-param-2", { title: project.title })} />
                    </span>
                ) : null}
                <div className="canvas-project-cover-meta" aria-hidden="true">
                    <span className="canvas-project-node-count">
                        {project.nodes.length} {t("canvas:nodes-6")}
                    </span>
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
                            <button type="button" onClick={saveTitle} aria-label={t("domain:save-name")}>
                                <Check className="size-3.5" />
                            </button>
                            <button type="button" onClick={stopEditing} aria-label={t("domain:cancel-rename")}>
                                <X className="size-3.5" />
                            </button>
                        </div>
                    ) : !readOnly ? (
                        <div className="canvas-project-actions" onClick={(event) => event.stopPropagation()}>
                            <button type="button" onClick={() => startEditing(project.id, project.title)} aria-label={t("domain:rename-param", { title: project.title })} title={t("canvas:rename")}>
                                <Pencil className="size-3.5" />
                            </button>
                            <Dropdown
                                trigger={["click"]}
                                menu={{
                                    onClick: ({ domEvent }) => domEvent.stopPropagation(),
                                    items: [
                                        { key: "export", icon: <Download className="size-3.5" />, label: t("domain:export-canvas"), onClick: () => void exportCanvasProjects([project], project.title || t("domain:yingce-canvas")) },
                                        { type: "divider" },
                                        { key: "delete", danger: true, icon: <Trash2 className="size-3.5" />, label: t("canvas:delete-5"), onClick: () => setDeleteIds([project.id]) },
                                    ],
                                }}
                            >
                                <button type="button" aria-label={t("domain:param-canvas-actions", { title: project.title })} title={t("canvas:more-actions")}>
                                    <MoreHorizontal className="size-4" />
                                </button>
                            </Dropdown>
                        </div>
                    ) : null}
                </div>
                <div className="canvas-project-stats">
                    <span>{projectName || t("canvas:standalone-canvases")}</span>
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

export function ProjectPreview({ project, preferLatestImage = false }: { project: CanvasProject; preferLatestImage?: boolean }) {
    const { t } = useTranslation("canvas");
    const mediaNodes = project.nodes.flatMap((node) => {
        if (node.type !== CanvasNodeType.Image && node.type !== CanvasNodeType.Video) return [];
        const url = getNodeMediaUrl(node);
        return isPreviewUrl(url) ? [{ node, url, storageKey: node.metadata?.storageKey }] : [];
    });
    const imageNodes = mediaNodes.filter(({ node }) => node.type === CanvasNodeType.Image);
    const media = preferLatestImage ? imageNodes[imageNodes.length - 1] || mediaNodes[mediaNodes.length - 1] : imageNodes[0] || mediaNodes[0];
    if (media) {
        const { node, url, storageKey } = media;
        return (
            <div className="canvas-project-media size-full">
                {node.type === CanvasNodeType.Video ? (
                    <div className="canvas-project-video size-full">
                        <Video className="size-8" aria-label={node.title || t("domain:project-videos")} />
                    </div>
                ) : (
                    <CachedResourceImage storageKey={storageKey} src={url} alt={node.title || t("domain:project-images")} loading="lazy" decoding="async" className="size-full min-h-0 object-cover" />
                )}
            </div>
        );
    }
    const nodes = project.nodes.slice(0, 8);
    if (!nodes.length)
        return (
            <div className="canvas-project-empty size-full">
                <Plus className="canvas-project-empty-icon" />
                <span>{t("domain:blank-canvas")}</span>
                <small>{t("domain:waiting-for-the-first-scene")}</small>
            </div>
        );
    const previewNodes = buildNodePreviewLayout(nodes);

    return (
        <div className="canvas-project-preview-canvas relative size-full overflow-hidden">
            {previewNodes.map(({ node, style }) => {
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
    const { t } = useTranslation("canvas");
    switch (node.type) {
        case CanvasNodeType.Text:
            return { label: t("canvas:texts-2"), icon: <FileText className="size-3.5" /> };
        case CanvasNodeType.Script:
            return { label: t("canvas:storyboard-script"), icon: <Clapperboard className="size-3.5" /> };
        case CanvasNodeType.Image:
            return { label: t("canvas:images-3"), icon: <ImageIcon className="size-3.5" /> };
        case CanvasNodeType.Video:
            return { label: t("canvas:videos-4"), icon: <Video className="size-3.5" /> };
        case CanvasNodeType.Audio:
            return { label: t("canvas:audio-3"), icon: <Music2 className="size-3.5" /> };
        case CanvasNodeType.Drawing:
            return { label: t("canvas:drawing"), icon: <Pencil className="size-3.5" /> };
        case CanvasNodeType.Frame:
            return { label: t("canvas:backplate"), icon: <Frame className="size-3.5" /> };
        case CanvasNodeType.Config:
            return { label: t("canvas:generation-config"), icon: <Settings2 className="size-3.5" /> };
        default:
            return { label: t("canvas:skills"), icon: <Sparkles className="size-3.5" /> };
    }
}

function isPreviewUrl(value?: string) {
    return Boolean(value && /^(https?:|blob:|data:image\/|data:video\/|\/api\/)/.test(value));
}

export function formatProjectTime(value: string) {
    const { t } = useTranslation("canvas");
    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp)) return t("domain:modified-just-now");
    const elapsed = Math.max(0, Date.now() - timestamp);
    const minutes = Math.floor(elapsed / 60000);
    if (minutes < 1) return t("domain:modified-just-now");
    if (minutes < 60) return t("domain:modified-paramm-ago", { minutes: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t("domain:modified-paramh-ago", { hours: hours });
    const days = Math.floor(hours / 24);
    if (days < 7) return t("domain:modified-paramd-ago", { days: days });
    return new Date(value).toLocaleDateString(formatLocale(), { month: "numeric", day: "numeric" }) + t("domain:modified");
}
