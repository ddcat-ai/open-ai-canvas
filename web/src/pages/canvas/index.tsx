import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Dropdown, Modal, Select } from "antd";
import { ArrowDownAZ, ChevronRight, Clock3, Download, FileUp, FolderPlus, History, ListFilter, MoreHorizontal, Pencil, Plus, Search, SlidersHorizontal, Trash2, X } from "lucide-react";

import { CollectionGrid, PageHeader, WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceLoadingState, WorkspaceState } from "@/components/layout/workspace-state";

import { readZip } from "@/lib/zip";
import { setMediaBlob } from "@/services/file-storage";
import { setImageBlob } from "@/services/image-storage";
import { CanvasCreateCard } from "@/components/canvas/canvas-project-card";
import { CanvasFolderCard } from "@/components/canvas/canvas-folder-card";
import { CanvasHistoryDrawer } from "@/components/canvas/canvas-history-drawer";
import type { CanvasExportFile } from "@/types/canvas-export";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { flushCanvasStorePersistence, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { saveCanvasDrawing, type CanvasDrawingRenderDraft } from "@/lib/canvas/canvas-drawing-storage";
import { createCanvasProjectWithRemoteSync, hasRemoteUserDataSyncSession, loadCanvasProjectForEditing, saveRemoteUserDataNow, scheduleRemoteUserDataSync } from "@/services/user-data-sync";
import { listRemoteCanvasProjectsPage, type CanvasLibrarySummary } from "@/services/api/user-data";
import { useUserStore } from "@/stores/use-user-store";
import { listProjects, type Project } from "@/services/api/projects";
import { loadCanvasProjectPage } from "@/lib/workspace-route-modules";
import { resourceFileUrl, resourceStorageKey, uploadResourceFile } from "@/services/api/resources";
import { primeResourceBlobCache } from "@/services/resource-blob-cache";
import { useSyncProgressStore } from "@/stores/use-sync-progress-store";
import { ensureCanvasNodeAsset } from "@/services/project-asset-sync";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { CanvasProjectFolderDialog, CanvasProjectFolders } from "./canvas-project-folders";

const CanvasDeleteProjectsDialog = lazy(() => import("@/components/canvas/canvas-delete-projects-dialog").then((module) => ({ default: module.CanvasDeleteProjectsDialog })));

export default function CanvasPage() {
    const { message } = App.useApp();
    const brandName = useAppearanceStore((state) => state.appearance.brandName);
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [searchParams, setSearchParams] = useSearchParams();
    const mode = searchParams.get("mode");
    const shortDramaEnabled = useUserStore((state) => state.features.shortDramaEnabled);
    const inputRef = useRef<HTMLInputElement>(null);
    const autoOpenRef = useRef(false);
    const [keyword, setKeyword] = useState("");
    const [sort, setSort] = useState<"updated" | "name" | "nodes">("updated");
    const projectFilter = shortDramaEnabled ? searchParams.get("project") || (mode ? "all" : "folders") : searchParams.get("project") === "independent" ? "independent" : "all";
    const setProjectFilter = (value: string, preserveAssociation = false) => {
        const next = new URLSearchParams(searchParams);
        if (value === "folders" && !mode) next.delete("project");
        else next.set("project", value);
        setKeyword("");
        if (!preserveAssociation) setAssociationProjectId("");
        setSearchParams(next);
    };
    const inFolder = !["folders", "all", "independent"].includes(projectFilter);
    const [folderDialog, setFolderDialog] = useState<Project | "new" | null>(null);
    const [creating, setCreating] = useState(false);
    const creatingRef = useRef(false);
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
    const libraryFilter = projectFilter === "folders" ? (debouncedKeyword ? "all" : "independent") : projectFilter;
    const libraryQuery = useInfiniteQuery({
        queryKey: ["canvas-library", userId, libraryFilter, sort, debouncedKeyword],
        queryFn: ({ pageParam, signal }) => listRemoteCanvasProjectsPage({ page: pageParam, pageSize: 40, projectId: libraryFilter, sort, query: debouncedKeyword, signal }),
        initialPageParam: 1,
        getNextPageParam: (last) => last.hasMore ? last.page + 1 : undefined,
        enabled: Boolean(userId) && sessionHydrated,
    });
    const projects = useMemo<CanvasLibrarySummary[]>(() => userId
        ? libraryQuery.data?.pages.flatMap((page) => page.projects) || []
        : localProjects.map((project) => ({ ...project, nodeCount: project.nodes.length, previewNodes: project.nodes.slice(0, 4) })), [libraryQuery.data, localProjects, userId]);
    const totalProjects = userId ? libraryQuery.data?.pages[0]?.total || 0 : projects.length;
    const importProject = useCanvasStore((state) => state.importProject);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const deleteDialogOpen = useCanvasUiStore((state) => state.deleteProjectIds.length > 0);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const updateProject = useCanvasStore((state) => state.updateProject);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [associationOpen, setAssociationOpen] = useState(false);
    const [associationProjectId, setAssociationProjectId] = useState("");
    const [associating, setAssociating] = useState(false);
    const associatingRef = useRef(false);
    const projectQuery = useQuery({ queryKey: ["projects", "canvas-folders", userId], queryFn: () => listProjects(), enabled: Boolean(userId) && sessionHydrated && shortDramaEnabled, refetchOnMount: "always" });
    const activeFolder = projectQuery.data?.projects.find(({ project }) => project.id === projectFilter)?.project;
    const canCreateCanvas = hydrated && !creating && (!inFolder || Boolean(activeFolder && activeFolder.status !== "archived" && !projectQuery.isError));
    const folders = useMemo(() => (projectQuery.data?.projects || [])
        .filter(({ project }) => project.name.toLocaleLowerCase().includes(keyword.trim().toLocaleLowerCase()))
        .sort((a, b) => sort === "name" ? a.project.name.localeCompare(b.project.name, "zh-CN") : b.project.updatedAt.localeCompare(a.project.updatedAt)), [projectQuery.data, keyword, sort]);

    const agentMode = mode === "new" || mode === "recent" || mode === "choose";
    const handoffMode = mode === "handoff";
    const forwardedQuery = agentMode || handoffMode ? `?${searchParams.toString()}` : "";
    const preloadProject = useCallback(() => {
        void loadCanvasProjectPage();
    }, []);
    const enterProject = useCallback(
        (id: string) => {
            if (openingProjectIdRef.current) return;
            openingProjectIdRef.current = id;
            setOpeningProjectId(id);
            preloadProject();
            window.requestAnimationFrame(() => navigate(`/canvas/${id}${forwardedQuery}`));
        },
        [forwardedQuery, navigate, preloadProject],
    );
    const createAndEnter = async () => {
        if (!canCreateCanvas || creatingRef.current) return;
        creatingRef.current = true;
        setCreating(true);
        try {
            const title = activeFolder ? `${activeFolder.name} · 新画布` : `自由画布 ${totalProjects + 1}`;
            const { id, syncError } = await createCanvasProjectWithRemoteSync(title, activeFolder?.id);
            if (syncError) message.warning(syncError instanceof Error ? `画布已在本地创建，云端同步失败：${syncError.message}` : "画布已在本地创建，云端同步失败");
            void queryClient.invalidateQueries({ queryKey: ["projects"] });
            enterProject(id);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "画布创建失败");
        } finally {
            creatingRef.current = false;
            setCreating(false);
        }
    };
    const filteredProjects = useMemo(() => {
        if (userId) return projects;
        const query = keyword.trim().toLowerCase();
        const scope = projectFilter === "folders" ? (query ? "all" : "independent") : projectFilter;
        const scoped = projects.filter((project) => scope === "all" || (scope === "independent" ? !project.projectId : project.projectId === scope));
        const values = query ? scoped.filter((project) => project.title.toLowerCase().includes(query)) : [...scoped];
        values.sort((a, b) => (sort === "name" ? a.title.localeCompare(b.title, "zh-CN") : sort === "nodes" ? b.nodeCount - a.nodeCount : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
        return values;
    }, [keyword, projectFilter, projects, sort, userId]);
    const projectNames = useMemo(() => new Map((projectQuery.data?.projects || []).map(({ project }) => [project.id, project.name])), [projectQuery.data]);
    const visibleProjects = userId ? filteredProjects : filteredProjects.slice(0, loadedProjectCount);
    const hasMore = userId ? libraryQuery.hasNextPage : visibleProjects.length < filteredProjects.length;
    const showCreateCard = !keyword.trim() && canCreateCanvas;
    const selectedProjects = projects.filter((project) => selectedIds.includes(project.id));
    const projectFilterLabel = projectFilter === "folders" ? "按项目整理" : projectFilter === "all" ? "全部画布" : projectFilter === "independent" ? "自由画布" : projectNames.get(projectFilter) || "项目文件夹";
    const sortLabel = sort === "name" ? "按名称" : sort === "nodes" ? "按节点" : "最近更新";
    const projectFilterItems = useMemo(() => [...(shortDramaEnabled ? [{ key: "folders", label: "按项目整理" }] : []), { key: "all", label: "全部画布" }, { key: "independent", label: "自由画布" }, ...(shortDramaEnabled ? projectQuery.data?.projects || [] : []).map(({ project }) => ({ key: project.id, label: project.name }))], [projectQuery.data, shortDramaEnabled]);
    const sortItems = [
        { key: "updated", label: "最近更新", icon: <Clock3 className="size-3.5" /> },
        { key: "name", label: "按名称", icon: <ArrowDownAZ className="size-3.5" /> },
        { key: "nodes", label: "按节点数量", icon: <ListFilter className="size-3.5" /> },
    ];
    useEffect(() => {
        setLoadedProjectCount(50);
    }, [keyword, projectFilter, sort]);
    useEffect(() => {
        const ui = useCanvasUiStore.getState();
        ui.removeSelectedProjectIds(ui.selectedProjectIds);
        setAssociationOpen(false);
        setFolderDialog(null);
    }, [projectFilter, userId]);
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
        if (associatingRef.current || !selectedIds.length) return;
        const projectId = nextProjectId || undefined;
        const ids = [...selectedIds];
        let localSaved = false;
        associatingRef.current = true;
        setAssociating(true);
        try {
            if (!userId || !hasRemoteUserDataSyncSession()) throw new Error("云端同步尚未就绪，请稍后重试");
            if (projectId && !projectQuery.data?.projects.some(({ project }) => project.id === projectId && project.status !== "archived")) throw new Error("请选择可用的项目文件夹");
            for (const id of ids) {
                const canvas = await loadCanvasProjectForEditing(id);
                if (!canvas) throw new Error("画布不存在，请刷新列表后重新选择");
            }
            if (useUserStore.getState().user?.id !== userId) throw new Error("账号已切换，请重新选择画布");
            ids.forEach((id) => updateProject(id, { projectId }));
            await flushCanvasStorePersistence();
            localSaved = true;
            if (useUserStore.getState().user?.id !== userId || !hasRemoteUserDataSyncSession()) throw new Error("登录状态已变化，请重新打开画布列表");
            await saveRemoteUserDataNow();
            void queryClient.invalidateQueries({ queryKey: ["projects"] });
            void queryClient.invalidateQueries({ queryKey: ["project"] });
            useCanvasUiStore.getState().removeSelectedProjectIds(ids);
            message.success(projectId ? "已移入项目文件夹" : "已移出文件夹，可在自由画布中查看");
            setAssociationOpen(false);
        } catch (error) {
            const detail = error instanceof Error ? error.message : "请稍后重试";
            message.error(localSaved ? `归属已保存在本地，云端尚未全部确认：${detail}` : `画布关系保存失败：${detail}`);
        } finally {
            associatingRef.current = false;
            setAssociating(false);
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
        } catch (error) { message.error(error instanceof Error ? error.message : "导出失败"); }
    };
    const importCanvas = async (file?: File) => {
        if (!file || !canCreateCanvas) return;
        const hideLoading = message.loading({ content: "正在解压并准备导入画布...", duration: 0 });
        try {
            const zip = await readZip(file);
            const projectFile = zip.get("projects.json");
            if (!projectFile) throw new Error("缺少 projects.json 元数据文件");
            const data = JSON.parse(await projectFile.text()) as CanvasExportFile;
            if (!Array.isArray(data.projects)) throw new Error("projects.json 中缺少画布列表");
            for (const item of data.projects) {
                if (!Array.isArray(item.files)) throw new Error(`画布「${item.project?.title || "未命名画布"}」的媒体清单无效`);
                const missing = item.files.find((entry) => !zip.get(entry.path));
                if (missing) throw new Error(`压缩包缺少媒体文件：${missing.path}`);
            }
            hideLoading();
            const remoteSyncEnabled = hasRemoteUserDataSyncSession();
            let remoteSyncWarning: unknown;

            for (const item of data.projects) {
                const totalFiles = item.files.length;
                const domainProjectId = activeFolder?.id;
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
                        return {
                            ...node,
                            metadata: {
                                ...node.metadata,
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
                                            directMedia: { ...directMedia, storageKey: mapped.storageKey, url: mapped.url, dataUrl: directMedia.dataUrl ? mapped.url : directMedia.dataUrl, content: directMedia.content ? mapped.url : directMedia.content },
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
                            await saveRemoteUserDataNow();
                        } catch (syncError) {
                            remoteSyncWarning ||= syncError;
                            scheduleRemoteUserDataSync();
                            console.warn("导入画布云端同步失败，等待自动重试", syncError);
                        }
                    }
                } finally {
                    useSyncProgressStore.getState().setProjectProgress(importedProjectId, null);
                }
            }

            await flushCanvasStorePersistence();
            void queryClient.invalidateQueries({ queryKey: ["projects"] });
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
        void createCanvasProjectWithRemoteSync(`自由画布 ${projects.length + 1}`).then(({ id, syncError }) => {
            if (syncError) message.warning(syncError instanceof Error ? `画布已在本地创建，云端同步失败：${syncError.message}` : "画布已在本地创建，云端同步失败");
            enterProject(id);
        });
    }, [hydrated, message, mode, projects, sessionHydrated, userId, libraryQuery.isSuccess]);

    if (hydrated && !libraryQuery.isError && (mode === "new" || mode === "recent" || mode === "handoff")) return <main className="flex h-full items-center justify-center bg-background text-sm text-stone-500">正在打开画布...</main>;

    return (
        <WorkspacePage grid className="canvas-library-page">
            <div className="studio-band">
                <PageHeader
                    title={inFolder ? activeFolder?.name || "项目文件夹" : "画布"}
                    description={inFolder ? "按角色、场景或集数拆分画布，共同完成一个项目。" : shortDramaEnabled ? "用项目文件夹整理一部作品的多个画布。" : "把镜头、素材和想法留在同一张画布里。"}
                    meta={<span className="app-projects-header-meta">{totalProjects} 个画布</span>}
                    actions={
                        <div className="canvas-library-header-actions">
                            <Button className="canvas-library-header-action is-primary library-primary-action" type="primary" disabled={!canCreateCanvas} loading={creating} icon={<Plus className="size-3.5" />} onClick={() => void createAndEnter()}>
                                新建画布
                            </Button>
                            {shortDramaEnabled && !inFolder ? <Button className="canvas-library-header-action" disabled={!userId || !sessionHydrated} icon={<FolderPlus className="size-3.5" />} onClick={() => setFolderDialog("new")}>
                                新建项目文件夹
                            </Button> : null}
                            {projects.length ? (
                                <Dropdown
                                    menu={{
                                        classNames: { root: "canvas-library-actions-menu", item: "canvas-library-actions-menu-item" },
                                        items: [{ key: "delete-loaded", danger: true, icon: <Trash2 className="size-3.5" />, label: "删除当前已加载画布", onClick: () => setDeleteIds(projects.map((project) => project.id)) }],
                                    }}
                                    openClassName="is-open"
                                    placement="bottomRight"
                                    trigger={["click"]}
                                >
                                    <Button className="canvas-library-header-action is-icon" aria-label="更多画布操作" title="更多操作" icon={<MoreHorizontal className="size-4" />} />
                                </Dropdown>
                            ) : null}
                            <Button className="canvas-library-header-action" disabled={!canCreateCanvas} icon={<FileUp className="size-3.5" />} onClick={() => inputRef.current?.click()}>
                                导入
                            </Button>
                        </div>
                    }
                />

                <section className="canvas-library-discovery" aria-label="画布浏览工具">
                    <div className="canvas-library-search">
                        <Search aria-hidden="true" />
                        <input
                            value={keyword}
                            placeholder={projectFilter === "folders" ? "搜索项目文件夹或全部画布" : "搜索画布"}
                            aria-label={projectFilter === "folders" ? "搜索项目文件夹或全部画布" : "搜索画布"}
                            onChange={(event) => {
                                setKeyword(event.target.value);
                            }}
                        />
                        {keyword ? (
                            <button
                                type="button"
                                aria-label="清除搜索"
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
                            <button type="button" className={`canvas-library-filter${projectFilter !== "folders" ? " is-active" : ""}`} aria-label="按所属项目筛选">
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
                            <button type="button" className={`canvas-library-filter${sort !== "updated" ? " is-active" : ""}`} aria-label="画布排序">
                                {sort === "updated" ? <Clock3 /> : sort === "name" ? <ArrowDownAZ /> : <ListFilter />}
                                <span>{sortLabel}</span>
                            </button>
                        </Dropdown>
                        <button type="button" className="canvas-library-filter flex items-center gap-1.5" onClick={() => setHistoryOpen(true)} aria-label="查看画布创建与变更历史时间线" title="查看画布创建与变更历史时间线">
                            <History className="size-3.5 text-[var(--workspace-accent)]" />
                            <span>历史</span>
                        </button>
                        {keyword || projectFilter !== "folders" || sort !== "updated" ? (
                            <button
                                type="button"
                                className="canvas-library-reset"
                                onClick={() => {
                                    setKeyword("");
                                    setProjectFilter("folders");
                                    setSort("updated");
                                }}
                            >
                                重置
                            </button>
                        ) : null}
                    </div>
                    <span className="canvas-library-count">
                        <strong>{String(filteredProjects.length).padStart(2, "0")}</strong>
                        <span>/ {String(totalProjects).padStart(2, "0")} 画布</span>
                    </span>
                </section>
            </div>

            <div className="canvas-library-frame">
                {shortDramaEnabled && projectFilter !== "folders" ? (
                    <nav className="my-3 flex min-w-0 flex-wrap items-center gap-2 text-sm" aria-label="画布位置">
                        <button type="button" className="rounded-[var(--r-sm)] px-1 py-1 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--workspace-accent)]" onClick={() => setProjectFilter("folders")}>项目文件夹</button>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span className="min-w-0 truncate" aria-current="page">{projectFilterLabel}</span>
                        {activeFolder ? <>
                            <Button type="text" size="small" icon={<Pencil className="size-3.5" />} aria-label="重命名当前项目文件夹" onClick={() => setFolderDialog(activeFolder)} />
                            {activeFolder.status === "archived" ? <span className="text-muted-foreground">已归档</span> : <Button size="small" onClick={() => {
                                setProjectFilter("all", true);
                                setAssociationProjectId(activeFolder.id);
                                message.info("勾选需要的画布，再点击“移入项目文件夹”");
                            }}>添加已有画布</Button>}
                            {shortDramaEnabled ? <Link className="ml-auto text-muted-foreground underline underline-offset-4 hover:text-foreground" to={`/projects/${activeFolder.id}/canvases`}>打开短剧创作</Link> : null}
                        </> : null}
                    </nav>
                ) : projectFilter === "folders" ? (
                    <section aria-labelledby="canvas-project-folders-heading">
                        <div className="mt-3 flex items-center justify-between gap-3">
                            <h2 id="canvas-project-folders-heading" className="text-sm font-medium">项目文件夹</h2>
                            {shortDramaEnabled ? <Link to="/projects" className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">在短剧创作中查看项目</Link> : null}
                        </div>
                        {projectQuery.isError ? <p role="alert" className="my-3 text-sm">项目文件夹读取失败<Button type="link" onClick={() => void projectQuery.refetch()}>重试</Button></p>
                            : projectQuery.isFetching && !projectQuery.data ? <p role="status" className="my-4 text-sm text-muted-foreground">正在加载项目文件夹…</p>
                            : folders.length ? <CanvasProjectFolders folders={folders} onOpen={setProjectFilter} onRename={setFolderDialog} />
                            : <p className="my-4 text-sm text-muted-foreground">{keyword.trim() ? "没有匹配的项目文件夹，下方显示画布搜索结果。" : "还没有项目文件夹。点击“新建项目文件夹”，把一部作品的画布放在一起。"}</p>}
                        <h2 className="mt-6 text-sm font-medium">{keyword.trim() ? "画布搜索结果" : "自由画布"}</h2>
                        {!keyword.trim() ? <p className="mt-1 text-xs text-muted-foreground">尚未加入项目的画布，可勾选后移入项目文件夹。</p> : null}
                    </section>
                ) : null}
                {selectedIds.length ? (
                    <div className="app-canvas-selection-toolbar mt-2 flex min-h-10 flex-wrap items-center gap-2 rounded-md border px-3 py-1.5 text-xs">
                        <strong className="mr-auto font-medium">已选 {selectedIds.length} 个画布</strong>
                        {shortDramaEnabled ? <Button
                            size="small"
                            disabled={!hydrated || projectQuery.isPending || projectQuery.isError || associating}
                            onClick={() => {
                                setAssociationProjectId(associationProjectId || selectedProjects[0]?.projectId || "");
                                setAssociationOpen(true);
                            }}
                        >
                            移入项目文件夹
                        </Button> : null}
                        {shortDramaEnabled && selectedProjects.some((project) => project.projectId) ? (
                            <Button
                                size="small"
                                disabled={!hydrated || associating}
                                onClick={() => {
                                    setAssociationProjectId("");
                                    void associateSelected("");
                                }}
                            >
                                移出文件夹
                            </Button>
                        ) : null}
                        <Button size="small" disabled={!hydrated} icon={<Download className="size-3.5" />} onClick={() => void exportSelected()}>
                            导出
                        </Button>
                        <Button size="small" danger disabled={!hydrated || associating} onClick={() => setDeleteIds(selectedIds)}>
                            删除
                        </Button>
                    </div>
                ) : null}

                {inFolder && projectQuery.isError ? (
                    <WorkspaceState icon="error" title="项目文件夹读取失败" action={<Button onClick={() => void projectQuery.refetch()}>重试</Button>} />
                ) : inFolder && projectQuery.isPending ? (
                    <WorkspaceLoadingState label="正在读取项目文件夹" />
                ) : inFolder && !activeFolder ? (
                    <WorkspaceState title="项目文件夹不可用" description="项目可能已删除或不属于当前账号，请返回项目文件夹列表。" action={<Button onClick={() => setProjectFilter("folders")}>返回项目文件夹</Button>} />
                ) : userId && libraryQuery.isError ? (
                    <div role="alert">画布列表读取失败<Button onClick={() => void libraryQuery.refetch()}>重试</Button></div>
                ) : !hydrated || (userId && libraryQuery.isPending) ? (
                    <WorkspaceLoadingState label="正在恢复画布" detail="读取本地缓存与账号同步状态" />
                ) : showCreateCard || visibleProjects.length ? (
                    <CollectionGrid className="canvas-library-grid">
                        {showCreateCard ? <CanvasCreateCard disabled={!canCreateCanvas} onClick={() => void createAndEnter()} /> : null}
                        {visibleProjects.map((project) => (
                            <CanvasFolderCard
                                key={project.id}
                                project={project}
                                projectName={project.projectId ? projectNames.get(project.projectId) || "未同步项目" : undefined}
                                onClick={() => enterProject(project.id)}
                                onPrefetch={preloadProject}
                                opening={openingProjectId === project.id}
                                onMove={shortDramaEnabled && Boolean(userId) && sessionHydrated && !associating ? () => {
                                    const ui = useCanvasUiStore.getState();
                                    ui.removeSelectedProjectIds(ui.selectedProjectIds);
                                    ui.toggleSelectedProjectId(project.id, true);
                                    setAssociationProjectId(project.projectId || "");
                                    setAssociationOpen(true);
                                } : undefined}
                            />
                        ))}
                    </CollectionGrid>
                ) : (
                    <WorkspaceState icon="canvas" title={inFolder && !keyword.trim() ? "项目文件夹中还没有画布" : "没有匹配的画布"} description={activeFolder?.status === "archived" ? "项目已归档，可在项目设置中恢复后添加画布。" : "换一个画布名称或重置筛选条件。"} />
                )}
                {hydrated && visibleProjects.length ? (
                    <div ref={loadMoreRef} className="library-load-more" aria-live="polite">
                        {libraryQuery.isFetchNextPageError ? <Button onClick={() => void libraryQuery.fetchNextPage()}>加载失败，重试</Button> : hasMore ? "继续下滑加载更多" : `已加载全部 ${filteredProjects.length} 个画布`}
                    </div>
                ) : null}
            </div>

            <input ref={inputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importCanvas(event.target.files?.[0])} />
            <Modal
                title="移入项目文件夹"
                open={associationOpen}
                okText="移入"
                cancelText="取消"
                okButtonProps={{ disabled: !associationProjectId || projectQuery.isFetching || projectQuery.isError, loading: associating }}
                cancelButtonProps={{ disabled: associating }}
                closable={!associating}
                maskClosable={!associating}
                keyboard={!associating}
                onCancel={() => setAssociationOpen(false)}
                onOk={() => void associateSelected()}
            >
                <p className="mb-3 text-sm text-foreground/60">将 {selectedIds.length} 个画布移到所选项目文件夹，保留画布内容。更换项目时会解除原项目的章节关联。</p>
                <Select
                    className="w-full"
                    value={associationProjectId || undefined}
                    placeholder="选择项目文件夹"
                    loading={projectQuery.isFetching}
                    disabled={associating || projectQuery.isError}
                    showSearch
                    optionFilterProp="label"
                    options={(projectQuery.data?.projects || []).map((item) => ({ label: `${item.project.name}${item.project.status === "archived" ? "（已归档）" : ""}`, value: item.project.id, disabled: item.project.status === "archived" }))}
                    onChange={setAssociationProjectId}
                />
                {projectQuery.isError ? <p role="alert" className="mt-2 text-sm">项目文件夹读取失败<Button type="link" onClick={() => void projectQuery.refetch()}>重试</Button></p> : null}
                {projectQuery.isSuccess && !projectQuery.data.projects.length ? <Button className="mt-3" icon={<FolderPlus className="size-3.5" />} onClick={() => { setAssociationOpen(false); setFolderDialog("new"); }}>新建项目文件夹</Button> : null}
            </Modal>
            {shortDramaEnabled && folderDialog ? <CanvasProjectFolderDialog key={`${userId}:${folderDialog === "new" ? "new" : folderDialog.id}`} project={folderDialog === "new" ? undefined : folderDialog} onClose={() => setFolderDialog(null)} onCreated={setProjectFilter} /> : null}
            <CanvasHistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} />
            {deleteDialogOpen ? <Suspense fallback={null}><CanvasDeleteProjectsDialog /></Suspense> : null}
        </WorkspacePage>
    );
}
