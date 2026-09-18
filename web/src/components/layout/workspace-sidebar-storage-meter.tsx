import { HardDrive } from "lucide-react";
import { Link } from "react-router";

import { useAccountFileStorageUsage } from "@/hooks/use-account-file-storage-usage";
import { accountStorageMeter } from "@/lib/account-storage-usage";
import { cn } from "@/lib/utils";
import { preloadWorkspaceRoute } from "@/lib/workspace-route-modules";

function StorageGlyph() {
    return (
        <span className="app-workspace-sidebar-storage-icon" aria-hidden="true">
            <HardDrive strokeWidth={1.75} />
        </span>
    );
}

export function WorkspaceSidebarStorageMeter({ collapsed }: { collapsed: boolean }) {
    const query = useAccountFileStorageUsage();
    const meter = accountStorageMeter(query.data);
    const usedText = query.data ? `已用 ${meter.usedLabel}` : query.isError ? "容量暂不可用" : "正在统计容量";
    const remainingText = query.data ? (meter.full ? "容量已满" : `剩余 ${meter.remainingLabel}`) : "";
    const totalText = query.data ? `共 ${meter.totalLabel}` : "";
    const summary = query.data ? `${usedText}，${remainingText}，${totalText}` : usedText;

    const track = (
        <span
            className="app-workspace-sidebar-storage-track"
            role="progressbar"
            aria-label="账号文件容量使用进度"
            aria-valuemin={0}
            aria-valuemax={query.data?.totalBytes ?? 0}
            aria-valuenow={query.data ? Math.min(query.data.usedBytes, query.data.totalBytes) : 0}
            aria-valuetext={summary}
        >
            <span style={{ width: `${meter.percent}%` }} />
        </span>
    );

    if (query.isError && !query.data) {
        return (
            <div className={cn("app-workspace-sidebar-storage is-error", collapsed && "is-collapsed")}>
                {collapsed ? (
                    <button type="button" title="容量统计暂时不可用，点击重试" aria-label="重试加载账号容量" onClick={() => void query.refetch()}>
                        <StorageGlyph />
                    </button>
                ) : (
                    <>
                        <StorageGlyph />
                        <span>容量暂不可用</span>
                        <button type="button" onClick={() => void query.refetch()}>
                            重试
                        </button>
                    </>
                )}
            </div>
        );
    }

    return (
        <Link
            to="/assets"
            className={cn(
                "app-workspace-sidebar-storage",
                collapsed && "is-collapsed",
                meter.tone === "warn" && "is-warn",
                meter.tone === "critical" && "is-critical",
                query.data?.usedBytes ? "has-usage" : null,
                query.isPending && !query.data && "is-pending",
            )}
            title={`${summary}。包含素材文件和 Agent 会话附件`}
            aria-label={`账号容量，${summary}`}
            aria-busy={query.isPending && !query.data}
            onFocus={() => preloadWorkspaceRoute("/assets")}
            onPointerEnter={() => preloadWorkspaceRoute("/assets")}
        >
            <StorageGlyph />
            {collapsed ? (
                track
            ) : (
                <span className="app-workspace-sidebar-storage-body">
                    <span className="app-workspace-sidebar-storage-copy">
                        <span className="app-workspace-sidebar-storage-meta">
                            <span className="app-workspace-sidebar-storage-used">{usedText}</span>
                            {totalText ? <span className="app-workspace-sidebar-storage-total">{totalText}</span> : null}
                        </span>
                    </span>
                    <span className="app-workspace-sidebar-storage-foot">
                        {track}
                        {remainingText ? <span className="app-workspace-sidebar-storage-remain">{remainingText}</span> : null}
                    </span>
                </span>
            )}
        </Link>
    );
}
