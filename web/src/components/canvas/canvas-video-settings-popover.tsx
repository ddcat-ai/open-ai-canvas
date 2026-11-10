import { preserveVideoSettings } from "@/lib/media-settings";
import { VideoSettingsPanel, videoResolutionLabel, videoSecondsLabel, videoSizeLabel } from "@/components/video-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { modelCapabilityConfigFor, resolveVideoRatioValue, resolveVideoResolutionValue } from "@/lib/model-capabilities";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import { useTranslation } from "react-i18next";
import { CanvasSettingsPopover, type CanvasSettingsPlacement } from "./canvas-settings-popover";

type VideoPopoverProps = { config: AiConfig; onConfigChange: (key: keyof AiConfig, value: string) => void; buttonClassName?: string; placement?: CanvasSettingsPlacement };

export function CanvasVideoSettingsPopover({ config, onConfigChange, ...popover }: VideoPopoverProps) {
    const { t } = useTranslation();
    const theme = canvasThemes[useActiveTheme()];
    const profile = modelCapabilityConfigFor(config, config.model).video;
    const selected = profile ? preserveVideoSettings(profile, { seconds: config.videoSeconds, ratio: config.size, resolution: config.vquality }, resolveModelRequestConfig(config, config.model).interfaceType) : undefined;
    const parts: string[] = [];
    if (profile?.resolutions.length && selected) parts.push(videoResolutionLabel(selected.resolution));
    if (profile?.ratios.length && selected) parts.push(videoSizeLabel(selected.ratio));
    parts.push(videoSecondsLabel(selected?.seconds || config.videoSeconds));
    return (
        <CanvasSettingsPopover {...popover} label={t("canvasC.videoSettings.label")} summary={parts.join(" · ")}>
            <VideoSettingsPanel config={config} onConfigChange={onConfigChange} theme={theme} className="space-y-3" />
        </CanvasSettingsPopover>
    );
}
