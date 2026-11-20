import { App, Input } from "antd";
import { CanvasAnchoredDropdown as Dropdown } from "./canvas-anchored-dropdown";
import { Clock3, Download, FolderKanban, Layers3, LoaderCircle, MoreHorizontal, Pencil, Shapes, Trash2 } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import { ProjectPreview } from "@/components/canvas/canvas-project-card";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { formatAbsoluteDateTime, formatRelativeTime } from "@/lib/relative-time";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import type { CanvasLibrarySummary } from "@/services/api/user-data";
import { loadCanvasProjectForEditing, saveRemoteUserDataNow } from "@/services/user-data-sync";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { cn } from "@/lib/utils";

type CanvasFolderCardProps = {
    project: CanvasLibrarySummary;
    projectName?: string;
    onClick: () => void;
    onPrefetch?: () => void;
    opening?: boolean;
};

/**
 * 画布库卡片：内嵌圆角封面（最多三张媒体拼图）+ 标题 + 归属/更新时间页脚。
 * 节点数作为封面角标；重命名铅笔紧跟标题行尾，多选框与更多菜单浮在封面顶部，仅 hover/focus 显示，触屏常显。
 */
export function CanvasFolderCard({ project, projectName, onClick, onPrefetch, opening = false }: CanvasFolderCardProps) {
    const { message } = App.useApp();
    const { t } = useTranslation();
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
    const updatedTitle = t("canvasB.folderCard.updatedTitle", { updated: formatAbsoluteDateTime(project.updatedAt), created: formatAbsoluteDateTime(project.createdAt) });

    const saveTitle = async () => {
        if (!editing) return;
        stopEditing();
        try {
            await loadCanvasProjectForEditing(project.id);
            renameProject(project.id, editingTitle);
            await saveRemoteUserDataNow(project.id);
        } catch (error) { message.error(error instanceof Error ? error.message : t("canvasB.common.renameFailed")); }
    };
    const exportProject = async () => {
        try {
            const fullProject = await loadCanvasProjectForEditing(project.id);
            if (!fullProject) throw new Error(t("canvasB.folderCard.notFound"));
            await exportCanvasProjects([fullProject], project.title || t("canvasB.common.canvas"));
        } catch (error) { message.error(error instanceof Error ? error.message : t("canvasB.common.exportFailed")); }
    };

    const handleOpenKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (!editing && !opening) onClick();
        }
    };

    return (
        <article className={cn("product-collection-card canvas-collection-card", selected && "is-selected", editing && "is-editing", opening && "is-opening")} onPointerEnter={onPrefetch} onPointerDown={onPrefetch} onFocusCapture={onPrefetch}>
            <div className="canvas-collection-open" role="button" tabIndex={0} aria-label={t("canvasB.folderCard.openCanvas", { title: project.title })} aria-busy={opening} onClick={() => !editing && !opening && onClick()} onKeyDown={handleOpenKeyDown}>
                <div className="canvas-collection-preview">
                    <div className="canvas-collection-preview-media" aria-hidden="true">
                        <ProjectPreview project={{ id: project.id, nodes: project.previewNodes }} preferLatestImage quiet mosaic />
                    </div>
                    <span className="canvas-collection-badge" title={t("canvasB.folderCard.nodeCount", { count: project.nodeCount })}>
                        <Layers3 aria-hidden="true" />
                        <span>{project.nodeCount}</span>
                        <span className="sr-only">{t("canvasB.folderCard.nodesSuffix")}</span>
                    </span>
                    {opening ? <div className="canvas-collection-opening"><LoaderCircle className="size-5 animate-spin" aria-hidden="true" /><span>正在打开</span></div> : null}
                </div>
                <div className="canvas-collection-body">
                    <div className="canvas-collection-heading-row">
                        {editing ? (
                            <Input
                                className="canvas-collection-title-input"
                                size="small"
                                value={editingTitle}
                                aria-label={t("canvasB.folderCard.canvasName")}
                                onChange={(event) => setEditingTitle(event.target.value)}
                                onClick={(event) => event.stopPropagation()}
                                onBlur={saveTitle}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") saveTitle();
                                    if (event.key === "Escape") stopEditing();
                                }}
                                autoFocus
                            />
                        ) : (
                            <span className="canvas-collection-title" title={project.title}>{project.title}</span>
                        )}
                    </div>
                    <div className="canvas-collection-footer">
                        <span className={cn("canvas-collection-project", !projectName && "is-free")} title={projectName ? t("canvasB.folderCard.belongsToProject", { name: projectName }) : t("canvasB.folderCard.freeCanvasHint")}>
                            {projectName ? <FolderKanban aria-hidden="true" /> : <Shapes aria-hidden="true" />}
                            <span>{projectName || t("canvasB.folderCard.freeCanvas")}</span>
                        </span>
                        <time className="canvas-collection-updated" dateTime={project.updatedAt} title={updatedTitle}>
                            <Clock3 aria-hidden="true" />
                            {formatRelativeTime(project.updatedAt)}
                        </time>
                    </div>
                </div>
            </div>

            {!editing ? (
                <button
                    type="button"
                    className="product-icon-button canvas-collection-rename"
                    aria-label={t("canvasB.folderCard.renameTitle", { title: project.title })}
                    title={t("canvasB.common.rename")}
                    onClick={(event) => {
                        event.stopPropagation();
                        startEditing(project.id, project.title);
                    }}
                >
                    <Pencil />
                </button>
            ) : null}

            <span className={cn("canvas-collection-select", selected && "is-visible")} onClick={(event) => event.stopPropagation()}>
                <input
                    type="checkbox"
                    checked={selected}
                    onChange={(event) => toggleSelected(project.id, event.target.checked)}
                    aria-label={t("canvasB.folderCard.selectTitle", { title: project.title })}
                />
            </span>

            <div className="canvas-collection-actions" onClick={(event) => event.stopPropagation()}>
                <Dropdown
                    trigger={["click"]}
                    placement="bottomRight"
                    menu={{
                        onClick: ({ domEvent }) => domEvent.stopPropagation(),
                        items: [
                            { key: "rename", icon: <Pencil className="size-3.5" />, label: t("canvasB.common.rename"), onClick: () => startEditing(project.id, project.title) },
                            { key: "export", icon: <Download className="size-3.5" />, label: t("canvasB.folderCard.exportCanvas"), onClick: () => void exportProject() },
                            { type: "divider" },
                            { key: "delete", danger: true, icon: <Trash2 className="size-3.5" />, label: t("common.delete"), onClick: () => setDeleteIds([project.id]) },
                        ],
                    }}
                >
                    <button type="button" className="product-icon-button canvas-collection-more" aria-label={t("canvasB.folderCard.canvasActions", { title: project.title })} title={t("canvasB.common.moreActions")} onClick={(event) => event.stopPropagation()}>
                        <MoreHorizontal />
                    </button>
                </Dropdown>
            </div>
        </article>
    );
}
