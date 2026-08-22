import { Dropdown, Input } from "antd";
import { Download, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import type { KeyboardEvent } from "react";

import { ProjectPreview } from "@/components/canvas/canvas-project-card";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { cn } from "@/lib/utils";

type CanvasFolderCardProps = {
    project: CanvasProject;
    projectName?: string;
    onClick: () => void;
};

/** 画布库中的文件夹封面：单一卡片表面承载预览和信息，避免相邻卡片互相侵入。 */
export function CanvasFolderCard({ project, projectName, onClick }: CanvasFolderCardProps) {
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

    const saveTitle = () => {
        renameProject(project.id, editingTitle);
        stopEditing();
    };

    const handleOpenKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (!editing) onClick();
        }
    };

    return (
        <article className={cn("canvas-folder-card", selected && "is-selected", editing && "is-editing")}>
            <div className="canvas-folder-open" role="button" tabIndex={0} aria-label={`打开画布 ${project.title}`} onClick={() => !editing && onClick()} onKeyDown={handleOpenKeyDown}>
                <div className="canvas-folder-preview" aria-hidden="true">
                    <ProjectPreview project={project} preferLatestImage />
                </div>
                <div className="canvas-folder-body">
                    <div className="canvas-folder-heading-row">
                        {editing ? (
                            <Input
                                className="canvas-folder-title-input"
                                value={editingTitle}
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
                            <span className="canvas-folder-title">{project.title}</span>
                        )}
                    </div>
                    <div className="canvas-folder-meta">
                        <span className="canvas-folder-meta-item">{projectName ? `所属项目：${projectName}` : "自由画布"}</span>
                        <span className="canvas-folder-meta-separator" aria-hidden="true">·</span>
                        <span className="canvas-folder-meta-item">{project.nodes.length} 节点</span>
                    </div>
                    <div className="canvas-folder-dates">
                        <span><small>创建时间</small><time dateTime={project.createdAt}>{formatCanvasDate(project.createdAt)}</time></span>
                        <span><small>最后更新</small><time dateTime={project.updatedAt}>{formatCanvasDate(project.updatedAt)}</time></span>
                    </div>
                </div>
            </div>

            <span className={cn("canvas-folder-select", selected && "is-visible")} onClick={(event) => event.stopPropagation()}>
                <input
                    type="checkbox"
                    checked={selected}
                    onChange={(event) => toggleSelected(project.id, event.target.checked)}
                    aria-label={`选择 ${project.title}`}
                />
            </span>

            <div className="canvas-folder-actions" onClick={(event) => event.stopPropagation()}>
                {!editing ? (
                    <button
                        type="button"
                        className="canvas-folder-rename"
                        aria-label={`重命名 ${project.title}`}
                        title="重命名"
                        onClick={(event) => {
                            event.stopPropagation();
                            startEditing(project.id, project.title);
                        }}
                    >
                        <Pencil />
                    </button>
                ) : null}

                <Dropdown
                    trigger={["click"]}
                    placement="bottomRight"
                    menu={{
                        onClick: ({ domEvent }) => domEvent.stopPropagation(),
                        items: [
                            { key: "export", icon: <Download className="size-3.5" />, label: "导出画布", onClick: () => void exportCanvasProjects([project], project.title || "影策画布") },
                            { type: "divider" },
                            { key: "delete", danger: true, icon: <Trash2 className="size-3.5" />, label: "删除", onClick: () => setDeleteIds([project.id]) },
                        ],
                    }}
                >
                    <button type="button" className="canvas-folder-more" aria-label={`${project.title} 画布操作`} title="更多操作" onClick={(event) => event.stopPropagation()}>
                        <MoreHorizontal />
                    </button>
                </Dropdown>
            </div>
        </article>
    );
}

function formatCanvasDate(value: string) {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp)
        ? new Date(timestamp).toLocaleString("zh-CN", {
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
          })
        : "时间不可用";
}
