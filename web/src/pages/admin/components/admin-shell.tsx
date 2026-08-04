import { Tooltip } from "antd";
import { ArrowLeft, BarChart3, BellRing, Coins, FileClock, HardDrive, Home, Infinity as InfinityIcon, Mail, MessageSquareText, Paintbrush, PanelLeftClose, PanelLeftOpen, RadioTower, Settings2, ShieldCheck, TicketCheck, ToggleLeft, UsersRound } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, NavLink, Outlet } from "react-router";

import { AppChangelogButton } from "@/components/layout/app-changelog-modal";
import { WorkspacePage } from "@/components/layout/workspace-page";
import { WORKSPACE_SIDEBAR_STORAGE_KEY } from "@/components/layout/workspace-sidebar-state";
import { cn } from "@/lib/utils";

type AdminNavigationItem = {
    path: string;
    label: string;
    description: string;
    icon: ReactNode;
};

const adminNavigation: Array<{ label: string; items: AdminNavigationItem[] }> = [
    {
        label: "概览",
        items: [{ path: "/admin", label: "数据概览", description: "活跃、调用与成本趋势", icon: <BarChart3 className="size-4" /> }],
    },
    {
        label: "平台资源",
        items: [
            { path: "/admin/users", label: "用户管理", description: "账号、角色与状态", icon: <UsersRound className="size-4" /> },
            { path: "/admin/channels", label: "系统渠道", description: "渠道、模型与售价", icon: <RadioTower className="size-4" /> },
            { path: "/admin/prompt-templates", label: "提示词模板", description: "平台创作策略版本", icon: <MessageSquareText className="size-4" /> },
        ],
    },
    {
        label: "运营",
        items: [
            { path: "/admin/announcements", label: "系统公告", description: "发布、关闭与历史公告", icon: <BellRing className="size-4" /> },
            { path: "/admin/credit-operations", label: "积分运营", description: "人工调账与异常计费", icon: <Coins className="size-4" /> },
            { path: "/admin/redemption-codes", label: "兑换码", description: "生成与查看兑换码批次", icon: <TicketCheck className="size-4" /> },
            { path: "/admin/logs", label: "请求明细", description: "上游调用与费用", icon: <FileClock className="size-4" /> },
        ],
    },
    {
        label: "系统配置",
        items: [
            { path: "/admin/settings/features", label: "功能开放", description: "菜单、页面与积分模式", icon: <ToggleLeft className="size-4" /> },
            { path: "/admin/settings/drawing-engine", label: "绘图工具", description: "画布绘图节点默认引擎", icon: <Paintbrush className="size-4" /> },
            { path: "/admin/settings/runtime-policy", label: "资源与策略", description: "配额、并发、频控与超时", icon: <Settings2 className="size-4" /> },
            { path: "/admin/settings/access", label: "登录与注册", description: "注册策略与 Linux.do", icon: <ShieldCheck className="size-4" /> },
            { path: "/admin/settings/email", label: "邮件服务", description: "注册验证码 SMTP", icon: <Mail className="size-4" /> },
            { path: "/admin/settings/storage", label: "存储服务", description: "OSS 与资源存储", icon: <HardDrive className="size-4" /> },
        ],
    },
];

export function AdminShell() {
    const [collapsed, setCollapsed] = useState(() => window.localStorage.getItem(WORKSPACE_SIDEBAR_STORAGE_KEY) === "1");
    const toggleCollapsed = () => {
        setCollapsed((current) => {
            const next = !current;
            window.localStorage.setItem(WORKSPACE_SIDEBAR_STORAGE_KEY, next ? "1" : "0");
            return next;
        });
    };

    return (
        <main className="app-user-workspace flex h-full min-h-0 overflow-hidden text-foreground">
            <aside className={cn("app-workspace-sidebar hidden shrink-0 flex-col overflow-hidden lg:flex", collapsed ? "w-[60px]" : "w-[212px]")}>
                <div className={cn("flex h-13 shrink-0 items-center", collapsed ? "justify-center" : "gap-2 px-3")}>
                    {!collapsed ? (
                        <Link to="/" className="flex min-w-0 flex-1 items-center gap-2" title="影策">
                            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-foreground text-background"><InfinityIcon className="size-4" /></span>
                            <span className="min-w-0"><span className="block truncate text-[var(--fs-body)] font-semibold">影策</span><span className="block truncate text-[var(--fs-micro)] text-foreground/42">管理后台</span></span>
                        </Link>
                    ) : null}
                    <Tooltip title={collapsed ? "展开侧栏" : "折叠侧栏"} placement="right">
                        <button type="button" className="app-workspace-icon-button shrink-0" onClick={toggleCollapsed} aria-label={collapsed ? "展开侧栏" : "折叠侧栏"}>
                            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
                        </button>
                    </Tooltip>
                </div>
                <AdminNavigation collapsed={collapsed} />
                <div className="shrink-0 border-t border-border/70 p-2">
                    <Tooltip title={collapsed ? "更新日志" : undefined} placement="right">
                        <AppChangelogButton className={cn("flex h-8 w-full items-center rounded text-[var(--fs-label)] text-foreground/52 transition-colors hover:bg-foreground/[.055] hover:text-foreground", collapsed ? "justify-center px-0" : "gap-2 px-2")} showVersion={!collapsed} />
                    </Tooltip>
                    <Tooltip title={collapsed ? "返回创作台" : undefined} placement="right">
                        <NavLink to="/canvas" className={cn("flex h-8 items-center rounded text-[var(--fs-label)] text-foreground/52 transition-colors hover:bg-foreground/[.055] hover:text-foreground", collapsed ? "justify-center px-0" : "gap-2 px-2")}>
                            <Home className="size-3.5" />
                            {!collapsed ? <span>返回创作台</span> : null}
                        </NavLink>
                    </Tooltip>
                </div>
            </aside>
            <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <MobileAdminNavigation />
                <Outlet />
            </section>
        </main>
    );
}

export function AdminPageFrame({ title, description, actions, back, children }: { title: string; description: string; actions?: ReactNode; back?: { label: string; onClick: () => void }; children: ReactNode }) {
    return (
        <WorkspacePage>
            <div className="w-full pb-5">
                <header className="flex min-h-14 flex-col gap-3 border-b border-border/75 pb-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-2.5">
                        {back ? (
                            <Tooltip title={back.label}>
                                <button type="button" className="app-workspace-icon-button size-9 shrink-0" aria-label={back.label} onClick={back.onClick}>
                                    <ArrowLeft className="size-4" />
                                </button>
                            </Tooltip>
                        ) : null}
                        <div className="min-w-0">
                            <h1 className="truncate text-xl font-semibold leading-7">{title}</h1>
                            <p className="mt-0.5 truncate text-xs leading-5 text-foreground/52">{description}</p>
                        </div>
                    </div>
                    {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
                </header>
                {children}
            </div>
        </WorkspacePage>
    );
}

function MobileAdminNavigation() {
    return (
        <nav className="hide-scrollbar flex shrink-0 gap-1 overflow-x-auto border-b border-border/70 bg-background px-3 py-2 lg:hidden" aria-label="管理后台分区">
            {adminNavigation.flatMap((group) => group.items).map((item) => (
                <NavLink key={item.path} to={item.path} end={item.path === "/admin"} className={({ isActive }) => cn("app-workspace-nav-link flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors", isActive ? "is-active font-medium" : "text-foreground/60 hover:bg-foreground/[.05] hover:text-foreground")}>
                    {item.icon}<span>{item.label}</span>
                </NavLink>
            ))}
            <AppChangelogButton className="grid size-8 shrink-0 place-items-center rounded-md text-foreground/55 transition-colors hover:bg-foreground/[.05] hover:text-foreground [&_svg]:size-4" />
        </nav>
    );
}

function AdminNavigation({ collapsed }: { collapsed: boolean }) {
    return (
        <nav className="thin-scrollbar flex-1 overflow-y-auto px-2 py-2" aria-label="管理后台菜单">
            {adminNavigation.map((group) => (
                <div key={group.label} className="mb-3">
                    {!collapsed ? <div className="mb-1 px-2.5 text-[var(--fs-tiny)] font-medium text-foreground/38">{group.label}</div> : <div className="mx-auto mb-1.5 h-px w-7 bg-border/80" />}
                    <div className="space-y-0.5">
                        {group.items.map((item) => (
                            <Tooltip key={item.path} title={collapsed ? item.label : undefined} placement="right">
                                <NavLink
                                    to={item.path}
                                    end={item.path === "/admin"}
                                    className={({ isActive }) => cn(
                                        "app-workspace-nav-link flex h-9 items-center rounded-md text-[var(--fs-body)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                                        collapsed ? "justify-center px-0" : "gap-2.5 px-2.5",
                                        isActive ? "is-active font-medium" : "text-foreground/62 hover:bg-foreground/[.05] hover:text-foreground",
                                    )}
                                >
                                    {item.icon}{!collapsed ? <span className="truncate">{item.label}</span> : null}
                                </NavLink>
                            </Tooltip>
                        ))}
                    </div>
                </div>
            ))}
        </nav>
    );
}
