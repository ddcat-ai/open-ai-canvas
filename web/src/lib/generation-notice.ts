import type { GenerationTask } from "@/services/api/task-center";

export type GenerationNoticeKind = "image" | "video" | "audio" | "storyboard" | "render";

/**
 * 生成完成提醒只覆盖用户主动等待结果的任务：媒体生成、分镜和时间线导出。
 * Agent 内部步骤、上下文压缩和普通文本对话本身就在界面里逐字呈现，不再额外打扰。
 */
export function generationNoticeKind(task: Pick<GenerationTask, "type" | "operation">): GenerationNoticeKind | null {
    const operation = task.operation || "";
    if (operation.startsWith("cloud_agent") || operation === "agent_memory_compact") return null;
    if (task.type === "canvas_image") return "image";
    if (task.type === "canvas_video") return "video";
    if (task.type === "canvas_audio") return "audio";
    if (task.type === "canvas_text" && operation === "storyboard") return "storyboard";
    if (task.type === "timeline_render") return "render";
    return null;
}

/** 通知缩略图：视频只用封面，不在通知里加载视频本体。 */
export function generationNoticeThumbnail(task: Pick<GenerationTask, "previewUrl" | "previewKind" | "previewPosterUrl">) {
    if (task.previewKind === "video") return task.previewPosterUrl || "";
    return task.previewUrl || "";
}

export function generationNoticePromptExcerpt(prompt: string | undefined, maxLength = 48) {
    const text = (prompt || "").replace(/\s+/g, " ").trim();
    return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}
