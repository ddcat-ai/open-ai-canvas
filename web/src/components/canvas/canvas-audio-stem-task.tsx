import { useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, CircleAlert, LoaderCircle, LocateFixed, RotateCcw, Square, X } from "lucide-react";
import type { AudioStemTask } from "@/lib/audio-stem/contracts";
import "./canvas-audio-stem.css";

const PHASE_LABELS = { reading: "读取音频", model: "准备分离模型", inference: "分离音轨", saving: "保存结果" };
const OUTPUT_LABELS = { both: "人声 + 伴奏", vocals: "人声", instrumental: "伴奏" };

export function CanvasAudioStemTask({ task, onCancel, onRetry, onDismiss, onView }: { task: AudioStemTask; onCancel: () => void; onRetry: () => void; onDismiss: () => void; onView: (nodeId: string) => void }) {
    const [collapsed, setCollapsed] = useState(false);
    useEffect(() => {
        setCollapsed(false);
    }, [task.id, task.status]);
    const cancelling = task.status === "cancelling";
    const running = task.status === "running" || cancelling;
    const succeeded = task.status === "succeeded";
    const failed = task.status === "failed";
    let title = "分离已取消";
    let Icon = Square;
    if (running) {
        title = cancelling ? "正在停止分离" : "音频后台分离中";
        Icon = LoaderCircle;
    } else if (succeeded) {
        title = "音轨已准备好";
        Icon = CheckCircle2;
    } else if (failed) {
        title = "分离未完成";
        Icon = CircleAlert;
    }
    const indeterminate = running && task.progress.percent === 0;
    const phase = PHASE_LABELS[task.progress.phase];
    return (
        <section
            data-canvas-no-drag
            data-canvas-no-zoom
            data-canvas-wheel-scroll
            className="audio-stem-task"
            data-status={task.status}
            aria-label="音频分离任务"
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            <header className="audio-stem-task-header">
                <span className="audio-stem-task-icon">
                    <Icon size={18} className={running ? "motion-safe:animate-spin" : undefined} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                    <h3 role="status" aria-live="polite">
                        {title}
                    </h3>
                    <p title={task.title}>{task.title}</p>
                </div>
                <button
                    type="button"
                    className="audio-stem-icon-button"
                    onClick={() => setCollapsed((value) => !value)}
                    aria-expanded={!collapsed}
                    aria-controls={collapsed ? undefined : "audio-stem-task-body"}
                    aria-label={collapsed ? "展开分离进度" : "收起分离进度"}
                >
                    {collapsed ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
                </button>
                {!running ? (
                    <button type="button" className="audio-stem-icon-button" aria-label="关闭分离任务提示" onClick={onDismiss}>
                        <X size={16} aria-hidden="true" />
                    </button>
                ) : null}
            </header>
            {!collapsed ? (
                <div id="audio-stem-task-body" className="audio-stem-task-body">
                    {running ? (
                        <>
                            <div className="audio-stem-phase">
                                <span>{phase}</span>
                                <span className="tabular-nums">{indeterminate ? "处理中…" : `${task.progress.percent}%`}</span>
                            </div>
                            <div className="audio-stem-progress" role="progressbar" aria-label={`${phase}阶段进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={indeterminate ? undefined : task.progress.percent}>
                                <span className={indeterminate ? "audio-stem-progress-pending" : undefined} style={indeterminate ? undefined : { transform: `scaleX(${task.progress.percent / 100})` }} />
                            </div>
                            <p className="audio-stem-task-detail">可继续编辑画布，请保持本页打开。</p>
                        </>
                    ) : (
                        <p className="audio-stem-task-detail" role={failed ? "alert" : undefined}>
                            {task.detail}
                        </p>
                    )}
                    <footer className="audio-stem-task-footer">
                        <span>{OUTPUT_LABELS[task.selection]}</span>
                        <div className="flex items-center gap-2">
                            {task.resultIds.length ? (
                                <button type="button" className="audio-stem-task-action" onClick={() => onView(task.resultIds[0])}>
                                    <LocateFixed size={14} aria-hidden="true" />
                                    查看结果
                                </button>
                            ) : null}
                            {running ? (
                                <button type="button" className="audio-stem-task-action" onClick={onCancel} disabled={cancelling}>
                                    <Square size={12} aria-hidden="true" />
                                    {cancelling ? "取消中…" : "取消"}
                                </button>
                            ) : null}
                            {!running && !succeeded ? (
                                <button type="button" className="audio-stem-task-action" onClick={onRetry}>
                                    <RotateCcw size={14} aria-hidden="true" />
                                    重试
                                </button>
                            ) : null}
                        </div>
                    </footer>
                </div>
            ) : (
                <div className="audio-stem-task-collapsed">
                    <span>{running ? phase : OUTPUT_LABELS[task.selection]}</span>
                    {running ? (
                        <button type="button" className="audio-stem-task-action" onClick={onCancel} disabled={cancelling}>
                            {cancelling ? "取消中…" : "取消"}
                        </button>
                    ) : null}
                </div>
            )}
        </section>
    );
}
