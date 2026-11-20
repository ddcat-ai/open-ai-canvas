import { useMemo, type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { ImageSettingsPanel } from "@/components/image-settings-panel";
import { ModelPicker } from "@/components/model-picker";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { agentApprovalModel, agentApprovalModelSelection, agentMediaSettings, type AgentImageApproval } from "@/lib/canvas/agent-media-approval";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { preserveImageSettings } from "@/lib/media-settings";
import { parseImageParameters } from "@/lib/image-parameters";
import { resolveCompatibleModel, type ModelRequirements } from "@/lib/model-selection";
import type { AgentMediaSettings } from "@/services/api/agent";
import { PUBLIC_MODEL_CATALOG_ID, resolveModelRequestConfig, useEffectiveConfig } from "@/stores/use-config-store";

// 可编辑规格只使用顶层字段，扩展 JSON 保留其他已授权参数。
function approvalImageParameters(value?: string) {
    if (value === undefined) return undefined;
    try {
        const parsed = JSON.parse(value);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return value;
        return JSON.stringify(Object.fromEntries(Object.entries(parsed).filter(([name]) => !["size", "imageResolution", "quality"].includes(name))));
    } catch {
        return value;
    }
}

export function CanvasAgentImageApprovalSettings({
    initial,
    value,
    onChange,
    theme,
    disabled,
}: {
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
        // AgentMediaSettings carries these hidden controls only in JSON. Promote
        // them before adaptation, then restore the target model's typed values.
        const hidden = parseImageParameters(settings.imageParameters);
        const normalized = preserveImageSettings(
            profile,
            { ...settings, count: hidden.count === undefined ? undefined : String(hidden.count), transparentBackground: hidden.transparentBackground === undefined ? undefined : String(hidden.transparentBackground) },
            resolveModelRequestConfig(config, next).interfaceType,
        );
        let imageParameters = approvalImageParameters(normalized.imageParameters);
        try {
            const parameters = JSON.parse(imageParameters || "{}");
            if (parameters && typeof parameters === "object" && !Array.isArray(parameters)) {
                for (const name of ["count", "transparentBackground"] as const) {
                    const field = profile.parameters?.find((item) => item.name === name && item.enabled !== false);
                    // Malformed typed mirrors remain intact for strict validation.
                    if (field && !Object.hasOwn(parameters, name)) parameters[name] = name === "count" ? Number(normalized.count) : normalized.transparentBackground === "true";
                }
                imageParameters = JSON.stringify(parameters);
            }
        } catch {
            // Preserve invalid JSON so submission validation can report it.
        }
        onChange({ ...agentApprovalModelSelection(config, next), size: normalized.size, imageResolution: normalized.imageResolution, imageParameters, quality: normalized.quality });
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
            return { ...agentApprovalModelSelection(config, selected || agentApprovalModel(config, current)), ...options, imageParameters };
        });
    };
    return (
        <fieldset disabled={disabled} className="min-w-0 space-y-3 border-0 p-0" data-canvas-no-zoom data-canvas-wheel-scroll aria-label={t("canvasA.approval.imageSettings")}>
            <div className="space-y-2">
                <div className="text-xs" style={{ color: theme.node.muted }}>
                    {t("canvasA.approval.model")}
                </div>
                <ModelPicker
                    config={config}
                    capability="image"
                    value={model}
                    onChange={changeModel}
                    requirements={requirements}
                    variant="creation"
                    fullWidth
                    showOptionPrices
                    placeholder={t("canvasA.approval.modelPlaceholder")}
                    popoverClassName="agent-model-picker-popover"
                />
            </div>
            {model ? (
                <ImageSettingsPanel
                    config={{ ...config, model, imageModel: model, size: settings.size, imageResolution: settings.imageResolution || "auto", imageParameters: settings.imageParameters, quality: settings.quality, count: "1" }}
                    onConfigChange={changeOption}
                    theme={theme}
                    showTitle={false}
                    showCount={false}
                    showTransparent={false}
                    className="min-w-0 space-y-3"
                />
            ) : (
                <p className="text-xs" style={{ color: theme.node.muted }}>
                    {t("canvasA.approval.modelUnavailable")}
                </p>
            )}
            <p className="text-xs" style={{ color: theme.node.text }}>
                {t("canvasA.approval.spec", { spec: [settings.size, settings.imageResolution && settings.imageResolution !== "auto" ? settings.imageResolution : "", settings.quality].filter(Boolean).join(" · ") })}
            </p>
            <p className="text-xs" style={{ color: theme.node.muted }}>
                {t("canvasA.approval.note")}
            </p>
        </fieldset>
    );
}
