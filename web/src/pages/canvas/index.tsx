import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { App, Button, Dropdown, Modal, Select } from "antd";
import { ArrowDownAZ, Clock3, Download, FileUp, ListFilter, MoreHorizontal, Search, SlidersHorizontal, Trash2, X } from "lucide-react";

import { CollectionGrid, PageHeader, PaginationBar, WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceLoadingState, WorkspaceState } from "@/components/layout/workspace-state";

import { readZip } from "@/lib/zip";
import { setMediaBlob } from "@/services/file-storage";
import { setImageBlob } from "@/services/image-storage";
import { CanvasCreateCard, CanvasProjectCard } from "@/components/canvas/canvas-project-card";
import type { CanvasExportFile } from "@/types/canvas-export";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { saveCanvasDrawing, type CanvasDrawingRenderDraft } from "@/lib/canvas/canvas-drawing-storage";
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
    const [projectFilter, setProjectFilter] = useState("all");
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
        void createCanvasProjectWithRemoteSync(`自由画布 ${projects.length + 1}`).then(({ id, syncError }) => {
            if (syncError) message.warning(syncError instanceof Error ? `画布已在本地创建，云端同步失败：${syncError.message}` : "画布已在本地创建，云端同步失败");
            enterProject(id);
        });
    };
    const filteredProjects = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        const scoped = projects.filter((project) => projectFilter === "all" || (projectFilter === "independent" ? !project.projectId : project.projectId === projectFilter));
        const values = query ? scoped.filter((project) => project.title.toLowerCase().includes(query)) : [...scoped];
        values.sort((a, b) => sort === "name" ? a.title.localeCompare(b.title, "zh-CN") : sort === "nodes" ? b.nodes.length - a.nodes.length : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        return values;
    }, [keyword, projectFilter, projects, sort]);
    const projectNames = useMemo(() => new Map((projectQuery.data?.projects || []).map(({ project }) => [project.id, project.name])), [projectQuery.data]);
    const visibleProjects = filteredProjects.slice((page - 1) * pageSize, page * pageSize);
    const showCreateCard = !keyword.trim() && projectFilter === "all";
    const selectedProjects = projects.filter((project) => selectedIds.includes(project.id));
    const projectFilterLabel = projectFilter === "all" ? "全部画布" : projectFilter === "independent" ? "自由画布" : projectNames.get(projectFilter) || "项目画布";
    const sortLabel = sort === "name" ? "按名称" : sort === "nodes" ? "按节点" : "最近更新";
    const projectFilterItems = useMemo(() => [
        { key: "all", label: "全部画布" },
        { key: "independent", label: "自由画布" },
        ...(projectQuery.data?.projects || []).map(({ project }) => ({ key: project.id, label: project.name })),
    ], [projectQuery.data]);
    const sortItems = [
        { key: "updated", label: "最近更新", icon: <Clock3 className="size-3.5" /> },
        { key: "name", label: "按名称", icon: <ArrowDownAZ className="size-3.5" /> },
        { key: "nodes", label: "按节点数量", icon: <ListFilter className="size-3.5" /> },
    ];
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
            await Promise.all(data.projects.map(async (item) => {
                const drawingEngineById = new Map((item.drawingDocuments || []).map((document) => [document.drawingId, document.engine || "tldraw"]));
                const importedProjectId = importProject({
                    ...item.project,
                    nodes: item.project.nodes.map((node) => node.type === "drawing" && node.metadata?.drawingId
                        ? { ...node, metadata: { ...node.metadata, drawingEngine: drawingEngineById.get(node.metadata.drawingId) || node.metadata.drawingEngine || "tldraw" } }
                        : node),
                });
                await Promise.all((item.drawingDocuments || []).map((document) => {
                    const previewFile = document.previewPath ? zip.get(document.previewPath) : undefined;
                    const preview = previewFile && !previewFile.type ? previewFile.slice(0, previewFile.size, "image/png") : previewFile;
                    const renderFile = document.generationRender?.path ? zip.get(document.generationRender.path) : undefined;
                    const renderBlob = renderFile && !renderFile.type ? renderFile.slice(0, renderFile.size, document.generationRender?.mimeType || "image/png") : renderFile;
                    const render = renderBlob && document.generationRender
                        ? {
                              blob: renderBlob,
                              pageId: document.generationRender.pageId,
                              width: document.generationRender.width,
                              height: document.generationRender.height,
                              mimeType: document.generationRender.mimeType,
                              background: document.generationRender.background,
                          } satisfies CanvasDrawingRenderDraft
                        : undefined;
                    const engine = document.engine || "tldraw";
                    return saveCanvasDrawing(importedProjectId, document.drawingId, engine, document.snapshot, {
                        version: 2,
                        engine,
                        snapshot: document.snapshot,
                        revision: Math.max(0, document.revision - 1),
                        updatedAt: document.updatedAt,
                        shapeCount: document.shapeCount,
                        pageCount: document.pageCount,
                    }, preview, render);
                }));
            }));
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
        void createCanvasProjectWithRemoteSync(`自由画布 ${projects.length + 1}`).then(({ id, syncError }) => {
            if (syncError) message.warning(syncError instanceof Error ? `画布已在本地创建，云端同步失败：${syncError.message}` : "画布已在本地创建，云端同步失败");
            enterProject(id);
        });
    }, [hydrated, message, mode, projects]);

    if (hydrated && (mode === "new" || mode === "recent")) return <main className="flex h-full items-center justify-center bg-background text-sm text-stone-500">正在打开画布...</main>;

    return (
        <WorkspacePage grid className="canvas-library-page">
                <PageHeader
                    icon="canvas"
                    title="画布"
                    description="把镜头、素材和想法留在同一张画布里。"
                    actions={(
                        <>
                        {projects.length ? (
                                    <Dropdown menu={{ items: [{ key: "delete-all", danger: true, icon: <Trash2 className="size-3.5" />, label: "删除全部画布", onClick: () => setDeleteIds(projects.map((project) => project.id)) }] }} trigger={["click"]}>
                                <Button className="!h-9 !w-9 !p-0" aria-label="更多画布操作" title="更多操作" icon={<MoreHorizontal className="size-4" />} />
                        </Dropdown>
                        ) : null}
                        <Button className="!h-9 !px-3.5" disabled={!hydrated} icon={<FileUp className="size-3.5" />} onClick={() => inputRef.current?.click()}>导入</Button>
                        </>
                    )}
                />

                <section className="canvas-library-discovery" aria-label="画布浏览工具">
                    <div className="canvas-library-search">
                        <Search aria-hidden="true" />
                        <input value={keyword} placeholder="搜索画布" aria-label="搜索画布" onChange={(event) => { setKeyword(event.target.value); setPage(1); }} />
                        {keyword ? <button type="button" aria-label="清除搜索" onClick={() => { setKeyword(""); setPage(1); }}><X /></button> : null}
                    </div>
                    <div className="canvas-library-filters">
                        <Dropdown trigger={["click"]} placement="bottomLeft" menu={{ items: projectFilterItems, selectedKeys: [projectFilter], onClick: ({ key }) => { setProjectFilter(String(key)); setPage(1); } }}>
                            <button type="button" className={`canvas-library-filter${projectFilter !== "all" ? " is-active" : ""}`} aria-label="按所属项目筛选"><SlidersHorizontal /><span>{projectFilterLabel}</span></button>
                        </Dropdown>
                        <Dropdown trigger={["click"]} placement="bottomLeft" menu={{ items: sortItems, selectedKeys: [sort], onClick: ({ key }) => { setSort(key as typeof sort); setPage(1); } }}>
                            <button type="button" className={`canvas-library-filter${sort !== "updated" ? " is-active" : ""}`} aria-label="画布排序">{sort === "updated" ? <Clock3 /> : sort === "name" ? <ArrowDownAZ /> : <ListFilter />}<span>{sortLabel}</span></button>
                        </Dropdown>
                        {keyword || projectFilter !== "all" || sort !== "updated" ? <button type="button" className="canvas-library-reset" onClick={() => { setKeyword(""); setProjectFilter("all"); setSort("updated"); setPage(1); }}>重置</button> : null}
                    </div>
                    <span className="canvas-library-count"><strong>{String(filteredProjects.length).padStart(2, "0")}</strong><span>/ {String(projects.length).padStart(2, "0")} 画布</span></span>
                </section>

                {selectedIds.length ? (
                    <div className="app-canvas-selection-toolbar mt-2 flex min-h-10 flex-wrap items-center gap-2 rounded-md border px-3 py-1.5 text-xs">
                        <strong className="mr-auto font-medium">已选 {selectedIds.length} 个画布</strong>
                        <Button size="small" disabled={!hydrated || projectQuery.isLoading} onClick={() => { setAssociationProjectId(selectedProjects[0]?.projectId || ""); setAssociationOpen(true); }}>加入项目</Button>
                        {selectedProjects.some((project) => project.projectId) ? <Button size="small" disabled={!hydrated} onClick={() => { setAssociationProjectId(""); void associateSelected(""); }}>移出项目</Button> : null}
                        <Button size="small" disabled={!hydrated} icon={<Download className="size-3.5" />} onClick={() => void exportCanvasProjects(selectedProjects, `影策画布-${selectedIds.length}个画布`)}>导出</Button>
                        <Button size="small" danger disabled={!hydrated} onClick={() => setDeleteIds(selectedIds)}>删除</Button>
                    </div>
                ) : null}

                {!hydrated ? (
                    <WorkspaceLoadingState label="正在恢复画布" detail="读取本地缓存与账号同步状态" />
                ) : showCreateCard || visibleProjects.length ? (
                    <CollectionGrid className="canvas-library-grid">
                        {showCreateCard ? <CanvasCreateCard disabled={!hydrated} onClick={createAndEnter} /> : null}
                        {visibleProjects.map((project) => (
                            <CanvasProjectCard key={project.id} project={project} projectName={project.projectId ? projectNames.get(project.projectId) || "未同步项目" : undefined} />
                        ))}
                    </CollectionGrid>
                ) : (
                    <WorkspaceState icon="canvas" title="没有匹配的画布" description="换一个画布名称或重置筛选条件。" />
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
