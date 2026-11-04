import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ModelPicker } from "@/components/model-picker";
import { VideoSettingsPanel } from "@/components/video-settings-panel";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { agentApprovalModel, agentApprovalModelSelection, agentMediaSettings, type AgentVideoApproval } from "@/lib/canvas/agent-media-approval";
import { modelCapabilityConfigFor, normalizeVideoValue } from "@/lib/model-capabilities";
import { resolveCompatibleModel, type ModelRequirements } from "@/lib/model-selection";
import type { AgentMediaSettings } from "@/services/api/agent";
import { PUBLIC_MODEL_CATALOG_ID, useEffectiveConfig } from "@/stores/use-config-store";

export function CanvasAgentVideoApprovalSettings({ initial, value, theme, disabled, onChange }: { initial: AgentVideoApproval; value?: AgentMediaSettings; theme: CanvasTheme; disabled: boolean; onChange: (value: AgentMediaSettings) => void }) {
    const { t } = useTranslation();
    const effective = useEffectiveConfig();
    const config = useMemo(() => ({ ...effective, channels: effective.channels.filter((channel) => channel.scope === "system" || channel.id === PUBLIC_MODEL_CATALOG_ID) }), [effective]);
    const settings = agentMediaSettings(value || initial);
    const model = agentApprovalModel(config, settings, "video");
    const duration = String(settings.durationSeconds || initial.durationSeconds || "");
    const audio = settings.videoGenerateAudio === undefined ? "" : String(settings.videoGenerateAudio);
    const watermark = settings.videoWatermark === undefined ? "" : String(settings.videoWatermark);
    const privateAssetUpload = settings.videoArkPrivateAssetUpload === undefined ? "" : String(settings.videoArkPrivateAssetUpload);
    const requirements: ModelRequirements = {
        capability: "video",
        input: { textCount: initial.sourceNodeId ? 1 : 0, imageCount: initial.referenceNodeIds.length, videoCount: 0, audioCount: 0, characterCount: 0 },
        videoSeconds: duration || undefined,
        options: {
            size: settings.size,
            vquality: settings.quality,
            videoSeconds: duration,
            ...(settings.videoGenerateAudio === undefined ? {} : { videoGenerateAudio: settings.videoGenerateAudio }),
            ...(settings.videoWatermark === undefined ? {} : { videoWatermark: settings.videoWatermark }),
            ...(settings.videoArkPrivateAssetUpload === undefined ? {} : { videoArkPrivateAssetUpload: settings.videoArkPrivateAssetUpload }),
        },
    };

    const changeModel = (next: string) => {
        if (disabled) return;
        const profile = modelCapabilityConfigFor(config, next).video;
        if (!profile) return;
        const normalized = normalizeVideoValue(profile, { seconds: duration, ratio: settings.size, resolution: settings.quality });
        onChange({
            ...agentApprovalModelSelection(config, next),
            size: normalized.ratio,
            quality: normalized.resolution,
            durationSeconds: Number(normalized.seconds),
            videoGenerateAudio: settings.videoGenerateAudio,
            videoWatermark: settings.videoWatermark,
            videoArkPrivateAssetUpload: settings.videoArkPrivateAssetUpload,
        });
    };

    const changeOption = (key: "vquality" | "size" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "videoArkPrivateAssetUpload", next: string) => {
        if (disabled) return;
        const nextSettings: AgentMediaSettings = {
            ...settings,
            size: key === "size" ? next : settings.size,
            quality: key === "vquality" ? next : settings.quality,
            durationSeconds: key === "videoSeconds" ? Number(next) : settings.durationSeconds,
            videoGenerateAudio: key === "videoGenerateAudio" ? next === "true" : settings.videoGenerateAudio,
            videoWatermark: key === "videoWatermark" ? next === "true" : settings.videoWatermark,
            videoArkPrivateAssetUpload: key === "videoArkPrivateAssetUpload" ? next === "true" : settings.videoArkPrivateAssetUpload,
        };
        const selected = resolveCompatibleModel(config, model, {
            ...requirements,
            videoSeconds: String(nextSettings.durationSeconds || ""),
            options: {
                size: nextSettings.size,
                vquality: nextSettings.quality,
                videoSeconds: String(nextSettings.durationSeconds || ""),
                ...(nextSettings.videoGenerateAudio === undefined ? {} : { videoGenerateAudio: nextSettings.videoGenerateAudio }),
                ...(nextSettings.videoWatermark === undefined ? {} : { videoWatermark: nextSettings.videoWatermark }),
                ...(nextSettings.videoArkPrivateAssetUpload === undefined ? {} : { videoArkPrivateAssetUpload: nextSettings.videoArkPrivateAssetUpload }),
            },
        });
        if (!selected) return;
        // 兼容模型可能因新规格自动切换；模型字段必须以 selected 为准，不能被旧设置覆盖。
        onChange({ ...nextSettings, logicalModelId: undefined, channelId: undefined, channelModelKey: undefined, ...agentApprovalModelSelection(config, selected) });
    };

    return (
        <fieldset disabled={disabled} className="min-w-0 space-y-3 border-0 p-0" data-canvas-no-zoom data-canvas-wheel-scroll aria-label={t("canvasA.approval.videoSettings")}>
            <div className="space-y-2">
                <div className="text-xs" style={{ color: theme.node.muted }}>
                    {t("canvasA.approval.model")}
                </div>
                <ModelPicker
                    config={config}
                    capability="video"
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
                <VideoSettingsPanel
                    config={{ ...config, model, size: settings.size, videoSeconds: duration, vquality: settings.quality, videoGenerateAudio: audio, videoWatermark: watermark, videoArkPrivateAssetUpload: privateAssetUpload }}
                    onConfigChange={changeOption}
                    theme={theme}
                    showTitle={false}
                    className="min-w-0 space-y-3"
                />
            ) : (
                <p className="text-xs" style={{ color: theme.node.muted }}>
                    {t("canvasA.approval.modelUnavailable")}
                </p>
            )}
            <p className="text-xs" style={{ color: theme.node.text }}>
                {t("canvasA.approval.spec", { spec: [settings.size, settings.quality, settings.durationSeconds ? t("canvasA.approval.seconds", { count: settings.durationSeconds }) : ""].filter(Boolean).join(" · ") })}
            </p>
            <p className="text-xs" style={{ color: theme.node.muted }}>
                {t("canvasA.approval.note")}
            </p>
        </fieldset>
    );
}
