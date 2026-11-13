/** 只携带当前页面的资源身份；镜头内容由服务端在执行时读取。 */
export type AgentPageContext = {
    kind: "drama";
    projectId: string;
    episodeId?: string;
    shotId?: string;
};

export type AgentRequestTarget = {
    canvasId: string;
    pageContext?: AgentPageContext;
};

export function agentPageContextKey(context?: AgentPageContext | null) {
    return context ? JSON.stringify([context.kind, context.projectId, context.episodeId || "", context.shotId || ""]) : "";
}

export function sameAgentRequestTarget(left: AgentRequestTarget, right: AgentRequestTarget) {
    return left.canvasId === right.canvasId && agentPageContextKey(left.pageContext) === agentPageContextKey(right.pageContext);
}

export function isAgentPageContext(value: unknown): value is AgentPageContext {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const context = value as Record<string, unknown>;
    const id = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 80 && value.trim() === value && !/[\s\u0000-\u001f\u007f]/u.test(value);
    return context.kind === "drama" && id(context.projectId) && (context.episodeId === undefined || id(context.episodeId)) && (context.shotId === undefined || (id(context.shotId) && id(context.episodeId)));
}
