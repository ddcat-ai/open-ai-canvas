import React from "react";
import { createRoot } from "react-dom/client";
import "antd/dist/reset.css";
import "./styles/globals.css";
import { RouterProvider } from "react-router";

import "@/lib/plugins/builtin";

import { AppProviders } from "@/components/layout/app-providers";
import { initI18n } from "@/i18n";
import { router } from "@/router";

document.body.style.fontFamily = '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif';

// 先完成 i18n 初始化（含首次语言探测与 common 资源加载）再挂载，避免首帧渲染出 key 或错语言
void initI18n().then(() => {
    createRoot(document.getElementById("root")!).render(
        <React.StrictMode>
            <AppProviders>
                <RouterProvider router={router} />
            </AppProviders>
        </React.StrictMode>,
    );
});
