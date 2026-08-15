import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

type FullScreenLoaderProps = {
    label?: string;
    detail?: string;
    className?: string;
};

export function FullScreenLoader({ label = "正在恢复工作区", detail = "同步账号、模型和项目数据", className }: FullScreenLoaderProps) {
    return (
        <div
            data-full-screen-loader
            role="status"
            aria-live="polite"
            aria-label={`${label}，${detail}`}
            className={cn("full-screen-loader", className)}
        >
            <div className="full-screen-loader-shell">
                <header className="full-screen-loader-topbar" aria-hidden="true">
                    <div className="full-screen-loader-topbar-group">
                        <span className="loader-placeholder loader-placeholder-control" />
                        <span className="loader-placeholder loader-placeholder-mark" />
                        <span className="loader-placeholder loader-placeholder-wordmark" />
                    </div>
                    <div className="full-screen-loader-topbar-group">
                        <span className="loader-placeholder loader-placeholder-control" />
                        <span className="loader-placeholder loader-placeholder-control" />
                        <span className="loader-placeholder loader-placeholder-control" />
                    </div>
                </header>

                <div className="full-screen-loader-main">
                    <aside className="full-screen-loader-rail" aria-hidden="true">
                        <span className="loader-placeholder loader-placeholder-rail-item" />
                        <span className="loader-placeholder loader-placeholder-rail-item" />
                        <span className="loader-placeholder loader-placeholder-rail-item" />
                        <span className="loader-placeholder loader-placeholder-rail-item" />
                        <span className="loader-placeholder loader-placeholder-rail-item" />
                    </aside>

                    <main className="full-screen-loader-stage">
                        <div className="full-screen-loader-stage-header">
                            <div className="full-screen-loader-status">
                                <LoadingSignal />
                                <span>{label}</span>
                            </div>
                            <span className="loader-placeholder loader-placeholder-action" aria-hidden="true" />
                        </div>
                        <div className="full-screen-loader-stage-grid" aria-hidden="true">
                            <LoaderSurface />
                            <LoaderSurface />
                            <LoaderSurface />
                            <LoaderSurface />
                            <LoaderSurface />
                            <LoaderSurface />
                            <LoaderSurface />
                            <LoaderSurface />
                        </div>
                    </main>
                </div>
            </div>
        </div>
    );
}

export function WorkspaceRouteLoader({ label = "正在打开页面" }: { label?: string }) {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const timer = window.setTimeout(() => setVisible(true), 140);
        return () => window.clearTimeout(timer);
    }, []);

    return (
        <section data-workspace-route-loader className={cn("workspace-route-loader", visible && "is-visible")} role="status" aria-live="polite" aria-label={label}>
            <div className="workspace-route-loader-content">
                <LoadingSignal />
                <span>{label}</span>
            </div>
        </section>
    );
}

function LoadingSignal() {
    return <span className="loading-signal" aria-hidden="true" />;
}

function LoaderSurface() {
    return (
        <div className="full-screen-loader-surface">
            <span className="loader-placeholder loader-placeholder-media" />
            <span className="loader-placeholder loader-placeholder-title" />
            <span className="loader-placeholder loader-placeholder-meta" />
        </div>
    );
}
