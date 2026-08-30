import { Button } from "antd";
import { Plus, Settings2, UserRoundCog } from "lucide-react";
import { lazy, Suspense, useState } from "react";

import { useAdminContext } from "./admin-context";
import { AdminPageFrame } from "./components/admin-shell";
import { readAnnouncementPendingReview } from "./components/admin-announcement-safety";

const AnalyticsPanel = lazy(() => import("./components/analytics-panel"));
const AdminAnnouncementsPanel = lazy(() => import("./components/admin-announcements-panel"));
const CreditOperationsPanel = lazy(() => import("./components/credit-operations-panel"));
const AccessSettingsPanel = lazy(() => import("./components/access-settings-panel"));
const EmailSettingsPanel = lazy(() => import("./components/email-settings-panel"));
const FeatureAvailabilityPanel = lazy(() => import("./components/feature-availability-panel"));
const StorageResourcesPanel = lazy(() => import("./components/storage-resources-panel"));

function PageFallback({ label }: { label: string }) {
    return <div className="py-16 text-center text-sm text-foreground/50">正在读取{label}...</div>;
}

export function AnalyticsPage() {
    const { references } = useAdminContext();
    return (
        <AdminPageFrame title="数据概览" description="用户、任务、质量与成本健康度" scroll>
            <Suspense fallback={<PageFallback label="统计数据" />}>
                <AnalyticsPanel users={references.users} channels={references.channels} />
            </Suspense>
        </AdminPageFrame>
    );
}

export function AnnouncementsPage() {
    const [publishOpen, setPublishOpen] = useState(false);
    const [publishBlocked, setPublishBlocked] = useState(() => Boolean(readAnnouncementPendingReview()));
    const [publishReturnFocus, setPublishReturnFocus] = useState<HTMLElement | null>(null);
    return (
        <AdminPageFrame
            title="系统公告"
            description="面向全体用户的通知发布与状态管理"
            actions={
                <Button
                    id="admin-announcement-publish-trigger"
                    type="primary"
                    disabled={publishBlocked}
                    title={publishBlocked ? "请先核对上一次结果不确定的发布请求" : undefined}
                    icon={<Plus className="size-4" />}
                    onClick={(event) => {
                        setPublishReturnFocus(event.currentTarget);
                        setPublishOpen(true);
                    }}
                >
                    发布公告
                </Button>
            }
        >
            <Suspense fallback={<PageFallback label="系统公告" />}>
                <AdminAnnouncementsPanel publishOpen={publishOpen} publishBlocked={publishBlocked} publishReturnFocus={publishReturnFocus} onPublishOpenChange={setPublishOpen} onPublishBlockedChange={setPublishBlocked} />
            </Suspense>
        </AdminPageFrame>
    );
}

export function CreditOperationsPage() {
    const { references } = useAdminContext();
    const [activeOperation, setActiveOperation] = useState<"policy" | "adjustment" | null>(null);
    return (
        <AdminPageFrame
            title="积分运营"
            description="异常计费核对、积分策略与人工调账"
            actions={
                <>
                    <Button icon={<Settings2 className="size-4" />} onClick={() => setActiveOperation("policy")}>
                        积分策略
                    </Button>
                    <Button type="primary" icon={<UserRoundCog className="size-4" />} onClick={() => setActiveOperation("adjustment")}>
                        人工调账
                    </Button>
                </>
            }
        >
            <Suspense fallback={<PageFallback label="积分运营数据" />}>
                <CreditOperationsPanel users={references.users} activeOperation={activeOperation} onOperationChange={setActiveOperation} />
            </Suspense>
        </AdminPageFrame>
    );
}

export function AccessSettingsPage() {
    return (
        <AdminPageFrame title="登录与注册" description="先控制账号创建，再配置第三方登录入口" scroll>
            <Suspense fallback={<PageFallback label="登录与注册配置" />}>
                <AccessSettingsPanel />
            </Suspense>
        </AdminPageFrame>
    );
}

export function EmailSettingsPage() {
    return (
        <AdminPageFrame title="邮件服务" description="先决定是否发送注册验证码，再配置 SMTP" scroll>
            <Suspense fallback={<PageFallback label="邮件配置" />}>
                <EmailSettingsPanel />
            </Suspense>
        </AdminPageFrame>
    );
}

export function FeatureAvailabilityPage() {
    return (
        <AdminPageFrame title="功能开放" description="按用户使用路径控制工作台、插件与模型能力" scroll>
            <Suspense fallback={<PageFallback label="功能开放配置" />}>
                <FeatureAvailabilityPanel />
            </Suspense>
        </AdminPageFrame>
    );
}

export function StorageResourcesPage() {
    return (
        <AdminPageFrame title="存储资源" description="只读查看资源记录、容量分布与文件预览" scroll>
            <Suspense fallback={<PageFallback label="存储资源" />}>
                <StorageResourcesPanel />
            </Suspense>
        </AdminPageFrame>
    );
}
