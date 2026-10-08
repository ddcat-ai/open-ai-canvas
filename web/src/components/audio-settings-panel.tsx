import { useId } from "react";
import { Input, InputNumber, Radio } from "antd";
import { Select } from "@/components/ui/base/select";
import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { audioFormatOptionsForConfig, audioSpeedLabel, audioVoiceOptionsForConfig, isDoubaoAudioConfig, normalizeAudioFormatForConfig, normalizeAudioSpeedValue, normalizeAudioVoiceForConfig } from "@/lib/audio-generation";
import type { CanvasTheme } from "@/lib/canvas-theme";
import type { AiConfig } from "@/stores/use-config-store";
import type { CanvasAudioSettingKey } from "@/components/canvas/canvas-audio-settings-popover";

type AudioSettingsPanelProps = { config: AiConfig; onConfigChange: (key: CanvasAudioSettingKey, value: string) => void; theme: CanvasTheme; showTitle?: boolean; className?: string };

export function AudioSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[var(--panel-width-compact)] space-y-4" }: AudioSettingsPanelProps) {
    const listId = useId();
    const streaming = isDoubaoAudioConfig(config);
    const voice = normalizeAudioVoiceForConfig(config, config.audioVoice);
    const voices = audioVoiceOptionsForConfig(config);
    const currentVoice = voices.some((item) => item.value === voice) ? voices : [{ value: voice, label: voice || "不指定音色" }, ...voices];
    const formats = audioFormatOptionsForConfig(config);
    const format = normalizeAudioFormatForConfig(config, config.audioFormat);
    const speed = normalizeAudioSpeedValue(config.audioSpeed);
    const selectVoice = (value: string) => onConfigChange("audioVoice", value);
    return (
        <ImageSettingsTheme theme={theme}>
            <section className={className} style={{ color: theme.node.text }} onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} aria-label="音频生成参数">
                {showTitle ? <h3 className="text-base font-semibold">音频设置</h3> : null}
                <fieldset className="space-y-2">
                    <legend className="mb-2 text-xs" style={{ color: theme.node.muted }}>
                        音色
                    </legend>
                    {streaming ? (
                        <>
                            <p className="text-xs leading-5" style={{ color: theme.node.muted }}>
                                无参考素材时按提示词生成；可连接最多 3 段音频或 1 张图片，图片与音频不能混用。
                            </p>
                            <Select className="w-full" ariaLabel="音色" value={voice} onChange={selectVoice} options={[{ value: "", label: "不指定音色" }, ...(voice ? [{ value: voice, label: `当前音色 · ${voice}` }] : [])]} />
                        </>
                    ) : (
                        <>
                            <Input aria-label="渠道音色 ID" value={config.audioVoice || ""} list={listId} placeholder="输入渠道音色 ID" onChange={(event) => selectVoice(event.target.value)} />
                            <datalist id={listId}>
                                {currentVoice.map((item) => (
                                    <option value={item.value} key={item.value}>
                                        {item.label}
                                    </option>
                                ))}
                            </datalist>
                            <Radio.Group aria-label="常用音色" value={voice} onChange={(event) => selectVoice(event.target.value)} options={currentVoice} className="flex flex-wrap gap-2" />
                        </>
                    )}
                </fieldset>
                <fieldset>
                    <legend className="mb-2 text-xs" style={{ color: theme.node.muted }}>
                        音频格式
                    </legend>
                    <Radio.Group aria-label="音频格式" value={format} options={formats} onChange={(event) => onConfigChange("audioFormat", event.target.value)} className="flex flex-wrap gap-2" />
                </fieldset>
                <fieldset className="space-y-2">
                    <legend className="mb-2 text-xs" style={{ color: theme.node.muted }}>
                        语速
                    </legend>
                    <Radio.Group aria-label="常用语速" value={speed} options={["0.75", "1", "1.25", "1.5"].map((value) => ({ value, label: audioSpeedLabel(value) }))} onChange={(event) => onConfigChange("audioSpeed", event.target.value)} />
                    <InputNumber
                        aria-label="自定义语速"
                        min={0.25}
                        max={4}
                        step={0.05}
                        value={Number(speed)}
                        className="w-full"
                        onChange={(value) => {
                            if (value !== null) onConfigChange("audioSpeed", normalizeAudioSpeedValue(String(value)));
                        }}
                    />
                </fieldset>
                {!streaming ? (
                    <label className="flex flex-col gap-2 text-xs" style={{ color: theme.node.muted }}>
                        声音指令
                        <Input.TextArea aria-label="声音指令" rows={3} value={config.audioInstructions || ""} placeholder="例如：自然、温暖的旁白" onChange={(event) => onConfigChange("audioInstructions", event.target.value)} />
                    </label>
                ) : null}
            </section>
        </ImageSettingsTheme>
    );
}
