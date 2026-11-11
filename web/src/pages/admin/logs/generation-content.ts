import type { ApiLogGenerationReference } from "@/services/api/auth";

export type ApiLogPromptPart = { type: "text"; text: string } | { type: "reference"; text: string; reference: ApiLogGenerationReference };

const MENTION = /@(图片|参考图|图像|图|视频|音频|image|video|audio)\s*(\d+)/giu;
const kinds: Record<string, ApiLogGenerationReference["kind"]> = { 图片: "image", 参考图: "image", 图像: "image", 图: "image", image: "image", 视频: "video", video: "video", 音频: "audio", audio: "audio" };

/** 编号来自该次请求的快照，未知引用保留原文，不从当前素材库猜测。 */
export function splitApiLogPrompt(prompt: string, references: ApiLogGenerationReference[]): ApiLogPromptPart[] {
    if (!prompt) return [];
    const byNumber = new Map<string, ApiLogGenerationReference>();
    for (const reference of references) {
        const label = /^@?(?:图片|参考图|图像|图|视频|音频|image|video|audio)\s*(\d+)$/iu.exec(reference.label);
        if (label) byNumber.set(`${reference.kind}:${label[1]}`, reference);
    }
    const parts: ApiLogPromptPart[] = [];
    let start = 0;
    for (const match of prompt.matchAll(MENTION)) {
        const at = match.index;
        // 保留邮箱和 URL 内的 @，中文紧邻编号仍是有效引用。
        if (at > 0 && /[a-z\d_/.%+-]/iu.test(prompt[at - 1])) continue;
        const reference = byNumber.get(`${kinds[match[1].toLowerCase()]}:${match[2]}`);
        if (!reference) continue;
        if (at > start) parts.push({ type: "text", text: prompt.slice(start, at) });
        parts.push({ type: "reference", text: match[0], reference });
        start = at + match[0].length;
    }
    if (start < prompt.length) parts.push({ type: "text", text: prompt.slice(start) });
    return parts;
}
