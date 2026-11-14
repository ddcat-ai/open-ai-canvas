import { lazy, Suspense, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { useLocation } from "react-router";
import { App, ConfigProvider } from "antd";
import { useQueryClient } from "@tanstack/react-query";

import { AppWorkspaceShell } from "@/components/layout/app-top-nav";
import { useAgentPanelDock } from "@/components/canvas/use-agent-panel-dock";
import { cn } from "@/lib/utils";
import { isSpatialWorkbenchPath } from "@/lib/workspace-routes";
import { getWorkspaceAntThemeConfig } from "@/lib/app-theme";
import { preloadWorkspaceNavigationPages } from "@/lib/workspace-route-modules";
import { useGlobalAgentStore } from "@/stores/use-global-agent-store";
import { useUserStore } from "@/stores/use-user-store";
import { IS_LITE } from "@/lib/edition";
import "@/styles/workspace-product.css";
import "@/styles/workspace-menus.css";

const workspaceTheme = getWorkspaceAntThemeConfig();
// 平台唯一的 Agent 面板按需加载，不拖慢首屏；画布编辑器只发布画布上下文，不再自己渲染面板。
const GlobalAgentPanel = lazy(() => import("@/components/canvas/canvas-cloud-agent-panel").then((module) => ({ default: module.CanvasCloudAgentPanel })));

export default function UserLayout({ children }: { children: ReactNode }) {
    const { pathname } = useLocation();
    const adminWorkspace = pathname === "/admin" || pathname.startsWith("/admin/");
    const spatialWorkbench = isSpatialWorkbenchPath(pathname);
    const canvasEditor = /^\/canvas\/[^/]+(?:\/|$)/.test(pathname);
    const productWorkspace = !adminWorkspace && !canvasEditor;
    const userId = useUserStore((state) => state.user?.id);
    const hydrated = useUserStore((state) => state.hydrated);
    const { notification } = App.useApp();
    const queryClient = useQueryClient();
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

    useEffect(() => {
        if (!IS_LITE || !userId || !hydrated) return;
        let active = true;
        void import("@/services/api/yingce-lite-recovery").then(({ recoverYingceGenerations }) => recoverYingceGenerations()).then((result) => {
            if (!active) return;
            if (result.restored) void queryClient.invalidateQueries();
            if (result.unknown || result.failures.length) notification.warning({
                message: "部分生成结果需要核对",
                description: `有 ${result.unknown} 条请求状态未知，${result.failures.length} 条结果未能恢复到本地。请先核对结果和本地存储，再决定是否手动发起新请求。`,
                duration: 0,
            });
        }).catch(() => {
            if (active) notification.error({ message: "无法读取本地生成恢复记录", description: "请检查本地存储，保留数据并联系支持人员。", duration: 0 });
        });
        return () => { active = false; };
    }, [userId, hydrated, notification, queryClient]);

    useEffect(() => {
        if (userId) preloadWorkspaceNavigationPages();
    }, [userId]);

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

    // 所有登录页面共用同一个面板实例：跨路由不卸载，对话、运行和事件流都不中断。
    // 例外：电商页（/ecommerce）不挂载。
    // 该面板是 position:fixed + z-index 501 的右侧浮层，而电商页右侧恰好是创作面板，
    // 提交按钮「开始创作」会被它压住——实测 1366x768 / 1426x754 下 elementFromPoint
    // 命中 canvas-agent-panel，鼠标点不到，流程完全走不下去（1600x900 以上才正常）。
    // 电商页自带策划 Agent，再叠一个画布助手在概念上也是重复的。
    const hideGlobalAgent = pathname === "/ecommerce" || pathname.startsWith("/ecommerce/");
    const globalAgent =
        userId && !hideGlobalAgent ? (
            <Suspense fallback={null}>
                <GlobalAgentPanel key={userId} />
            </Suspense>
        ) : null;

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
        </ConfigProvider>
    );
}
