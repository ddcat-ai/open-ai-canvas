import type {
    CanvasConnection,
    CanvasNodeData,
    StoryboardDownstreamStage,
    StoryboardInputPolicy,
    StoryboardInputSlot,
    StoryboardRow,
} from "@/types/canvas";
import { CanvasNodeType } from "@/types/canvas";

export const STORYBOARD_INPUT_SLOTS: StoryboardInputSlot[] = ["story", "characters", "background", "style", "props"];

export const STORYBOARD_SLOT_HANDLE: Record<StoryboardInputSlot, string> = {
    story: "storyboard:story",
    characters: "storyboard:characters",
    background: "storyboard:background",
    style: "storyboard:style",
    props: "storyboard:props",
};

export const STORYBOARD_SLOT_LABEL: Record<StoryboardInputSlot, string> = {
    story: "正文",
    characters: "角色",
    background: "背景",
    style: "画风",
    props: "道具",
};

/** 旧单口 / 无 handle 兼容 */
export const STORYBOARD_LEGACY_CONTEXT_HANDLES = new Set(["storyboard:context", "context", ""]);

export type StoryboardInputSlots = {
    story: CanvasNodeData[];
    characters: CanvasNodeData[];
    background: CanvasNodeData[];
    style: CanvasNodeData[];
    props: CanvasNodeData[];
    /** 未能归类的旧连接，需用户拖到正确口 */
    legacyContext: CanvasNodeData[];
};

export function isStoryboardSlotHandle(handleId?: string | null): handleId is string {
    if (!handleId) return false;
    return Object.values(STORYBOARD_SLOT_HANDLE).includes(handleId);
}

export function storyboardSlotFromHandle(handleId?: string | null): StoryboardInputSlot | "legacy" | null {
    if (!handleId || STORYBOARD_LEGACY_CONTEXT_HANDLES.has(handleId)) return handleId === undefined || handleId === null ? null : "legacy";
    for (const slot of STORYBOARD_INPUT_SLOTS) {
        if (STORYBOARD_SLOT_HANDLE[slot] === handleId) return slot;
    }
    if (handleId.startsWith("row:")) return null;
    return "legacy";
}

/** 按来源节点建议目标槽（连接时可提示，不强制） */
export function suggestStoryboardInputSlot(fromNode: CanvasNodeData): StoryboardInputSlot {
    const kind = fromNode.metadata?.workflowKind;
    if (kind === "character" || fromNode.metadata?.characterAssetId) return "characters";
    if (kind === "styleboard") return "style";
    if (kind === "story_input") return "story";
    if (kind === "scene") return "background";
    const title = `${fromNode.title || ""} ${fromNode.metadata?.workflowTitle || ""}`;
    if (/场景|背景|环境|地点|布景/.test(title)) return "background";
    if (/画风|风格|style/i.test(title)) return "style";
    if (/道具|武器|物件|参考/.test(title)) return "props";
    if (fromNode.type === CanvasNodeType.Image || fromNode.type === CanvasNodeType.Drawing) {
        return "props";
    }
    if (fromNode.type === CanvasNodeType.Text || fromNode.type === CanvasNodeType.Skill) return "story";
    return "props";
}

function uniqueNodes(nodes: CanvasNodeData[]) {
    const seen = new Set<string>();
    return nodes.filter((node) => {
        if (seen.has(node.id)) return false;
        seen.add(node.id);
        return true;
    });
}

function migrateLegacySlot(fromNode: CanvasNodeData): StoryboardInputSlot | "legacy" {
    const suggested = suggestStoryboardInputSlot(fromNode);
    // 保守：纯文本无场景关键词 → story；其余按建议
    if (fromNode.type === CanvasNodeType.Text && suggested === "props") return "story";
    return suggested;
}

/**
 * 收集脚本节点五槽入边。
 * - 新连接：按 toHandleId 分槽
 * - 旧 context / 空 handle：启发式归类，并进入对应槽；无法判断进 legacyContext
 */
export function collectStoryboardInputSlots(
    scriptNodeId: string,
    nodes: CanvasNodeData[],
    connections: CanvasConnection[],
): StoryboardInputSlots {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const slots: StoryboardInputSlots = {
        story: [],
        characters: [],
        background: [],
        style: [],
        props: [],
        legacyContext: [],
    };

    connections.forEach((connection) => {
        if (connection.toNodeId !== scriptNodeId) return;
        // 行级入边不算全局槽
        if (connection.toHandleId?.startsWith("row:")) return;
        const from = nodeById.get(connection.fromNodeId);
        if (!from) return;

        const parsed = storyboardSlotFromHandle(connection.toHandleId);
        if (parsed && parsed !== "legacy") {
            slots[parsed].push(from);
            return;
        }
        // 旧 context 或无 handle：启发式
        if (!connection.toHandleId || STORYBOARD_LEGACY_CONTEXT_HANDLES.has(connection.toHandleId)) {
            const migrated = migrateLegacySlot(from);
            if (migrated === "legacy") slots.legacyContext.push(from);
            else slots[migrated].push(from);
            return;
        }
        slots.legacyContext.push(from);
    });

    return {
        story: uniqueNodes(slots.story),
        characters: uniqueNodes(slots.characters),
        background: uniqueNodes(slots.background),
        style: uniqueNodes(slots.style),
        props: uniqueNodes(slots.props),
        legacyContext: uniqueNodes(slots.legacyContext),
    };
}

/** 把旧 context 连接的 toHandleId 写回建议槽，便于 UI 白盒 */
export function migrateStoryboardContextConnections(
    scriptNodeId: string,
    nodes: CanvasNodeData[],
    connections: CanvasConnection[],
): CanvasConnection[] {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    let changed = false;
    const next = connections.map((connection) => {
        if (connection.toNodeId !== scriptNodeId) return connection;
        if (connection.toHandleId?.startsWith("row:")) return connection;
        if (isStoryboardSlotHandle(connection.toHandleId)) return connection;
        if (connection.toHandleId && !STORYBOARD_LEGACY_CONTEXT_HANDLES.has(connection.toHandleId)) return connection;
        const from = nodeById.get(connection.fromNodeId);
        if (!from) return connection;
        const slot = migrateLegacySlot(from);
        if (slot === "legacy") return connection;
        changed = true;
        return { ...connection, toHandleId: STORYBOARD_SLOT_HANDLE[slot] };
    });
    return changed ? next : connections;
}

export function resolveStoryboardInputPolicy(policy?: StoryboardInputPolicy): Required<StoryboardInputPolicy> {
    return {
        backgroundToActionBoard: policy?.backgroundToActionBoard !== false,
        backgroundToImage: policy?.backgroundToImage !== false,
        backgroundToVideo: policy?.backgroundToVideo !== false,
        styleToActionBoard: policy?.styleToActionBoard !== false,
        styleToImage: policy?.styleToImage !== false,
        styleToVideo: policy?.styleToVideo !== false,
        propsToActionBoard: policy?.propsToActionBoard !== false,
        propsToImage: policy?.propsToImage !== false,
        propsToVideo: policy?.propsToVideo !== false,
    };
}

function policyAllows(stage: StoryboardDownstreamStage, slot: "background" | "style" | "props", policy: Required<StoryboardInputPolicy>) {
    if (slot === "background") {
        if (stage === "action_board") return policy.backgroundToActionBoard;
        if (stage === "image") return policy.backgroundToImage;
        return policy.backgroundToVideo;
    }
    if (slot === "style") {
        if (stage === "action_board") return policy.styleToActionBoard;
        if (stage === "image") return policy.styleToImage;
        return policy.styleToVideo;
    }
    if (stage === "action_board") return policy.propsToActionBoard;
    if (stage === "image") return policy.propsToImage;
    return policy.propsToVideo;
}

function characterReferenceNodeIds(row: StoryboardRow, nodes: CanvasNodeData[]) {
    const assetIds = new Set(row.characters.map((character) => character.characterAssetId).filter((assetId): assetId is string => Boolean(assetId)));
    return nodes
        .filter((node) => node.metadata?.workflowKind === "character" && Boolean(node.metadata.characterAssetId) && assetIds.has(node.metadata.characterAssetId!))
        .map((node) => node.id);
}

/**
 * 下游（动作板 / 分镜图 / 视频）应连上的参考 nodeId。
 * - 角色：恒送
 * - 正文：恒不送
 * - 背景 / 画风 / 道具：按 policy
 * - 行级入边：恒送
 */
export function resolveStoryboardDownstreamRefs(options: {
    stage: StoryboardDownstreamStage;
    scriptNode: CanvasNodeData;
    row: StoryboardRow;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    includeFirstFrame?: boolean;
}): string[] {
    const { stage, scriptNode, row, nodes, connections, includeFirstFrame } = options;
    const policy = resolveStoryboardInputPolicy(scriptNode.metadata?.storyboardInputPolicy);
    const slots = collectStoryboardInputSlots(scriptNode.id, nodes, connections);
    const ids = new Set<string>();

    // 角色：槽内 + 行内 characterAsset 对应节点
    slots.characters.forEach((node) => ids.add(node.id));
    characterReferenceNodeIds(row, nodes).forEach((id) => ids.add(id));

    if (policyAllows(stage, "background", policy)) {
        slots.background.forEach((node) => ids.add(node.id));
    }
    if (policyAllows(stage, "style", policy)) {
        slots.style.forEach((node) => ids.add(node.id));
    }
    if (policyAllows(stage, "props", policy)) {
        slots.props.forEach((node) => ids.add(node.id));
        // legacy 未归类图也当作 props 侧可选参考，避免旧画布丢图
        slots.legacyContext
            .filter((node) => node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Drawing)
            .forEach((node) => ids.add(node.id));
    }

    // 行级额外参考
    (row.referenceNodeIds || []).forEach((id) => ids.add(id));
    connections
        .filter((connection) => connection.toNodeId === scriptNode.id && connection.toHandleId === `row:${row.id}`)
        .forEach((connection) => ids.add(connection.fromNodeId));

    if (includeFirstFrame && row.imageNodeId) ids.add(row.imageNodeId);
    if (!includeFirstFrame && row.imageNodeId) ids.delete(row.imageNodeId);

    ids.delete(scriptNode.id);
    // 正文槽永不进下游
    slots.story.forEach((node) => ids.delete(node.id));

    return Array.from(ids);
}

/** plan 阶段可用的文本/资产节点（不含「仅图片道具」时仍列入 props 供 canvasAssets） */
export function storyboardPlanAssetNodes(slots: StoryboardInputSlots): CanvasNodeData[] {
    return uniqueNodes([
        ...slots.story,
        ...slots.characters,
        ...slots.background,
        ...slots.style,
        ...slots.props,
        ...slots.legacyContext,
    ]);
}

/** composer 左侧五口纵向布局：相对 composer 顶的偏移比例 */
export function storyboardSlotHandleLocalTops(composerHeight: number): Record<StoryboardInputSlot, number> {
    const h = Math.max(composerHeight, 80);
    const step = h / (STORYBOARD_INPUT_SLOTS.length + 1);
    return {
        story: step * 1,
        characters: step * 2,
        background: step * 3,
        style: step * 4,
        props: step * 5,
    };
}

export function storyboardSlotHandleWorldY(node: CanvasNodeData, slot: StoryboardInputSlot) {
    const composerHeight = node.metadata?.storyboardComposerHeight || 104;
    const tops = storyboardSlotHandleLocalTops(composerHeight);
    const composerTop = node.height - composerHeight;
    return node.position.y + composerTop + tops[slot];
}

/** 按世界坐标 Y 选最近五槽 handle；composer 外返回 null */
export function nearestStoryboardSlotHandle(node: CanvasNodeData, worldY: number, margin = 12): string | null {
    const composerHeight = node.metadata?.storyboardComposerHeight || 104;
    const composerTop = node.height - composerHeight;
    const composerWorldTop = node.position.y + composerTop;
    const composerWorldBottom = node.position.y + node.height;
    if (worldY < composerWorldTop - margin || worldY > composerWorldBottom + margin) return null;
    let bestSlot = STORYBOARD_INPUT_SLOTS[0];
    let bestDist = Number.POSITIVE_INFINITY;
    for (const slot of STORYBOARD_INPUT_SLOTS) {
        const dist = Math.abs(worldY - storyboardSlotHandleWorldY(node, slot));
        if (dist < bestDist) {
            bestDist = dist;
            bestSlot = slot;
        }
    }
    return STORYBOARD_SLOT_HANDLE[bestSlot];
}

export function storyboardInputSlotSummary(slots: StoryboardInputSlots) {
    return STORYBOARD_INPUT_SLOTS.map((slot) => ({
        slot,
        label: STORYBOARD_SLOT_LABEL[slot],
        count: slots[slot].length,
        titles: slots[slot].map((node) => node.metadata?.characterName || node.title || node.id).slice(0, 4),
    }));
}
