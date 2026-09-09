import type { CanvasAssistantMessage, CanvasAssistantSession } from "@/types/canvas";
import { recoverCanvasAgentPlan, type CanvasAgentPlan } from "./canvas-agent-plan";

function detailObject(detail: unknown): Record<string, unknown> {
    return detail && typeof detail === "object" && !Array.isArray(detail) ? detail as Record<string, unknown> : {};
}

export function recoverCanvasAgentSessions(sessions: CanvasAssistantSession[]): CanvasAssistantSession[] {
    return sessions.map((session) => ({
        ...session,
        messages: session.messages.map((message: CanvasAssistantMessage) => {
            const detail = detailObject(message.detail);
            const plan = detail.plan as CanvasAgentPlan | undefined;
            if (!plan || !["running", "pending", "waiting_approval"].includes(plan.status)) return message;
            const recovered = recoverCanvasAgentPlan(plan);
            return { ...message, title: "计划已恢复，等待继续", text: "页面刷新前的执行已停止，请重新读取画布后再继续。", detail: { ...detail, status: "blocked", plan: recovered } };
        }),
    }));
}
