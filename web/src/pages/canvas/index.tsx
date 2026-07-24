import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { App, Button, Dropdown, Empty, Input, Modal, Select } from "antd";
import { Download, FileUp, MoreHorizontal, Plus, Search, Trash2 } from "lucide-react";

import { CollectionGrid, ListToolbar, PageHeader, PaginationBar, WorkspacePage } from "@/components/layout/workspace-page";

import { readZip } from "@/lib/zip";
import { setMediaBlob } from "@/services/file-storage";
import { setImageBlob } from "@/services/image-storage";
import { CanvasProjectCard } from "@/components/canvas/canvas-project-card";
import type { CanvasExportFile } from "@/types/canvas-export";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { createCanvasProjectWithRemoteSync, saveRemoteUserDataNow } from "@/services/user-data-sync";
import { listProjects } from "@/services/api/projects";

export default function CanvasPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const inputRef = useRef<HTMLInputElement>(null);
    const autoOpenRef = useRef(false);
    const [keyword, setKeyword] = useState("");
    const [sort, setSort] = useState<"updated" | "name" | "nodes">("updated");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(24);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const importProject = useCanvasStore((state) => state.importProject);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const updateProject = useCanvasStore((state) => state.updateProject);
    const [associationOpen, setAssociationOpen] = useState(false);
    const [associationProjectId, setAssociationProjectId] = useState("");
    const projectQuery = useQuery({ queryKey: ["projects"], queryFn: listProjects });

    const mode = searchParams.get("mode");
    const agentMode = mode === "new" || mode === "recent" || mode === "choose";
    const agentQuery = agentMode ? `?${searchParams.toString()}` : "";
    const enterProject = (id: string) => {
        navigate(`/canvas/${id}${agentQuery}`);
    };
    const createAndEnter = () => {
        void createCanvasProjectWithRemoteSync(`无限画布 ${projects.length + 1}`).then(({ id, syncError }) => {
            if (syncError) message.warning(syncError instanceof Error ? `画布已在本地创建，云端同步失败：${syncError.message}` : "画布已在本地创建，云端同步失败");
            enterProject(id);
        });
    };
    const filteredProjects = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        const values = query ? projects.filter((project) => project.title.toLowerCase().includes(query)) : [...projects];
        values.sort((a, b) => sort === "name" ? a.title.localeCompare(b.title, "zh-CN") : sort === "nodes" ? b.nodes.length - a.nodes.length : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        return values;
    }, [keyword, projects, sort]);
    const visibleProjects = filteredProjects.slice((page - 1) * pageSize, page * pageSize);
    const selectedProjects = projects.filter((project) => selectedIds.includes(project.id));
    const associateSelected = async (nextProjectId = associationProjectId) => {
        const projectId = nextProjectId || undefined;
        selectedIds.forEach((id) => updateProject(id, { projectId }));
        try {
            await saveRemoteUserDataNow();
            message.success(projectId ? "已加入项目" : "已移出项目，画布仍保留");
            setAssociationOpen(false);
        } catch (error) {
            message.error(error instanceof Error ? `画布关系保存失败：${error.message}` : "画布关系保存失败");
        }
    };
    const importCanvas = async (file?: File) => {
        if (!file) return;
        try {
            const zip = await readZip(file);
            const projectFile = zip.get("projects.json");
            if (!projectFile) throw new Error("missing projects.json");
            const data = JSON.parse(await projectFile.text()) as CanvasExportFile;
            await Promise.all(
                data.projects.flatMap((project) =>
                    project.files.map(async (item) => {
                        const blob = zip.get(item.path);
                        if (!blob) return;
                        const typedBlob = blob.type ? blob : blob.slice(0, blob.size, item.mimeType);
                        await (item.storageKey.startsWith("image:") ? setImageBlob(item.storageKey, typedBlob) : setMediaBlob(item.storageKey, typedBlob));
                    }),
                ),
            );
            data.projects.forEach((item) => importProject(item.project));
            message.success(`已导入 ${data.projects.length} 个画布`);
        } catch {
            message.error("导入失败，请选择有效的画布压缩包");
        } finally {
            if (inputRef.current) inputRef.current.value = "";
        }
    };

    useEffect(() => {
        if (!hydrated || autoOpenRef.current || (mode !== "new" && mode !== "recent")) return;
        autoOpenRef.current = true;
        if (mode === "recent" && projects[0]?.id) {
            enterProject(projects[0].id);
            return;
        }
        void createCanvasProjectWithRemoteSync(`无限画布 ${projects.length + 1}`).then(({ id, syncError }) => {
            if (syncError) message.warning(syncError instanceof Error ? `画布已在本地创建，云端同步失败：${syncError.message}` : "画布已在本地创建，云端同步失败");
            enterProject(id);
        });
    }, [hydrated, message, mode, projects]);

    if (hydrated && (mode === "new" || mode === "recent")) return <main className="flex h-full items-center justify-center bg-background text-sm text-stone-500">正在打开画布...</main>;

    return (
        <WorkspacePage grid>
                <PageHeader
                    title="我的画布"
                    description="管理创作项目，快速继续最近的画布。"
                    meta={<span className="text-xs text-foreground/45">{hydrated ? `${filteredProjects.length} 个项目${selectedIds.length ? ` · 已选择 ${selectedIds.length} 个` : ""}` : "正在载入"}</span>}
                    actions={(
                        <>
                        {selectedIds.length ? (
                            <>
                                <Button disabled={!hydrated || projectQuery.isLoading} onClick={() => { setAssociationProjectId(selectedProjects[0]?.projectId || ""); setAssociationOpen(true); }}>加入项目</Button>
                                {selectedProjects.some((project) => project.projectId) ? <Button disabled={!hydrated} onClick={() => { setAssociationProjectId(""); void associateSelected(""); }}>移出项目</Button> : null}
                                <Button disabled={!hydrated} icon={<Download className="size-3.5" />} onClick={() => void exportCanvasProjects(projects.filter((project) => selectedIds.includes(project.id)), `无限画布-${selectedIds.length}个项目`)}>导出选中</Button>
                                <Button danger disabled={!hydrated} onClick={() => setDeleteIds(selectedIds)}>删除选中</Button>
                            </>
                        ) : null}
                        {projects.length ? (
                                    <Dropdown menu={{ items: [{ key: "delete-all", danger: true, icon: <Trash2 className="size-3.5" />, label: "删除全部画布", onClick: () => setDeleteIds(projects.map((project) => project.id)) }] }} trigger={["click"]}>
                                <Button aria-label="更多画布操作" icon={<MoreHorizontal className="size-4" />} />
                                    </Dropdown>
                                ) : null}
                        <Button disabled={!hydrated} icon={<FileUp className="size-3.5" />} onClick={() => inputRef.current?.click()}>导入画布</Button>
                        <Button type="primary" disabled={!hydrated} icon={<Plus className="size-3.5" />} onClick={createAndEnter}>新建画布</Button>
                        </>
                    )}
                />

                <ListToolbar active={Boolean(keyword || sort !== "updated")} onReset={() => { setKeyword(""); setSort("updated"); setPage(1); }}>
                    <Input allowClear className="w-full sm:w-72" prefix={<Search className="size-4 text-foreground/40" />} value={keyword} placeholder="搜索画布名称" onChange={(event) => { setKeyword(event.target.value); setPage(1); }} />
                    <Select className="w-36" value={sort} onChange={(value) => { setSort(value); setPage(1); }} options={[{ label: "最近更新", value: "updated" }, { label: "名称排序", value: "name" }, { label: "节点数量", value: "nodes" }]} />
                </ListToolbar>

                {!hydrated ? (
                    <section className="flex min-h-[320px] items-center justify-center text-sm text-foreground/50">正在加载画布...</section>
                ) : visibleProjects.length ? (
                    <CollectionGrid>
                        {visibleProjects.map((project) => (
                            <CanvasProjectCard key={project.id} project={project} />
                        ))}
                    </CollectionGrid>
                ) : (
                    <section className="flex min-h-[320px] flex-col items-center justify-center text-center">
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span className="text-foreground/50">{keyword ? "没有匹配的画布" : "还没有画布"}</span>} />
                        {!keyword ? <Button className="mt-5" type="primary" icon={<Plus className="size-3.5" />} onClick={createAndEnter}>新建画布</Button> : null}
                    </section>
                )}

                <PaginationBar current={page} pageSize={pageSize} total={filteredProjects.length} pageSizeOptions={[12, 24, 48]} onChange={(nextPage, nextPageSize) => { setPage(nextPageSize !== pageSize ? 1 : nextPage); setPageSize(nextPageSize); }} />

                <input ref={inputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importCanvas(event.target.files?.[0])} />
                <Modal title="加入项目" open={associationOpen} okText="保存关联" cancelText="取消" okButtonProps={{ disabled: !associationProjectId, loading: projectQuery.isFetching }} onCancel={() => setAssociationOpen(false)} onOk={() => void associateSelected()}>
                    <p className="mb-3 text-sm text-foreground/60">选中的画布会保留原有节点和本地媒体，只增加项目关联。</p>
                    <Select className="w-full" value={associationProjectId || undefined} placeholder="选择项目" options={(projectQuery.data?.projects || []).map((item) => ({ label: item.project.name, value: item.project.id }))} onChange={setAssociationProjectId} />
                </Modal>
        </WorkspacePage>
    );
}
