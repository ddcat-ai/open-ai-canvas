import { useTranslation } from "react-i18next";
import { ImageSettingsPanel, imageQualityLabel, imageSizeLabel } from "@/components/image-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { modelCapabilityConfigFor, normalizeImageValue } from "@/lib/model-capabilities";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import type { AiConfig } from "@/stores/use-config-store";
import { CanvasSettingsPopover, type CanvasSettingsPlacement } from "./canvas-settings-popover";

type CanvasImageSettingsPopoverProps = {
    config: AiConfig;
    onConfigChange: (key: keyof AiConfig, value: string) => void;
    onMissingConfig?: () => void;
    onOpenChange?: (open: boolean) => void;
    buttonClassName?: string;
    getPopupContainer?: (triggerNode: HTMLElement) => HTMLElement;
    placement?: CanvasSettingsPlacement;
    autoAdjustOverflow?: boolean;
    showCount?: boolean;
};

export function CanvasImageSettingsPopover({ config, onConfigChange, showCount = true, onMissingConfig: _unused, ...popover }: CanvasImageSettingsPopoverProps) {
    const { t } = useTranslation();
    const theme = canvasThemes[useActiveTheme()];
    const profile = modelCapabilityConfigFor(config, config.model || config.imageModel).image;
    if (!profile) return null;
    const current = normalizeImageValue(profile, config);
    const parts: string[] = [];
    if (profile.size.parameter !== "none") parts.push(imageSizeLabel(current.size));
    if (profile.quality.supported) parts.push(imageQualityLabel(current.quality));
    if (showCount && profile.maxOutputs > 1) parts.push(t("canvasB.imageSettings.count", { count: current.count }));
    if (profile.transparentBackground.supported && current.transparentBackground === "true") parts.push(t("canvasB.imageSettings.transparent"));
    if (!parts.length && !profile.transparentBackground.supported && !profile.parameters?.some((p) => p.enabled !== false)) return null;
    return (
        <CanvasSettingsPopover {...popover} label={t("canvasB.imageSettings.label")} summary={parts.join(" · ") || t("canvasB.imageSettings.background")} width={420}>
            <ImageSettingsPanel config={config} onConfigChange={onConfigChange} theme={theme} showCount={showCount} quickCount={3} className="space-y-3" />
        </CanvasSettingsPopover>
    );
}
