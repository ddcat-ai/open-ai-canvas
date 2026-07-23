import { App, Button, Empty, Form, Input, Modal, Segmented, Select, Space, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { FileText, Plus, RefreshCw, RotateCcw, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ListToolbar, PageHeader, TableSurface, WorkspacePage } from "@/components/layout/workspace-page";
import { CONTENT_MODERATION_ERROR_CODE, generationErrorMessage, isContentModerationError } from "@/lib/generation-error";
import { formatTaskKind, operationOptions, statusLabel } from "@/lib/generation-task-display";

import { cancelGenerationTask, createAgentSession, createGenerationTask, listGenerationTasks, listTaskLogs, queryGenerationTask, retryGenerationTask, type CreateTaskInput, type GenerationTask, type TaskLog, type TaskStatus } from "@/services/api/task-center";
import { syncGenerationTaskToCanvasStore } from "@/lib/canvas/canvas-generation-task-sync";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { resolveModelRequestConfig, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";

const taskTableClassName = "app-data-table";

export default function TasksPage() {
    const { message } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const projects = useCanvasStore((state) => state.projects);
    const [form] = Form.useForm<CreateTaskInput & { operation: string }>();
    const [tasks, setTasks] = useState<GenerationTask[]>([]);
    const [loading, setLoading] = useState(false);
    const [actingId, setActingId] = useState("");
    const [createOpen, setCreateOpen] = useState(false);
    const [creating, setCreating] = useState(false);
    const [statusFilter, setStatusFilter] = useState<"all" | "active" | "succeeded" | "failed">("all");
    const [keyword, setKeyword] = useState("");
    const [projectFilter, setProjectFilter] = useState("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [detailTask, setDetailTask] = useState<GenerationTask | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [taskLogs, setTaskLogs] = useState<TaskLog[]>([]);
    const [logsLoading, setLogsLoading] = useState(false);
    const syncedCanvasTaskIdsRef = useRef(new Set<string>());
    const tasksRef = useRef<GenerationTask[]>([]);

    const projectTitleById = useMemo(() => new Map(projects.map((project) => [project.id, project.title || "未命名画布"])), [projects]);
    const projectOptions = useMemo(() => projects.map((project) => ({ label: project.title || "未命名画布", value: project.id })), [projects]);
    const filteredTasks = useMemo(() => tasks.filter((task) => {
        if (statusFilter === "active") return task.status === "queued" || task.status === "running";
        if (statusFilter === "failed") return task.status === "failed" || task.status === "cancelled";
        if (statusFilter === "succeeded") return task.status === "succeeded";
        return true;
    }).filter((task) => {
        if (projectFilter !== "all" && task.projectId !== projectFilter) return false;
        const query = keyword.trim().toLowerCase();
        return !query || `${task.prompt} ${task.model || ""} ${formatTaskKind(task)} ${getCanvasTitle(task, projectTitleById)}`.toLowerCase().includes(query);
    }), [keyword, projectFilter, projectTitleById, statusFilter, tasks]);

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
            message.success(action === "retry" ? "任务已重新入队" : "任务已取消");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "操作失败");
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
            setCreateOpen(false);
            form.resetFields();
            message.success("任务已创建");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "任务创建失败");
        } finally {
            setCreating(false);
        }
    };

    const columns = useMemo<ColumnsType<GenerationTask>>(
        () => [
            {
                title: "任务",
                dataIndex: "prompt",
                width: 420,
                render: (prompt, task) => (
                    <div className="min-w-0 space-y-1 overflow-hidden">
                        <div title={prompt} className="line-clamp-2 max-w-full break-words text-sm font-medium leading-5 text-stone-950 dark:text-stone-100">
                            {prompt}
                        </div>
                        <Typography.Text className="block !text-xs !text-stone-500 dark:!text-stone-400">
                            {formatTaskKind(task)}
                        </Typography.Text>
                    </div>
                ),
            },
            {
                title: "画布名称",
                width: 180,
                render: (_, task) => {
                    const name = getCanvasTitle(task, projectTitleById);
                    return (
                        <Typography.Text ellipsis className={task.projectId ? "block max-w-[160px] !text-stone-700 dark:!text-stone-200" : "block max-w-[160px] !text-stone-400 dark:!text-stone-500"}>
                            {name}
                        </Typography.Text>
                    );
                },
            },
            {
                title: "状态",
                width: 160,
                render: (_, task) => (
                    <div className="min-w-0">
                        <span className={`inline-flex h-7 items-center rounded-md border px-2.5 text-xs font-medium ${statusBadgeClassName(task.status)}`}>{statusLabel[task.status]}</span>
                        <div className="mt-1 truncate text-[10px] text-stone-500 dark:text-stone-400" title={task.stage || statusLabel[task.status]}>{task.stage || statusLabel[task.status]}{typeof task.progress === "number" ? ` · ${task.progress}%` : ""}</div>
                    </div>
                ),
            },
            {
                title: "模型",
                width: 190,
                render: (_, task) => (
                    <Typography.Text ellipsis className="block max-w-[170px] !text-stone-700 dark:!text-stone-200">
                        {formatModelName(task)}
                    </Typography.Text>
                ),
            },
            {
                title: "尝试",
                dataIndex: "attempts",
                width: 90,
                render: (attempts: number) => <span className="text-stone-500 dark:text-stone-400">第 {attempts || 1} 次</span>,
            },
            {
                title: "创建时间",
                dataIndex: "createdAt",
                width: 190,
                render: (value) => <span className="text-stone-500 dark:text-stone-400">{formatDate(value)}</span>,
            },
            {
                title: "操作",
                width: 140,
                render: (_, task) => (
                    <Space size={2}>
                        <Button type="text" size="small" title="查看详情" className="!text-stone-500 hover:!text-stone-950 dark:!text-stone-400 dark:hover:!text-white" icon={<FileText className="size-3.5" />} onClick={() => openTaskDetail(task)} />
                        <Button type="text" size="small" title={task.errorCode === CONTENT_MODERATION_ERROR_CODE || isContentModerationError(task.error) ? "内容审核未通过，请修改提示词后新建任务" : "重新生成"} className="!text-stone-500 hover:!text-stone-950 dark:!text-stone-400 dark:hover:!text-white" icon={<RotateCcw className="size-3.5" />} loading={actingId === task.id} disabled={(task.status !== "failed" && task.status !== "cancelled") || task.errorCode === CONTENT_MODERATION_ERROR_CODE || isContentModerationError(task.error)} onClick={() => runAction(task.id, "retry")} />
                        <Button type="text" size="small" title="取消任务" className="!text-stone-500 hover:!text-red-600 dark:!text-stone-400 dark:hover:!text-red-300" danger icon={<X className="size-3.5" />} loading={actingId === task.id} disabled={task.status === "succeeded" || task.status === "cancelled"} onClick={() => runAction(task.id, "cancel")} />
                    </Space>
                ),
            },
        ],
        [actingId, openTaskDetail, projectTitleById],
    );

    return (
        <>
            <WorkspacePage grid>
                <PageHeader
                    title="任务中心"
                    description="查看生成进度、结果和失败原因。"
                    meta={<span className="text-xs text-foreground/45">{filteredTasks.length} 个任务{loading ? " · 正在同步" : ""}</span>}
                    actions={(
                        <>
                            <Button icon={<RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />} onClick={() => void loadTasks(true)}>刷新</Button>
                            <Button type="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreateOpen(true)}>新建任务</Button>
                        </>
                    )}
                />
                <ListToolbar active={Boolean(keyword || projectFilter !== "all" || statusFilter !== "all")} onReset={() => { setKeyword(""); setProjectFilter("all"); setStatusFilter("all"); setPage(1); }}>
                    <Input allowClear className="w-full sm:w-80" prefix={<Search className="size-4 text-foreground/40" />} value={keyword} placeholder="搜索指令、模型、类型或画布" onChange={(event) => { setKeyword(event.target.value); setPage(1); }} />
                    <Select className="w-44" value={projectFilter} onChange={(value) => { setProjectFilter(value); setPage(1); }} options={[{ label: "全部画布", value: "all" }, ...projectOptions]} />
                    <Segmented
                        size="small"
                        value={statusFilter}
                        onChange={(value) => { setStatusFilter(value as typeof statusFilter); setPage(1); }}
                        options={[
                            { label: `全部 ${tasks.length}`, value: "all" },
                            { label: `进行中 ${tasks.filter((task) => task.status === "queued" || task.status === "running").length}`, value: "active" },
                            { label: `已完成 ${tasks.filter((task) => task.status === "succeeded").length}`, value: "succeeded" },
                            { label: `异常 ${tasks.filter((task) => task.status === "failed" || task.status === "cancelled").length}`, value: "failed" },
                        ]}
                    />
                </ListToolbar>

                <TableSurface>
                    <Table
                        rowKey="id"
                        size="middle"
                        className={taskTableClassName}
                        columns={columns}
                        dataSource={filteredTasks}
                        loading={loading}
                        rowClassName={() => "align-top"}
                        tableLayout="fixed"
                        pagination={{ current: page, pageSize, total: filteredTasks.length, showSizeChanger: true, pageSizeOptions: [20, 50, 100], showTotal: (total, range) => `${range[0]}-${range[1]} / 共 ${total} 个任务`, onChange: (nextPage, nextPageSize) => { setPage(nextPageSize !== pageSize ? 1 : nextPage); setPageSize(nextPageSize); } }}
                        scroll={{ x: 1320 }}
                        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span className="text-stone-500 dark:text-stone-400">暂无任务</span>} className="py-12" /> }}
                    />
                </TableSurface>
            </WorkspacePage>
            <Modal title="新建异步生成任务" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={submitTask} confirmLoading={creating} okText="创建任务">
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
            <Modal title="任务详情" open={Boolean(detailTask)} onCancel={() => setDetailTask(null)} footer={null} width={820}>
                {detailTask ? (
                    <div className="space-y-4">
                        <div className="grid gap-3 text-sm md:grid-cols-2">
                            <InfoItem label="状态" value={statusLabel[detailTask.status]} />
                            <InfoItem label="画布名称" value={getCanvasTitle(detailTask, projectTitleById)} />
                            <InfoItem label="任务类型" value={formatTaskKind(detailTask)} />
                            <InfoItem label="模型" value={formatModelName(detailTask)} />
                            <InfoItem label="尝试次数" value={`第 ${detailTask.attempts || 1} 次`} />
                            <InfoItem label="创建时间" value={formatDate(detailTask.createdAt)} />
                        </div>
                        {detailTask.error ? <pre className="max-h-28 overflow-auto whitespace-pre-wrap rounded-lg bg-red-50 p-3 text-xs text-red-700">{generationErrorMessage(detailTask.error)}</pre> : null}
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
            </Modal>
        </>
    );
}

function reconcileTaskSummaries(current: GenerationTask[], next: GenerationTask[]) {
    if (current.length !== next.length) return next;
    const currentById = new Map(current.map((task) => [task.id, task]));
    let changed = false;
    const reconciled = next.map((task) => {
        const previous = currentById.get(task.id);
        if (previous?.updatedAt === task.updatedAt) return previous;
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

function getCanvasTitle(task: GenerationTask, projectTitleById: Map<string, string>) {
    if (!task.projectId) return "未绑定";
    return projectTitleById.get(task.projectId) || "未同步画布";
}

function statusBadgeClassName(status: TaskStatus) {
    if (status === "succeeded") return "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    if (status === "running") return "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    if (status === "queued") return "border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300";
    if (status === "failed") return "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300";
    return "border-stone-300 bg-stone-100 text-stone-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400";
}

function formatModelName(task: GenerationTask) {
    const raw = (task.model || task.provider || "").trim();
    const model = raw.includes("::") ? raw.split("::").pop()?.trim() || raw : raw;

    if (!model) return "工作流";
    if (model === "version-router") return "版本对比工作流";
    if (model === "workflow-router") return "工作流路由";
    if (model === "internal-agent") return "内置工作流";
    if (model === "openai-compatible") return "OpenAI 兼容接口";
    return model;
}

function formatDate(value?: string) {
    if (!value) return "-";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function InfoItem({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
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
            <pre className="mt-2 max-h-60 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">{value}</pre>
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
        apiFormat: config.apiFormat,
        interfaceType: config.interfaceType,
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
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
        systemPrompt: config.systemPrompt,
    };
}

function buildVideoOperationPrompt(operation: string, prompt: string) {
    const operationLabel = operationOptions.find((item) => item.value === operation)?.label || operation;
    if (operation === "compare_versions") return `请对以下视频结果版本做对比分析，输出推荐版本、差异点和修改建议：\n${prompt}`;
    return `视频编辑任务：${operationLabel}\n创作要求：${prompt}`;
}
