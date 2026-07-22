import { useEffect, useState } from "react";
import { App, Button, Form, Input, Select, Space, Switch, Tag } from "antd";
import { MailCheck } from "lucide-react";

import { getAdminEmailSetting, updateAdminEmailSetting, type EmailSetting } from "@/services/api/wallet";
import { configuredSecretText, SettingsSectionCard } from "./admin-ui";

type EmailFormValues = Omit<EmailSetting, "hasPassword" | "updatedAt">;

export default function EmailSettingsPanel() {
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
            .catch((error) => message.error(error instanceof Error ? error.message : "读取邮件配置失败"))
            .finally(() => setLoading(false));
    }, [form, message]);

    const save = async () => {
        const values = await form.validateFields();
        if (values.enabled && values.username?.trim() && !values.password?.trim() && !setting?.hasPassword) {
            message.error("启用 SMTP 登录前请填写密码");
            return;
        }
        setSaving(true);
        try {
            const result = await updateAdminEmailSetting({ ...values, password: values.password?.trim() || "" });
            setSetting(result.setting);
            form.setFieldsValue({ ...result.setting, password: "" });
            message.success("注册邮件配置已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存邮件配置失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <SettingsSectionCard
            icon={<MailCheck className="size-4" />}
            title="注册验证邮件"
            description="通过 SMTP 发送普通用户注册验证码。"
            status={<Space size={6}><Tag bordered={false} color={setting?.enabled ? "success" : "default"}>{setting?.enabled ? "已启用" : "未启用"}</Tag>{setting?.hasPassword ? <Tag bordered={false} color="blue">{configuredSecretText}</Tag> : null}</Space>}
            footer={<><span className="text-xs text-foreground/45">SMTP 密码使用服务端密钥加密，接口不回显明文。</span><Button type="primary" loading={saving} onClick={() => void save()}>保存邮件配置</Button></>}
        >
            <Form form={form} layout="vertical" requiredMark={false} disabled={loading}>
                <div className="grid gap-x-5 px-5 pt-5 md:grid-cols-2">
                    <Form.Item name="enabled" label="启用注册验证邮件" valuePropName="checked" extra="公开注册开启后，普通邮箱注册必须完成验证码校验。"><Switch /></Form.Item>
                    <Form.Item name="encryption" label="连接加密" rules={[{ required: true, message: "请选择连接加密方式" }]}><Select options={[{ label: "STARTTLS（推荐，通常 587）", value: "starttls" }, { label: "TLS（通常 465）", value: "tls" }, { label: "无加密", value: "none" }]} /></Form.Item>
                    <Form.Item name="host" label="SMTP 主机"><Input placeholder="smtp.example.com" /></Form.Item>
                    <Form.Item name="port" label="SMTP 端口"><Input type="number" min={1} max={65535} placeholder="587" /></Form.Item>
                    <Form.Item name="username" label="SMTP 用户名"><Input autoComplete="off" placeholder="通常为完整邮箱地址" /></Form.Item>
                    <Form.Item name="password" label={setting?.hasPassword ? `SMTP 密码（${configuredSecretText}）` : "SMTP 密码"}><Input.Password autoComplete="new-password" placeholder={setting?.hasPassword ? "留空保留原密码" : "SMTP 密码或授权码"} /></Form.Item>
                    <Form.Item name="fromEmail" label="发件邮箱" rules={[{ type: "email", message: "请输入有效的发件邮箱" }]}><Input placeholder="noreply@example.com" /></Form.Item>
                    <Form.Item name="fromName" label="发件人名称"><Input placeholder="无限画布" /></Form.Item>
                </div>
            </Form>
        </SettingsSectionCard>
    );
}
