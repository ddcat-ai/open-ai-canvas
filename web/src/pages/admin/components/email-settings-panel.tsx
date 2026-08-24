import { useEffect, useState } from "react";
import { App, Button, Form, Input, Select, Space, Switch, Tag } from "antd";
import { MailCheck } from "lucide-react";

import { getAdminEmailSetting, updateAdminEmailSetting, type EmailSetting } from "@/services/api/wallet";
import { AdminStatusBadge, configuredSecretText, SettingsSectionCard } from "./admin-ui";
import { useTranslation } from "react-i18next";

type EmailFormValues = Omit<EmailSetting, "hasPassword" | "updatedAt">;

export default function EmailSettingsPanel() {
    const { t } = useTranslation("canvas");
    const { message } = App.useApp();
    const [setting, setSetting] = useState<EmailSetting | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [form] = Form.useForm<EmailFormValues>();

    useEffect(() => {
        void getAdminEmailSetting()
            .then(({ setting: value }) => {
                setSetting(value);
                form.setFieldsValue({ ...value, password: "" });
            })
            .catch((error) => message.error(error instanceof Error ? error.message : t("admin:failed-to-load-email-settings")))
            .finally(() => setLoading(false));
    }, [form, message]);

    const save = async () => {
        const values = await form.validateFields();
        if (values.enabled && values.username?.trim() && !values.password?.trim() && !setting?.hasPassword) {
            message.error(t("admin:enter-the-password-before-enabling-smtp-sign-in"));
            return;
        }
        setSaving(true);
        try {
            const result = await updateAdminEmailSetting({ ...values, password: values.password?.trim() || "" });
            setSetting(result.setting);
            form.setFieldsValue({ ...result.setting, password: "" });
            message.success(t("admin:registration-email-settings-saved"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:failed-to-save-email-settings"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <SettingsSectionCard
            icon={<MailCheck className="size-4" />}
            title={t("admin:registration-verification-email")}
            status={
                <Space size={6}>
                    <AdminStatusBadge label={setting?.enabled ? t("admin:enabled") : t("admin:not-enabled")} tone={setting?.enabled ? "success" : "neutral"} />
                    {setting?.hasPassword ? <AdminStatusBadge label={configuredSecretText} tone="info" /> : null}
                </Space>
            }
            footer={
                <>
                    <span className="text-xs text-foreground/45">{t("admin:the-smtp-password-is-encrypted-with-the-server-key-and-never-returned-in")}</span>
                    <Button type="primary" loading={saving} onClick={() => void save()}>
                        {t("admin:save-email-settings")}
                    </Button>
                </>
            }
        >
            <Form form={form} layout="vertical" requiredMark={false} disabled={loading}>
                <div className="grid gap-x-5 px-5 pt-5 md:grid-cols-2">
                    <Form.Item name="enabled" label={t("admin:enable-registration-verification-email")} valuePropName="checked" extra={t("admin:with-public-registration-open-standard-email-sign-up-requires-code-verif")}>
                        <Switch />
                    </Form.Item>
                    <Form.Item name="encryption" label={t("admin:connection-encryption")} rules={[{ required: true, message: t("admin:choose-connection-encryption") }]}>
                        <Select
                            options={[
                                { label: t("admin:starttls-recommended-usually-port-587"), value: "starttls" },
                                { label: t("admin:tls-usually-465"), value: "tls" },
                                { label: t("admin:no-encryption"), value: "none" },
                            ]}
                        />
                    </Form.Item>
                    <Form.Item name="host" label={t("admin:smtp-host")}>
                        <Input placeholder="smtp.example.com" />
                    </Form.Item>
                    <Form.Item name="port" label={t("admin:smtp-port")}>
                        <Input type="number" min={1} max={65535} placeholder="587" />
                    </Form.Item>
                    <Form.Item name="username" label={t("admin:smtp-username")}>
                        <Input autoComplete="off" placeholder={t("admin:usually-the-full-email-address")} />
                    </Form.Item>
                    <Form.Item name="password" label={setting?.hasPassword ? t("admin:smtp-password-param", { configuredSecretText: configuredSecretText }) : t("admin:smtp-password")}>
                        <Input.Password autoComplete="new-password" placeholder={setting?.hasPassword ? t("admin:leave-empty-to-keep-the-current-password") : t("admin:smtp-password-or-auth-code")} />
                    </Form.Item>
                    <Form.Item name="fromEmail" label={t("admin:sender-email")} rules={[{ type: "email", message: t("admin:enter-a-valid-sender-email") }]}>
                        <Input placeholder="noreply@example.com" />
                    </Form.Item>
                    <Form.Item name="fromName" label={t("admin:sender-name")}>
                        <Input placeholder={t("admin:yingce-2")} />
                    </Form.Item>
                </div>
            </Form>
        </SettingsSectionCard>
    );
}
