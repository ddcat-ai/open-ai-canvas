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
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].every((key) => a[key] === b[key] || canonicalize(a[key]) === canonicalize(b[key]));
}

export async function canvasContentHash(project: CanvasProject) {
    const serialized = canonicalize(canvasContentSnapshot(project));
    // LAN HTTP deployments may lack Web Crypto. Keep an exact baseline there;
    // a lossy checksum could incorrectly discard an unsaved draft during login.
    if (!globalThis.crypto?.subtle) return `json:${serialized}`;
    const bytes = new TextEncoder().encode(serialized);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}
