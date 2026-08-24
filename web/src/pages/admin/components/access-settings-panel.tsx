import { useEffect, useState, type ReactNode } from "react";
import { App, Button, Form, Input, Select, Switch } from "antd";
import { ChevronDown, KeyRound, LockKeyhole, ShieldCheck, UserPlus } from "lucide-react";

import { getAdminLinuxDOSetting, getAdminRegistrationSetting, updateAdminLinuxDOSetting, updateAdminRegistrationSetting, type LinuxDOSetting, type RegistrationSetting } from "@/services/api/wallet";
import { configuredSecretText, SettingsSectionCard } from "./admin-ui";
import { useTranslation } from "react-i18next";

type LinuxDOFormValues = Omit<LinuxDOSetting, "hasClientSecret" | "updatedAt">;

export default function AccessSettingsPanel() {
    const { t } = useTranslation("canvas");
    const { message } = App.useApp();
    const [linuxdo, setLinuxdo] = useState<LinuxDOSetting | null>(null);
    const [registration, setRegistration] = useState<RegistrationSetting | null>(null);
    const [loading, setLoading] = useState(true);
    const [savingLinuxDO, setSavingLinuxDO] = useState(false);
    const [savingRegistration, setSavingRegistration] = useState(false);
    const [form] = Form.useForm<LinuxDOFormValues>();

    useEffect(() => {
        void Promise.all([getAdminLinuxDOSetting(), getAdminRegistrationSetting()])
            .then(([linuxdoData, registrationData]) => {
                setLinuxdo(linuxdoData.setting);
                setRegistration(registrationData.setting);
                form.setFieldsValue({ ...linuxdoData.setting, clientSecret: "" });
            })
            .catch((error) => message.error(error instanceof Error ? error.message : t("admin:failed-to-load-sign-in-settings")))
            .finally(() => setLoading(false));
    }, [form, message]);

    const toggleRegistration = async (enabled: boolean) => {
        setSavingRegistration(true);
        try {
            const data = await updateAdminRegistrationSetting(enabled);
            setRegistration(data.setting);
            message.success(enabled ? t("admin:user-registration-is-open") : t("admin:user-registration-is-closed"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:failed-to-update-registration-settings"));
        } finally {
            setSavingRegistration(false);
        }
    };

    const saveLinuxDO = async () => {
        const values = await form.validateFields();
        if (values.enabled && !values.clientSecret?.trim() && !linuxdo?.hasClientSecret) {
            message.error(t("admin:enter-the-client-secret-before-enabling-linux-do-sign-in"));
            return;
        }
        setSavingLinuxDO(true);
        try {
            const data = await updateAdminLinuxDOSetting({ ...values, clientSecret: values.clientSecret?.trim() || "" });
            setLinuxdo(data.setting);
            form.setFieldsValue({ ...data.setting, clientSecret: "" });
            message.success(t("admin:linux-do-sign-in-settings-saved"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:failed-to-save-linux-do-settings"));
        } finally {
            setSavingLinuxDO(false);
        }
    };

    return (
        <div className="space-y-4 pt-4">
            <SettingsSectionCard
                icon={<UserPlus className="size-4" />}
                title={t("admin:user-registration")}
                description={t("admin:controls-whether-new-users-can-create-accounts-existing-accounts-are-una")}
                status={{ label: registration?.enabled ? t("admin:open") : t("admin:closed"), color: registration?.enabled ? "success" : "default" }}
            >
                <div className="flex min-h-20 items-center justify-between gap-5 px-5 py-4">
                    <div className="min-w-0">
                        <h3 className="text-sm font-medium">{t("admin:allow-new-user-registration-2")}</h3>
                        <p className="mt-1 text-xs leading-5 text-foreground/55">{t("admin:when-closed-local-sign-up-and-first-time-linux-do-logins-without-a-linke")}</p>
                    </div>
                    <Switch checked={registration?.enabled === true} loading={loading || savingRegistration} onChange={(checked) => void toggleRegistration(checked)} aria-label={t("admin:allow-new-user-registration-2")} />
                </div>
            </SettingsSectionCard>

            <SettingsSectionCard
                icon={<KeyRound className="size-4" />}
                title={t("admin:linux-do-single-sign-on")}
                description={t("admin:connect-linux-do-oauth-so-users-can-sign-in-with-their-community-account")}
                status={{ label: linuxdo?.enabled ? t("admin:running") : t("admin:not-enabled"), color: linuxdo?.enabled ? "success" : "default" }}
                footer={
                    <>
                        <span className="text-xs text-foreground/45">{t("admin:the-client-secret-is-stored-encrypted-and-never-returned-in-plaintext-by")}</span>
                        <Button type="primary" loading={savingLinuxDO} onClick={() => void saveLinuxDO()}>
                            {t("admin:save-sign-in-settings")}
                        </Button>
                    </>
                }
            >
                <Form form={form} layout="vertical" requiredMark={false} disabled={loading}>
                    <div>
                        <div className="grid gap-x-5 gap-y-1 border-b border-border p-5 md:grid-cols-2">
                            <div className="md:col-span-2">
                                <FormSectionTitle icon={<ShieldCheck className="size-4" />} title={t("admin:sign-in-status-and-app-credentials")} />
                            </div>
                            <Form.Item name="enabled" label={t("admin:enable-linux-do-sign-in")} valuePropName="checked" extra={t("admin:once-enabled-the-linux-do-entry-appears-on-the-sign-in-and-registration")}>
                                <Switch />
                            </Form.Item>
                            <Form.Item
                                name="clientAuthMethod"
                                label={t("admin:token-request-auth-method")}
                                rules={[{ required: true, message: t("admin:choose-an-auth-method") }]}
                                extra={t("admin:use-client-secret-post-unless-your-linux-do-app-requires-otherwise")}
                            >
                                <Select
                                    options={[
                                        { label: t("admin:client-secret-post-recommended"), value: "client_secret_post" },
                                        { label: "Client Secret Basic", value: "client_secret_basic" },
                                    ]}
                                />
                            </Form.Item>
                            <Form.Item name="clientId" label="Client ID">
                                <Input autoComplete="off" placeholder={t("admin:client-id-of-the-linux-do-oauth-app")} />
                            </Form.Item>
                            <Form.Item name="clientSecret" label={linuxdo?.hasClientSecret ? `Client Secret（${configuredSecretText}）` : "Client Secret"}>
                                <Input.Password autoComplete="new-password" placeholder={linuxdo?.hasClientSecret ? t("admin:leave-blank-to-keep-current-keys") : t("admin:client-secret-of-the-linux-do-oauth-app")} />
                            </Form.Item>
                        </div>

                        <div className="grid gap-x-5 gap-y-1 border-b border-border p-5 md:grid-cols-2">
                            <div className="md:col-span-2">
                                <FormSectionTitle icon={<LockKeyhole className="size-4" />} title={t("admin:oauth-urls")} />
                            </div>
                            <Form.Item name="authorizationUrl" label={t("admin:authorization-url")}>
                                <Input inputMode="url" placeholder="https://connect.linux.do/oauth2/authorize" />
                            </Form.Item>
                            <Form.Item name="tokenUrl" label={t("admin:token-url")}>
                                <Input inputMode="url" placeholder="https://connect.linux.do/oauth2/token" />
                            </Form.Item>
                            <Form.Item name="userInfoUrl" label={t("admin:user-profile-url")}>
                                <Input inputMode="url" placeholder="https://connect.linux.do/api/user" />
                            </Form.Item>
                            <Form.Item name="redirectUrl" label={t("admin:callback-url-for-this-site")} extra={t("admin:must-exactly-match-the-callback-url-registered-on-the-linux-do-oauth-app")}>
                                <Input inputMode="url" placeholder={t("admin:https-your-domain-oauth-linuxdo-callback")} />
                            </Form.Item>
                            <Form.Item name="scopes" label={t("admin:scopes")} className="md:col-span-2" extra={t("admin:usually-openid-profile-email-match-your-linux-do-app-s-actual-scopes")}>
                                <Select mode="tags" tokenSeparators={[",", " "]} placeholder={t("admin:type-and-press-enter-to-add")} />
                            </Form.Item>
                        </div>

                        <details className="group">
                            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                                <div>
                                    <div className="text-sm font-medium">{t("admin:advanced-linux-do-response-field-mapping")}</div>
                                    <p className="mt-1 text-xs leading-5 text-foreground/55">{t("admin:tell-the-system-which-fields-of-the-linux-do-profile-response-map-to-loc")}</p>
                                </div>
                                <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" />
                            </summary>
                            <div className="grid gap-x-5 gap-y-1 border-t border-border bg-muted/15 p-5 md:grid-cols-2">
                                <Form.Item name="subjectField" label={t("admin:unique-user-id-field")} extra={t("admin:sole-basis-for-account-linking-must-be-stable-long-term-commonly-id-for")}>
                                    <Input placeholder="id" />
                                </Form.Item>
                                <Form.Item name="usernameField" label={t("admin:username-field")} extra={t("admin:used-to-generate-the-local-username-commonly-username-for-linux-do")}>
                                    <Input placeholder="username" />
                                </Form.Item>
                                <Form.Item name="displayNameField" label={t("admin:display-name-field")} extra={t("admin:shown-in-the-user-menu-commonly-name")}>
                                    <Input placeholder="name" />
                                </Form.Item>
                                <Form.Item name="emailField" label={t("admin:email-field")} extra={t("admin:may-be-empty-if-missing-or-invalid-commonly-email")}>
                                    <Input placeholder="email" />
                                </Form.Item>
                                <Form.Item name="avatarField" label={t("admin:avatar-url-field")} extra={t("admin:user-avatar-url-commonly-avatar-url")}>
                                    <Input placeholder="avatar_url" />
                                </Form.Item>
                            </div>
                        </details>
                    </div>
                </Form>
            </SettingsSectionCard>
        </div>
    );
}

function FormSectionTitle({ icon, title }: { icon: ReactNode; title: string }) {
    return (
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground/85">
            {icon}
            {title}
        </div>
    );
}
