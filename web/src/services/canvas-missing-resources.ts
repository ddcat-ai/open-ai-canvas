import { refreshResource, type RemoteResource } from "@/services/api/resources";
import { ApiError } from "@/services/api/request";
import { preserveCanvasSyncDraft } from "@/services/canvas-sync-drafts";
import { getActiveUserScope } from "@/lib/user-scope";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";

// Keep these fields aligned with internal/assets/references.go. Prompts and
// ordinary text containing a resource URL are not media locators.
const locatorFields = new Set([
    "storageKey",
    "content",
    "previewContent",
    "drawingPreviewStorageKey",
    "drawingPreviewUrl",
    "url",
    "dataUrl",
    "coverUrl",
    "imageUrl",
    "videoUrl",
    "audioUrl",
    "referenceUrl",
    "referenceUrls",
    "artifactRef",
    "providerArtifactRef",
]);
const idFields = new Set(["resourceId", "resourceIds", "sampleResourceId", "referenceResourceId", "referenceResourceIds"]);
const textFields = new Set(["prompt", "composerContent", "title", "text", "description", "fileName", "name"]);

function resourceId(field: string, value: unknown, allowUnknownField = false): string | undefined {
    if (typeof value !== "string") return;
    const text = value.trim();
    if (idFields.has(field)) return /^[A-Za-z0-9_-]{1,80}$/.test(text) ? text : undefined;
    if ((!locatorFields.has(field) && !allowUnknownField) || textFields.has(field)) return;
    return /^resource:([A-Za-z0-9_-]{1,80})$/.exec(text)?.[1] || /^(?:https?:\/\/[^/]+)?\/(?:api\/)?resources\/([A-Za-z0-9_-]{1,80})\/file(?:[?#].*)?$/.exec(text)?.[1];
}

export function canvasResourceIds(value: unknown, field = "", ids = new Set<string>()): Set<string> {
    const id = resourceId(field, value);
    if (id) ids.add(id);
    else if (Array.isArray(value)) for (const child of value) canvasResourceIds(child, field, ids);
    else if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) canvasResourceIds(child, key, ids);
    return ids;
}

/** Only called after explicit overwrite and a durable backup of the original. */
export function clearMissingCanvasResources<T>(value: T, missing: ReadonlySet<string>, field = "", allowUnknownField = false): T {
    const id = resourceId(field, value, allowUnknownField);
    if (id && missing.has(id)) return undefined as T;
    if (Array.isArray(value)) return value.map((child) => clearMissingCanvasResources(child, missing, field, allowUnknownField)).filter((child) => child !== undefined) as T;
    if (!value || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(record)) {
        const cleaned = clearMissingCanvasResources(child, missing, key, allowUnknownField);
        if (cleaned !== undefined) next[key] = cleaned;
    }
    if (
        ["storageKey", "content", "url", "dataUrl"].some((key) => {
            const id = resourceId(key, record[key], allowUnknownField);
            return id && missing.has(id);
        })
    )
        delete next.assetId;
    if (["image", "video", "audio"].includes(String(record.type)) && next.metadata && typeof next.metadata === "object") {
        const metadata = next.metadata as Record<string, unknown>;
        if (!metadata.storageKey && !metadata.content && canvasResourceIds(record.metadata).size > canvasResourceIds(metadata).size) {
            metadata.status = "idle";
        }
    }
    return next as T;
}

export async function repairMissingResourcesForOverwrite(
    projectIds?: Set<string>,
    lookup: (id: string) => Promise<RemoteResource> = refreshResource,
    preserve: (project: CanvasProject, scope: string) => Promise<unknown> = preserveCanvasSyncDraft,
): Promise<number> {
    const scope = getActiveUserScope();
    const selected = (project: CanvasProject) => !projectIds || projectIds.has(project.id);
    const ids = [...canvasResourceIds(useCanvasStore.getState().projects.filter(selected))];
    const missing = new Set<string>();
    for (let offset = 0; offset < ids.length; offset += 8) {
        await Promise.all(
            ids.slice(offset, offset + 8).map(async (id) => {
                try {
                    const resource = await lookup(id);
                    if (resource.status === "deleted" || resource.status === "failed") missing.add(id);
                    else if (resource.status !== "ready") throw new Error("素材仍在上传，请完成后再保存");
                } catch (error) {
                    if (error instanceof ApiError && error.status === 404) missing.add(id);
                    else throw error;
                }
            }),
        );
    }
    if (getActiveUserScope() !== scope) throw new Error("账号已切换，已停止修复保存");
    if (!missing.size) return 0;
    await clearMissingCanvasResourceIdsForOverwrite(projectIds, missing, preserve);
    return missing.size;
}

/** Server validation is authoritative. This fallback handles locator shapes
 * added on the server before the client collector knows about them. */
export async function clearMissingCanvasResourceIdsForOverwrite(projectIds: Set<string> | undefined, missing: ReadonlySet<string>, preserve: (project: CanvasProject, scope: string) => Promise<unknown> = preserveCanvasSyncDraft): Promise<number> {
    const scope = getActiveUserScope();
    const selected = (project: CanvasProject) => !projectIds || projectIds.has(project.id);
    const projects = useCanvasStore.getState().projects.filter(selected);
    for (const project of projects) await preserve(project, scope);
    if (getActiveUserScope() !== scope) throw new Error("账号已切换，已停止修复保存");
    if (projects.some((project) => useCanvasStore.getState().openProject(project.id) !== project)) throw new Error("画布仍在编辑，请重新点击覆盖保存");
    const repaired = new Map(projects.map((project) => [project.id, { ...clearMissingCanvasResources(project, missing, "", true), updatedAt: new Date().toISOString() }]));
    useCanvasStore.setState((state) => ({ projects: state.projects.map((project) => repaired.get(project.id) ?? project) }));
    return projects.length;
}
