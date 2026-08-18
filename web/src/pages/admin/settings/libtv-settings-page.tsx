import { App, Button, Input, Popconfirm, Switch } from "antd";
import { KeyRound, Save, Trash2, Wifi } from "lucide-react";
import { useEffect, useState } from "react";

import { getAdminLibTVSetting, testAdminLibTV, updateAdminLibTVSetting, type AdminLibTVSetting } from "@/services/api/libtv";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminStatusBadge, SettingsSectionCard } from "../components/admin-ui";

export default function LibTVSettingsPage() {
    const { message } = App.useApp();
    const [setting, setSetting] = useState<AdminLibTVSetting>({ enabled: false, hasToken: false });
    const [enabled, setEnabled] = useState(false);
    const [token, setToken] = useState("");
    const [testUuid, setTestUuid] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [clearing, setClearing] = useState(false);
    const [testing, setTesting] = useState(false);

    useEffect(() => {
        let cancelled = false;
        void getAdminLibTVSetting()
            .then(({ setting: next }) => {
                if (cancelled) return;
                setSetting(next);
                setEnabled(next.enabled);
            })
            .catch((error) => {
                if (!cancelled) message.error(error instanceof Error ? error.message : "读取 LibTV 配置失败");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [message]);

    const save = async () => {
        setSaving(true);
        try {
            const { setting: next } = await updateAdminLibTVSetting({ enabled, token: token.trim() || undefined });
            setSetting(next);
            setToken("");
            setEnabled(next.enabled);
            message.success("LibTV 配置已更新");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存 LibTV 配置失败");
        } finally {
            setSaving(false);
        }
    };

    const clearToken = async () => {
        setClearing(true);
        try {
            const { setting: next } = await updateAdminLibTVSetting({ enabled: false, clearToken: true });
            setSetting(next);
            setToken("");
            setEnabled(false);
            message.success("LibTV Token 已清空，导入功能已停用");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "清空 LibTV Token 失败");
        } finally {
            setClearing(false);
        }
    };

    const test = async () => {
        if (!testUuid.trim()) {
            message.error("请填写用于测试的 LibTV 画布 UUID");
            return;
        }
        setTesting(true);
        try {
            await testAdminLibTV(testUuid.trim());
            message.success("LibTV 连接测试成功");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "LibTV 连接测试失败");
        } finally {
            setTesting(false);
        }
    };

    return (
        <AdminPageFrame title="第三方参数配置" description="集中维护外部平台的服务端凭证和连接状态，后续平台可在此继续扩展。">
            <div className="pt-4">
                <SettingsSectionCard
                    icon={<KeyRound className="size-4" />}
                    title="LibTV 配置"
                    description="Token 仅保存在服务端加密配置中，不会回传到浏览器。"
                    status={<AdminStatusBadge label={setting.hasToken ? "已配置" : "未配置"} tone={setting.hasToken ? "success" : "warning"} />}
                    footer={
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <span className="text-xs text-foreground/50">{setting.hasToken ? "已保存 Token；输入新值可替换，留空保存会保留现有 Token。" : "请先配置 Token，再启用导入功能。"}</span>
                            <div className="flex items-center gap-2">
                                {setting.hasToken ? (
                                    <Popconfirm title="确认清空 LibTV Token？" description="清空后将同时停用 LibTV 画布导入。" okText="清空" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={clearToken}>
                                        <Button danger icon={<Trash2 className="size-4" />} loading={clearing} disabled={loading || saving}>
                                            清空 Token
                                        </Button>
                                    </Popconfirm>
                                ) : null}
                                <Button type="primary" icon={<Save className="size-4" />} loading={saving} disabled={loading || clearing} onClick={() => void save()}>
                                    保存配置
                                </Button>
                            </div>
                        </div>
                    }
                >
                    <div className="space-y-5 px-4 py-4">
                        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
                            <div>
                                <label className="mb-2 block text-sm font-medium">LibTV Token</label>
                                <Input.Password value={token} onChange={(event) => setToken(event.target.value)} placeholder={setting.hasToken ? "已配置（输入新 Token 可替换）" : "输入 LibTV Token"} disabled={loading || saving || clearing} autoComplete="new-password" />
                            </div>
                            <div>
                                <label className="mb-2 block text-sm font-medium">启用导入</label>
                                <div className="flex h-8 items-center gap-3">
                                    <Switch checked={enabled} onChange={setEnabled} disabled={loading || saving || clearing} />
                                    <span className="text-sm text-foreground/60">{enabled ? "已启用" : "已停用"}</span>
                                </div>
                            </div>
                        </div>
                        <div>
                            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                                <Wifi className="size-4" />
                                测试连接
                            </div>
                            <div className="flex flex-wrap gap-3">
                                <Input className="min-w-64 flex-1" value={testUuid} onChange={(event) => setTestUuid(event.target.value)} placeholder="输入可访问的 LibTV 画布 UUID" />
                                <Button loading={testing} onClick={() => void test()}>
                                    测试连接
                                </Button>
                            </div>
                            <div className="mt-2 text-xs text-foreground/50">用于验证当前 Token 是否可读取指定 LibTV 画布，不会向当前画布写入节点。</div>
                        </div>
                    </div>
                </SettingsSectionCard>
            </div>
        </AdminPageFrame>
    );
}
