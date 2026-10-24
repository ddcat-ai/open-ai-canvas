import { App, Button, Form, Input, Skeleton } from "antd";
import { Switch } from "@/pages/admin/ui/controls";
import { AlertTriangle, BadgeCheck, ChevronDown, FileText, Globe2, KeyRound, LockKeyhole, RefreshCw, RotateCcw, Save, ShieldCheck, Sparkles, UserPlus, UsersRound } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useBlocker } from "react-router";

import { cn } from "@/lib/utils";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { getAdminLinuxDOSetting, getAdminRegistrationSetting, getAdminWechatSetting, updateAdminLinuxDOSetting, updateAdminRegistrationSetting, updateAdminWechatSetting, type LinuxDOSetting, type RegistrationSetting, type WechatAdminSetting, type WechatAdminSettingInput } from "@/services/api/wallet";
import { AdminStatusBadge, configuredSecretText, SettingsSectionCard } from "./admin-ui";
import { Select } from "@/components/ui/base/select";
import { WechatIcon } from "@/pages/auth/auth-scene";

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
    const [wechat, setWechat] = useState<WechatAdminSetting | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [savingLinuxDO, setSavingLinuxDO] = useState(false);
    const [savingRegistration, setSavingRegistration] = useState(false);
    const [savingAgreement, setSavingAgreement] = useState(false);
    const [savingWechat, setSavingWechat] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [draftLinuxDOEnabled, setDraftLinuxDOEnabled] = useState(false);
    const [draftWechatEnabled, setDraftWechatEnabled] = useState(false);
    const [wechatDirty, setWechatDirty] = useState(false);
    const [agreementTitle, setAgreementTitle] = useState("");
    const [agreementContent, setAgreementContent] = useState("");
    const [agreementDirty, setAgreementDirty] = useState(false);
    const [loadError, setLoadError] = useState("");
    const [saveError, setSaveError] = useState("");
    const [form] = Form.useForm<LinuxDOFormValues>();
    const [wechatForm] = Form.useForm<WechatAdminSettingInput>();
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
                const [linuxdoData, registrationData, wechatData] = await Promise.all([
                    getAdminLinuxDOSetting(),
                    getAdminRegistrationSetting(),
                    getAdminWechatSetting(),
                ]);
                if (requestVersion !== requestVersionRef.current) return;
                setLinuxdo(linuxdoData.setting);
                setRegistration(registrationData.setting);
                setWechat(wechatData.setting);
                wechatForm.setFieldsValue({
                    enabled: wechatData.setting.enabled,
                    appId: wechatData.setting.appId,
                    secret: "",
                    page: wechatData.setting.page || "pages/login/login",
                    envVersion: wechatData.setting.envVersion || "trial",
                    manual: wechatData.setting.manual,
                });
                setDraftWechatEnabled(wechatData.setting.enabled);
                setWechatDirty(false);
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

    const unsaved = (dirty && !savingLinuxDO) || (agreementDirty && !savingAgreement) || (wechatDirty && !savingWechat);
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

    const resetWechatDraft = () => {
        if (!wechat) return;
        wechatForm.setFieldsValue(toWechatFormValues(wechat));
        setDraftWechatEnabled(Boolean(wechat.enabled));
        setWechatDirty(false);
    };

    const toggleWechat = (enabled: boolean) => {
        if (!wechat || savingWechat) return;
        wechatForm.setFieldValue("enabled", enabled);
        setDraftWechatEnabled(enabled);
        const currentValues = { ...wechatForm.getFieldsValue(true), enabled };
        setWechatDirty(hasWechatChanges(currentValues, wechat));
    };

    const submitWechatSave = async () => {
        let values: WechatAdminSettingInput;
        try {
            values = await wechatForm.validateFields();
        } catch {
            return;
        }
        values.enabled = draftWechatEnabled;
        if (values.enabled && !values.appId?.trim() && !wechat?.appId?.trim()) {
            message.error("启用微信扫码登录前请输入小程序 AppID");
            return;
        }
        setSavingWechat(true);
        try {
            const res = await updateAdminWechatSetting(values);
            setWechat(res.setting);
            wechatForm.setFieldsValue(toWechatFormValues(res.setting));
            setDraftWechatEnabled(Boolean(res.setting.enabled));
            setWechatDirty(false);
            message.success(res.setting.enabled ? "微信登录已开启并生效" : "微信登录已关闭并生效");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存微信登录配置失败");
        } finally {
            setSavingWechat(false);
        }
    };

    if (loading && (!linuxdo || !registration || !wechat)) {
        return (
            <div className="admin-settings-stack admin-access-settings" aria-label="正在读取登录与注册配置" role="status">
                <div className="admin-access-loading-card">
                    <Skeleton active paragraph={{ rows: 6 }} />
                </div>
            </div>
        );
    }

    if (!linuxdo || !registration || !wechat) {
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
                        <p>{dirty ? "完成接入信息后保存生效。" : `新用户注册${registration.enabled ? "已开放" : "已关闭"} · Linux.do ${linuxdo.enabled ? "已启用" : "未启用"}`}</p>
                    </div>
                </div>
                <div className="admin-access-command-actions">
                    {dirty ? (
                        <Button icon={<RotateCcw className="size-4" />} disabled={savingLinuxDO} onClick={resetLinuxDODraft}>
                            撤销调整
                        </Button>
                    ) : null}
                    <Button icon={<RefreshCw className="size-4" />} loading={refreshing} disabled={savingLinuxDO || savingRegistration} onClick={requestRefresh}>
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
                </SettingsSectionCard>
            </div>

            <div id="admin-access-wechat" className="admin-settings-anchor">
                <SettingsSectionCard
                    className="admin-access-section admin-access-wechat-section"
                    icon={<WechatIcon className="size-4 text-emerald-500" aria-hidden="true" />}
                    title="2. 微信小程序扫码登录 (官方直连)"
                    description="配置微信公众平台小程序参数。开启后，在登录与注册页面展示官方原生小程序码。"
                    status={
                        <AdminStatusBadge
                            label={
                                wechatDirty
                                    ? draftWechatEnabled
                                        ? "待启用"
                                        : "待停用"
                                    : wechat.enabled
                                      ? `运行中 (${wechat.envVersion === "release" ? "正式版" : wechat.envVersion === "develop" ? "开发版" : "体验版"})`
                                      : "未启用"
                            }
                            tone={wechatDirty ? "warning" : wechat.enabled ? "success" : "neutral"}
                        />
                    }
                    footer={
                        <>
                            <div className="admin-access-footer-note">
                                <BadgeCheck className="size-4" aria-hidden="true" />
                                <span>{draftWechatEnabled ? "配置 AppID 与 AppSecret 后点击保存生效" : "关闭后登录与注册页将隐藏微信扫码入口"}</span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                {wechatDirty ? (
                                    <Button icon={<RotateCcw className="size-4" />} disabled={savingWechat} onClick={resetWechatDraft}>
                                        撤销
                                    </Button>
                                ) : null}
                                <Button
                                    type="primary"
                                    icon={<Save className="size-4" />}
                                    loading={savingWechat}
                                    disabled={!wechatDirty || loading || refreshing}
                                    onClick={() => void submitWechatSave()}
                                >
                                    {draftWechatEnabled ? "保存并启用" : "保存并关闭"}
                                </Button>
                            </div>
                        </>
                    }
                >
                    <Form
                        form={wechatForm}
                        layout="vertical"
                        requiredMark={false}
                        disabled={loading || refreshing || savingWechat}
                        onValuesChange={() => {
                            const values = wechatForm.getFieldsValue(true);
                            if (values.enabled !== undefined) {
                                setDraftWechatEnabled(Boolean(values.enabled));
                            }
                            setWechatDirty(hasWechatChanges(values, wechat));
                        }}
                    >
                        <div className="admin-access-provider-toggle mb-5">
                            <span className="admin-access-policy-icon">
                                <WechatIcon className="size-5 text-emerald-500" aria-hidden="true" />
                            </span>
                            <div className="admin-access-policy-copy">
                                <div className="flex flex-wrap items-center gap-2">
                                    <strong>在登录与注册页显示微信扫码登录</strong>
                                    <AdminStatusBadge label="保存后生效" tone="info" />
                                </div>
                                <p>开启后在登录与注册页展示官方小程序码；关闭后隐藏微信入口，已有账号仍可使用密码登录。</p>
                                {!draftWechatEnabled ? <span>当前关闭，因此小程序凭据与运行环境配置已收起。</span> : null}
                            </div>
                            <Form.Item noStyle name="enabled" valuePropName="checked">
                                <Switch aria-label="在登录与注册页显示微信扫码登录" onChange={toggleWechat} />
                            </Form.Item>
                        </div>

                        {draftWechatEnabled ? (
                            <>
                                <div className="admin-access-form-section">
                                    <FormSectionTitle icon={<KeyRound className="size-4" />} title="小程序凭据" description="填写微信公众平台小程序的 AppID 与 AppSecret；密钥安全加密保存在服务端。" />
                                    <div className="admin-access-form-grid is-credentials">
                                        <Form.Item
                                            name="appId"
                                            label="小程序 AppID"
                                            rules={[{ required: true, message: "请输入微信小程序 AppID" }]}
                                            extra="微信公众平台开发管理中的 AppID (如 wx1234567890abcdef)"
                                        >
                                            <Input autoComplete="off" placeholder="如 wx1234567890abcdef" />
                                        </Form.Item>
                                        <Form.Item
                                            name="secret"
                                            label={wechat.hasSecret ? `小程序 AppSecret（${configuredSecretText}）` : "小程序 AppSecret"}
                                            extra={wechat.hasSecret ? "已加密保存。留空保留原密钥；输入新密钥将覆盖。" : "32 位 AppSecret 字符串"}
                                        >
                                            <Input.Password autoComplete="new-password" placeholder={wechat.hasSecret ? "留空保留原密钥" : "请输入 32 位 AppSecret"} />
                                        </Form.Item>
                                    </div>
                                </div>

                                <div className="admin-access-form-section">
                                    <FormSectionTitle icon={<Globe2 className="size-4" />} title="小程序码与运行环境" description="配置扫码后打开的小程序页面路径及环境版本。" />
                                    <div className="admin-access-form-grid">
                                        <Form.Item
                                            name="page"
                                            label="扫码直达小程序页面"
                                            extra="微信扫码后打开的页面路径，默认 pages/login/login"
                                        >
                                            <Input placeholder="pages/login/login" />
                                        </Form.Item>
                                        <Form.Item
                                            name="envVersion"
                                            label="小程序运行环境版本"
                                            extra="开发或提审期选体验版；小程序正式上线后切换为正式版"
                                        >
                                            <Select
                                                options={[
                                                    { value: "trial", label: "体验版 (trial) - 适合提审与体验者自测" },
                                                    { value: "release", label: "正式版 (release) - 适合小程序已过审发布" },
                                                    { value: "develop", label: "开发版 (develop) - 适合本地开发者工具调试" },
                                                ]}
                                            />
                                        </Form.Item>
                                    </div>
                                </div>

                                <div className="admin-access-form-section">
                                    <FormSectionTitle icon={<ShieldCheck className="size-4" />} title="备用输入码模式" description="微信提审期若审核员无法使用手机真机扫码，可开启 6 位输入码供审核员测试。" />
                                    <div className="admin-access-switch-field">
                                        <Form.Item noStyle name="manual" valuePropName="checked">
                                            <Switch aria-label="开启 6 位登录码备用模式" onChange={() => setWechatDirty(hasWechatChanges(wechatForm.getFieldsValue(true), wechat))} />
                                        </Form.Item>
                                        <div>
                                            <label>6 位验证码备用/审核模式 (CANVAS_WECHAT_QR_MANUAL)</label>
                                            <p>开启后网页同时展示 6 位短码供小程序端手动输入。日常运营保持关闭，直接展示微信官方葵花码。</p>
                                        </div>
                                    </div>
                                </div>
                            </>
                        ) : null}
                    </Form>
                </SettingsSectionCard>
            </div>

            <div id="admin-access-linuxdo" className="admin-settings-anchor">
                <SettingsSectionCard
                    className="admin-access-section admin-access-linuxdo-section"
                    icon={<KeyRound className="size-4" aria-hidden="true" />}
                    title="3. 是否开放 Linux.do 登录"
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
                    title="4. 服务协议名称与条款"
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
                        <Form.Item
                            label="协议名称"
                            extra={`留空时自动跟随品牌名生成，即《${brandName}服务协议》。此处只需填名称本身，书名号由注册页补充。`}
                            className="admin-access-agreement-title-field"
                        >
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
                        <Form.Item
                            label="协议条款内容"
                            extra="支持多段落文本，按空行分段展示；留空时注册页弹窗显示“服务协议内容待补充”。"
                            className="admin-access-agreement-content-field"
                        >
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
                                <Sparkles className="size-3.5 shrink-0" aria-hidden="true" />
                                <span>没有准备条款时，可先填入通用模板再按需修改。</span>
                            </div>
                            <div className="admin-access-agreement-template-actions">
                                <span className="admin-access-agreement-metric">
                                    {agreementContent.trim() ? `${agreementParagraphsCount} 段 · ${agreementContent.length} 字` : "尚未填写条款"}
                                </span>
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

function toWechatFormValues(setting: WechatAdminSetting): WechatAdminSettingInput {
    return {
        enabled: Boolean(setting.enabled),
        appId: setting.appId || "",
        secret: "",
        page: setting.page || "pages/login/login",
        envVersion: setting.envVersion || "trial",
        manual: Boolean(setting.manual),
    };
}

function normalizeWechatFormValues(values: WechatAdminSettingInput): WechatAdminSettingInput {
    return {
        enabled: Boolean(values.enabled),
        appId: values.appId?.trim() || "",
        secret: values.secret?.trim() || "",
        page: values.page?.trim() || "pages/login/login",
        envVersion: values.envVersion?.trim() || "trial",
        manual: Boolean(values.manual),
    };
}

function hasWechatChanges(values: WechatAdminSettingInput, setting: WechatAdminSetting | null): boolean {
    if (!setting) return false;
    const draft = normalizeWechatFormValues(values);
    const saved = normalizeWechatFormValues(toWechatFormValues(setting));
    if (draft.secret) return true;
    return (
        draft.enabled !== saved.enabled ||
        draft.appId !== saved.appId ||
        draft.page !== saved.page ||
        draft.envVersion !== saved.envVersion ||
        draft.manual !== saved.manual
    );
}
