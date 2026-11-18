import { resourceFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import type { Asset } from "@/stores/use-asset-store";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

export type WorkResourceOption = { id: string; title: string; kind: "image" | "video"; url: string };
export function communityWorkSharePath(id: string) {
    return `/share/work/${encodeURIComponent(id)}`;
}

export function workResourceOptions(assets: readonly Asset[], project?: CanvasProject): WorkResourceOption[] {
    const options = new Map<string, WorkResourceOption>();
    const add = (key: string | undefined, title: string, kind: string) => {
        const id = resourceIdFromStorageKey(key);
        if (id && (kind === "image" || kind === "video")) options.set(id, { id, title, kind, url: resourceFileUrl(id) });
    };
    for (const asset of assets) if (asset.kind === "image" || asset.kind === "video") add(asset.data.storageKey, asset.title, asset.kind);
    for (const node of project?.nodes || []) add(node.metadata?.storageKey, node.title || node.type, node.type);
    return [...options.values()];
}

export function workReturnTarget(state: unknown): { to: string; state?: unknown } {
    const value = state && typeof state === "object" ? (state as { returnTo?: unknown; returnState?: unknown }) : {};
    return typeof value.returnTo === "string" && value.returnTo.startsWith("/") && !value.returnTo.startsWith("//") && !value.returnTo.startsWith("/my/works") ? { to: value.returnTo, state: value.returnState } : { to: "/" };
}
