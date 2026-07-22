import { lazy, Suspense } from "react";

import { useAdminContext } from "./admin-context";
import { AdminPageFrame } from "./components/admin-shell";

const AnalyticsPanel = lazy(() => import("./components/analytics-panel"));
const AdminAnnouncementsPanel = lazy(() => import("./components/admin-announcements-panel"));
const CreditOperationsPanel = lazy(() => import("./components/credit-operations-panel"));
const AccessSettingsPanel = lazy(() => import("./components/access-settings-panel"));
const EmailSettingsPanel = lazy(() => import("./components/email-settings-panel"));

function PageFallback({ label }: { label: string }) {
    return <div className="py-16 text-center text-sm text-foreground/50">正在读取{label}...</div>;
}

export function AnalyticsPage() {
    const { references } = useAdminContext();
    return <AdminPageFrame title="数据概览" description="活跃、调用与成本趋势"><Suspense fallback={<PageFallback label="统计数据" />}><AnalyticsPanel users={references.users} channels={references.channels} /></Suspense></AdminPageFrame>;
}

export function AnnouncementsPage() {
    return <AdminPageFrame title="系统公告" description="发布、关闭与历史公告"><Suspense fallback={<PageFallback label="系统公告" />}><AdminAnnouncementsPanel /></Suspense></AdminPageFrame>;
}

export function CreditOperationsPage() {
    const { references } = useAdminContext();
    return <AdminPageFrame title="积分运营" description="人工调账与异常计费"><Suspense fallback={<PageFallback label="积分运营数据" />}><CreditOperationsPanel users={references.users} /></Suspense></AdminPageFrame>;
}

export function AccessSettingsPage() {
    return <AdminPageFrame title="登录与注册" description="注册策略与 Linux.do"><Suspense fallback={<PageFallback label="登录与注册配置" />}><AccessSettingsPanel /></Suspense></AdminPageFrame>;
}

export function EmailSettingsPage() {
    return <AdminPageFrame title="邮件服务" description="注册验证码 SMTP"><div className="mx-auto max-w-5xl"><Suspense fallback={<PageFallback label="邮件配置" />}><EmailSettingsPanel /></Suspense></div></AdminPageFrame>;
}
