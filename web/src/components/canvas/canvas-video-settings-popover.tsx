import { preserveVideoSettings } from "@/lib/media-settings";
import { VideoSettingsPanel, videoResolutionLabel, videoSecondsLabel, videoSizeLabel } from "@/components/video-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { modelCapabilityConfigFor, resolveVideoRatioValue, resolveVideoResolutionValue } from "@/lib/model-capabilities";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import { LL2_CONNECTED_VIDEO_MODELS, LL2_VIDEO_DURATION, ll2TiersFor, type LL2ConnectedVideoModel } from "@/lib/ll2-models";
import { useTranslation } from "react-i18next";
import { CanvasSettingsPopover, type CanvasSettingsPlacement } from "./canvas-settings-popover";

type VideoPopoverProps = { config: AiConfig; onConfigChange: (key: keyof AiConfig, value: string) => void; buttonClassName?: string; placement?: CanvasSettingsPlacement };

export function CanvasVideoSettingsPopover({ config, onConfigChange, ...popover }: VideoPopoverProps) {
    const { t } = useTranslation();
    const theme = canvasThemes[useActiveTheme()];
    const profile = modelCapabilityConfigFor(config, config.model).video;
    const selected = profile ? preserveVideoSettings(profile, { seconds: config.videoSeconds, ratio: config.size, resolution: config.vquality }, resolveModelRequestConfig(config, config.model).interfaceType) : undefined;
    const parts: string[] = [];
    // 画布里的模型 id 带渠道前缀；LL2 模型的摘要要用 LL2 自己的档位，避免「面板 768P、chip 720P」。
    const baseModel = String(config.model || "").split("::").pop() || "";
    const isLL2 = (LL2_CONNECTED_VIDEO_MODELS as readonly string[]).includes(baseModel);
    if (isLL2) {
        const tiers = ll2TiersFor(baseModel as LL2ConnectedVideoModel) || [];
        const tier = tiers.find((item) => item.label === config.vquality) || tiers[0];
        if (tier) parts.push(tier.label);
        parts.push(config.size || "16:9");
        const range = LL2_VIDEO_DURATION[baseModel as keyof typeof LL2_VIDEO_DURATION];
        const seconds = Math.min(range?.max || 15, Math.max(range?.min || 4, Number(config.videoSeconds) || 5));
        parts.push(`${Math.round(seconds)} 秒`);
    } else {
        if (profile?.resolutions.length && selected) parts.push(videoResolutionLabel(selected.resolution));
        if (profile?.ratios.length && selected) parts.push(videoSizeLabel(selected.ratio));
        parts.push(videoSecondsLabel(selected?.seconds || config.videoSeconds));
    }
    return (
        <CanvasSettingsPopover {...popover} label={t("canvasC.videoSettings.label")} summary={parts.join(" · ")}>
            <VideoSettingsPanel config={config} onConfigChange={onConfigChange} theme={theme} className="space-y-3" />
        </CanvasSettingsPopover>
    );
}
