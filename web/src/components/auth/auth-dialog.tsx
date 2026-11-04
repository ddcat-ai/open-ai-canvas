import { Clapperboard, LayoutGrid, ShoppingBag, Sparkles, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { BrandLogo } from "@/components/brand/brand-logo";
import { AppModal } from "@/components/ui/product/app-modal";
import { useAuthDialogStore } from "@/stores/use-auth-dialog-store";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { useUserStore } from "@/stores/use-user-store";
import { AuthPanel } from "./auth-panel";
import "./auth-dialog.css";

const STAGE_FEATURES: Array<{ key: "drama" | "ecommerce" | "canvas" | "agent"; icon: LucideIcon }> = [
    { key: "drama", icon: Clapperboard },
    { key: "ecommerce", icon: ShoppingBag },
    { key: "canvas", icon: LayoutGrid },
    { key: "agent", icon: Sparkles },
];

function currentPath() {
    return window.location.pathname + window.location.search;
}

/**
 * 登录弹窗：左侧品牌舞台，右侧与独立登录页相同的登录面板。
 * 渲染在路由之外，导航由 AuthDialogHost 传入的 navigate 完成。
 */
export default function AuthDialog({ navigate }: { navigate: (to: string) => void }) {
    const { t } = useTranslation();
    const open = useAuthDialogStore((state) => state.open);
    const view = useAuthDialogStore((state) => state.view);
    const next = useAuthDialogStore((state) => state.next);
    const setView = useAuthDialogStore((state) => state.setView);
    const closeDialog = useAuthDialogStore((state) => state.closeDialog);
    const signedIn = useUserStore((state) => Boolean(state.user));

    // 登录过程中会话切换会重挂整棵应用，这里在提交时捕获 next，不依赖弹窗仍在渲染。
    const finish = () => {
        closeDialog();
        if (next && next !== currentPath()) navigate(next);
    };

    return (
        <AppModal
            flush
            centered
            open={open && !signedIn}
            onCancel={closeDialog}
            footer={null}
            width="min(1000px, calc(100vw - 32px))"
            className="auth-dialog"
            // 视觉标题在右侧面板内；这里只为对话框提供无障碍名称。
            title={<span className="sr-only">{t("auth.panel.dialogLabel")}</span>}
            styles={{ header: { margin: 0, padding: 0 } }}
        >
            <div className="auth-dialog-layout">
                <AuthDialogStage />
                <div className="auth-dialog-form">
                    <div className="auth-dialog-form-inner">
                        <AuthPanel variant="dialog" view={view} onViewChange={setView} next={next ?? currentPath()} onAuthenticated={finish} />
                    </div>
                </div>
            </div>
        </AppModal>
    );
}

function AuthDialogStage() {
    const { t } = useTranslation();
    const appearance = useAppearanceStore((state) => state.appearance);
    return (
        <aside className="auth-dialog-stage">
            <div className="auth-dialog-brand">
                <BrandLogo className="auth-dialog-brand-logo" alt="" fallback={<span className="auth-dialog-brand-logo auth-dialog-brand-mark" aria-hidden />} />
                <span>{appearance.brandName}</span>
            </div>
            <div className="auth-dialog-stage-copy">
                <p className="auth-dialog-stage-title">{appearance.authHeroTitle}</p>
                <p className="auth-dialog-stage-tagline">{appearance.authHeroDescription || t("auth.panel.tagline")}</p>
            </div>
            <ul className="auth-dialog-features">
                {STAGE_FEATURES.map(({ key, icon: Icon }) => (
                    <li key={key} className="auth-dialog-feature">
                        <span className="auth-dialog-feature-icon">
                            <Icon aria-hidden />
                        </span>
                        <span className="min-w-0">
                            <strong>{t(`auth.panel.features.${key}.title`)}</strong>
                            <small>{t(`auth.panel.features.${key}.description`)}</small>
                        </span>
                    </li>
                ))}
            </ul>
        </aside>
    );
}
