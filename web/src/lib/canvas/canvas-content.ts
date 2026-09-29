import { canonicalize } from "json-canonicalize";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

// These fields describe local viewing / synchronization, not an edit to the document.
export function canvasContentSnapshot(project: CanvasProject) {
    const { viewport: _viewport, updatedAt: _updatedAt, revision: _revision, remoteContentHash: _hash, ...content } = project;
    return { ...content, projectId: content.projectId || undefined };
}

export function sameCanvasContent(left: CanvasProject | undefined, right: CanvasProject | undefined) {
    if (left === right) return true;
    if (!left || !right) return false;
    const a = canvasContentSnapshot(left) as Record<string, unknown>;
    const b = canvasContentSnapshot(right) as Record<string, unknown>;
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].every((key) => {
        if (a[key] === b[key]) return true;
        if ((key === "nodes" || key === "connections") && Array.isArray(a[key]) && Array.isArray(b[key])) {
            const leftItems = a[key] as unknown[];
            const rightItems = b[key] as unknown[];
            return leftItems.length === rightItems.length && leftItems.every((item, index) => item === rightItems[index] || canonicalValue(item) === canonicalValue(rightItems[index]));
        }
        return canonicalValue(a[key]) === canonicalValue(b[key]);
    });
}

type ContentSnapshot = ReturnType<typeof canvasContentSnapshot>;
const contentHashes = new WeakMap<CanvasProject["nodes"], { content: ContentSnapshot; hash: Promise<string> }>();
// Canvas content trees are immutable, so unchanged node objects can reuse their serialized comparison value.
const canonicalValueCache = new WeakMap<object, string>();

function canonicalValue(value: unknown) {
    if (!value || typeof value !== "object") return canonicalize(value);
    const cached = canonicalValueCache.get(value);
    if (cached) return cached;
    const serialized = canonicalize(value);
    canonicalValueCache.set(value, serialized);
    return serialized;
}

// Store updates are immutable. Reuse a hash across viewport/revision-only copies;
// any content field/reference change invalidates it. Weak keys bound its lifetime.
export function canvasContentHash(project: CanvasProject): Promise<string> {
    const content = canvasContentSnapshot(project);
    const cached = contentHashes.get(project.nodes);
    if (cached && sameContentReferences(cached.content, content)) return cached.hash;
    const hash = hashContent(content);
    contentHashes.set(project.nodes, { content, hash });
    void hash.catch(() => {
        if (contentHashes.get(project.nodes)?.hash === hash) contentHashes.delete(project.nodes);
    });
    return hash;
}

function sameContentReferences(a: ContentSnapshot, b: ContentSnapshot) {
    const keys = Object.keys(a) as (keyof ContentSnapshot)[];
    return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

async function hashContent(content: ContentSnapshot) {
    const serialized = canonicalize(content);
    // LAN HTTP deployments may lack Web Crypto. Keep an exact baseline there;
    // a lossy checksum could incorrectly discard an unsaved draft during login.
    if (!globalThis.crypto?.subtle) return `json:${serialized}`;
    const bytes = new TextEncoder().encode(serialized);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}
