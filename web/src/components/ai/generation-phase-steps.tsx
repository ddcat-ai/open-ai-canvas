import { GENERATION_PHASE_STEPS } from "@/lib/generation-task-display";
import { progressFillStyle } from "@/lib/progress-fill";

/**
 * 排队 → 生成 → 保存 三段进度。画布节点与首页创作卡片共用；颜色由外层容器通过
 * --gen-steps-* 变量提供。当前段没有真实百分比时显示流动光带，有真实百分比时按比例填充。
 */
export function GenerationPhaseSteps({ step, progress, className }: { step: number; progress?: number | null; className?: string }) {
    const value = typeof progress === "number" && Number.isFinite(progress) ? Math.max(0, Math.min(100, Math.round(progress))) : null;
    const finished = step >= GENERATION_PHASE_STEPS.length;
    const current = GENERATION_PHASE_STEPS[Math.min(step, GENERATION_PHASE_STEPS.length - 1)];
    const summary = finished ? "生成进度：已完成" : `生成进度：${current}${value !== null ? ` ${value}%` : ""}`;
    return (
        <ol className={className ? `generation-phase-steps ${className}` : "generation-phase-steps"} aria-label={summary}>
            {GENERATION_PHASE_STEPS.map((label, index) => {
                const state = index < step ? "done" : index === step ? "active" : "todo";
                const determinate = state === "active" && value !== null;
                return (
                    <li key={label} data-state={state} aria-current={state === "active" ? "step" : undefined}>
                        <span className="generation-phase-steps-track">
                            <span className="generation-phase-steps-fill" data-determinate={determinate ? "true" : undefined} style={determinate ? progressFillStyle(value) : undefined} />
                        </span>
                        <span className="generation-phase-steps-label">{label}</span>
                    </li>
                );
            })}
        </ol>
    );
}
