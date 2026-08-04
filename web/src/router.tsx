import { createBrowserRouter, Navigate, Outlet } from "react-router";

import { RequireAuth } from "@/components/auth/require-auth";
import UserLayout from "@/layouts/user-layout";
import AdminPage from "@/pages/admin";
import { AccessSettingsPage, AnalyticsPage, AnnouncementsPage, CreditOperationsPage, EmailSettingsPage } from "@/pages/admin/admin-route-pages";
import ChannelsPage from "@/pages/admin/channels/channels-page";
import LogsPage from "@/pages/admin/logs/logs-page";
import RedemptionCodesPage from "@/pages/admin/redemption-codes/redemption-codes-page";
import RuntimePolicySettingsPage from "@/pages/admin/settings/runtime-policy-settings-page";
import DrawingEngineSettingsPage from "@/pages/admin/settings/drawing-engine-settings-page";
import StorageSettingsPage from "@/pages/admin/settings/storage-settings-page";
import StoryboardPromptsPage from "@/pages/admin/storyboard-prompts/storyboard-prompts-page";
import UsersPage from "@/pages/admin/users/users-page";
import AssetsPage from "@/pages/assets";
import { AuthScene } from "@/pages/auth/auth-scene";
import LoginPage from "@/pages/auth/login";
import RegisterPage from "@/pages/auth/register";
import CanvasPage from "@/pages/canvas";
import CanvasProjectPage from "@/pages/canvas/project";
import SharedCanvasPage from "@/pages/canvas/shared";
import CreatePage from "@/pages/create";
import HomePage from "@/pages/home";
import NotFound from "@/pages/not-found";
import RouteErrorPage from "@/pages/route-error";
import SkillsPage from "@/pages/skills";
import TasksPage from "@/pages/tasks";
import WalletPage from "@/pages/wallet";
import ProjectsPage from "@/pages/projects";
import ProjectDetailPage from "@/pages/projects/detail";
import SettingsPage from "@/pages/settings";

export const router = createBrowserRouter([
    {
        element: <AuthScene />,
        errorElement: <RouteErrorPage />,
        children: [
            { path: "/login", element: <LoginPage /> },
            { path: "/register", element: <RegisterPage /> },
        ],
    },
    { path: "/share/canvas/:token", element: <SharedCanvasPage />, errorElement: <RouteErrorPage /> },
    {
        element: (
            <UserLayout>
                <Outlet />
            </UserLayout>
        ),
        errorElement: <RouteErrorPage />,
        children: [
            { path: "/", element: <Navigate to="/create" replace /> },
            { path: "/create", element: <RequireAuth><CreatePage /></RequireAuth> },
            { path: "/home", element: <HomePage /> },
            { path: "/tasks", element: <RequireAuth><TasksPage /></RequireAuth> },
            { path: "/assets", element: <RequireAuth><AssetsPage /></RequireAuth> },
            { path: "/skills", element: <RequireAuth><SkillsPage /></RequireAuth> },
            { path: "/wallet", element: <RequireAuth><WalletPage /></RequireAuth> },
            { path: "/settings", element: <RequireAuth><SettingsPage /></RequireAuth> },
            { path: "/projects", element: <RequireAuth><ProjectsPage /></RequireAuth> },
            { path: "/projects/:projectId", element: <RequireAuth><ProjectDetailPage /></RequireAuth> },
            { path: "/projects/:projectId/:view", element: <RequireAuth><ProjectDetailPage /></RequireAuth> },
            { path: "/projects/:projectId/chapters/:chapterId", element: <RequireAuth><ProjectDetailPage /></RequireAuth> },
            { path: "/canvas", element: <RequireAuth><CanvasPage /></RequireAuth> },
            { path: "/canvas/:id", element: <RequireAuth><CanvasProjectPage /></RequireAuth> },
            {
                path: "/admin",
                element: <RequireAuth><AdminPage /></RequireAuth>,
                children: [
                    { index: true, element: <AnalyticsPage /> },
                    { path: "users", element: <UsersPage /> },
                    { path: "channels", element: <ChannelsPage /> },
                    { path: "prompt-templates", element: <StoryboardPromptsPage /> },
                    { path: "storyboard-prompts", element: <Navigate to="/admin/prompt-templates" replace /> },
                    { path: "announcements", element: <AnnouncementsPage /> },
                    { path: "credit-operations", element: <CreditOperationsPage /> },
                    { path: "redemption-codes", element: <RedemptionCodesPage /> },
                    { path: "logs", element: <LogsPage /> },
                    { path: "settings", element: <Navigate to="runtime-policy" replace /> },
                    { path: "settings/drawing-engine", element: <DrawingEngineSettingsPage /> },
                    { path: "settings/concurrency", element: <Navigate to="/admin/settings/runtime-policy" replace /> },
                    { path: "settings/runtime-policy", element: <RuntimePolicySettingsPage /> },
                    { path: "settings/access", element: <AccessSettingsPage /> },
                    { path: "settings/email", element: <EmailSettingsPage /> },
                    { path: "settings/storage", element: <StorageSettingsPage /> },
                ],
            },
        ],
    },
    { path: "*", element: <NotFound /> },
]);
