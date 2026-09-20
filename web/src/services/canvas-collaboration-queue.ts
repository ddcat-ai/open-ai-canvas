import { localForageStorageForScope } from "@/lib/localforage-storage";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import type { CanvasCollaborationOperation } from "@/services/api/canvas-collaboration";

export type CanvasCollaborationQueue = {
    base: CanvasProject;
    source: CanvasProject;
    target: CanvasProject;
    confirmed: CanvasProject;
    pending: CanvasCollaborationOperation[];
    blocked?: boolean;
};

const key = (id: string) => "infinite-canvas:collaboration-queue:" + id;
const tails = new Map<string, Promise<unknown>>();

export async function readCanvasCollaborationQueue(scope: string, id: string): Promise<CanvasCollaborationQueue | null> {
    const raw = await localForageStorageForScope(scope).getItem(key(id));
    return raw ? JSON.parse(raw) : null;
}

export async function writeCanvasCollaborationQueue(scope: string, id: string, queue: CanvasCollaborationQueue | null) {
    // An explicit null also works with storage adapters without removeItem.
    await localForageStorageForScope(scope).setItem(key(id), JSON.stringify(queue));
}

/** One drain per account/canvas, including other browser tabs. Storage writes
 * and network sends share this lock so the head cannot be sent with a new ID.
 */
export async function withCanvasCollaborationQueueLock<T>(scope: string, id: string, work: () => Promise<T>): Promise<T> {
    const name = "canvas-collaboration-queue:" + scope + ":" + id;
    const previous = tails.get(name) ?? Promise.resolve();
    const pending = previous
        .catch(() => undefined)
        .then(() => {
            const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
            return locks ? locks.request(name, work) : work();
        });
    tails.set(name, pending);
    try {
        return await pending;
    } finally {
        if (tails.get(name) === pending) tails.delete(name);
    }
}
