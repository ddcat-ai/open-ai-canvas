import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Navigate, Outlet } from "react-router";

import { RequireAuth } from "@/components/auth/require-auth";
import { RequireFeature } from "@/components/auth/require-feature";
import { FullScreenLoader, WorkspaceRouteLoader } from "@/components/ui/aceternity/full-screen-loader";
import { loadAssetsPage, loadCanvasPage, loadCreatePage, loadNovelsPage, loadProjectsPage, loadWalletPage } from "@/lib/workspace-route-modules";
import UserLayout from "@/layouts/user-layout";
import { AuthScene } from "@/pages/auth/auth-scene";
import RouteErrorPage from "@/pages/route-error";

const AdminPage = lazy(() => import("@/pages/admin"));
const AnalyticsPage = lazy(() => import("@/pages/admin/admin-route-pages").then((module) => ({ default: module.AnalyticsPage })));
const AnnouncementsPage = lazy(() => import("@/pages/admin/admin-route-pages").then((module) => ({ default: module.AnnouncementsPage })));
const StorageResourcesPage = lazy(() => import("@/pages/admin/admin-route-pages").then((module) => ({ default: module.StorageResourcesPage })));
const CreditOperationsPage = lazy(() => import("@/pages/admin/admin-route-pages").then((module) => ({ default: module.CreditOperationsPage })));
const AccessSettingsPage = lazy(() => import("@/pages/admin/admin-route-pages").then((module) => ({ default: module.AccessSettingsPage })));
const EmailSettingsPage = lazy(() => import("@/pages/admin/admin-route-pages").then((module) => ({ default: module.EmailSettingsPage })));
const FeatureAvailabilityPage = lazy(() => import("@/pages/admin/admin-route-pages").then((module) => ({ default: module.FeatureAvailabilityPage })));
const ChannelsPage = lazy(() => import("@/pages/admin/channels/channels-page"));
const LogicalModelsPage = lazy(() => import("@/pages/admin/logical-models/logical-models-page"));
const AdminPluginsPage = lazy(() => import("@/pages/admin/plugins/plugins-page"));
const LogsPage = lazy(() => import("@/pages/admin/logs/logs-page"));
const RedemptionCodesPage = lazy(() => import("@/pages/admin/redemption-codes/redemption-codes-page"));
const RuntimePolicySettingsPage = lazy(() => import("@/pages/admin/settings/runtime-policy-settings-page"));
const DrawingEngineSettingsPage = lazy(() => import("@/pages/admin/settings/drawing-engine-settings-page"));
const StorageSettingsPage = lazy(() => import("@/pages/admin/settings/storage-settings-page"));
const ArkPrivateAssetsSettingsPage = lazy(() => import("@/pages/admin/settings/ark-private-assets-settings-page"));
const ResponseInterceptionSettingsPage = lazy(() => import("@/pages/admin/settings/response-interception-settings-page"));
const ThirdPartySettingsPage = lazy(() => import("@/pages/admin/settings/libtv-settings-page"));
const StoryboardPromptsPage = lazy(() => import("@/pages/admin/storyboard-prompts/storyboard-prompts-page"));
const UsersPage = lazy(() => import("@/pages/admin/users/users-page"));
const AssetsPage = lazy(loadAssetsPage);
const LoginPage = lazy(() => import("@/pages/auth/login"));
const RegisterPage = lazy(() => import("@/pages/auth/register"));
const CanvasPage = lazy(loadCanvasPage);
const CanvasProjectPage = lazy(() => import("@/pages/canvas/project"));
const SharedCanvasPage = lazy(() => import("@/pages/canvas/shared"));
const CreatePage = lazy(loadCreatePage);
const NovelsPage = lazy(loadNovelsPage);
const NovelControlPage = lazy(() => import("@/pages/novels/control"));
const HomePage = lazy(() => import("@/pages/home"));
const NotFound = lazy(() => import("@/pages/not-found"));
const SkillsPage = lazy(() => import("@/pages/skills"));
const PluginsPage = lazy(() => import("@/pages/plugins"));
const EagleLibraryPage = lazy(() => import("@/pages/plugins/eagle"));
const TasksPage = lazy(() => import("@/pages/tasks"));
const WalletPage = lazy(loadWalletPage);
const ProjectsPage = lazy(loadProjectsPage);
const ProjectDetailPage = lazy(() => import("@/pages/projects/detail"));
const SettingsPage = lazy(() => import("@/pages/settings"));
const TestVoiceRecording = lazy(() => import("@/pages/test-voice-recording"));

function deferred(element: ReactNode) {
    return <Suspense fallback={<WorkspaceRouteLoader />}>{element}</Suspense>;
}

function fullScreenDeferred(element: ReactNode) {
    return <Suspense fallback={<FullScreenLoader label="正在打开创作空间" detail="准备当前页面" />}>{element}</Suspense>;
}

/**
 * DEV 专用实验室路由。
 *
 * lazy(() => import(...)) 写在函数体内，而不是模块顶层常量：
 * 生产构建时 import.meta.env.DEV 被替换为 false，本函数随之不可达，
 * 摇树会连同其中的动态 import 一起删除，实验室代码不进入生产依赖图。
 * 若把 lazy 提到模块顶层，动态 import 会被静态分析成真实 chunk 并打进 dist。
 */
function devRoutes() {
    const FolderPreviewLab = lazy(() => import("@/pages/dev/folder-preview-lab"));
    const DirectorReproLab = lazy(() => import("@/pages/dev/director-repro-lab"));
    return [
        { path: "/dev/folders", element: fullScreenDeferred(<FolderPreviewLab />), errorElement: <RouteErrorPage /> },
        { path: "/dev/director-repro", element: fullScreenDeferred(<DirectorReproLab />), errorElement: <RouteErrorPage /> },
    ];
}

export const router = createBrowserRouter([
    {
        element: <AuthScene />,
        errorElement: <RouteErrorPage />,
        children: [
            { path: "/login", element: fullScreenDeferred(<LoginPage />) },
            { path: "/register", element: fullScreenDeferred(<RegisterPage />) },
        ],
    },
    { path: "/share/canvas/:token", element: fullScreenDeferred(<SharedCanvasPage />), errorElement: <RouteErrorPage /> },
    ...(import.meta.env.DEV ? devRoutes() : []),
    {
        element: (
            <UserLayout>
                <Outlet />
            </UserLayout>
        ),
        errorElement: <RouteErrorPage />,
        children: [
            { path: "/", element: <Navigate to="/create" replace /> },
            { path: "/create", element: <RequireAuth>{deferred(<CreatePage />)}</RequireAuth> },
            { path: "/novels", element: <RequireAuth>{deferred(<NovelsPage />)}</RequireAuth> },
            { path: "/novels/:projectId/control", element: <RequireAuth>{deferred(<NovelControlPage />)}</RequireAuth> },
            { path: "/home", element: deferred(<HomePage />) },
            {
                path: "/tasks",
                element: (
                    <RequireAuth>
                        <RequireFeature feature="taskCenterEnabled">{deferred(<TasksPage />)}</RequireFeature>
                    </RequireAuth>
                ),
            },
            { path: "/assets", element: <RequireAuth>{deferred(<AssetsPage />)}</RequireAuth> },
            { path: "/skills", element: <RequireAuth>{deferred(<SkillsPage />)}</RequireAuth> },
            { path: "/plugins", element: <RequireAuth><RequireFeature feature="pluginCenterEnabled">{deferred(<PluginsPage />)}</RequireFeature></RequireAuth> },
            { path: "/plugins/eagle", element: <RequireAuth><RequireFeature feature="pluginCenterEnabled">{deferred(<EagleLibraryPage />)}</RequireFeature></RequireAuth> },
            {
                path: "/wallet",
                element: (
                    <RequireAuth>
                        <RequireFeature feature="creditsEnabled">{deferred(<WalletPage />)}</RequireFeature>
                    </RequireAuth>
                ),
            },
            { path: "/settings", element: <RequireAuth>{deferred(<SettingsPage />)}</RequireAuth> },
            { path: "/test-voice-recording", element: <RequireAuth>{deferred(<TestVoiceRecording />)}</RequireAuth> },
            {
                path: "/projects",
                element: (
                    <RequireAuth>
                        <RequireFeature feature="shortDramaEnabled">{deferred(<ProjectsPage />)}</RequireFeature>
                    </RequireAuth>
                ),
            },
            {
                path: "/projects/:projectId",
                element: (
                    <RequireAuth>
                        <RequireFeature feature="shortDramaEnabled">{deferred(<ProjectDetailPage />)}</RequireFeature>
                    </RequireAuth>
                ),
            },
            {
                path: "/projects/:projectId/:view",
                element: (
                    <RequireAuth>
                        <RequireFeature feature="shortDramaEnabled">{deferred(<ProjectDetailPage />)}</RequireFeature>
                    </RequireAuth>
                ),
            },
            {
                path: "/projects/:projectId/chapters/:chapterId",
                element: (
                    <RequireAuth>
                        <RequireFeature feature="shortDramaEnabled">{deferred(<ProjectDetailPage />)}</RequireFeature>
                    </RequireAuth>
                ),
            },
            {
                path: "/projects/:projectId/workflow/:unitId/:stage",
                element: (
                    <RequireAuth>
                        <RequireFeature feature="shortDramaEnabled">{deferred(<ProjectDetailPage />)}</RequireFeature>
                    </RequireAuth>
                ),
            },
            { path: "/canvas", element: <RequireAuth>{deferred(<CanvasPage />)}</RequireAuth> },
            { path: "/canvas/:id", element: <RequireAuth>{deferred(<CanvasProjectPage />)}</RequireAuth> },
            {
                path: "/admin",
                element: <RequireAuth>{deferred(<AdminPage />)}</RequireAuth>,
                children: [
                    { index: true, element: deferred(<AnalyticsPage />) },
                    { path: "users", element: deferred(<UsersPage />) },
                    { path: "channels", element: deferred(<ChannelsPage />) },
                    { path: "models", element: <RequireFeature feature="frontendModelsEnabled">{deferred(<LogicalModelsPage />)}</RequireFeature> },
                    { path: "plugins", element: deferred(<AdminPluginsPage />) },
                    { path: "prompt-templates", element: deferred(<StoryboardPromptsPage />) },
                    { path: "storyboard-prompts", element: <Navigate to="/admin/prompt-templates" replace /> },
                    { path: "announcements", element: deferred(<AnnouncementsPage />) },
                    { path: "resources", element: deferred(<StorageResourcesPage />) },
                    { path: "credit-operations", element: deferred(<CreditOperationsPage />) },
                    { path: "redemption-codes", element: deferred(<RedemptionCodesPage />) },
                    { path: "logs", element: deferred(<LogsPage />) },
                    { path: "settings", element: <Navigate to="runtime-policy" replace /> },
                    { path: "settings/drawing-engine", element: deferred(<DrawingEngineSettingsPage />) },
                    { path: "settings/concurrency", element: <Navigate to="/admin/settings/runtime-policy" replace /> },
                    { path: "settings/runtime-policy", element: deferred(<RuntimePolicySettingsPage />) },
                    { path: "settings/features", element: deferred(<FeatureAvailabilityPage />) },
                    { path: "settings/access", element: deferred(<AccessSettingsPage />) },
                    { path: "settings/email", element: deferred(<EmailSettingsPage />) },
                    { path: "settings/storage", element: deferred(<StorageSettingsPage />) },
                    { path: "settings/ark-private-assets", element: deferred(<ArkPrivateAssetsSettingsPage />) },
                    { path: "settings/response-interception", element: deferred(<ResponseInterceptionSettingsPage />) },
                    { path: "settings/third-party", element: deferred(<ThirdPartySettingsPage />) },
                    { path: "settings/libtv", element: <Navigate to="/admin/settings/third-party" replace /> },
                ],
            },
        ],
    },
    { path: "*", element: fullScreenDeferred(<NotFound />) },
]);
