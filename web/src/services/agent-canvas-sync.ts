import type { AgentEvent } from "@/services/api/agent";
import type { AgentCanvasPatch } from "@/lib/canvas/agent-canvas-patch";

type Options = {
    canvasId: string;
    applyPatches: (patches: AgentCanvasPatch[]) => Promise<unknown>;
    refresh: () => Promise<unknown>;
    onError: (error: unknown) => void;
    batchMs?: number;
    refreshIntervalMs?: number;
};

/** Batch SSE bursts; only missing/out-of-order deltas need a rate-limited snapshot. */
export function createAgentCanvasSync(options: Options) {
    let patches: AgentCanvasPatch[] = [];
    let needsRefresh = false;
    let supportsPatches = false;
    let disposed = false;
    let running = false;
    let lastRefresh = -Infinity;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
        if (disposed || running || timer || (!patches.length && !needsRefresh)) return;
        const wait = patches.length ? options.batchMs ?? 40 : Math.max(options.batchMs ?? 40, (options.refreshIntervalMs ?? 1000) - (Date.now() - lastRefresh));
        timer = setTimeout(() => { timer = undefined; void flush(); }, wait);
    };
    const flush = async () => {
        if (disposed || running) return;
        running = true;
        const batch = patches;
        patches = [];
        try {
            if (batch.length) {
                try { await options.applyPatches(batch); }
                catch { needsRefresh = true; }
            }
            if (!disposed && needsRefresh && Date.now() - lastRefresh >= (options.refreshIntervalMs ?? 1000)) {
                needsRefresh = false;
                lastRefresh = Date.now();
                await options.refresh();
            }
        } catch (error) {
            if (!disposed) options.onError(error);
        } finally {
            running = false;
            schedule();
        }
    };
    return {
        receive(event: AgentEvent) {
            if (disposed || (event.payload.canvasId && event.payload.canvasId !== options.canvasId)) return;
            const patch = event.payload.canvasPatch as AgentCanvasPatch | undefined;
            if (patch && patch.canvasId === options.canvasId) {
                supportsPatches = true;
                patches.push(patch);
            } else if (event.type === "canvas_updated" || event.type === "canvas_undone" || (!supportsPatches && (event.type === "generation_task_created" || event.type === "tool_failed" || event.type === "run_failed" || (event.type === "tool_completed" && ["canvas_apply_ops", "generate_media"].includes(String(event.payload.toolName)))))) {
                needsRefresh = true;
            }
            schedule();
        },
        reconcile() { if (!disposed) { needsRefresh = true; schedule(); } },
        dispose() { disposed = true; if (timer) clearTimeout(timer); patches = []; },
    };
}
