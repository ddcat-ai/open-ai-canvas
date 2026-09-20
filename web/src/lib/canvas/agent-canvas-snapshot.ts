import { canonicalize } from "json-canonicalize";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

// Panning/focusing is local UI state, not an edit to Agent-owned canvas content.
export function sameAgentCanvasContent(previous: CanvasProject | undefined, current: CanvasProject) {
    if (!previous) return false;
    const content = ({ viewport: _viewport, updatedAt: _updatedAt, ...rest }: CanvasProject) => rest;
    return canonicalize(content(previous)) === canonicalize(content(current));
}
