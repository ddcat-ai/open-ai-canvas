import { Tooltip } from "antd";
import { BarChart3, BellRing, Coins, FileClock, HardDrive, Home, Mail, MessageSquareText, PanelLeftClose, PanelLeftOpen, RadioTower, Settings2, ShieldCheck, TicketCheck, UsersRound } from "lucide-react";
import { useState, type ReactNode } from "react";
import { NavLink, Outlet } from "react-router";

import { AppChangelogButton } from "@/components/layout/app-changelog-modal";
import { cn } from "@/lib/utils";
import { AdminPageHeader } from "./admin-ui";

type AdminNavigationItem = {
    path: string;
    label: string;
    description: string;
    icon: ReactNode;
    secondary?: boolean;
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
            { path: "/admin/storyboard-prompts", label: "分镜提示词", description: "Agent 提示词版本", icon: <MessageSquareText className="size-4" /> },
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
            { path: "/admin/settings/runtime-policy", label: "资源与策略", description: "配额、并发、频控与超时", icon: <Settings2 className="size-4" />, secondary: true },
            { path: "/admin/settings/access", label: "登录与注册", description: "注册策略与 Linux.do", icon: <ShieldCheck className="size-4" />, secondary: true },
            { path: "/admin/settings/email", label: "邮件服务", description: "注册验证码 SMTP", icon: <Mail className="size-4" />, secondary: true },
            { path: "/admin/settings/storage", label: "存储服务", description: "OSS 与资源存储", icon: <HardDrive className="size-4" />, secondary: true },
        ],
    },
];

export function AdminShell() {
    const [collapsed, setCollapsed] = useState(() => window.localStorage.getItem("admin-sidebar-collapsed") === "true");
    const toggleCollapsed = () => {
        setCollapsed((current) => {
            const next = !current;
            window.localStorage.setItem("admin-sidebar-collapsed", String(next));
            return next;
        });
    };

    return (
        <main className="flex h-full min-h-0 overflow-hidden bg-muted/15 text-foreground">
            <aside className={cn("hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 motion-reduce:transition-none lg:flex", collapsed ? "w-16" : "w-64")}>
                <div className={cn("flex h-16 items-center border-b border-border", collapsed ? "justify-center px-2" : "gap-2.5 px-4")}>
                    <span className="size-6 shrink-0 bg-current" style={{ mask: "url(/logo.svg) center / contain no-repeat", WebkitMask: "url(/logo.svg) center / contain no-repeat" }} />
                    {!collapsed ? <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">无限画布</div><div className="mt-0.5 text-[11px] text-sidebar-foreground/50">运维管理后台</div></div> : null}
                    <Tooltip title={collapsed ? "展开侧栏" : "折叠侧栏"} placement="right">
                        <button type="button" className="grid size-8 shrink-0 place-items-center rounded-md text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-foreground" onClick={toggleCollapsed} aria-label={collapsed ? "展开侧栏" : "折叠侧栏"}>
                            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
                        </button>
                    </Tooltip>
                </div>
                <AdminNavigation collapsed={collapsed} />
                <div className="border-t border-border p-2">
                    <Tooltip title={collapsed ? "更新日志" : undefined} placement="right">
                        <AppChangelogButton className={cn("flex h-9 w-full items-center rounded-md text-sm text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground", collapsed ? "justify-center px-0" : "gap-2 px-3")} showVersion={!collapsed} />
                    </Tooltip>
                    <Tooltip title={collapsed ? "返回创作台" : undefined} placement="right">
                        <NavLink to="/canvas" className={cn("flex h-9 items-center rounded-md text-sm text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground", collapsed ? "justify-center px-0" : "gap-2 px-3")}>
                            <Home className="size-4" />
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

export function AdminPageFrame({ title, description, actions, children }: { title: string; description: string; actions?: ReactNode; children: ReactNode }) {
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <AdminPageHeader title={title} description={description} actions={<>{actions}<AppChangelogButton className="grid size-8 place-items-center rounded-md text-foreground/55 transition-colors hover:bg-muted hover:text-foreground lg:hidden [&_svg]:size-4" /></>} />
            <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
                <div className="mx-auto max-w-[1440px]">{children}</div>
            </div>
        </div>
    );
}

function MobileAdminNavigation() {
    return (
        <nav className="hide-scrollbar flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-background px-3 py-2 lg:hidden" aria-label="管理后台分区">
            {adminNavigation.flatMap((group) => group.items).map((item) => (
                <NavLink key={item.path} to={item.path} end={item.path === "/admin"} className={({ isActive }) => cn("flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs transition", isActive ? "bg-foreground text-background" : "bg-muted/50 text-foreground/60 hover:text-foreground")}>
                    {item.icon}<span>{item.label}</span>
                </NavLink>
            ))}
        </nav>
    );
}

function AdminNavigation({ collapsed }: { collapsed: boolean }) {
    return (
        <nav className="thin-scrollbar flex-1 overflow-y-auto px-2 py-3" aria-label="管理后台菜单">
            {adminNavigation.map((group) => (
                <div key={group.label} className="mb-4">
                    {!collapsed ? <div className="mb-1.5 px-2.5 text-[11px] font-medium text-sidebar-foreground/45">{group.label}</div> : <div className="mx-auto mb-2 h-px w-7 bg-sidebar-border" />}
                    <div className="space-y-0.5">
                        {group.items.map((item) => (
                            <Tooltip key={item.path} title={collapsed ? item.label : undefined} placement="right">
                                <NavLink
                                    to={item.path}
                                    end={item.path === "/admin"}
                                    className={({ isActive }) => cn(
                                        "relative flex h-9 items-center rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sidebar-ring",
                                        collapsed ? "justify-center px-0" : item.secondary ? "gap-2 pl-6 pr-3" : "gap-2 px-3",
                                        isActive ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-sidebar-foreground/65 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                                    )}
                                >
                                    {({ isActive }) => <>{isActive ? <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-sidebar-primary" aria-hidden="true" /> : null}{item.icon}{!collapsed ? <span className="truncate">{item.label}</span> : null}</>}
                                </NavLink>
                            </Tooltip>
                        ))}
                    </div>
                </div>
            ))}
        </nav>
    );
}
