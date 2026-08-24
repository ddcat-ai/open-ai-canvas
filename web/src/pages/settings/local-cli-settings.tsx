import { App, Button, Popconfirm, Tag, Typography } from "antd";
import { CheckCircle2, Copy, ExternalLink, LogIn, LogOut, RefreshCw, Server, SquareTerminal } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { DreaminaAgentError, getDreaminaStatus, loginDreamina, logoutDreamina, type DreaminaCliStatus } from "@/services/local-dreamina-cli";
import { getLocalRuntimeSessionClient, useLocalRuntimeStore, type LocalRuntimeConnectionState } from "@/stores/use-local-runtime-store";
import { useTranslation } from "react-i18next";
import { t } from "@/i18n";

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
    runtimeTitle: t("settings:local-connection"),
    runtimeConnected: t("settings:local-service-connected-cli-status-syncs-automatically"),
    runtimeDetecting: t("settings:detecting-local-service-make-sure-the-current-version-is-running"),
    runtimeReconnect: t("settings:reconnect"),
    runtimeSafety: t("settings:official-cli-credentials-stay-on-this-machine-this-page-never-reads-or-u"),
    runtimeRefresh: t("settings:refresh-status"),
    dreaminaDescription: t("settings:reads-the-official-dreamina-cli-sign-in-status-for-the-current-windows-u"),
    dreaminaDisconnected: t("settings:detected-automatically-once-the-local-service-connects"),
    dreaminaDisconnectedMessage: t("settings:the-official-cli-status-is-read-automatically-after-reconnecting-the-loc"),
    dreaminaMembership: t("settings:account-generation-permission-unknown-this-page-only-verifies-adapter-su"),
    dreaminaConsistency: t("settings:task-states-are-synced-by-backend-polling-not-pushed-in-real-time-closin"),
    dreaminaCancel: t("settings:the-official-dreamina-cli-offers-no-cancel-command-accepted-tasks-keep-s"),
    dreaminaAccountSwitch: t("settings:do-not-switch-dreamina-cli-accounts-in-other-apps-while-local-tasks-run"),
    dreaminaRefresh: t("settings:refresh-status"),
} as const;

export function localCliSettingsPresentation(input: { connection: string; moduleAvailable: boolean; dreamina?: DreaminaCliStatus; timeZone?: string }): { runtime: Presentation; dreamina: Presentation } {
    const runtime = runtimePresentation(input.connection as LocalRuntimeConnectionState);
    if (input.connection !== "connected") {
        return { runtime, dreamina: { label: LOCAL_CLI_SETTINGS_COPY.dreaminaDisconnected, tone: "default", action: null } };
    }
    if (!input.moduleAvailable) {
        return { runtime, dreamina: { label: t("settings:module-not-loaded"), tone: "error", action: "refresh" } };
    }
    const status = input.dreamina;
    if (!status) return { runtime, dreamina: { label: t("settings:detecting"), tone: "processing", action: "refresh" } };
    const creditObservedAt = formatCreditObservedAt(status.creditObservedAt, input.timeZone);
    const hasScopedCredit = status.totalCredit !== undefined && Boolean(status.accountBinding) && status.sessionEpoch !== undefined && Boolean(creditObservedAt);
    if (status.state === "missing") return { runtime, dreamina: { label: t("settings:not-installed"), tone: "error", action: "refresh" } };
    if (status.state === "login_pending") return { runtime, dreamina: { label: t("settings:waiting-for-authorization"), tone: "processing", action: "open_verification" } };
    if (status.authenticated)
        return {
            runtime,
            dreamina: {
                label: t("settings:signed-in"),
                tone: "success",
                action: "logout",
                ...(!hasScopedCredit
                    ? {}
                    : {
                          creditLabel: `即梦积分 ${new Intl.NumberFormat("zh-CN").format(status.totalCredit!)}`,
                      }),
                ...(creditObservedAt ? { creditObservedAtLabel: t("settings:credits-last-refreshed-param", { creditObservedAt: creditObservedAt }) } : {}),
            },
        };
    if (status.state === "installed") return { runtime, dreamina: { label: t("settings:not-signed-in"), tone: "warning", action: "login" } };
    return { runtime, dreamina: { label: t("settings:detection-failed"), tone: "error", action: "refresh" } };
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
    const { t } = useTranslation("canvas");
    const { message } = App.useApp();
    const connection = useLocalRuntimeStore((state) => state.connection);
    const connecting = useLocalRuntimeStore((state) => state.connecting);
    const modules = useLocalRuntimeStore((state) => state.modules);
    const runtimeError = useLocalRuntimeStore((state) => state.error);
    const connect = useLocalRuntimeStore((state) => state.connect);
    const moduleAvailable = modules.some((module) => module.id === "dreamina");
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
                message.warning(t("settings:connect-a-local-runtime-with-dreamina-loaded-first"));
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
                if (action === "logout") message.success(t("settings:dreamina-cli-signed-out"));
                if (action === "login" && next.state === "login_pending") {
                    message.info(t("settings:complete-authorization-on-the-official-verification-page-then-refresh-st"));
                }
            } catch (error) {
                if (revision !== lifecycle.current.revision || controller.signal.aborted) return;
                setStatus(undefined);
                message.error(error instanceof DreaminaAgentError ? error.message : t("settings:dreamina-cli-operation-failed"));
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
                        {status?.state === "missing" ? <p className="rounded-md bg-foreground/[0.035] p-3 text-xs leading-6 text-foreground/65">{t("settings:official-dreamina-cli-not-detected-install-it-per-the-official-guide-mak")}</p> : null}
                        {status?.state === "login_pending" ? (
                            <div className="rounded-md border border-border/70 p-3">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-xs text-foreground/60">{t("settings:verification-user-code")}</span>
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
                                {status.expiresAt ? (
                                    <p className="mt-1 text-xs text-foreground/50">
                                        {t("settings:valid-until")} {new Date(status.expiresAt).toLocaleTimeString()}
                                    </p>
                                ) : null}
                            </div>
                        ) : null}
                    </div>

                    <div className="flex flex-wrap gap-2 lg:justify-end">
                        {status?.state === "installed" ? (
                            <Button type="primary" icon={<LogIn className="size-4" />} loading={pending === "login"} disabled={Boolean(pending && pending !== "login")} onClick={() => void runDreamina("login")}>
                                {t("settings:sign-in")}
                            </Button>
                        ) : null}
                        {status?.state === "login_pending" ? (
                            <Button type="primary" icon={<ExternalLink className="size-4" />} onClick={openVerification}>
                                {t("settings:open-verification-page")}
                            </Button>
                        ) : null}
                        {status?.authenticated ? (
                            <Popconfirm
                                title={t("settings:sign-out-of-dreamina-cli")}
                                description={t("settings:only-clears-the-official-cli-sign-in-state-for-this-os-user")}
                                okText={t("settings:sign-out")}
                                cancelText={t("settings:cancel")}
                                onConfirm={() => void runDreamina("logout")}
                            >
                                <Button danger icon={<LogOut className="size-4" />} loading={pending === "logout"}>
                                    {t("settings:sign-out-2")}
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
    if (connection === "connected") return { label: t("settings:connected"), tone: "success", action: "refresh" };
    if (connection === "connecting") return { label: t("settings:detecting"), tone: "processing", action: null };
    if (connection === "origin_not_trusted") return { label: t("settings:reconnect-required"), tone: "error", action: "refresh", actionLabel: LOCAL_CLI_SETTINGS_COPY.runtimeReconnect };
    if (connection === "unreachable") return { label: t("settings:not-found"), tone: "error", action: "refresh" };
    if (connection === "incompatible") return { label: t("settings:incompatible-version"), tone: "error", action: "refresh" };
    if (connection === "runtime_error") return { label: t("settings:runtime-error"), tone: "error", action: "refresh" };
    return { label: t("settings:not-checked-yet"), tone: "default", action: "refresh" };
}

function dreaminaEmptyMessage(connection: LocalRuntimeConnectionState, moduleAvailable: boolean) {
    if (connection !== "connected") return LOCAL_CLI_SETTINGS_COPY.dreaminaDisconnectedMessage;
    if (!moduleAvailable) return t("settings:the-current-runtime-has-no-dreamina-module-loaded-update-and-restart-the");
    return t("settings:detecting-dreamina-cli");
}
