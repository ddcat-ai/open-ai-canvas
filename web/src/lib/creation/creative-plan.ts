import type { CreativePlan, CreativePlanStep } from "./creative-agent-contract";
import type { CreativeAgentState } from "./creative-agent-state";
import { generationErrorMessage } from "@/lib/generation-error";

export type CreativePlannedStep = {
    id: string;
    ref: string;
    title: string;
    phase: "questions" | "proposal" | "canvas" | "media";
    mediaRefs: string[];
    // Only previous observed execution may freeze a completed step.
    completed?: boolean;
};
export type CreativeDynamicPlan = { id: string; revision: number; reason?: string; steps: CreativePlannedStep[] };

export function updateCreativePlan(raw: unknown, previous: CreativeDynamicPlan | undefined, id: string): CreativeDynamicPlan | undefined {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return previous;
    const input = raw as Record<string, unknown>;
    if (!Array.isArray(input.steps)) return previous;
    const steps: CreativePlannedStep[] = [];
    const refs = new Set<string>();
    for (const value of input.steps.slice(0, 12)) {
        if (!value || typeof value !== "object") continue;
        const item = value as Record<string, unknown>;
        const ref = typeof item.ref === "string" ? item.ref.trim().slice(0, 80) : "";
        const title = typeof item.title === "string" ? item.title.trim().slice(0, 160) : "";
        if (!ref || !title || refs.has(ref) || !["questions", "proposal", "canvas", "media"].includes(String(item.phase))) continue;
        refs.add(ref);
        const old = previous?.steps.find((step) => step.ref === ref);
        steps.push(old?.completed ? old : {
            id: old?.id || `${id}:${steps.length + 1}`, ref, title,
            phase: item.phase as CreativePlannedStep["phase"],
            mediaRefs: Array.isArray(item.mediaRefs) ? [...new Set(item.mediaRefs.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())))].slice(0, 20) : [],
        });
    }
    if (!steps.length) return previous;
    // Finished work stays in the plan even when a model omits it in a revision.
    const completed = previous?.steps.filter((step) => step.completed && !refs.has(step.ref)) || [];
    return { id: previous?.id || id, revision: (previous?.revision || 0) + 1,
        reason: typeof input.reason === "string" ? input.reason.slice(0, 500) : undefined, steps: [...completed, ...steps] };
}

export function dynamicCreativePlan(state: CreativeAgentState): CreativePlan | undefined {
    const plan = state.dynamicPlan;
    if (!plan) return;
    return { id: plan.id, steps: plan.steps.map((step): CreativePlanStep => {
        let status: CreativePlanStep["status"] = step.completed ? "completed" : "pending";
        let nodeIds: string[] = [];
        if (!step.completed) {
            if (step.phase === "questions" && state.questions) status = state.questions.status === "submitted" ? "completed" : state.questions.status === "pending" ? "waiting" : "cancelled";
            if (step.phase === "proposal" && state.proposal) status = state.canvasApplied ? "completed" : "waiting";
            if (step.phase === "canvas" && state.canvasApplied) status = "completed";
            if (step.phase === "media" && step.mediaRefs.length) {
                const media = state.media.filter((item) => step.mediaRefs.includes(item.ref));
                nodeIds = media.map((item) => item.nodeId);
                if (media.some((item) => ["failed", "write_failed"].includes(item.status))) status = "failed";
                else if (media.length === step.mediaRefs.length && media.every((item) => item.status === "ready")) status = "completed";
                else if (media.some((item) => ["running", "queued"].includes(item.status))) status = "running";
                else if (media.some((item) => item.submissionId)) status = "waiting";
            }
        }
        return { id: step.id, title: step.title, status, nodeIds, detail: step.phase === "media" ? state.media.filter((item) => step.mediaRefs.includes(item.ref)).map((item) => item.error ? generationErrorMessage(item.error) : "").filter(Boolean).join("；") || undefined : undefined };
    }) };
}

export function snapshotCreativePlan(state: CreativeAgentState): CreativeDynamicPlan | undefined {
    const actual = dynamicCreativePlan(state);
    return state.dynamicPlan && { ...state.dynamicPlan, steps: state.dynamicPlan.steps.map((step) => ({ ...step, completed: step.completed || actual?.steps.find((item) => item.id === step.id)?.status === "completed" })) };
}
