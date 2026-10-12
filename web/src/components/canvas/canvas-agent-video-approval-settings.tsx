import { useMemo } from "react";
import { ModelPicker } from "@/components/model-picker";
import { VideoSettingsPanel } from "@/components/video-settings-panel";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { agentApprovalModel, agentApprovalModelSelection, type AgentVideoApproval } from "@/lib/canvas/agent-media-approval";
import { modelCapabilityConfigFor, normalizeVideoValue } from "@/lib/model-capabilities";
import { resolveCompatibleModel, type ModelRequirements } from "@/lib/model-selection";
import type { AgentMediaSettings } from "@/services/api/agent";
import { PUBLIC_MODEL_CATALOG_ID, useEffectiveConfig } from "@/stores/use-config-store";

export function CanvasAgentVideoApprovalSettings({ initial, value, theme, disabled, onChange }: { initial: AgentVideoApproval; value?: AgentMediaSettings; theme: CanvasTheme; disabled: boolean; onChange: (value: AgentMediaSettings) => void }) {
    const effective = useEffectiveConfig();
    const config = useMemo(() => ({ ...effective, channels: effective.channels.filter((channel) => channel.scope === "system" || channel.id === PUBLIC_MODEL_CATALOG_ID) }), [effective]);
    const settings = value || initial;
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
        onChange({ ...agentApprovalModelSelection(config, selected), ...nextSettings });
    };

    return (
        <fieldset disabled={disabled} className="min-w-0 space-y-3 border-0 p-0" data-canvas-no-zoom data-canvas-wheel-scroll aria-label="视频生成设置">
            <div className="space-y-1.5">
                <div className="text-xs" style={{ color: theme.node.muted }}>
                    生成模型
                </div>
                <ModelPicker config={config} capability="video" value={model} onChange={changeModel} requirements={requirements} variant="creation" fullWidth showOptionPrices placeholder="选择生成模型" popoverClassName="agent-model-picker-popover" />
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
                    当前模型不在可选目录中，可重新选择；提交时将重新校验模型与规格。
                </p>
            )}
            <p className="text-xs" style={{ color: theme.node.text }}>
                本次规格：{settings.size}
                {settings.quality ? ` · ${settings.quality}` : ""}
                {settings.durationSeconds ? ` · ${settings.durationSeconds} 秒` : ""}
            </p>
            <p className="text-xs" style={{ color: theme.node.muted }}>
                修改仅用于本次生成，费用按最终模型和规格计算。
            </p>
        </fieldset>
    );
}
