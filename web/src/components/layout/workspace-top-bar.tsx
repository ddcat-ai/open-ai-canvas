import { Images, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Link, useLocation } from "react-router";
import { useTranslation } from "react-i18next";

import { WorkspaceAccountMenu } from "@/components/layout/workspace-account-menu";
import { WorkspaceTopBarExtensionSlot } from "@/components/layout/workspace-top-bar-extension";
import { workspacePageTitleKey } from "@/lib/workspace-page-title";

const BRAND = "DMC";

// C 端顶栏只做两件事：标明当前在哪、提供账户入口。
// 语言切换、反馈、积分钱包、系统公告、主题开关都从顶栏撤下，避免把运营后台感带进创作台。
export function WorkspaceTopBar({ sidebarOpen, onToggleSidebar }: { sidebarOpen: boolean; onToggleSidebar: () => void }) {
    const { t } = useTranslation();
    const { pathname } = useLocation();
    const sectionKey = workspacePageTitleKey(pathname);
    const pageTitle = sectionKey ? t(sectionKey) : t("ll2.nav.create", { defaultValue: "创作" });

    return (
        <header className="app-workspace-topbar">
            <button type="button" className="app-workspace-mobile-menu app-workspace-topbar-icon-button" aria-label={sidebarOpen ? t("shell.collapseSidebar") : t("shell.expandSidebar")} onClick={onToggleSidebar}>
                {sidebarOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
            </button>
            <nav className="app-workspace-topbar-breadcrumb" aria-label={t("shell.breadcrumb")}>
                <Link to="/" className="font-medium text-foreground/65 transition-colors hover:text-foreground">
                    {BRAND}
                </Link>
                <span aria-hidden="true">/</span>
                <span className="truncate font-medium text-foreground">{pageTitle}</span>
            </nav>
            <WorkspaceTopBarExtensionSlot />
            <div className="app-workspace-topbar-actions">
                {/* 窄窗（<1024px）侧栏默认收起，资产入口必须常驻在顶栏，
                    否则用户要先点开菜单才找得到刚做好的本机素材库。宽窗由侧栏承担，这里隐藏。 */}
                <Link to="/assets" className="ll2-topbar-assets" title="打开本机素材库">
                    <Images className="size-3.5" aria-hidden /> 资产
                </Link>
                <Link to="/models" className="ll2-topbar-price" title="查看 21 个模型的单价与每次调用价格">
                    模型与价格
                </Link>
                <WorkspaceAccountMenu />
            </div>
        </header>
    );
}
