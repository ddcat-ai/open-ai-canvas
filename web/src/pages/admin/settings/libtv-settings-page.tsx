import { App, Button, Input, Popconfirm, Switch } from "antd";
import { KeyRound, Save, Trash2, Wifi } from "lucide-react";
import { useEffect, useState } from "react";

import { getAdminLibTVSetting, testAdminLibTV, updateAdminLibTVSetting, type AdminLibTVSetting } from "@/services/api/libtv";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminStatusBadge, SettingsSectionCard } from "../components/admin-ui";
import { useTranslation } from "react-i18next";

export default function LibTVSettingsPage() {
    const { t } = useTranslation("canvas");
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
                if (!cancelled) message.error(error instanceof Error ? error.message : t("admin:failed-to-read-libtv-config"));
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
            message.success(t("admin:libtv-config-updated"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:failed-to-save-libtv-config"));
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
            message.success(t("admin:libtv-token-cleared-import-disabled"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:failed-to-clear-libtv-token"));
        } finally {
            setClearing(false);
        }
    };

    const test = async () => {
        if (!testUuid.trim()) {
            message.error(t("admin:enter-a-libtv-canvas-uuid-for-testing"));
            return;
        }
        setTesting(true);
        try {
            await testAdminLibTV(testUuid.trim());
            message.success(t("admin:libtv-connection-test-succeeded"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:libtv-connection-test-failed"));
        } finally {
            setTesting(false);
        }
    };

    return (
        <AdminPageFrame title={t("admin:third-party-parameters")} description={t("admin:centrally-manage-server-side-credentials-and-connection-status-for-exter")} scroll>
            <div className="pt-4">
                <SettingsSectionCard
                    icon={<KeyRound className="size-4" />}
                    title={t("admin:libtv-config")}
                    description={t("admin:the-token-is-stored-only-in-encrypted-server-config-and-never-sent-back")}
                    status={<AdminStatusBadge label={setting.hasToken ? t("admin:configured") : t("admin:not-configured-2")} tone={setting.hasToken ? "success" : "warning"} />}
                    footer={
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <span className="text-xs text-foreground/50">{setting.hasToken ? t("admin:token-saved-enter-a-new-value-to-replace-it-saving-empty-keeps-the-exist") : t("admin:configure-the-token-before-enabling-import")}</span>
                            <div className="flex items-center gap-2">
                                {setting.hasToken ? (
                                    <Popconfirm
                                        title={t("admin:clear-the-libtv-token")}
                                        description={t("admin:clearing-also-disables-libtv-canvas-import")}
                                        okText={t("admin:clear")}
                                        cancelText={t("admin:cancel-4")}
                                        okButtonProps={{ danger: true }}
                                        onConfirm={clearToken}
                                    >
                                        <Button danger icon={<Trash2 className="size-4" />} loading={clearing} disabled={loading || saving}>
                                            {t("admin:clear-token")}
                                        </Button>
                                    </Popconfirm>
                                ) : null}
                                <Button type="primary" icon={<Save className="size-4" />} loading={saving} disabled={loading || clearing} onClick={() => void save()}>
                                    {t("admin:save-config-5")}
                                </Button>
                            </div>
                        </div>
                    }
                >
                    <div className="space-y-5 px-4 py-4">
                        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
                            <div>
                                <label className="mb-2 block text-sm font-medium">LibTV Token</label>
                                <Input.Password
                                    value={token}
                                    onChange={(event) => setToken(event.target.value)}
                                    placeholder={setting.hasToken ? t("admin:configured-enter-a-new-token-to-replace") : t("admin:enter-libtv-token")}
                                    disabled={loading || saving || clearing}
                                    autoComplete="new-password"
                                />
                            </div>
                            <div>
                                <label className="mb-2 block text-sm font-medium">{t("admin:enable-import")}</label>
                                <div className="flex h-8 items-center gap-3">
                                    <Switch checked={enabled} onChange={setEnabled} disabled={loading || saving || clearing} />
                                    <span className="text-sm text-foreground/60">{enabled ? t("admin:enabled") : t("admin:disabled")}</span>
                                </div>
                            </div>
                        </div>
                        <div>
                            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                                <Wifi className="size-4" />
                                {t("admin:test-connection-2")}
                            </div>
                            <div className="flex flex-wrap gap-3">
                                <Input className="min-w-64 flex-1" value={testUuid} onChange={(event) => setTestUuid(event.target.value)} placeholder={t("admin:enter-an-accessible-libtv-canvas-uuid")} />
                                <Button loading={testing} onClick={() => void test()}>
                                    {t("admin:test-connection-2")}
                                </Button>
                            </div>
                            <div className="mt-2 text-xs text-foreground/50">{t("admin:verifies-the-current-token-can-read-the-given-libtv-canvas-no-nodes-are")}</div>
                        </div>
                    </div>
                </SettingsSectionCard>
            </div>
        </AdminPageFrame>
    );
}
