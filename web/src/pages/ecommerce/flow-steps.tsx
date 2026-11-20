import { Check, LoaderCircle } from "lucide-react";
import type { CommerceFlowStep } from "./flow";

/** 作品区顶部的流程进度：每一步一个圆点，当前步写明正在做什么、下一步做什么。 */
export function CommerceFlowSteps({ steps }: { steps: CommerceFlowStep[] }) {
    const current = steps.find((step) => step.status === "current");
    return (
        <nav className="commerce-flow" aria-label="创作流程">
            <ol>
                {steps.map((step, index) => (
                    <li key={step.key} className={`commerce-flow-step is-${step.status}`} aria-current={step.status === "current" ? "step" : undefined}>
                        <span className="commerce-flow-dot" aria-hidden="true">
                            {step.status === "done" ? <Check size={12} strokeWidth={2.6} /> : step.running ? <LoaderCircle className="commerce-planning-spin" size={12} /> : index + 1}
                        </span>
                        <span className="commerce-flow-label">{step.label}</span>
                    </li>
                ))}
            </ol>
            {/* 识别、策划进行中时，作品区里的进度提示已写明在做什么，这里只亮当前步。 */}
            {current?.detail && !(current.running && current.key !== "generate") ? (
                <p className="commerce-flow-detail" role="status" aria-live="polite">
                    {current.detail}
                </p>
            ) : null}
        </nav>
    );
}
