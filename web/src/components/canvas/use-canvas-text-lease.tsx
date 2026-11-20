import { useSyncExternalStore } from "react";
import { useParams } from "react-router";
import { PencilLine } from "lucide-react";
import { useTranslation } from "react-i18next";
import { canvasEditLeases } from "@/services/canvas-edit-leases";

export function useCanvasTextLease(nodeId: string, canvasId?: string) {
    const params = useParams<{ id: string }>();
    const id = canvasId || params.id || "";
    useSyncExternalStore(canvasEditLeases.subscribe, canvasEditLeases.snapshot, () => 0);
    return {
        ...canvasEditLeases.state(id, nodeId),
        pending: canvasEditLeases.pending(id, nodeId),
        input: () => canvasEditLeases.input(id, nodeId),
    };
}

export function CanvasTextLeaseIndicator({ nodeId, canvasId }: { nodeId: string; canvasId?: string }) {
    const { t } = useTranslation();
    const state = useCanvasTextLease(nodeId, canvasId);
    if (!state.typing) return null;
    return (
        <span className="inline-flex max-w-full items-center gap-1 text-[var(--fs-tiny)] text-muted-foreground">
            <PencilLine className={state.typing ? "size-3 shrink-0 motion-safe:animate-pulse" : "size-3 shrink-0"} />
            <span className="truncate">{state.remote ? t("canvasC.textLease.remoteTyping") : t("canvasC.textLease.typing")}</span>
        </span>
    );
}
