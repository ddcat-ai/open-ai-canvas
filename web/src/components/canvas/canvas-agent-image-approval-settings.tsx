import { useMemo } from "react";
import { ImageSettingsPanel } from "@/components/image-settings-panel";
import { ModelPicker } from "@/components/model-picker";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { agentApprovalModel, agentApprovalModelSelection, type AgentImageApproval } from "@/lib/canvas/agent-media-approval";
import { modelCapabilityConfigFor, normalizeImageValue } from "@/lib/model-capabilities";
import { resolveCompatibleModel, type ModelRequirements } from "@/lib/model-selection";
import type { AgentMediaSettings } from "@/services/api/agent";
import { PUBLIC_MODEL_CATALOG_ID, useEffectiveConfig } from "@/stores/use-config-store";

export function CanvasAgentImageApprovalSettings({ initial, value, onChange, theme, disabled }: {
    initial: AgentImageApproval;
    value?: AgentMediaSettings;
    onChange: (value: AgentMediaSettings) => void;
    theme: CanvasTheme;
    disabled: boolean;
}) {
    const effective = useEffectiveConfig();
    const config = useMemo(() => ({ ...effective, channels: effective.channels.filter((channel) => channel.scope === "system" || channel.id === PUBLIC_MODEL_CATALOG_ID) }), [effective]);
    const settings = value || initial;
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
        const normalized = normalizeImageValue(profile, settings);
        onChange({ ...agentApprovalModelSelection(config, next), size: normalized.size, quality: profile.quality.supported ? normalized.quality : "" });
    };
    const changeOption = (key: "quality" | "size" | "transparentBackground" | "count", next: string) => {
        if (disabled || (key !== "size" && key !== "quality")) return;
        const options = { size: settings.size, quality: settings.quality, [key]: next };
        const selected = resolveCompatibleModel(config, model, { ...requirements, imageSize: options.size, options: { ...options, count: 1 } });
        if (!selected) return;
        onChange({ ...agentApprovalModelSelection(config, selected), ...options });
    };
    return <fieldset disabled={disabled} className="min-w-0 space-y-3 border-0 p-0" data-canvas-no-zoom data-canvas-wheel-scroll aria-label="图片生成设置">
        <div className="space-y-1.5">
            <div className="text-xs" style={{ color: theme.node.muted }}>生成模型</div>
            <ModelPicker config={config} capability="image" value={model} onChange={changeModel} requirements={requirements} variant="creation" fullWidth showOptionPrices placeholder="选择生成模型" popoverClassName="agent-model-picker-popover" />
        </div>
        {model ? <ImageSettingsPanel config={{ ...config, model, imageModel: model, size: settings.size, quality: settings.quality, count: "1" }} onConfigChange={changeOption} theme={theme} showTitle={false} showCount={false} showTransparent={false} className="min-w-0 space-y-3" /> : <p className="text-xs" style={{ color: theme.node.muted }}>当前模型不在可选目录中，可重新选择；提交时将重新校验模型与规格。</p>}
        <p className="text-xs" style={{ color: theme.node.text }}>本次规格：{settings.size}{settings.quality ? ` · ${settings.quality}` : ""}</p>
        <p className="text-xs" style={{ color: theme.node.muted }}>修改仅用于本次生成，费用按最终模型和规格计算。</p>
    </fieldset>;
}
