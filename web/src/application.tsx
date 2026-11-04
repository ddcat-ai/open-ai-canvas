import React from "react";
import { createRoot } from "react-dom/client";
import "antd/dist/reset.css";
import "./styles/globals.css";
import "./styles/shared/model-picker.css";
import "./styles/shared/overlays.css";
import "./styles/shared/scrollbars.css";
import { RouterProvider } from "react-router";

import { AuthDialogHost } from "@/components/auth/auth-dialog-host";
import { AppProviders } from "@/components/layout/app-providers";
import { router } from "@/router";

// 登录弹窗渲染在路由之外（分享页等路由也要能打开），导航直接交给 router。
const navigateFromAuthDialog = (to: string) => void router.navigate(to);

document.body.style.fontFamily = '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif';

createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <AppProviders>
            <RouterProvider router={router} />
            <AuthDialogHost navigate={navigateFromAuthDialog} />
        </AppProviders>
    </React.StrictMode>,
);
