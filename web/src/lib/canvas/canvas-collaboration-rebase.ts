import { canonicalize } from "json-canonicalize";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

export function collaborationValueEqual(a: unknown, b: unknown): boolean {
    return a === b || canonicalize(a ?? null) === canonicalize(b ?? null);
}

export type CollaborationFieldConflict = { path: string; before: unknown; mine: unknown; latest: unknown };

export function mergeCollaborationValue(before: unknown, mine: unknown, latest: unknown, path: string, deep: boolean, conflict: (value: CollaborationFieldConflict) => unknown): unknown {
    if (collaborationValueEqual(before, mine)) return latest;
    if (collaborationValueEqual(before, latest) || collaborationValueEqual(mine, latest)) return mine;
    const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
    if (deep && (before == null || object(before)) && object(mine) && object(latest)) {
        const base = (before ?? {}) as Record<string, unknown>;
        const keys = new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(latest)]);
        if (![...keys].some((key) => key.includes(".") || ["__proto__", "constructor", "prototype"].includes(key))) {
            const merged: Record<string, unknown> = { ...latest };
            for (const key of keys) {
                const value = mergeCollaborationValue(base[key], mine[key], latest[key], path + "." + key, true, conflict);
                if (value === undefined) delete merged[key];
                else merged[key] = value;
            }
            return merged;
        }
    }
    return conflict({ path, before, mine, latest });
}

export function setCollaborationField(object: Record<string, unknown>, path: string[], value: unknown) {
    if (!path.length || path.some((key) => ["__proto__", "constructor", "prototype"].includes(key))) return;
    let target = object;
    for (const key of path.slice(0, -1)) {
        const child = target[key];
        target[key] = child && typeof child === "object" && !Array.isArray(child) ? { ...child } : {};
        target = target[key] as Record<string, unknown>;
    }
    const key = path[path.length - 1];
    if (value === undefined) delete target[key];
    else target[key] = structuredClone(value);
}

/** Replays local intent over confirmed content, retaining local conflicts.
 * Field boundaries match the server: geometry and arrays are atomic;
 * metadata objects merge at individual leaves.
 * A conflicting graph stays local until the existing resolver preserves it.
 */
export function rebaseCanvasCollaborationProject(base: CanvasProject, local: CanvasProject, remote: CanvasProject) {
    const conflicts: string[] = [];
    const mergeValue = (before: unknown, mine: unknown, latest: unknown, path: string) => {
        if (collaborationValueEqual(before, mine)) return latest;
        if (!collaborationValueEqual(before, latest) && !collaborationValueEqual(mine, latest)) conflicts.push(path);
        return mine;
    };
    const mergeEntities = <T extends { id: string }>(before: T[], mine: T[], latest: T[], scope: string): T[] => {
        const bases = new Map(before.map((item) => [item.id, item]));
        const locals = new Map(mine.map((item) => [item.id, item]));
        const remotes = new Map(latest.map((item) => [item.id, item]));
        const output: T[] = [];
        for (const id of new Set([...latest.map((item) => item.id), ...mine.map((item) => item.id), ...bases.keys()])) {
            const b = bases.get(id),
                l = locals.get(id),
                r = remotes.get(id);
            if (collaborationValueEqual(b, l)) {
                if (r) output.push(r);
                continue;
            }
            if (!b || !l || !r) {
                const value = mergeValue(b, l, r, scope + "." + id) as T | undefined;
                if (value) output.push(value);
                continue;
            }
            if (scope === "nodes") {
                const incarnation = (v: T) => (v as unknown as { metadata?: Record<string, unknown> }).metadata?.collaborationIncarnation ?? 1;
                if (incarnation(b) !== incarnation(r)) conflicts.push(scope + "." + id + ".incarnation");
            }
            const merged = { ...r } as Record<string, unknown>;
            for (const key of new Set([...Object.keys(b), ...Object.keys(l)])) {
                if (["id", "createdAt", "updatedAt"].includes(key)) continue;
                merged[key] = mergeCollaborationValue((b as Record<string, unknown>)[key], (l as Record<string, unknown>)[key], (r as Record<string, unknown>)[key], scope + "." + id + "." + key, key === "metadata", ({ path, mine }) => {
                    conflicts.push(path);
                    return mine;
                });
            }
            output.push(collaborationValueEqual(merged, l) ? l : collaborationValueEqual(merged, r) ? r : (merged as T));
        }
        return collaborationValueEqual(output, mine) ? mine : collaborationValueEqual(output, latest) ? latest : output;
    };
    const project = { ...remote, viewport: local.viewport };
    for (const key of ["title", "projectId", "chatSessions", "activeChatId", "starterMode", "appearance", "backgroundMode", "showImageInfo", "directorScenes", "timeline"] as const) {
        (project as Record<string, unknown>)[key] = mergeValue(base[key], local[key], remote[key], key);
    }
    project.nodes = mergeEntities(base.nodes, local.nodes, remote.nodes, "nodes");
    project.connections = mergeEntities(base.connections, local.connections, remote.connections, "connections");
    const ids = new Set(project.nodes.map((node) => node.id));
    if (project.connections.some((edge) => !ids.has(edge.fromNodeId) || !ids.has(edge.toNodeId))) conflicts.push("connections.endpoints");
    // A deletion depends on all incident relations, including ones added remotely.
    const localIds = new Set(local.nodes.map((node) => node.id));
    for (const node of base.nodes) {
        if (localIds.has(node.id)) continue;
        const incident = (p: CanvasProject) => p.connections.filter((e) => e.fromNodeId === node.id || e.toNodeId === node.id);
        if (!collaborationValueEqual(incident(base), incident(remote))) conflicts.push("nodes." + node.id + ".relations");
    }
    return { project, conflicts };
}
