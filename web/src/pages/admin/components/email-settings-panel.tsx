import { App, Button, Form, Input, InputNumber, Select, Skeleton, Switch } from "antd";
import { AlertTriangle, AtSign, BadgeCheck, KeyRound, MailCheck, RefreshCw, RotateCcw, Save, Send, Server } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useBlocker } from "react-router";

import { cn } from "@/lib/utils";
import { getAdminEmailSetting, updateAdminEmailSetting, type EmailSetting } from "@/services/api/wallet";
import { AdminStatusBadge, configuredSecretText, SettingsSectionCard } from "./admin-ui";

type EmailFormValues = Pick<EmailSetting, "enabled" | "host" | "port" | "username" | "password" | "encryption" | "fromEmail" | "fromName">;

export default function EmailSettingsPanel() {
    const { message, modal } = App.useApp();
    const [setting, setSetting] = useState<EmailSetting | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [draftEnabled, setDraftEnabled] = useState(false);
    const [loadError, setLoadError] = useState("");
    const [saveError, setSaveError] = useState("");
    const [form] = Form.useForm<EmailFormValues>();
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
                const result = await getAdminEmailSetting();
                if (requestVersion !== requestVersionRef.current) return;
                if (!isEmailSetting(result.setting)) throw new Error("服务端返回的邮件配置格式无效");
                setSetting(result.setting);
                setDirty(false);
                setSaveError("");
                if (announce) message.success("已重新读取当前邮件服务配置");
            } catch (error) {
                if (requestVersion !== requestVersionRef.current) return;
                const errorMessage = error instanceof Error ? error.message : "读取邮件配置失败";
                setLoadError(errorMessage);
                if (!initial) message.error(errorMessage);
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
        };
    }, [load]);

    useEffect(() => {
        if (loading || !setting) return;
        form.setFieldsValue(toEmailFormValues(setting));
        setDraftEnabled(setting.enabled);
    }, [form, loading, setting]);

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
        if (blocker.state !== "blocked" || navigationConfirmOpenRef.current) return;
        navigationConfirmOpenRef.current = true;
        navigationTriggerRef.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
        modal.confirm({
            title: "放弃邮件服务调整？",
            content: "当前 SMTP 表单有尚未保存的调整，离开后这些内容会丢失。服务端正在使用的邮件配置不会改变。",
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
                    const fallback = document.querySelector<HTMLButtonElement>(".admin-email-command-actions button");
                    const target = navigationTriggerRef.current?.isConnected ? navigationTriggerRef.current : fallback;
                    target?.focus();
                    navigationTriggerRef.current = null;
                });
            },
        });
    }, [blocker, modal]);

    const resetDraft = () => {
        if (!setting || saving) return;
        form.setFieldsValue(toEmailFormValues(setting));
        form.setFields([]);
        setDraftEnabled(setting.enabled);
        setDirty(false);
        setSaveError("");
        message.info("已撤销邮件服务的未保存调整");
    };

    const requestRefresh = () => {
        if (!dirty) {
            void load(false, true);
            return;
        }
        modal.confirm({
            title: "放弃调整并重新读取？",
            content: "重新读取会丢弃当前 SMTP 表单中的未保存内容，并以服务端配置为准。",
            okText: "放弃并刷新",
            cancelText: "继续编辑",
            okButtonProps: { danger: true },
            onOk: () => load(false, true),
        });
    };

    const save = async (values: EmailFormValues) => {
        const expected = normalizeEmailFormValues(values);
        setSaving(true);
        setSaveError("");
        try {
            const result = await updateAdminEmailSetting(expected);
            if (!isEmailSetting(result.setting) || !emailResponseMatches(result.setting, expected)) throw new Error("服务端返回的邮件配置与本次保存内容不一致，请重新读取后核对");
            setSetting(result.setting);
            form.setFieldsValue(toEmailFormValues(result.setting));
            setDraftEnabled(result.setting.enabled);
            setDirty(false);
            message.success("注册邮件配置已保存");
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "保存邮件配置失败";
            setSaveError(`${errorMessage}。未自动重试，请重新读取当前配置后再决定是否保存。`);
            message.error(errorMessage);
            throw error;
        } finally {
            setSaving(false);
        }
    };

    const submitSave = async () => {
        let values: EmailFormValues;
        try {
            values = await form.validateFields();
        } catch {
            return;
        }
        const validationError = validateEmailDraft(values, setting);
        if (validationError) {
            message.error(validationError);
            return;
        }
        try {
            await save(values);
        } catch {
            // 保存错误已在 save 中就地提示。
        }
    };

    const toggleEnabled = (enabled: boolean) => {
        if (!setting || saving) return;
        form.setFieldValue("enabled", enabled);
        setDraftEnabled(enabled);
        setDirty(hasEmailChanges({ ...form.getFieldsValue(true), enabled }, setting));
        setSaveError("");
    };

    if (loading && !setting) {
        return (
            <div className="admin-settings-stack admin-email-settings" aria-label="正在读取邮件服务配置" role="status">
                <div className="admin-email-loading-card">
                    <Skeleton active paragraph={{ rows: 7 }} />
                </div>
            </div>
        );
    }

    if (!setting) {
        return (
            <div className="admin-settings-stack admin-email-settings">
                <div className="admin-email-load-error" role="alert">
                    <span className="admin-email-load-error-icon">
                        <AlertTriangle className="size-5" aria-hidden="true" />
                    </span>
                    <div>
                        <h2>无法读取邮件服务配置</h2>
                        <p>{loadError || "当前没有可显示的配置，请稍后重试。"}</p>
                    </div>
                    <Button icon={<RefreshCw className="size-4" />} loading={refreshing} onClick={() => void load(false, true)}>
                        重新读取
                    </Button>
                </div>
            </div>
        );
    }

    const currentValues = normalizeEmailFormValues(form.getFieldsValue(true));
    const smtpReady = Boolean(currentValues.host && currentValues.port && currentValues.fromEmail);

    return (
        <div className="admin-settings-stack admin-email-settings">
            <div className={cn("admin-email-command-bar", dirty && "is-dirty")}>
                <div className="admin-email-command-copy" aria-live="polite">
                    <span className="admin-email-command-icon">
                        <MailCheck className="size-4" aria-hidden="true" />
                    </span>
                    <div>
                        <strong>{dirty ? "有未保存的邮件调整" : `注册验证码：${setting.enabled ? "已启用" : "未启用"}`}</strong>
                        <p>{dirty ? "完成当前配置后保存生效。" : formatSettingTime(setting.updatedAt, "使用系统默认值")}</p>
                    </div>
                </div>
                <div className="admin-email-command-actions">
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

            {loadError || saveError ? (
                <div className="admin-email-inline-alert" role="alert">
                    <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                    <span>{saveError || `${loadError}。页面仍显示上一次成功读取的配置。`}</span>
                </div>
            ) : null}

            <div id="admin-email-delivery" className="admin-settings-anchor">
                <SettingsSectionCard
                    className="admin-email-section admin-email-delivery-section"
                    icon={<Send className="size-4" aria-hidden="true" />}
                    title="1. 是否发送注册邮箱验证码"
                    description="这是邮件服务的主开关。关闭时不需要配置 SMTP；开启后再填写连接与发件信息。"
                    status={<AdminStatusBadge label={draftEnabled ? (dirty && !setting.enabled ? "待启用" : "已启用") : dirty && setting.enabled ? "待停用" : "未启用"} tone={dirty ? "warning" : draftEnabled ? "success" : "neutral"} />}
                    footer={
                        !draftEnabled ? (
                            <>
                                <div className="admin-email-footer-note">
                                    <BadgeCheck className="size-4" aria-hidden="true" />
                                    <span>关闭后，普通邮箱注册不再要求邮箱验证码。</span>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    {dirty ? (
                                        <Button icon={<RotateCcw className="size-4" />} disabled={saving} onClick={resetDraft}>
                                            撤销
                                        </Button>
                                    ) : null}
                                    <Button type="primary" icon={<Save className="size-4" />} loading={saving} disabled={!dirty || loading || refreshing} onClick={() => void submitSave()}>
                                        保存设置
                                    </Button>
                                </div>
                            </>
                        ) : undefined
                    }
                >
                    <div className="admin-email-delivery-policy">
                        <span className="admin-email-policy-icon">
                            <MailCheck className="size-5" aria-hidden="true" />
                        </span>
                        <div className="admin-email-policy-copy">
                            <div className="flex flex-wrap items-center gap-2">
                                <strong>发送注册邮箱验证码</strong>
                                <AdminStatusBadge label="保存后生效" tone="info" />
                            </div>
                            <p>启用后，普通邮箱注册需要获取并校验 6 位验证码；邮件发送失败时不会创建可用验证码。</p>
                            <span>关闭只停止后续验证码邮件，不改变新用户注册开关，也不影响已有账号。</span>
                        </div>
                        <Switch checked={draftEnabled} disabled={loading || refreshing || saving} aria-label="发送注册邮箱验证码" onChange={toggleEnabled} />
                    </div>
                </SettingsSectionCard>
            </div>

            {draftEnabled ? (
                <div id="admin-email-smtp" className="admin-settings-anchor">
                    <SettingsSectionCard
                        className="admin-email-section admin-email-configuration-section"
                        icon={<Server className="size-4" aria-hidden="true" />}
                        title="2. 配置 SMTP 连接与发件身份"
                        description="填写邮件服务器、身份验证和发件人信息。保存不会主动探测或发送测试邮件。"
                        status={<AdminStatusBadge label={dirty ? "待保存" : smtpReady ? "已配置" : "待配置"} tone={dirty ? "warning" : smtpReady ? "success" : "neutral"} />}
                        footer={
                            <>
                                <div className="admin-email-footer-note">
                                    <BadgeCheck className="size-4" aria-hidden="true" />
                                    <span>SMTP 密码由服务端加密保存且不回显明文</span>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    {dirty ? (
                                        <Button icon={<RotateCcw className="size-4" />} disabled={saving} onClick={resetDraft}>
                                            撤销
                                        </Button>
                                    ) : null}
                                    <Button type="primary" icon={<Save className="size-4" />} loading={saving} disabled={!dirty || loading || refreshing} onClick={() => void submitSave()}>
                                        保存并启用
                                    </Button>
                                </div>
                            </>
                        }
                    >
                        <Form
                            form={form}
                            layout="vertical"
                            requiredMark={false}
                            disabled={loading || refreshing || saving}
                            onValuesChange={() => {
                                const values = form.getFieldsValue(true);
                                setDraftEnabled(Boolean(values.enabled));
                                setDirty(hasEmailChanges(values, setting));
                                setSaveError("");
                            }}
                        >
                            <Form.Item name="enabled" valuePropName="checked" hidden>
                                <Switch />
                            </Form.Item>

                            <div className="admin-email-form-section">
                                <FormSectionTitle icon={<Server className="size-4" />} title="服务器连接" description="填写 SMTP 主机、端口和传输加密；STARTTLS 通常使用 587，直接 TLS 通常使用 465。" />
                                <div className="admin-email-form-grid is-connection">
                                    <Form.Item name="host" label="SMTP 主机" extra="仅填写主机名或 IP，不包含协议和端口。">
                                        <Input autoComplete="off" placeholder="smtp.example.com" />
                                    </Form.Item>
                                    <Form.Item
                                        name="port"
                                        label="SMTP 端口"
                                        rules={[
                                            {
                                                validator: (_, value: number | null | undefined) => (!draftEnabled || (Number(value) >= 1 && Number(value) <= 65535) ? Promise.resolve() : Promise.reject(new Error("请输入 1 至 65535 的端口"))),
                                            },
                                        ]}
                                    >
                                        <InputNumber min={1} max={65535} precision={0} placeholder="587" controls={false} />
                                    </Form.Item>
                                    <Form.Item name="encryption" label="连接加密" rules={[{ required: true, message: "请选择连接加密方式" }]}>
                                        <Select
                                            options={[
                                                { label: "STARTTLS（推荐，通常 587）", value: "starttls" },
                                                { label: "直接 TLS（通常 465）", value: "tls" },
                                                { label: "无加密（仅限可信网络）", value: "none" },
                                            ]}
                                        />
                                    </Form.Item>
                                </div>
                            </div>

                            <div className="admin-email-form-section">
                                <FormSectionTitle icon={<KeyRound className="size-4" />} title="SMTP 身份验证" description="服务器要求登录时填写账号和密码；密码留空会保留服务端已配置值。" />
                                <div className="admin-email-form-grid">
                                    <Form.Item name="username" label="SMTP 用户名" extra="通常是完整邮箱地址；无需验证的服务器可留空。">
                                        <Input autoComplete="off" placeholder="mailer@example.com" />
                                    </Form.Item>
                                    <Form.Item name="password" label={setting.hasPassword ? `SMTP 密码（${configuredSecretText}）` : "SMTP 密码"} extra="只在需要新增或替换密码时填写。">
                                        <Input.Password autoComplete="new-password" placeholder={setting.hasPassword ? "留空保留原密码" : "SMTP 密码或服务商授权码"} />
                                    </Form.Item>
                                </div>
                            </div>

                            <div className="admin-email-form-section">
                                <FormSectionTitle icon={<AtSign className="size-4" />} title="发件人身份" description="这组名称和地址会显示在注册验证码邮件的 From 信息中。" />
                                <div className="admin-email-form-grid">
                                    <Form.Item
                                        name="fromEmail"
                                        label="发件邮箱"
                                        rules={[
                                            {
                                                validator: (_, value: string | undefined) => (!draftEnabled || !value || isValidEmail(value.trim()) ? Promise.resolve() : Promise.reject(new Error("请输入有效的发件邮箱"))),
                                            },
                                        ]}
                                        extra="通常需要与 SMTP 账号或服务商验证域名一致。"
                                    >
                                        <Input autoComplete="off" inputMode="email" placeholder="noreply@example.com" />
                                    </Form.Item>
                                    <Form.Item
                                        name="fromName"
                                        label="发件人名称"
                                        rules={[
                                            {
                                                validator: (_, value: string | undefined) => (!draftEnabled || !value || !/[\r\n]/.test(value) ? Promise.resolve() : Promise.reject(new Error("发件人名称不能包含换行"))),
                                            },
                                        ]}
                                        extra="留空时服务端使用“影策”。"
                                    >
                                        <Input placeholder="影策" />
                                    </Form.Item>
                                </div>
                            </div>
                        </Form>
                    </SettingsSectionCard>
                </div>
            ) : null}
        </div>
    );
}

function FormSectionTitle({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
    return (
        <div className="admin-email-form-section-heading">
            <span>{icon}</span>
            <div>
                <h3>{title}</h3>
                <p>{description}</p>
            </div>
        </div>
    );
}

function toEmailFormValues(setting: EmailSetting): EmailFormValues {
    return {
        enabled: setting.enabled,
        host: setting.host,
        port: setting.port,
        username: setting.username,
        password: "",
        encryption: setting.encryption,
        fromEmail: setting.fromEmail,
        fromName: setting.fromName,
    };
}

function normalizeEmailFormValues(values: Partial<EmailFormValues>): EmailFormValues {
    return {
        enabled: Boolean(values.enabled),
        host: values.host?.trim() || "",
        port: Number(values.port) || 587,
        username: values.username?.trim() || "",
        password: values.password?.trim() || "",
        encryption: values.encryption === "tls" || values.encryption === "none" ? values.encryption : "starttls",
        fromEmail: values.fromEmail?.trim().toLowerCase() || "",
        fromName: values.fromName?.trim() || "影策",
    };
}

function hasEmailChanges(values: Partial<EmailFormValues>, setting: EmailSetting | null) {
    if (!setting) return false;
    const draft = normalizeEmailFormValues(values);
    const saved = normalizeEmailFormValues(toEmailFormValues(setting));
    if (draft.password) return true;
    return (Object.keys(saved) as Array<keyof EmailFormValues>).some((key) => key !== "password" && draft[key] !== saved[key]);
}

function validateEmailDraft(values: EmailFormValues, setting: EmailSetting | null) {
    const draft = normalizeEmailFormValues(values);
    if (!draft.enabled) return "";
    if (/\r|\n/.test(draft.fromName)) return "发件人名称不能包含换行";
    if (!draft.host || draft.port < 1 || draft.port > 65535 || !draft.fromEmail) return "启用注册邮件前请完整填写 SMTP 主机、端口和发件邮箱";
    if (!isValidEmail(draft.fromEmail)) return "发件邮箱格式不正确";
    if (draft.username && !draft.password && !setting?.hasPassword) return "SMTP 用户名已填写，请同时填写密码或服务商授权码";
    return "";
}

function emailResponseMatches(setting: EmailSetting, expected: EmailFormValues) {
    const actual = normalizeEmailFormValues(toEmailFormValues(setting));
    const fields: Array<keyof EmailFormValues> = ["enabled", "host", "port", "username", "encryption", "fromEmail", "fromName"];
    if (expected.password && !setting.hasPassword) return false;
    return fields.every((key) => actual[key] === expected[key]);
}

function isEmailSetting(value: unknown): value is EmailSetting {
    if (!value || typeof value !== "object") return false;
    const setting = value as Partial<EmailSetting>;
    return (
        typeof setting.enabled === "boolean" &&
        typeof setting.host === "string" &&
        typeof setting.port === "number" &&
        typeof setting.username === "string" &&
        ["starttls", "tls", "none"].includes(setting.encryption || "") &&
        typeof setting.fromEmail === "string" &&
        typeof setting.fromName === "string" &&
        typeof setting.hasPassword === "boolean"
    );
}

function isValidEmail(value: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function formatSettingTime(value: string | undefined, fallback: string) {
    if (!value) return fallback;
    const date = new Date(value);
    if (Number.isNaN(date.getTime()) || date.getFullYear() < 2000) return fallback;
    return `更新于 ${date.toLocaleString("zh-CN", { hour12: false })}`;
}
