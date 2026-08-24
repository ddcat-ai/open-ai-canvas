import { App, Button, Input, Segmented } from "antd";
import { Brush, Save } from "lucide-react";
import { useEffect, useState } from "react";

import { drawingEngineLabel, isDrawingEngineAvailable, type CanvasDrawingEngine } from "@/lib/canvas/canvas-drawing-engine";
import { getAdminDrawingEngineSetting, updateAdminDrawingEngineSetting } from "@/services/api/auth";
import { useUserStore } from "@/stores/use-user-store";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminStatusBadge, SettingsSectionCard } from "../components/admin-ui";
import { useTranslation } from "react-i18next";

export default function DrawingEngineSettingsPage() {
    const { t } = useTranslation("canvas");
    const { message } = App.useApp();
    const current = useUserStore((state) => state.drawingEngine);
    const setDrawingEngine = useUserStore((state) => state.setDrawingEngine);
    const [engine, setEngine] = useState<CanvasDrawingEngine>(current.defaultEngine);
    const [tldrawLicenseKey, setTldrawLicenseKey] = useState(current.tldrawLicenseKey || "");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let cancelled = false;
        void getAdminDrawingEngineSetting()
            .then(({ setting }) => {
                if (cancelled) return;
                setDrawingEngine(setting);
                setEngine(setting.defaultEngine);
                setTldrawLicenseKey(setting.tldrawLicenseKey || "");
            })
            .catch((error) => {
                if (!cancelled) message.error(error instanceof Error ? error.message : t("admin:failed-to-read-drawing-tool-config"));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [message, setDrawingEngine]);

    const tldrawAvailable = isDrawingEngineAvailable("tldraw", tldrawLicenseKey);
    const save = async () => {
        if (!isDrawingEngineAvailable(engine, tldrawLicenseKey)) {
            message.error(t("admin:configure-a-valid-tldraw-license-key-first"));
            return;
        }
        setSaving(true);
        try {
            const { setting } = await updateAdminDrawingEngineSetting({ defaultEngine: engine, tldrawLicenseKey });
            setDrawingEngine(setting);
            setEngine(setting.defaultEngine);
            setTldrawLicenseKey(setting.tldrawLicenseKey || "");
            message.success(t("admin:drawing-tool-config-updated"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:failed-to-save-drawing-tool-config"));
        } finally {
            setSaving(false);
        }
    };

    const dirty = engine !== current.defaultEngine || tldrawLicenseKey !== (current.tldrawLicenseKey || "");
    return (
        <AdminPageFrame title={t("admin:drawing-tools")} description={t("admin:set-the-default-editor-for-new-drawing-nodes")} scroll>
            <div className="pt-4">
                <SettingsSectionCard
                    icon={<Brush className="size-4" />}
                    title={t("admin:default-drawing-engine")}
                    description={t("admin:existing-drawings-keep-their-engine-this-choice-applies-to-new-drawings")}
                    status={<AdminStatusBadge label={drawingEngineLabel(current.defaultEngine)} tone="info" />}
                    footer={
                        <>
                            <span className={`text-xs ${tldrawAvailable ? "text-foreground/45" : "text-amber-600 dark:text-amber-400"}`}>
                                {tldrawAvailable ? t("admin:this-config-affects-only-drawing-nodes-created-afterwards") : t("admin:no-tldraw-license-key-configured-so-it-cannot-be-set-as-default-yet")}
                            </span>
                            <Button type="primary" icon={<Save className="size-4" />} loading={saving} disabled={loading || !dirty} onClick={() => void save()}>
                                {t("admin:save-config-5")}
                            </Button>
                        </>
                    }
                >
                    <div className="grid gap-4 px-4 py-4 md:grid-cols-2">
                        <div className="min-w-0">
                            <label className="mb-2 block text-sm font-medium">{t("admin:tldraw-license-key")}</label>
                            <Input.Password value={tldrawLicenseKey} onChange={(event) => setTldrawLicenseKey(event.target.value)} placeholder={t("admin:enter-tldraw-license-key")} disabled={loading || saving} autoComplete="off" />
                            <p className="mt-2 text-xs text-foreground/55">{t("admin:save-a-valid-license-key-to-unlock-the-tldraw-option")}</p>
                        </div>
                        <div className="min-w-0">
                            <label className="mb-2 block text-sm font-medium">{t("admin:default-engine-for-new-drawings")}</label>
                            <Segmented<CanvasDrawingEngine>
                                block
                                className="w-full"
                                disabled={loading || saving}
                                value={engine}
                                onChange={setEngine}
                                options={[
                                    { label: "Excalidraw", value: "excalidraw" },
                                    { label: "tldraw", value: "tldraw", disabled: !tldrawAvailable },
                                ]}
                            />
                            <p className="mt-2 text-xs text-foreground/55">{t("admin:switching-does-not-convert-or-overwrite-existing-drawings")}</p>
                        </div>
                    </div>
                </SettingsSectionCard>
            </div>
        </AdminPageFrame>
    );
}
