import { CloudCheck, CloudOff, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useSyncProgressStore } from "@/stores/use-sync-progress-store";
import "./canvas-sync-status.css";

const ERROR_INDICATOR_DELAY_MS = 4_000;

export function CanvasSyncStatus({ projectId }: { projectId: string }) {
    const progress = useSyncProgressStore((state) => state.syncingProjects[projectId]);
    const phase = progress?.phase;
    const localPhase = progress?.localPhase;
    const localError = localPhase === "error";
    const cloudError = phase === "error";
    const errorKey = cloudError || localError ? `${projectId}:${cloudError}:${localError}` : "";
    const [visibleErrorKey, setVisibleErrorKey] = useState("");

    useEffect(() => {
        if (!errorKey) {
            setVisibleErrorKey("");
            return;
        }
        const timer = window.setTimeout(() => setVisibleErrorKey(errorKey), ERROR_INDICATOR_DELAY_MS);
        return () => window.clearTimeout(timer);
    }, [errorKey]);

    const showErrorIcon = Boolean(errorKey && visibleErrorKey === errorKey);
    const saving = phase === "pending" || phase === "saving" || phase === "uploading" || localPhase === "pending";
    const tone = showErrorIcon && localError ? "error" : cloudError || localError || saving ? "pending" : phase === "done" || localPhase === "saved" ? "done" : "idle";
    const statusIconClass = showErrorIcon ? undefined : "animate-spin motion-reduce:animate-none";
    const label = cloudError ? "云端暂未同步" : localError ? "本地暂未保存" : saving ? "正在同步画布" : phase === "done" ? "已同步" : localPhase === "saved" ? "已保存" : "尚未同步";

    return (
        <span className={`canvas-sync-status-trigger canvas-sync-status-trigger--${tone} inline-flex size-8 items-center justify-center rounded-full`} aria-label={label} role="status" data-canvas-no-zoom>
            {showErrorIcon ? <CloudOff className="size-4" /> : saving || cloudError || localError ? <LoaderCircle className={`size-4 ${statusIconClass || ""}`} /> : <CloudCheck className="size-4" />}
        </span>
    );
}
