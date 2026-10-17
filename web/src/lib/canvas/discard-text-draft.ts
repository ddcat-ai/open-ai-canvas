import { canonicalize } from "json-canonicalize";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { mergeAgentCanvasEditor } from "./agent-canvas-patch";

function textPaths(type: string) {
    const paths = [["title"], ["metadata", "prompt"], ["metadata", "composerContent"], ["metadata", "generationSpec", "prompt"]];
    if (["text", "markdown", "script"].includes(type)) paths.push(["metadata", "content"], ["metadata", "richText"]);
    return paths;
}

function valueAt(object: unknown, path: string[]) {
    let value = object;
    for (const key of path) value = (value as Record<string, unknown> | undefined)?.[key];
    return value;
}

export function conflictingCanvasTextNodes(baseline: CanvasProject, remote: CanvasProject, local: CanvasProject) {
    return local.nodes
        .filter((node) => {
            const before = baseline.nodes.find((item) => item.id === node.id);
            const after = remote.nodes.find((item) => item.id === node.id);
            if (!before || !after || before.type !== node.type || after.type !== node.type) return false;
            return textPaths(node.type).some((path) => {
                const b = canonicalize(valueAt(before, path));
                return b !== canonicalize(valueAt(after, path)) && b !== canonicalize(valueAt(node, path));
            });
        })
        .map((node) => node.id);
}

// Only lease-protected text can use cloud-wins recovery. Media results, positions
// and other local edits still use the normal conflict-detecting three-way merge.
export function discardRejectedCanvasText(baseline: CanvasProject, remote: CanvasProject, local: CanvasProject, rejected: readonly string[], resolveTextConflicts = false) {
    const before = structuredClone(baseline);
    const current = structuredClone(local);
    const discarded: string[] = [];
    const targets = new Set([...rejected, ...(resolveTextConflicts ? conflictingCanvasTextNodes(baseline, remote, local) : [])]);
    for (const currentNode of current.nodes) {
        const beforeNode = before.nodes.find((node) => node.id === currentNode.id);
        const remoteNode = remote.nodes.find((node) => node.id === currentNode.id);
        if (!beforeNode || !remoteNode || beforeNode.type !== remoteNode.type || currentNode.type !== remoteNode.type) continue;
        const paths = textPaths(currentNode.type);
        if (!targets.has(currentNode.id)) continue;
        discarded.push(currentNode.id);
        for (const path of paths) {
            const value = valueAt(remoteNode, path);
            for (const node of [beforeNode, currentNode]) {
                let target = node as unknown as Record<string, unknown>;
                let missing = false;
                for (const key of path.slice(0, -1)) {
                    if (!target[key] || typeof target[key] !== "object") {
                        if (value === undefined) {
                            missing = true;
                            break;
                        }
                        target[key] = {};
                    }
                    target = target[key] as Record<string, unknown>;
                }
                if (missing) continue;
                const key = path[path.length - 1];
                if (value === undefined) delete target[key];
                else target[key] = structuredClone(value);
            }
        }
    }
    if (!discarded.length) return undefined;
    return { project: mergeAgentCanvasEditor(before, remote, current.nodes, current.connections, current), discarded };
}
