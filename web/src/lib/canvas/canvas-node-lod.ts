export type CanvasNodeRenderLOD = "shell" | "preview" | "full";

// Hysteresis prevents mounting/unmounting editors around the overview boundary.
export function canvasOverviewMode(scale: number, previous: boolean) {
    return previous ? scale < 0.27 : scale < 0.23;
}

export function resolveCanvasNodeLOD(overview: boolean, inView: boolean, inEntry: boolean, editing: boolean): CanvasNodeRenderLOD {
    if (editing) return "full";
    if (inView) return overview ? "preview" : "full";
    return inEntry ? "preview" : "shell";
}
