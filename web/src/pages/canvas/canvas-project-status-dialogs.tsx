import { Button, Image, Modal } from "antd";

import { TaskDetailItem } from "./canvas-project-feedback";
import { generationTaskShowsProgress, generationTaskStageLabel } from "@/lib/generation-task-display";
import { formatTaskLog, type GenerationTask, type TaskLog } from "@/services/api/task-center";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { VideoPlayer } from "@/components/video-player";
import { modelDisplayName, useEffectiveConfig } from "@/stores/use-config-store";
import { useTranslation } from "react-i18next";
// 组件内用 useTranslation（跟随语言切换重渲染）；模块级纯函数只能用这个非 React 出口，
// 在普通 helper 里调 useTranslation 会破坏 hook 顺序甚至直接抛 Invalid hook call。
import { t } from "@/i18n";

type CanvasProjectStatusDialogsProps = {
    theme: { node: { stroke: string; panel: string; muted: string; fill: string } };
    task: GenerationTask | null;
    taskLogs: TaskLog[];
    taskLoading: boolean;
    onCloseTask: () => void;
    superResolveNode: CanvasNodeData | null;
    onCloseSuperResolve: () => void;
    previewNode: CanvasNodeData | null;
    onClosePreview: () => void;
    clearConfirmOpen: boolean;
    onCancelClear: () => void;
    onConfirmClear: () => void;
};

export function CanvasProjectStatusDialogs({ theme, task, taskLogs, taskLoading, superResolveNode, previewNode, clearConfirmOpen, onCloseTask, onCloseSuperResolve, onClosePreview, onCancelClear, onConfirmClear }: CanvasProjectStatusDialogsProps) {
    const { t } = useTranslation("canvas");
    const config = useEffectiveConfig();
    return (
        <>
            <Modal title={t("canvas:task-details")} open={Boolean(task)} footer={null} width="min(920px, calc(100vw - 32px))" onCancel={onCloseTask}>
                {task ? (
                    <div className="space-y-4 text-sm">
                        <div className="grid grid-cols-2 gap-3 rounded-lg border p-3" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
                            <TaskDetailItem label={t("canvas:current-stage")} value={generationTaskStageLabel(task)} />
                            {generationTaskShowsProgress(task) ? <TaskDetailItem label={t("canvas:progress")} value={`${task.progress ?? 0}%`} /> : null}
                            <TaskDetailItem label={t("canvas:model")} value={task.model ? modelDisplayName(config, task.model) : t("canvas:default-model")} />
                            <TaskDetailItem label={t("canvas:task-id")} value={task.id} />
                            <TaskDetailItem label={t("canvas:created-at")} value={formatTaskTime(task.createdAt)} />
                            <TaskDetailItem label={t("canvas:started-at")} value={formatTaskTime(task.startedAt)} />
                            <TaskDetailItem label={t("canvas:finished-at")} value={formatTaskTime(task.completedAt)} />
                            <TaskDetailItem label={t("canvas:duration")} value={formatTaskDuration(task)} />
                        </div>
                        <div>
                            <div className="mb-2 text-xs font-semibold" style={{ color: theme.node.muted }}>
                                {t("canvas:prompt")}
                            </div>
                            <div className="h-32 overflow-y-auto whitespace-pre-wrap rounded-lg p-3 text-xs leading-5" style={{ background: theme.node.fill }}>
                                {task.prompt || t("canvas:not-recorded")}
                            </div>
                        </div>
                        <TaskGenerationParameters inputJson={task.inputJson} theme={theme} />
                        <div>
                            <div className="mb-2 text-xs font-semibold" style={{ color: theme.node.muted }}>
                                {t("canvas:task-logs")}
                            </div>
                            <pre className="max-h-64 overflow-auto rounded-lg bg-neutral-950 p-3 text-[var(--fs-label)] leading-5 text-neutral-100">
                                {taskLoading ? t("canvas:loading") : taskLogs.length ? taskLogs.map((log) => `[${new Date(log.createdAt).toLocaleString()}] ${log.level.toUpperCase()} ${formatTaskLog(log)}`).join("\n") : t("canvas:no-logs-yet")}
                            </pre>
                        </div>
                    </div>
                ) : null}
            </Modal>

            <Modal title={t("canvas:ai-upscale")} open={Boolean(superResolveNode?.metadata?.content)} centered footer={null} onCancel={onCloseSuperResolve}>
                <div className="py-8 text-center text-base font-medium">{t("canvas:not-implemented-yet")}</div>
            </Modal>

            <Modal
                title={t("canvas:video-preview")}
                open={Boolean(previewNode?.metadata?.content && previewNode.type === CanvasNodeType.Video)}
                centered
                onCancel={onClosePreview}
                footer={null}
                width="min(1200px, calc(100vw - 32px))"
                styles={{ body: { padding: 0, display: "flex", justifyContent: "center", alignItems: "center", maxHeight: "84vh", overflow: "hidden", background: "#090909" } }}
            >
                {previewNode?.metadata?.content && previewNode.type === CanvasNodeType.Video ? (
                    <VideoPlayer src={previewNode.metadata.content} mimeType={previewNode.metadata.mimeType} title={previewNode.title || t("canvas:video-preview")} className="max-h-[84vh] max-w-full bg-black" />
                ) : null}
            </Modal>

            {previewNode?.metadata?.content && previewNode.type === CanvasNodeType.Image ? (
                <Image
                    src={previewNode.metadata.content}
                    alt={previewNode.title || t("canvas:images")}
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
                title={t("canvas:clear-canvas")}
                open={clearConfirmOpen}
                centered
                onCancel={onCancelClear}
                footer={
                    <>
                        <Button onClick={onCancelClear}>{t("canvas:cancel-2")}</Button>
                        <Button danger type="primary" onClick={onConfirmClear}>
                            {t("canvas:clear")}
                        </Button>
                    </>
                }
            >
                <p className="text-sm opacity-60">{t("canvas:this-removes-all-nodes-and-connections-on-the-current-canvas")}</p>
            </Modal>
        </>
    );
}

function TaskGenerationParameters({ inputJson, theme }: { inputJson?: string; theme: CanvasProjectStatusDialogsProps["theme"] }) {
    const { t } = useTranslation("canvas");
    const fields = taskParameterRows(inputJson);
    return (
        <div>
            <div className="mb-2 text-xs font-semibold" style={{ color: theme.node.muted }}>
                {t("canvas:generation-parameters")}
            </div>
            {fields.length ? (
                <div className="grid grid-cols-2 gap-x-5 gap-y-1 rounded-lg border p-3 sm:grid-cols-3" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
                    {fields.map((field) => (
                        <TaskDetailItem key={field.label} label={field.label} value={field.value} />
                    ))}
                </div>
            ) : (
                <div className="rounded-lg p-3 text-xs" style={{ background: theme.node.fill, color: theme.node.muted }}>
                    {t("canvas:no-parameters-recorded")}
                </div>
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
    add(t("canvas:size-ratio"), config.size);
    add(t("canvas:resolution"), config.vquality || config.quality);
    add(t("canvas:seconds"), config.videoSeconds === undefined ? undefined : t("canvas:params", { videoSeconds: config.videoSeconds }));
    add(t("canvas:count"), config.count);
    add(t("canvas:generate-audio"), booleanLabel(config.videoGenerateAudio));
    add(t("canvas:watermark"), booleanLabel(config.videoWatermark));
    add(t("canvas:voice"), config.audioVoice);
    add(t("canvas:audio-format"), config.audioFormat);
    add(t("canvas:audio-speed"), config.audioSpeed);
    addReference(t("canvas:reference-images"), input.referenceImages, t("canvas:images"));
    addReference(t("canvas:reference-videos"), input.referenceVideos, t("canvas:videos"));
    addReference(t("canvas:reference-audio"), input.referenceAudios, t("canvas:audio"));
    return rows;

    function addReference(label: string, value: unknown, kind: string) {
        if (!Array.isArray(value) || !value.length) return;
        const names = value.map((item) => (typeof item === "object" && item !== null && "name" in item ? String((item as { name?: unknown }).name || "") : "")).filter(Boolean);
        const suffix = names.length ? `（${names.slice(0, 3).join("、")}${names.length > 3 ? "…" : ""}）` : "";
        rows.push({ label, value: t("canvas:param-param-param", { length: value.length, kind: kind, suffix: suffix }) });
    }
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function booleanLabel(value: unknown) {
    if (value === true || value === "true") return t("canvas:on");
    if (value === false || value === "false") return t("canvas:close-3");
    return "";
}

function formatTaskTime(value?: string) {
    if (!value) return t("canvas:not-recorded");
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : value;
}

function formatTaskDuration(task: GenerationTask) {
    const start = Date.parse(task.startedAt || task.createdAt);
    const end = task.completedAt ? Date.parse(task.completedAt) : task.status === "queued" || task.status === "running" ? Date.now() : Number.NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return task.completedAt ? t("canvas:not-recorded") : t("canvas:incomplete");
    const milliseconds = Math.max(0, end - start);
    const totalSeconds = Math.round(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes ? t("canvas:paramm-params", { minutes: minutes, seconds: seconds }) : t("canvas:params-2", { seconds: seconds });
}
