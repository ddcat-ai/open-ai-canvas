import { currentMediaVersion, listMediaVersions } from "@/lib/canvas/canvas-media-versions";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

/** 资产视图的固定分类；顺序即左侧目录顺序。 */
export const CANVAS_ASSET_KINDS = ["txt", "markdown", "image", "video", "audio"] as const;
export type CanvasAssetKind = (typeof CANVAS_ASSET_KINDS)[number];

export const CANVAS_ASSET_KIND_LABELS: Record<CanvasAssetKind, string> = {
    txt: "文本",
    markdown: "Markdown",
    image: "图片",
    video: "视频",
    audio: "音频",
};

export type CanvasAssetVersionSource = "version-group" | "batch" | "media-history" | "single";

/**
 * 资产下的一个可回看版本。nodeId 指向承载它的画布节点；mediaVersionId 存在时表示节点内历史版本。
 * primary 表示该资产当前对外使用的版本（主版本、批次主图或节点当前显示的媒体）。
 */
export type CanvasAssetVersion = {
    key: string;
    label: string;
    nodeId: string;
    mediaVersionId?: string;
    source: CanvasAssetVersionSource;
    primary: boolean;
    /** 能否设为主版本；拆层图层是组成部分而不是候选版本，不能设为主版本。 */
    promotable: boolean;
    createdAt?: string;
    origin?: "generate" | "upload";
};

export type CanvasAssetEntry = {
    key: string;
    kind: CanvasAssetKind;
    title: string;
    /** 定位与预览默认使用的节点。 */
    nodeId: string;
    versions: CanvasAssetVersion[];
    updatedAt?: string;
};

export type CanvasAssetGroup = {
    kind: CanvasAssetKind;
    label: string;
    entries: CanvasAssetEntry[];
};

const TEXT_MARKDOWN_NAME = /\.(md|markdown)$/i;
function hasStoredContent(node: CanvasNodeData) {
    return Boolean(node.metadata?.content?.trim() || node.metadata?.storageKey?.trim());
}

/** 节点归入哪个资产分类；没有实际内容、仍在上传或不是内容型节点时返回 null。 */
export function canvasAssetKind(node: CanvasNodeData): CanvasAssetKind | null {
    if (node.metadata?.fileUpload) return null;
    switch (node.type) {
        case CanvasNodeType.Text: {
            if (node.metadata?.workflowKind === "character" || !hasStoredContent(node)) return null;
            const mimeType = node.metadata?.mimeType?.toLowerCase() || "";
            return node.metadata?.textFormat === "markdown" || mimeType.includes("markdown") || TEXT_MARKDOWN_NAME.test(node.title || "") ? "markdown" : "txt";
        }
        case CanvasNodeType.Image:
            // 拆层得到的单个图层属于图层组，不单独作为资产。
            if (node.metadata?.imageLayer && !node.metadata.batchRootId) return null;
            return hasStoredContent(node) ? "image" : null;
        case CanvasNodeType.Video:
            return hasStoredContent(node) ? "video" : null;
        case CanvasNodeType.Audio:
            return hasStoredContent(node) ? "audio" : null;
        default:
            return null;
    }
}

/** 去掉版本后缀（「 · A」「 · V3」），得到资产本身的名称。 */
export function canvasAssetBaseTitle(title: string) {
    return title.replace(/\s·\s(?:[A-Z]|V\d+)$/, "").trim();
}

function latestTimestamp(values: Array<string | undefined>) {
    let latest: string | undefined;
    for (const value of values) {
        if (value && (!latest || value > latest)) latest = value;
    }
    return latest;
}

function mediaHistoryVersions(node: CanvasNodeData, prefix: string, isPrimaryMember: boolean): CanvasAssetVersion[] {
    const history = listMediaVersions(node);
    if (history.length <= 1) return [];
    const current = currentMediaVersion(node);
    return history.map((version) => ({
        key: `${node.id}:media:${version.id}`,
        label: prefix ? `${prefix} · V${version.number}` : `V${version.number}`,
        nodeId: node.id,
        mediaVersionId: version.id,
        source: "media-history" as const,
        primary: isPrimaryMember && current?.id === version.id,
        promotable: true,
        createdAt: version.createdAt,
        origin: version.source,
    }));
}

function memberVersions(node: CanvasNodeData, label: string, source: CanvasAssetVersionSource, primary: boolean): CanvasAssetVersion[] {
    const history = mediaHistoryVersions(node, label, primary);
    if (history.length) return history;
    return [{ key: `${node.id}:node`, label, nodeId: node.id, source, primary, promotable: source === "version-group", createdAt: node.updatedAt || node.createdAt }];
}

type AssetGroupDraft = { key: string; kind: CanvasAssetKind; members: CanvasNodeData[]; rootNode?: CanvasNodeData; source: CanvasAssetVersionSource };

function buildEntry(draft: AssetGroupDraft): CanvasAssetEntry | null {
    const members = draft.members.length ? draft.members : draft.rootNode && canvasAssetKind(draft.rootNode) ? [draft.rootNode] : [];
    if (!members.length) return null;
    let versions: CanvasAssetVersion[] = [];
    let primaryNode = members[0];
    if (draft.source === "batch" && draft.rootNode && draft.members.length) {
        const root = draft.rootNode;
        const childIds = root.metadata?.batchChildIds || [];
        const ordered = [...members].sort((left, right) => childIds.indexOf(left.id) - childIds.indexOf(right.id));
        const layered = Boolean(root.metadata?.imageLayerGroup);
        const primaryId = root.metadata?.primaryImageId;
        primaryNode = ordered.find((node) => node.id === primaryId) || root;
        versions = ordered.map((node, index) => ({
            key: `${node.id}:node`,
            label: layered ? `图层 ${index + 1}` : `第 ${index + 1} 张`,
            nodeId: node.id,
            source: "batch" as const,
            primary: !layered && node.id === primaryId,
            promotable: !layered,
            createdAt: node.updatedAt || node.createdAt,
        }));
        return {
            key: draft.key,
            kind: draft.kind,
            title: canvasAssetBaseTitle(root.title || primaryNode.title),
            nodeId: root.id,
            versions,
            updatedAt: latestTimestamp([root.updatedAt, ...ordered.map((node) => node.updatedAt)]),
        };
    }
    if (draft.source === "version-group" && members.length > 1) {
        const ordered = [...members].sort((left, right) => (left.metadata?.versionLabel || "").localeCompare(right.metadata?.versionLabel || "") || (left.createdAt || "").localeCompare(right.createdAt || ""));
        primaryNode = ordered.find((node) => node.metadata?.versionPrimary) || ordered[0];
        versions = ordered.flatMap((node, index) => memberVersions(node, node.metadata?.versionLabel || String.fromCharCode(65 + index), "version-group", node.id === primaryNode.id));
        return {
            key: draft.key,
            kind: draft.kind,
            title: canvasAssetBaseTitle(primaryNode.title),
            nodeId: primaryNode.id,
            versions,
            updatedAt: latestTimestamp(ordered.map((node) => node.updatedAt)),
        };
    }
    const node = members[0];
    versions = mediaHistoryVersions(node, "", true);
    return {
        key: draft.key,
        kind: draft.kind,
        title: canvasAssetBaseTitle(node.title) || CANVAS_ASSET_KIND_LABELS[draft.kind],
        nodeId: node.id,
        versions,
        updatedAt: node.updatedAt || node.createdAt,
    };
}

/**
 * 把当前画布节点整理成「类型 → 资产 → 版本」三级目录。
 *
 * 归并规则：
 * - 同一 versionOfNodeId 的节点合并为一个资产，A/B 等跨节点版本作为版本列出；
 * - 批量生成或拆层的子节点归到批次根节点下，根节点只代表这一组，不重复计数；
 * - 节点内的媒体历史（V1/V2…）展开为该节点的版本。
 * 只读派生，不写回画布。
 */
export function buildCanvasAssetCatalog(nodes: CanvasNodeData[]): CanvasAssetGroup[] {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const drafts = new Map<string, AssetGroupDraft>();
    const order: string[] = [];
    const pushDraft = (key: string, create: () => AssetGroupDraft, member: CanvasNodeData) => {
        let draft = drafts.get(key);
        if (!draft) {
            draft = create();
            drafts.set(key, draft);
            order.push(key);
        }
        draft.members.push(member);
    };

    for (const node of nodes) {
        if (node.metadata?.isBatchRoot) {
            const hasChildren = (node.metadata.batchChildIds || []).some((id) => nodeById.get(id)?.metadata?.batchRootId === node.id);
            if (hasChildren) {
                const kind = node.type === CanvasNodeType.Image ? "image" : canvasAssetKind(node);
                if (kind && !drafts.has(`batch:${node.id}`)) {
                    drafts.set(`batch:${node.id}`, { key: `batch:${node.id}`, kind, members: [], rootNode: node, source: "batch" });
                    order.push(`batch:${node.id}`);
                }
                continue;
            }
        }
        const kind = canvasAssetKind(node);
        if (!kind) continue;
        const batchRootId = node.metadata?.batchRootId;
        const batchRoot = batchRootId ? nodeById.get(batchRootId) : undefined;
        if (batchRoot?.metadata?.isBatchRoot) {
            const key = `batch:${batchRoot.id}`;
            pushDraft(key, () => ({ key, kind, members: [], rootNode: batchRoot, source: "batch" }), node);
            continue;
        }
        const versionRootId = node.metadata?.versionOfNodeId;
        if (versionRootId) {
            const key = `version:${kind}:${versionRootId}`;
            pushDraft(key, () => ({ key, kind, members: [], source: "version-group" }), node);
            continue;
        }
        const key = `node:${node.id}`;
        pushDraft(key, () => ({ key, kind, members: [], source: "single" }), node);
    }

    const groups = new Map<CanvasAssetKind, CanvasAssetEntry[]>(CANVAS_ASSET_KINDS.map((kind) => [kind, []]));
    for (const key of order) {
        const entry = buildEntry(drafts.get(key)!);
        if (entry) groups.get(entry.kind)!.push(entry);
    }
    return CANVAS_ASSET_KINDS.map((kind) => ({
        kind,
        label: CANVAS_ASSET_KIND_LABELS[kind],
        entries: groups.get(kind)!.sort((left, right) => (right.updatedAt || "").localeCompare(left.updatedAt || "")),
    }));
}
