import { type ReactNode } from "react";

import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { audioFormatOptionsForConfig, audioSpeedLabel, audioVoiceOptionsForConfig, isDoubaoAudioConfig, normalizeAudioFormatForConfig, normalizeAudioSpeedValue, normalizeAudioVoiceForConfig } from "@/lib/audio-generation";
import { type CanvasTheme } from "@/lib/canvas-theme";
import type { AiConfig } from "@/stores/use-config-store";

const speedOptions = ["0.75", "1", "1.25", "1.5"];

type AudioSettingKey =
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

type AudioSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: AudioSettingKey, value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
};

export function AudioSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[var(--panel-width-compact)] space-y-4 rounded-2xl px-1 py-0.5" }: AudioSettingsPanelProps) {
    const isDoubao = isDoubaoAudioConfig(config);
    const voice = normalizeAudioVoiceForConfig(config, config.audioVoice);
    const voiceOptions = audioVoiceOptionsForConfig(config);
    const visibleVoiceOptions = voiceOptions.some((item) => item.value === voice) ? voiceOptions : [{ value: voice, label: `当前音色（${voice}）` }, ...voiceOptions];
    const format = normalizeAudioFormatForConfig(config, config.audioFormat);
    const formatOptions = audioFormatOptionsForConfig(config);
    const speed = normalizeAudioSpeedValue(config.audioSpeed);

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">音频设置</div> : null}
                <SettingGroup title="音色" color={theme.node.muted}>
                    {isDoubao ? (
                        <div className="space-y-3">
                            <div className="rounded-xl border px-3 py-2 text-sm leading-6" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                                不连接素材时，按提示词直接生成。连接音频时按参考音频生成，最多 3 段。连接图片时按参考图片生成，最多 1 张。图片和音频不能同时连接。
                            </div>
                            <select
                                value={voice}
                                className="h-9 w-full rounded-xl border bg-transparent px-3 text-sm outline-none"
                                style={{ borderColor: theme.node.stroke, color: theme.node.text, background: theme.spatial.elevated }}
                                onChange={(event) => onConfigChange("audioVoice", event.target.value)}
                                onMouseDown={(event) => event.stopPropagation()}
                            >
                                <option value="">不指定音色</option>
                                {voice ? <option value={voice}>当前音色</option> : null}
                            </select>
                        </div>
                    ) : (
                        <>
                            <input
                                value={config.audioVoice || ""}
                                placeholder="输入渠道音色 ID，例如 voice_001"
                                list="audio-voice-options"
                                className="h-9 w-full rounded-xl border bg-transparent px-3 text-sm outline-none"
                                style={{ borderColor: theme.node.stroke, color: theme.node.text }}
                                onChange={(event) => onConfigChange("audioVoice", event.target.value)}
                                onMouseDown={(event) => event.stopPropagation()}
                            />
                            <datalist id="audio-voice-options">
                                {visibleVoiceOptions.map((item) => (
                                    <option key={item.value} value={item.value}>
                                        {item.label}
                                    </option>
                                ))}
                            </datalist>
                            <div className="grid grid-cols-3 gap-2.5">
                                {visibleVoiceOptions.map((item) => (
                                    <OptionPill key={item.value} selected={voice === item.value} theme={theme} onClick={() => onConfigChange("audioVoice", item.value)}>
                                        {item.label}
                                    </OptionPill>
                                ))}
                            </div>
                        </>
                    )}
                </SettingGroup>
                <SettingGroup title="格式" color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {formatOptions.map((item) => (
                            <OptionPill key={item.value} selected={format === item.value} theme={theme} onClick={() => onConfigChange("audioFormat", item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title="语速" color={theme.node.muted}>
                    <div className="grid grid-cols-4 gap-2.5">
                        {speedOptions.map((value) => (
                            <OptionPill key={value} selected={speed === value} theme={theme} onClick={() => onConfigChange("audioSpeed", value)}>
                                {audioSpeedLabel(value)}
                            </OptionPill>
                        ))}
                    </div>
                    <input
                        type="number"
                        min={0.25}
                        max={4}
                        step={0.05}
                        className="h-9 w-full rounded-full border bg-transparent px-3 text-center text-sm outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        style={{ borderColor: theme.node.stroke, color: theme.node.text, WebkitTextFillColor: theme.node.text }}
                        value={config.audioSpeed || "1"}
                        onChange={(event) => onConfigChange("audioSpeed", event.target.value)}
                        onBlur={(event) => onConfigChange("audioSpeed", normalizeAudioSpeedValue(event.target.value))}
                        onMouseDown={(event) => event.stopPropagation()}
                    />
                </SettingGroup>
                {!isDoubao ? (
                    <SettingGroup title="声音指令" color={theme.node.muted}>
                        <textarea
                            value={config.audioInstructions || ""}
                            placeholder="例如：自然、温暖、适合旁白。"
                            className="thin-scrollbar h-20 w-full resize-none rounded-xl border bg-transparent px-3 py-2 text-sm leading-5 outline-none"
                            style={{ borderColor: theme.node.stroke, color: theme.node.text }}
                            onChange={(event) => onConfigChange("audioInstructions", event.target.value)}
                            onMouseDown={(event) => event.stopPropagation()}
                        />
                    </SettingGroup>
                ) : null}
            </div>
        </ImageSettingsTheme>
    );
}

function OptionPill({ selected, theme, onClick, children }: { selected: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80"
            style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function SettingGroup({ title, color, children }: { title: string; color: string; children: ReactNode }) {
    return (
        <div className="space-y-2.5">
            <div className="text-xs font-medium" style={{ color }}>
                {title}
            </div>
            {children}
        </div>
    );
}
