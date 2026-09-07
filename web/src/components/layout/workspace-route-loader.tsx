import { cn } from "@/lib/utils";

export function WorkspaceRouteLoader({ label = "正在进入工作区", detail = "准备页面内容", className, inline = false }: { label?: string; detail?: string; className?: string; inline?: boolean }) {
    return (
        <section className={cn("workspace-route-loader", inline && "is-inline", className)} role="status" aria-live="polite" aria-label={`${label}，${detail}`}>
            <div className="workspace-route-loader-focus" aria-hidden="true">
                <div className="workspace-route-loader-mark">
                    <svg className="workspace-route-loader-fallback" viewBox="0 0 64 64" fill="none" aria-hidden="true">
                        <path d="M6 8H36V16H14V36H28V44H6V8ZM58 20H36V28H50V48H28V56H58V20ZM24 27H40V37H24V27Z" fill="currentColor" />
                    </svg>
                </div>
                <span className="workspace-route-loader-orbit" />
            </div>
            <div className="workspace-route-loader-copy">
                <strong>{label}</strong>
                <span>{detail}</span>
                <span className="workspace-route-loader-dots" aria-hidden="true"><i /><i /><i /></span>
            </div>
        </section>
    );
}
