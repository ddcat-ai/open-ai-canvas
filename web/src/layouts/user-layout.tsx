import { lazy, Suspense, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { useLocation } from "react-router";
import { ConfigProvider } from "antd";

import { AppWorkspaceShell } from "@/components/layout/app-top-nav";
import { LL2AgentPanel } from "@/components/ll2/ll2-agent-panel";
import { LL2KeyDialog } from "@/components/ll2/ll2-connect";
import { useAgentPanelDock } from "@/components/canvas/use-agent-panel-dock";
import { cn } from "@/lib/utils";
import { isSpatialWorkbenchPath } from "@/lib/workspace-routes";
import { getWorkspaceAntThemeConfig } from "@/lib/app-theme";
import { useGlobalAgentStore } from "@/stores/use-global-agent-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import "@/styles/workspace-product.css";
import "@/styles/workspace-menus.css";
// C 端品牌覆盖层放在最后，确保压过原版工作台的白底与墨色主按钮。
import "@/styles/ll2-c-ui.css";
// 创作台首页按 DMC 官网视觉单独排版（白底、01/02 编号、细线卡片）。
import "@/styles/ll2-site.css";
// 2026-11-17 21:54：BeeFTV 式工作台骨架 + 无限画布文本助手。
import "@/styles/ll2-workbench.css";
// 2026-11-18 C 端白话改造：填 Key 弹窗、起步卡片、侧栏引导、画布返回入口。
import "@/styles/ll2-c-polish.css";
// 画布编辑器「画布怎么用」分步引导（独立样式，放最后压过原版工作台）。
import "@/styles/ll2-canvas-guide.css";
// 黑夜模式 token 表 + 主题开关样式。必须最后引入：html.dark 的变量覆盖要压过所有 C 端浅色规则。
import "@/styles/ll2-c-theme.css";

// 平台唯一的 Agent 面板按需加载，不拖慢首屏；画布编辑器只发布画布上下文，不再自己渲染面板。
const GlobalAgentPanel = lazy(() => import("@/components/canvas/canvas-cloud-agent-panel").then((module) => ({ default: module.CanvasCloudAgentPanel })));

export default function UserLayout({ children }: { children: ReactNode }) {
    const { pathname } = useLocation();
    const adminWorkspace = pathname === "/admin" || pathname.startsWith("/admin/");
    const spatialWorkbench = isSpatialWorkbenchPath(pathname);
    const canvasEditor = /^\/canvas\/[^/]+(?:\/|$)/.test(pathname);
    const productWorkspace = !adminWorkspace && !canvasEditor;
    const userId = useUserStore((state) => state.user?.id);
    // 工作台内层的 antd 主题跟随黑夜模式重算，浮层与输入框不会留在白底。
    const dark = useThemeStore((state) => state.theme === "dark");
    const workspaceTheme = useMemo(() => getWorkspaceAntThemeConfig(dark), [dark]);
    // Agent 停靠在画布右侧时，工作区让出同样的宽度，画布、顶栏和角落控件都不被遮挡。
    const agentDock = useAgentPanelDock();
    const agentDocked = Boolean(userId) && canvasEditor && agentDock.active;
    const creationWorkspace = pathname === "/" || pathname === "/create";
    const wasCanvasEditorRef = useRef(canvasEditor);
    // 从画布编辑器回到创作首页时收起 Agent：画布里停靠在右侧的面板到首页会变成浮窗，挡住首页。
    // 只收起面板，对话和运行照常继续；在绘制前收起，首页不会先闪出浮窗。
    useLayoutEffect(() => {
        const leftCanvasEditor = wasCanvasEditorRef.current && !canvasEditor;
        wasCanvasEditorRef.current = canvasEditor;
        if (leftCanvasEditor && creationWorkspace) useGlobalAgentStore.getState().closeAgent();
    }, [canvasEditor, creationWorkspace]);

    useLayoutEffect(() => {
        // Ant Design 浮层挂载在 body，必须用路由级标记隔离用户工作台与画布编辑器、运营后台。
        document.body.classList.toggle("app-user-overlays", !adminWorkspace);
        document.body.classList.toggle("app-spatial-overlays", spatialWorkbench);
        document.body.classList.toggle("app-product-overlays", productWorkspace);
        return () => {
            document.body.classList.remove("app-user-overlays");
            document.body.classList.remove("app-spatial-overlays");
            document.body.classList.remove("app-product-overlays");
        };
    }, [adminWorkspace, spatialWorkbench, productWorkspace]);

    // 画布里只保留一个内嵌文本助手：C 端免登录助手用我们自己的文本模型，
    // 影策云端 Agent 依赖登录态、画布里会与它重复，画布编辑器不再挂载。
    // 其它登录页面仍共用同一个云端面板实例，跨路由不卸载，对话与事件流不中断。
    const globalAgent = userId && !canvasEditor ? (
        <Suspense fallback={null}>
            <GlobalAgentPanel key={userId} />
        </Suspense>
    ) : null;

    // 全站唯一的 C 端文本助手：首页叫「聊天改稿」，进画布就是这一张画布的内嵌助手，
    // 能把聊好的内容交给 Agent 出片并写回画布。后台页不挂。
    const ll2Agent = adminWorkspace ? null : <LL2AgentPanel />;
    // 全站唯一的填 Key 弹窗：首页、顶栏、侧栏、配置页共用，避免同时出现两个输入框。
    const keyDialog = adminWorkspace ? null : <LL2KeyDialog />;

    if (adminWorkspace)
        return (
            <>
                {children}
                {globalAgent}
            </>
        );

    return (
        <ConfigProvider
            theme={productWorkspace ? workspaceTheme : undefined}
            select={productWorkspace ? { classNames: { popup: { root: "workspace-quiet-popup" } } } : undefined}
            dropdown={productWorkspace ? { classNames: { root: "workspace-quiet-popup" } } : undefined}
            popover={productWorkspace ? { classNames: { root: "workspace-quiet-popup" } } : undefined}
        >
            <div
                className={cn("app-user-workspace h-dvh overflow-hidden text-foreground", spatialWorkbench && "app-spatial-workspace", productWorkspace && "app-product-workspace")}
                style={agentDocked ? { paddingRight: agentDock.width } : undefined}
                data-agent-docked={agentDocked || undefined}
            >
                <AppWorkspaceShell>{children}</AppWorkspaceShell>
            </div>
            {globalAgent}
            {ll2Agent}
            {keyDialog}
        </ConfigProvider>
    );
}
