import { useEffect, useState, type CSSProperties } from "react";

import { BrandLogoFrame } from "@/components/brand/brand-logo";
import { translate } from "@/i18n";
import { cn } from "@/lib/utils";
import { useAppearanceStore } from "@/stores/use-appearance-store";

type FullScreenLoaderProps = {
    label?: string;
    detail?: string;
    className?: string;
};

// 会话恢复、客户端初始化和整页路由会接力渲染各自的加载页。所有实例共用一条时间线：
// 扫光按 performance.now() 对齐相位（index.html 的启动信号用同一时钟），品牌与文案的入场
// 每次呈现只播一次；接力换实例时画面原地继续，不重播入场、不闪。
const LOADER_HANDOFF_MS = 400;
let presentationStartedAt = 0;
let lastUnmountedAt = Number.NEGATIVE_INFINITY;
let mountedLoaders = 0;

function useLoaderTimeline() {
    const [timeline] = useState(() => {
        const now = performance.now();
        if (mountedLoaders === 0 && now - lastUnmountedAt > LOADER_HANDOFF_MS) presentationStartedAt = now;
        return { "--loader-clock": `${now}ms`, "--loader-elapsed": `${now - presentationStartedAt}ms` } as CSSProperties;
    });

    useEffect(() => {
        mountedLoaders += 1;
        return () => {
            mountedLoaders -= 1;
            lastUnmountedAt = performance.now();
        };
    }, []);

    return timeline;
}

export function FullScreenLoader({ label = translate("account.ui.loader.label"), detail = translate("account.ui.loader.detail"), className }: FullScreenLoaderProps) {
    const timeline = useLoaderTimeline();
    // 外观解析前不出品牌：自定义品牌的部署不能先闪内置 Logo，与 index.html 首屏品牌中性一致。
    const appearanceResolved = useAppearanceStore((state) => state.resolved);
    const builtinLogo = useAppearanceStore((state) => !state.appearance.logoConfigured);

    return (
        <div data-full-screen-loader role="status" aria-live="polite" aria-label={translate("account.ui.loader.aria", { label, detail })} className={cn("full-screen-loader", className)} style={timeline}>
            {appearanceResolved ? <BrandLogoFrame className={cn("full-screen-loader-mark", builtinLogo && "is-builtin")} logoClassName="full-screen-loader-mark-image" alt="" fallback={<span className="loader-brand-glyph" aria-hidden="true" />} /> : null}
            <LoadingSignal />
            <div className="full-screen-loader-copy">
                <strong>{label}</strong>
                <span>{detail}</span>
            </div>
        </div>
    );
}

export function WorkspaceRouteLoader({ label = translate("account.ui.loader.route") }: { label?: string }) {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const timer = window.setTimeout(() => setVisible(true), 140);
        return () => window.clearTimeout(timer);
    }, []);

    return (
        <section data-workspace-route-loader className={cn("workspace-route-loader", visible && "is-visible")} role="status" aria-live="polite" aria-label={label}>
            <div className="workspace-route-loader-content">
                <span className="workspace-route-loader-mark">
                    <BrandLogoFrame className="workspace-route-loader-logo" logoClassName="size-4" alt="" fallback={<span className="loader-brand-glyph" aria-hidden="true" />} />
                </span>
                <LoadingSignal />
                <span>{label}</span>
            </div>
        </section>
    );
}

function LoadingSignal() {
    return (
        <span className="loading-signal" aria-hidden="true">
            <i />
        </span>
    );
}
