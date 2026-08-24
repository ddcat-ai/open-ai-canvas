import { App, Button, Input, Switch } from "antd";
import { Plus, Save, ShieldAlert, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { getAdminResponseInterceptionSetting, updateAdminResponseInterceptionSetting, type ResponseInterceptionRule } from "@/services/api/response-interception";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminStatusBadge, SettingsSectionCard } from "../components/admin-ui";
import { useTranslation } from "react-i18next";

const emptyRule = (): ResponseInterceptionRule => ({ contains: "", replace: "" });

export default function ResponseInterceptionSettingsPage() {
    const { t } = useTranslation("canvas");
    const { message } = App.useApp();
    const [enabled, setEnabled] = useState(false);
    const [rules, setRules] = useState<ResponseInterceptionRule[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let cancelled = false;
        void getAdminResponseInterceptionSetting()
            .then(({ setting }) => {
                if (cancelled) return;
                setEnabled(setting.enabled);
                setRules(setting.rules || []);
            })
            .catch((error) => {
                if (!cancelled) message.error(error instanceof Error ? error.message : t("admin:failed-to-read-response-interception-config"));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [message]);

    const updateRule = (index: number, field: keyof ResponseInterceptionRule, value: string) => {
        setRules((current) => current.map((rule, ruleIndex) => (ruleIndex === index ? { ...rule, [field]: value } : rule)));
    };

    const save = async () => {
        const normalizedRules = rules.map((rule) => ({ contains: rule.contains.trim(), replace: rule.replace.trim() }));
        const invalidIndex = normalizedRules.findIndex((rule) => !rule.contains || !rule.replace);
        if (invalidIndex >= 0) {
            message.error(`请完整填写第 ${invalidIndex + 1} 条规则`);
            return;
        }
        setSaving(true);
        try {
            const { setting } = await updateAdminResponseInterceptionSetting({ enabled, rules: normalizedRules });
            setEnabled(setting.enabled);
            setRules(setting.rules || []);
            message.success(t("admin:response-interception-config-saved"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:failed-to-save-response-interception-config"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <AdminPageFrame title={t("admin:model-response-interception")} scroll>
            <div className="pt-4">
                <SettingsSectionCard
                    layout="stacked"
                    contentClassName="px-4 pb-4"
                    icon={<ShieldAlert className="size-4" />}
                    title={t("admin:user-visible-error")}
                    status={<AdminStatusBadge label={enabled ? t("admin:enabled") : t("admin:not-enabled")} tone={enabled ? "success" : "neutral"} />}
                    footer={
                        <>
                            <div className="flex items-center gap-2 text-xs text-foreground/55">
                                <Switch size="small" checked={enabled} disabled={loading || saving} onChange={setEnabled} />
                                {t("admin:enable-rule")}
                            </div>
                            <Button type="primary" icon={<Save className="size-4" />} loading={saving} disabled={loading} onClick={() => void save()}>
                                {t("admin:save-config-5")}
                            </Button>
                        </>
                    }
                >
                    <div className="space-y-2">
                        <div className="flex items-center gap-2 px-1 text-xs font-medium text-foreground/48">
                            <span className="min-w-0 flex-1">{t("admin:upstream-response-contains")}</span>
                            <span className="min-w-0 flex-1">{t("admin:replace-with")}</span>
                            <span className="size-6 shrink-0" aria-hidden="true" />
                        </div>
                        {rules.map((rule, index) => (
                            <div key={index} className="flex flex-col gap-2 rounded-md border border-border/50 bg-muted/5 p-2 sm:flex-row sm:items-center">
                                <Input
                                    className="min-w-0 flex-1"
                                    size="small"
                                    value={rule.contains}
                                    disabled={loading || saving}
                                    onChange={(event) => updateRule(index, "contains", event.target.value)}
                                    placeholder={t("admin:e-g-insufficient-balance-429")}
                                />
                                <Input
                                    className="min-w-0 flex-1"
                                    size="small"
                                    value={rule.replace}
                                    disabled={loading || saving}
                                    onChange={(event) => updateRule(index, "replace", event.target.value)}
                                    placeholder={t("admin:e-g-network-error-please-retry")}
                                />
                                <Button
                                    className="shrink-0 self-end sm:self-auto"
                                    type="text"
                                    size="small"
                                    danger
                                    aria-label={`删除第 ${index + 1} 条规则`}
                                    icon={<Trash2 className="size-3.5" />}
                                    disabled={loading || saving}
                                    onClick={() => setRules((current) => current.filter((_, ruleIndex) => ruleIndex !== index))}
                                />
                            </div>
                        ))}
                        <Button type="text" size="small" icon={<Plus className="size-3.5" />} disabled={loading || saving} onClick={() => setRules((current) => [...current, emptyRule()])}>
                            {t("admin:add-rule")}
                        </Button>
                    </div>
                </SettingsSectionCard>
            </div>
        </AdminPageFrame>
    );
}
