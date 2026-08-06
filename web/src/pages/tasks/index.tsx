import { App, Button, Drawer, Form, Input, Modal, Segmented, Select, Tooltip, Typography } from "antd";
import { Coins, Eye, FileText, FolderKanban, Image as ImageIcon, Play, Plus, RefreshCw, RotateCcw, Search, Video, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import { ListToolbar, PageHeader, PaginationBar, WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceState } from "@/components/layout/workspace-state";
import { CONTENT_MODERATION_ERROR_CODE, generationErrorMessage, isContentModerationError } from "@/lib/generation-error";
import { formatTaskKind, operationOptions, statusLabel } from "@/lib/generation-task-display";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";

import { cancelGenerationTask, createAgentSession, createGenerationTask, listGenerationTasks, listTaskLogs, queryFailedVideoProviderTask, queryGenerationTask, retryGenerationTask, type CreateTaskInput, type GenerationTask, type TaskLog, type TaskStatus } from "@/services/api/task-center";
import { syncGenerationTaskToCanvasStore } from "@/lib/canvas/canvas-generation-task-sync";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { modelDisplayName, resolveModelRequestConfig, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { formatCredits } from "@/constant/credits";
import { listProjects, type ProjectSummary } from "@/services/api/projects";

type TaskStatusFilter = "all" | "failed" | "active" | "succeeded";
type TaskKindFilter = "all" | "text" | "image" | "video";

function taskStatusFilter(value: string | null): TaskStatusFilter {
    return value === "failed" || value === "active" || value === "succeeded" ? value : "all";
}

export default function TasksPage() {
    const { message } = App.useApp();
    const [searchParams, setSearchParams] = useSearchParams();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const projects = useCanvasStore((state) => state.projects);
    const shortDramaEnabled = useUserStore((state) => state.features.shortDramaEnabled);
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const [form] = Form.useForm<CreateTaskInput & { operation: string }>();
    const [tasks, setTasks] = useState<GenerationTask[]>([]);
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
    const [detailTask, setDetailTask] = useState<GenerationTask | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [taskLogs, setTaskLogs] = useState<TaskLog[]>([]);
    const [logsLoading, setLogsLoading] = useState(false);
    const [mediaPreview, setMediaPreview] = useState<{ url: string; kind: "image" | "video"; title: string } | null>(null);
    const syncedCanvasTaskIdsRef = useRef(new Set<string>());
    const tasksRef = useRef<GenerationTask[]>([]);

    const canvasById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
    const domainProjectNameById = useMemo(() => new Map(domainProjects.map((item) => [item.project.id, item.project.name])), [domainProjects]);
    const projectOptions = useMemo(() => projects.map((project) => {
        const projectName = project.projectId ? domainProjectNameById.get(project.projectId) : "";
        return { label: projectName ? `${project.title || "未命名画布"} · ${projectName}` : project.title || "未命名画布", value: project.id };
    }), [domainProjectNameById, projects]);
    const modelOptions = useMemo(() => Array.from(new Set(tasks.map((task) => formatModelName(effectiveConfig, task)).filter(Boolean))).sort((left, right) => left.localeCompare(right, "zh-CN")), [effectiveConfig, tasks]);
    const filteredTasks = useMemo(() => tasks.filter((task) => {
        if (statusFilter === "all") return true;
        if (statusFilter === "active") return task.status === "queued" || task.status === "running";
        if (statusFilter === "failed") return task.status === "failed" || task.status === "cancelled";
        if (statusFilter === "succeeded") return task.status === "succeeded";
        return false;
    }).filter((task) => {
        if (projectFilter !== "all" && task.projectId !== projectFilter) return false;
        if (kindFilter !== "all" && taskMediaKind(task) !== kindFilter) return false;
        if (modelFilter !== "all" && formatModelName(effectiveConfig, task) !== modelFilter) return false;
        const query = keyword.trim().toLowerCase();
        const context = getTaskCanvasContext(task, canvasById, domainProjectNameById);
        return !query || `${task.prompt} ${task.model || ""} ${formatTaskKind(task)} ${context.canvasName} ${context.projectName}`.toLowerCase().includes(query);
    }), [canvasById, domainProjectNameById, effectiveConfig, keyword, kindFilter, modelFilter, projectFilter, statusFilter, tasks]);
    const visibleTasks = useMemo(() => filteredTasks.slice((page - 1) * pageSize, page * pageSize), [filteredTasks, page, pageSize]);

    useEffect(() => {
        if (!shortDramaEnabled) {
            setDomainProjects([]);
            return;
        }
        let cancelled = false;
        void listProjects().then((result) => {
            if (!cancelled) setDomainProjects(result.projects);
        }).catch(() => undefined);
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

    const loadTasks = useCallback(async (showLoading = false) => {
        if (showLoading) setLoading(true);
        try {
            const next = await listGenerationTasks();
            setTasks((current) => reconcileTaskSummaries(current, next));
            void syncCompletedCanvasTasks(next);
            return next;
        } catch (error) {
            if (showLoading) message.error(error instanceof Error ? error.message : "任务加载失败");
            return undefined;
        } finally {
            if (showLoading) setLoading(false);
        }
    }, [message, syncCompletedCanvasTasks]);

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
                if (await syncGenerationTaskToCanvasStore(detail)) message.success("已同步到画布");
            } catch (error) {
                message.error(error instanceof Error ? error.message : "任务详情加载失败");
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

    const runAction = async (id: string, action: "retry" | "cancel") => {
        setActingId(id);
        try {
            const next = action === "retry" ? await retryGenerationTask(id) : await cancelGenerationTask(id);
            setTasks((items) => items.map((item) => (item.id === id ? next : item)));
            if (action === "retry") {
                setStatusFilter("active");
                setPage(1);
            }
            if (action === "retry") message.success("任务已重新入队");
            else if (next.providerCancelStatus === "requested") message.info("已请求上游取消，正在确认费用状态");
            else if (next.providerCancelStatus === "confirmed") message.success("上游已确认取消，积分已退回");
            else if (next.providerCancelStatus === "uncertain") message.warning("任务已取消，上游费用待核对");
            else message.success("任务已取消，积分已退回");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "操作失败");
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
                message.info(`上游任务仍在处理中${result.providerStatus ? `（${result.providerStatus}）` : ""}`);
                return;
            }
            setDetailTask(result.task);
            setTasks((items) => items.map((item) => (item.id === task.id ? { ...item, ...result.task } : item)));
            setTaskLogs(await listTaskLogs(task.id));
            await syncGenerationTaskToCanvasStore(result.task);
            window.dispatchEvent(new CustomEvent("wallet:updated"));
            void loadTasks(false);
            if (result.billingSettled) message.success("已获取上游视频，任务已恢复并完成结算");
            else message.warning("已获取上游视频，任务已恢复，计费状态待管理员核对");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "查询上游任务失败");
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
                    message.error("请先在设置里配置可用的文本模型、Base URL 和 API Key");
                    return;
                }
                const requestConfig = resolveModelRequestConfig(effectiveConfig, textModel);
                const detail = await createAgentSession({ projectId: values.projectId, prompt: values.prompt, config: backendProviderConfig(requestConfig) });
                setTasks((items) => [...detail.tasks, ...items]);
            } else {
                const videoModel = values.model?.trim() || effectiveConfig.videoModel || effectiveConfig.model;
                if (values.operation !== "compare_versions" && !isAiConfigReady(effectiveConfig, videoModel)) {
                    message.error("请先在设置里配置可用的视频模型、Base URL 和 API Key");
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
            message.success("任务已创建");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "任务创建失败");
        } finally {
            setCreating(false);
        }
    };

    return (
        <>
            <WorkspacePage grid className="library-page task-library-page">
                <PageHeader
                    icon="tasks"
                    title="任务中心"
                    meta={<span className="text-xs text-foreground/45">{filteredTasks.length} 个任务{loading ? " · 正在同步" : ""}</span>}
                        actions={(
                            <>
                            <Button icon={<RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />} onClick={() => void loadTasks(true)}>刷新</Button>
                            <Button className="library-primary-action" type="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreateOpen(true)}>新建任务</Button>
                            </>
                        )}
                />
                <ListToolbar className="library-toolbar task-library-toolbar" active={Boolean(keyword || projectFilter !== "all" || kindFilter !== "all" || modelFilter !== "all" || statusFilter !== "all")} onReset={() => { setKeyword(""); setProjectFilter("all"); setKindFilter("all"); setModelFilter("all"); setStatusFilter("all"); setPage(1); }}>
                    <Input id="task-search" name="taskSearch" allowClear className="app-list-search" prefix={<Search className="size-4 text-foreground/40" />} value={keyword} placeholder="搜索任务、模型或画布" onChange={(event) => { setKeyword(event.target.value); setPage(1); }} />
                    <Select className="w-full sm:w-48" value={projectFilter} onChange={(value) => { setProjectFilter(value); setPage(1); }} options={[{ label: "全部画布", value: "all" }, ...projectOptions]} />
                    <Select className="w-full sm:w-32" value={kindFilter} onChange={(value) => { setKindFilter(value as TaskKindFilter); setPage(1); }} options={[{ label: "全部类型", value: "all" }, { label: "文本", value: "text" }, { label: "图片", value: "image" }, { label: "视频", value: "video" }]} />
                    <Select className="w-full sm:w-44" value={modelFilter} onChange={(value) => { setModelFilter(value); setPage(1); }} options={[{ label: "全部模型", value: "all" }, ...modelOptions.map((model) => ({ label: model, value: model }))]} />
                    <Segmented
                        size="small"
                        value={statusFilter}
                        onChange={(value) => { setStatusFilter(value as typeof statusFilter); setPage(1); }}
                        options={[
                            { label: "全部", value: "all" },
                            { label: "待处理", value: "failed" },
                            { label: "运行中", value: "active" },
                            { label: "已完成", value: "succeeded" },
                        ]}
                    />
                </ListToolbar>

                {loading && !tasks.length ? <div className="library-loading-grid" aria-label="正在加载任务">{Array.from({ length: 8 }, (_, index) => <div key={index} className="library-skeleton" />)}</div> : null}
                {!loading || tasks.length ? (
                    visibleTasks.length ? <div className="task-record-list">{visibleTasks.map((task) => <TaskListRow key={task.id} task={task} canvasById={canvasById} projectNameById={domainProjectNameById} effectiveConfig={effectiveConfig} creditsEnabled={creditsEnabled} actingId={actingId} onOpen={() => void openTaskDetail(task)} onRetry={() => void runAction(task.id, "retry")} onCancel={() => void runAction(task.id, "cancel")} onPreview={() => task.previewUrl && setMediaPreview({ url: task.previewUrl, kind: task.previewKind === "video" ? "video" : "image", title: task.prompt || formatTaskKind(task) })} />)}</div> : <WorkspaceState compact title={taskEmptyState(statusFilter).title} description={taskEmptyState(statusFilter).description} />
                ) : null}
                <PaginationBar current={page} pageSize={pageSize} total={filteredTasks.length} pageSizeOptions={[20, 50, 100]} onChange={(nextPage, nextPageSize) => { setPage(nextPageSize !== pageSize ? 1 : nextPage); setPageSize(nextPageSize); }} />
            </WorkspacePage>
            <Modal className="library-modal" title="新建异步生成任务" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={submitTask} confirmLoading={creating} okText="创建任务">
                <Form form={form} layout="vertical" initialValues={{ operation: "agent_session" }}>
                    <Form.Item name="operation" label="任务类型" rules={[{ required: true, message: "请选择任务类型" }]}>
                        <Select options={operationOptions} />
                    </Form.Item>
                    <Form.Item name="prompt" label="创作指令" rules={[{ required: true, message: "请输入创作指令" }]}>
                        <Input.TextArea rows={5} placeholder="描述短剧、MV、TVC 或要执行的视频编辑操作" />
                    </Form.Item>
                    <Form.Item name="projectId" label="绑定画布">
                        <Select allowClear showSearch optionFilterProp="label" options={projectOptions} placeholder={projectOptions.length ? "可选，选择要绑定的画布" : "暂无本地画布"} />
                    </Form.Item>
                    <Form.Item name="model" label="目标模型">
                        <Input placeholder="可选，例如 seedance、kling、wan、nano-banana" />
                    </Form.Item>
                </Form>
            </Modal>
            <Drawer className="library-drawer" title="任务详情" open={Boolean(detailTask)} onClose={() => setDetailTask(null)} size="large" destroyOnHidden>
                {detailTask ? (
                    <div className="space-y-5">
                        <div className="grid border-y border-border text-sm sm:grid-cols-2">
                            <InfoItem label="状态" value={statusLabel[detailTask.status]} />
                            <InfoItem label="画布名称" value={getTaskCanvasContext(detailTask, canvasById, domainProjectNameById).canvasName} />
                            <InfoItem label="任务类型" value={formatTaskKind(detailTask)} />
                            <InfoItem label="模型" value={formatModelName(effectiveConfig, detailTask)} />
                            <InfoItem label="尝试次数" value={`第 ${detailTask.attempts || 1} 次`} />
                            <InfoItem label="创建时间" value={formatDate(detailTask.createdAt)} />
                            {detailTask.providerCancelStatus ? <InfoItem label="上游取消" value={providerCancelStatusLabel(detailTask)} /> : null}
                            {detailTask.providerCancelRequestedAt ? <InfoItem label="请求取消时间" value={formatDate(detailTask.providerCancelRequestedAt)} /> : null}
                        </div>
                        {canQueryProviderTask(detailTask) ? <div className="flex justify-end"><Button icon={<RefreshCw className="size-4" />} loading={actingId === detailTask.id} onClick={() => void queryProviderTask(detailTask)}>手动查询任务</Button></div> : null}
                        {detailTask.error ? <pre className="max-h-28 overflow-auto whitespace-pre-wrap border-l-2 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">{generationErrorMessage(detailTask.error)}</pre> : null}
                        <TaskResultMedia value={detailTask.resultJson} taskType={detailTask.type} />
                        <DetailBlock title="输入" value={detailLoading ? "详情加载中..." : formatTaskJson(detailTask.inputJson)} />
                        <DetailBlock title="结果" value={detailLoading ? "详情加载中..." : formatTaskJson(detailTask.resultJson)} />
                        <div>
                            <Typography.Text strong>日志</Typography.Text>
                            <div className="mt-2 max-h-60 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
                                {logsLoading ? "日志加载中..." : taskLogs.length ? taskLogs.map((log) => `[${new Date(log.createdAt).toLocaleString()}] ${log.level.toUpperCase()} ${log.message}${log.payload ? `\n${generationErrorMessage(log.payload)}` : ""}`).join("\n\n") : "暂无日志"}
                            </div>
                        </div>
                    </div>
                ) : null}
            </Drawer>
            <Modal
                title={<span className="block truncate pr-8">{mediaPreview?.title || "生成结果预览"}</span>}
                open={Boolean(mediaPreview)}
                onCancel={() => setMediaPreview(null)}
                footer={null}
                centered
                width="min(1040px, calc(100vw - 32px))"
                destroyOnHidden
                className="library-modal task-media-preview-modal"
            >
                {mediaPreview?.kind === "video"
                    ? <video src={mediaPreview.url} className="max-h-[76vh] w-full bg-black object-contain" controls playsInline preload="metadata" />
                    : mediaPreview ? <img src={mediaPreview.url} alt={mediaPreview.title} className="max-h-[76vh] w-full bg-black object-contain" /> : null}
            </Modal>
        </>
    );
}

function canQueryProviderTask(task: GenerationTask) {
    return task.status === "failed" && (task.type.startsWith("canvas_video") || task.type.startsWith("video_")) && Boolean(task.providerRequestId);
}

function reconcileTaskSummaries(current: GenerationTask[], next: GenerationTask[]) {
    if (current.length !== next.length) return next;
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
    const urls = resultMediaUrls(value);
    if (!urls.length) return null;
    return (
        <div>
            <Typography.Text strong>生成结果</Typography.Text>
            <div className="mt-2 grid max-h-[360px] grid-cols-2 gap-2 overflow-auto rounded-lg bg-stone-950 p-2 md:grid-cols-3">
                {urls.map((url, index) => isVideoResult(url, taskType)
                    ? <video key={`${url}-${index}`} src={url} className="aspect-video w-full rounded-md bg-black object-contain" controls preload="metadata" />
                    : <img key={`${url}-${index}`} src={url} alt={`生成结果 ${index + 1}`} className="aspect-square w-full rounded-md bg-black object-contain" />)}
            </div>
        </div>
    );
}

function TaskListRow({ task, canvasById, projectNameById, effectiveConfig, creditsEnabled, actingId, onOpen, onRetry, onCancel, onPreview }: {
    task: GenerationTask;
    canvasById: Map<string, { title: string; projectId?: string }>;
    projectNameById: Map<string, string>;
    effectiveConfig: AiConfig;
    creditsEnabled: boolean;
    actingId: string;
    onOpen: () => void;
    onRetry: () => void;
    onCancel: () => void;
    onPreview: () => void;
}) {
    const context = getTaskCanvasContext(task, canvasById, projectNameById);
    const isActive = task.status === "queued" || task.status === "running";
    const isFailed = task.status === "failed" || task.status === "cancelled";
    return (
        <article className={`task-record-row group${isFailed ? " is-attention" : ""}`}>
            <TaskPreviewThumbnail task={task} onOpen={onPreview} />
            <div className="task-record-main">
                <div className="task-record-heading">
                    <span className={`task-record-status ${isFailed ? "is-failed" : isActive ? "is-active" : "is-success"}`}><i className={statusDotClassName(task.status)} />{statusLabel[task.status]}</span>
                    <button type="button" className="task-record-title" title={task.prompt} onClick={onOpen}>{task.prompt || "未命名任务"}</button>
                </div>
                <div className="task-record-meta"><span>{formatTaskKind(task)}</span><span aria-hidden="true">·</span><span>{formatModelName(effectiveConfig, task)}</span><span className="task-record-meta-canvas"><FolderKanban className="size-3" />{context.canvasName}{context.projectName ? ` · ${context.projectName}` : ""}</span></div>
                {isActive ? <div className="task-record-progress"><span>{task.stage || "正在生成"}</span><span>{task.progress || 0}%</span><i><b style={{ width: `${task.progress || 0}%` }} /></i></div> : null}
                {isFailed ? <p className="task-record-error" title={task.error ? generationErrorMessage(task.error) : undefined}>{taskAttentionReason(task)}</p> : null}
            </div>
            <div className="task-record-date"><TaskDate value={task.createdAt} /></div>
            {creditsEnabled ? <TaskBilling billing={task.billing} /> : <span className="task-record-billing-empty" aria-hidden="true" />}
            <div className="task-record-actions">
                <Tooltip title="查看详情"><Button type="text" size="small" icon={<Eye className="size-3.5" />} aria-label="查看详情" onClick={onOpen} /></Tooltip>
                {isFailed ? <Tooltip title="重试任务"><Button type="text" size="small" icon={<RotateCcw className="size-3.5" />} aria-label="重试任务" loading={actingId === task.id} disabled={task.errorCode === CONTENT_MODERATION_ERROR_CODE || isContentModerationError(task.error)} onClick={onRetry} /></Tooltip> : null}
                {isActive ? <Tooltip title="取消任务"><Button type="text" size="small" danger icon={<X className="size-3.5" />} aria-label="取消任务" loading={actingId === task.id} onClick={onCancel} /></Tooltip> : null}
            </div>
        </article>
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

function TaskPreviewThumbnail({ task, onOpen }: { task: GenerationTask; onOpen: () => void }) {
    const isVideo = task.previewKind === "video";
    const fallbackVideo = task.type.includes("video");
    if (!task.previewUrl) {
        const Icon = fallbackVideo ? Video : task.type.includes("image") ? ImageIcon : FileText;
        return <span className="grid h-12 w-[68px] shrink-0 place-items-center rounded-md border border-border/70 bg-muted/35 text-foreground/28"><Icon className="size-4" /></span>;
    }
    return (
        <button type="button" onClick={onOpen} className="group relative h-12 w-[68px] shrink-0 overflow-hidden rounded-md border border-border/80 bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={isVideo ? "放大预览生成视频" : "放大预览生成图片"}>
            {isVideo
                ? <video src={task.previewUrl} width={68} height={48} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                : <img src={task.previewUrl} alt="" width={68} height={48} loading="lazy" className="h-full w-full object-cover" />}
            <span className="absolute inset-0 grid place-items-center bg-black/0 text-white opacity-0 transition-[background-color,opacity] duration-150 group-hover:bg-black/30 group-hover:opacity-100 group-focus-visible:bg-black/30 group-focus-visible:opacity-100">
                {isVideo ? <Play className="size-4 fill-current" /> : <Eye className="size-4" />}
            </span>
        </button>
    );
}

function getTaskCanvasContext(task: GenerationTask, canvasById: Map<string, { title: string; projectId?: string }>, projectNameById: Map<string, string>) {
    if (!task.projectId) return { canvasName: "未绑定画布", projectName: "" };
    const canvas = canvasById.get(task.projectId);
    if (canvas) return { canvasName: canvas.title || "未命名画布", projectName: canvas.projectId ? projectNameById.get(canvas.projectId) || "" : "" };
    const projectName = projectNameById.get(task.projectId);
    return projectName ? { canvasName: "项目级任务", projectName } : { canvasName: "画布已移除", projectName: "" };
}

function taskAttentionReason(task: GenerationTask) {
    if (task.status === "cancelled") return providerCancelStatusLabel(task);
    if (task.errorCode === CONTENT_MODERATION_ERROR_CODE || isContentModerationError(task.error)) return "内容审核未通过，请修改输入后新建任务";
    if (task.error) return generationErrorMessage(task.error);
    return task.stage || "生成失败，打开详情查看原因";
}

function providerCancelStatusLabel(task: GenerationTask) {
    if (task.providerCancelStatus === "requested") return "已请求上游取消，正在等待确认";
    if (task.providerCancelStatus === "confirmed") return "上游已确认取消，积分已退回";
    if (task.providerCancelStatus === "uncertain") {
        if (task.billing?.status === "settled") return "上游未能取消，费用已结算";
        if (task.billing?.status === "refunded") return "上游取消结果未确认，积分已退回";
        return task.providerCancelError || "上游无法确认取消，费用待核对";
    }
    return task.billing?.status === "refunded" ? "任务在调用上游前取消，积分已退回" : "任务已取消，可按原输入重新提交";
}

function taskEmptyState(status: TaskStatusFilter) {
    if (status === "all") return { title: "还没有任务", description: "新提交的生成会在这里显示状态和实时进度。" };
    if (status === "active") return { title: "没有运行中的任务", description: "新提交的生成会在这里显示排队状态和实时进度。" };
    if (status === "succeeded") return { title: "还没有已完成任务", description: "生成成功后，结果预览和执行记录会保留在这里。" };
    return { title: "目前没有需要处理的任务", description: "失败或取消的生成会出现在这里，并提供原因和可用操作。" };
}

function statusDotClassName(status: TaskStatus) {
    if (status === "succeeded") return "task-record-dot bg-emerald-500";
    if (status === "running") return "task-record-dot is-pulsing bg-amber-500";
    if (status === "queued") return "task-record-dot bg-blue-500";
    if (status === "failed") return "task-record-dot bg-red-500";
    return "task-record-dot bg-foreground/30";
}

function taskMediaKind(task: GenerationTask): Exclude<TaskKindFilter, "all"> {
    const value = `${task.type} ${task.operation || ""}`.toLowerCase();
    if (value.includes("video") || value.includes("视频")) return "video";
    if (value.includes("image") || value.includes("图片") || value.includes("画面")) return "image";
    return "text";
}

function TaskDate({ value }: { value?: string }) {
    if (!value) return <span className="text-xs text-foreground/38">-</span>;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return <span className="text-xs text-foreground/38">-</span>;
    const compact = `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
    return <time className="task-record-date-value" dateTime={date.toISOString()} title={date.toLocaleString()}>{compact}</time>;
}

function TaskBilling({ billing }: { billing?: GenerationTask["billing"] }) {
    if (!billing) return <span className="task-record-billing-empty text-xs text-foreground/30">-</span>;
    const amount = formatCredits(billing.amountMicrocredits);
    const note = billing.status === "settled" ? "已结算" : billing.status === "refunded" ? "已退回" : billing.status === "uncertain" ? "待核对" : "预计";
    return <div className={`task-record-billing ${billing.status === "uncertain" ? "is-uncertain" : ""}`} title={`积分${note}`}><Coins className="size-4" /><span><strong>{amount}</strong><small>{note}</small></span></div>;
}

function formatModelName(config: AiConfig, task: GenerationTask) {
    const raw = (task.model || task.provider || "").trim();
    const model = raw.includes("::") ? raw.split("::").pop()?.trim() || raw : raw;

    if (!model) return "工作流";
    if (model === "version-router") return "版本对比工作流";
    if (model === "workflow-router") return "工作流路由";
    if (model === "internal-agent") return "内置工作流";
    if (model === "openai-compatible") return "OpenAI 兼容接口";
    return modelDisplayName(config, raw);
}

function formatDate(value?: string) {
    if (!value) return "-";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function InfoItem({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0 border-b border-border px-0 py-2.5">
            <Typography.Text type="secondary" className="block text-xs">
                {label}
            </Typography.Text>
            <Typography.Text className="block truncate text-sm" title={value}>
                {value}
            </Typography.Text>
        </div>
    );
}

function DetailBlock({ title, value }: { title: string; value: string }) {
    return (
        <div>
            <Typography.Text strong>{title}</Typography.Text>
            <pre className="mt-2 max-h-60 overflow-auto rounded-md bg-slate-950 p-3 text-xs leading-5 text-slate-100">{value}</pre>
        </div>
    );
}

function formatTaskJson(value?: string) {
    if (!value) return "无";
    try {
        return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
        return value;
    }
}

function backendProviderConfig(config: ReturnType<typeof resolveModelRequestConfig>) {
    return {
        channelId: config.channelId,
        apiFormat: config.apiFormat,
        interfaceType: config.interfaceType,
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        secretKey: config.secretKey,
        model: config.model,
        size: config.size,
        quality: config.quality,
        transparentBackground: config.transparentBackground,
        count: config.count,
        videoSeconds: config.videoSeconds,
        vquality: config.vquality,
        videoGenerateAudio: config.videoGenerateAudio,
        videoWatermark: config.videoWatermark,
        audioVoice: config.audioVoice,
        audioFormat: config.audioFormat,
        audioSpeed: config.audioSpeed,
        audioInstructions: config.audioInstructions,
        capabilityConfig: modelCapabilityConfigFor(config, config.model),
        systemPrompt: config.systemPrompt,
    };
}

function buildVideoOperationPrompt(operation: string, prompt: string) {
    const operationLabel = operationOptions.find((item) => item.value === operation)?.label || "其他视频操作";
    if (operation === "compare_versions") return `请对以下视频结果版本做对比分析，输出推荐版本、差异点和修改建议：\n${prompt}`;
    return `视频编辑任务：${operationLabel}\n创作要求：${prompt}`;
}
