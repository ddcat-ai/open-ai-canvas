import { Button, Modal } from "antd";

import { TaskDetailItem, taskStatusText } from "./canvas-project-feedback";
import type { GenerationTask, TaskLog } from "@/services/api/task-center";
import type { CanvasNodeData } from "@/types/canvas";

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
    return (
        <>
            <Modal title="任务详情" open={Boolean(task)} footer={null} width={760} onCancel={onCloseTask}>
                {task ? (
                    <div className="space-y-4 text-sm">
                        <div className="grid grid-cols-2 gap-3 rounded-lg border p-3" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
                            <TaskDetailItem label="当前阶段" value={task.stage || taskStatusText(task.status)} />
                            <TaskDetailItem label="进度" value={`${task.progress ?? 0}%`} />
                            <TaskDetailItem label="模型" value={task.model || "默认模型"} />
                            <TaskDetailItem label="任务 ID" value={task.id} />
                        </div>
                        <div>
                            <div className="mb-2 text-xs font-semibold" style={{ color: theme.node.muted }}>提示词</div>
                            <div className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-lg p-3 text-xs leading-5" style={{ background: theme.node.fill }}>{task.prompt || "未记录"}</div>
                        </div>
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

            <Modal title="图片详情" open={Boolean(previewNode?.metadata?.content)} centered onCancel={onClosePreview} footer={null} width="auto" styles={{ body: { padding: 0, display: "flex", justifyContent: "center", alignItems: "center", maxHeight: "80vh" } }}>
                {previewNode?.metadata?.content ? <img src={previewNode.metadata.content} alt={previewNode.title || "图片"} style={{ maxWidth: "100%", maxHeight: "80vh", objectFit: "contain" }} /> : null}
            </Modal>

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
