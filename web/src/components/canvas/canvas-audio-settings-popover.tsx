import { useTranslation } from "react-i18next";
import { AudioSettingsPanel } from "@/components/audio-settings-panel";
import { audioFormatLabelForConfig, audioSpeedLabel, canvasAudioSource } from "@/lib/audio-generation";
import { canvasThemes } from "@/lib/canvas-theme";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import type { AiConfig } from "@/stores/use-config-store";
import { CanvasSettingsPopover, type CanvasSettingsPlacement } from "./canvas-settings-popover";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { CanvasAudioVoiceBinding } from "@/lib/canvas/canvas-audio-voice-bindings";

export type CanvasAudioSettingKey =
    | "audioMode"
    | "audioVoice"
    | "audioFormat"
    | "audioSpeed"
    | "audioLanguage"
    | "audioDialect"
    | "audioInstructions"
    | "audioEmotionControlMethod"
    | "audioEmotionRandom"
    | "audioEmotionHappy"
    | "audioEmotionAngry"
    | "audioEmotionSad"
    | "audioEmotionAfraid"
    | "audioEmotionDisgusted"
    | "audioEmotionMelancholic"
    | "audioEmotionSurprised"
    | "audioEmotionCalm";
type AudioPopoverProps = {
    config: AiConfig;
    referenceAudioLabels?: string[];
    references?: CanvasResourceReference[];
    onBindingsChange?: (bindings: CanvasAudioVoiceBinding[]) => void;
    onConfigChange: (key: CanvasAudioSettingKey, value: string) => void;
    buttonClassName?: string;
    placement?: CanvasSettingsPlacement;
};

export function CanvasAudioSettingsPopover({ config, referenceAudioLabels = [], references, onBindingsChange, onConfigChange, ...popover }: AudioPopoverProps) {
    const { t } = useTranslation();
    const theme = canvasThemes[useActiveTheme()];
    const source = canvasAudioSource(config, referenceAudioLabels);
    const referenceVoice = source.mode === "unified_edit" && referenceAudioLabels.length > 0;
    const parts = [source.label, audioFormatLabelForConfig(config, config.audioFormat), ...(referenceVoice ? [] : [audioSpeedLabel(config.audioSpeed)])];
    return (
        <CanvasSettingsPopover {...popover} label={t("canvasA.audioSettings.label")} summary={parts.join(" · ")}>
            <AudioSettingsPanel config={{ ...config, audioMode: source.mode }} referenceAudioLabels={referenceAudioLabels} references={references} onBindingsChange={onBindingsChange} onConfigChange={onConfigChange} theme={theme} className="space-y-4" />
        </CanvasSettingsPopover>
    );
}
