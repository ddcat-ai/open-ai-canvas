import { migrateCanvasNodeModel } from "@/lib/canvas/migrate-canvas-node-model";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { App, Button, Dropdown, Input, Modal } from "antd";
import { Select } from "@/components/ui/base/select";
import { ArrowDownAZ, Clock3, Download, FileUp, History, ListFilter, LoaderCircle, Plus, Search, SlidersHorizontal } from "lucide-react";

import { CollectionGrid, PageHeader, WorkspacePage } from "@/components/layout/workspace-page";
import { CollectionToolbar } from "@/components/layout/collection-toolbar";
import { WorkspaceErrorState, WorkspaceLoadingState, WorkspaceNoResultsState, WorkspaceState } from "@/components/layout/workspace-state";

import { readZip } from "@/lib/zip";
import { setMediaBlob } from "@/services/file-storage";
import { setImageBlob } from "@/services/image-storage";
import { CanvasFolderCard } from "@/components/canvas/canvas-folder-card";
import { CanvasHistoryDrawer } from "@/components/canvas/canvas-history-drawer";
import type { CanvasExportFile } from "@/types/canvas-export";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { canvasDraftNavigationState, flushCanvasStorePersistence, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { resetGenerationTaskMetadata } from "@/lib/canvas/canvas-task-state";
import { saveCanvasDrawing, type CanvasDrawingRenderDraft } from "@/lib/canvas/canvas-drawing-storage";
import { hasRemoteUserDataSyncSession, loadCanvasProjectForEditing, saveRemoteUserDataNow, scheduleRemoteUserDataSync } from "@/services/user-data-sync";
import { listRemoteCanvasProjectsPage, type CanvasLibrarySummary } from "@/services/api/user-data";
import { useUserStore } from "@/stores/use-user-store";
import { listProjects } from "@/services/api/projects";
import { loadCanvasProjectPage } from "@/lib/workspace-route-modules";
import { resourceFileUrl, resourceStorageKey, uploadResourceFile } from "@/services/api/resources";
import { primeResourceBlobCache } from "@/services/resource-blob-cache";
import { useSyncProgressStore } from "@/stores/use-sync-progress-store";
import { ensureCanvasNodeAsset } from "@/services/project-asset-sync";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { trackSiteTrafficAction } from "@/services/site-traffic";

const CanvasDeleteProjectsDialog = lazy(() => import("@/components/canvas/canvas-delete-projects-dialog").then((module) => ({ default: module.CanvasDeleteProjectsDialog })));

export default function CanvasPage() {
    const { message } = App.useApp();
    const brandName = useAppearanceStore((state) => state.appearance.brandName);
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const inputRef = useRef<HTMLInputElement>(null);
    const autoOpenRef = useRef(false);
    const [keyword, setKeyword] = useState("");
    const [sort, setSort] = useState<"updated" | "name" | "nodes">("updated");
    const [projectFilter, setProjectFilter] = useState("all");
    const loadMoreRef = useRef<HTMLDivElement>(null);
    const [loadedProjectCount, setLoadedProjectCount] = useState(50);
    const [openingProjectId, setOpeningProjectId] = useState("");
    const openingProjectIdRef = useRef("");
    const hydrated = useCanvasStore((state) => state.hydrated);
    const localProjects = useCanvasStore((state) => state.projects);
    const userId = useUserStore((state) => state.user?.id);
    const sessionHydrated = useUserStore((state) => state.hydrated);
    const [debouncedKeyword, setDebouncedKeyword] = useState("");
    useEffect(() => {
        const timer = window.setTimeout(() => setDebouncedKeyword(keyword.trim()), 250);
        return () => window.clearTimeout(timer);
    }, [keyword]);
    const libraryQuery = useInfiniteQuery({
        queryKey: ["canvas-library", userId, projectFilter, sort, debouncedKeyword],
        queryFn: ({ pageParam, signal }) => listRemoteCanvasProjectsPage({ page: pageParam, pageSize: 40, projectId: projectFilter, sort, query: debouncedKeyword, signal }),
        initialPageParam: 1,
        getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
        placeholderData: keepPreviousData,
        enabled: Boolean(userId) && sessionHydrated,
    });
    const projects = useMemo<CanvasLibrarySummary[]>(
        () =>
            userId
                ? libraryQuery.data?.pages.flatMap((page) => page.projects) || []
                : localProjects.map((project) => ({ ...project, nodeCount: project.nodes.length, previewNodes: project.nodes.filter((node) => node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video).slice(0, 4) })),
        [libraryQuery.data, localProjects, userId],
    );
    const totalProjects = userId ? libraryQuery.data?.pages[0]?.total || 0 : projects.length;
    const importProject = useCanvasStore((state) => state.importProject);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const deleteDialogOpen = useCanvasUiStore((state) => state.deleteProjectIds.length > 0);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const updateProject = useCanvasStore((state) => state.updateProject);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [associationOpen, setAssociationOpen] = useState(false);
    const [associationProjectId, setAssociationProjectId] = useState("");
    const projectQuery = useQuery({ queryKey: ["projects"], queryFn: () => listProjects() });

    const mode = searchParams.get("mode");
    const agentMode = mode === "new" || mode === "recent" || mode === "choose";
    const handoffMode = mode === "handoff";
    const forwardedQuery = agentMode || handoffMode || searchParams.get("agent") === "1" ? `?${searchParams.toString()}` : "";
    const preloadProject = useCallback(() => {
        void loadCanvasProjectPage();
    }, []);
    const enterProject = useCallback(
        (id: string) => {
            if (openingProjectIdRef.current) return;
            openingProjectIdRef.current = id;
            setOpeningProjectId(id);
            preloadProject();
            window.requestAnimationFrame(() => navigate(`/canvas/${id}${forwardedQuery}`, { state: canvasDraftNavigationState(id) }));
        },
        [forwardedQuery, navigate, preloadProject],
    );
    const createAndEnter = () => {
        trackSiteTrafficAction("new_canvas");
        const id = useCanvasStore.getState().createDraftProject(`自由画布 ${projects.length + 1}`);
        enterProject(id);
    };
    const filteredProjects = useMemo(() => {
        if (userId) return projects;
        const query = keyword.trim().toLowerCase();
        const scoped = projects.filter((project) => projectFilter === "all" || (projectFilter === "independent" ? !project.projectId : project.projectId === projectFilter));
        const values = query ? scoped.filter((project) => project.title.toLowerCase().includes(query)) : [...scoped];
        values.sort((a, b) => (sort === "name" ? a.title.localeCompare(b.title, "zh-CN") : sort === "nodes" ? b.nodeCount - a.nodeCount : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
        return values;
    }, [keyword, projectFilter, projects, sort, userId]);
    const projectNames = useMemo(() => new Map((projectQuery.data?.projects || []).map(({ project }) => [project.id, project.name])), [projectQuery.data]);
    const visibleProjects = userId ? filteredProjects : filteredProjects.slice(0, loadedProjectCount);
    const hasRenderableProjects = visibleProjects.length > 0;
    const hasMore = userId ? libraryQuery.hasNextPage : visibleProjects.length < filteredProjects.length;
    const selectedProjects = projects.filter((project) => selectedIds.includes(project.id));
    const projectFilterLabel = projectFilter === "all" ? "全部画布" : projectFilter === "independent" ? "自由画布" : projectNames.get(projectFilter) || "项目画布";
    const sortLabel = sort === "name" ? "按名称" : sort === "nodes" ? "按节点" : "最近更新";
    const projectFilterItems = useMemo(() => [{ key: "all", label: "全部画布" }, { key: "independent", label: "自由画布" }, ...(projectQuery.data?.projects || []).map(({ project }) => ({ key: project.id, label: project.name }))], [projectQuery.data]);
    const sortItems = [
        { key: "updated", label: "最近更新", icon: <Clock3 className="size-3.5" /> },
        { key: "name", label: "按名称", icon: <ArrowDownAZ className="size-3.5" /> },
        { key: "nodes", label: "按节点数量", icon: <ListFilter className="size-3.5" /> },
    ];
    useEffect(() => {
        setLoadedProjectCount(50);
    }, [keyword, projectFilter, sort]);
    useEffect(() => {
        const node = loadMoreRef.current;
        if (!node || !hasMore) return;
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (!entry?.isIntersecting) return;
                if (userId) {
                    if (!libraryQuery.isFetchingNextPage && !libraryQuery.isFetchNextPageError) void libraryQuery.fetchNextPage();
                } else setLoadedProjectCount((count) => Math.min(count + 50, filteredProjects.length));
            },
            { rootMargin: "600px" },
        );
        observer.observe(node);
        return () => observer.disconnect();
    }, [filteredProjects.length, visibleProjects.length, hasMore, userId, libraryQuery.fetchNextPage, libraryQuery.isFetchingNextPage, libraryQuery.isFetchNextPageError]);
    const associateSelected = async (nextProjectId = associationProjectId) => {
        const projectId = nextProjectId || undefined;
        try {
            for (const id of selectedIds) await loadCanvasProjectForEditing(id);
            selectedIds.forEach((id) => updateProject(id, { projectId }));
            await saveRemoteUserDataNow(selectedIds);
            message.success(projectId ? "已加入项目" : "已移出项目，画布仍保留");
            setAssociationOpen(false);
        } catch (error) {
            message.error(error instanceof Error ? `画布关系保存失败：${error.message}` : "画布关系保存失败");
        }
    };
    const exportSelected = async () => {
        try {
            const selected = [];
            for (const id of selectedIds) {
                const project = await loadCanvasProjectForEditing(id);
                if (!project) throw new Error("画布不存在，无法导出");
                selected.push(project);
            }
            await exportCanvasProjects(selected, `${brandName}画布-${selected.length}个画布`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "导出失败");
        }
    };
    const importCanvas = async (file?: File) => {
        if (!file) return;
        const hideLoading = message.loading({ content: "正在解压并准备导入画布...", duration: 0 });
        try {
            const zip = await readZip(file);
            const projectFile = zip.get("projects.json");
            if (!projectFile) throw new Error("缺少 projects.json 元数据文件");
            const data = JSON.parse(await projectFile.text()) as CanvasExportFile;
            if (!Array.isArray(data.projects)) throw new Error("projects.json 中缺少画布列表");
            for (const item of data.projects) {
                item.project = migrateCanvasNodeModel(item.project);
                if (!Array.isArray(item.files)) throw new Error(`画布「${item.project?.title || "未命名画布"}」的媒体清单无效`);
                const missing = item.files.find((entry) => !zip.get(entry.path));
                if (missing) throw new Error(`压缩包缺少媒体文件：${missing.path}`);
            }
            const remoteSyncEnabled = hasRemoteUserDataSyncSession();
            // 源画布所属项目可能属于其他账号或已被删除，项目素材关联会直接拒绝；不属于当前账号时按自由画布导入。
            const ownedProjectIds = remoteSyncEnabled && data.projects.some((item) => item.project?.projectId) ? new Set((await listProjects()).projects.map(({ project }) => project.id)) : new Set<string>();
            hideLoading();
            let remoteSyncWarning: unknown;

            for (const item of data.projects) {
                const totalFiles = item.files.length;
                const domainProjectId = item.project.projectId && ownedProjectIds.has(item.project.projectId) ? item.project.projectId : undefined;
                const importedProjectId = importProject({
                    ...item.project,
                    projectId: domainProjectId,
                    title: item.project.title || "导入画布",
                    nodes: item.project.nodes || [],
                });

                if (totalFiles > 0) {
                    useSyncProgressStore.getState().setProjectProgress(importedProjectId, {
                        projectId: importedProjectId,
                        total: totalFiles,
                        completed: 0,
                        phase: "uploading",
                        message: "正在上传媒体至云端",
                    });
                }

                try {
                    const storageKeyMap = new Map<string, { storageKey: string; url: string }>();
                    const concurrency = 4;
                    let fileIndex = 0;
                    const workers = new Array(Math.min(item.files.length, concurrency)).fill(null).map(async () => {
                        while (fileIndex < item.files.length) {
                            const current = fileIndex++;
                            const fileItem = item.files[current];
                            const blob = zip.get(fileItem.path)!;
                            const mime = fileItem.mimeType || blob.type || "image/png";
                            const typedBlob = blob.type ? blob : blob.slice(0, blob.size, mime);
                            const kind: "image" | "video" | "audio" | "file" = mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : "file";

                            try {
                                const resource = await uploadResourceFile(typedBlob, kind, { fileName: fileItem.path.split("/").pop() });
                                const newStorageKey = resourceStorageKey(resource.id);
                                const newUrl = resourceFileUrl(resource.id);
                                await primeResourceBlobCache(newStorageKey, typedBlob).catch(() => "");
                                storageKeyMap.set(fileItem.storageKey, { storageKey: newStorageKey, url: newUrl });
                            } catch (uploadErr) {
                                console.warn("上传资源到后端失败，降级保存本地", uploadErr);
                                const localUrl = await (fileItem.storageKey.startsWith("image:") ? setImageBlob(fileItem.storageKey, typedBlob) : setMediaBlob(fileItem.storageKey, typedBlob));
                                if (localUrl) {
                                    storageKeyMap.set(fileItem.storageKey, { storageKey: fileItem.storageKey, url: localUrl });
                                }
                            } finally {
                                useSyncProgressStore.getState().incrementProjectCompleted(importedProjectId);
                            }
                        }
                    });
                    await Promise.all(workers);

                    const drawingEngineById = new Map((item.drawingDocuments || []).map((document) => [document.drawingId, document.engine || "tldraw"]));
                    const remapNodeMedia = (node: CanvasNodeData): CanvasNodeData => {
                        const oldKey = node.metadata?.storageKey;
                        const mapped = oldKey ? storageKeyMap.get(oldKey) : undefined;
                        const isDeadBlob = (val?: string) => typeof val === "string" && val.startsWith("blob:");
                        const nextStorageKey = mapped ? mapped.storageKey : oldKey && !isDeadBlob(oldKey) ? oldKey : undefined;
                        const content = mapped ? mapped.url : isDeadBlob(node.metadata?.content) ? "" : node.metadata?.content;
                        const previewContent = mapped ? mapped.url : isDeadBlob(node.metadata?.previewContent) ? "" : node.metadata?.previewContent;
                        const isMedia = node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio;
                        // 包内媒体已重新写入当前账号，节点是导入副本：与复制节点一致，不继承源画布的任务绑定和素材 ID。
                        // 否则素材登记会把它当作未加载的受管生成结果拒绝，或去读取当前账号无权访问的旧素材，整次导入失败。
                        let baseMetadata = node.metadata;
                        if (mapped && isMedia) {
                            baseMetadata = resetGenerationTaskMetadata(node.metadata, "success");
                            delete baseMetadata.assetId;
                        }
                        return {
                            ...node,
                            metadata: {
                                ...baseMetadata,
                                ...(nextStorageKey !== undefined ? { storageKey: nextStorageKey } : {}),
                                ...(content !== undefined ? { content } : {}),
                                ...(previewContent !== undefined ? { previewContent } : {}),
                                drawingEngine: node.type === "drawing" && node.metadata?.drawingId ? drawingEngineById.get(node.metadata.drawingId) || node.metadata.drawingEngine || "tldraw" : node.metadata?.drawingEngine,
                            },
                        };
                    };

                    let remappedNodes = (item.project.nodes || []).map(remapNodeMedia);
                    let remappedTimeline = item.project.timeline
                        ? {
                              ...item.project.timeline,
                              clips: item.project.timeline.clips.map((clip) => {
                                  const directMedia = clip.directMedia;
                                  if (!directMedia?.storageKey) return clip;
                                  const mapped = storageKeyMap.get(directMedia.storageKey);
                                  return mapped
                                      ? {
                                            ...clip,
                                            // 旧素材不引用新资源，保留会被后端判为素材与资源不匹配；清空后由下方重新登记。
                                            directMedia: {
                                                ...directMedia,
                                                assetId: undefined,
                                                storageKey: mapped.storageKey,
                                                url: mapped.url,
                                                dataUrl: directMedia.dataUrl ? mapped.url : directMedia.dataUrl,
                                                content: directMedia.content ? mapped.url : directMedia.content,
                                            },
                                        }
                                      : clip;
                              }),
                          }
                        : undefined;
                    updateProject(importedProjectId, { nodes: remappedNodes, timeline: remappedTimeline });

                    const assetIdByStorageKey = new Map<string, string>();
                    for (let index = 0; index < remappedNodes.length; index += 1) {
                        const node = remappedNodes[index];
                        const isMedia = node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio;
                        if (!isMedia || !node.metadata?.content) continue;
                        const storageKey = node.metadata.storageKey || "";
                        let assetId = storageKey ? assetIdByStorageKey.get(storageKey) : undefined;
                        if (!assetId) {
                            const result = await ensureCanvasNodeAsset({ canvasId: importedProjectId, domainProjectId, node, source: "canvas-upload" });
                            assetId = result.assetId;
                            if (storageKey) assetIdByStorageKey.set(storageKey, assetId);
                        }
                        remappedNodes[index] = { ...node, metadata: { ...node.metadata, assetId } };
                    }
                    if (remappedTimeline) {
                        const clips: typeof remappedTimeline.clips = [];
                        for (const clip of remappedTimeline.clips) {
                            const media = clip.directMedia;
                            const content = media?.url || media?.dataUrl || media?.content || "";
                            if (!media || media.assetId || !media.storageKey || !content || media.kind === "text") {
                                clips.push(clip);
                                continue;
                            }
                            let assetId = assetIdByStorageKey.get(media.storageKey);
                            if (!assetId) {
                                const type = media.kind === "audio" ? CanvasNodeType.Audio : media.kind === "video" ? CanvasNodeType.Video : CanvasNodeType.Image;
                                const node: CanvasNodeData = {
                                    id: media.id,
                                    type,
                                    title: media.title,
                                    position: { x: 0, y: 0 },
                                    width: media.width || 320,
                                    height: media.height || (type === CanvasNodeType.Audio ? 120 : 240),
                                    metadata: { content, storageKey: media.storageKey, naturalWidth: media.width, naturalHeight: media.height, durationMs: media.durationMs, bytes: media.bytes, mimeType: media.mimeType },
                                };
                                const result = await ensureCanvasNodeAsset({ canvasId: importedProjectId, domainProjectId, node, source: "canvas-upload" });
                                assetId = result.assetId;
                                assetIdByStorageKey.set(media.storageKey, assetId);
                            }
                            clips.push({ ...clip, directMedia: { ...media, assetId } });
                        }
                        remappedTimeline = { ...remappedTimeline, clips };
                    }
                    updateProject(importedProjectId, { nodes: remappedNodes, timeline: remappedTimeline });

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

                    useSyncProgressStore.getState().setProjectProgress(importedProjectId, {
                        phase: "saving",
                        message: remoteSyncEnabled ? "正在保存画布结构" : "正在保存本地画布",
                    });
                    await flushCanvasStorePersistence();
                    if (remoteSyncEnabled) {
                        try {
                            await saveRemoteUserDataNow(importedProjectId);
                        } catch (syncError) {
                            remoteSyncWarning ||= syncError;
                            scheduleRemoteUserDataSync();
                            console.warn("导入画布云端同步失败，等待自动重试", syncError);
                        }
                    }
                } catch (error) {
                    useSyncProgressStore.getState().setProjectProgress(importedProjectId, {
                        phase: "error",
                        message: error instanceof Error ? error.message : "画布导入未完成",
                    });
                    throw error;
                } finally {
                    if (!remoteSyncEnabled) useSyncProgressStore.getState().setProjectProgress(importedProjectId, null);
                }
            }

            await flushCanvasStorePersistence();
            if (remoteSyncWarning) {
                message.warning(`已导入 ${data.projects.length} 个画布，云端同步未完成，将自动重试`);
            } else {
                message.success(remoteSyncEnabled ? `已导入 ${data.projects.length} 个画布并完成云端同步` : `已导入 ${data.projects.length} 个画布并保存到本地`);
            }
        } catch (error) {
            hideLoading();
            console.error("导入画布失败", error);
            message.error(error instanceof Error ? `导入失败：${error.message}` : "导入失败，请选择有效的画布压缩包");
        } finally {
            if (inputRef.current) inputRef.current.value = "";
        }
    };

    useEffect(() => {
        if (!hydrated || !sessionHydrated || (userId && !libraryQuery.isSuccess) || autoOpenRef.current || (mode !== "new" && mode !== "recent" && mode !== "handoff")) return;
        autoOpenRef.current = true;
        if (mode === "recent" && projects[0]?.id) {
            enterProject(projects[0].id);
            return;
        }
        const id = useCanvasStore.getState().createDraftProject(`自由画布 ${projects.length + 1}`);
        enterProject(id);
    }, [hydrated, message, mode, projects, sessionHydrated, userId, libraryQuery.isSuccess]);

    if (hydrated && !libraryQuery.isError && (mode === "new" || mode === "recent" || mode === "handoff")) return <main className="flex h-full items-center justify-center bg-background text-sm text-stone-500">正在打开画布...</main>;

    return (
        <WorkspacePage className="studio-collection-page">
            <div className="studio-band">
                <PageHeader
                    title="我的画布"
                    description="把镜头、素材和想法留在同一张画布里。"
                    meta={<span className="app-projects-header-meta">{totalProjects} 个</span>}
                    actions={
                        <div className="collection-header-actions">
                            <Button type="primary" disabled={!hydrated} icon={<Plus />} onClick={createAndEnter}>
                                新建画布
                            </Button>
                            <Button disabled={!hydrated} icon={<FileUp />} onClick={() => inputRef.current?.click()}>
                                导入
                            </Button>
                        </div>
                    }
                />

                <CollectionToolbar
                    label="画布浏览工具"
                    active={Boolean(keyword || projectFilter !== "all" || sort !== "updated")}
                    onReset={() => {
                        setKeyword("");
                        setProjectFilter("all");
                        setSort("updated");
                    }}
                    trailing={
                        <Button type="text" icon={<History />} onClick={() => setHistoryOpen(true)}>
                            创作历史
                        </Button>
                    }
                >
                    <Input prefix={<Search />} value={keyword} allowClear placeholder="搜索画布" aria-label="搜索画布" onChange={(event) => setKeyword(event.target.value)} />
                    <Dropdown trigger={["click"]} placement="bottomLeft" menu={{ items: projectFilterItems, selectedKeys: [projectFilter], onClick: ({ key }) => setProjectFilter(String(key)) }}>
                        <Button icon={<SlidersHorizontal />} aria-label="按所属项目筛选">
                            {projectFilterLabel}
                        </Button>
                    </Dropdown>
                    <Dropdown trigger={["click"]} placement="bottomLeft" menu={{ items: sortItems, selectedKeys: [sort], onClick: ({ key }) => setSort(key as typeof sort) }}>
                        <Button icon={sort === "updated" ? <Clock3 /> : sort === "name" ? <ArrowDownAZ /> : <ListFilter />} aria-label="画布排序">
                            {sortLabel}
                        </Button>
                    </Dropdown>
                </CollectionToolbar>
            </div>

            <div className="collection-content">
                {selectedIds.length ? (
                    <div className="collection-selection-bar">
                        <strong className="mr-auto font-medium">已选 {selectedIds.length} 个画布</strong>
                        <Button
                            size="small"
                            disabled={!hydrated || projectQuery.isLoading}
                            onClick={() => {
                                setAssociationProjectId(selectedProjects[0]?.projectId || "");
                                setAssociationOpen(true);
                            }}
                        >
                            加入项目
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
                                移出项目
                            </Button>
                        ) : null}
                        <Button size="small" disabled={!hydrated} icon={<Download className="size-3.5" />} onClick={() => void exportSelected()}>
                            导出
                        </Button>
                        <Button size="small" danger disabled={!hydrated} onClick={() => setDeleteIds(selectedIds)}>
                            删除
                        </Button>
                    </div>
                ) : null}

                {userId && libraryQuery.isError && !hasRenderableProjects ? (
                    <WorkspaceErrorState compact title="画布列表读取失败" description={libraryQuery.error instanceof Error ? libraryQuery.error.message : "请检查网络后重试。"} actionLabel="重试" onRetry={() => void libraryQuery.refetch()} />
                ) : !hydrated || (userId && libraryQuery.isPending && !hasRenderableProjects) ? (
                    <WorkspaceLoadingState label="正在恢复画布" detail="读取本地缓存与账号同步状态" />
                ) : visibleProjects.length ? (
                    <>
                        <CollectionGrid className={`canvas-collection-grid${libraryQuery.isFetching && !libraryQuery.isPlaceholderData ? " is-stale" : ""}`}>
                            {visibleProjects.map((project) => (
                                <CanvasFolderCard
                                    key={project.id}
                                    project={project}
                                    projectName={project.projectId ? projectNames.get(project.projectId) || "未同步项目" : undefined}
                                    onClick={() => enterProject(project.id)}
                                    onPrefetch={preloadProject}
                                    opening={openingProjectId === project.id}
                                />
                            ))}
                        </CollectionGrid>
                        {libraryQuery.isError ? (
                            <p role="status" className="mt-3 text-center text-xs text-foreground/55">
                                {libraryQuery.error instanceof Error ? libraryQuery.error.message : "正在显示上次缓存的画布列表"}
                            </p>
                        ) : null}
                    </>
                ) : keyword || projectFilter !== "all" ? (
                    <WorkspaceNoResultsState
                        icon="canvas"
                        query={keyword}
                        onClear={() => {
                            setKeyword("");
                            setProjectFilter("all");
                        }}
                    />
                ) : (
                    <WorkspaceState
                        icon="canvas"
                        title="让第一个想法落在画布上"
                        description="图片、分镜和灵感，都可以在这里自由组织。"
                        action={
                            <Button type="primary" icon={<Plus />} disabled={!hydrated} title={hydrated ? undefined : "正在恢复本地画布，完成后可新建"} onClick={createAndEnter}>
                                新建画布
                            </Button>
                        }
                    />
                )}
                {/* 无限滚动哨兵：只在加载中显示安静的 spinner、失败时给重试；全部加载后不再输出总数文案。 */}
                {hydrated && visibleProjects.length && (hasMore || libraryQuery.isFetchNextPageError) ? (
                    <div ref={loadMoreRef} className="library-load-more" aria-live="polite" aria-busy={libraryQuery.isFetchingNextPage}>
                        {libraryQuery.isFetchNextPageError ? (
                            <Button onClick={() => void libraryQuery.fetchNextPage()}>加载失败，重试</Button>
                        ) : libraryQuery.isFetchingNextPage ? (
                            <LoaderCircle className="size-4 animate-spin" role="img" aria-label="正在加载更多画布" />
                        ) : null}
                    </div>
                ) : null}
            </div>

            <input ref={inputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importCanvas(event.target.files?.[0])} />
            <Modal
                title="加入项目"
                open={associationOpen}
                okText="保存关联"
                cancelText="取消"
                okButtonProps={{ disabled: !associationProjectId, loading: projectQuery.isFetching }}
                onCancel={() => setAssociationOpen(false)}
                onOk={() => void associateSelected()}
            >
                <p className="mb-3 text-sm text-foreground/60">选中的画布会保留原有节点和本地媒体，只增加项目关联。</p>
                <Select
                    className="w-full"
                    value={associationProjectId || undefined}
                    placeholder="选择项目"
                    options={(projectQuery.data?.projects || []).map((item) => ({ label: item.project.name, value: item.project.id }))}
                    onChange={setAssociationProjectId}
                />
            </Modal>
            <CanvasHistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} />
            {deleteDialogOpen ? (
                <Suspense fallback={null}>
                    <CanvasDeleteProjectsDialog />
                </Suspense>
            ) : null}
        </WorkspacePage>
    );
}
