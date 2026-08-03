import { App, Button, Segmented, Tag } from "antd";
import { Brush, Save } from "lucide-react";
import { useEffect, useState } from "react";

import { drawingEngineLabel, isDrawingEngineAvailable, type CanvasDrawingEngine } from "@/lib/canvas/canvas-drawing-engine";
import { getAdminDrawingEngineSetting, updateAdminDrawingEngineSetting } from "@/services/api/auth";
import { useUserStore } from "@/stores/use-user-store";
import { AdminPageFrame } from "../components/admin-shell";
import { SettingsSectionCard } from "../components/admin-ui";

export default function DrawingEngineSettingsPage() {
    const { message } = App.useApp();
    const current = useUserStore((state) => state.drawingEngine);
    const setDrawingEngine = useUserStore((state) => state.setDrawingEngine);
    const [engine, setEngine] = useState<CanvasDrawingEngine>(current.defaultEngine);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let cancelled = false;
        void getAdminDrawingEngineSetting().then(({ setting }) => {
            if (cancelled) return;
            setDrawingEngine(setting);
            setEngine(setting.defaultEngine);
        }).catch((error) => {
            if (!cancelled) message.error(error instanceof Error ? error.message : "读取绘图工具配置失败");
        }).finally(() => {
            if (!cancelled) setLoading(false);
        });
        return () => { cancelled = true; };
    }, [message, setDrawingEngine]);

    const save = async () => {
        if (!isDrawingEngineAvailable(engine)) {
            message.error("当前生产构建未配置 tldraw License Key");
            return;
        }
        setSaving(true);
        try {
            const { setting } = await updateAdminDrawingEngineSetting(engine);
            setDrawingEngine(setting);
            setEngine(setting.defaultEngine);
            message.success("默认绘图工具已更新");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存绘图工具配置失败");
        } finally {
            setSaving(false);
        }
    };

    const dirty = engine !== current.defaultEngine;
    return (
        <AdminPageFrame title="绘图工具" description="设置新建绘图节点使用的默认编辑器">
            <div className="mx-auto max-w-4xl space-y-5">
                <SettingsSectionCard icon={<Brush className="size-4" />} title="默认绘图引擎" description="已有绘图保持原引擎，仅新建绘图使用这里的选择。" status={<Tag variant="filled" color="blue">{drawingEngineLabel(current.defaultEngine)}</Tag>}>
                    <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
                        <Segmented<CanvasDrawingEngine>
                            block
                            className="w-full sm:max-w-md"
                            disabled={loading || saving}
                            value={engine}
                            onChange={setEngine}
                            options={[
                                { label: "Excalidraw", value: "excalidraw" },
                                { label: "tldraw", value: "tldraw", disabled: !isDrawingEngineAvailable("tldraw") },
                            ]}
                        />
                        <Button type="primary" icon={<Save className="size-4" />} loading={saving} disabled={loading || !dirty} onClick={() => void save()}>保存配置</Button>
                    </div>
                    {!isDrawingEngineAvailable("tldraw") ? <div className="border-t border-border px-5 py-3 text-xs text-amber-600 dark:text-amber-400">当前生产构建没有 tldraw License Key，不能将其设为新建默认值。</div> : null}
                </SettingsSectionCard>
            </div>
        </AdminPageFrame>
    );
}
