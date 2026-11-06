import { App, Button, Form, Input, Skeleton } from "antd";
import { Switch } from "@/pages/admin/ui/controls";
import { AlertTriangle, AppWindow, BadgeCheck, Check, ChevronDown, FileText, Globe2, KeyRound, LockKeyhole, Mail, MailCheck, PanelsTopLeft, RefreshCw, RotateCcw, Save, ShieldCheck, UserPlus, UsersRound } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useBlocker } from "react-router";

import { cn } from "@/lib/utils";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { getAdminLinuxDOSetting, getAdminRegistrationSetting, updateAdminLinuxDOSetting, updateAdminRegistrationSetting, type LinuxDOSetting, type RegistrationSetting } from "@/services/api/wallet";
import type { AuthLoginMode } from "@/services/api/auth";
import { useAuthSettingsStore } from "@/stores/use-auth-settings-store";
import { AdminStatusBadge, configuredSecretText, SettingsSectionCard } from "./admin-ui";
import { Select } from "@/components/ui/base/select";

const LOGIN_MODES: Array<{ mode: AuthLoginMode; label: string; description: string; short: string }> = [
    { mode: "modal", label: "弹窗登录（默认）", description: "在当前页面弹出登录框，登录后留在原页面继续操作；直达 /login 的链接也会改为弹窗。", short: "左侧品牌介绍 + 右侧登录表单" },
    { mode: "page", label: "独立页面", description: "跳转到 /login 独立页面完成登录与注册，左侧展示外观设置中的登录页影片。", short: "整页品牌影片 + 登录卡片" },
];

const DEFAULT_AGREEMENT_TEMPLATE = `一、服务说明与接受
欢迎使用本平台提供的 AI 影视与内容创作服务。在注册或使用本平台各项功能前，请务必仔细阅读并理解本协议。当您勾选同意或点击注册、登录按钮，即表示您已自愿接受本协议所有条款的约束。

二、账号注册与安全
1. 用户在注册时应提供真实、准确、合法的个人信息，并自行妥善保管账号密码及相关凭据。
2. 任何通过该账号进行的行为均视为用户本人的行为，因保管不当造成的损失由用户自行承担。

三、内容合规与用户承诺
1. 用户使用本平台生成、上传或发布的文本、图片、视频、音频等所有内容，必须遵守国家相关法律法规及公序良俗。
2. 严禁利用本平台从事任何违反国家法律、侵害他人合法权益（包括但不限于肖像权、名誉权、知识产权、个人隐私等）或危害网络安全的活动。

四、知识产权与免责声明
1. 用户利用本平台创作产生的合法作品归用户所有或依法享有相应权利。
2. AI 模型生成的内容受算法模型与提示词影响，平台对其完整性、准确性不作绝对保证，用户应自行审慎评估和使用。

五、服务变更与终止
平台有权根据业务发展、技术升级或合规要求适时调整服务内容及本协议条款。修改后的条款一经发布即发生效力。`;

type LinuxDOFormValues = Omit<LinuxDOSetting, "hasClientSecret" | "updatedAt">;

export default function AccessSettingsPanel() {
    const { message, modal } = App.useApp();
    const brandName = useAppearanceStore((state) => state.appearance.brandName) || "平台";
    const [linuxdo, setLinuxdo] = useState<LinuxDOSetting | null>(null);
    const [registration, setRegistration] = useState<RegistrationSetting | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [savingLinuxDO, setSavingLinuxDO] = useState(false);
    const [savingRegistration, setSavingRegistration] = useState(false);
    const [savingAgreement, setSavingAgreement] = useState(false);
    const [savingLoginMode, setSavingLoginMode] = useState(false);
    const [savingEmailPolicy, setSavingEmailPolicy] = useState<"" | "emailRequired" | "emailVerificationRequired">("");
    const [dirty, setDirty] = useState(false);
    const [draftLinuxDOEnabled, setDraftLinuxDOEnabled] = useState(false);
    const [agreementTitle, setAgreementTitle] = useState("");
    const [agreementContent, setAgreementContent] = useState("");
    const [agreementDirty, setAgreementDirty] = useState(false);
    const [loadError, setLoadError] = useState("");
    const [saveError, setSaveError] = useState("");
    const [form] = Form.useForm<LinuxDOFormValues>();
    const requestVersionRef = useRef(0);
    const navigationConfirmOpenRef = useRef(false);
    const navigationTriggerRef = useRef<HTMLElement | null>(null);

    const load = useCallback(
        async (initial = false, announce = false) => {
            const requestVersion = ++requestVersionRef.current;
            if (initial) setLoading(true);
            else setRefreshing(true);
            setLoadError("");
            try {
                const [linuxdoData, registrationData] = await Promise.all([getAdminLinuxDOSetting(), getAdminRegistrationSetting()]);
                if (requestVersion !== requestVersionRef.current) return;
                setLinuxdo(linuxdoData.setting);
                setRegistration(registrationData.setting);
                setAgreementTitle(registrationData.setting.agreementTitle || "");
                setAgreementContent(registrationData.setting.agreementContent || "");
                setAgreementDirty(false);
                setDirty(false);
                setSaveError("");
                if (announce) message.success("已重新读取当前登录与注册配置");
            } catch (error) {
                if (requestVersion !== requestVersionRef.current) return;
                const errorMessage = error instanceof Error ? error.message : "读取登录与注册配置失败";
                setLoadError(errorMessage);
                if (!initial) message.error(errorMessage);
            } finally {
                if (requestVersion === requestVersionRef.current) {
                    setLoading(false);
                    setRefreshing(false);
                }
            }
        },
        [form, message],
    );

    useEffect(() => {
        void load(true);
        return () => {
            requestVersionRef.current += 1;
        };
    }, [load]);

    useEffect(() => {
        if (loading || !linuxdo || !registration) return;
        form.setFieldsValue(toLinuxDOFormValues(linuxdo));
        setDraftLinuxDOEnabled(linuxdo.enabled);
    }, [form, linuxdo, loading, registration]);

    const unsaved = (dirty && !savingLinuxDO) || (agreementDirty && !savingAgreement);
    const blocker = useBlocker(unsaved);

    // 条款编辑区下方的字数与段落提示：与注册页的分段规则保持一致（按空行分段），
    // 让管理员在保存前就能看到条款会被拆成几段。
    const agreementParagraphsCount = agreementContent.trim() ? agreementContent.trim().split(/\n\s*\n/).length : 0;

    useEffect(() => {
        const beforeUnload = (event: BeforeUnloadEvent) => {
            if (!unsaved) return;
            event.preventDefault();
        };
        window.addEventListener("beforeunload", beforeUnload);
        return () => window.removeEventListener("beforeunload", beforeUnload);
    }, [unsaved]);

    useEffect(() => {
        if (blocker.state !== "blocked" || navigationConfirmOpenRef.current) return;
        navigationConfirmOpenRef.current = true;
        navigationTriggerRef.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
        modal.confirm({
            title: "放弃未保存的登录与注册调整？",
            content: "当前有尚未保存的表单调整，离开后这些内容会丢失。用户注册状态不受影响。",
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
                    const fallback = document.querySelector<HTMLButtonElement>(".admin-access-command-actions button");
                    const target = navigationTriggerRef.current?.isConnected ? navigationTriggerRef.current : fallback;
                    target?.focus();
                    navigationTriggerRef.current = null;
                });
            },
        });
    }, [blocker, modal]);

    const resetLinuxDODraft = () => {
        if (!linuxdo || savingLinuxDO) return;
        form.setFieldsValue(toLinuxDOFormValues(linuxdo));
        form.setFields([]);
        setDraftLinuxDOEnabled(linuxdo.enabled);
        setDirty(false);
        setSaveError("");
        message.info("已撤销 Linux.do 登录的未保存调整");
    };

    const saveAgreement = async () => {
        if (!registration || savingAgreement) return;
        setSavingAgreement(true);
        setSaveError("");
        try {
            const data = await updateAdminRegistrationSetting({
                enabled: registration.enabled,
                agreementTitle: agreementTitle.trim(),
                agreementContent: agreementContent.trim(),
            });
            setRegistration(data.setting);
            setAgreementTitle(data.setting.agreementTitle || "");
            setAgreementContent(data.setting.agreementContent || "");
            setAgreementDirty(false);
            message.success("服务协议已保存，注册页将立即生效");
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "保存服务协议失败";
            setSaveError(`${errorMessage}。未自动重试，请重新读取当前配置后再决定是否保存。`);
            message.error(errorMessage);
        } finally {
            setSavingAgreement(false);
        }
    };

    const resetAgreementDraft = () => {
        if (!registration || savingAgreement) return;
        setAgreementTitle(registration.agreementTitle || "");
        setAgreementContent(registration.agreementContent || "");
        setAgreementDirty(false);
        message.info("已撤销服务协议的未保存调整");
    };

    const requestRefresh = () => {
        if (!dirty && !agreementDirty) {
            void load(false, true);
            return;
        }
        modal.confirm({
            title: "放弃调整并重新读取？",
            content: "重新读取会丢弃当前表单中的未保存内容（含服务协议），并以服务端配置为准。",
            okText: "放弃并刷新",
            cancelText: "继续编辑",
            okButtonProps: { danger: true },
            onOk: () => load(false, true),
        });
    };

    const toggleRegistration = async (enabled: boolean) => {
        setSavingRegistration(true);
        try {
            const data = await updateAdminRegistrationSetting(enabled);
            setRegistration(data.setting);
            message.success(enabled ? "用户注册已开启" : "用户注册已关闭");
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "更新注册设置失败";
            message.error(errorMessage);
            throw error;
        } finally {
            setSavingRegistration(false);
        }
    };

    const requestRegistrationChange = (enabled: boolean) => {
        if (!registration || enabled === registration.enabled || savingRegistration) return;
        void toggleRegistration(enabled).catch(() => undefined);
    };

    // 邮箱要求与注册开关同属 registration 配置：只提交本次切换的字段，其余由服务端保留。
    const changeEmailPolicy = async (field: "emailRequired" | "emailVerificationRequired", value: boolean) => {
        if (!registration || savingEmailPolicy) return;
        setSavingEmailPolicy(field);
        try {
            const data = await updateAdminRegistrationSetting({ enabled: registration.enabled, [field]: value });
            setRegistration(data.setting);
            void useAuthSettingsStore.getState().load({ maxAgeMs: 0 });
            message.success(field === "emailRequired" ? (value ? "注册时必须填写邮箱" : "注册时邮箱改为选填") : value ? "注册需先通过验证码" : "注册不再要求验证码");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "更新邮箱要求失败");
        } finally {
            setSavingEmailPolicy("");
        }
    };

    // 打开方式与注册开关同属 registration 配置：只提交 enabled 与 loginMode，协议正文由服务端保留。
    const changeLoginMode = async (loginMode: AuthLoginMode) => {
        if (!registration || savingLoginMode || loginMode === (registration.loginMode ?? "modal")) return;
        setSavingLoginMode(true);
        try {
            const data = await updateAdminRegistrationSetting({ enabled: registration.enabled, loginMode });
            if ((data.setting.loginMode ?? "modal") !== loginMode) throw new Error("服务端返回的登录打开方式与本次保存不一致，请刷新后核对");
            setRegistration(data.setting);
            // 当前标签页的登录入口立即使用新方式；其他已打开的页面在下次读取配置时生效。
            void useAuthSettingsStore.getState().load({ maxAgeMs: 0 });
            message.success(loginMode === "modal" ? "已切换为弹窗登录" : "已切换为独立页面登录");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "更新登录打开方式失败");
        } finally {
            setSavingLoginMode(false);
        }
    };

    const saveLinuxDO = async (values: LinuxDOFormValues) => {
        const expected = normalizeLinuxDOFormValues(values);
        setSavingLinuxDO(true);
        setSaveError("");
        try {
            const result = await updateAdminLinuxDOSetting(expected);
            if (!linuxDOResponseMatches(result.setting, expected)) throw new Error("服务端返回的 Linux.do 配置与本次保存内容不一致，请重新读取后核对");
            setLinuxdo(result.setting);
            setDirty(false);
            message.success("Linux.do 登录配置已保存");
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "保存 Linux.do 配置失败";
            setSaveError(`${errorMessage}。未自动重试，请重新读取当前配置后再决定是否保存。`);
            message.error(errorMessage);
            throw error;
        } finally {
            setSavingLinuxDO(false);
        }
    };

    const submitLinuxDOSave = async () => {
        let values: LinuxDOFormValues;
        try {
            values = await form.validateFields();
        } catch {
            return;
        }
        const validationError = validateLinuxDODraft(values, linuxdo);
        if (validationError) {
            message.error(validationError);
            return;
        }
        try {
            await saveLinuxDO(values);
        } catch {
            // 保存错误已在 saveLinuxDO 中就地提示。
        }
    };

    const toggleLinuxDO = (enabled: boolean) => {
        if (!linuxdo || savingLinuxDO) return;
        form.setFieldValue("enabled", enabled);
        setDraftLinuxDOEnabled(enabled);
        setDirty(hasLinuxDOChanges({ ...form.getFieldsValue(true), enabled }, linuxdo));
        setSaveError("");
    };

    if (loading && (!linuxdo || !registration)) {
        return (
            <div className="admin-settings-stack admin-access-settings" aria-label="正在读取登录与注册配置" role="status">
                <div className="admin-access-loading-card">
                    <Skeleton active paragraph={{ rows: 6 }} />
                </div>
            </div>
        );
    }

    if (!linuxdo || !registration) {
        return (
            <div className="admin-settings-stack admin-access-settings">
                <div className="admin-access-load-error" role="alert">
                    <span className="admin-access-load-error-icon">
                        <AlertTriangle className="size-5" aria-hidden="true" />
                    </span>
                    <div>
                        <h2>无法读取登录与注册配置</h2>
                        <p>{loadError || "当前没有可显示的配置，请稍后重试。"}</p>
                    </div>
                    <Button icon={<RefreshCw className="size-4" />} loading={refreshing} onClick={() => void load(false, true)}>
                        重新读取
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="admin-settings-stack admin-access-settings">
            <div className={cn("admin-access-command-bar", dirty && "is-dirty")}>
                <div className="admin-access-command-copy" aria-live="polite">
                    <span className="admin-access-command-icon">
                        <ShieldCheck className="size-4" aria-hidden="true" />
                    </span>
                    <div>
                        <strong>{dirty ? "Linux.do 有未保存的调整" : "登录与注册设置"}</strong>
                        <p>
                            {dirty
                                ? "完成接入信息后保存生效。"
                                : `新用户注册${registration.enabled ? "已开放" : "已关闭"} · Linux.do ${linuxdo.enabled ? "已启用" : "未启用"} · ${(registration.loginMode ?? "modal") === "page" ? "独立页面登录" : "弹窗登录"}`}
                        </p>
                    </div>
                </div>
                <div className="admin-access-command-actions">
                    {dirty ? (
                        <Button icon={<RotateCcw className="size-4" />} disabled={savingLinuxDO} onClick={resetLinuxDODraft}>
                            撤销调整
                        </Button>
                    ) : null}
                    <Button icon={<RefreshCw className="size-4" />} loading={refreshing} disabled={savingLinuxDO || savingRegistration || savingLoginMode} onClick={requestRefresh}>
                        刷新状态
                    </Button>
                </div>
            </div>

            {loadError || saveError ? (
                <div className="admin-access-inline-alert" role="alert">
                    <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                    <span>{saveError || `${loadError}。页面仍显示上一次成功读取的配置。`}</span>
                </div>
            ) : null}

            <div id="admin-access-registration" className="admin-settings-anchor">
                <SettingsSectionCard
                    className="admin-access-section admin-access-registration-section"
                    icon={<UserPlus className="size-4" aria-hidden="true" />}
                    title="1. 是否允许创建新账号"
                    description="先决定是否开放注册。关闭后已有账号仍可登录，已有数据不会删除。"
                    status={<AdminStatusBadge label={registration.enabled ? "已开放" : "已关闭"} tone={registration.enabled ? "success" : "neutral"} />}
                >
                    <div className="admin-access-registration-policy">
                        <span className="admin-access-policy-icon">
                            <UsersRound className="size-5" aria-hidden="true" />
                        </span>
                        <div className="admin-access-policy-copy">
                            <div className="flex flex-wrap items-center gap-2">
                                <strong>允许创建新账号</strong>
                                <AdminStatusBadge label="切换即保存" tone="info" />
                            </div>
                            <p>关闭后，本地注册和未绑定账号的 Linux.do 首次登录都会被拒绝；已有账号及已绑定身份仍可继续登录。</p>
                            <span>{formatSettingTime(registration.updatedAt, "当前来自部署环境默认值")}</span>
                        </div>
                        <Switch checked={registration.enabled} loading={savingRegistration} disabled={loading || refreshing || savingLinuxDO} onChange={requestRegistrationChange} aria-label="允许创建新账号，切换后立即生效" />
                    </div>
                    <div className="admin-access-registration-policy">
                        <span className="admin-access-policy-icon">
                            <Mail className="size-5" aria-hidden="true" />
                        </span>
                        <div className="admin-access-policy-copy">
                            <div className="flex flex-wrap items-center gap-2">
                                <strong>注册必须填写邮箱</strong>
                                <AdminStatusBadge label="切换即保存" tone="info" />
                            </div>
                            <p>关闭时邮箱选填，用户可只用用户名注册，之后在账号设置中绑定邮箱。用邮箱作账号登录时始终会保存邮箱。</p>
                        </div>
                        <Switch
                            checked={Boolean(registration.emailRequired)}
                            loading={savingEmailPolicy === "emailRequired"}
                            disabled={loading || refreshing || Boolean(savingEmailPolicy)}
                            onChange={(value) => void changeEmailPolicy("emailRequired", value)}
                            aria-label="注册必须填写邮箱，切换后立即生效"
                        />
                    </div>
                    <div className="admin-access-registration-policy">
                        <span className="admin-access-policy-icon">
                            <MailCheck className="size-5" aria-hidden="true" />
                        </span>
                        <div className="admin-access-policy-copy">
                            <div className="flex flex-wrap items-center gap-2">
                                <strong>注册必须通过验证码</strong>
                                <AdminStatusBadge label="切换即保存" tone="info" />
                            </div>
                            <p>开启时按登录注册策略验证邮箱或手机号（需先配置邮件服务）。关闭后填写的邮箱标记为“未验证”，不能用于邮箱验证码登录，用户可在账号设置中验证。注意：未验证邮箱同样会占用该地址，真实邮箱主人无法再用它注册。</p>
                        </div>
                        <Switch
                            checked={registration.emailVerificationRequired !== false}
                            loading={savingEmailPolicy === "emailVerificationRequired"}
                            disabled={loading || refreshing || Boolean(savingEmailPolicy)}
                            onChange={(value) => void changeEmailPolicy("emailVerificationRequired", value)}
                            aria-label="注册必须通过验证码，切换后立即生效"
                        />
                    </div>
                </SettingsSectionCard>
            </div>

            <div id="admin-access-linuxdo" className="admin-settings-anchor">
                <SettingsSectionCard
                    className="admin-access-section admin-access-linuxdo-section"
                    icon={<KeyRound className="size-4" aria-hidden="true" />}
                    title="2. 是否开放 Linux.do 登录"
                    description="先决定是否在登录与注册页展示 Linux.do。开启后再填写 OAuth 接入信息。"
                    status={<AdminStatusBadge label={draftLinuxDOEnabled ? (dirty ? "待启用" : "运行中") : dirty && linuxdo.enabled ? "待停用" : "未启用"} tone={dirty ? "warning" : draftLinuxDOEnabled ? "success" : "neutral"} />}
                    footer={
                        <>
                            <div className="admin-access-footer-note">
                                <BadgeCheck className="size-4" aria-hidden="true" />
                                <span>{draftLinuxDOEnabled ? "完整填写 OAuth 接入信息后保存" : "关闭后隐藏入口，已有账号绑定不受影响"}</span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                {dirty ? (
                                    <Button icon={<RotateCcw className="size-4" />} disabled={savingLinuxDO} onClick={resetLinuxDODraft}>
                                        撤销
                                    </Button>
                                ) : null}
                                <Button type="primary" icon={<Save className="size-4" />} loading={savingLinuxDO} disabled={!dirty || loading || refreshing} onClick={() => void submitLinuxDOSave()}>
                                    {draftLinuxDOEnabled ? "保存并启用" : "保存并关闭"}
                                </Button>
                            </div>
                        </>
                    }
                >
                    <Form
                        form={form}
                        layout="vertical"
                        requiredMark={false}
                        disabled={loading || refreshing || savingLinuxDO}
                        onValuesChange={() => {
                            const values = form.getFieldsValue(true);
                            setDraftLinuxDOEnabled(Boolean(values.enabled));
                            setDirty(hasLinuxDOChanges(values, linuxdo));
                            setSaveError("");
                        }}
                    >
                        <div className="admin-access-provider-toggle">
                            <span className="admin-access-policy-icon">
                                <ShieldCheck className="size-5" aria-hidden="true" />
                            </span>
                            <div className="admin-access-policy-copy">
                                <div className="flex flex-wrap items-center gap-2">
                                    <strong>在登录与注册页显示 Linux.do</strong>
                                    <AdminStatusBadge label="保存后生效" tone="info" />
                                </div>
                                <p>开启后显示第三方登录入口；首次登录是否能创建账号仍受上方注册开关控制。</p>
                                {!draftLinuxDOEnabled ? <span>当前关闭，因此 OAuth 凭据和端点配置已收起。</span> : null}
                            </div>
                            <Form.Item noStyle name="enabled" valuePropName="checked">
                                <Switch aria-label="在登录与注册页显示 Linux.do" onChange={toggleLinuxDO} />
                            </Form.Item>
                        </div>

                        {draftLinuxDOEnabled ? (
                            <>
                                <div className="admin-access-form-section">
                                    <FormSectionTitle icon={<KeyRound className="size-4" />} title="应用凭据" description="填写 Linux.do OAuth 应用的客户端信息；密钥只保存在服务端。" />
                                    <div className="admin-access-form-grid is-credentials">
                                        <Form.Item name="clientAuthMethod" label="Token 请求鉴权方式" rules={[{ required: true, message: "请选择鉴权方式" }]} extra="应用未特别要求时使用 Client Secret Post。">
                                            <Select
                                                options={[
                                                    { label: "Client Secret Post（推荐）", value: "client_secret_post" },
                                                    { label: "Client Secret Basic", value: "client_secret_basic" },
                                                ]}
                                            />
                                        </Form.Item>
                                        <Form.Item name="clientId" label="Client ID">
                                            <Input autoComplete="off" placeholder="Linux.do OAuth 应用的 Client ID" />
                                        </Form.Item>
                                        <Form.Item name="clientSecret" label={linuxdo.hasClientSecret ? `Client Secret（${configuredSecretText}）` : "Client Secret"}>
                                            <Input.Password autoComplete="new-password" placeholder={linuxdo.hasClientSecret ? "留空保留原密钥" : "Linux.do OAuth 应用的 Client Secret"} />
                                        </Form.Item>
                                    </div>
                                </div>

                                <div className="admin-access-form-section">
                                    <FormSectionTitle icon={<Globe2 className="size-4" />} title="OAuth 连接地址" description="授权、Token 和用户资料端点必须使用 HTTPS；本地回环回调可使用 HTTP。" />
                                    <div className="admin-access-form-grid">
                                        <Form.Item name="authorizationUrl" label="授权地址">
                                            <Input inputMode="url" placeholder="https://connect.linux.do/oauth2/authorize" />
                                        </Form.Item>
                                        <Form.Item name="tokenUrl" label="Token 地址">
                                            <Input inputMode="url" placeholder="https://connect.linux.do/oauth2/token" />
                                        </Form.Item>
                                        <Form.Item name="userInfoUrl" label="用户资料地址">
                                            <Input inputMode="url" placeholder="https://connect.linux.do/api/user" />
                                        </Form.Item>
                                        <Form.Item name="redirectUrl" label="本站回调地址" extra="必须与 Linux.do OAuth 应用登记值完全一致；推荐使用 /oauth/linuxdo/callback。">
                                            <Input inputMode="url" placeholder="https://你的域名/oauth/linuxdo/callback" />
                                        </Form.Item>
                                        <Form.Item name="scopes" label="授权范围（Scopes）" className="admin-access-form-span-full" extra="通常使用 openid、profile、email；按 Linux.do 应用实际授权范围填写。">
                                            <Select mode="tags" tokenSeparators={[",", " "]} placeholder="输入后按回车添加" />
                                        </Form.Item>
                                    </div>
                                </div>

                                <details className="admin-access-advanced group">
                                    <summary>
                                        <span className="admin-access-advanced-icon">
                                            <LockKeyhole className="size-4" aria-hidden="true" />
                                        </span>
                                        <span>
                                            <strong>高级：用户资料字段映射</strong>
                                            <small>指定从 Linux.do 响应中读取本地账号信息的字段路径。</small>
                                        </span>
                                        <AdminStatusBadge label="通常无需修改" tone="neutral" />
                                        <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
                                    </summary>
                                    <div className="admin-access-form-grid is-mapping">
                                        <Form.Item name="subjectField" label="唯一用户 ID 字段" extra="账号绑定的唯一依据，必须长期稳定。">
                                            <Input placeholder="id" />
                                        </Form.Item>
                                        <Form.Item name="usernameField" label="用户名字段" extra="用于生成本站用户名。">
                                            <Input placeholder="username" />
                                        </Form.Item>
                                        <Form.Item name="displayNameField" label="显示名称字段" extra="显示在用户菜单中的名称。">
                                            <Input placeholder="name" />
                                        </Form.Item>
                                        <Form.Item name="emailField" label="邮箱字段" extra="没有或无效时允许留空。">
                                            <Input placeholder="email" />
                                        </Form.Item>
                                        <Form.Item name="avatarField" label="头像地址字段" extra="支持 data.user.avatar_url 这类嵌套路径。">
                                            <Input placeholder="avatar_url" />
                                        </Form.Item>
                                    </div>
                                </details>
                            </>
                        ) : null}
                    </Form>
                </SettingsSectionCard>
            </div>

            <div id="admin-access-agreement" className="admin-settings-anchor">
                <SettingsSectionCard
                    className="admin-access-section admin-access-agreement-section"
                    icon={<FileText className="size-4" aria-hidden="true" />}
                    title="3. 服务协议名称与条款"
                    description="注册页勾选框与弹窗展示的内容。协议名称留空时自动跟随品牌名生成，条款留空时注册页给出待补充提示。"
                    status={<AdminStatusBadge label={agreementDirty ? "待保存" : agreementContent.trim() ? "已自定义" : "待补充"} tone={agreementDirty ? "warning" : agreementContent.trim() ? "success" : "neutral"} />}
                    footer={
                        <>
                            <div className="admin-access-footer-note">
                                <BadgeCheck className="size-4" aria-hidden="true" />
                                <span>保存后注册页立即生效，无需重启服务</span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                {agreementDirty ? (
                                    <Button icon={<RotateCcw className="size-4" />} disabled={savingAgreement} onClick={resetAgreementDraft}>
                                        撤销
                                    </Button>
                                ) : null}
                                <Button type="primary" icon={<Save className="size-4" />} loading={savingAgreement} disabled={!agreementDirty || loading || refreshing} onClick={() => void saveAgreement()}>
                                    保存服务协议
                                </Button>
                            </div>
                        </>
                    }
                >
                    <Form layout="vertical" requiredMark={false} disabled={loading || refreshing || savingAgreement}>
                        <Form.Item label="协议名称" extra={`留空时自动跟随品牌名生成，即《${brandName}服务协议》。此处只需填名称本身，书名号由注册页补充。`} className="admin-access-agreement-title-field">
                            <Input
                                value={agreementTitle}
                                maxLength={60}
                                placeholder={`${brandName}服务协议`}
                                onChange={(event) => {
                                    setAgreementTitle(event.target.value);
                                    setAgreementDirty(true);
                                }}
                            />
                        </Form.Item>
                        <Form.Item label="协议条款内容" extra="支持多段落文本，按空行分段展示；留空时注册页弹窗显示“服务协议内容待补充”。" className="admin-access-agreement-content-field">
                            <Input.TextArea
                                value={agreementContent}
                                maxLength={20000}
                                autoSize={{ minRows: 8, maxRows: 20 }}
                                placeholder="输入服务协议条款正文"
                                onChange={(event) => {
                                    setAgreementContent(event.target.value);
                                    setAgreementDirty(true);
                                }}
                            />
                        </Form.Item>
                        <div className="admin-access-agreement-toolbar">
                            <div className="admin-access-agreement-template-note">
                                <FileText className="size-3.5 shrink-0" aria-hidden="true" />
                                <span>没有准备条款时，可先填入通用模板再按需修改。</span>
                            </div>
                            <div className="admin-access-agreement-template-actions">
                                <span className="admin-access-agreement-metric">{agreementContent.trim() ? `${agreementParagraphsCount} 段 · ${agreementContent.length} 字` : "尚未填写条款"}</span>
                                <Button
                                    size="small"
                                    disabled={savingAgreement || loading || refreshing}
                                    onClick={() => {
                                        setAgreementContent(DEFAULT_AGREEMENT_TEMPLATE);
                                        setAgreementDirty(true);
                                    }}
                                >
                                    填入通用模板
                                </Button>
                                {agreementContent.trim() ? (
                                    <Button
                                        size="small"
                                        type="text"
                                        danger
                                        disabled={savingAgreement || loading || refreshing}
                                        onClick={() => {
                                            setAgreementContent("");
                                            setAgreementDirty(true);
                                        }}
                                    >
                                        清空
                                    </Button>
                                ) : null}
                            </div>
                        </div>
                    </Form>
                </SettingsSectionCard>
            </div>

            <div id="admin-access-login-mode" className="admin-settings-anchor">
                <SettingsSectionCard
                    className="admin-access-section admin-access-login-mode-section"
                    icon={<AppWindow className="size-4" aria-hidden="true" />}
                    title="4. 登录与注册的打开方式"
                    description="决定用户点击「登录」或访问需要登录的页面时，登录与注册界面以弹窗还是独立页面呈现。"
                    status={<AdminStatusBadge label="切换即保存" tone="info" />}
                >
                    <div className="admin-storage-mode-content">
                        <div className="admin-storage-mode-grid" role="radiogroup" aria-label="登录与注册的打开方式">
                            {LOGIN_MODES.map((item) => {
                                const selected = (registration.loginMode ?? "modal") === item.mode;
                                return (
                                    <button
                                        key={item.mode}
                                        type="button"
                                        role="radio"
                                        aria-checked={selected}
                                        className={cn("admin-storage-mode-choice", selected && "is-selected")}
                                        disabled={loading || refreshing || savingLoginMode}
                                        onClick={() => void changeLoginMode(item.mode)}
                                    >
                                        <span className="admin-storage-mode-icon">{item.mode === "modal" ? <AppWindow className="size-4" aria-hidden="true" /> : <PanelsTopLeft className="size-4" aria-hidden="true" />}</span>
                                        <span className="admin-storage-mode-copy">
                                            <strong>{item.label}</strong>
                                            <small>{item.description}</small>
                                        </span>
                                        <span className="admin-storage-mode-meta">{item.short}</span>
                                        {selected ? (
                                            <span className="admin-storage-mode-selected">
                                                <Check className="size-3.5" aria-hidden="true" />
                                                当前方式
                                            </span>
                                        ) : null}
                                    </button>
                                );
                            })}
                        </div>
                        <div className="admin-storage-history-note">
                            <ShieldCheck className="size-4" aria-hidden="true" />
                            <span>两种方式使用同一套登录、注册与找回密码流程，Linux.do 回跳和推广链接 /register?ref= 均可用。需要保留未发送内容的入口（如首页创作输入框）始终使用弹窗。</span>
                        </div>
                    </div>
                </SettingsSectionCard>
            </div>
        </div>
    );
}

function FormSectionTitle({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
    return (
        <div className="admin-access-form-section-heading">
            <span>{icon}</span>
            <div>
                <h3>{title}</h3>
                <p>{description}</p>
            </div>
        </div>
    );
}

function toLinuxDOFormValues(setting: LinuxDOSetting): LinuxDOFormValues {
    return {
        enabled: setting.enabled,
        clientId: setting.clientId,
        clientSecret: "",
        authorizationUrl: setting.authorizationUrl,
        tokenUrl: setting.tokenUrl,
        userInfoUrl: setting.userInfoUrl,
        redirectUrl: setting.redirectUrl,
        scopes: setting.scopes || [],
        clientAuthMethod: setting.clientAuthMethod,
        subjectField: setting.subjectField,
        usernameField: setting.usernameField,
        displayNameField: setting.displayNameField,
        emailField: setting.emailField,
        avatarField: setting.avatarField,
    };
}

function normalizeLinuxDOFormValues(values: LinuxDOFormValues): LinuxDOFormValues {
    return {
        enabled: Boolean(values.enabled),
        clientId: values.clientId?.trim() || "",
        clientSecret: values.clientSecret?.trim() || "",
        authorizationUrl: values.authorizationUrl?.trim() || "",
        tokenUrl: values.tokenUrl?.trim() || "",
        userInfoUrl: values.userInfoUrl?.trim() || "",
        redirectUrl: values.redirectUrl?.trim() || "",
        scopes: [...new Set((values.scopes || []).map((value) => value.trim()).filter(Boolean))],
        clientAuthMethod: values.clientAuthMethod || "client_secret_post",
        subjectField: values.subjectField?.trim() || "id",
        usernameField: values.usernameField?.trim() || "username",
        displayNameField: values.displayNameField?.trim() || "name",
        emailField: values.emailField?.trim() || "email",
        avatarField: values.avatarField?.trim() || "avatar_url",
    };
}

function hasLinuxDOChanges(values: LinuxDOFormValues, setting: LinuxDOSetting | null) {
    if (!setting) return false;
    const draft = normalizeLinuxDOFormValues(values);
    const saved = normalizeLinuxDOFormValues(toLinuxDOFormValues(setting));
    if (draft.clientSecret) return true;
    return (Object.keys(saved) as Array<keyof LinuxDOFormValues>).some((key) => key !== "clientSecret" && JSON.stringify(draft[key]) !== JSON.stringify(saved[key]));
}

function validateLinuxDODraft(values: LinuxDOFormValues, setting: LinuxDOSetting | null) {
    const draft = normalizeLinuxDOFormValues(values);
    if (!draft.enabled) return "";
    if (!draft.clientId || (!draft.clientSecret && !setting?.hasClientSecret) || !draft.authorizationUrl || !draft.tokenUrl || !draft.userInfoUrl || !draft.redirectUrl) return "启用 Linux.do 登录前请完整填写 Client、端点和回调配置";
    for (const value of [draft.authorizationUrl, draft.tokenUrl, draft.userInfoUrl]) if (!isValidURL(value, true)) return "Linux.do 授权、Token 和用户资料地址必须是有效的 HTTPS URL";
    if (!isValidRedirectURL(draft.redirectUrl)) return "Linux.do 回调地址必须使用 HTTPS，本地回环地址可使用 HTTP";
    return "";
}

function linuxDOResponseMatches(setting: LinuxDOSetting, expected: LinuxDOFormValues) {
    const actual = normalizeLinuxDOFormValues(toLinuxDOFormValues(setting));
    const fields: Array<keyof LinuxDOFormValues> = ["enabled", "clientId", "authorizationUrl", "tokenUrl", "userInfoUrl", "redirectUrl", "scopes", "clientAuthMethod", "subjectField", "usernameField", "displayNameField", "emailField", "avatarField"];
    if (expected.clientSecret && !setting.hasClientSecret) return false;
    return fields.every((key) => JSON.stringify(actual[key]) === JSON.stringify(expected[key]));
}

function isValidURL(value: string, requireHTTPS = false) {
    try {
        const parsed = new URL(value);
        return Boolean(parsed.host) && (!requireHTTPS || parsed.protocol === "https:");
    } catch {
        return false;
    }
}

function isValidRedirectURL(value: string) {
    try {
        const parsed = new URL(value);
        if (parsed.protocol === "https:" && parsed.host) return true;
        return parsed.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
    } catch {
        return false;
    }
}

function formatSettingTime(value: string | undefined, fallback: string) {
    if (!value) return fallback;
    const date = new Date(value);
    if (Number.isNaN(date.getTime()) || date.getFullYear() < 2000) return fallback;
    return `更新于 ${date.toLocaleString("zh-CN", { hour12: false })}`;
}
