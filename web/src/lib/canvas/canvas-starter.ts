export type CanvasStarterMode = "guided" | "freeform";

export type CanvasEmptyStateKind = "none" | "guided" | "freeform" | "linked";

export function resolveCanvasEmptyStateKind({
    nodeCount,
    shortDramaEnabled,
    isProjectLinked,
    starterMode,
}: {
    nodeCount: number;
    shortDramaEnabled: boolean;
    isProjectLinked: boolean;
    starterMode?: CanvasStarterMode;
}): CanvasEmptyStateKind {
    if (nodeCount > 0) return "none";
    if (!shortDramaEnabled) return "freeform";
    if (isProjectLinked) return "linked";
    return starterMode === "freeform" ? "freeform" : "guided";
}
