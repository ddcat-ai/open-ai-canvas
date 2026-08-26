import type { CanvasNodeData, CanvasNodeTypeId } from "@/types/canvas";
import type { PluginCanvasNodeContribution } from "@/lib/plugins/plugin-types";

import { canvasNodeDefinitionFromPlugin, type CanvasNodeDefinition } from "./node-definition";

/** 模块级注册表 */
const definitions = new Map<CanvasNodeTypeId, CanvasNodeDefinition>();
/** 节点类型 → 归属方。内置节点归属 "builtin"，为后续扩展留出隔离位。 */
const ownerByType = new Map<CanvasNodeTypeId, string>();

/** 未注册类型的兜底最小尺寸——与非媒体节点的历史下限一致 */
const FALLBACK_MIN_SIZE = { width: 220, height: 160 } as const;

/** 批量注册节点定义 */
export function registerNodeDefinitions(defs: CanvasNodeDefinition[], ownerId = "builtin") {
    for (const def of defs) {
        definitions.set(def.type, def);
        ownerByType.set(def.type, ownerId);
    }
}

/** Registers schema-driven canvas nodes from the unified plugin manifest. */
export function registerPluginCanvasNodes(pluginId: string, nodes: PluginCanvasNodeContribution[]) {
    registerNodeDefinitions(nodes.map((node) => canvasNodeDefinitionFromPlugin(pluginId, node)), pluginId);
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

export function getNodeDefinition(type: CanvasNodeTypeId) {
    return definitions.get(type);
}

export function getNodeOwnerId(type: CanvasNodeTypeId) {
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
export function getNodeLabel(type: CanvasNodeTypeId) {
    return definitions.get(type)?.label || "未知节点";
}

/** 列表/搜索标签，缺省派生自 label */
export function getNodeListLabel(type: CanvasNodeTypeId) {
    const def = definitions.get(type);
    if (!def) return "未知节点";
    return def.listLabel || `${def.label}节点`;
}

export function getNodeIcon(type: CanvasNodeTypeId) {
    return definitions.get(type)?.icon ?? null;
}

/** 手动拉伸的最小尺寸 */
export function getNodeMinSize(type: CanvasNodeTypeId) {
    return definitions.get(type)?.minSize ?? FALLBACK_MIN_SIZE;
}

/** 拉伸时是否锁定宽高比 */
export function shouldKeepAspectRatio(node: CanvasNodeData) {
    return definitions.get(node.type)?.keepAspectRatio?.(node) ?? false;
}

/**
 * 该节点作为 @ 引用素材时的类型，非素材返回 null。
 * 只按类型判定——角色卡那类跨类型覆盖由调用方在此之前处理。
 */
export function getNodeResourceKind(node: CanvasNodeData) {
    return definitions.get(node.type)?.resourceKind?.(node) ?? null;
}

/** 该节点作为生成节点时的生成模式，不产生生成行为返回 null */
export function getNodeGenerationMode(node: CanvasNodeData) {
    return definitions.get(node.type)?.generationMode?.(node) ?? null;
}

/** 该节点作为上游输入被计数时的类别，不参与计数返回 undefined */
export function getNodeInputKind(type: CanvasNodeTypeId) {
    return definitions.get(type)?.inputKind;
}
