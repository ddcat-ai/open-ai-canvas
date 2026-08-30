import { Button, Image, Modal } from "antd";
import { XCircle } from "lucide-react";

import { TaskDetailItem } from "./canvas-project-feedback";
import { generationTaskShowsProgress, generationTaskStageLabel } from "@/lib/generation-task-display";
import { formatTaskLog, type GenerationTask, type TaskLog } from "@/services/api/task-center";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { VideoPlayer } from "@/components/video-player";
import { modelDisplayName, useEffectiveConfig } from "@/stores/use-config-store";

type CanvasProjectStatusDialogsProps = {
    theme: { node: { stroke: string; panel: string; muted: string; fill: string } };
    task: GenerationTask | null;
    taskLogs: TaskLog[];
    taskLoading: boolean;
    onCloseTask: () => void;
    onCancelTask?: (task: GenerationTask) => void;
    superResolveNode: CanvasNodeData | null;
    onCloseSuperResolve: () => void;
    previewNode: CanvasNodeData | null;
    onClosePreview: () => void;
    clearConfirmOpen: boolean;
    onCancelClear: () => void;
    onConfirmClear: () => void;
};

export function CanvasProjectStatusDialogs({ theme, task, taskLogs, taskLoading, superResolveNode, previewNode, clearConfirmOpen, onCloseTask, onCancelTask, onCloseSuperResolve, onClosePreview, onCancelClear, onConfirmClear }: CanvasProjectStatusDialogsProps) {
    const config = useEffectiveConfig();
    return (
        <>
            <Modal title="任务详情" open={Boolean(task)} footer={null} width="min(920px, calc(100vw - 32px))" onCancel={onCloseTask}>
                {task ? (
                    <div className="space-y-4 text-sm">
                        <div className="grid grid-cols-2 gap-3 rounded-lg border p-3" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
                            <TaskDetailItem label="当前阶段" value={generationTaskStageLabel(task)} />
                            {generationTaskShowsProgress(task) ? <TaskDetailItem label="进度" value={`${task.progress ?? 0}%`} /> : null}
                            <TaskDetailItem label="模型" value={task.model ? modelDisplayName(config, task.model) : "默认模型"} />
                            <TaskDetailItem label="任务 ID" value={task.id} />
                            <TaskDetailItem label="创建时间" value={formatTaskTime(task.createdAt)} />
                            <TaskDetailItem label="开始时间" value={formatTaskTime(task.startedAt)} />
                            <TaskDetailItem label="完成时间" value={formatTaskTime(task.completedAt)} />
                            <TaskDetailItem label="耗时" value={formatTaskDuration(task)} />
                        </div>
                        <div>
                            <div className="mb-2 text-xs font-semibold" style={{ color: theme.node.muted }}>
                                提示词
                            </div>
                            <div className="h-32 overflow-y-auto whitespace-pre-wrap rounded-lg p-3 text-xs leading-5" style={{ background: theme.node.fill }}>
                                {task.prompt || "未记录"}
                            </div>
                        </div>
                        <TaskGenerationParameters inputJson={task.inputJson} theme={theme} />
                        {onCancelTask && (task.status === "queued" || task.status === "running") ? (
                            <div className="flex justify-end">
                                <Button danger icon={<XCircle className="size-4" />} onClick={() => onCancelTask(task)}>
                                    取消任务
                                </Button>
                            </div>
                        ) : null}
                        <div>
                            <div className="mb-2 text-xs font-semibold" style={{ color: theme.node.muted }}>
                                任务日志
                            </div>
                            <pre className="max-h-64 overflow-auto rounded-lg bg-neutral-950 p-3 text-[var(--fs-label)] leading-5 text-neutral-100">
                                {taskLoading ? "加载中..." : taskLogs.length ? taskLogs.map((log) => `[${new Date(log.createdAt).toLocaleString()}] ${log.level.toUpperCase()} ${formatTaskLog(log)}`).join("\n") : "暂无日志"}
                            </pre>
                        </div>
                    </div>
                ) : null}
            </Modal>

            <Modal title="AI 超分" open={Boolean(superResolveNode?.metadata?.content)} centered footer={null} onCancel={onCloseSuperResolve}>
                <div className="py-8 text-center text-base font-medium">暂未实现</div>
            </Modal>

            <Modal
                title="视频预览"
                open={Boolean(previewNode?.metadata?.content && previewNode.type === CanvasNodeType.Video)}
                centered
                onCancel={onClosePreview}
                footer={null}
                width="min(1200px, calc(100vw - 32px))"
                styles={{ body: { padding: 0, display: "flex", justifyContent: "center", alignItems: "center", maxHeight: "84vh", overflow: "hidden", background: "#090909" } }}
            >
                {previewNode?.metadata?.content && previewNode.type === CanvasNodeType.Video ? (
                    <VideoPlayer src={previewNode.metadata.content} mimeType={previewNode.metadata.mimeType} title={previewNode.title || "视频预览"} hasAudio={typeof previewNode.metadata.hasAudio === "boolean" ? previewNode.metadata.hasAudio : undefined} className="max-h-[84vh] max-w-full bg-black" />
                ) : null}
            </Modal>

            {previewNode?.metadata?.content && previewNode.type === CanvasNodeType.Image ? (
                <Image
                    src={previewNode.metadata.content}
                    alt={previewNode.title || "图片"}
                    style={{ display: "none" }}
                    preview={{
                        open: true,
                        movable: true,
                        minScale: 0.5,
                        maxScale: 12,
                        scaleStep: 0.25,
                        onOpenChange: (open) => !open && onClosePreview(),
                    }}
                />
            ) : null}

            <Modal
                title="清空画布？"
                open={clearConfirmOpen}
                centered
                onCancel={onCancelClear}
                footer={
                    <>
                        <Button onClick={onCancelClear}>取消</Button>
                        <Button danger type="primary" onClick={onConfirmClear}>
                            清空
                        </Button>
                    </>
                }
            >
                <p className="text-sm opacity-60">这会删除当前画布上的所有节点和连线。</p>
            </Modal>
        </>
    );
}

function TaskGenerationParameters({ inputJson, theme }: { inputJson?: string; theme: CanvasProjectStatusDialogsProps["theme"] }) {
    const fields = taskParameterRows(inputJson);
    return (
        <div>
            <div className="mb-2 text-xs font-semibold" style={{ color: theme.node.muted }}>生成参数</div>
            {fields.length ? (
                <div className="grid grid-cols-2 gap-x-5 gap-y-1 rounded-lg border p-3 sm:grid-cols-3" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
                    {fields.map((field) => <TaskDetailItem key={field.label} label={field.label} value={field.value} />)}
                </div>
            ) : (
                <div className="rounded-lg p-3 text-xs" style={{ background: theme.node.fill, color: theme.node.muted }}>暂无参数记录</div>
            )}
        </div>
    );
}

function taskParameterRows(inputJson?: string) {
    if (!inputJson) return [] as Array<{ label: string; value: string }>;
    let input: Record<string, unknown>;
    try {
        const parsed: unknown = JSON.parse(inputJson);
        input = asRecord(parsed);
    } catch {
        return [] as Array<{ label: string; value: string }>;
    }
    const config = asRecord(input.config);
    const rows: Array<{ label: string; value: string }> = [];
    const add = (label: string, value: unknown) => {
        if (value === undefined || value === null || value === "") return;
        rows.push({ label, value: String(value) });
    };
    add("尺寸 / 比例", config.size);
    add("分辨率", config.vquality || config.quality);
    add("秒数", config.videoSeconds === undefined ? undefined : `${config.videoSeconds} 秒`);
    add("生成数量", config.count);
    add("生成声音", booleanLabel(config.videoGenerateAudio));
    add("水印", booleanLabel(config.videoWatermark));
    add("音色", config.audioVoice);
    add("音频格式", config.audioFormat);
    add("音频速度", config.audioSpeed);
    addReference("引用图片", input.referenceImages, "图片");
    addReference("引用视频", input.referenceVideos, "视频");
    addReference("引用音频", input.referenceAudios, "音频");
    return rows;

    function addReference(label: string, value: unknown, kind: string) {
        if (!Array.isArray(value) || !value.length) return;
        const names = value
            .map((item) => (typeof item === "object" && item !== null && "name" in item ? String((item as { name?: unknown }).name || "") : ""))
            .filter(Boolean);
        const suffix = names.length ? `（${names.slice(0, 3).join("、")}${names.length > 3 ? "…" : ""}）` : "";
        rows.push({ label, value: `${value.length} 个${kind}${suffix}` });
    }
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function booleanLabel(value: unknown) {
    if (value === true || value === "true") return "开启";
    if (value === false || value === "false") return "关闭";
    return "";
}

function formatTaskTime(value?: string) {
    if (!value) return "未记录";
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : value;
}

function formatTaskDuration(task: GenerationTask) {
    const start = Date.parse(task.startedAt || task.createdAt);
    const end = task.completedAt ? Date.parse(task.completedAt) : task.status === "queued" || task.status === "running" ? Date.now() : Number.NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return task.completedAt ? "未记录" : "未完成";
    const milliseconds = Math.max(0, end - start);
    const totalSeconds = Math.round(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes ? `${minutes}分 ${seconds}秒` : `${seconds}秒`;
}
