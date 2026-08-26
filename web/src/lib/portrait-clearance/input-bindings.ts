import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

import type { PortraitClearanceInputBinding, PortraitClearanceInputRole, PortraitClearanceMode } from "./contracts";

/**
 * 连接顺序只作为旧画布的迁移兜底。已有 role 永远优先保留，避免渲染顺序变化
 * 导致 query/reference 被静默交换。
 */
export function reconcilePortraitClearanceInputBindings(
    mode: PortraitClearanceMode,
    clearanceNodeId: string,
    connections: readonly CanvasConnection[],
    nodes: readonly CanvasNodeData[],
    existing: readonly PortraitClearanceInputBinding[] = [],
): PortraitClearanceInputBinding[] {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const connectedIds = connections
        .filter((connection) => connection.toNodeId === clearanceNodeId)
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((connection) => connection.fromNodeId)
        .filter((nodeId, index, all) => all.indexOf(nodeId) === index)
        .filter((nodeId) => {
            const node = nodeById.get(nodeId);
            return isPortraitImageInput(node);
        });
    const connected = new Set(connectedIds);
    const result: PortraitClearanceInputBinding[] = [];
    const usedRoles = new Set<PortraitClearanceInputRole>();

    for (const binding of existing) {
        if (!connected.has(binding.nodeId) || result.some((item) => item.nodeId === binding.nodeId)) continue;
        const role = normalizeRole(mode, binding.role, usedRoles);
        if (!role) continue;
        result.push({ nodeId: binding.nodeId, role });
        usedRoles.add(role);
    }

    for (const nodeId of connectedIds) {
        if (result.some((item) => item.nodeId === nodeId)) continue;
        const role = nextRole(mode, usedRoles);
        if (!role) break;
        result.push({ nodeId, role });
        usedRoles.add(role);
    }

    return result;
}

export function swapPortraitClearanceDirectBindings(bindings: readonly PortraitClearanceInputBinding[]) {
    return bindings.map((binding) => binding.role === "query"
        ? { ...binding, role: "reference" as const }
        : binding.role === "reference"
            ? { ...binding, role: "query" as const }
            : binding);
}

export function portraitInputBindingForRole(bindings: readonly PortraitClearanceInputBinding[], role: PortraitClearanceInputRole) {
    return bindings.find((binding) => binding.role === role)?.nodeId;
}

function normalizeRole(mode: PortraitClearanceMode, role: PortraitClearanceInputRole, used: ReadonlySet<PortraitClearanceInputRole>) {
    if (mode === "direct-compare" && role === "candidate") return nextRole(mode, used);
    if (used.has(role)) return nextRole(mode, used);
    return role;
}

function nextRole(mode: PortraitClearanceMode, used: ReadonlySet<PortraitClearanceInputRole>): PortraitClearanceInputRole | null {
    if (!used.has("query")) return "query";
    if (mode === "direct-compare" && !used.has("reference")) return "reference";
    if (mode === "network-search") return "candidate";
    return null;
}

export function isPortraitImageInput(node: CanvasNodeData | undefined) {
    return Boolean(node && node.type === CanvasNodeType.Image && (node.metadata?.content || node.metadata?.storageKey));
}
