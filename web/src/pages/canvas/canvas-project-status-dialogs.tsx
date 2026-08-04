import { Button, Image, Modal, Tag } from "antd";

import { TaskDetailItem, taskStatusText } from "./canvas-project-feedback";
import type { GenerationTask, TaskLog } from "@/services/api/task-center";
import { canvasReferenceRoleLabel } from "@/lib/canvas/canvas-generation-submission";
import { CanvasNodeType, type CanvasNodeData, type GenerationSubmissionSnapshot } from "@/types/canvas";
import { VideoPlayer } from "@/components/video-player";

function parseTaskSubmissionSnapshot(task: GenerationTask | null): GenerationSubmissionSnapshot | null {
    if (!task?.inputJson) return null;
    try {
        const parsed = JSON.parse(task.inputJson);
        const snapshot = parsed?.submissionSnapshot;
        if (!snapshot || typeof snapshot !== "object") return null;
        return snapshot as GenerationSubmissionSnapshot;
    } catch {
        return null;
    }
}

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
    const snapshot = parseTaskSubmissionSnapshot(task);
    return (
        <>
            <Modal title="任务详情" open={Boolean(task)} footer={null} width={760} onCancel={onCloseTask}>
                {task ? (
                    <div className="space-y-4 text-sm">
                        <div className="grid grid-cols-2 gap-3 rounded-lg border p-3" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
                            <TaskDetailItem label="当前阶段" value={task.stage || taskStatusText(task.status)} />
                            <TaskDetailItem label="进度" value={`${task.progress ?? 0}%`} />
                            <TaskDetailItem label="模型" value={task.model || snapshot?.model || "默认模型"} />
                            <TaskDetailItem label="任务 ID" value={task.id} />
                            {snapshot?.pathLabel ? <TaskDetailItem label="生成路径" value={snapshot.pathLabel} /> : null}
                            {snapshot?.createdAt ? <TaskDetailItem label="快照时间" value={new Date(snapshot.createdAt).toLocaleString()} /> : null}
                        </div>
                        <div>
                            <div className="mb-2 text-xs font-semibold" style={{ color: theme.node.muted }}>最终发送提示词</div>
                            <div className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-lg p-3 text-xs leading-5" style={{ background: theme.node.fill }}>{snapshot?.effectivePrompt || task.prompt || "未记录"}</div>
                        </div>
                        {snapshot?.userPrompt && snapshot.userPrompt !== snapshot.effectivePrompt ? (
                            <div>
                                <div className="mb-2 text-xs font-semibold" style={{ color: theme.node.muted }}>用户原文提示词</div>
                                <div className="max-h-24 overflow-y-auto whitespace-pre-wrap rounded-lg p-3 text-xs leading-5 opacity-80" style={{ background: theme.node.fill }}>{snapshot.userPrompt}</div>
                            </div>
                        ) : null}
                        {snapshot?.references?.length ? (
                            <div>
                                <div className="mb-2 text-xs font-semibold" style={{ color: theme.node.muted }}>
                                    发送参考清单（{snapshot.references.filter((item) => item.included).length}/{snapshot.references.length}）
                                </div>
                                <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-lg border p-2" style={{ borderColor: theme.node.stroke, background: theme.node.fill }}>
                                    {snapshot.references.map((reference) => (
                                        <div key={`${reference.id}-${reference.kind}`} className="flex items-start justify-between gap-2 rounded-md px-2 py-1.5 text-xs" style={{ background: theme.node.panel }}>
                                            <div className="min-w-0 flex-1">
                                                <div className="truncate font-medium">{reference.label}</div>
                                                <div className="mt-0.5 text-[10px] opacity-60">{reference.reason || reference.source}</div>
                                            </div>
                                            <div className="flex shrink-0 flex-col items-end gap-1">
                                                <Tag className="!m-0 !text-[10px]">{canvasReferenceRoleLabel(reference.role)}</Tag>
                                                <span className="text-[10px]" style={{ color: reference.included ? theme.node.muted : undefined }}>{reference.included ? "已发送" : "已排除"}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : null}
                        {snapshot?.warnings?.length ? (
                            <div className="rounded-lg border p-2 text-[11px] leading-5" style={{ borderColor: theme.node.stroke, background: theme.node.fill, color: theme.node.muted }}>
                                {snapshot.warnings.map((warning) => (
                                    <div key={warning}>• {warning}</div>
                                ))}
                            </div>
                        ) : null}
                        <div>
                            <div className="mb-2 text-xs font-semibold" style={{ color: theme.node.muted }}>任务日志</div>
                            <pre className="max-h-64 overflow-auto rounded-lg bg-neutral-950 p-3 text-[11px] leading-5 text-neutral-100">{taskLoading ? "加载中..." : taskLogs.length ? taskLogs.map((log) => `[${new Date(log.createdAt).toLocaleString()}] ${log.level.toUpperCase()} ${log.message}`).join("\n") : "暂无日志"}</pre>
                        </div>
                    </div>
                ) : null}
            </Modal>

            <Modal title="AI 超分" open={Boolean(superResolveNode?.metadata?.content)} centered footer={null} onCancel={onCloseSuperResolve}>
                <div className="py-8 text-center text-base font-medium">暂未实现</div>
            </Modal>

            <Modal title="视频预览" open={Boolean(previewNode?.metadata?.content && previewNode.type === CanvasNodeType.Video)} centered onCancel={onClosePreview} footer={null} width="min(1200px, calc(100vw - 32px))" styles={{ body: { padding: 0, display: "flex", justifyContent: "center", alignItems: "center", maxHeight: "84vh", overflow: "hidden", background: "#090909" } }}>
                {previewNode?.metadata?.content && previewNode.type === CanvasNodeType.Video ? <VideoPlayer src={previewNode.metadata.content} mimeType={previewNode.metadata.mimeType} title={previewNode.title || "视频预览"} className="max-h-[84vh] max-w-full bg-black" /> : null}
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
                footer={<><Button onClick={onCancelClear}>取消</Button><Button danger type="primary" onClick={onConfirmClear}>清空</Button></>}
            >
                <p className="text-sm opacity-60">这会删除当前画布上的所有节点和连线。</p>
            </Modal>
        </>
    );
}
