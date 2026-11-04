import { useMemo, type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { ImageSettingsPanel } from "@/components/image-settings-panel";
import { ModelPicker } from "@/components/model-picker";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { agentApprovalModel, agentApprovalModelSelection, agentMediaSettings, type AgentImageApproval } from "@/lib/canvas/agent-media-approval";
import { modelCapabilityConfigFor, normalizeImageValue } from "@/lib/model-capabilities";
import { parseImageParameters } from "@/lib/image-parameters";
import { resolveCompatibleModel, type ModelRequirements } from "@/lib/model-selection";
import type { AgentMediaSettings } from "@/services/api/agent";
import { PUBLIC_MODEL_CATALOG_ID, resolveModelRequestConfig, useEffectiveConfig } from "@/stores/use-config-store";

// 可编辑规格只使用顶层字段，扩展 JSON 保留其他已授权参数。
function approvalImageParameters(value?: string) {
    return value === undefined ? undefined : JSON.stringify(Object.fromEntries(Object.entries(parseImageParameters(value)).filter(([name]) => !["size", "imageResolution", "quality"].includes(name))));
}

export function CanvasAgentImageApprovalSettings({ initial, value, onChange, theme, disabled }: {
    initial: AgentImageApproval;
    value?: AgentMediaSettings;
    onChange: Dispatch<SetStateAction<AgentMediaSettings | undefined>>;
    theme: CanvasTheme;
    disabled: boolean;
}) {
    const { t } = useTranslation();
    const effective = useEffectiveConfig();
    const config = useMemo(() => ({ ...effective, channels: effective.channels.filter((channel) => channel.scope === "system" || channel.id === PUBLIC_MODEL_CATALOG_ID) }), [effective]);
    const settings = agentMediaSettings(value || initial);
    const model = agentApprovalModel(config, settings);
    const requirements: ModelRequirements = {
        capability: "image",
        input: { textCount: 1, imageCount: initial.referenceNodeIds.length, videoCount: 0, audioCount: 0, characterCount: 0 },
        imageSize: settings.size,
        options: { size: settings.size, ...(settings.quality ? { quality: settings.quality } : {}), count: 1 },
    };
    const changeModel = (next: string) => {
        if (disabled) return;
        const profile = modelCapabilityConfigFor(config, next).image;
        if (!profile) return;
        const normalized = normalizeImageValue(profile, settings, resolveModelRequestConfig(config, next).interfaceType);
        onChange({ ...agentApprovalModelSelection(config, next), size: normalized.size, imageResolution: normalized.imageResolution, imageParameters: approvalImageParameters(normalized.imageParameters), quality: profile.quality.supported ? normalized.quality : "" });
    };
    const changeOption = (key: "quality" | "imageResolution" | "imageParameters" | "size" | "transparentBackground" | "count", next: string) => {
        if (disabled || (key !== "size" && key !== "quality" && key !== "imageResolution" && key !== "imageParameters")) return;
        // 尺寸选择器在同一事件中同时更新尺寸和分辨率，必须累积上一项更新。
        onChange((previous) => {
            const current = agentMediaSettings(previous || initial);
            const imageParameters = approvalImageParameters(key === "imageParameters" ? next : current.imageParameters);
            if (key === "imageParameters") return { ...current, imageParameters };
            const options = { size: current.size, imageResolution: current.imageResolution, quality: current.quality, [key]: next };
            const selected = resolveCompatibleModel(config, agentApprovalModel(config, current), { ...requirements, imageSize: options.size, options: { ...options, count: 1 } });
            if (!selected) return previous;
            return { ...agentApprovalModelSelection(config, selected), ...options, imageParameters };
        });
    };
    return <fieldset disabled={disabled} className="min-w-0 space-y-3 border-0 p-0" data-canvas-no-zoom data-canvas-wheel-scroll aria-label={t("canvasA.approval.imageSettings")}>
        <div className="space-y-2">
            <div className="text-xs" style={{ color: theme.node.muted }}>{t("canvasA.approval.model")}</div>
            <ModelPicker config={config} capability="image" value={model} onChange={changeModel} requirements={requirements} variant="creation" fullWidth showOptionPrices placeholder={t("canvasA.approval.modelPlaceholder")} popoverClassName="agent-model-picker-popover" />
        </div>
        {model ? <ImageSettingsPanel config={{ ...config, model, imageModel: model, size: settings.size, imageResolution: settings.imageResolution || "auto", imageParameters: settings.imageParameters, quality: settings.quality, count: "1" }} onConfigChange={changeOption} theme={theme} showTitle={false} showCount={false} showTransparent={false} className="min-w-0 space-y-3" /> : <p className="text-xs" style={{ color: theme.node.muted }}>{t("canvasA.approval.modelUnavailable")}</p>}
        <p className="text-xs" style={{ color: theme.node.text }}>{t("canvasA.approval.spec", { spec: [settings.size, settings.imageResolution && settings.imageResolution !== "auto" ? settings.imageResolution : "", settings.quality].filter(Boolean).join(" · ") })}</p>
        <p className="text-xs" style={{ color: theme.node.muted }}>{t("canvasA.approval.note")}</p>
    </fieldset>;
}
