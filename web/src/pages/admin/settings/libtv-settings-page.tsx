import { App, Button, Input, Skeleton } from "antd";
import { Switch } from "@/pages/admin/ui/controls";
import { AlertTriangle, BadgeCheck, CircleCheck, CloudDownload, Link2, RefreshCw, RotateCcw, Save, Server, ShieldCheck, Trash2, Wifi } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useBlocker } from "react-router";

import { cn } from "@/lib/utils";
import { completeAdminLibTVOAuth, disconnectAdminLibTV, getAdminLibTVSetting, startAdminLibTVOAuth, testAdminLibTV, updateAdminLibTVSetting, type AdminLibTVSetting, type LibTVConnectStartResult } from "@/services/api/libtv";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminStatusBadge, SettingsSectionCard } from "../components/admin-ui";

type ConnectionTestStatus = "idle" | "testing" | "success" | "error";

export default function LibTVSettingsPage() {
    const { message, modal } = App.useApp();
    const brandName = useAppearanceStore((state) => state.appearance.brandName);
    const [setting, setSetting] = useState<AdminLibTVSetting | null>(null);
    const [enabled, setEnabled] = useState(false);
    const [testUuid, setTestUuid] = useState("");
    const [testStatus, setTestStatus] = useState<ConnectionTestStatus>("idle");
    const [testError, setTestError] = useState("");
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [disconnecting, setDisconnecting] = useState(false);
    const [connectFlow, setConnectFlow] = useState<LibTVConnectStartResult | null>(null);
    const [callbackUrl, setCallbackUrl] = useState("");
    const [loadError, setLoadError] = useState("");
    const [saveError, setSaveError] = useState("");
    const requestVersionRef = useRef(0);
    const navigationConfirmOpenRef = useRef(false);
    const navigationTriggerRef = useRef<HTMLElement | null>(null);
    const pollTimerRef = useRef<number>(0);

    const dirty = Boolean(setting && enabled !== setting.enabled);
    const enabledDirty = dirty;
    const connected = Boolean(setting?.connected || setting?.hasToken);
    const connectionLabel = connected ? (setting?.accountName ? `已连接：${setting.accountName}` : "已连接") : "未连接";

    const applySetting = (next: AdminLibTVSetting) => {
        setSetting(next);
        setEnabled(next.enabled);
    };

    const load = useCallback(
        async (initial = false, announce = false) => {
            const requestVersion = ++requestVersionRef.current;
            if (initial) setLoading(true);
            else setRefreshing(true);
            setLoadError("");
            try {
                const result = await getAdminLibTVSetting();
                if (requestVersion !== requestVersionRef.current) return;
                if (!isAdminLibTVSetting(result.setting)) throw new Error("服务端返回的 LibTV 配置格式无效");
                applySetting(result.setting);
                setSaveError("");
                setTestStatus("idle");
                setTestError("");
                if (result.setting.connected) {
                    setConnectFlow(null);
                    setCallbackUrl("");
                }
                if (announce) message.success("已重新读取第三方参数配置");
                return result.setting;
            } catch (error) {
                if (requestVersion !== requestVersionRef.current) return;
                const errorMessage = error instanceof Error ? error.message : "读取第三方参数配置失败";
                setLoadError(errorMessage);
                if (!initial) message.error(errorMessage);
                return null;
            } finally {
                if (requestVersion === requestVersionRef.current) {
                    setLoading(false);
                    setRefreshing(false);
                }
            }
        },
        [message],
    );

    useEffect(() => {
        void load(true);
        return () => {
            requestVersionRef.current += 1;
            window.clearInterval(pollTimerRef.current);
        };
    }, [load]);

    const blocker = useBlocker(dirty && !saving);

    useEffect(() => {
        const beforeUnload = (event: BeforeUnloadEvent) => {
            if (!dirty || saving) return;
            event.preventDefault();
        };
        window.addEventListener("beforeunload", beforeUnload);
        return () => window.removeEventListener("beforeunload", beforeUnload);
    }, [dirty, saving]);

    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            if (event.origin !== window.location.origin) return;
            const data = event.data as { source?: string; status?: string } | null;
            if (!data || data.source !== "yingce-libtv-oauth") return;
            if (data.status === "success") {
                void load(false);
                message.success("已连接 LibTV 账号");
            }
        };
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    }, [load, message]);

    useEffect(() => {
        if (blocker.state !== "blocked" || navigationConfirmOpenRef.current) return;
        navigationConfirmOpenRef.current = true;
        navigationTriggerRef.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
        modal.confirm({
            title: "放弃第三方参数调整？",
            content: "当前页面有尚未保存的 LibTV 导入策略草稿，离开后这些内容会丢失。服务端正在使用的配置不会改变。",
            okText: "放弃并离开",
            cancelText: "继续编辑",
            okButtonProps: { danger: true },
            onOk: () => {
                navigationConfirmOpenRef.current = false;
                navigationTriggerRef.current = null;
                blocker.proceed();
            },
            onCancel: () => {
                navigationConfirmOpenRef.current = false;
                blocker.reset();
                window.requestAnimationFrame(() => {
                    const fallback = document.querySelector<HTMLButtonElement>(".admin-third-party-command-actions button");
                    const target = navigationTriggerRef.current?.isConnected ? navigationTriggerRef.current : fallback;
                    target?.focus();
                    navigationTriggerRef.current = null;
                });
            },
        });
    }, [blocker, modal]);

    const resetDraft = () => {
        if (!setting || saving) return;
        setEnabled(setting.enabled);
        setSaveError("");
        message.info("已撤销第三方参数的未保存调整");
    };

    const requestRefresh = () => {
        if (!dirty) {
            void load(false, true);
            return;
        }
        modal.confirm({
            title: "放弃调整并重新读取？",
            content: "重新读取会丢弃当前导入开关草稿，并以服务端配置为准。",
            okText: "放弃并刷新",
            cancelText: "继续编辑",
            okButtonProps: { danger: true },
            onOk: () => load(false, true),
        });
    };

    const changeEnabled = (nextEnabled: boolean) => {
        if (nextEnabled && !connected) {
            message.warning("请先连接 LibTV 账号，再启用画布导入");
            return;
        }
        if (!setting || saving || nextEnabled === enabled) return;
        setEnabled(nextEnabled);
        setSaveError("");
    };

    const startPoll = () => {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = window.setInterval(() => {
            void (async () => {
                const next = await load(false);
                if (next?.connected) {
                    window.clearInterval(pollTimerRef.current);
                    message.success("已连接 LibTV 账号");
                }
            })();
        }, 2000);
        window.setTimeout(() => window.clearInterval(pollTimerRef.current), 10 * 60 * 1000);
    };

    const startConnect = async () => {
        setConnecting(true);
        setSaveError("");
        try {
            const result = await startAdminLibTVOAuth(window.location.origin);
            if (!result?.authorizeUrl) throw new Error("未能创建 LibTV 授权请求");
            setConnectFlow(result);
            window.open(result.authorizeUrl, "yingce-libtv-oauth", "popup=yes,width=480,height=720");
            if (result.callbackMode === "redirect") startPoll();
            message.info(result.hint || "请在打开的窗口中用微信扫码授权");
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "无法开始连接 LibTV";
            setSaveError(errorMessage);
            message.error(errorMessage);
        } finally {
            setConnecting(false);
        }
    };

    const completeConnect = async () => {
        const raw = callbackUrl.trim();
        if (!raw) {
            message.error("请粘贴授权完成后的完整回调地址");
            return;
        }
        setConnecting(true);
        setSaveError("");
        try {
            const result = await completeAdminLibTVOAuth({ callbackUrl: raw });
            if (!isAdminLibTVSetting(result.setting) || !(result.setting.connected || result.setting.hasToken)) {
                throw new Error("服务端未确认 LibTV 账号已连接，请重新读取后核对");
            }
            applySetting(result.setting);
            setConnectFlow(null);
            setCallbackUrl("");
            setTestStatus("idle");
            setTestError("");
            message.success("已连接 LibTV 账号");
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "完成 LibTV 授权失败";
            setSaveError(errorMessage);
            message.error(errorMessage);
        } finally {
            setConnecting(false);
        }
    };

    const disconnect = () => {
        modal.confirm({
            title: "断开 LibTV 账号？",
            content: "断开后将同时关闭用户导入入口。已导入到画布中的节点和连线不会被删除。",
            okText: "断开连接",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: async () => {
                setDisconnecting(true);
                try {
                    const result = await disconnectAdminLibTV();
                    if (!isAdminLibTVSetting(result.setting) || result.setting.connected) {
                        throw new Error("服务端未确认已断开 LibTV 账号");
                    }
                    applySetting(result.setting);
                    setConnectFlow(null);
                    setCallbackUrl("");
                    setTestStatus("idle");
                    setTestError("");
                    message.success("已断开 LibTV 账号");
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : "断开 LibTV 账号失败";
                    message.error(errorMessage);
                    throw error;
                } finally {
                    setDisconnecting(false);
                }
            },
        });
    };

    async function save() {
        if (!setting) return;
        const nextEnabled = enabled;
        if (nextEnabled && !connected) {
            message.error("启用 LibTV 画布导入前必须先连接账号");
            return;
        }
        setSaving(true);
        setSaveError("");
        try {
            const result = await updateAdminLibTVSetting({ enabled: nextEnabled });
            if (!isAdminLibTVSetting(result.setting) || result.setting.enabled !== nextEnabled) {
                throw new Error("服务端返回的 LibTV 配置与本次保存内容不一致，请重新读取后核对");
            }
            applySetting(result.setting);
            setTestStatus("idle");
            setTestError("");
            message.success("第三方参数配置已保存");
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "保存第三方参数配置失败";
            setSaveError(`${errorMessage}。未自动重试，请重新读取当前配置后再决定是否保存。`);
            message.error(errorMessage);
            throw error;
        } finally {
            setSaving(false);
        }
    }

    const submitSave = async () => {
        if (!setting || !dirty) return;
        if (enabled && !connected) {
            message.error("启用 LibTV 画布导入前必须先连接账号");
            return;
        }
        try {
            await save();
        } catch {
            // 保存错误已在 save 中就地提示。
        }
    };

    const test = async () => {
        const uuid = testUuid.trim();
        if (!connected) {
            message.error("请先连接 LibTV 账号，再验证连接");
            return;
        }
        if (!uuid) {
            message.error("请填写用于验证的 LibTV 画布 UUID");
            return;
        }
        setTestStatus("testing");
        setTestError("");
        try {
            await testAdminLibTV(uuid);
            setTestStatus("success");
            message.success("已连接的 LibTV 账号可以读取该画布");
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "LibTV 连接验证失败";
            setTestStatus("error");
            setTestError(errorMessage);
            message.error(errorMessage);
        }
    };

    if (loading && !setting) {
        return (
            <AdminPageFrame title="第三方参数配置" description="先连接平台账号，再决定是否开放用户导入" scroll>
                <div className="admin-settings-stack admin-third-party-settings" aria-label="正在读取第三方参数配置" role="status">
                    <div className="admin-third-party-command-bar">
                        <Skeleton active title={{ width: 190 }} paragraph={false} />
                    </div>
                    <div className="admin-third-party-loading-card">
                        <Skeleton active paragraph={{ rows: 8 }} />
                    </div>
                </div>
            </AdminPageFrame>
        );
    }

    if (!setting) {
        return (
            <AdminPageFrame title="第三方参数配置" description="先连接平台账号，再决定是否开放用户导入" scroll>
                <div className="admin-settings-stack admin-third-party-settings">
                    <div className="admin-third-party-load-error" role="alert">
                        <span className="admin-third-party-load-error-icon">
                            <AlertTriangle className="size-5" aria-hidden="true" />
                        </span>
                        <div>
                            <h2>无法读取第三方参数配置</h2>
                            <p>{loadError || "当前没有可显示的配置，请稍后重试。"}</p>
                        </div>
                        <Button icon={<RefreshCw className="size-4" />} loading={refreshing} onClick={() => void load(false, true)}>
                            重新读取
                        </Button>
                    </div>
                </div>
            </AdminPageFrame>
        );
    }

    return (
        <AdminPageFrame title="第三方参数配置" description="先连接平台账号，再决定是否开放用户导入" scroll>
            <div className="admin-settings-stack admin-third-party-settings">
                <div className={cn("admin-third-party-command-bar", dirty && "is-dirty")}>
                    <div className="admin-third-party-command-copy" aria-live="polite">
                        <div>
                            <div className="flex flex-wrap items-center gap-2">
                                <strong>{dirty ? "第三方参数有调整待保存" : "第三方参数已与服务端同步"}</strong>
                                <AdminStatusBadge label={dirty ? "尚未生效" : "服务端当前值"} tone={dirty ? "warning" : "neutral"} />
                            </div>
                            <p>{dirty ? "导入开关只在本页暂存；保存前可撤销或重新读取。" : "当前仅接入 LibTV；授权令牌只保存在服务端，不会从接口回传。"}</p>
                        </div>
                    </div>
                    <div className="admin-third-party-command-actions">
                        {dirty ? (
                            <Button icon={<RotateCcw className="size-4" />} disabled={saving} onClick={resetDraft}>
                                撤销调整
                            </Button>
                        ) : null}
                        <Button icon={<RefreshCw className="size-4" />} loading={refreshing} disabled={saving} onClick={requestRefresh}>
                            刷新状态
                        </Button>
                    </div>
                </div>

                {loadError || saveError || setting.warning ? (
                    <div className="admin-third-party-inline-alert" role="alert">
                        <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                        <span>{saveError || setting.warning || `${loadError}。页面仍显示上一次成功读取的配置。`}</span>
                    </div>
                ) : null}

                <div id="admin-third-party-libtv" className="admin-settings-anchor">
                    <SettingsSectionCard
                        className="admin-third-party-section admin-third-party-credential-section"
                        icon={<Link2 className="size-4" aria-hidden="true" />}
                        title="1. 连接 LibTV 账号"
                        description={`使用官方微信扫码授权，让${brandName}服务端读取可复制的 LibTV 画布。授权令牌不会回传到浏览器。`}
                        status={<AdminStatusBadge label={connectionLabel} tone={connected ? "success" : "neutral"} />}
                    >
                        <div className="admin-third-party-provider">
                            <div className="admin-third-party-provider-heading">
                                <span className="admin-third-party-provider-mark">L</span>
                                <div>
                                    <strong>LibTV</strong>
                                    <p>画布项目读取接入</p>
                                </div>
                            </div>
                            <div className="admin-third-party-provider-tags">
                                <AdminStatusBadge label="服务端代理" tone="info" />
                                <AdminStatusBadge label="只读外部画布" tone="neutral" />
                                <AdminStatusBadge label={connected ? "账号已连接" : "尚未连接"} tone={connected ? "success" : "warning"} />
                            </div>
                        </div>
                        <div className="admin-third-party-credential-panel">
                            <div className="admin-third-party-credential-state">
                                <span className={cn("admin-third-party-credential-indicator", connected && "is-ready")}>
                                    {connected ? <CircleCheck className="size-4" aria-hidden="true" /> : <AlertTriangle className="size-4" aria-hidden="true" />}
                                    {connectionLabel}
                                </span>
                                <p>{connected ? "已使用站点级管理员授权。用户导入画布时会复用这个连接，无需各自粘贴密钥。" : "官方已不再提供可粘贴的接口密钥。请连接一个管理员 LibTV 账号，用于按 UUID 导入可复制画布。"}</p>
                            </div>
                            <div className="admin-third-party-credential-actions">
                                <Button type={connected ? "default" : "primary"} icon={<Link2 className="size-4" />} loading={connecting} disabled={saving || refreshing || disconnecting} onClick={() => void startConnect()}>
                                    {connected ? "重新连接" : "连接 LibTV 账号"}
                                </Button>
                                {connected ? (
                                    <Button danger icon={<Trash2 className="size-4" />} loading={disconnecting} disabled={saving || refreshing || connecting} onClick={disconnect}>
                                        断开连接
                                    </Button>
                                ) : null}
                            </div>
                            {connectFlow ? (
                                <div className="mt-4 space-y-3">
                                    <p className="text-sm text-foreground/70">{connectFlow.hint}</p>
                                    {connectFlow.callbackMode === "paste" ? (
                                        <div className="admin-third-party-test-input">
                                            <label htmlFor="admin-libtv-callback-url">授权完成后的回调地址</label>
                                            <Input.TextArea
                                                id="admin-libtv-callback-url"
                                                value={callbackUrl}
                                                onChange={(event) => setCallbackUrl(event.target.value)}
                                                placeholder="粘贴以 http://127.0.0.1:8765/callback?code= 开头的完整地址"
                                                disabled={connecting}
                                                autoSize={{ minRows: 2, maxRows: 4 }}
                                            />
                                            <div className="mt-2">
                                                <Button type="primary" loading={connecting} onClick={() => void completeConnect()}>
                                                    完成授权
                                                </Button>
                                            </div>
                                        </div>
                                    ) : (
                                        <p className="text-sm text-foreground/55">扫码完成后会自动返回本页。如果没有自动更新，请点击“刷新状态”。</p>
                                    )}
                                </div>
                            ) : null}
                        </div>
                    </SettingsSectionCard>
                </div>

                {connected ? (
                    <div id="admin-third-party-access" className="admin-settings-anchor">
                        <SettingsSectionCard
                            className="admin-third-party-section admin-third-party-access-section"
                            icon={<CloudDownload className="size-4" aria-hidden="true" />}
                            title="2. 是否开放用户导入 LibTV 画布"
                            description="控制创作台是否允许普通用户通过 UUID 发起新的 LibTV 画布导入。"
                            status={<AdminStatusBadge label={enabledDirty ? (enabled ? "待开放" : "待关闭") : enabled ? "入口开放" : "入口关闭"} tone={enabledDirty ? "warning" : enabled ? "success" : "neutral"} />}
                            footer={<ThirdPartySaveFooter setting={setting} dirty={dirty} saving={saving} refreshing={refreshing} onReset={resetDraft} onSave={submitSave} />}
                        >
                            <div className="admin-third-party-policy-control">
                                <div>
                                    <strong>{enabled ? "允许发起新的 LibTV 导入" : "不开放新的 LibTV 导入"}</strong>
                                    <p>{enabled ? "保存后，服务端会使用已连接的 LibTV 账号读取用户指定的画布。" : "已有导入节点与连线继续保留，不会被删除或转换。"}</p>
                                </div>
                                <div className="admin-third-party-policy-switch">
                                    <span>{enabled ? "开启" : "关闭"}</span>
                                    <Switch aria-label="允许用户导入 LibTV 画布" checked={enabled} disabled={saving || refreshing} onChange={changeEnabled} />
                                </div>
                            </div>
                            <div className="admin-third-party-flow" aria-label="LibTV 画布导入链路">
                                <FlowStep icon={<Link2 className="size-4" />} label="站点级授权" detail="令牌不回传" />
                                <span aria-hidden="true">→</span>
                                <FlowStep icon={<Wifi className="size-4" />} label="读取画布" detail="按 UUID 请求" />
                                <span aria-hidden="true">→</span>
                                <FlowStep icon={<CloudDownload className="size-4" />} label={`导入${brandName}`} detail="生成节点与连线" />
                            </div>
                        </SettingsSectionCard>
                    </div>
                ) : null}

                {connected ? (
                    <div id="admin-third-party-test" className="admin-settings-anchor">
                        <SettingsSectionCard
                            className="admin-third-party-section admin-third-party-test-card"
                            icon={<Wifi className="size-4" aria-hidden="true" />}
                            title="3. 验证已连接的 LibTV 账号"
                            description={`使用服务端当前保存的授权发起一次只读请求，不会向 LibTV 或当前${brandName}画布写入内容。`}
                            status={<TestStatus status={testStatus} />}
                        >
                            <div className="admin-third-party-test-controls">
                                <div className="admin-third-party-test-input">
                                    <label htmlFor="admin-libtv-test-uuid">可访问的 LibTV 画布 UUID</label>
                                    <Input
                                        id="admin-libtv-test-uuid"
                                        value={testUuid}
                                        onChange={(event) => {
                                            setTestUuid(event.target.value);
                                            setTestStatus("idle");
                                            setTestError("");
                                        }}
                                        placeholder="输入画布 UUID，仅用于本次只读验证"
                                        disabled={testStatus === "testing"}
                                    />
                                </div>
                                <Button icon={<Wifi className="size-4" />} loading={testStatus === "testing"} disabled={!connected || saving || refreshing} onClick={() => void test()}>
                                    验证连接
                                </Button>
                            </div>
                            <div className={cn("admin-third-party-test-note", testStatus === "error" && "is-error", testStatus === "success" && "is-success")} role={testStatus === "error" ? "alert" : "status"}>
                                {testStatus === "success" ? <BadgeCheck className="size-4" aria-hidden="true" /> : testStatus === "error" ? <AlertTriangle className="size-4" aria-hidden="true" /> : <Server className="size-4" aria-hidden="true" />}
                                <span>{testStatus === "success" ? "验证成功：已连接的 LibTV 账号可以读取该画布。" : testStatus === "error" ? `验证失败：${testError}` : "验证会产生一次真实的外部只读请求，但不会保存画布内容。"}</span>
                            </div>
                        </SettingsSectionCard>
                    </div>
                ) : null}
            </div>
        </AdminPageFrame>
    );
}

function ThirdPartySaveFooter({ setting, dirty, saving, refreshing, onReset, onSave }: { setting: AdminLibTVSetting; dirty: boolean; saving: boolean; refreshing: boolean; onReset: () => void; onSave: () => Promise<void> }) {
    return (
        <div className="admin-third-party-footer">
            <div className="admin-third-party-footer-note">
                <ShieldCheck className="size-4" aria-hidden="true" />
                <span>{formatSettingTime(setting.updatedAt, "尚未保存 LibTV 配置")} · 保存不会读取外部画布</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                {dirty ? (
                    <Button icon={<RotateCcw className="size-4" />} disabled={saving} onClick={onReset}>
                        撤销
                    </Button>
                ) : null}
                <Button type="primary" icon={<Save className="size-4" />} loading={saving} disabled={!dirty || refreshing} onClick={() => void onSave()}>
                    保存修改
                </Button>
            </div>
        </div>
    );
}

function FlowStep({ icon, label, detail }: { icon: ReactNode; label: string; detail: string }) {
    return (
        <div className="admin-third-party-flow-step">
            <span>{icon}</span>
            <div>
                <strong>{label}</strong>
                <small>{detail}</small>
            </div>
        </div>
    );
}

function TestStatus({ status }: { status: ConnectionTestStatus }) {
    if (status === "testing") return <AdminStatusBadge label="验证中" tone="info" />;
    if (status === "success") return <AdminStatusBadge label="本次验证成功" tone="success" />;
    if (status === "error") return <AdminStatusBadge label="本次验证失败" tone="error" />;
    return <AdminStatusBadge label="本会话尚未验证" tone="neutral" />;
}

function isAdminLibTVSetting(value: unknown): value is AdminLibTVSetting {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<AdminLibTVSetting>;
    return typeof candidate.enabled === "boolean" && (typeof candidate.connected === "boolean" || typeof candidate.hasToken === "boolean") && (candidate.updatedAt === undefined || typeof candidate.updatedAt === "string");
}

function hasValidSettingTime(value?: string) {
    if (!value) return false;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) && timestamp > 0;
}

function formatSettingTime(value: string | undefined, fallback: string) {
    if (!hasValidSettingTime(value)) return fallback;
    return `更新于 ${new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value as string))}`;
}
