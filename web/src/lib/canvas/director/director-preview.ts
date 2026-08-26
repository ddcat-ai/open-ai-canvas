import type { DirectorScene, DirectorShot } from "../../../types/director";

/** 预览来源的判定结果。image 之外都不渲染 <img>。 */
export type DirectorPreviewSource = { kind: "image"; url: string } | { kind: "loading" } | { kind: "empty" };

/** 读取画布节点正文；节点已删除或无正文时返回空。 */
export type DirectorNodeContentReader = (nodeId: string | undefined) => string | undefined;

function usableContent(read: DirectorNodeContentReader, nodeId: string | undefined) {
    if (!nodeId) return null;
    const content = read(nodeId);
    if (!content) return null;
    // 节点被删除、正文缺失或只有空白都必须安全落空；
    // 有效正文返回 trim 后的值，避免首尾空白拼进 <img src> 造成畸形请求。
    const trimmed = content.trim();
    return trimmed ? trimmed : null;
}

/** 取当前镜头：优先 metadata 指定，其次场景第一个。 */
export function resolveDirectorActiveShot(scene: DirectorScene | null, shotId: string | undefined): DirectorShot | undefined {
    if (!scene) return undefined;
    return scene.shots?.find((item) => item.id === shotId) || scene.shots?.[0];
}

/**
 * 预览来源优先级（严格自上而下）：
 * 1. node.metadata.directorPreviewNodeId 指向的画布节点正文
 * 2. 当前 DirectorShot.previewNodeId 指向的画布节点正文（补 metadata 丢失）
 * 3. scene 为 null：场景尚在准备（loading）
 * 4. 其余：诚实空态
 * 不改动任何 scene/node 状态，只做读取判定。
 */
export function resolveDirectorPreviewSource(input: { scene: DirectorScene | null; shot: DirectorShot | undefined; previewNodeId: string | undefined; readNodeContent: DirectorNodeContentReader }): DirectorPreviewSource {
    const fromMetadata = usableContent(input.readNodeContent, input.previewNodeId);
    if (fromMetadata) return { kind: "image", url: fromMetadata };
    const fromShot = usableContent(input.readNodeContent, input.shot?.previewNodeId);
    if (fromShot) return { kind: "image", url: fromShot };
    if (!input.scene) return { kind: "loading" };
    return { kind: "empty" };
}

/**
 * 加载失败的门控：记录「失败的那个 URL」而不是布尔标记。
 * 语义边界：新给出的坏 URL 仍会先渲染一次，浏览器随后才发出 onError —— 无法避免这一帧。
 * 本门控保证的是：同一个已失败的 URL 不会被反复渲染，且换成另一个 URL 时自动重试，
 * 无需外部手动清理标记。
 */
export function gateDirectorPreviewFailure(source: DirectorPreviewSource, failedUrl: string | null): DirectorPreviewSource {
    if (source.kind !== "image" || !failedUrl) return source;
    return source.url === failedUrl ? { kind: "empty" } : source;
}
