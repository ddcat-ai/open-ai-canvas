import type { GenerationTask } from "@/services/api/task-center";

export function generationAssetTitle(task: Pick<GenerationTask, "id" | "prompt" | "clientContext">, kind: "image" | "video" | "audio", index: number, count: number) {
    let title = Array.from(task.clientContext?.assetTitle?.trim() || "")
        .slice(0, 200)
        .join("");
    if (!title) {
        const prompt = Array.from(task.prompt.trim().replace(/\s+/g, " "));
        title = prompt.slice(0, 48).join("") + (prompt.length > 48 ? "…" : "");
    }
    if (!title) title = `${{ image: "生成图片", video: "生成视频", audio: "生成音频" }[kind]} · ${task.id.slice(0, 8)}`;
    return count > 1 ? `${title} · ${index + 1}` : title;
}
