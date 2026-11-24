import { App, Button, Form, Input } from "antd";
import { MessageCircle, RefreshCw, RotateCcw, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { Switch } from "@/pages/admin/ui/controls";
import { updateAdminWechatSetting, type WechatSetting, type WechatSettingDraft } from "@/services/api/wechat";
import { useAuthSettingsStore } from "@/stores/use-auth-settings-store";
import { AdminStatusBadge, configuredSecretText, SettingsSectionCard } from "./admin-ui";

type Props = {
    setting: WechatSetting;
    refreshing: boolean;
    onSaved: (setting: WechatSetting) => void;
    onDirtyChange: (dirty: boolean) => void;
    onSavingChange: (saving: boolean) => void;
    onRefresh: () => void;
};

const draftFrom = (setting: WechatSetting): WechatSettingDraft => ({ enabled: setting.enabled, appId: setting.appId, appSecret: "", redirectUrl: setting.redirectUrl });

export function WechatSettingsSection({ setting, refreshing, onSaved, onDirtyChange, onSavingChange, onRefresh }: Props) {
    const { message } = App.useApp();
    const [form] = Form.useForm<WechatSettingDraft>();
    const [enabled, setEnabled] = useState(setting.enabled);
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    useEffect(() => {
        form.setFieldsValue(draftFrom(setting));
        setEnabled(setting.enabled);
        setDirty(false);
        setError("");
        onDirtyChange(false);
    }, [setting, form, onDirtyChange]);
    const markDirty = () => {
        const values = form.getFieldsValue(true);
        const changed = values.enabled !== setting.enabled || values.appId.trim() !== setting.appId || values.redirectUrl.trim() !== setting.redirectUrl || Boolean(values.appSecret.trim());
        setEnabled(values.enabled);
        setDirty(changed);
        onDirtyChange(changed);
        setError("");
    };
    const reset = () => {
        form.setFieldsValue(draftFrom(setting));
        form.setFields([]);
        setEnabled(setting.enabled);
        setDirty(false);
        onDirtyChange(false);
        setError("");
    };
    const save = async () => {
        if (saving) return;
        const values = form.getFieldsValue(true);
        const draft = { ...values, appId: values.appId.trim(), appSecret: values.appSecret.trim(), redirectUrl: values.redirectUrl.trim() };
        if (draft.enabled && (!draft.appId || (!draft.appSecret && !setting.hasAppSecret) || !draft.redirectUrl)) {
            setError("启用前请填写网站应用的 AppID、AppSecret 和 HTTPS 回调地址。");
            return;
        }
        setSaving(true);
        onSavingChange(true);
        setError("");
        try {
            const { setting: saved } = await updateAdminWechatSetting(draft);
            if (saved.enabled !== draft.enabled || saved.appId !== draft.appId || saved.redirectUrl !== draft.redirectUrl || (saved.enabled && !saved.hasAppSecret)) throw new Error("服务端返回的微信配置与本次保存不一致");
            onSaved(saved);
            await useAuthSettingsStore.getState().load({ maxAgeMs: 0 });
            message.success("微信登录配置已保存");
        } catch (cause) {
            setError(`${cause instanceof Error ? cause.message : "保存失败"}。请重新读取当前配置后再决定是否保存。`);
        } finally {
            setSaving(false);
            onSavingChange(false);
        }
    };
    return (
        <div id="admin-access-wechat" className="admin-settings-anchor">
            <SettingsSectionCard
                className="admin-access-section admin-access-wechat-section"
                icon={<MessageCircle className="size-4" aria-hidden="true" />}
                title="3. 是否开放微信登录"
                description="使用微信开放平台的网站应用，支持扫码与桌面微信快速确认。"
                status={<AdminStatusBadge label={dirty ? (enabled ? "待启用" : "待停用") : setting.enabled ? "运行中" : "未启用"} tone={dirty ? "warning" : setting.enabled ? "success" : "neutral"} />}
                footer={
                    <>
                        <span className="admin-access-footer-note">保存后生效 · 首次使用遵循本站注册与验证策略</span>
                        <div className="flex flex-wrap items-center gap-2">
                            <Button icon={<RefreshCw className="size-4" />} disabled={saving || refreshing} onClick={onRefresh}>
                                重新读取
                            </Button>
                            {dirty ? (
                                <Button icon={<RotateCcw className="size-4" />} disabled={saving || refreshing} onClick={reset}>
                                    撤销
                                </Button>
                            ) : null}
                            <Button type="primary" icon={<Save className="size-4" />} disabled={!dirty || refreshing} loading={saving} onClick={() => void save()}>
                                {enabled ? "保存并启用" : "保存并关闭"}
                            </Button>
                        </div>
                    </>
                }
            >
                {error ? (
                    <div className="admin-access-inline-alert" role="alert">
                        {error}
                    </div>
                ) : null}
                <Form form={form} layout="vertical" requiredMark={false} initialValues={draftFrom(setting)} disabled={saving || refreshing} onValuesChange={markDirty}>
                    <div className="admin-access-provider-toggle">
                        <span className="admin-access-policy-icon">
                            <MessageCircle className="size-5" aria-hidden="true" />
                        </span>
                        <div className="admin-access-policy-copy">
                            <strong>在登录与注册页显示微信</strong>
                            <p>已有账号可在个人设置中绑定微信，继续使用原有项目与余额。</p>
                        </div>
                        <Form.Item noStyle name="enabled" valuePropName="checked">
                            <Switch aria-label="在登录与注册页显示微信" />
                        </Form.Item>
                    </div>
                    <div className="admin-access-form-section">
                        <div className="admin-access-form-grid is-credentials">
                            <Form.Item name="appId" label="AppID（网站应用）" extra="更换 AppID 会改变身份范围，已有绑定需要规划迁移。">
                                <Input autoComplete="off" placeholder="微信开放平台的网站应用 AppID" />
                            </Form.Item>
                            <Form.Item name="appSecret" label={`AppSecret${setting.hasAppSecret ? `（${configuredSecretText}）` : ""}`}>
                                <Input.Password autoComplete="new-password" placeholder={setting.hasAppSecret ? "留空保留原密钥" : "仅在服务端加密保存"} />
                            </Form.Item>
                            <Form.Item name="redirectUrl" label="本站回调地址" className="admin-access-form-span-full" extra="必须使用 HTTPS；回调域名须与微信开放平台审核配置一致。">
                                <Input inputMode="url" placeholder="https://你的域名/api/auth/wechat/callback" />
                            </Form.Item>
                        </div>
                        <p className="admin-access-footer-note">需先通过网站应用与微信登录权限审核。微信内公众号网页授权需另行接入。</p>
                    </div>
                </Form>
            </SettingsSectionCard>
        </div>
    );
}
