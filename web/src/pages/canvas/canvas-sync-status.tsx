import { useTranslation } from "react-i18next";
import { CloudCheck, LoaderCircle } from "lucide-react";
import { useSyncProgressStore } from "@/stores/use-sync-progress-store";
import "./canvas-sync-status.css";

export function CanvasSyncStatus({ projectId }: { projectId: string }) {
    const { t } = useTranslation();
    const progress = useSyncProgressStore((state) => state.syncingProjects[projectId]);
    const saving = progress?.phase === "pending" || progress?.phase === "saving" || progress?.phase === "uploading" || progress?.localPhase === "pending" || progress?.localPhase === "error" || progress?.phase === "error" || Boolean(progress?.errorKind);
    const tone = saving ? "pending" : progress?.phase === "done" ? "done" : "idle";
    // 免登录本地工具：不用「尚未同步」这类词，直接告诉用户东西已经在这台电脑上。
    const label = saving ? t("canvasPage.syncStatus.syncing") : progress?.phase === "done" ? t("canvasPage.syncStatus.synced") : "已存在这台电脑";
    return (
        <span className={`canvas-sync-status-trigger canvas-sync-status-trigger--${tone} inline-flex size-8 items-center justify-center rounded-full`} role="status" aria-label={label} title={label}>
            {saving ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <CloudCheck className="size-4" />}
        </span>
    );
}
