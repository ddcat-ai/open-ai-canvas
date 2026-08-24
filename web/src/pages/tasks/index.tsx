import { App, Button, Drawer, Form, Input, Modal, Select, Switch, Tooltip, Typography } from "antd";
import { LayoutGrid, List, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import { MediaPreview } from "@/components/media-preview";
import { ListToolbar, PaginationBar, WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceState } from "@/components/layout/workspace-state";
import { CONTENT_MODERATION_ERROR_CODE, generationErrorMessage, isContentModerationError } from "@/lib/generation-error";
import { formatTaskKind, isGenerationTaskSubmissionUncertain, operationOptions, statusLabel } from "@/lib/generation-task-display";
import { backendProviderConfig, logicalModelIDForConfig } from "@/services/api/generation-task";

import {
    createAgentSession,
    createGenerationTask,
    deleteGenerationTask,
    formatTaskLog,
    listGenerationTasks,
    listTaskLogs,
    queryFailedVideoProviderTask,
    queryGenerationTask,
    refreshGenerationTaskStatus,
    retryGenerationTask,
    type CreateTaskInput,
    type GenerationTask,
    type TaskLog,
} from "@/services/api/task-center";
import { syncGenerationTaskToCanvasStore } from "@/lib/canvas/canvas-generation-task-sync";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { resolveModelRequestConfig, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { listProjects, type ProjectSummary } from "@/services/api/projects";
import { t as translate } from "@/i18n";
import { TaskGridCard } from "./task-grid-card";
import { TaskGroupHeader, type TaskGroup } from "./task-group-header";
import { TaskListRow } from "./task-list-row";
import { formatModelName, getTaskCanvasContext, isTaskFailed, providerCancelStatusLabel, taskMediaKind } from "./task-shared";
import { TaskStatusFilterBar, type TaskStatusFilter } from "./task-status-filter";
import { useTranslation } from "react-i18next";

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
        console.warn(translate("tasks:failed-to-read-task-center-preferences"), error);
        return fallback;
    }
}

function writeTaskPreference(key: string, value: string): void {
    try {
        window.localStorage.setItem(key, value);
    } catch (error) {
        console.warn(translate("tasks:failed-to-save-task-center-preferences"), error);
    }
}

function taskStatusFilter(value: string | null): TaskStatusFilter {
    return value === "failed" || value === "active" || value === "succeeded" ? value : "all";
}

export default function TasksPage() {
    const { t } = useTranslation("canvas");
    const { message } = App.useApp();
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
                return { label: projectName ? `${project.title || t("tasks:untitled-canvas")} · ${projectName}` : project.title || t("tasks:untitled-canvas"), value: project.id };
            }),
        [domainProjectNameById, projects],
    );
    const modelOptions = useMemo(() => Array.from(new Set(tasks.map((task) => formatModelName(effectiveConfig, task)).filter(Boolean))).sort((left, right) => left.localeCompare(right, "zh-CN")), [effectiveConfig, tasks]);
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

    const renderTaskGridCard = (task: GenerationTask) => <TaskGridCard key={task.id} task={task} actingId={actingId} onOpen={() => void openTaskDetail(task)} onRetry={() => void runAction(task.id)} />;

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
            .catch(() => undefined);
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
                if (showLoading) message.error(error instanceof Error ? error.message : t("tasks:failed-to-load-tasks"));
                return undefined;
            } finally {
                if (showLoading) setLoading(false);
            }
        },
        [message, syncCompletedCanvasTasks],
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
                if (await syncGenerationTaskToCanvasStore(detail)) message.success(t("tasks:synced-to-canvas"));
            } catch (error) {
                message.error(error instanceof Error ? error.message : t("tasks:failed-to-load-task-details"));
            } finally {
                setDetailLoading(false);
                setLogsLoading(false);
            }
        },
        [message],
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
        const currentTask = tasksRef.current.find((task) => task.id === id);
        if (currentTask && isGenerationTaskSubmissionUncertain(currentTask)) {
            message.warning(t("tasks:submission-result-is-unconfirmed-so-auto-retry-is-unavailable-verify-the"));
            return;
        }
        setActingId(id);
        try {
            const next = await retryGenerationTask(id);
            setTasks((items) => items.map((item) => (item.id === id ? next : item)));
            setDetailTask((current) => (current?.id === id ? { ...current, ...next } : current));
            setStatusFilter("active");
            setPage(1);
            message.success(t("tasks:task-re-queued"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("tasks:operation-failed"));
        } finally {
            setActingId("");
        }
    };

    const deleteLocalTask = (task: GenerationTask) => {
        if (task.status === "queued" || task.status === "running") {
            message.warning(t("tasks:task-is-running-its-local-record-cannot-be-deleted-wait-for-it-to-finish"));
            return;
        }
        Modal.confirm({
            title: t("tasks:delete-local-task-record"),
            content: t("tasks:this-removes-only-the-local-task-record-generated-assets-are-kept"),
            okText: t("tasks:delete-local-record-2"),
            okButtonProps: { danger: true },
            cancelText: t("tasks:keep"),
            onOk: async () => {
                setActingId(task.id);
                try {
                    await deleteGenerationTask(task.id);
                    setTasks((items) => items.filter((item) => item.id !== task.id));
                    if (detailTask?.id === task.id) setDetailTask(null);
                    message.success(t("tasks:local-task-record-deleted"));
                } catch (error) {
                    message.error(error instanceof Error ? error.message : t("tasks:deletion-failed"));
                } finally {
                    setActingId("");
                }
            },
        });
    };

    const refreshLocalTaskStatus = async (task: GenerationTask) => {
        setActingId(task.id);
        try {
            const next = await refreshGenerationTaskStatus(task.id);
            setTasks((items) => items.map((item) => (item.id === task.id ? { ...item, ...next } : item)));
            setDetailTask((current) => (current?.id === task.id ? { ...current, ...next } : current));
            message.success(next.officialStatus ? t("tasks:provider-status-param", { officialStatus: next.officialStatus }) : t("tasks:status-updated"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("tasks:failed-to-update-status"));
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
                message.info(result.providerStatus ? t("tasks:upstream-task-is-still-processing-param", { providerStatus: result.providerStatus }) : t("tasks:upstream-task-is-still-processing"));
                return;
            }
            setDetailTask(result.task);
            setTasks((items) => items.map((item) => (item.id === task.id ? { ...item, ...result.task } : item)));
            setTaskLogs(await listTaskLogs(task.id));
            await syncGenerationTaskToCanvasStore(result.task);
            window.dispatchEvent(new CustomEvent("wallet:updated"));
            void loadTasks(false);
            if (result.billingSettled) message.success(t("tasks:upstream-video-retrieved-task-recovered-and-settled"));
            else message.warning(t("tasks:upstream-video-retrieved-and-task-restored-billing-pending-admin-review"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("tasks:failed-to-query-upstream-task"));
        } finally {
            setActingId("");
        }
    };

    const submitTask = async () => {
        const values = await form.validateFields();
        setCreating(true);
        try {
            if (values.operation === "agent_session") {
                const textModel = values.model?.trim() || effectiveConfig.textModel || effectiveConfig.model;
                if (!isAiConfigReady(effectiveConfig, textModel)) {
                    message.error(t("tasks:configure-a-working-text-model-base-url-and-api-key-in-settings-first"));
                    return;
                }
                const requestConfig = resolveModelRequestConfig(effectiveConfig, textModel);
                const detail = await createAgentSession({
                    projectId: values.projectId,
                    prompt: values.prompt,
                    config: backendProviderConfig(requestConfig),
                    ...(logicalModelIDForConfig(requestConfig) ? { logicalModelId: logicalModelIDForConfig(requestConfig) } : {}),
                });
                setTasks((items) => [...detail.tasks, ...items]);
            } else {
                const videoModel = values.model?.trim() || effectiveConfig.videoModel || effectiveConfig.model;
                if (values.operation !== "compare_versions" && !isAiConfigReady(effectiveConfig, videoModel)) {
                    message.error(t("tasks:configure-a-working-video-model-base-url-and-api-key-in-settings-first"));
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
                        prompt: buildVideoOperationPrompt(values.operation, values.prompt),
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
            message.success(t("tasks:task-created"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("tasks:failed-to-create-task"));
        } finally {
            setCreating(false);
        }
    };

    return (
        <>
            <WorkspacePage grid className="library-page task-library-page">
                <div className="studio-band">
                    <ListToolbar
                        className="library-toolbar task-library-toolbar"
                        active={Boolean(keyword || projectFilter !== "all" || kindFilter !== "all" || modelFilter !== "all" || statusFilter !== "all")}
                        onReset={() => {
                            setKeyword("");
                            setProjectFilter("all");
                            setKindFilter("all");
                            setModelFilter("all");
                            setStatusFilter("all");
                            setPage(1);
                        }}
                        trailing={
                            <div className="flex flex-wrap items-center gap-2.5">
                                {viewMode === "list" ? (
                                    <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-foreground/55">
                                        <Switch size="small" checked={groupEnabled} onChange={changeGroupEnabled} />
                                        <span>{t("tasks:group-by-canvas")}</span>
                                    </label>
                                ) : null}
                                <div className="task-view-switch" role="group" aria-label={t("tasks:task-view")}>
                                    <Tooltip title={t("tasks:list-view")}>
                                        <Button
                                            type={viewMode === "list" ? "primary" : "text"}
                                            size="small"
                                            aria-label={t("tasks:list-view")}
                                            aria-pressed={viewMode === "list"}
                                            icon={<List className="size-3.5" />}
                                            onClick={() => changeViewMode("list")}
                                        />
                                    </Tooltip>
                                    <Tooltip title={t("tasks:grid-view")}>
                                        <Button
                                            type={viewMode === "grid" ? "primary" : "text"}
                                            size="small"
                                            aria-label={t("tasks:grid-view")}
                                            aria-pressed={viewMode === "grid"}
                                            icon={<LayoutGrid className="size-3.5" />}
                                            onClick={() => changeViewMode("grid")}
                                        />
                                    </Tooltip>
                                </div>
                            </div>
                        }
                    >
                        <TaskStatusFilterBar
                            stats={taskStats}
                            value={statusFilter}
                            onChange={(value) => {
                                setStatusFilter(value);
                                setPage(1);
                            }}
                        />
                        <Input
                            id="task-search"
                            name="taskSearch"
                            allowClear
                            className="app-list-search"
                            prefix={<Search className="size-4 text-foreground/40" />}
                            value={keyword}
                            placeholder={t("tasks:search-tasks-models-or-canvases")}
                            onChange={(event) => {
                                setKeyword(event.target.value);
                                setPage(1);
                            }}
                        />
                        <Select
                            className="w-full sm:w-48"
                            value={projectFilter}
                            onChange={(value) => {
                                setProjectFilter(value);
                                setPage(1);
                            }}
                            options={[{ label: t("tasks:all-canvases"), value: "all" }, ...projectOptions]}
                        />
                        <Select
                            className="w-full sm:w-32"
                            value={kindFilter}
                            onChange={(value) => {
                                setKindFilter(value as TaskKindFilter);
                                setPage(1);
                            }}
                            options={[
                                { label: t("tasks:all-types"), value: "all" },
                                { label: t("tasks:text"), value: "text" },
                                { label: t("tasks:image"), value: "image" },
                                { label: t("tasks:video"), value: "video" },
                            ]}
                        />
                        <Select
                            className="w-full sm:w-44"
                            value={modelFilter}
                            onChange={(value) => {
                                setModelFilter(value);
                                setPage(1);
                            }}
                            options={[{ label: t("tasks:all-models"), value: "all" }, ...modelOptions.map((model) => ({ label: model, value: model }))]}
                        />
                    </ListToolbar>
                </div>

                <div className="canvas-library-frame task-library-frame">
                    {loading && !tasks.length ? (
                        <div className="library-loading-grid" aria-label={t("tasks:loading-tasks")}>
                            {Array.from({ length: 8 }, (_, index) => (
                                <div key={index} className="library-skeleton" />
                            ))}
                        </div>
                    ) : null}
                    {!loading || tasks.length ? (
                        visibleTasks.length ? (
                            viewMode === "grid" ? (
                                <div className="task-grid-view">{visibleTasks.map(renderTaskGridCard)}</div>
                            ) : groupingActive ? (
                                <div className="task-group-list">
                                    {visibleTaskGroups.map((group) => (
                                        <section key={group.key} className="task-group">
                                            <TaskGroupHeader group={group} retrying={retryingGroup === group.key} onRetryFailed={() => void retryGroupTasks(group.key, group.tasks)} />
                                            <div className="task-record-list">{group.tasks.map(renderTaskRow)}</div>
                                        </section>
                                    ))}
                                </div>
                            ) : (
                                <div className="task-record-list">{visibleTasks.map(renderTaskRow)}</div>
                            )
                        ) : (
                            <WorkspaceState
                                compact
                                title={taskEmptyState(statusFilter).title}
                                description={taskEmptyState(statusFilter).description}
                                action={
                                    <Button className="library-primary-action" type="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreateOpen(true)}>
                                        {t("tasks:new-task-2")}
                                    </Button>
                                }
                            />
                        )
                    ) : null}
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
            <Modal className="library-modal" title={t("tasks:create-an-async-generation-task")} open={createOpen} onCancel={() => setCreateOpen(false)} onOk={submitTask} confirmLoading={creating} okText={t("tasks:create-task")}>
                <Form form={form} layout="vertical" initialValues={{ operation: "agent_session" }}>
                    <Form.Item name="operation" label={t("tasks:task-type")} rules={[{ required: true, message: t("tasks:choose-a-task-type") }]}>
                        <Select options={operationOptions} />
                    </Form.Item>
                    <Form.Item name="prompt" label={t("tasks:creative-brief")} rules={[{ required: true, message: t("tasks:enter-a-creative-brief") }]}>
                        <Input.TextArea rows={5} placeholder={t("tasks:describe-a-short-drama-music-video-tvc-or-a-video-editing-operation")} />
                    </Form.Item>
                    <Form.Item name="projectId" label={t("tasks:linked-canvas")}>
                        <Select allowClear showSearch optionFilterProp="label" options={projectOptions} placeholder={projectOptions.length ? t("tasks:optional-choose-a-canvas-to-link") : t("tasks:no-local-canvases")} />
                    </Form.Item>
                    <Form.Item name="model" label={t("tasks:target-model")}>
                        <Input placeholder={t("tasks:optional-e-g-seedance-kling-wan-nano-banana")} />
                    </Form.Item>
                </Form>
            </Modal>
            <Drawer className="library-drawer" title={t("tasks:task-details")} open={Boolean(detailTask)} onClose={() => setDetailTask(null)} size="large" destroyOnHidden>
                {detailTask ? (
                    <div className="space-y-5">
                        <div className="task-detail-facts grid text-sm sm:grid-cols-2">
                            <InfoItem label={t("tasks:status")} value={statusLabel[detailTask.status]} />
                            <InfoItem label={t("tasks:canvas-name")} value={getTaskCanvasContext(detailTask, canvasById, domainProjectNameById).canvasName} />
                            <InfoItem label={t("tasks:task-type")} value={formatTaskKind(detailTask)} />
                            <InfoItem label={t("tasks:models")} value={formatModelName(effectiveConfig, detailTask)} />
                            <InfoItem label={t("tasks:attempts")} value={t("tasks:attempts-value", { count: detailTask.attempts || 1 })} />
                            <InfoItem label={t("tasks:created-at")} value={formatDate(detailTask.createdAt)} />
                            <InfoItem label={t("tasks:started-at")} value={formatDate(detailTask.startedAt)} />
                            <InfoItem label={t("tasks:finished-at")} value={formatDate(detailTask.completedAt)} />
                            <InfoItem label={t("tasks:duration")} value={formatTaskDuration(detailTask)} />
                            {detailTask.providerCancelStatus ? <InfoItem label={t("tasks:upstream-cancellation")} value={providerCancelStatusLabel(detailTask)} /> : null}
                            {detailTask.providerCancelRequestedAt ? <InfoItem label={t("tasks:cancellation-requested-at")} value={formatDate(detailTask.providerCancelRequestedAt)} /> : null}
                        </div>
                        {detailTask.provider === "dreamina-cli" ? <p className="text-xs leading-5 text-foreground/60">{t("tasks:official-status-is-eventually-consistent-via-polling-background-waits-co")}</p> : null}
                        <div className="flex flex-wrap justify-end gap-2">
                            {detailTask.provider === "dreamina-cli" && detailTask.receiptRecorded && detailTask.status === "running" ? (
                                <Button aria-label={t("tasks:refresh-official-status-2")} icon={<RefreshCw className="size-4" />} loading={actingId === detailTask.id} onClick={() => void refreshLocalTaskStatus(detailTask)}>
                                    {t("tasks:refresh-official-status-2")}
                                </Button>
                            ) : null}
                            {detailTask.provider === "dreamina-cli" ? (
                                <Button danger aria-label={t("tasks:delete-local-record-2")} icon={<Trash2 className="size-4" />} loading={actingId === detailTask.id} onClick={() => deleteLocalTask(detailTask)}>
                                    {t("tasks:delete-local-record-2")}
                                </Button>
                            ) : null}
                            {canQueryProviderTask(detailTask) ? (
                                <Button icon={<RefreshCw className="size-4" />} loading={actingId === detailTask.id} onClick={() => void queryProviderTask(detailTask)}>
                                    {t("tasks:query-task-manually")}
                                </Button>
                            ) : null}
                        </div>
                        {detailTask.error ? <pre className="task-detail-error max-h-28 overflow-auto whitespace-pre-wrap px-3 py-2 text-xs">{generationErrorMessage(detailTask.error)}</pre> : null}
                        <TaskResultMedia value={detailTask.resultJson} taskType={detailTask.type} />
                        <DetailBlock title={t("tasks:prompt")} value={detailLoading ? t("tasks:loading-details") : detailTask.prompt || t("tasks:none")} tall />
                        <TaskParameters inputJson={detailLoading ? undefined : detailTask.inputJson} />
                        <DetailBlock title={t("tasks:result")} value={detailLoading ? t("tasks:loading-details") : formatTaskJson(detailTask.resultJson)} />
                        <div>
                            <Typography.Text strong>{t("tasks:logs")}</Typography.Text>
                            <div className="mt-2 max-h-60 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
                                {logsLoading ? t("tasks:loading-logs") : taskLogs.length ? taskLogs.map((log) => `[${new Date(log.createdAt).toLocaleString()}] ${log.level.toUpperCase()} ${formatTaskLog(log)}`).join("\n\n") : t("tasks:no-logs-yet")}
                            </div>
                        </div>
                    </div>
                ) : null}
            </Drawer>
            <Modal
                title={<span className="block truncate pr-8">{mediaPreview?.title || t("tasks:result-preview")}</span>}
                open={Boolean(mediaPreview)}
                onCancel={() => setMediaPreview(null)}
                footer={null}
                centered
                width="min(1040px, calc(100vw - 32px))"
                destroyOnHidden
                className="library-modal task-media-preview-modal"
            >
                {mediaPreview ? (
                    <MediaPreview
                        src={mediaPreview.url}
                        kind={mediaPreview.kind}
                        alt={mediaPreview.title}
                        controls={mediaPreview.kind === "video"}
                        className="max-h-[76vh] w-full bg-black object-contain"
                        fallbackClassName="task-media-preview-unavailable"
                    />
                ) : null}
            </Modal>
        </>
    );
}

function canQueryProviderTask(task: GenerationTask) {
    return task.status === "failed" && (task.type.startsWith("canvas_video") || task.type.startsWith("video_")) && Boolean(task.providerRequestId);
}

function reconcileTaskSummaries(current: GenerationTask[], next: GenerationTask[]) {
    if (current.length === 0) return next;
    const currentById = new Map(current.map((task) => [task.id, task]));
    let changed = false;
    const reconciled = next.map((task) => {
        const previous = currentById.get(task.id);
        if (previous?.updatedAt === task.updatedAt && previous.previewUrl === task.previewUrl && previous.billing?.status === task.billing?.status && previous.billing?.amountMicrocredits === task.billing?.amountMicrocredits) return previous;
        changed = true;
        return task;
    });
    return changed ? reconciled : current;
}

function TaskResultMedia({ value, taskType }: { value?: string; taskType: string }) {
    const { t } = useTranslation("canvas");
    const urls = resultMediaUrls(value);
    if (!urls.length) return null;
    return (
        <div>
            <Typography.Text strong>{t("tasks:generation-result")}</Typography.Text>
            <div className="mt-2 grid max-h-[360px] grid-cols-2 gap-2 overflow-auto rounded-lg bg-stone-950 p-2 md:grid-cols-3">
                {urls.map((url, index) => {
                    const isVideo = isVideoResult(url, taskType);
                    return (
                        <MediaPreview
                            key={`${url}-${index}`}
                            src={url}
                            kind={isVideo ? "video" : "image"}
                            alt={t("tasks:generation-result-index", { index: index + 1 })}
                            controls={isVideo}
                            className={isVideo ? "task-result-media is-video" : "task-result-media"}
                            fallbackClassName={isVideo ? "task-result-media is-video" : "task-result-media"}
                        />
                    );
                })}
            </div>
        </div>
    );
}

function resultMediaUrls(value?: string) {
    if (!value) return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        parsed = value;
    }
    const urls: string[] = [];
    const visit = (item: unknown, key = "") => {
        if (typeof item === "string") {
            const isInlineMedia = /^(data:image\/|data:video\/)/.test(item);
            const isMediaPath = /\.(png|jpe?g|webp|gif|avif|mp4|webm|mov)(?:$|\?)/i.test(item);
            const isNamedMediaUrl = /^(https?:|blob:)/.test(item) && /(url|image|video|result|output|media)/i.test(key);
            if ((isInlineMedia || isMediaPath || isNamedMediaUrl) && !urls.includes(item)) urls.push(item);
            return;
        }
        if (Array.isArray(item)) return item.forEach((value) => visit(value, key));
        if (item && typeof item === "object") Object.entries(item).forEach(([field, value]) => visit(value, field));
    };
    visit(parsed);
    return urls.slice(0, 12);
}

function isVideoResult(value: string, taskType: string) {
    return value.startsWith("data:video/") || /\.(mp4|webm|mov)(?:$|\?)/i.test(value) || taskType.includes("video");
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
    if (status === "all") return { title: translate("tasks:no-tasks-yet"), description: translate("tasks:new-submissions-show-their-status-and-live-progress-here") };
    if (status === "active") return { title: translate("tasks:no-running-tasks"), description: translate("tasks:new-submissions-show-their-queue-position-and-live-progress-here") };
    if (status === "succeeded") return { title: translate("tasks:no-finished-tasks-yet"), description: translate("tasks:after-success-result-previews-and-execution-records-stay-here") };
    return { title: translate("tasks:no-failed-or-cancelled-tasks"), description: translate("tasks:failed-or-cancelled-generations-appear-here-with-reasons-and-available-a") };
}

function formatDate(value?: string) {
    if (!value) return "-";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function formatTaskDuration(task: GenerationTask) {
    if (!task.createdAt) return "-";
    const start = new Date(task.startedAt || task.createdAt).getTime();
    const end = task.completedAt ? new Date(task.completedAt).getTime() : task.status === "queued" || task.status === "running" ? Date.now() : Number.NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "-";
    const totalSeconds = Math.max(0, Math.floor((end - start) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes ? translate("tasks:paramm-params", { minutes: minutes, seconds: seconds }) : translate("tasks:params", { seconds: seconds });
}

function InfoItem({ label, value, wrap = false }: { label: string; value: string; wrap?: boolean }) {
    return (
        <div className="task-detail-fact min-w-0 px-3 py-2.5">
            <Typography.Text type="secondary" className="block text-xs">
                {label}
            </Typography.Text>
            <Typography.Text className={`block text-sm ${wrap ? "whitespace-pre-wrap break-words" : "truncate"}`} title={value}>
                {value}
            </Typography.Text>
        </div>
    );
}

function DetailBlock({ title, value, tall = false }: { title: string; value: string; tall?: boolean }) {
    return (
        <div>
            <Typography.Text strong>{title}</Typography.Text>
            <pre className={`mt-2 overflow-auto rounded-md bg-slate-950 p-3 text-xs leading-5 text-slate-100 ${tall ? "h-40 whitespace-pre-wrap break-words" : "max-h-60"}`}>{value}</pre>
        </div>
    );
}

function TaskParameters({ inputJson }: { inputJson?: string }) {
    const { t } = useTranslation("canvas");
    const fields = taskParameterFields(inputJson);
    return (
        <div>
            <Typography.Text strong>{t("tasks:parameters")}</Typography.Text>
            {fields.length ? (
                <div className="task-detail-facts mt-2 grid text-sm sm:grid-cols-2">
                    {fields.map((field) => (
                        <InfoItem key={field.label} label={field.label} value={field.value} wrap />
                    ))}
                </div>
            ) : (
                <div className="mt-2 rounded-md bg-foreground/[.04] px-3 py-3 text-sm text-foreground/50">{t("tasks:no-parameters-recorded")}</div>
            )}
        </div>
    );
}

function taskParameterFields(inputJson?: string) {
    const input = parseTaskInput(inputJson);
    if (!input) return [];
    const config = asRecord(input.config);
    const fields: Array<{ label: string; value: string }> = [];
    const add = (label: string, value: unknown) => {
        const text = formatParameterValue(value);
        if (text) fields.push({ label, value: text });
    };

    add(translate("tasks:mode"), input.mode);
    add(translate("tasks:size-ratio"), config.size);
    add(translate("tasks:resolution"), config.vquality || config.quality);
    add(translate("tasks:duration-2"), config.videoSeconds === undefined ? undefined : translate("tasks:params-2", { videoSeconds: config.videoSeconds }));
    add(translate("tasks:generation-count"), config.count);
    add(translate("tasks:generate-audio"), booleanParameter(config.videoGenerateAudio));
    add(translate("tasks:watermark"), booleanParameter(config.videoWatermark));
    add(translate("tasks:voice"), config.audioVoice);
    add(translate("tasks:audio-format"), config.audioFormat);
    add(translate("tasks:audio-speed"), config.audioSpeed);

    add(translate("tasks:reference-images"), formatReferenceList(input.referenceImages, translate("tasks:image")));
    add(translate("tasks:reference-videos"), formatReferenceList(input.referenceVideos, translate("tasks:video")));
    add(translate("tasks:reference-audio"), formatReferenceList(input.referenceAudios, translate("tasks:audio")));
    add(translate("tasks:mask-image"), formatReferenceList(input.mask ? [input.mask] : [], translate("tasks:mask")));
    return fields;
}

function parseTaskInput(value?: string): Record<string, unknown> | null {
    if (!value) return null;
    try {
        const parsed: unknown = JSON.parse(value);
        return asRecord(parsed);
    } catch {
        return null;
    }
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function formatParameterValue(value: unknown) {
    if (value === undefined || value === null || value === "") return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return "";
}

function booleanParameter(value: unknown) {
    if (value === true || value === "true") return translate("tasks:yes");
    if (value === false || value === "false") return translate("tasks:no");
    return undefined;
}

function formatReferenceList(value: unknown, kind: string) {
    if (!Array.isArray(value) || !value.length) return translate("tasks:none");
    return value
        .map((item, index) => {
            const reference = asRecord(item);
            const name = typeof reference.name === "string" && reference.name.trim() && !/^https?:|^data:|^blob:/i.test(reference.name) ? reference.name.trim() : `${kind}${index + 1}`;
            const dimensions = typeof reference.width === "number" && typeof reference.height === "number" ? `${reference.width}×${reference.height}` : "";
            const duration = typeof reference.durationMs === "number" && reference.durationMs > 0 ? `${Math.round(reference.durationMs / 100) / 10}s` : "";
            const details = [dimensions, duration].filter(Boolean).join("，");
            return details ? `${name}（${details}）` : name;
        })
        .join("、");
}

function formatTaskJson(value?: string) {
    if (!value) return translate("tasks:none");
    try {
        return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
        return value;
    }
}

function buildVideoOperationPrompt(operation: string, prompt: string) {
    const operationLabel = operationOptions.find((item) => item.value === operation)?.label || translate("tasks:other-video-operations");
    if (operation === "compare_versions") return translate("tasks:compare-the-video-versions-below-and-give-a-recommendation-key-differenc", { prompt: prompt });
    return translate("tasks:video-editing-task-param-creative-brief-param", { operationLabel: operationLabel, prompt: prompt });
}
