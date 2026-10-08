export type CanvasReferenceLabelKind = "image" | "character" | "drawing" | "video" | "audio" | "text" | "skill" | "tool";

/** 图片、角色主图和绘图共享图片数组的位置；保留类型前缀供编辑器识别。 */
export function createCanvasReferenceLabeler() {
    const counts: Record<CanvasReferenceLabelKind, number> = { image: 0, character: 0, drawing: 0, video: 0, audio: 0, text: 0, skill: 0, tool: 0 };
    const prefixes: Record<CanvasReferenceLabelKind, string> = { image: "图片", character: "角色", drawing: "绘图", video: "视频", audio: "音频", text: "文本", skill: "技能", tool: "工具" };
    return (kind: CanvasReferenceLabelKind) => {
        const counter = kind === "character" || kind === "drawing" ? "image" : kind;
        return `${prefixes[kind]}${++counts[counter]}`;
    };
}
