// Agent 输入框附件：在画布里，粘贴、拖入、上传的图片和转换的长文本都先成为画布节点，
// 再以节点引用（@[node:ID]）随消息发出，Agent 能看图，也能拿它当生成参考，后端不用改。
// 这里只放纯函数：附件状态签名、发送前补引用、选区合并、文件校验和复制文本。
import { canvasNodeMentionToken, canvasResourceMentionToken, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { CanvasNodeData } from "@/types/canvas";

/** 每条消息最多附带的图片数。 */
export const AGENT_ATTACHMENT_MAX = 9;
/** 粘贴的文字超过这个字数时，建议转成画布文本节点再引用。 */
export const AGENT_LONG_TEXT_CHARS = 2000;
const AGENT_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export type AgentAttachmentStatus = "pending" | "uploading" | "ready" | "error" | "local_only";
export type AgentAttachmentState = { status: AgentAttachmentStatus; progress?: number; error?: string };

/** 同一个文件的去重键：同一次粘贴里 files 和 items 会给出同一张图。 */
export function agentAttachmentFileKey(file: Pick<File, "name" | "size" | "lastModified">) {
    return `${file.name}:${file.size}:${file.lastModified}`;
}

/**
 * 附件节点的上传状态签名。画布每次拖动、编辑都会重新发布节点，面板只在签名变化时重渲染。
 * 节点还没出现在画布上（占位图正在读取尺寸）时为 pending。
 */
export function agentAttachmentStatusKey(nodes: readonly CanvasNodeData[] | undefined, nodeIdsCsv: string): string {
    if (!nodeIdsCsv) return "";
    return nodeIdsCsv
        .split(",")
        .map((id) => {
            const metadata = nodes?.find((node) => node.id === id)?.metadata;
            if (!nodes?.some((node) => node.id === id)) return `${id}=pending`;
            if (metadata?.fileUpload === "uploading") return `${id}=uploading:${metadata.fileUploadProgress ?? ""}`;
            if (metadata?.fileUpload === "error") return `${id}=error:${encodeURIComponent(metadata.errorDetails || "")}`;
            // storageKey 不是服务端资源，说明只存在本机，Agent 在服务端读不到这张图。
            if (metadata?.storageKey && !metadata.storageKey.startsWith("resource:")) return `${id}=local_only`;
            return `${id}=ready`;
        })
        .join("|");
}

export function parseAgentAttachmentStatus(key: string): Map<string, AgentAttachmentState> {
    const states = new Map<string, AgentAttachmentState>();
    for (const part of key ? key.split("|") : []) {
        const split = part.indexOf("=");
        const id = part.slice(0, split);
        const rest = part.slice(split + 1);
        const colon = rest.indexOf(":");
        const status = (colon < 0 ? rest : rest.slice(0, colon)) as AgentAttachmentStatus;
        const extra = colon < 0 ? "" : rest.slice(colon + 1);
        if (status === "uploading") states.set(id, { status, ...(extra ? { progress: Number(extra) } : {}) });
        else if (status === "error") states.set(id, { status, error: decodeURIComponent(extra) || "上传失败" });
        else states.set(id, { status });
    }
    return states;
}

/** 发送前：把附件节点的引用补到正文末尾，正文里已经引用过的跳过。 */
export function appendAgentNodeReferences(text: string, nodeIds: readonly string[]) {
    const missing = [...new Set(nodeIds)].map(canvasNodeMentionToken).filter((token) => !text.includes(token));
    if (!missing.length) return text;
    const body = text.replace(/\s+$/u, "");
    return body ? `${body}\n${missing.join(" ")}` : missing.join(" ");
}

/** 移除附件时，正文里对它的引用一起去掉。 */
export function removeAgentNodeReference(text: string, nodeId: string) {
    const token = canvasNodeMentionToken(nodeId);
    if (!text.includes(token)) return text;
    return text
        .split(token)
        .join("")
        .replace(/[ \t]{2,}/gu, " ")
        .replace(/[ \t]+\n/gu, "\n")
        .trim();
}

/** 长文本转节点：把正文里刚粘贴的那段换成节点引用；找不到原文时返回 null。 */
export function replaceAgentPastedText(text: string, pasted: string, token: string): string | null {
    const normalize = (value: string) => value.replace(/\r\n?/gu, "\n");
    const source = normalize(text);
    const target = normalize(pasted);
    for (const candidate of [target, target.trim()]) {
        const index = candidate ? source.indexOf(candidate) : -1;
        if (index >= 0) return `${source.slice(0, index)}${token} ${source.slice(index + candidate.length)}`.trim();
    }
    return null;
}

/** 附件节点排在选区前面作为重点，去重后最多 limit 个，超出的只报数量。 */
export function mergeAgentFocusNodeIds(priority: readonly string[], selected: readonly string[], limit: number) {
    const merged = [...new Set([...priority, ...selected])];
    return { focusNodeIds: merged.slice(0, limit), focusNodeOmittedCount: Math.max(0, merged.length - limit) };
}

export type AgentAttachmentFileCheck = { accepted: File[]; problems: string[]; hasGif: boolean };

/** 粘贴、拖入、上传共用的校验：只收 PNG / JPG / WebP / GIF，单张大小和每条张数有上限，重复的跳过。 */
export function checkAgentAttachmentFiles(files: readonly File[], options: { existingCount: number; existingKeys: ReadonlySet<string>; maxBytes: number }): AgentAttachmentFileCheck {
    const seen = new Set<string>();
    const accepted: File[] = [];
    const problems: string[] = [];
    let hasGif = false;
    for (const file of files) {
        const key = agentAttachmentFileKey(file);
        if (seen.has(key)) continue;
        seen.add(key);
        if (options.existingKeys.has(key)) {
            problems.push("这张图片已经添加过");
            continue;
        }
        if (/^image\/hei[cf]/u.test(file.type) || /\.(heic|heif)$/iu.test(file.name)) {
            problems.push("暂不支持 HEIC 图片，请导出为 JPG 或 PNG 后再添加");
            continue;
        }
        if (!AGENT_IMAGE_TYPES.has(file.type)) {
            problems.push(`「${file.name || "文件"}」不是 PNG、JPG、WebP 或 GIF 图片`);
            continue;
        }
        if (file.size > options.maxBytes) {
            problems.push(`「${file.name || "图片"}」超过 ${Math.round(options.maxBytes / 1024 / 1024)}MB 上传上限`);
            continue;
        }
        if (options.existingCount + accepted.length >= AGENT_ATTACHMENT_MAX) {
            problems.push(`每条消息最多 ${AGENT_ATTACHMENT_MAX} 张图片`);
            break;
        }
        if (file.type === "image/gif") hasGif = true;
        accepted.push(file);
    }
    return { accepted, problems: [...new Set(problems)], hasGif };
}

/** 复制消息：引用令牌换成「@名称」，保留换行；找不到名称的引用写成「@引用」。 */
export function agentCopyText(text: string, references: readonly CanvasResourceReference[]) {
    let value = text;
    for (const reference of references) {
        const token = canvasResourceMentionToken(reference);
        if (token.startsWith("@[") && value.includes(token)) value = value.split(token).join(`@${reference.label || reference.title || "引用"}`);
    }
    return value.replace(/@\[[^\]]+\]/gu, "@引用");
}
