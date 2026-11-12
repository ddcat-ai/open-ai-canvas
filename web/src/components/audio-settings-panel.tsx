import { useId } from "react";
import { Input, InputNumber, Radio, Select } from "antd";
import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { audioFormatOptionsForConfig, audioSpeedLabel, audioVoiceOptionsForConfig, isDoubaoAudioConfig, normalizeAudioFormatForConfig, normalizeAudioSpeedValue, normalizeAudioVoiceForConfig } from "@/lib/audio-generation";
import type { CanvasTheme } from "@/lib/canvas-theme";
import type { AiConfig } from "@/stores/use-config-store";
import type { CanvasAudioSettingKey } from "@/components/canvas/canvas-audio-settings-popover";
import { canvasReferenceDisplayName, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { CanvasAudioVoiceBinding } from "@/lib/canvas/canvas-audio-voice-bindings";
import { CanvasReferenceAudioPreview } from "@/components/canvas/canvas-reference-audio-preview";

type AudioSettingsPanelProps = {
    config: AiConfig & { audioVoiceBindings?: CanvasAudioVoiceBinding[] };
    referenceAudioLabels?: string[];
    references?: CanvasResourceReference[];
    onBindingsChange?: (bindings: CanvasAudioVoiceBinding[]) => void;
    onConfigChange: (key: CanvasAudioSettingKey, value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
};

export function AudioSettingsPanel({ config, referenceAudioLabels, references = [], onBindingsChange, onConfigChange, theme, showTitle = true, className = "w-[var(--panel-width-compact)] space-y-4" }: AudioSettingsPanelProps) {
    const listId = useId();
    const doubao = isDoubaoAudioConfig(config);
    const voice = normalizeAudioVoiceForConfig(config, config.audioVoice);
    const voices = audioVoiceOptionsForConfig(config);
    const currentVoice = voices.some((item) => item.value === voice) ? voices : [{ value: voice, label: voice || "不指定音色" }, ...voices];
    const formats = audioFormatOptionsForConfig(config);
    const format = normalizeAudioFormatForConfig(config, config.audioFormat);
    const speed = normalizeAudioSpeedValue(config.audioSpeed);
    const selectVoice = (value: string) => onConfigChange("audioVoice", value);
    const referenceVoice = config.audioMode === "unified_edit" && Boolean(referenceAudioLabels?.length);
    const audioReferences = references.filter((reference) => reference.active && reference.kind === "audio");
    const characterReferences = references.filter((reference) => reference.active && reference.kind === "character");
    return (
        <ImageSettingsTheme theme={theme}>
            <section className={className} style={{ color: theme.node.text }} onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} aria-label="音频生成参数">
                {showTitle ? <h3 className="text-base font-semibold">音频设置</h3> : null}
                <Radio.Group
                    aria-label="音频生成模式"
                    value={config.audioMode === "tts" || config.audioMode === "unified_edit" ? config.audioMode : referenceAudioLabels?.length ? "unified_edit" : "tts"}
                    onChange={(event) => onConfigChange("audioMode", event.target.value)}
                    options={[{ label: "朗读", value: "tts" }, { label: "配音", value: "unified_edit" }]}
                />
                {referenceVoice && characterReferences.length && onBindingsChange ? (
                    <fieldset className="space-y-2">
                        <legend className="text-xs" style={{ color: theme.node.muted }}>
                            角色音色对应 <span className="opacity-70">仅本次生成</span>
                        </legend>
                        {characterReferences.map((character) => {
                            const audioNodeId = config.audioVoiceBindings?.find((binding) => binding.characterNodeId === character.nodeId)?.audioNodeId || "";
                            const boundAudio = audioReferences.find((audio) => audio.nodeId === audioNodeId);
                            return (
                                <div key={character.nodeId} className="grid grid-cols-[minmax(48px,96px)_28px_minmax(0,160px)] items-center gap-2 text-xs">
                                    <span className="truncate" title={character.title}>
                                        {character.title || character.label}
                                    </span>
                                    <div className="flex w-7 items-center justify-center">{boundAudio ? <CanvasReferenceAudioPreview reference={boundAudio} compact buttonOnly /> : null}</div>
                                    <Select
                                        aria-label={`${character.title || character.label}的参考音频`}
                                        size="small"
                                        className="min-w-0 w-full"
                                        value={boundAudio?.nodeId}
                                        placeholder="选择参考音频"
                                        options={audioReferences.map((audio) => ({ value: audio.nodeId, label: canvasReferenceDisplayName(audio) }))}
                                        onChange={(value) => onBindingsChange([...(config.audioVoiceBindings || []).filter((binding) => binding.characterNodeId !== character.nodeId), { characterNodeId: character.nodeId, audioNodeId: value }])}
                                    />
                                    {!boundAudio && audioNodeId ? (
                                        <span role="alert" className="col-span-3 text-xs">
                                            引用已失效，请重新选择参考音频
                                        </span>
                                    ) : null}
                                </div>
                            );
                        })}
                    </fieldset>
                ) : null}
                <fieldset className="space-y-2">
                    <legend className="mb-2 text-xs" style={{ color: theme.node.muted }}>
                        音色
                    </legend>
                    {referenceVoice ? (
                        <p className="text-xs leading-5" style={{ color: theme.node.muted }}>
                            当前使用参考音色：{referenceAudioLabels!.join("、")}。可用 @音频编号或上方角色对应指定音色；本次不使用音色 ID。
                        </p>
                    ) : doubao ? (
                        <>
                            <p className="text-xs leading-5" style={{ color: theme.node.muted }}>
                                无参考素材时按提示词生成；可连接最多 3 段音频或 1 张图片，图片与音频不能混用。
                            </p>
                            <Input aria-label="豆包音色 ID" value={voice} allowClear placeholder="留空按提示词生成，或输入可用的音色 ID" onChange={(event) => selectVoice(event.target.value.trim())} />
                            {referenceAudioLabels !== undefined ? (
                                <p className="text-xs leading-5" style={{ color: theme.node.muted }}>
                                    {config.audioMode === "unified_edit" ? "请连接参考音频后生成配音。" : "文本朗读使用所选音色；已连接的参考音频不参与本次生成。"}
                                </p>
                            ) : null}
                            <p className="text-xs leading-5" style={{ color: theme.node.muted }}>
                                仅填写当前模型已开通的音色或复刻音色 ID；不自动套用旧版音色列表。图片参考模式不使用此音色。
                            </p>
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
                    {referenceVoice ? (
                        <p className="text-xs leading-5" style={{ color: theme.node.muted }}>
                            参考音色模式请在提示词中描述语速和停顿；当前反代不使用语速倍率参数。
                        </p>
                    ) : (
                        <>
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
                            {doubao ? (
                                <p className="text-xs leading-5" style={{ color: theme.node.muted }}>
                                    1x 为正常语速。情绪克制、低声不等于慢速；提示词也不要重复要求放慢或拖长尾音。
                                </p>
                            ) : null}
                        </>
                    )}
                </fieldset>
                {doubao ? (
                    <details className="space-y-2 text-xs" style={{ color: theme.node.muted }}>
                        <summary className="cursor-pointer">豆包提示词写法</summary>
                        <p className="leading-5">在节点的提示词输入框中写声音要求和台词，不是在这里填写。以下为写法建议，效果需试听确认。</p>
                        <p className="leading-5">建议结构：说话方式 + 情绪与节奏 + 要说的原文。默认自然语速、停顿简短，避免堆叠“缓慢、舒缓、娓娓道来”等要求。</p>
                        <p className="leading-5">例如：用自然、亲切的语气说，正常语速，句间短暂停顿，不拖尾音。只说：“大家好，欢迎来到影策工作台。”</p>
                        <p className="leading-5">参考音频：连接素材后使用 @Audio1、@Audio2、@Audio3，编号与参考顺序对应。例如：参考 @Audio1 的音色，以正常语速说：“我们出发吧。”</p>
                        <p className="leading-5">参考图片：最多连接 1 张图片，写清要说的台词；不要与参考音频混用。</p>
                        <p className="leading-5">当前豆包协议没有独立发送声音指令、语言和方言参数；这些要求写入节点提示词，不保证每项都能精确执行。</p>
                    </details>
                ) : (
                    <label className="flex flex-col gap-2 text-xs" style={{ color: theme.node.muted }}>
                        声音指令
                        <Input.TextArea aria-label="声音指令" rows={3} value={config.audioInstructions || ""} placeholder="例如：自然、温暖的旁白" onChange={(event) => onConfigChange("audioInstructions", event.target.value)} />
                    </label>
                )}
            </section>
        </ImageSettingsTheme>
    );
}
