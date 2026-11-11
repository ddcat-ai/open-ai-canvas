import { Input, InputNumber, Switch } from "antd";
import { useEffect, useRef, useState } from "react";
import { ImageSizePresetsEditor } from "./image-size-presets-editor";
import { ImageSizePicker } from "./image-size-picker";
import { protocolImageSizePresets } from "@/lib/protocol-image-presets";
import { IMAGE_RESOLUTIONS, imageSingleSizeTier, imageSizeConfigWithPresets, imageSizePresets } from "@/lib/image-size-presets";
import { Select } from "@/components/ui/base/select";
import { commonImageParameter, imageHostControls, imageParameterAccepts, parseImageParameters, updateImageParameterSchema, updateImageParameterSize, type ImageParameter, type ImageParameterValue } from "@/lib/image-parameters";
import type { ImageCapabilityConfig } from "@/lib/model-capabilities";
import type { AiConfig } from "@/stores/use-config-store";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp } from "lucide-react";
import { preserveImageSettings } from "@/lib/media-settings";

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
    config: AiConfig;
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

export function ImageParameterSchemaEditor({ definitions, parameters, disabled, onChange }: { definitions: ImageParameter[]; parameters: ImageParameter[]; disabled?: boolean; onChange: (parameters: ImageParameter[]) => void }) {
    const update = (name: string, patch: Partial<ImageParameter>) => onChange(parameters.map((p) => (p.name === name ? { ...p, ...patch } : p)));
    if (!parameters.length) return null;
    return (
        <div className="space-y-3">
            <p className="text-xs leading-relaxed text-foreground/55">选择此模型支持的参数和范围。生成界面同步显示启用项，标记“可计价”的参数可用于规格价格。</p>
            {parameters.map((field) => {
                const declared = definitions.find((p) => p.name === field.name) || field;
                const definition = commonImageParameter(field.name) ? { ...commonImageParameter(field.name)!, required: declared.required } : declared;
                const isResolution = field.name === "imageResolution" && field.type === "string";
                const baseTiers = ["1k", "1.5k", "2k", "4k"];
                const resolutionChoices = isResolution ? [...new Set([...(declared.values?.length ? declared.values.map(String) : baseTiers.filter((tier) => imageParameterAccepts(definition, tier))), ...(field.values || []).map(String)])] : [];
                const quickResolutionChoices = isResolution ? (resolutionChoices.length ? resolutionChoices : baseTiers) : [];
                const updateValues = (items: string[]) => {
                    const values = [
                        ...new Set(
                            items.map((item) => {
                                const declared = definition.values?.find((v) => String(v) === item);
                                if (declared !== undefined) return declared;
                                return isResolution && !definition.values?.length && /^\d+(?:\.\d+)?k$/i.test(item.trim()) ? item.trim().toLowerCase() : item;
                            }),
                        ),
                    ];
                    const next = { ...field, values };
                    update(field.name, { values, default: isResolution && !values.length ? undefined : imageParameterAccepts(next, field.default) ? field.default : values[0] });
                };
                return (
                    <section key={field.name} className="rounded-lg border border-border p-4 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <span className="text-sm font-medium">{field.label}</span>
                                {definition.pricing ? <span className="ml-2 text-xs text-foreground/50">可计价</span> : null}
                            </div>
                            <Switch aria-label={`启用${field.label}`} checked={field.enabled !== false} disabled={disabled || definition.required} onChange={(enabled) => update(field.name, { enabled })} />
                        </div>
                        {field.description ? <p className="text-xs text-foreground/55">{field.description}</p> : null}
                        {field.enabled !== false ? (
                            <div className="grid gap-3 sm:grid-cols-2">
                                {definition.values?.length || field.type === "string" ? (
                                    <div className="space-y-2 text-xs">
                                        <label className="block space-y-2">
                                            <span>支持值{!definition.values?.length ? "（留空允许自由输入）" : ""}</span>
                                            <Select
                                                className="w-full"
                                                ariaLabel={`${field.label}支持值`}
                                                mode={definition.values?.length ? "multiple" : "tags"}
                                                disabled={disabled}
                                                value={(field.values || []).map(String)}
                                                options={(isResolution ? resolutionChoices : definition.values || []).map((v) => ({
                                                    label: v === "auto" ? "自动" : isResolution && IMAGE_RESOLUTIONS.includes(String(v).toLowerCase()) ? String(v).toUpperCase() : String(v),
                                                    value: String(v),
                                                }))}
                                                tokenSeparators={[",", "，"]}
                                                placeholder={isResolution ? "输入后按回车，或点击下方档位" : undefined}
                                                onChange={updateValues}
                                            />
                                        </label>
                                        {quickResolutionChoices.length ? (
                                            <div className="image-size-presets-editor">
                                                <div className="image-size-default-options" role="group" aria-label="分辨率快捷选择">
                                                    {quickResolutionChoices.map((tier) => {
                                                        const selected = (field.values || []).includes(tier);
                                                        return (
                                                            <button
                                                                type="button"
                                                                key={String(tier)}
                                                                disabled={disabled}
                                                                aria-pressed={selected}
                                                                onClick={() => updateValues((selected ? (field.values || []).filter((value) => value !== tier) : [...(field.values || []), tier]).map(String))}
                                                            >
                                                                {tier === "auto" ? "自动" : String(tier).toUpperCase()}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                                <p className="image-size-hint">点选模型支持的档位，再次点击可移除。{!definition.values?.length ? "其他档位可在上方输入后按回车添加。" : ""}</p>
                                            </div>
                                        ) : null}
                                    </div>
                                ) : null}
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
                                <div className="space-y-2 text-xs">
                                    <span>默认值</span>
                                    <ImageParameterInput field={field} value={field.default} disabled={disabled} onChange={(value) => update(field.name, { default: value })} />
                                </div>
                            </div>
                        ) : null}
                    </section>
                );
            })}
        </div>
    );
}

export function ImageParameterSizeEditor({ profile, definition, disabled, onChange, protocol }: { profile: ImageCapabilityConfig; definition: ImageParameter; disabled?: boolean; onChange: (profile: ImageCapabilityConfig) => void; protocol?: string }) {
    definition = { ...commonImageParameter("size")!, encoding: definition.encoding, required: definition.required };
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
    const ratios = [...new Set([...(definition.values || []), ...profile.size.values].map(String))];
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
        <section className="admin-capability-parameter-card admin-image-size-card space-y-3 rounded-lg border border-border p-4">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h3 className="text-sm font-medium">尺寸参数</h3>
                    <p className="text-xs text-foreground/55">{grouped ? "按分辨率配置可用画幅，直接点选或输入比例" : "直接点选支持的比例"}</p>
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
                                {profile.size.values.map((value) => (
                                    <button type="button" key={value} disabled={disabled} aria-pressed={value === profile.size.default} onClick={() => updateField({ default: value })}>
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
