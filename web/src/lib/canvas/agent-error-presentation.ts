import { ApiError } from "@/services/api/request";
import { AgentStreamError } from "@/services/api/agent";

export function agentErrorPresentation(cause: unknown, fallback = "Agent 执行失败") {
    const text = typeof cause === "string" ? cause.trim() : cause instanceof Error ? cause.message : fallback;
    if ((cause instanceof ApiError || cause instanceof AgentStreamError) && cause.status === 404) {
        return {
            title: "Agent 接口或资源不存在",
            text: text || "当前后端未找到请求的 Agent 接口或会话资源。",
            meta: "请确认后端已加载 Agent 路由，以及画布、会话和模型仍可访问；旧进程需要更新后重启。",
        };
    }
    if (cause instanceof ApiError && cause.status === 501) {
        return {
            title: "当前 Agent 能力尚未开放",
            text: text || "当前请求的 Agent 能力尚未开放，请使用 capabilities 返回的权限和工具范围。",
        };
    }
    // 渠道、鉴权、配额等业务错误保留真实语义，不能按 message 猜测为服务未部署。
    return { title: fallback, text: text || fallback };
}

export function agentSubmissionErrorTitle(cause: unknown, accepted: boolean) {
    if (accepted) return "运行已接收，但本地提交记录清理失败";
    const status = cause instanceof ApiError ? cause.status : undefined;
    if (status && [400, 401, 403, 404, 422].includes(status)) return "请求已被服务端拒绝";
    if (status) return "服务端已返回错误；重试将核对原请求，不重复创建";
    return "未收到服务端确认；重试将核对原请求，不重复创建";
}
