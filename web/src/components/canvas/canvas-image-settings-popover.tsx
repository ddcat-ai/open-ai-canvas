import { useTranslation } from "react-i18next";
import { ImageSettingsPanel, imageQualityLabel, imageSizeLabel } from "@/components/image-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { preserveImageSettings as normalizeImageValue } from "@/lib/media-settings";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
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
    /** 画布节点的张数是拆单数，传值时按账号同时任务数显示上限。 */
    countLimit?: number;
};

export function CanvasImageSettingsPopover({ config, onConfigChange, showCount = true, countLimit, onMissingConfig: _unused, ...popover }: CanvasImageSettingsPopoverProps) {
    const { t } = useTranslation();
    const theme = canvasThemes[useActiveTheme()];
    const profile = modelCapabilityConfigFor(config, config.model || config.imageModel).image;
    if (!profile) return null;
    const current = normalizeImageValue(profile, config, resolveModelRequestConfig(config, config.model || config.imageModel).interfaceType);
    const parts: string[] = [];
    if (profile.size.parameter !== "none") parts.push(imageSizeLabel(current.size));
    if (profile.quality.supported) parts.push(imageQualityLabel(current.quality));
    // 传了 countLimit 时摘要用原始 config.count，不受单模型 maxOutputs=1 影响。
    if (showCount && (countLimit === undefined ? profile.maxOutputs > 1 : countLimit > 1))
        parts.push(t("canvasB.imageSettings.count", { count: countLimit === undefined ? current.count : Math.max(1, Math.min(15, countLimit, Math.floor(Number(config.count)) || 1)) }));
    if (profile.transparentBackground.supported && current.transparentBackground === "true") parts.push(t("canvasB.imageSettings.transparent"));
    if (!parts.length && !profile.transparentBackground.supported && !profile.parameters?.some((p) => p.enabled !== false)) return null;
    return (
        <CanvasSettingsPopover {...popover} label={t("canvasB.imageSettings.label")} summary={parts.join(" · ") || t("canvasB.imageSettings.background")} width={420}>
            <ImageSettingsPanel config={config} onConfigChange={onConfigChange} theme={theme} showCount={showCount} quickCount={3} className="space-y-3" countLimit={countLimit} />
        </CanvasSettingsPopover>
    );
}
