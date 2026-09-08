import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { App, Input, Modal } from "antd";
import { ChevronRight, Folder, Pencil } from "lucide-react";

import { createProject, updateProject, type Project, type ProjectSummary } from "@/services/api/projects";
import { useUserStore } from "@/stores/use-user-store";

export function CanvasProjectFolders({ folders, onOpen, onRename }: {
    folders: ProjectSummary[];
    onOpen: (id: string) => void;
    onRename: (project: Project) => void;
}) {
    return (
        <ul className="my-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="项目文件夹">
            {folders.map(({ project, canvasCount }) => (
                <li key={project.id} className="flex min-w-0 items-center rounded-[var(--r-lg)] bg-[var(--card-surface)] p-2">
                    <button type="button" className="flex min-w-0 flex-1 items-center gap-3 rounded-[var(--r-sm)] p-3 text-left hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-[var(--workspace-accent)]" onClick={() => onOpen(project.id)} aria-label={`打开项目文件夹 ${project.name}`}>
                        <Folder className="size-9 shrink-0 text-[var(--workspace-accent)]" aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium" title={project.name}>{project.name}</span>
                            <span className="mt-1 block text-xs text-muted-foreground">{canvasCount} 个画布{project.status === "archived" ? " · 已归档" : ""}</span>
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </button>
                    <button type="button" className="grid size-8 shrink-0 place-items-center rounded-[var(--r-sm)] text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--workspace-accent)]" onClick={() => onRename(project)} aria-label={`重命名项目文件夹 ${project.name}`} title="重命名项目文件夹">
                        <Pencil className="size-3.5" aria-hidden="true" />
                    </button>
                </li>
            ))}
        </ul>
    );
}

export function CanvasProjectFolderDialog({ project, onClose, onCreated }: {
    project?: Project;
    onClose: () => void;
    onCreated: (id: string) => void;
}) {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const userId = useUserStore((state) => state.user?.id);
    const [name, setName] = useState(project?.name || "");
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);
    const [error, setError] = useState("");
    const save = async () => {
        if (savingRef.current || !name.trim()) return;
        savingRef.current = true;
        setSaving(true);
        setError("");
        try {
            if (!userId || useUserStore.getState().user?.id !== userId) throw new Error("登录状态已变化，请重新打开文件夹操作");
            const result = project
                ? await updateProject(project.id, { name: name.trim() })
                : await createProject({ name: name.trim(), type: "short-drama", aspectRatio: "9:16", sourceType: "blank" });
            if (useUserStore.getState().user?.id !== userId) return;
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ["projects"] }),
                queryClient.invalidateQueries({ queryKey: ["project", result.project.id] }),
            ]);
            if (useUserStore.getState().user?.id !== userId) return;
            message.success(project ? "项目文件夹已重命名" : "项目文件夹已创建");
            onClose();
            if (!project) onCreated(result.project.id);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "项目文件夹保存失败，请重试");
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };
    return (
        <Modal open title={project ? "重命名项目文件夹" : "新建项目文件夹"} okText={project ? "保存" : "创建"} cancelText="取消" confirmLoading={saving} okButtonProps={{ disabled: !name.trim() }} cancelButtonProps={{ disabled: saving }} closable={!saving} maskClosable={!saving} keyboard={!saving} onCancel={onClose} onOk={() => void save()}>
            <p className="mb-4 text-sm text-muted-foreground">{project ? "文件夹名称与“短剧创作”中的项目名称同步更新。" : "用一部短剧的名称创建文件夹，再按角色设定、分集分镜等用途添加多个画布。"}</p>
            <label htmlFor="canvas-project-folder-name" className="mb-2 block text-sm">项目文件夹名称</label>
            <Input id="canvas-project-folder-name" autoFocus maxLength={240} value={name} disabled={saving} placeholder="例如：重生之逆袭" status={error ? "error" : undefined} aria-describedby={error ? "canvas-project-folder-error" : undefined} onChange={(event) => { setName(event.target.value); setError(""); }} onPressEnter={() => void save()} />
            {error ? <p id="canvas-project-folder-error" role="alert" className="mt-2 text-sm text-[var(--destructive)]">{error}</p> : null}
        </Modal>
    );
}
