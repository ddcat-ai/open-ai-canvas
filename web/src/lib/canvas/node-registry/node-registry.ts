import type { CanvasNodeData, CanvasNodeType } from "@/types/canvas";

import type { CanvasNodeDefinition } from "./node-definition";

/** 模块级注册表 */
const definitions = new Map<CanvasNodeType, CanvasNodeDefinition>();
/** 节点类型 → 归属方。内置节点归属 "builtin"，为后续扩展留出隔离位。 */
const ownerByType = new Map<CanvasNodeType, string>();

/** 未注册类型的兜底最小尺寸——与非媒体节点的历史下限一致 */
const FALLBACK_MIN_SIZE = { width: 220, height: 160 } as const;

/** 批量注册节点定义 */
export function registerNodeDefinitions(defs: CanvasNodeDefinition[], ownerId = "builtin") {
    for (const def of defs) {
        definitions.set(def.type, def);
        ownerByType.set(def.type, ownerId);
    }
}

/**
 * 注销某归属方的全部节点定义。
 * 只删归属该 ownerId 的条目——内置节点不会被其他归属方的增删波及。
 */
export function unregisterNodeDefinitions(ownerId: string) {
    for (const [type, owner] of ownerByType) {
        if (owner !== ownerId) continue;
        definitions.delete(type);
        ownerByType.delete(type);
    }
}

export function getNodeDefinition(type: CanvasNodeType) {
    return definitions.get(type);
}

export function getNodeOwnerId(type: CanvasNodeType) {
    return ownerByType.get(type) || "builtin";
}

export function listNodeDefinitions() {
    return [...definitions.values()];
}

/** 添加节点菜单可见的节点定义 */
export function listCreatableNodeDefinitions() {
    return listNodeDefinitions().filter((def) => def.showInCreateMenu);
}

/** UI 短标签 */
export function getNodeLabel(type: CanvasNodeType) {
    return definitions.get(type)?.label || "未知节点";
}

/** 列表/搜索标签，缺省派生自 label */
export function getNodeListLabel(type: CanvasNodeType) {
    const def = definitions.get(type);
    if (!def) return "未知节点";
    return def.listLabel || `${def.label}节点`;
}

export function getNodeIcon(type: CanvasNodeType) {
    return definitions.get(type)?.icon ?? null;
}

/** 手动拉伸的最小尺寸 */
export function getNodeMinSize(type: CanvasNodeType) {
    return definitions.get(type)?.minSize ?? FALLBACK_MIN_SIZE;
}

/** 拉伸时是否锁定宽高比 */
export function shouldKeepAspectRatio(node: CanvasNodeData) {
    return definitions.get(node.type)?.keepAspectRatio?.(node) ?? false;
}
