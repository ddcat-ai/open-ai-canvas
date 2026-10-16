import { useSyncExternalStore } from "react";
import { useParams } from "react-router";
import { PencilLine, RotateCw } from "lucide-react";
import { canvasEditLeases } from "@/services/canvas-edit-leases";
import { scheduleRemoteUserDataSync } from "@/services/user-data-sync";

export function useCanvasTextLease(nodeId: string, canvasId?: string) {
    const params = useParams<{ id: string }>();
    const id = canvasId || params.id || "";
    useSyncExternalStore(canvasEditLeases.subscribe, canvasEditLeases.snapshot, () => 0);
    return {
        ...canvasEditLeases.state(id, nodeId),
        pending: canvasEditLeases.pending(id, nodeId),
        input: () => canvasEditLeases.input(id, nodeId),
        retry: async () => {
            if (await canvasEditLeases.retry(id, nodeId)) scheduleRemoteUserDataSync();
        },
    };
}

export function CanvasTextLeaseIndicator({ nodeId, canvasId }: { nodeId: string; canvasId?: string }) {
    const state = useCanvasTextLease(nodeId, canvasId);
    if (!state.typing && !state.error && !state.acquiring) return null;
    return (
        <span role="status" className="inline-flex max-w-full items-center gap-1 text-[var(--fs-tiny)] text-muted-foreground" title={state.error || undefined}>
            <PencilLine className={state.typing ? "size-3 shrink-0 motion-safe:animate-pulse" : "size-3 shrink-0"} />
            <span className="truncate">{state.remote ? "其他窗口正在输入" : state.acquiring ? "正在获取编辑权限" : state.error ? "草稿待同步" : "正在输入"}</span>
            {state.error && !state.remote && !state.acquiring && (
                <button
                    type="button"
                    className="pointer-events-auto inline-flex size-5 shrink-0 items-center justify-center rounded hover:bg-current/10"
                    title="重新获取编辑权限并同步草稿"
                    aria-label="重试文本同步"
                    onPointerDown={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                        event.stopPropagation();
                        void state.retry();
                    }}
                >
                    <RotateCw className="size-3" />
                </button>
            )}
        </span>
    );
}
