import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { App, Button, Dropdown, Modal, Select } from "antd";
import { ArrowDownAZ, Clock3, Download, FileUp, ListFilter, MoreHorizontal, Plus, Search, SlidersHorizontal, Trash2, X } from "lucide-react";

import { CollectionGrid, PageHeader, WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceLoadingState, WorkspaceState } from "@/components/layout/workspace-state";

import { readZip } from "@/lib/zip";
import { setMediaBlob } from "@/services/file-storage";
import { setImageBlob } from "@/services/image-storage";
import { CanvasCreateCard } from "@/components/canvas/canvas-project-card";
import { CanvasFolderCard } from "@/components/canvas/canvas-folder-card";
import type { CanvasExportFile } from "@/types/canvas-export";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { saveCanvasDrawing, type CanvasDrawingRenderDraft } from "@/lib/canvas/canvas-drawing-storage";
import { createCanvasProjectWithRemoteSync, saveRemoteUserDataNow } from "@/services/user-data-sync";
import { listProjects } from "@/services/api/projects";
import { useTranslation } from "react-i18next";

export default function CanvasPage() {
    const { t } = useTranslation("canvas");
    const { message } = App.useApp();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const inputRef = useRef<HTMLInputElement>(null);
    const autoOpenRef = useRef(false);
    const [keyword, setKeyword] = useState("");
    const [sort, setSort] = useState<"updated" | "name" | "nodes">("updated");
    const [projectFilter, setProjectFilter] = useState("all");
    const loadMoreRef = useRef<HTMLDivElement>(null);
    const [loadedProjectCount, setLoadedProjectCount] = useState(50);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const importProject = useCanvasStore((state) => state.importProject);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const updateProject = useCanvasStore((state) => state.updateProject);
    const [associationOpen, setAssociationOpen] = useState(false);
    const [associationProjectId, setAssociationProjectId] = useState("");
    const projectQuery = useQuery({ queryKey: ["projects"], queryFn: () => listProjects() });

    const mode = searchParams.get("mode");
    const agentMode = mode === "new" || mode === "recent" || mode === "choose";
    const handoffMode = mode === "handoff";
    const forwardedQuery = agentMode || handoffMode ? `?${searchParams.toString()}` : "";
    const enterProject = (id: string) => {
        navigate(`/canvas/${id}${forwardedQuery}`);
    };
    const createAndEnter = () => {
        void createCanvasProjectWithRemoteSync(t("canvas:standalone-canvas-n", { n: projects.length + 1 })).then(({ id, syncError }) => {
            if (syncError) message.warning(syncError instanceof Error ? t("canvas:canvas-created-locally-cloud-sync-failed-param", { message: syncError.message }) : t("canvas:canvas-created-locally-cloud-sync-failed"));
            enterProject(id);
        });
    };
    const filteredProjects = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        const scoped = projects.filter((project) => projectFilter === "all" || (projectFilter === "independent" ? !project.projectId : project.projectId === projectFilter));
        const values = query ? scoped.filter((project) => project.title.toLowerCase().includes(query)) : [...scoped];
        values.sort((a, b) => (sort === "name" ? a.title.localeCompare(b.title, "zh-CN") : sort === "nodes" ? b.nodes.length - a.nodes.length : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
        return values;
    }, [keyword, projectFilter, projects, sort]);
    const projectNames = useMemo(() => new Map((projectQuery.data?.projects || []).map(({ project }) => [project.id, project.name])), [projectQuery.data]);
    const visibleProjects = filteredProjects.slice(0, loadedProjectCount);
    const showCreateCard = !keyword.trim() && projectFilter === "all";
    const selectedProjects = projects.filter((project) => selectedIds.includes(project.id));
    const projectFilterLabel = projectFilter === "all" ? t("canvas:all-canvases") : projectFilter === "independent" ? t("canvas:standalone-canvases") : projectNames.get(projectFilter) || t("canvas:project-canvases");
    const sortLabel = sort === "name" ? t("canvas:by-name") : sort === "nodes" ? t("canvas:by-node") : t("canvas:recently-updated");
    const projectFilterItems = useMemo(
        () => [{ key: "all", label: t("canvas:all-canvases") }, { key: "independent", label: t("canvas:standalone-canvases") }, ...(projectQuery.data?.projects || []).map(({ project }) => ({ key: project.id, label: project.name }))],
        [projectQuery.data],
    );
    const sortItems = [
        { key: "updated", label: t("canvas:recently-updated"), icon: <Clock3 className="size-3.5" /> },
        { key: "name", label: t("canvas:by-name"), icon: <ArrowDownAZ className="size-3.5" /> },
        { key: "nodes", label: t("canvas:by-node-count"), icon: <ListFilter className="size-3.5" /> },
    ];
    useEffect(() => {
        setLoadedProjectCount(50);
    }, [keyword, projectFilter, sort]);
    useEffect(() => {
        const node = loadMoreRef.current;
        if (!node || visibleProjects.length >= filteredProjects.length) return;
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry?.isIntersecting) setLoadedProjectCount((count) => Math.min(count + 50, filteredProjects.length));
            },
            { rootMargin: "600px" },
        );
        observer.observe(node);
        return () => observer.disconnect();
    }, [filteredProjects.length, visibleProjects.length]);
    const associateSelected = async (nextProjectId = associationProjectId) => {
        const projectId = nextProjectId || undefined;
        selectedIds.forEach((id) => updateProject(id, { projectId }));
        try {
            await saveRemoteUserDataNow();
            message.success(projectId ? t("canvas:added-to-project") : t("canvas:removed-from-project-canvas-is-kept"));
            setAssociationOpen(false);
        } catch (error) {
            message.error(error instanceof Error ? t("canvas:failed-to-save-canvas-link-param", { message: error.message }) : t("canvas:failed-to-save-canvas-link"));
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
            await Promise.all(
                data.projects.map(async (item) => {
                    const drawingEngineById = new Map((item.drawingDocuments || []).map((document) => [document.drawingId, document.engine || "tldraw"]));
                    const importedProjectId = importProject({
                        ...item.project,
                        nodes: item.project.nodes.map((node) =>
                            node.type === "drawing" && node.metadata?.drawingId ? { ...node, metadata: { ...node.metadata, drawingEngine: drawingEngineById.get(node.metadata.drawingId) || node.metadata.drawingEngine || "tldraw" } } : node,
                        ),
                    });
                    await Promise.all(
                        (item.drawingDocuments || []).map((document) => {
                            const previewFile = document.previewPath ? zip.get(document.previewPath) : undefined;
                            const preview = previewFile && !previewFile.type ? previewFile.slice(0, previewFile.size, "image/png") : previewFile;
                            const renderFile = document.generationRender?.path ? zip.get(document.generationRender.path) : undefined;
                            const renderBlob = renderFile && !renderFile.type ? renderFile.slice(0, renderFile.size, document.generationRender?.mimeType || "image/png") : renderFile;
                            const render =
                                renderBlob && document.generationRender
                                    ? ({
                                          blob: renderBlob,
                                          pageId: document.generationRender.pageId,
                                          width: document.generationRender.width,
                                          height: document.generationRender.height,
                                          mimeType: document.generationRender.mimeType,
                                          background: document.generationRender.background,
                                      } satisfies CanvasDrawingRenderDraft)
                                    : undefined;
                            const engine = document.engine || "tldraw";
                            return saveCanvasDrawing(
                                importedProjectId,
                                document.drawingId,
                                engine,
                                document.snapshot,
                                {
                                    version: 2,
                                    engine,
                                    snapshot: document.snapshot,
                                    revision: Math.max(0, document.revision - 1),
                                    updatedAt: document.updatedAt,
                                    shapeCount: document.shapeCount,
                                    pageCount: document.pageCount,
                                },
                                preview,
                                render,
                            );
                        }),
                    );
                }),
            );
            message.success(t("canvas:imported-param-canvases", { length: data.projects.length }));
        } catch {
            message.error(t("canvas:import-failed-choose-a-valid-canvas-archive"));
        } finally {
            if (inputRef.current) inputRef.current.value = "";
        }
    };

    useEffect(() => {
        if (!hydrated || autoOpenRef.current || (mode !== "new" && mode !== "recent" && mode !== "handoff")) return;
        autoOpenRef.current = true;
        if (mode === "recent" && projects[0]?.id) {
            enterProject(projects[0].id);
            return;
        }
        void createCanvasProjectWithRemoteSync(t("canvas:standalone-canvas-n", { n: projects.length + 1 })).then(({ id, syncError }) => {
            if (syncError) message.warning(syncError instanceof Error ? t("canvas:canvas-created-locally-cloud-sync-failed-param", { message: syncError.message }) : t("canvas:canvas-created-locally-cloud-sync-failed"));
            enterProject(id);
        });
    }, [hydrated, message, mode, projects]);

    if (hydrated && (mode === "new" || mode === "recent" || mode === "handoff")) return <main className="flex h-full items-center justify-center bg-background text-sm text-stone-500">{t("canvas:opening-canvas")}</main>;

    return (
        <WorkspacePage grid className="canvas-library-page">
            <div className="studio-band">
                <PageHeader
                    title={t("canvas:canvas-3")}
                    description={t("canvas:keep-shots-assets-and-ideas-on-one-canvas")}
                    meta={
                        <span className="app-projects-header-meta">
                            {projects.length} {t("canvas:total")}
                        </span>
                    }
                    actions={
                        <div className="canvas-library-header-actions">
                            <Button className="canvas-library-header-action is-primary library-primary-action" type="primary" disabled={!hydrated} icon={<Plus className="size-3.5" />} onClick={createAndEnter}>
                                {t("canvas:new-canvas-2")}
                            </Button>
                            {projects.length ? (
                                <Dropdown
                                    menu={{
                                        classNames: { root: "canvas-library-actions-menu", item: "canvas-library-actions-menu-item" },
                                        items: [{ key: "delete-all", danger: true, icon: <Trash2 className="size-3.5" />, label: t("canvas:delete-all-canvases"), onClick: () => setDeleteIds(projects.map((project) => project.id)) }],
                                    }}
                                    openClassName="is-open"
                                    placement="bottomRight"
                                    trigger={["click"]}
                                >
                                    <Button className="canvas-library-header-action is-icon" aria-label={t("canvas:more-canvas-actions")} title={t("canvas:more-actions")} icon={<MoreHorizontal className="size-4" />} />
                                </Dropdown>
                            ) : null}
                            <Button className="canvas-library-header-action" disabled={!hydrated} icon={<FileUp className="size-3.5" />} onClick={() => inputRef.current?.click()}>
                                {t("canvas:import")}
                            </Button>
                        </div>
                    }
                />

                <section className="canvas-library-discovery" aria-label={t("canvas:canvas-browser-tools")}>
                    <div className="canvas-library-search">
                        <Search aria-hidden="true" />
                        <input
                            value={keyword}
                            placeholder={t("canvas:search-canvases")}
                            aria-label={t("canvas:search-canvases")}
                            onChange={(event) => {
                                setKeyword(event.target.value);
                            }}
                        />
                        {keyword ? (
                            <button
                                type="button"
                                aria-label={t("canvas:clear-search")}
                                onClick={() => {
                                    setKeyword("");
                                }}
                            >
                                <X />
                            </button>
                        ) : null}
                    </div>
                    <div className="canvas-library-filters">
                        <Dropdown
                            trigger={["click"]}
                            placement="bottomLeft"
                            menu={{
                                items: projectFilterItems,
                                selectedKeys: [projectFilter],
                                onClick: ({ key }) => {
                                    setProjectFilter(String(key));
                                },
                            }}
                        >
                            <button type="button" className={`canvas-library-filter${projectFilter !== "all" ? " is-active" : ""}`} aria-label={t("canvas:filter-by-project")}>
                                <SlidersHorizontal />
                                <span>{projectFilterLabel}</span>
                            </button>
                        </Dropdown>
                        <Dropdown
                            trigger={["click"]}
                            placement="bottomLeft"
                            menu={{
                                items: sortItems,
                                selectedKeys: [sort],
                                onClick: ({ key }) => {
                                    setSort(key as typeof sort);
                                },
                            }}
                        >
                            <button type="button" className={`canvas-library-filter${sort !== "updated" ? " is-active" : ""}`} aria-label={t("canvas:sort-canvases")}>
                                {sort === "updated" ? <Clock3 /> : sort === "name" ? <ArrowDownAZ /> : <ListFilter />}
                                <span>{sortLabel}</span>
                            </button>
                        </Dropdown>
                        {keyword || projectFilter !== "all" || sort !== "updated" ? (
                            <button
                                type="button"
                                className="canvas-library-reset"
                                onClick={() => {
                                    setKeyword("");
                                    setProjectFilter("all");
                                    setSort("updated");
                                }}
                            >
                                {t("canvas:reset")}
                            </button>
                        ) : null}
                    </div>
                    <span className="canvas-library-count">
                        <strong>{String(filteredProjects.length).padStart(2, "0")}</strong>
                        <span>
                            / {String(projects.length).padStart(2, "0")} {t("canvas:canvas-3")}
                        </span>
                    </span>
                </section>
            </div>

            <div className="canvas-library-frame">
                {selectedIds.length ? (
                    <div className="app-canvas-selection-toolbar mt-2 flex min-h-10 flex-wrap items-center gap-2 rounded-md border px-3 py-1.5 text-xs">
                        <strong className="mr-auto font-medium">
                            {t("canvas:selected")} {selectedIds.length} {t("canvas:canvases")}
                        </strong>
                        <Button
                            size="small"
                            disabled={!hydrated || projectQuery.isLoading}
                            onClick={() => {
                                setAssociationProjectId(selectedProjects[0]?.projectId || "");
                                setAssociationOpen(true);
                            }}
                        >
                            {t("canvas:add-to-project-2")}
                        </Button>
                        {selectedProjects.some((project) => project.projectId) ? (
                            <Button
                                size="small"
                                disabled={!hydrated}
                                onClick={() => {
                                    setAssociationProjectId("");
                                    void associateSelected("");
                                }}
                            >
                                {t("canvas:remove-from-project")}
                            </Button>
                        ) : null}
                        <Button size="small" disabled={!hydrated} icon={<Download className="size-3.5" />} onClick={() => void exportCanvasProjects(selectedProjects, t("canvas:yingce-canvases-param", { length: selectedIds.length }))}>
                            {t("canvas:export")}
                        </Button>
                        <Button size="small" danger disabled={!hydrated} onClick={() => setDeleteIds(selectedIds)}>
                            {t("canvas:delete")}
                        </Button>
                    </div>
                ) : null}

                {!hydrated ? (
                    <WorkspaceLoadingState label={t("canvas:restoring-canvases")} detail={t("canvas:loading-local-cache-and-account-sync-state")} />
                ) : showCreateCard || visibleProjects.length ? (
                    <CollectionGrid className="canvas-library-grid">
                        {showCreateCard ? <CanvasCreateCard disabled={!hydrated} onClick={createAndEnter} /> : null}
                        {visibleProjects.map((project) => (
                            <CanvasFolderCard key={project.id} project={project} projectName={project.projectId ? projectNames.get(project.projectId) || t("canvas:unsynced-project") : undefined} onClick={() => enterProject(project.id)} />
                        ))}
                    </CollectionGrid>
                ) : (
                    <WorkspaceState icon="canvas" title={t("canvas:no-matching-canvases")} description={t("canvas:try-a-different-name-or-reset-the-filters")} />
                )}
                {hydrated && visibleProjects.length ? (
                    <div ref={loadMoreRef} className="library-load-more" aria-live="polite">
                        {visibleProjects.length < filteredProjects.length ? t("canvas:scroll-for-more-per-page") : t("canvas:all-param-canvases-loaded", { length: filteredProjects.length })}
                    </div>
                ) : null}
            </div>

            <input ref={inputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importCanvas(event.target.files?.[0])} />
            <Modal
                title={t("canvas:add-to-project-2")}
                open={associationOpen}
                okText={t("canvas:save-links")}
                cancelText={t("canvas:cancel-2")}
                okButtonProps={{ disabled: !associationProjectId, loading: projectQuery.isFetching }}
                onCancel={() => setAssociationOpen(false)}
                onOk={() => void associateSelected()}
            >
                <p className="mb-3 text-sm text-foreground/60">{t("canvas:selected-canvases-keep-their-nodes-and-local-media-only-the-project-link")}</p>
                <Select
                    className="w-full"
                    value={associationProjectId || undefined}
                    placeholder={t("canvas:select-project")}
                    options={(projectQuery.data?.projects || []).map((item) => ({ label: item.project.name, value: item.project.id }))}
                    onChange={setAssociationProjectId}
                />
            </Modal>
        </WorkspacePage>
    );
}
