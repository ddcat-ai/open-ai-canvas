import { useCallback, useEffect, useState } from "react";
import { App, Button, Form, Input, InputNumber, Select, Skeleton, Switch } from "antd";
import { Globe2, KeyRound, QrCode, RefreshCw, Save } from "lucide-react";

import {
    getAdminGoogleSetting,
    getAdminWeChatSetting,
    updateAdminGoogleSetting,
    updateAdminWeChatSetting,
    type GoogleSetting,
    type WeChatSetting,
} from "@/services/api/wallet";
import { AdminStatusBadge, configuredSecretText, SettingsSectionCard } from "./admin-ui";

/**
 * 第三方登录配置面板（微信服务号 + Google）。
 *
 * 刻意做成独立组件而不是塞进 access-settings-panel：那个文件已经承载了
 * Linux.do 的脏检查、useBlocker 路由拦截和 beforeunload，再叠加两套表单会让
 * 「离开页面时是否有未保存改动」的判断变得不可维护。
 */
export default function ThirdPartyLoginPanel() {
    const { message } = App.useApp();
    const [wechat, setWechat] = useState<WeChatSetting | null>(null);
    const [google, setGoogle] = useState<GoogleSetting | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [savingWeChat, setSavingWeChat] = useState(false);
    const [savingGoogle, setSavingGoogle] = useState(false);
    const [loadError, setLoadError] = useState("");
    const [wechatForm] = Form.useForm<WeChatSetting>();
    const [googleForm] = Form.useForm<GoogleSetting>();
    const [wechatEnabled, setWechatEnabled] = useState(false);
    const [googleEnabled, setGoogleEnabled] = useState(false);

    const load = useCallback(
        async (initial = false) => {
            if (initial) setLoading(true);
            else setRefreshing(true);
            setLoadError("");
            try {
                const [wechatData, googleData] = await Promise.all([getAdminWeChatSetting(), getAdminGoogleSetting()]);
                setWechat(wechatData.setting);
                setGoogle(googleData.setting);
                setWechatEnabled(wechatData.setting.enabled);
                setGoogleEnabled(googleData.setting.enabled);
            } catch (error) {
                setLoadError(error instanceof Error ? error.message : "读取第三方登录配置失败");
            } finally {
                setLoading(false);
                setRefreshing(false);
            }
        },
        [],
    );

    useEffect(() => {
        void load(true);
    }, [load]);

    useEffect(() => {
        if (!wechat || !google) return;
        wechatForm.setFieldsValue({ ...wechat, appSecret: "" });
        googleForm.setFieldsValue({ ...google, clientSecret: "" });
    }, [wechat, google, wechatForm, googleForm]);

    const saveWeChat = async () => {
        const values = await wechatForm.validateFields();
        setSavingWeChat(true);
        try {
            const result = await updateAdminWeChatSetting({
                ...values,
                enabled: wechatEnabled,
                // 留空表示沿用已保存的密钥。
                appSecret: values.appSecret?.trim() || undefined,
            });
            setWechat(result.setting);
            setWechatEnabled(result.setting.enabled);
            wechatForm.setFieldsValue({ ...result.setting, appSecret: "" });
            message.success("微信登录配置已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存微信配置失败");
        } finally {
            setSavingWeChat(false);
        }
    };

    const saveGoogle = async () => {
        const values = await googleForm.validateFields();
        setSavingGoogle(true);
        try {
            const result = await updateAdminGoogleSetting({
                ...values,
                enabled: googleEnabled,
                clientSecret: values.clientSecret?.trim() || undefined,
            });
            setGoogle(result.setting);
            setGoogleEnabled(result.setting.enabled);
            googleForm.setFieldsValue({ ...result.setting, clientSecret: "" });
            message.success("Google 登录配置已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存 Google 配置失败");
        } finally {
            setSavingGoogle(false);
        }
    };

    if (loading && (!wechat || !google)) {
        return (
            <div className="admin-settings-stack">
                <div className="rounded-xl border border-border bg-card p-6">
                    <Skeleton active paragraph={{ rows: 6 }} />
                </div>
            </div>
        );
    }

    if (!wechat || !google) {
        return (
            <div className="admin-settings-stack">
                <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-5">
                    <div className="flex-1">
                        <h2 className="text-sm font-semibold">无法读取第三方登录配置</h2>
                        <p className="mt-1 text-xs text-muted-foreground">{loadError || "请稍后重试"}</p>
                    </div>
                    <Button icon={<RefreshCw className="size-4" />} loading={refreshing} onClick={() => void load(false)}>
                        重新读取
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="admin-settings-stack">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-5 py-4">
                <div>
                    <strong className="text-sm">第三方登录</strong>
                    <p className="mt-1 text-xs text-muted-foreground">
                        微信 {wechat.enabled ? "已启用" : "未启用"} · Google {google.enabled ? "已启用" : "未启用"}
                    </p>
                </div>
                <Button icon={<RefreshCw className="size-4" />} loading={refreshing} onClick={() => void load(false)}>
                    刷新状态
                </Button>
            </div>

            {loadError ? (
                <div className="rounded-lg border border-amber-300/40 bg-amber-300/10 px-4 py-3 text-xs text-amber-900 dark:text-amber-100">{loadError}。页面仍显示上一次成功读取的配置。</div>
            ) : null}

            <SettingsSectionCard
                icon={<QrCode className="size-4" aria-hidden="true" />}
                title="微信服务号扫码登录"
                description="用户扫码关注服务号后自动登录。需要认证服务号，且公众平台「生成带参数的二维码」接口权限为「有」。"
                status={<AdminStatusBadge label={wechatEnabled ? "已启用" : "未启用"} tone={wechatEnabled ? "success" : "neutral"} />}
                footer={
                    <div className="flex justify-end">
                        <Button type="primary" icon={<Save className="size-4" />} loading={savingWeChat} onClick={() => void saveWeChat()}>
                            保存微信配置
                        </Button>
                    </div>
                }
            >
                <Form form={wechatForm} layout="vertical" requiredMark={false}>
                    <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
                        <div>
                            <strong className="text-sm">启用微信登录</strong>
                            <p className="mt-1 text-xs text-muted-foreground">关闭后登录页隐藏入口，已绑定账号不受影响。</p>
                        </div>
                        <Switch checked={wechatEnabled} onChange={setWechatEnabled} aria-label="启用微信登录" />
                    </div>

                    <Form.Item name="appId" label="AppID">
                        <Input autoComplete="off" placeholder="wx 开头，公众平台「基本配置」中获取" />
                    </Form.Item>
                    <Form.Item name="appSecret" label={wechat.hasAppSecret ? `AppSecret（${configuredSecretText}）` : "AppSecret"}>
                        <Input.Password autoComplete="new-password" placeholder={wechat.hasAppSecret ? "留空保留原密钥" : "公众平台「基本配置」中获取"} />
                    </Form.Item>
                    <Form.Item name="token" label="服务器配置 Token" extra="必须与公众平台「服务器配置」里填的 Token 完全一致，否则事件推送验签失败。">
                        <Input autoComplete="off" placeholder="自定义随机串，最长 32 位" />
                    </Form.Item>
                    <Form.Item name="encryptMode" label="消息加解密方式" extra="先选「明文模式」跑通；安全/兼容模式需要额外填写 EncodingAESKey。">
                        <Select
                            options={[
                                { label: "明文模式（推荐先用）", value: "plain" },
                                { label: "兼容模式", value: "compatible" },
                                { label: "安全模式", value: "safe" },
                            ]}
                        />
                    </Form.Item>
                    <Form.Item name="encodingAesKey" label="EncodingAESKey" extra="仅兼容/安全模式需要，43 位。">
                        <Input autoComplete="off" placeholder="43 位字符串" />
                    </Form.Item>
                    <Form.Item name="qrExpireSecs" label="二维码有效期（秒）" extra="默认 300 秒，范围 60–2592000。">
                        <InputNumber min={60} max={2592000} style={{ width: "100%" }} />
                    </Form.Item>
                    <Form.Item label="需要登记到公众平台的服务器地址">
                        <Input readOnly value={wechat.callbackUrl} />
                    </Form.Item>
                    <p className="text-xs leading-5 text-muted-foreground">
                        顺序很重要：先确认上面这个地址可以访问（GET 请求返回 echostr 原文），再去公众平台点「提交」。否则保存会失败，且该公众号现有的自动回复和自定义菜单会被接管。
                    </p>
                </Form>
            </SettingsSectionCard>

            <SettingsSectionCard
                icon={<Globe2 className="size-4" aria-hidden="true" />}
                title="Google 登录"
                description="标准 OAuth 2.0 授权码流程。需要在 Google Cloud Console 创建 OAuth 客户端并登记回调地址。"
                status={<AdminStatusBadge label={googleEnabled ? "已启用" : "未启用"} tone={googleEnabled ? "success" : "neutral"} />}
                footer={
                    <div className="flex justify-end">
                        <Button type="primary" icon={<Save className="size-4" />} loading={savingGoogle} onClick={() => void saveGoogle()}>
                            保存 Google 配置
                        </Button>
                    </div>
                }
            >
                <Form form={googleForm} layout="vertical" requiredMark={false}>
                    <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
                        <div>
                            <strong className="text-sm">启用 Google 登录</strong>
                            <p className="mt-1 text-xs text-muted-foreground">国内网络访问 accounts.google.com 可能不稳定，建议同时保留其他登录方式。</p>
                        </div>
                        <Switch checked={googleEnabled} onChange={setGoogleEnabled} aria-label="启用 Google 登录" />
                    </div>

                    <Form.Item name="clientId" label="Client ID">
                        <Input autoComplete="off" placeholder="xxx.apps.googleusercontent.com" />
                    </Form.Item>
                    <Form.Item name="clientSecret" label={google.hasClientSecret ? `Client Secret（${configuredSecretText}）` : "Client Secret"}>
                        <Input.Password autoComplete="new-password" placeholder={google.hasClientSecret ? "留空保留原密钥" : "Google Cloud Console 中获取"} />
                    </Form.Item>
                    <Form.Item name="redirectUrl" label="授权回调地址" extra="必须与 Google Cloud Console 里登记的值完全一致，使用 HTTPS。">
                        <Input inputMode="url" placeholder="https://你的域名/api/auth/google/callback" />
                    </Form.Item>
                    <Form.Item name="hostedDomain" label="限定 Workspace 域名（可选）" extra="填写后只允许该 Google Workspace 域下的账号登录。">
                        <Input autoComplete="off" placeholder="example.com" />
                    </Form.Item>
                    <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3">
                        <KeyRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <p className="text-xs leading-5 text-muted-foreground">
                            服务端会校验 id_token 的签名、签发方、受众、有效期和 email_verified，不依赖前端传入的身份信息。
                        </p>
                    </div>
                </Form>
            </SettingsSectionCard>
        </div>
    );
}
