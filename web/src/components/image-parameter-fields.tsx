import { Input, InputNumber, Switch } from "antd";
import { useEffect, useRef, useState } from "react";
import { ImageSizePresetsEditor } from "./image-size-presets-editor";
import { ImageSizePicker } from "./image-size-picker";
import { protocolImageSizePresets } from "@/lib/protocol-image-presets";
import { imageSingleSizeTier, imageSizeConfigWithPresets, imageSizePresets } from "@/lib/image-size-presets";
import { Select } from "@/components/ui/base/select";
import { commonImageParameter, imageHostControls, imageParameterAccepts, parseImageParameters, updateImageParameterSchema, updateImageParameterSize, type ImageParameter, type ImageParameterValue } from "@/lib/image-parameters";
import type { ImageCapabilityConfig } from "@/lib/model-capabilities";
import { cn } from "@/lib/utils";
import { Check, ChevronDown, ChevronUp, Plus, Star } from "lucide-react";
import { preserveImageSettings, type ImageSettings } from "@/lib/media-settings";

export function ImageParameterInput({
    field,
    value,
    disabled,
    inlineChoices = false,
    onChange,
}: {
    field: ImageParameter;
    value?: ImageParameterValue;
    disabled?: boolean;
    inlineChoices?: boolean;
    onChange: (value: ImageParameterValue | undefined) => void;
}) {
    const [draft, setDraft] = useState(value);
    const editing = useRef(false);
    useEffect(() => {
        if (!editing.current) setDraft(value);
    }, [value]);
    const changeDraft = (next: ImageParameterValue | undefined) => {
        setDraft(next);
        onChange(next);
    };
    const invalid = draft !== undefined && !imageParameterAccepts(field, draft);
    if (field.values?.length) {
        if (inlineChoices) {
            const ratios = field.encoding === "ratio" || (field.name === "size" && field.values.some((item) => typeof item === "string" && /^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(item)));
            return (
                <div className="image-size-picker">
                    <div className={ratios ? "image-size-ratios" : "image-size-tiers"} role="group" aria-label={field.label}>
                        {field.values.map((option) => {
                            const dimensions = ratios && typeof option === "string" ? option.split(":").map(Number) : [];
                            const [width, height] = dimensions;
                            return (
                                <button type="button" key={`${typeof option}:${option}`} disabled={disabled} aria-pressed={value === option} onClick={() => onChange(option)}>
                                    {width > 0 && height > 0 ? <span aria-hidden="true" className="image-size-ratio-icon" style={{ width: 24 * Math.min(1, width / height), height: 24 * Math.min(1, height / width) }} /> : null}
                                    <span>
                                        {option === "auto"
                                            ? field.name === "size"
                                                ? "自动尺寸"
                                                : field.name === "quality"
                                                  ? "自动质量"
                                                  : "自动"
                                            : typeof option === "boolean"
                                              ? option
                                                  ? "开启"
                                                  : "关闭"
                                              : field.name === "imageResolution"
                                                ? String(option).toUpperCase()
                                                : String(option)}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                    {!field.required && field.default === undefined ? (
                        <button type="button" className="image-size-auto" disabled={disabled} aria-pressed={value === undefined} onClick={() => onChange(undefined)}>
                            跟随模型默认
                        </button>
                    ) : null}
                </div>
            );
        }
        return (
            <Select
                className="w-full"
                ariaLabel={field.label}
                disabled={disabled}
                allowClear={!field.required}
                value={value === undefined ? undefined : String(value)}
                placeholder="跟随模型默认"
                options={field.values.map((v) => ({ value: String(v), label: typeof v === "boolean" ? (v ? "开启" : "关闭") : String(v) }))}
                onChange={(next) => onChange(field.values!.find((v) => String(v) === next))}
            />
        );
    }
    if (field.type === "boolean") return <Switch aria-label={field.label} disabled={disabled} checked={value === true} onChange={onChange} />;
    if (field.type === "integer" || field.type === "number")
        return (
            <InputNumber
                className="w-full"
                aria-label={field.label}
                disabled={disabled}
                value={typeof draft === "number" ? draft : null}
                status={invalid ? "error" : undefined}
                changeOnBlur={false}
                onFocus={() => {
                    editing.current = true;
                }}
                onBlur={() => {
                    editing.current = false;
                }}
                min={field.min}
                max={field.max}
                step={field.step ?? (field.type === "integer" ? 1 : undefined)}
                precision={field.type === "integer" ? 0 : undefined}
                placeholder="跟随模型默认"
                onChange={(next) => changeDraft(next ?? undefined)}
            />
        );
    return (
        <Input
            aria-label={field.label}
            disabled={disabled}
            value={typeof draft === "string" ? draft : ""}
            status={invalid ? "error" : undefined}
            maxLength={field.maxLength}
            placeholder="跟随模型默认"
            onFocus={() => {
                editing.current = true;
            }}
            onBlur={() => {
                editing.current = false;
            }}
            onChange={(event) => changeDraft(event.target.value || undefined)}
        />
    );
}

export function ImageParameterFields({
    profile,
    config,
    onChange,
    showCount = true,
    showSize = true,
    showQuality = true,
    showTransparent = true,
    countLimit,
}: {
    profile: ImageCapabilityConfig;
    config: ImageSettings;
    onChange: (key: "size" | "quality" | "imageResolution" | "transparentBackground" | "count" | "imageParameters", value: string) => void;
    showCount?: boolean;
    showSize?: boolean;
    showQuality?: boolean;
    showTransparent?: boolean;
    /** 画布与创作页的张数是拆单数，传值时按账号同时任务数取上限，不再受单模型 maxOutputs 限制。 */
    countLimit?: number;
}) {
    const preserved = preserveImageSettings(profile, config);
    const values = {
        ...parseImageParameters(preserved.imageParameters),
        ...Object.fromEntries(
            (profile.parameters || [])
                .filter((field) => imageHostControls.has(field.name))
                .map((field) => {
                    const raw = preserved[field.name as keyof typeof preserved];
                    return [field.name, field.type === "boolean" ? raw === "true" : field.type === "number" || field.type === "integer" ? Number(raw) : raw];
                }),
        ),
    };
    const sizeField = profile.parameters?.find((p) => p.name === "size");
    const usesSizePresets = profile.resolution.supported || profile.size.parameter === "size" || sizeField?.encoding === "pixels" || profile.parameters?.some((p) => p.name === "imageResolution");
    const groupedSize = showSize && profile.size.parameter !== "none" && usesSizePresets && imageSizePresets(profile).length > 0;
    const fields = (profile.parameters || []).filter(
        (p) =>
            p.enabled !== false &&
            (!groupedSize || (p.name !== "size" && p.name !== "imageResolution")) &&
            (p.name !== "count" || (showCount && (countLimit === undefined ? (p.max ?? 1) > 1 : countLimit > 1))) &&
            (p.name !== "size" || showSize) &&
            (p.name !== "quality" || showQuality) &&
            (p.name !== "transparentBackground" || showTransparent),
    );
    return (
        <div className="space-y-3" data-canvas-no-zoom onPointerDown={(event) => event.stopPropagation()}>
            {groupedSize ? (
                <ImageSizePicker
                    profile={profile}
                    size={String(values.size ?? profile.size.default)}
                    imageResolution={String(values.imageResolution ?? profile.resolution.default)}
                    quality={String(values.quality ?? profile.quality.default)}
                    onChange={(size, _quality, resolution) => {
                        onChange("size", size);
                        if (resolution !== undefined) onChange("imageResolution", resolution);
                    }}
                />
            ) : null}
            {fields.map((field) => {
                if (field.name === "count") {
                    const max = countLimit === undefined ? Number(field.max ?? profile.maxOutputs ?? 15) : Math.min(15, countLimit);
                    // 传了 countLimit 时 config.count 才是拆单数，参数里的 count 固定为每单 1 张。
                    const countVal = countLimit === undefined ? Number(values.count ?? config.count ?? 1) : Math.max(1, Math.min(max, Math.floor(Number(config.count ?? 1)) || 1));
                    return (
                        <div className="space-y-2" key="count">
                            <div className="text-xs font-medium">生成张数</div>
                            <div className="grid grid-cols-4 gap-2">
                                {Array.from({ length: Math.min(3, max) }, (_, i) => i + 1).map((val) => (
                                    <button
                                        key={val}
                                        type="button"
                                        aria-pressed={countVal === val}
                                        onClick={() => onChange("count", String(val))}
                                        className={cn(
                                            "flex h-8 items-center justify-center rounded-full text-xs font-medium transition-colors duration-150 select-none",
                                            countVal === val ? "bg-primary/20 text-primary border border-primary/40 font-semibold" : "bg-muted/40 hover:bg-muted/70 text-muted-foreground hover:text-foreground border border-border/40",
                                        )}
                                    >
                                        {val}
                                    </button>
                                ))}
                                {max >= 4 ? <ImageCountStepper value={countVal} max={max} onChange={(next) => onChange("count", String(next))} /> : null}
                            </div>
                            {field.description && countLimit === undefined ? <p className="text-xs leading-relaxed text-foreground/55">{field.description}</p> : null}
                        </div>
                    );
                }

                return (
                    <div className="space-y-2" key={field.name}>
                        <div className="text-xs font-medium">{field.label}</div>
                        <ImageParameterInput
                            field={field}
                            inlineChoices
                            value={values[field.name]}
                            onChange={(next) => {
                                if (imageHostControls.has(field.name)) {
                                    onChange(field.name as "size" | "quality" | "imageResolution" | "transparentBackground" | "count", next === undefined ? "" : String(next));
                                    return;
                                }
                                const parameters = parseImageParameters(config.imageParameters);
                                if (next === undefined) delete parameters[field.name];
                                else parameters[field.name] = next;
                                onChange("imageParameters", JSON.stringify(parameters));
                            }}
                        />
                        {field.description ? <p className="text-xs leading-relaxed text-foreground/55">{field.description}</p> : null}
                    </div>
                );
            })}
        </div>
    );
}

export function ImageParameterChoices({ field, definition, suggestions, disabled, update }: { field: ImageParameter; definition: ImageParameter; suggestions: ImageParameterValue[]; disabled?: boolean; update: (patch: Partial<ImageParameter>) => void }) {
    const [draft, setDraft] = useState("");
    const values = field.values ?? [];
    const choices = [...new Set([...suggestions, ...values])];
    const resolution = field.name === "imageResolution";
    const custom = field.type === "string" && !definition.values?.length;
    const entries = draft
        .split(/[,，]/)
        .map((item) => item.trim())
        .filter(Boolean);
    const additions = [...new Set(entries.map((item) => (resolution && /^\d+(?:\.\d+)?k$/i.test(item) ? item.toLowerCase() : item)))].filter((item) => !values.includes(item));
    const canAdd = additions.length > 0 && additions.every((value) => imageParameterAccepts(definition, value));
    const changeValues = (next: ImageParameterValue[]) => {
        const keepDefault = field.default !== undefined && (next.includes(field.default) || (!next.length && custom && !resolution && !field.required));
        update({ values: next, default: keepDefault ? field.default : next[0] });
    };
    const add = () => {
        if (!canAdd) return;
        changeValues([...values, ...additions]);
        setDraft("");
    };
    return (
        <div className="min-w-0 space-y-2">
            <div role="group" aria-label={resolution ? "分辨率快捷选择" : `${field.label}支持值`} className="flex flex-wrap gap-1.5">
                {choices.map((value) => {
                    const selected = values.includes(value);
                    const isDefault = field.default === value;
                    const label = value === "auto" ? "自动" : resolution && /^\d+(?:\.\d+)?k$/i.test(String(value)) ? String(value).toUpperCase() : typeof value === "boolean" ? (value ? "开启" : "关闭") : String(value);
                    return (
                        <span key={`${typeof value}:${value}`} className={`inline-flex max-w-full items-center rounded-md border ${selected ? "border-foreground/25 bg-muted/40" : "border-border"}`}>
                            <button
                                type="button"
                                disabled={disabled}
                                aria-pressed={selected}
                                aria-label={`${field.label}支持 ${label}`}
                                className="flex min-h-8 min-w-0 items-center gap-1 px-2 text-sm focus-visible:ring-2"
                                onClick={() => changeValues(selected ? values.filter((item) => item !== value) : [...values, value])}
                            >
                                {selected ? <Check size={13} /> : <Plus size={13} />}
                                <span className="break-all">{label}</span>
                            </button>
                            {selected && (
                                <button
                                    type="button"
                                    disabled={disabled}
                                    aria-label={`设${field.label} ${label} 为默认`}
                                    title={`设 ${label} 为默认`}
                                    aria-pressed={isDefault}
                                    className="shrink-0 p-1.5 focus-visible:ring-2"
                                    onClick={() => update({ default: value })}
                                >
                                    <Star size={13} className={isDefault ? "fill-current text-[var(--control-selected-fg)]" : "text-muted-foreground"} />
                                </button>
                            )}
                        </span>
                    );
                })}
            </div>
            <div className="flex flex-wrap items-center gap-2">
                {custom && (
                    <>
                        <Input
                            size="small"
                            className="max-w-36"
                            aria-label={`新增${field.label}支持值`}
                            placeholder="自定义值，回车添加"
                            value={draft}
                            disabled={disabled}
                            onChange={(event) => setDraft(event.target.value)}
                            onPressEnter={(event) => {
                                event.preventDefault();
                                if (!event.nativeEvent.isComposing) add();
                            }}
                        />
                        <button type="button" className="rounded p-1 focus-visible:ring-2" aria-label={`添加${field.label}支持值`} disabled={disabled || !canAdd} onClick={add}>
                            <Plus size={15} />
                        </button>
                    </>
                )}
                {!field.required && values.length > 0 && (
                    <button type="button" className="rounded px-1 py-1 text-xs text-muted-foreground hover:underline focus-visible:ring-2" aria-pressed={field.default === undefined} disabled={disabled} onClick={() => update({ default: undefined })}>
                        跟随模型默认
                    </button>
                )}
            </div>
        </div>
    );
}

export function ImageParameterSchemaEditor({ definitions, parameters, disabled, onChange }: { definitions: ImageParameter[]; parameters: ImageParameter[]; disabled?: boolean; onChange: (parameters: ImageParameter[]) => void }) {
    const update = (name: string, patch: Partial<ImageParameter>) => onChange(parameters.map((p) => (p.name === name ? { ...p, ...patch } : p)));
    if (!parameters.length) return null;
    return (
        <div className="space-y-3">
            {parameters.map((field) => {
                const declared = definitions.find((p) => p.name === field.name) || field;
                const common = commonImageParameter(field.name);
                const definition = common ? { ...common, required: declared.required } : declared;
                const offersChoices = field.type === "string" || Boolean(definition.values?.length || field.values?.length);
                const suggestions = declared.values?.length ? declared.values : field.name === "imageResolution" ? ["1k", "1.5k", "2k", "4k"] : [];
                return (
                    <section key={field.name} aria-label={field.label} className="min-w-0 space-y-2 border-b border-border pb-4">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <span className="text-sm font-medium">{field.label}</span>
                                <code className="ml-2 text-xs text-muted-foreground">{field.name}</code>
                                {definition.pricing ? <span className="ml-2 text-xs text-foreground/50">可计价</span> : null}
                            </div>
                            <Switch aria-label={`启用${field.label}`} checked={field.enabled !== false} disabled={disabled || definition.required} onChange={(enabled) => update(field.name, { enabled })} />
                        </div>
                        {field.description ? <p className="text-xs text-foreground/55">{field.description}</p> : null}
                        {field.enabled !== false ? (
                            <div className="grid min-w-0 gap-3">
                                {offersChoices && <ImageParameterChoices field={field} definition={definition} suggestions={suggestions} disabled={disabled} update={(patch) => update(field.name, patch)} />}
                                {(field.type === "number" || field.type === "integer") && !definition.values?.length ? (
                                    <div className="grid grid-cols-2 gap-2">
                                        <label className="space-y-2 text-xs">
                                            <span>最小值</span>
                                            <InputNumber
                                                className="w-full"
                                                aria-label={`${field.label}最小值`}
                                                disabled={disabled}
                                                min={definition.min}
                                                max={field.max}
                                                value={field.min}
                                                onChange={(min) => update(field.name, { min: min ?? definition.min })}
                                            />
                                        </label>
                                        <label className="space-y-2 text-xs">
                                            <span>最大值</span>
                                            <InputNumber
                                                className="w-full"
                                                aria-label={`${field.label}最大值`}
                                                disabled={disabled}
                                                min={field.min}
                                                max={definition.max}
                                                value={field.max}
                                                onChange={(max) => update(field.name, { max: max ?? definition.max })}
                                            />
                                        </label>
                                    </div>
                                ) : null}
                                {!field.values?.length && (
                                    <div className="space-y-2 text-xs">
                                        <span>默认值</span>
                                        <ImageParameterInput field={definition.values?.length ? { ...field, values: definition.values } : field} value={field.default} disabled={disabled} onChange={(value) => update(field.name, { default: value })} />
                                    </div>
                                )}
                            </div>
                        ) : null}
                    </section>
                );
            })}
        </div>
    );
}

export function ImageParameterSizeEditor({
    profile,
    definition: declared,
    disabled,
    onChange,
    protocol,
}: {
    profile: ImageCapabilityConfig;
    definition: ImageParameter;
    disabled?: boolean;
    onChange: (profile: ImageCapabilityConfig) => void;
    protocol?: string;
}) {
    const definition = { ...commonImageParameter("size")!, encoding: declared.encoding, required: declared.required };
    const [draft, setDraft] = useState("");
    const [error, setError] = useState("");
    const field = profile.parameters!.find((p) => p.name === "size")!;
    const pixelSize = field.encoding === "pixels";
    const grouped = profile.resolution.supported;
    const singleTier = imageSingleSizeTier(profile);
    const tiers = grouped ? profile.resolution.values.filter((tier) => tier !== "auto") : [singleTier ?? ""];
    const updateField = (patch: Partial<ImageParameter>) =>
        onChange(
            updateImageParameterSchema(
                profile,
                profile.parameters!.map((p) => (p.name === "size" ? { ...p, ...patch } : p)),
                [definition],
                protocol,
            ),
        );
    const updateSize = (size: ImageCapabilityConfig["size"]) => {
        if (!grouped) {
            const retained = (profile.size.presets || []).filter((p) => p.tier !== (singleTier ?? ""));
            const merged = imageSizeConfigWithPresets(profile, [...retained, ...(size.presets || [])]);
            onChange(updateImageParameterSize(profile, { ...merged, default: size.default, defaultTier: singleTier }));
        } else onChange(updateImageParameterSize(profile, size));
    };
    const ratios = [...new Set([...(declared.values || []), ...profile.size.values].map(String))];
    const toggle = (ratio: string) => {
        const values = profile.size.values.includes(ratio) ? profile.size.values.filter((v) => v !== ratio) : [...profile.size.values, ratio];
        updateField({ values, default: values.includes(profile.size.default) ? profile.size.default : values[0] });
    };
    const addRatio = () => {
        const value = draft.trim().replace(/\s/g, "").replace("：", ":");
        const parts = value.split(":").map(Number);
        if (parts.length !== 2 || parts.some((v) => !Number.isFinite(v) || v <= 0)) {
            setError("请输入正数比例，例如 17:11");
            return;
        }
        if (!profile.size.values.includes(value)) toggle(value);
        setDraft("");
        setError("");
    };
    const activePresets = imageSizePresets(profile);
    const editorProfile = !grouped && pixelSize && activePresets.length ? { ...profile, size: imageSizeConfigWithPresets(profile, activePresets) } : profile;
    return (
        <section className="min-w-0 space-y-3 border-b border-border pb-4">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h3 className="text-sm font-medium">尺寸参数</h3>
                </div>
                <Switch aria-label={`启用${field.label}`} disabled={disabled || definition.required} checked={field.enabled !== false} onChange={(enabled) => updateField({ enabled })} />
            </div>
            {!grouped && pixelSize && singleTier === undefined && (profile.size.presets?.length ?? 0) > 0 ? (
                <p role="alert" className="image-size-error">
                    已有多组尺寸，请先开启分辨率并设置默认档位，再关闭分辨率。
                </p>
            ) : null}
            {field.enabled !== false ? (
                grouped && !tiers.length ? (
                    <p role="status" className="image-size-hint">
                        请先在上方分辨率中选择支持的档位，再配置各档位的比例和尺寸。
                    </p>
                ) : grouped || pixelSize ? (
                    <ImageSizePresetsEditor
                        profile={editorProfile}
                        tiers={tiers}
                        grouped={grouped}
                        ratios={
                            definition.values?.length
                                ? [
                                      ...new Set([
                                          ...definition.values.filter((v) => String(v).includes(":")).map(String),
                                          ...protocolImageSizePresets(protocol)
                                              .filter((p) => imageParameterAccepts(definition, p.size))
                                              .map((p) => p.ratio),
                                      ]),
                                  ]
                                : undefined
                        }
                        defaultPresets={protocolImageSizePresets(protocol)}
                        allowCustomRatio={!definition.values?.length}
                        disabled={disabled}
                        onClearDefault={!definition.required ? () => updateField({ default: undefined }) : undefined}
                        onChange={updateSize}
                    />
                ) : (
                    <>
                        <div className="image-size-picker">
                            <div className="image-size-ratios" role="group" aria-label="支持的宽高比">
                                {ratios.map((ratio) => (
                                    <button type="button" key={ratio} disabled={disabled} aria-pressed={profile.size.values.includes(ratio)} onClick={() => toggle(ratio)}>
                                        {ratio}
                                    </button>
                                ))}
                            </div>
                        </div>
                        {!definition.values?.length ? (
                            <div className="image-size-preset-add">
                                <Input aria-label="自定义比例" placeholder="其他比例，如 17:11" value={draft} disabled={disabled} onChange={(e) => setDraft(e.target.value)} onPressEnter={addRatio} />
                                <button type="button" disabled={disabled || !draft.trim()} onClick={addRatio}>
                                    添加
                                </button>
                            </div>
                        ) : null}
                        {error ? <p role="alert">{error}</p> : null}
                        <div className="image-size-defaults">
                            <strong>默认输出</strong>
                            <div className="image-size-default-options" role="group" aria-label="默认输出">
                                {!definition.required && (
                                    <button type="button" disabled={disabled} aria-pressed={field.default === undefined} onClick={() => updateField({ default: undefined })}>
                                        跟随模型默认
                                    </button>
                                )}
                                {profile.size.values.map((value) => (
                                    <button type="button" key={value} disabled={disabled} aria-pressed={value === field.default} onClick={() => updateField({ default: value })}>
                                        {value}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </>
                )
            ) : null}
        </section>
    );
}

export function ImagePixelMappingEditor({ profile, disabled, onChange }: { profile: ImageCapabilityConfig; disabled?: boolean; onChange: (size: ImageCapabilityConfig["size"]) => void }) {
    const sizeField = profile.parameters?.find((p) => p.name === "size" && p.enabled !== false && p.encoding === "pixels");
    if (!sizeField || !profile.size.values.some((v) => v.includes(":"))) return null;
    const tiers = profile.resolution.supported ? profile.resolution.values : [""];
    const presets = profile.size.presets || [];
    const rows = tiers.flatMap((tier) => profile.size.values.filter((value) => value.includes(":")).map((ratio) => presets.find((p) => p.tier === tier && p.ratio === ratio) || { tier, ratio, width: 0, height: 0, size: "" }));
    const update = (index: number, key: "width" | "height", value: number | null) => {
        onChange({
            ...profile.size,
            presets: rows.map((p, i) => {
                if (i !== index) return p;
                const next = { ...p, [key]: value ?? 0 };
                return { ...next, size: `${next.width}x${next.height}` };
            }),
        });
    };
    return (
        <section className="rounded-lg border border-border p-4 space-y-3">
            <div>
                <h3 className="text-sm font-medium">比例对应的像素尺寸</h3>
                <p className="mt-1 text-xs leading-relaxed text-foreground/55">此接口接收像素。按已启用的分辨率和比例填写尺寸，保存后用于请求换算。</p>
            </div>
            <div className="space-y-2">
                {rows.map((preset, index) => (
                    <div key={`${preset.tier}:${preset.ratio}`} className="grid grid-cols-[1fr_1fr_1fr] items-center gap-2">
                        <span className="text-xs">
                            {preset.tier ? `${preset.tier.toUpperCase()} · ` : ""}
                            {preset.ratio}
                        </span>
                        <InputNumber className="w-full" aria-label={`${preset.tier} ${preset.ratio} 宽度`} min={1} precision={0} disabled={disabled} value={preset.width || null} placeholder="宽度" onChange={(v) => update(index, "width", v)} />
                        <InputNumber className="w-full" aria-label={`${preset.tier} ${preset.ratio} 高度`} min={1} precision={0} disabled={disabled} value={preset.height || null} placeholder="高度" onChange={(v) => update(index, "height", v)} />
                    </div>
                ))}
            </div>
            <p className="text-xs text-foreground/60">尺寸以供应商支持范围为准，也可将画幅支持值直接配置为像素尺寸。</p>
        </section>
    );
}

function ImageCountStepper({ value, max, onChange }: { value: number; max: number; onChange: (value: number) => void }) {
    const isSelected = value >= 4;
    const [draftValue, setDraftValue] = useState(() => (value >= 4 ? String(value) : "4"));

    useEffect(() => {
        if (value >= 4) {
            setDraftValue(String(value));
        }
    }, [value]);

    const handleSelectThis = () => {
        const num = Math.max(1, Math.min(max, parseInt(draftValue, 10) || 4));
        onChange(num);
    };

    const handleStepUp = (e: React.MouseEvent) => {
        e.stopPropagation();
        const base = value >= 4 ? value : parseInt(draftValue, 10) || 4;
        const next = Math.min(max, base + 1);
        setDraftValue(String(next));
        onChange(next);
    };

    const handleStepDown = (e: React.MouseEvent) => {
        e.stopPropagation();
        const base = value >= 4 ? value : parseInt(draftValue, 10) || 4;
        const next = Math.max(1, base - 1);
        setDraftValue(String(next));
        onChange(next);
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setDraftValue(e.target.value);
    };

    const handleInputBlur = (e: React.FocusEvent<HTMLInputElement>) => {
        const num = Math.max(1, Math.min(max, parseInt(e.target.value, 10) || 4));
        setDraftValue(String(num));
        onChange(num);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.currentTarget.blur();
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            const base = value >= 4 ? value : parseInt(draftValue, 10) || 4;
            const next = Math.min(max, base + 1);
            setDraftValue(String(next));
            onChange(next);
        } else if (e.key === "ArrowDown") {
            e.preventDefault();
            const base = value >= 4 ? value : parseInt(draftValue, 10) || 4;
            const next = Math.max(1, base - 1);
            setDraftValue(String(next));
            onChange(next);
        }
    };

    return (
        <div
            className={cn(
                "group relative flex h-8 items-center overflow-hidden rounded-full border text-xs transition-colors cursor-pointer select-none",
                isSelected ? "bg-primary/20 text-primary border-primary/40 font-semibold" : "bg-muted/40 hover:bg-muted/70 text-muted-foreground hover:text-foreground border-border/40",
            )}
            onClick={handleSelectThis}
        >
            <input
                type="text"
                inputMode="numeric"
                aria-label="自定义生成张数"
                value={draftValue}
                onChange={handleInputChange}
                onBlur={handleInputBlur}
                onKeyDown={handleKeyDown}
                onFocus={(e) => {
                    e.currentTarget.select();
                    if (value < 4) {
                        handleSelectThis();
                    }
                }}
                className="w-full min-w-0 flex-1 bg-transparent pl-2 pr-0.5 text-center font-medium text-xs outline-none text-foreground"
            />
            <div className="flex flex-col h-full w-4.5 shrink-0 border-l justify-center items-center divide-y border-border/60">
                <button
                    type="button"
                    tabIndex={-1}
                    onClick={handleStepUp}
                    disabled={value >= max && isSelected}
                    className="flex flex-1 w-full items-center justify-center hover:bg-black/15 dark:hover:bg-white/15 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    title="增加 1 张"
                    aria-label="增加 1 张"
                >
                    <ChevronUp className="size-2.5 opacity-70" />
                </button>
                <button
                    type="button"
                    tabIndex={-1}
                    onClick={handleStepDown}
                    disabled={value <= 1 && isSelected}
                    className="flex flex-1 w-full items-center justify-center hover:bg-black/15 dark:hover:bg-white/15 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    title="减少 1 张"
                    aria-label="减少 1 张"
                >
                    <ChevronDown className="size-2.5 opacity-70" />
                </button>
            </div>
        </div>
    );
}
