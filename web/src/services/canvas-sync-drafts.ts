import { nanoid } from "nanoid";
import { localForageStorageForScope } from "@/lib/localforage-storage";
import { getActiveUserScope } from "@/lib/user-scope";
import { sameCanvasContent } from "@/lib/canvas/canvas-content";
import { withCanvasStorePersistenceLock, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { withGenerationArtifactCommitLock } from "@/services/generation-asset-repository";

export type CanvasSyncDraft = { id: string; savedAt: string; project: CanvasProject };
const draftKey = (projectId: string) => `infinite-canvas:sync-drafts:${projectId}`;
const draftIndexKey = "infinite-canvas:sync-draft-index";

export async function readAllCanvasSyncDrafts(scope = getActiveUserScope()) {
    const raw = await localForageStorageForScope(scope).getItem(draftIndexKey);
    const ids: string[] = raw ? JSON.parse(raw) : [];
    return (await Promise.all(ids.map((id) => readCanvasSyncDrafts(id, scope)))).flat();
}

export async function readCanvasSyncDrafts(projectId: string, scope = getActiveUserScope()): Promise<CanvasSyncDraft[]> {
    const raw = await localForageStorageForScope(scope).getItem(draftKey(projectId));
    return raw ? JSON.parse(raw) : [];
}

export async function preserveCanvasSyncDraft(project: CanvasProject, scope = getActiveUserScope()) {
    // A separate record survives replacement of the active canvas and a browser reload.
    const snapshot = structuredClone(project);
    return withGenerationArtifactCommitLock(scope, () =>
        withCanvasStorePersistenceLock(scope, async () => {
            const drafts = await readCanvasSyncDrafts(snapshot.id, scope);
            if (!drafts.some((draft) => sameCanvasContent(draft.project, snapshot))) {
                const storage = localForageStorageForScope(scope);
                const rawIndex = await storage.getItem(draftIndexKey);
                const ids: string[] = rawIndex ? JSON.parse(rawIndex) : [];
                if (!ids.includes(snapshot.id)) await storage.setItem(draftIndexKey, JSON.stringify([...ids, snapshot.id]));
                drafts.push({ id: nanoid(), savedAt: new Date().toISOString(), project: snapshot });
                await storage.setItem(draftKey(snapshot.id), JSON.stringify(drafts));
            }
            return drafts.length;
        }),
    );
}
