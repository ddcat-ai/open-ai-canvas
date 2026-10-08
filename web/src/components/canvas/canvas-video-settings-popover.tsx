import { VideoSettingsPanel, videoResolutionLabel, videoSecondsLabel, videoSizeLabel } from "@/components/video-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { modelCapabilityConfigFor, resolveVideoRatioValue, resolveVideoResolutionValue } from "@/lib/model-capabilities";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import type { AiConfig } from "@/stores/use-config-store";
import { CanvasSettingsPopover, type CanvasSettingsPlacement } from "./canvas-settings-popover";

type VideoPopoverProps = { config: AiConfig; onConfigChange: (key: keyof AiConfig, value: string) => void; buttonClassName?: string; placement?: CanvasSettingsPlacement };

export function CanvasVideoSettingsPopover({ config, onConfigChange, ...popover }: VideoPopoverProps) {
    const theme = canvasThemes[useActiveTheme()];
    const profile = modelCapabilityConfigFor(config, config.model).video;
    const parts: string[] = [];
    if (profile?.resolutions.length) parts.push(videoResolutionLabel(resolveVideoResolutionValue(profile, config.vquality)));
    if (profile?.ratios.length) parts.push(videoSizeLabel(resolveVideoRatioValue(profile, config.size)));
    parts.push(videoSecondsLabel(config.videoSeconds));
    return <CanvasSettingsPopover {...popover} label="视频设置" summary={parts.join(" · ")}>
        <VideoSettingsPanel config={config} onConfigChange={onConfigChange} theme={theme} className="space-y-3" />
    </CanvasSettingsPopover>;
}
