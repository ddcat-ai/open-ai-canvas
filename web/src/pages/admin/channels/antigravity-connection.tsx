import { App, Button, Input, Spin } from "antd";
import { Download, ExternalLink, LogIn, LogOut, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Select } from "@/components/ui/base/select";
import type { ModelChannel } from "@/stores/use-config-store";
import {
    cancelAdminAntigravityLogin,
    getAdminAntigravityStatus,
    installAdminAntigravityRuntime,
    logoutAdminAntigravity,
    saveAdminAntigravitySettings,
    startAdminAntigravityLogin,
    submitAdminAntigravityLoginCode,
    type AntigravityAuthMethod,
    type AntigravityStatus,
} from "@/services/api/antigravity";
import { AdminStatusBadge } from "../components/admin-ui";

const authMethodOptions: Array<{ value: AntigravityAuthMethod; label: string }> = [
    { value: "oauth-personal", label: "Google 账号" },
    { value: "oauth-business", label: "Gemini Enterprise" },
    { value: "gemini-api-key", label: "Gemini API Key" },
    { value: "agent-platform", label: "Agent Platform（Vertex AI）" },
];

const usesGoogleSignIn = (method: AntigravityAuthMethod) => method === "oauth-personal" || method === "oauth-business";
const usesApiKey = (method: AntigravityAuthMethod) => method === "gemini-api-key" || method === "agent-platform";
const usesGcpProject = (method: AntigravityAuthMethod) => method === "oauth-business" || method === "agent-platform";

type SettingsDraft = { authMethod: AntigravityAuthMethod; apiKey: string; gcpProject: string; gcpLocation: string };

/** Key 分组里的 Antigravity 连接：安装官方 agy、选择登录方式、Google 登录与退出。 */
export function AntigravityConnection({ channel, onSignedIn }: { channel: ModelChannel; onSignedIn: () => void }) {
    const { message } = App.useApp();
    const [status, setStatus] = useState<AntigravityStatus | null>(null);
    const [loadError, setLoadError] = useState("");
    const [busy, setBusy] = useState<"" | "install" | "check" | "save" | "login" | "code" | "cancel" | "logout">("");
    const [draft, setDraft] = useState<SettingsDraft | null>(null);
    const [code, setCode] = useState("");
    const checkedOnce = useRef(false);

    const apply = (next: AntigravityStatus) => {
        setStatus(next);
        setDraft({ authMethod: next.authMethod, apiKey: "", gcpProject: next.gcpProject, gcpLocation: next.gcpLocation });
    };

    const run = async (action: Exclude<typeof busy, "">, task: () => Promise<AntigravityStatus>, success?: string) => {
        setBusy(action);
        try {
            const next = await task();
            apply(next);
            if (success) message.success(success);
            return next;
        } catch (error) {
            message.error(error instanceof Error ? error.message : "Antigravity 操作失败");
            return null;
        } finally {
            setBusy("");
        }
    };

    useEffect(() => {
        let active = true;
        checkedOnce.current = false;
        setLoadError("");
        void getAdminAntigravityStatus(channel.id)
            .then(({ antigravity }) => {
                if (!active) return;
                apply(antigravity);
                if (antigravity.runtime.installed && !antigravity.connection && !checkedOnce.current) {
                    checkedOnce.current = true;
                    void run("check", async () => (await getAdminAntigravityStatus(channel.id, true)).antigravity);
                }
            })
            .catch((error) => {
                if (active) setLoadError(error instanceof Error ? error.message : "读取 Antigravity 状态失败");
            });
        return () => {
            active = false;
        };
    }, [channel.id]);

    if (loadError) {
        return (
            <div className="admin-antigravity-panel" role="alert">
                <span className="text-sm text-[var(--admin-status-error)]">{loadError}</span>
            </div>
        );
    }
    if (!status || !draft) {
        return (
            <div className="admin-antigravity-panel" role="status" aria-label="正在读取 Antigravity 状态">
                <Spin size="small" />
            </div>
        );
    }

    const { runtime, connection, login } = status;
    const settingsChanged = draft.authMethod !== status.authMethod || draft.apiKey.trim() !== "" || draft.gcpProject !== status.gcpProject || draft.gcpLocation !== status.gcpLocation;
    const signedIn = Boolean(connection?.signedIn);
    const badge = !runtime.installed
        ? { label: "未安装 CLI", tone: "warning" as const }
        : signedIn
          ? { label: `已连接 · ${connection?.models.length ?? 0} 个模型`, tone: "success" as const }
          : connection
            ? { label: usesGoogleSignIn(status.authMethod) ? "未登录" : "未连接", tone: "warning" as const }
            : { label: "未检查", tone: "neutral" as const };

    const install = async () => {
        setBusy("install");
        try {
            const { runtime: installed } = await installAdminAntigravityRuntime();
            message.success(`Antigravity CLI ${installed.version} 已就绪`);
            const { antigravity } = await getAdminAntigravityStatus(channel.id, true);
            apply(antigravity);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "安装 Antigravity CLI 失败");
        } finally {
            setBusy("");
        }
    };

    const submitCode = async () => {
        const next = await run("code", async () => (await submitAdminAntigravityLoginCode(channel.id, code.trim())).antigravity);
        if (!next) return;
        setCode("");
        if (next.login.phase === "succeeded" && next.connection?.signedIn) {
            message.success("已登录 Google，正在读取模型");
            onSignedIn();
        } else if (next.login.phase === "failed") {
            message.error(next.login.message || "Google 登录失败");
        }
    };

    return (
        <div className="admin-antigravity-panel" aria-label={`${channel.name}的 Antigravity 连接`}>
            <div className="admin-antigravity-row">
                <strong className="text-sm">Antigravity 连接</strong>
                <AdminStatusBadge label={badge.label} tone={badge.tone} title={connection?.error || undefined} />
                <span className="admin-antigravity-meta">
                    {runtime.installed ? `官方 Antigravity CLI ${runtime.version} · ${runtime.target}` : runtime.supported ? `官方 Antigravity CLI 未安装 · ${runtime.target}` : `当前服务器平台 ${runtime.target} 没有官方 Antigravity CLI`}
                </span>
                {runtime.supported && (
                    <Button size="small" icon={<Download className="size-3.5" />} loading={busy === "install"} disabled={Boolean(busy) && busy !== "install"} onClick={() => void install()}>
                        {runtime.installed ? "更新 CLI" : "安装 CLI"}
                    </Button>
                )}
                {runtime.installed && (
                    <Button
                        size="small"
                        icon={<RefreshCw className="size-3.5" />}
                        loading={busy === "check"}
                        disabled={Boolean(busy) && busy !== "check"}
                        onClick={() => void run("check", async () => (await getAdminAntigravityStatus(channel.id, true)).antigravity)}
                    >
                        检查连接
                    </Button>
                )}
            </div>
            {connection?.error && <p className="admin-antigravity-error">{connection.error}</p>}
            <div className="admin-antigravity-row">
                <label className="admin-antigravity-field">
                    <span>登录方式</span>
                    <Select aria-label="Antigravity 登录方式" value={draft.authMethod} options={authMethodOptions} onChange={(authMethod: AntigravityAuthMethod) => setDraft({ ...draft, authMethod })} />
                </label>
                {usesApiKey(draft.authMethod) && (
                    <label className="admin-antigravity-field">
                        <span>{draft.authMethod === "gemini-api-key" ? "Gemini API Key" : "API Key（可选）"}</span>
                        <Input.Password autoComplete="new-password" value={draft.apiKey} placeholder={status.hasApiKey ? "已配置，留空不修改" : "填写 API Key"} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} />
                    </label>
                )}
                {usesGcpProject(draft.authMethod) && (
                    <>
                        <label className="admin-antigravity-field">
                            <span>GCP 项目</span>
                            <Input value={draft.gcpProject} placeholder="my-project" onChange={(event) => setDraft({ ...draft, gcpProject: event.target.value })} />
                        </label>
                        <label className="admin-antigravity-field">
                            <span>GCP 区域</span>
                            <Input value={draft.gcpLocation} placeholder="global" onChange={(event) => setDraft({ ...draft, gcpLocation: event.target.value })} />
                        </label>
                    </>
                )}
                {settingsChanged && (
                    <Button
                        size="small"
                        type="primary"
                        loading={busy === "save"}
                        disabled={Boolean(busy) && busy !== "save"}
                        onClick={() =>
                            void run(
                                "save",
                                async () => (await saveAdminAntigravitySettings(channel.id, { authMethod: draft.authMethod, apiKey: draft.apiKey.trim(), gcpProject: draft.gcpProject.trim(), gcpLocation: draft.gcpLocation.trim() })).antigravity,
                                "登录方式已保存",
                            )
                        }
                    >
                        保存登录方式
                    </Button>
                )}
            </div>
            {runtime.installed && !settingsChanged && usesGoogleSignIn(status.authMethod) && (
                <div className="admin-antigravity-row">
                    {login.phase === "waiting" && login.authorizationUrl ? (
                        <>
                            <Button size="small" type="primary" icon={<ExternalLink className="size-3.5" />} href={login.authorizationUrl} target="_blank" rel="noreferrer">
                                打开 Google 登录
                            </Button>
                            <Input
                                className="admin-antigravity-code"
                                aria-label="Antigravity 授权码"
                                value={code}
                                placeholder="粘贴 Antigravity 页面显示的授权码"
                                onChange={(event) => setCode(event.target.value)}
                                onPressEnter={() => code.trim() && void submitCode()}
                            />
                            <Button size="small" type="primary" loading={busy === "code"} disabled={!code.trim() || (Boolean(busy) && busy !== "code")} onClick={() => void submitCode()}>
                                提交授权码
                            </Button>
                            <Button size="small" loading={busy === "cancel"} disabled={Boolean(busy) && busy !== "cancel"} onClick={() => void run("cancel", async () => (await cancelAdminAntigravityLogin(channel.id)).antigravity)}>
                                取消
                            </Button>
                            <span className="admin-antigravity-meta">{login.message}</span>
                        </>
                    ) : (
                        <>
                            <Button
                                size="small"
                                type={signedIn ? "default" : "primary"}
                                icon={<LogIn className="size-3.5" />}
                                loading={busy === "login"}
                                disabled={Boolean(busy) && busy !== "login"}
                                onClick={() => void run("login", async () => (await startAdminAntigravityLogin(channel.id)).antigravity)}
                            >
                                {signedIn ? "重新登录 Google" : "登录 Google"}
                            </Button>
                            {signedIn && (
                                <Button
                                    size="small"
                                    icon={<LogOut className="size-3.5" />}
                                    loading={busy === "logout"}
                                    disabled={Boolean(busy) && busy !== "logout"}
                                    onClick={() => void run("logout", async () => (await logoutAdminAntigravity(channel.id)).antigravity, "已退出 Google 登录")}
                                >
                                    退出登录
                                </Button>
                            )}
                            {login.phase === "failed" && login.message && <span className="admin-antigravity-error">{login.message}</span>}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
