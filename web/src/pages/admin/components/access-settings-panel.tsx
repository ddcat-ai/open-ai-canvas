import { useEffect, useState, type ReactNode } from "react";
import { App, Button, Form, Input, Select, Switch } from "antd";
import { ChevronDown, KeyRound, LockKeyhole, ShieldCheck, UserPlus } from "lucide-react";

import {
    getAdminLinuxDOSetting,
    getAdminRegistrationSetting,
    updateAdminLinuxDOSetting,
    updateAdminRegistrationSetting,
    type LinuxDOSetting,
    type RegistrationSetting,
} from "@/services/api/wallet";
import { configuredSecretText, SettingsSectionCard } from "./admin-ui";

type LinuxDOFormValues = Omit<LinuxDOSetting, "hasClientSecret" | "updatedAt">;

export default function AccessSettingsPanel() {
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
            .catch((error) => message.error(error instanceof Error ? error.message : "读取登录配置失败"))
            .finally(() => setLoading(false));
    }, [form, message]);

    const toggleRegistration = async (enabled: boolean) => {
        setSavingRegistration(true);
        try {
            const data = await updateAdminRegistrationSetting(enabled);
            setRegistration(data.setting);
            message.success(enabled ? "用户注册已开启" : "用户注册已关闭");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "更新注册设置失败");
        } finally {
            setSavingRegistration(false);
        }
    };

    const saveLinuxDO = async () => {
        const values = await form.validateFields();
        if (values.enabled && !values.clientSecret?.trim() && !linuxdo?.hasClientSecret) {
            message.error("启用 Linux.do 登录前请填写 Client Secret");
            return;
        }
        setSavingLinuxDO(true);
        try {
            const data = await updateAdminLinuxDOSetting({ ...values, clientSecret: values.clientSecret?.trim() || "" });
            setLinuxdo(data.setting);
            form.setFieldsValue({ ...data.setting, clientSecret: "" });
            message.success("Linux.do 登录配置已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存 Linux.do 配置失败");
        } finally {
            setSavingLinuxDO(false);
        }
    };


    return (
        <div className="mx-auto max-w-5xl space-y-5">
            <SettingsSectionCard
                icon={<UserPlus className="size-4" />}
                title="用户注册"
                description="控制新用户能否创建账号，不影响已有账号登录。"
                status={{ label: registration?.enabled ? "已开放" : "已关闭", color: registration?.enabled ? "success" : "default" }}
            >
                <div className="flex min-h-20 items-center justify-between gap-5 px-5 py-4">
                    <div className="min-w-0">
                        <h3 className="text-sm font-medium">开放新用户注册</h3>
                        <p className="mt-1 text-xs leading-5 text-foreground/55">关闭后，本地注册和未绑定账号的 Linux.do 首次登录都会被拒绝。</p>
                    </div>
                    <Switch checked={registration?.enabled === true} loading={loading || savingRegistration} onChange={(checked) => void toggleRegistration(checked)} aria-label="开放新用户注册" />
                </div>
            </SettingsSectionCard>

            <SettingsSectionCard
                icon={<KeyRound className="size-4" />}
                title="Linux.do 单点登录"
                description="连接 Linux.do OAuth，让用户使用社区账号登录。"
                status={{ label: linuxdo?.enabled ? "运行中" : "未启用", color: linuxdo?.enabled ? "success" : "default" }}
                footer={<><span className="text-xs text-foreground/45">Client Secret 加密保存，接口不会回显明文。</span><Button type="primary" loading={savingLinuxDO} onClick={() => void saveLinuxDO()}>保存登录配置</Button></>}
            >
                <Form form={form} layout="vertical" requiredMark={false} disabled={loading}>
                    <div>
                        <div className="grid gap-x-5 gap-y-1 border-b border-border p-5 md:grid-cols-2">
                            <div className="md:col-span-2">
                                <FormSectionTitle icon={<ShieldCheck className="size-4" />} title="登录状态与应用凭据" />
                            </div>
                            <Form.Item name="enabled" label="启用 Linux.do 登录" valuePropName="checked" extra="启用后，登录与注册页面会显示 Linux.do 入口。">
                                <Switch />
                            </Form.Item>
                            <Form.Item name="clientAuthMethod" label="Token 请求鉴权方式" rules={[{ required: true, message: "请选择鉴权方式" }]} extra="Linux.do 应用未特别要求时使用 Client Secret Post。">
                                <Select options={[{ label: "Client Secret Post（推荐）", value: "client_secret_post" }, { label: "Client Secret Basic", value: "client_secret_basic" }]} />
                            </Form.Item>
                            <Form.Item name="clientId" label="Client ID">
                                <Input autoComplete="off" placeholder="Linux.do OAuth 应用的 Client ID" />
                            </Form.Item>
                            <Form.Item name="clientSecret" label={linuxdo?.hasClientSecret ? `Client Secret（${configuredSecretText}）` : "Client Secret"}>
                                <Input.Password autoComplete="new-password" placeholder={linuxdo?.hasClientSecret ? "留空保留原密钥" : "Linux.do OAuth 应用的 Client Secret"} />
                            </Form.Item>
                        </div>

                        <div className="grid gap-x-5 gap-y-1 border-b border-border p-5 md:grid-cols-2">
                            <div className="md:col-span-2">
                                <FormSectionTitle icon={<LockKeyhole className="size-4" />} title="OAuth 地址" />
                            </div>
                            <Form.Item name="authorizationUrl" label="授权地址">
                                <Input inputMode="url" placeholder="https://connect.linux.do/oauth2/authorize" />
                            </Form.Item>
                            <Form.Item name="tokenUrl" label="Token 地址">
                                <Input inputMode="url" placeholder="https://connect.linux.do/oauth2/token" />
                            </Form.Item>
                            <Form.Item name="userInfoUrl" label="用户资料地址">
                                <Input inputMode="url" placeholder="https://connect.linux.do/api/user" />
                            </Form.Item>
                            <Form.Item name="redirectUrl" label="本站回调地址" extra="此地址必须与 Linux.do OAuth 应用中登记的回调地址完全一致；推荐使用 /oauth/linuxdo/callback。">
                                <Input inputMode="url" placeholder="https://你的域名/oauth/linuxdo/callback" />
                            </Form.Item>
                            <Form.Item name="scopes" label="授权范围（Scopes）" className="md:col-span-2" extra="通常使用 openid、profile、email；按 Linux.do 应用实际授权范围填写。">
                                <Select mode="tags" tokenSeparators={[",", " "]} placeholder="输入后按回车添加" />
                            </Form.Item>
                        </div>

                        <details className="group">
                            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                                <div>
                                    <div className="text-sm font-medium">高级：Linux.do 返回字段对应关系</div>
                                    <p className="mt-1 text-xs leading-5 text-foreground/55">告诉系统从 Linux.do 用户资料响应的哪些字段读取本地账号信息，支持 `data.user.id` 这类嵌套路径。</p>
                                </div>
                                <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" />
                            </summary>
                            <div className="grid gap-x-5 gap-y-1 border-t border-border bg-muted/15 p-5 md:grid-cols-2">
                                <Form.Item name="subjectField" label="唯一用户 ID 字段" extra="账号绑定的唯一依据，必须长期稳定。Linux.do 常见值为 id。">
                                    <Input placeholder="id" />
                                </Form.Item>
                                <Form.Item name="usernameField" label="用户名字段" extra="用于生成本站用户名。Linux.do 常见值为 username。">
                                    <Input placeholder="username" />
                                </Form.Item>
                                <Form.Item name="displayNameField" label="显示名称字段" extra="显示在用户菜单中的名称，常见值为 name。">
                                    <Input placeholder="name" />
                                </Form.Item>
                                <Form.Item name="emailField" label="邮箱字段" extra="没有或无效时允许留空，常见值为 email。">
                                    <Input placeholder="email" />
                                </Form.Item>
                                <Form.Item name="avatarField" label="头像地址字段" extra="用户头像 URL，常见值为 avatar_url。">
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
    return <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground/85">{icon}{title}</div>;
}
