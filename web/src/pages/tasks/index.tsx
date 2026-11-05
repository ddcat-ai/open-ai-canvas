import { CollectionToolbar } from "@/components/layout/collection-toolbar";
import { App, Button, Form, Input } from "antd";
import { Switch } from "@/components/ui/base/switch";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { AppModal } from "@/components/ui/product/app-modal";
import { LayoutGrid, List, Plus, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router";
import { currentLocale, translate } from "@/i18n";

import { MediaPreview } from "@/components/media-preview";
import { PageHeader, PaginationBar, WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceNoResultsState, WorkspaceState } from "@/components/layout/workspace-state";
import { CONTENT_MODERATION_ERROR_CODE, isContentModerationError } from "@/lib/generation-error";
import { formatTaskKind, operationOptions } from "@/lib/generation-task-display";
import { buildVideoOperationPrompt } from "@/lib/prompts";
import { backendProviderConfig, logicalModelIDForConfig } from "@/services/api/generation-task";

import {
    createGenerationTask,
    listGenerationTasks,
    listTaskLogs,
    queryFailedVideoProviderTask,
    queryGenerationTask,
    retryGenerationTask,
    recoverGenerationTaskMedia,
    type CreateTaskInput,
    type GenerationTask,
    type TaskLog,
} from "@/services/api/task-center";
import { syncGenerationTaskToCanvasStore } from "@/lib/canvas/canvas-generation-task-sync";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { resolveModelRequestConfig, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { listProjects, type ProjectSummary } from "@/services/api/projects";
import { TaskDetailModal } from "./task-detail-modal";
import { TaskGridCard } from "./task-grid-card";
import { TaskGroupHeader, type TaskGroup } from "./task-group-header";
import { TaskListRow } from "./task-list-row";
import { formatModelName, getTaskCanvasContext, isTaskFailed, taskMediaKind } from "./task-shared";
import { TaskStatusFilterBar, type TaskStatusFilter } from "./task-status-filter";
import { Select } from "@/components/ui/base/select";

import "./tasks-page.css";

type TaskKindFilter = "all" | "text" | "image" | "video";
type TaskViewMode = "list" | "grid";

function preferenceKeys() {
    const userId = useUserStore.getState().user?.id ?? "anon";
    return { view: `task-center-view.${userId}`, group: `task-center-group.${userId}` };
}

function readTaskPreference(key: string, fallback: string): string {
    try {
        return window.localStorage.getItem(key) ?? fallback;
    } catch (error) {
        console.warn("读取任务中心偏好失败", error);
        return fallback;
    }
}

function writeTaskPreference(key: string, value: string): void {
    try {
        window.localStorage.setItem(key, value);
    } catch (error) {
        console.warn("保存任务中心偏好失败", error);
    }
}

function taskStatusFilter(value: string | null): TaskStatusFilter {
    return value === "failed" || value === "active" || value === "succeeded" ? value : "all";
}

export default function TasksPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const projects = useCanvasStore((state) => state.projects);
    const shortDramaEnabled = useUserStore((state) => state.features.shortDramaEnabled);
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const [form] = Form.useForm<CreateTaskInput & { operation: string }>();
    const { view: viewPreferenceKey, group: groupPreferenceKey } = preferenceKeys();
    const [domainProjects, setDomainProjects] = useState<ProjectSummary[]>([]);
    const [loading, setLoading] = useState(false);
    const [actingId, setActingId] = useState("");
    const [createOpen, setCreateOpen] = useState(false);
    const [creating, setCreating] = useState(false);
    const statusFilter = taskStatusFilter(searchParams.get("status"));
    const setStatusFilter = (value: TaskStatusFilter) => {
        const next = new URLSearchParams(searchParams);
        next.set("status", value);
        setSearchParams(next, { replace: true });
    };
    const [keyword, setKeyword] = useState("");
    const [projectFilter, setProjectFilter] = useState("all");
    const [kindFilter, setKindFilter] = useState<TaskKindFilter>("all");
    const [modelFilter, setModelFilter] = useState("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [viewMode, setViewMode] = useState<TaskViewMode>(() => (readTaskPreference(viewPreferenceKey, "list") === "grid" ? "grid" : "list"));
    const [groupEnabled, setGroupEnabled] = useState<boolean>(() => readTaskPreference(groupPreferenceKey, "0") === "1");
    const [retryingGroup, setRetryingGroup] = useState("");
    const [detailTask, setDetailTask] = useState<GenerationTask | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [taskLogs, setTaskLogs] = useState<TaskLog[]>([]);
    const [logsLoading, setLogsLoading] = useState(false);
    const [mediaPreview, setMediaPreview] = useState<{ url: string; kind: "image" | "video"; title: string } | null>(null);
    const [tasks, setTasks] = useState<GenerationTask[]>([]);
    const syncedCanvasTaskIdsRef = useRef(new Set<string>());
    const tasksRef = useRef<GenerationTask[]>([]);
    const canvasById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
    const domainProjectNameById = useMemo(() => new Map(domainProjects.map((item) => [item.project.id, item.project.name])), [domainProjects]);
    const projectOptions = useMemo(
        () =>
            projects.map((project) => {
                const projectName = project.projectId ? domainProjectNameById.get(project.projectId) : "";
                return { label: projectName ? `${project.title || t("library.tasks.shared.untitledCanvas")} · ${projectName}` : project.title || t("library.tasks.shared.untitledCanvas"), value: project.id };
            }),
        [domainProjectNameById, projects, t],
    );
    const modelOptions = useMemo(() => Array.from(new Set(tasks.map((task) => formatModelName(effectiveConfig, task)).filter(Boolean))).sort((left, right) => left.localeCompare(right, currentLocale())), [effectiveConfig, tasks]);
    const filteredTasks = useMemo(
        () =>
            tasks
                .filter((task) => {
                    if (statusFilter === "all") return true;
                    if (statusFilter === "active") return task.status === "queued" || task.status === "running";
                    if (statusFilter === "failed") return task.status === "failed" || task.status === "cancelled";
                    if (statusFilter === "succeeded") return task.status === "succeeded";
                    return false;
                })
                .filter((task) => {
                    if (projectFilter !== "all" && task.projectId !== projectFilter) return false;
                    if (kindFilter !== "all" && taskMediaKind(task) !== kindFilter) return false;
                    if (modelFilter !== "all" && formatModelName(effectiveConfig, task) !== modelFilter) return false;
                    const query = keyword.trim().toLowerCase();
                    const context = getTaskCanvasContext(task, canvasById, domainProjectNameById);
                    return !query || `${task.prompt} ${task.model || ""} ${formatTaskKind(task)} ${context.canvasName} ${context.projectName}`.toLowerCase().includes(query);
                }),
        [canvasById, domainProjectNameById, effectiveConfig, keyword, kindFilter, modelFilter, projectFilter, statusFilter, tasks],
    );
    const visibleTasks = useMemo(() => filteredTasks.slice((page - 1) * pageSize, page * pageSize), [filteredTasks, page, pageSize]);
    const taskStats = useMemo(() => {
        let today = 0;
        let active = 0;
        let succeeded = 0;
        let failed = 0;
        const now = new Date();
        for (const task of tasks) {
            if (task.createdAt) {
                const created = new Date(task.createdAt);
                if (!Number.isNaN(created.getTime()) && created.getFullYear() === now.getFullYear() && created.getMonth() === now.getMonth() && created.getDate() === now.getDate()) today += 1;
            }
            if (task.status === "queued" || task.status === "running") active += 1;
            else if (task.status === "succeeded") succeeded += 1;
            else if (task.status === "failed" || task.status === "cancelled") failed += 1;
        }
        return { total: tasks.length, today, active, succeeded, failed };
    }, [tasks]);
    const groupingActive = viewMode === "list" && groupEnabled;
    const visibleTaskGroups = useMemo(() => (groupingActive ? groupTasksByCanvas(filteredTasks, canvasById, domainProjectNameById) : []), [canvasById, domainProjectNameById, filteredTasks, groupingActive]);

    const changeViewMode = (mode: TaskViewMode) => {
        setViewMode(mode);
        writeTaskPreference(viewPreferenceKey, mode);
    };

    const changeGroupEnabled = (enabled: boolean) => {
        setGroupEnabled(enabled);
        writeTaskPreference(groupPreferenceKey, enabled ? "1" : "0");
    };

    const retryGroupTasks = async (key: string, items: GenerationTask[]) => {
        const retryable = items.filter((task) => isTaskFailed(task) && task.errorCode !== CONTENT_MODERATION_ERROR_CODE && !isContentModerationError(task.error));
        if (!retryable.length) return;
        setRetryingGroup(key);
        try {
            for (const task of retryable) {
                await runAction(task.id);
            }
        } finally {
            setRetryingGroup("");
        }
    };

    const renderTaskRow = (task: GenerationTask) => (
        <TaskListRow
            key={task.id}
            task={task}
            canvasById={canvasById}
            projectNameById={domainProjectNameById}
            effectiveConfig={effectiveConfig}
            creditsEnabled={creditsEnabled}
            actingId={actingId}
            onOpen={() => void openTaskDetail(task)}
            onRetry={() => void runAction(task.id)}
            onPreview={() => task.previewUrl && setMediaPreview({ url: task.previewUrl, kind: task.previewKind === "video" ? "video" : "image", title: task.prompt || formatTaskKind(task) })}
        />
    );

    const renderTaskGridCard = (task: GenerationTask) => <TaskGridCard key={task.id} task={task} effectiveConfig={effectiveConfig} actingId={actingId} onOpen={() => void openTaskDetail(task)} onRetry={() => void runAction(task.id)} />;

    useEffect(() => {
        if (!shortDramaEnabled) {
            setDomainProjects([]);
            return;
        }
        let cancelled = false;
        void listProjects()
            .then((result) => {
                if (!cancelled) setDomainProjects(result.projects);
            })
            .catch((error) => {
                if (cancelled) return;
                // 领域项目只是任务页的辅助筛选数据；读取失败不能阻断任务列表，但必须清空旧快照并留下可检索的诊断。
                setDomainProjects([]);
                console.warn("加载任务关联项目失败，已禁用本次项目筛选", error);
            });
        return () => {
            cancelled = true;
        };
    }, [shortDramaEnabled]);

    useEffect(() => {
        const maxPage = Math.max(1, Math.ceil(filteredTasks.length / pageSize));
        if (page > maxPage) setPage(maxPage);
    }, [filteredTasks.length, page, pageSize]);

    const syncCompletedCanvasTasks = useCallback(async (items: GenerationTask[]) => {
        const pendingTaskIds = new Set(
            useCanvasStore
                .getState()
                .projects.flatMap((project) => project.nodes)
                .filter((node) => node.metadata?.taskId && (node.metadata.status !== "success" || !node.metadata.content))
                .map((node) => node.metadata!.taskId!),
        );
        const candidates = items.filter((task) => task.status === "succeeded" && pendingTaskIds.has(task.id) && task.projectId && task.type.startsWith("canvas_") && !syncedCanvasTaskIdsRef.current.has(task.id));
        await Promise.all(
            candidates.map(async (task) => {
                syncedCanvasTaskIdsRef.current.add(task.id);
                try {
                    const detail = task.resultJson ? task : await queryGenerationTask(task.id);
                    await syncGenerationTaskToCanvasStore(detail);
                } catch {
                    syncedCanvasTaskIdsRef.current.delete(task.id);
                }
            }),
        );
    }, []);

    const loadTasks = useCallback(
        async (showLoading = false) => {
            if (showLoading) setLoading(true);
            try {
                const next = await listGenerationTasks();
                setTasks((current) => reconcileTaskSummaries(current, next));
                void syncCompletedCanvasTasks(next);
                return next;
            } catch (error) {
                if (showLoading) message.error(error instanceof Error ? error.message : t("library.tasks.page.loadFailed"));
                return undefined;
            } finally {
                if (showLoading) setLoading(false);
            }
        },
        [message, syncCompletedCanvasTasks, t],
    );

    const openTaskDetail = useCallback(
        async (task: GenerationTask) => {
            setDetailTask(task);
            setTaskLogs([]);
            setDetailLoading(true);
            setLogsLoading(true);
            try {
                const [detail, logs] = await Promise.all([queryGenerationTask(task.id), listTaskLogs(task.id)]);
                setDetailTask(detail);
                setTaskLogs(logs);
            } catch (error) {
                message.error(error instanceof Error ? error.message : t("library.tasks.page.detailLoadFailed"));
            } finally {
                setDetailLoading(false);
                setLogsLoading(false);
            }
        },
        [message, t],
    );

    useEffect(() => {
        tasksRef.current = tasks;
    }, [tasks]);

    useEffect(() => {
        let stopped = false;
        let timer = 0;
        const poll = async (initial = false) => {
            const next = await loadTasks(initial);
            if (stopped) return;
            const items = next || tasksRef.current;
            const hasActiveTasks = items.some((task) => task.status === "queued" || task.status === "running");
            timer = window.setTimeout(() => void poll(false), document.hidden ? 60_000 : hasActiveTasks ? 10_000 : 60_000);
        };
        const handleVisibility = () => {
            if (document.hidden) return;
            window.clearTimeout(timer);
            void poll(false);
        };
        void poll(true);
        document.addEventListener("visibilitychange", handleVisibility);
        return () => {
            stopped = true;
            window.clearTimeout(timer);
            document.removeEventListener("visibilitychange", handleVisibility);
        };
    }, [loadTasks]);

    const runAction = async (id: string) => {
        setActingId(id);
        try {
            const currentTask = await queryGenerationTask(id);
            const savingMedia = Boolean(currentTask.mediaStage);
            const next = currentTask.status === "queued" || currentTask.status === "running" || currentTask.status === "succeeded" ? currentTask : savingMedia ? await recoverGenerationTaskMedia(id) : await retryGenerationTask(id);
            setTasks((items) => items.map((item) => (item.id === id ? next : item)));
            setDetailTask((current) => (current?.id === id ? { ...current, ...next } : current));
            setStatusFilter("active");
            setPage(1);
            message.success(next.status === "succeeded" ? t("library.tasks.page.taskCompleted") : savingMedia ? t("library.tasks.page.recoveringMedia") : t("library.tasks.page.taskQueued"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("library.tasks.page.actionFailed"));
        } finally {
            setActingId("");
        }
    };

    const queryProviderTask = async (task: GenerationTask) => {
        setActingId(task.id);
        try {
            const result = await queryFailedVideoProviderTask(task.id);
            if (!result.recovered) {
                setTaskLogs(await listTaskLogs(task.id));
                message.info(result.providerStatus ? t("library.tasks.page.upstreamPendingWithStatus", { status: result.providerStatus }) : t("library.tasks.page.upstreamPending"));
                return;
            }
            setDetailTask(result.task);
            setTasks((items) => items.map((item) => (item.id === task.id ? { ...item, ...result.task } : item)));
            setTaskLogs(await listTaskLogs(task.id));
            await syncGenerationTaskToCanvasStore(result.task);
            window.dispatchEvent(new CustomEvent("wallet:updated"));
            void loadTasks(false);
            if (result.billingSettled) message.success(t("library.tasks.page.upstreamRecoveredSettled"));
            else message.warning(t("library.tasks.page.upstreamRecoveredUnsettled"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("library.tasks.page.upstreamQueryFailed"));
        } finally {
            setActingId("");
        }
    };

    const submitTask = async () => {
        const values = await form.validateFields();
        setCreating(true);
        try {
            {
                const videoModel = values.model?.trim() || effectiveConfig.videoModel || effectiveConfig.model;
                if (values.operation !== "compare_versions" && !isAiConfigReady(effectiveConfig, videoModel)) {
                    message.error(t("library.tasks.page.videoModelMissing"));
                    return;
                }
                const requestConfig = resolveModelRequestConfig(effectiveConfig, videoModel);
                const task = await createGenerationTask({
                    projectId: values.projectId,
                    type: `video_${values.operation}`,
                    operation: values.operation,
                    prompt: values.prompt,
                    provider: values.operation === "compare_versions" ? "internal-agent" : "openai-compatible",
                    model: values.operation === "compare_versions" ? "version-router" : requestConfig.model,
                    ...(values.operation !== "compare_versions" && logicalModelIDForConfig(requestConfig) ? { logicalModelId: logicalModelIDForConfig(requestConfig) } : {}),
                    input: {
                        source: "tasks-page",
                        mode: values.operation === "compare_versions" ? "workflow" : "video",
                        prompt: buildVideoOperationPrompt(values.operation, values.prompt, operationOptions.find((item) => item.value === values.operation)?.label || "其他视频操作"),
                        config: values.operation === "compare_versions" ? undefined : backendProviderConfig(requestConfig),
                        metadata: { videoEditOperation: values.operation },
                    },
                });
                setTasks((items) => [task, ...items]);
            }
            setStatusFilter("active");
            setPage(1);
            setCreateOpen(false);
            form.resetFields();
            message.success(t("library.tasks.page.created"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("library.tasks.page.createFailed"));
        } finally {
            setCreating(false);
        }
    };

    const detailContext = detailTask ? getTaskCanvasContext(detailTask, canvasById, domainProjectNameById) : null;
    // 搜索或筛选（不含状态）把已有任务全部过滤掉时显示「无结果」，而不是「还没有任务」。
    const searchOrFilterActive = Boolean(keyword.trim() || projectFilter !== "all" || kindFilter !== "all" || modelFilter !== "all");
    const filtersActive = searchOrFilterActive || statusFilter !== "all";
    const resetFilters = () => {
        setKeyword("");
        setProjectFilter("all");
        setKindFilter("all");
        setModelFilter("all");
        setStatusFilter("all");
        setPage(1);
    };
    const renderTaskList = (items: GenerationTask[]) => (
        <div className="task-center-list" data-billing={creditsEnabled || undefined}>
            {items.map(renderTaskRow)}
        </div>
    );

    return (
        <>
            <WorkspacePage grid className="library-page task-center-page">
                <div className="studio-band">
                    <PageHeader
                        title={t("library.tasks.page.title")}
                        description={t("library.tasks.page.description")}
                        meta={
                            <span className="app-projects-header-meta">
                                {t("library.tasks.page.taskCount", { count: taskStats.total })} · {t("library.tasks.filter.today")} {taskStats.today}
                            </span>
                        }
                        actions={
                            <Button type="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreateOpen(true)}>
                                {t("library.tasks.page.newTask")}
                            </Button>
                        }
                    />
                    {/* 第一行：状态切换和视图；第二行：搜索与筛选。分两行排，窄屏不会把控件挤成一团。 */}
                    <div className="task-center-statusbar">
                        <TaskStatusFilterBar
                            stats={taskStats}
                            value={statusFilter}
                            onChange={(value) => {
                                setStatusFilter(value);
                                setPage(1);
                            }}
                        />
                        <div className="task-center-view-controls">
                            {viewMode === "list" ? (
                                <label className="task-center-group-toggle">
                                    <Switch size="sm" checked={groupEnabled} onChange={changeGroupEnabled} />
                                    <span>{t("library.tasks.page.groupByCanvas")}</span>
                                </label>
                            ) : null}
                            <SegmentedControl<TaskViewMode>
                                ariaLabel={t("library.tasks.page.viewMode")}
                                size="sm"
                                value={viewMode}
                                options={[
                                    { value: "list", icon: <List className="size-3.5" />, title: t("library.tasks.page.listView") },
                                    { value: "grid", icon: <LayoutGrid className="size-3.5" />, title: t("library.tasks.page.gridView") },
                                ]}
                                onChange={changeViewMode}
                            />
                        </div>
                    </div>
                    <CollectionToolbar active={filtersActive} onReset={resetFilters}>
                        <Input
                            id="task-search"
                            name="taskSearch"
                            allowClear
                            className="app-list-search task-center-search"
                            prefix={<Search className="size-4 text-foreground/40" />}
                            value={keyword}
                            placeholder={t("library.tasks.page.searchPlaceholder")}
                            onChange={(event) => {
                                setKeyword(event.target.value);
                                setPage(1);
                            }}
                        />
                        <Select
                            className="task-center-filter is-wide"
                            value={projectFilter}
                            onChange={(value) => {
                                setProjectFilter(value);
                                setPage(1);
                            }}
                            options={[{ label: t("library.tasks.page.allCanvases"), value: "all" }, ...projectOptions]}
                        />
                        <Select
                            className="task-center-filter"
                            value={kindFilter}
                            onChange={(value) => {
                                setKindFilter(value as TaskKindFilter);
                                setPage(1);
                            }}
                            options={[
                                { label: t("library.tasks.page.allKinds"), value: "all" },
                                { label: t("library.tasks.page.kindText"), value: "text" },
                                { label: t("library.tasks.page.kindImage"), value: "image" },
                                { label: t("library.tasks.page.kindVideo"), value: "video" },
                            ]}
                        />
                        <Select
                            className="task-center-filter is-wide"
                            value={modelFilter}
                            onChange={(value) => {
                                setModelFilter(value);
                                setPage(1);
                            }}
                            options={[{ label: t("library.tasks.page.allModels"), value: "all" }, ...modelOptions.map((model) => ({ label: model, value: model }))]}
                        />
                    </CollectionToolbar>
                </div>

                <div className="collection-content task-center-content">
                    {loading && !tasks.length ? (
                        <TaskCenterSkeleton viewMode={viewMode} label={t("library.tasks.page.loading")} />
                    ) : visibleTasks.length ? (
                        viewMode === "grid" ? (
                            <div className="task-center-grid">{visibleTasks.map(renderTaskGridCard)}</div>
                        ) : groupingActive ? (
                            <div className="task-center-groups">
                                {visibleTaskGroups.map((group) => (
                                    <section key={group.key} className="task-center-group">
                                        <TaskGroupHeader group={group} retrying={retryingGroup === group.key} onRetryFailed={() => void retryGroupTasks(group.key, group.tasks)} />
                                        {renderTaskList(group.tasks)}
                                    </section>
                                ))}
                            </div>
                        ) : (
                            renderTaskList(visibleTasks)
                        )
                    ) : tasks.length && searchOrFilterActive ? (
                        <WorkspaceNoResultsState compact query={keyword} onClear={resetFilters} />
                    ) : (
                        <WorkspaceState
                            compact
                            title={taskEmptyState(statusFilter).title}
                            description={taskEmptyState(statusFilter).description}
                            action={
                                <Button className="library-primary-action" type="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreateOpen(true)}>
                                    {t("library.tasks.page.newTask")}
                                </Button>
                            }
                        />
                    )}
                    {!groupingActive ? (
                        <PaginationBar
                            current={page}
                            pageSize={pageSize}
                            total={filteredTasks.length}
                            pageSizeOptions={[20, 50, 100]}
                            onChange={(nextPage, nextPageSize) => {
                                setPage(nextPageSize !== pageSize ? 1 : nextPage);
                                setPageSize(nextPageSize);
                            }}
                        />
                    ) : null}
                </div>
            </WorkspacePage>
            <AppModal className="library-modal" title={t("library.tasks.create.title")} open={createOpen} onCancel={() => setCreateOpen(false)} onOk={submitTask} confirmLoading={creating} okText={t("library.tasks.create.submit")} destroyOnHidden={false}>
                <Form form={form} layout="vertical" initialValues={{ operation: "text_to_video" }}>
                    <Form.Item name="operation" label={t("library.tasks.create.operation")} rules={[{ required: true, message: t("library.tasks.create.operationRequired") }]}>
                        <Select options={operationOptions} />
                    </Form.Item>
                    <Form.Item name="prompt" label={t("library.tasks.create.prompt")} rules={[{ required: true, message: t("library.tasks.create.promptRequired") }]}>
                        <Input.TextArea rows={5} placeholder={t("library.tasks.create.promptPlaceholder")} />
                    </Form.Item>
                    <Form.Item name="projectId" label={t("library.tasks.create.canvas")}>
                        <Select allowClear showSearch optionFilterProp="label" options={projectOptions} placeholder={projectOptions.length ? t("library.tasks.create.canvasPlaceholder") : t("library.tasks.create.noCanvas")} />
                    </Form.Item>
                    <Form.Item name="model" label={t("library.tasks.create.model")}>
                        <Input placeholder={t("library.tasks.create.modelPlaceholder")} />
                    </Form.Item>
                </Form>
            </AppModal>
            <TaskDetailModal
                task={detailTask}
                loading={detailLoading}
                logs={taskLogs}
                logsLoading={logsLoading}
                actingId={actingId}
                canvasName={detailContext ? (detailContext.projectName ? `${detailContext.canvasName} · ${detailContext.projectName}` : detailContext.canvasName) : ""}
                modelName={detailTask ? formatModelName(effectiveConfig, detailTask) : ""}
                creditsEnabled={creditsEnabled}
                onClose={() => setDetailTask(null)}
                onRetry={(task) => void runAction(task.id)}
                onQueryProvider={(task) => void queryProviderTask(task)}
                onExportDiagnostics={(task) => navigate(`/settings?section=diagnostics&taskId=${encodeURIComponent(task.id)}${task.projectId ? `&projectId=${encodeURIComponent(task.projectId)}` : ""}`)}
                onPreviewMedia={setMediaPreview}
            />
            <AppModal
                title={<span className="block truncate pr-8">{mediaPreview?.title || t("library.tasks.detail.previewTitle")}</span>}
                open={Boolean(mediaPreview)}
                onCancel={() => setMediaPreview(null)}
                footer={null}
                centered
                width="min(1040px, calc(100vw - 32px))"
                className="library-modal task-center-preview-modal"
            >
                {mediaPreview ? (
                    <MediaPreview
                        src={mediaPreview.url}
                        kind={mediaPreview.kind}
                        alt={mediaPreview.title}
                        controls={mediaPreview.kind === "video"}
                        className="max-h-[76vh] w-full bg-black object-contain"
                        fallbackClassName="task-center-preview-unavailable"
                    />
                ) : null}
            </AppModal>
        </>
    );
}

/** 首次读取的占位：列表模式给行骨架，网格模式给卡片骨架，切换后形状一致不跳。 */
function TaskCenterSkeleton({ viewMode, label }: { viewMode: TaskViewMode; label: string }) {
    if (viewMode === "grid") {
        return (
            <div className="task-center-grid" aria-busy="true" aria-label={label}>
                {Array.from({ length: 8 }, (_, index) => (
                    <div key={index} className="task-center-card is-skeleton" aria-hidden="true">
                        <div className="task-center-card-media" />
                        <div className="task-center-card-body">
                            <span className="task-center-skeleton-line" />
                            <span className="task-center-skeleton-line is-sm" />
                        </div>
                    </div>
                ))}
            </div>
        );
    }
    return (
        <div className="task-center-list" aria-busy="true" aria-label={label}>
            {Array.from({ length: 6 }, (_, index) => (
                <div key={index} className="task-center-row is-skeleton" aria-hidden="true">
                    <span className="task-center-thumb" />
                    <div className="task-center-row-main">
                        <span className="task-center-skeleton-line" />
                        <span className="task-center-skeleton-line is-sm" />
                    </div>
                </div>
            ))}
        </div>
    );
}

function reconcileTaskSummaries(current: GenerationTask[], next: GenerationTask[]) {
    if (current.length === 0) return next;
    const currentById = new Map(current.map((task) => [task.id, task]));
    let changed = false;
    const reconciled = next.map((task) => {
        const previous = currentById.get(task.id);
        if (
            previous?.updatedAt === task.updatedAt &&
            previous.previewUrl === task.previewUrl &&
            previous.previewPosterUrl === task.previewPosterUrl &&
            previous.billing?.status === task.billing?.status &&
            previous.billing?.amountMicrocredits === task.billing?.amountMicrocredits &&
            previous.billing?.chargedMicrocredits === task.billing?.chargedMicrocredits &&
            previous.billing?.refundedMicrocredits === task.billing?.refundedMicrocredits
        )
            return previous;
        changed = true;
        return task;
    });
    return changed ? reconciled : current;
}

function groupTasksByCanvas(tasks: GenerationTask[], canvasById: Map<string, { title: string; projectId?: string }>, projectNameById: Map<string, string>): TaskGroup[] {
    const groups: TaskGroup[] = [];
    const byKey = new Map<string, TaskGroup>();
    for (const task of tasks) {
        const context = getTaskCanvasContext(task, canvasById, projectNameById);
        const key = `${context.projectName}\u0000${context.canvasName}`;
        let group = byKey.get(key);
        if (!group) {
            group = { key, title: context.canvasName, projectName: context.projectName, tasks: [] };
            byKey.set(key, group);
            groups.push(group);
        }
        group.tasks.push(task);
    }
    return groups;
}

function taskEmptyState(status: TaskStatusFilter) {
    if (status === "all") return { title: translate("library.tasks.empty.allTitle"), description: translate("library.tasks.empty.allDescription") };
    if (status === "active") return { title: translate("library.tasks.empty.activeTitle"), description: translate("library.tasks.empty.activeDescription") };
    if (status === "succeeded") return { title: translate("library.tasks.empty.succeededTitle"), description: translate("library.tasks.empty.succeededDescription") };
    return { title: translate("library.tasks.empty.failedTitle"), description: translate("library.tasks.empty.failedDescription") };
}
