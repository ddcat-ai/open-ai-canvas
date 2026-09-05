import { App, Button, Popconfirm, Tag, Typography } from "antd";
import { CheckCircle2, Copy, ExternalLink, LogIn, LogOut, Network, RefreshCw, Server, SquareTerminal } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { DreaminaAgentError, getDreaminaStatus, loginDreamina, logoutDreamina, type DreaminaCliStatus } from "@/services/local-dreamina-cli";
import { getLocalRuntimeSessionClient, useLocalRuntimeStore, type LocalRuntimeConnectionState } from "@/stores/use-local-runtime-store";
import { useLocalSubscriptionCliStore } from "@/stores/use-local-subscription-cli-store";

type PendingAction = "refresh" | "login" | "logout" | "";
type PresentationAction = "refresh" | "login" | "open_verification" | "logout" | null;
type Presentation = {
    label: string;
    tone: "success" | "processing" | "warning" | "error" | "default";
    action: PresentationAction;
    actionLabel?: string;
    creditLabel?: string;
    creditObservedAtLabel?: string;
};

export const LOCAL_CLI_SETTINGS_COPY = {
    runtimeTitle: "本机连接",
    runtimeConnected: "本机服务已连接，CLI 状态会自动同步。",
    runtimeDetecting: "正在检测本机服务；请确认已启动当前版本。",
    runtimeReconnect: "重新连接",
    runtimeSafety: "官方 CLI 登录资料保存在本机；本页面不读取或上传 Cookie、浏览器 Profile 或登录令牌。",
    runtimeRefresh: "刷新状态",
    dreaminaDescription: "直接读取当前 Windows 用户的官方即梦 CLI 登录状态。",
    dreaminaDisconnected: "连接本机服务后自动检测",
    dreaminaDisconnectedMessage: "重新连接本机服务后，将自动读取官方 CLI 状态。",
    dreaminaMembership: "账号生成权限：未知。当前页面只确认本机适配器支持与登录状态；具体账号是否可生成，以官方最终结果为准。",
    dreaminaConsistency: "任务状态通过后台轮询最终同步，不是实时推送；关闭页面不会停止已经提交的官方任务。",
    dreaminaCancel: "官方 Dreamina CLI 当前不提供取消命令；官方已接受的任务只能转入后台继续同步，不能伪装成已取消。",
    dreaminaAccountSwitch: "本机任务运行期间，请不要在其他程序中切换 Dreamina CLI 账号；外部换号无法被本页面实时感知。",
    dreaminaRefresh: "刷新状态",
} as const;

export function localCliSettingsPresentation(input: { connection: string; moduleAvailable: boolean; dreamina?: DreaminaCliStatus; timeZone?: string }): { runtime: Presentation; dreamina: Presentation } {
    const runtime = runtimePresentation(input.connection as LocalRuntimeConnectionState);
    if (input.connection !== "connected") {
        return { runtime, dreamina: { label: LOCAL_CLI_SETTINGS_COPY.dreaminaDisconnected, tone: "default", action: null } };
    }
    if (!input.moduleAvailable) {
        return { runtime, dreamina: { label: "模块未加载", tone: "error", action: "refresh" } };
    }
    const status = input.dreamina;
    if (!status) return { runtime, dreamina: { label: "正在检测", tone: "processing", action: "refresh" } };
    const creditObservedAt = formatCreditObservedAt(status.creditObservedAt, input.timeZone);
    const hasScopedCredit = status.totalCredit !== undefined && Boolean(status.accountBinding) && status.sessionEpoch !== undefined && Boolean(creditObservedAt);
    if (status.state === "missing") return { runtime, dreamina: { label: "未安装", tone: "error", action: "refresh" } };
    if (status.state === "login_pending") return { runtime, dreamina: { label: "等待官方授权", tone: "processing", action: "open_verification" } };
    if (status.authenticated)
        return {
            runtime,
            dreamina: {
                label: "已登录",
                tone: "success",
                action: "logout",
                ...(!hasScopedCredit
                    ? {}
                    : {
                          creditLabel: `即梦积分 ${new Intl.NumberFormat("zh-CN").format(status.totalCredit!)}`,
                      }),
                ...(creditObservedAt ? { creditObservedAtLabel: `上次刷新积分 ${creditObservedAt}` } : {}),
            },
        };
    if (status.state === "installed") return { runtime, dreamina: { label: "未登录", tone: "warning", action: "login" } };
    return { runtime, dreamina: { label: "检测失败", tone: "error", action: "refresh" } };
}

export function formatCreditObservedAt(value: unknown, timeZone?: string) {
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return undefined;
    try {
        const parts = new Intl.DateTimeFormat("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
            ...(timeZone ? { timeZone } : {}),
        }).formatToParts(new Date(value));
        const hour = parts.find((part) => part.type === "hour")?.value;
        const minute = parts.find((part) => part.type === "minute")?.value;
        return hour && minute ? `${hour}:${minute}` : undefined;
    } catch {
        return undefined;
    }
}

export function LocalCliSettings() {
    const { message } = App.useApp();
    const connection = useLocalRuntimeStore((state) => state.connection);
    const connecting = useLocalRuntimeStore((state) => state.connecting);
    const modules = useLocalRuntimeStore((state) => state.modules);
    const runtimeError = useLocalRuntimeStore((state) => state.error);
    const connect = useLocalRuntimeStore((state) => state.connect);
    const moduleAvailable = modules.some((module) => module.id === "dreamina");
    const subscriptionModuleAvailable = modules.some((module) => module.id === "subscription-cli");
    const subscriptionState = useLocalSubscriptionCliStore((state) => state.state);
    const subscriptionStatus = useLocalSubscriptionCliStore((state) => state.status);
    const refreshSubscription = useLocalSubscriptionCliStore((state) => state.sync);
    const [status, setStatus] = useState<DreaminaCliStatus>();
    const [pending, setPending] = useState<PendingAction>("");
    const lifecycle = useRef<{ revision: number; controller: AbortController | null }>({
        revision: 0,
        controller: null,
    });
    const presentation = localCliSettingsPresentation({ connection, moduleAvailable, dreamina: status });

    const refreshRuntime = useCallback(() => {
        const controller = new AbortController();
        void connect(controller.signal);
    }, [connect]);

    const runDreamina = useCallback(
        async (action: Exclude<PendingAction, "">) => {
            if (connection !== "connected" || !moduleAvailable) {
                message.warning("请先连接已加载 Dreamina 的本机运行时");
                return;
            }
            lifecycle.current.controller?.abort();
            const revision = ++lifecycle.current.revision;
            const controller = new AbortController();
            lifecycle.current.controller = controller;
            setPending(action);
            try {
                const client = getLocalRuntimeSessionClient();
                const options = { signal: controller.signal };
                const next = action === "login" ? await loginDreamina(client, options) : action === "logout" ? await logoutDreamina(client, options) : await getDreaminaStatus(client, options);
                if (revision !== lifecycle.current.revision || controller.signal.aborted) return;
                setStatus(next);
                if (action === "logout") message.success("Dreamina CLI 已退出登录");
                if (action === "login" && next.state === "login_pending") {
                    message.info("请打开官方验证页完成授权，再刷新状态");
                }
            } catch (error) {
                if (revision !== lifecycle.current.revision || controller.signal.aborted) return;
                setStatus(undefined);
                message.error(error instanceof DreaminaAgentError ? error.message : "Dreamina CLI 操作失败");
            } finally {
                if (revision === lifecycle.current.revision) {
                    lifecycle.current.controller = null;
                    setPending("");
                }
            }
        },
        [connection, message, moduleAvailable],
    );

    useEffect(() => {
        if (connection !== "connected" || !moduleAvailable) {
            lifecycle.current.revision++;
            lifecycle.current.controller?.abort();
            lifecycle.current.controller = null;
            setStatus(undefined);
            setPending("");
            return;
        }
        const timer = window.setTimeout(() => {
            void runDreamina("refresh");
        }, 0);
        return () => {
            window.clearTimeout(timer);
            lifecycle.current.revision++;
            lifecycle.current.controller?.abort();
            lifecycle.current.controller = null;
        };
    }, [connection, moduleAvailable, runDreamina]);

    const openVerification = () => {
        if (status?.verificationUri) window.open(status.verificationUri, "_blank", "noopener,noreferrer");
    };

    return (
        <div className="space-y-4">
            <section aria-labelledby="local-runtime-title" className="rounded-md border border-border bg-background px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                        <Server className="size-4 shrink-0 text-foreground/60" />
                        <h2 id="local-runtime-title" className="text-base font-semibold">
                            {LOCAL_CLI_SETTINGS_COPY.runtimeTitle}
                        </h2>
                        <Tag color={presentation.runtime.tone} className="m-0">
                            {presentation.runtime.label}
                        </Tag>
                        <p className="min-w-0 text-sm text-foreground/60">{connection === "connected" ? LOCAL_CLI_SETTINGS_COPY.runtimeConnected : runtimeError || LOCAL_CLI_SETTINGS_COPY.runtimeDetecting}</p>
                        <p className="basis-full text-xs leading-5 text-foreground/55">{LOCAL_CLI_SETTINGS_COPY.runtimeSafety}</p>
                    </div>
                    <Button icon={<RefreshCw className="size-4" />} loading={connecting} onClick={refreshRuntime}>
                        {presentation.runtime.actionLabel || LOCAL_CLI_SETTINGS_COPY.runtimeRefresh}
                    </Button>
                </div>
            </section>

            <section aria-labelledby="subscription-cli-title" className="rounded-md border border-border bg-background p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 pb-4">
                    <div className="flex min-w-0 items-start gap-3">
                        <span className="grid size-10 shrink-0 place-items-center rounded-[var(--r-lg)] bg-foreground/5">
                            <Network className="size-5" />
                        </span>
                        <div>
                            <div className="flex flex-wrap items-center gap-2">
                                <h2 id="subscription-cli-title" className="text-base font-semibold">
                                    CLIProxyAPI
                                </h2>
                                <Tag color={subscriptionStatus?.state === "ready" ? "success" : subscriptionState === "loading" ? "processing" : subscriptionStatus?.running ? "warning" : "error"} className="m-0">
                                    {connection !== "connected"
                                        ? "等待本机连接"
                                        : !subscriptionModuleAvailable
                                          ? "模块未加载"
                                          : subscriptionState === "loading"
                                            ? "正在检测"
                                            : subscriptionStatus?.state === "ready"
                                              ? "已连接"
                                              : subscriptionStatus?.running
                                                ? "需要配置"
                                                : "未运行"}
                                </Tag>
                                <Tag className="m-0">127.0.0.1:8317</Tag>
                            </div>
                            <p className="mt-1 text-sm text-foreground/60">连接 ChatGPT/Codex 与 Google Antigravity 订阅账号，提供受控文本和生图能力。</p>
                        </div>
                    </div>
                    <Button icon={<RefreshCw className="size-4" />} loading={subscriptionState === "loading"} disabled={connection !== "connected" || !subscriptionModuleAvailable} onClick={() => void refreshSubscription()}>
                        重新检测
                    </Button>
                </div>
                <div className="space-y-4 pt-4">
                    <p className="text-sm text-foreground/75">
                        {connection !== "connected" ? "重新连接本机服务后，将自动检测 CLIProxyAPI。" : !subscriptionModuleAvailable ? "当前 Runtime 未加载 CLIProxyAPI 模块，请更新并重启 Runtime。" : subscriptionStatus?.message || "正在检测 CLIProxyAPI…"}
                    </p>
                    <div>
                        <h3 className="text-sm font-semibold">CLI 安装与环境检测</h3>
                        <p className="mt-1 text-xs text-foreground/55">CLIProxyAPI 是本功能必需服务；其余官方 CLI 仅展示本机环境，未安装不影响通过 CLIProxyAPI 使用已登录订阅。</p>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                            {(
                                subscriptionStatus?.tools || [
                                    { id: "cli-proxy-api", displayName: "CLIProxyAPI", installed: false },
                                    { id: "codex", displayName: "Codex CLI", installed: false },
                                    { id: "antigravity", displayName: "Antigravity CLI", installed: false },
                                    { id: "gemini", displayName: "Gemini CLI", installed: false },
                                ]
                            ).map((tool) => (
                                <div key={tool.id} className="flex items-center justify-between rounded-md border border-border/70 px-3 py-2 text-sm">
                                    <span>{tool.displayName}</span>
                                    <Tag color={tool.installed ? "success" : "default"} className="m-0">
                                        {tool.installed ? "已安装" : tool.id === "cli-proxy-api" ? "未检测到" : "可选，未安装"}
                                    </Tag>
                                </div>
                            ))}
                        </div>
                    </div>
                    <p className="text-xs leading-6 text-foreground/55">本页面不读取或上传订阅令牌。CLIProxyAPI 客户端密钥仅由本机 Runtime 从独立文件读取；真实调用会再次确认，并且不会自动回退到 API Key 或其他付费渠道。</p>
                </div>
            </section>

            <section aria-labelledby="dreamina-cli-title" className="rounded-md border border-border bg-background p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 pb-4">
                    <div className="flex min-w-0 items-start gap-3">
                        <span className="grid size-10 shrink-0 place-items-center rounded-[var(--r-lg)] bg-foreground/5">
                            <SquareTerminal className="size-5" />
                        </span>
                        <div>
                            <div className="flex flex-wrap items-center gap-2">
                                <h2 id="dreamina-cli-title" className="text-base font-semibold">
                                    Dreamina CLI
                                </h2>
                                <Tag color={presentation.dreamina.tone} className="m-0">
                                    {presentation.dreamina.label}
                                </Tag>
                                {status?.version ? <Tag className="m-0">v{status.version}</Tag> : null}
                                {presentation.dreamina.creditLabel ? (
                                    <Tag color="blue" className="m-0">
                                        {presentation.dreamina.creditLabel}
                                    </Tag>
                                ) : null}
                            </div>
                            <p className="mt-1 text-sm text-foreground/60">{LOCAL_CLI_SETTINGS_COPY.dreaminaDescription}</p>
                            {presentation.dreamina.creditObservedAtLabel ? <p className="mt-1 text-xs text-foreground/50">{presentation.dreamina.creditObservedAtLabel}</p> : null}
                        </div>
                    </div>
                    <Button icon={<RefreshCw className="size-4" />} loading={pending === "refresh"} disabled={connection !== "connected" || !moduleAvailable || Boolean(pending && pending !== "refresh")} onClick={() => void runDreamina("refresh")}>
                        {LOCAL_CLI_SETTINGS_COPY.dreaminaRefresh}
                    </Button>
                </div>

                <div className="grid gap-4 pt-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                    <div className="space-y-3 text-sm">
                        <p className="text-foreground/75">{status?.message || dreaminaEmptyMessage(connection, moduleAvailable)}</p>
                        <p className="text-xs leading-6 text-foreground/60">{LOCAL_CLI_SETTINGS_COPY.dreaminaMembership}</p>
                        <p className="text-xs leading-6 text-foreground/55">{LOCAL_CLI_SETTINGS_COPY.dreaminaConsistency}</p>
                        <p className="text-xs leading-6 text-foreground/55">{LOCAL_CLI_SETTINGS_COPY.dreaminaCancel}</p>
                        <p className="text-xs leading-6 text-foreground/55">{LOCAL_CLI_SETTINGS_COPY.dreaminaAccountSwitch}</p>
                        {status?.state === "missing" ? (
                            <p className="rounded-md bg-foreground/[0.035] p-3 text-xs leading-6 text-foreground/65">未检测到官方 Dreamina CLI。请按官方说明安装并确保命令在 PATH 中可用，安装后点击“刷新状态”。当前版本不内置未经核实的安装源。</p>
                        ) : null}
                        {status?.state === "login_pending" ? (
                            <div className="rounded-md border border-border/70 p-3">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-xs text-foreground/60">官方验证用户码</span>
                                    <Typography.Text
                                        strong
                                        copyable={{
                                            text: status.userCode,
                                            icon: [<Copy className="size-3.5" key="copy" />, <CheckCircle2 className="size-3.5" key="done" />],
                                        }}
                                    >
                                        {status.userCode}
                                    </Typography.Text>
                                </div>
                                {status.expiresAt ? <p className="mt-1 text-xs text-foreground/50">有效期至 {new Date(status.expiresAt).toLocaleTimeString()}</p> : null}
                            </div>
                        ) : null}
                    </div>

                    <div className="flex flex-wrap gap-2 lg:justify-end">
                        {status?.state === "installed" ? (
                            <Button type="primary" icon={<LogIn className="size-4" />} loading={pending === "login"} disabled={Boolean(pending && pending !== "login")} onClick={() => void runDreamina("login")}>
                                登录
                            </Button>
                        ) : null}
                        {status?.state === "login_pending" ? (
                            <Button type="primary" icon={<ExternalLink className="size-4" />} onClick={openVerification}>
                                打开官方验证页
                            </Button>
                        ) : null}
                        {status?.authenticated ? (
                            <Popconfirm title="退出 Dreamina CLI？" description="只清除当前 OS 用户的官方 CLI 登录状态。" okText="退出" cancelText="取消" onConfirm={() => void runDreamina("logout")}>
                                <Button danger icon={<LogOut className="size-4" />} loading={pending === "logout"}>
                                    退出登录
                                </Button>
                            </Popconfirm>
                        ) : null}
                    </div>
                </div>
            </section>
        </div>
    );
}

function runtimePresentation(connection: LocalRuntimeConnectionState): Presentation {
    if (connection === "connected") return { label: "已连接", tone: "success", action: "refresh" };
    if (connection === "connecting") return { label: "正在检测", tone: "processing", action: null };
    if (connection === "origin_not_trusted") return { label: "需要重新连接", tone: "error", action: "refresh", actionLabel: LOCAL_CLI_SETTINGS_COPY.runtimeReconnect };
    if (connection === "unreachable") return { label: "未发现", tone: "error", action: "refresh" };
    if (connection === "incompatible") return { label: "版本不兼容", tone: "error", action: "refresh" };
    if (connection === "runtime_error") return { label: "运行时错误", tone: "error", action: "refresh" };
    return { label: "尚未检测", tone: "default", action: "refresh" };
}

function dreaminaEmptyMessage(connection: LocalRuntimeConnectionState, moduleAvailable: boolean) {
    if (connection !== "connected") return LOCAL_CLI_SETTINGS_COPY.dreaminaDisconnectedMessage;
    if (!moduleAvailable) return "当前 Runtime 未加载 Dreamina 模块，请更新并重启 Runtime。";
    return "正在检测 Dreamina CLI…";
}
