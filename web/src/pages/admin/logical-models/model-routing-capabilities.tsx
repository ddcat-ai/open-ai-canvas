import { Alert, Button, InputNumber, Select, Switch, Tag } from "antd";
import { RotateCcw } from "lucide-react";
import type { ReactNode } from "react";

import type { CapabilitySpec, OptionConstraint } from "@/services/api/logical-models";
import type { ChannelModel } from "@/services/api/wallet";
import { STANDARD_IMAGE_SIZE_VALUES } from "@/lib/model-capabilities";

export type CapabilityKind = CapabilitySpec["capability"];
export type Scalar = string | number | boolean;

type CapabilityScopeEditorProps = {
    capability: CapabilityKind;
    sourceSpecs: CapabilitySpec[];
    value?: CapabilitySpec;
    onChange?: (value: CapabilitySpec) => void;
    mode: "front" | "route";
};

const inputDefinitions: Record<CapabilityKind, Array<{ name: string; label: string; unit: string }>> = {
    text: [
        { name: "image", label: "参考图片", unit: "张" },
        { name: "video", label: "参考视频", unit: "个" },
    ],
    image: [
        { name: "image", label: "参考图片", unit: "张" },
        { name: "mask", label: "蒙版", unit: "张" },
    ],
    video: [
        { name: "image", label: "参考图片", unit: "张" },
        { name: "video", label: "参考视频", unit: "个" },
        { name: "audio", label: "参考音频", unit: "个" },
    ],
    audio: [],
};

const optionDefinitions: Record<CapabilityKind, Array<{ name: string; label: string; unit?: string }>> = {
    text: [],
    image: [
        { name: "size", label: "画面尺寸或比例" },
        { name: "quality", label: "生成质量" },
        { name: "transparentBackground", label: "透明背景" },
        { name: "count", label: "输出数量", unit: "张" },
    ],
    video: [
        { name: "size", label: "画面比例" },
        { name: "videoSeconds", label: "视频时长", unit: "秒" },
        { name: "vquality", label: "输出分辨率" },
        { name: "videoGenerateAudio", label: "同步生成音频" },
        { name: "videoWatermark", label: "输出水印" },
    ],
    audio: [
        { name: "audioVoice", label: "音色" },
        { name: "audioFormat", label: "音频格式" },
        { name: "audioSpeed", label: "语速", unit: "倍" },
        { name: "audioInstructions", label: "朗读指令" },
    ],
};

export function capabilityLabel(value: CapabilityKind) {
    return { text: "文本", image: "图片", video: "视频", audio: "音频" }[value];
}

export function emptyCapabilitySpec(capability: CapabilityKind): CapabilitySpec {
    return { version: 1, capability, operations: [], inputs: {}, options: {} };
}

function imageSizeOptionValues(values: string[], allowCustom: boolean) {
    const concreteValues = Array.from(new Set(values.map((value) => String(normalizeScalar(value)).trim()).filter((value) => value && value !== "*")));
    const result = concreteValues.length || !allowCustom ? concreteValues : [...STANDARD_IMAGE_SIZE_VALUES];
    if (allowCustom) result.push("*");
    return result;
}

export function capabilitySpecFromChannelModel(item?: ChannelModel): CapabilitySpec | null {
    if (!item?.capability) return null;
    const capability = item.capability;
    if (capability === "text") {
        const text = item.capabilityConfig?.text;
        if (!text) return null;
        return {
            version: 1,
            capability,
            inputs: compactInputs({
                image: { min: 0, max: text.references.maxImages },
                video: { min: 0, max: text.references.maxVideos },
            }),
            options: {},
        };
    }
    if (capability === "image") {
        const image = item.capabilityConfig?.image;
        if (!image) return null;
        return {
            version: 1,
            capability,
            inputs: compactInputs({
                image: { min: 0, max: image.references.maxImages },
                mask: { min: 0, max: image.references.maskSupported ? 1 : 0 },
            }),
            options: compactOptions({
                size: image.size.parameter === "none" ? undefined : { values: imageSizeOptionValues(image.size.values, image.size.allowCustom) },
                quality: image.quality.supported ? { values: image.quality.values } : undefined,
                transparentBackground: { values: image.transparentBackground.supported ? [false, true] : [false] },
                count: { min: 1, max: image.maxOutputs, step: 1 },
            }),
        };
    }
    if (capability === "video") {
        const video = item.capabilityConfig?.video;
        if (!video) return null;
        const duration: OptionConstraint = video.duration.selection === "enum" ? { values: video.duration.values || [] } : { min: video.duration.min, max: video.duration.max, step: video.duration.step };
        return {
            version: 1,
            capability,
            operations: video.operations,
            inputs: compactInputs({
                image: { min: video.references.minImages, max: video.references.maxImages },
                video: { min: 0, max: video.references.maxVideos },
                audio: { min: 0, max: video.references.maxAudios },
            }),
            options: compactOptions({
                videoSeconds: duration,
                size: { values: video.ratios },
                vquality: video.resolutions.length ? { values: video.resolutions } : undefined,
                videoGenerateAudio: { values: video.generateAudio.supported ? [false, true] : [false] },
                videoWatermark: { values: video.watermark.supported ? [false, true] : [false] },
            }),
        };
    }
    return emptyCapabilitySpec("audio");
}

export function mergeCapabilitySpecs(capability: CapabilityKind, specs: CapabilitySpec[]) {
    const matching = specs.filter((item) => item.capability === capability);
    if (matching.length === 0) return emptyCapabilitySpec(capability);
    const result = emptyCapabilitySpec(capability);
    result.operations = Array.from(new Set(matching.flatMap((item) => item.operations || [])));
    for (const definition of inputDefinitions[capability]) {
        const declared = matching.some((item) => item.inputs?.[definition.name]);
        if (declared) {
            const constraints = matching.map((item) => item.inputs?.[definition.name] || { min: 0, max: 0 });
            result.inputs![definition.name] = widestCoveredInputRange(constraints);
        }
    }
    for (const definition of optionDefinitions[capability]) {
        const constraints = matching.map((item) => item.options?.[definition.name]).filter(Boolean) as OptionConstraint[];
        if (constraints.length === 0) continue;
        if (constraints.some(isWildcardConstraint)) {
            const values = uniqueScalars(constraints.flatMap((item) => item.values || []));
            result.options![definition.name] = { values: definition.name === "size" ? imageSizeOptionValues(values.map(String), true) : values };
            continue;
        }
        if (constraints.every((item) => item.values)) {
            const values = uniqueScalars(constraints.flatMap((item) => item.values || []));
            result.options![definition.name] = { values: definition.name === "size" ? imageSizeOptionValues(values.map(String), values.includes("*")) : values };
            continue;
        }
        const minimums = constraints.map((item) => item.min).filter((value): value is number => typeof value === "number");
        const maximums = constraints.map((item) => item.max).filter((value): value is number => typeof value === "number");
        const steps = constraints.map((item) => item.step).filter((value): value is number => typeof value === "number" && value > 0);
        if (minimums.length && maximums.length) {
            const candidate = { min: Math.min(...minimums), max: Math.max(...maximums), step: steps.length ? Math.min(...steps) : undefined };
            if (optionConstraintCovered(candidate, definition.name, matching)) {
                result.options![definition.name] = candidate;
                continue;
            }
        }
        const enumValues = uniqueScalars(constraints.flatMap((item) => item.values || []));
        if (enumValues.length && optionConstraintCovered({ values: enumValues }, definition.name, matching)) {
            result.options![definition.name] = { values: enumValues };
            continue;
        }
        result.options![definition.name] = preferredSourceConstraint(constraints);
    }
    return result;
}

/**
 * 旧版本把“允许自定义”保存成只有 `*` 的能力范围。
 * 管理端编辑时用当前供应线路的标准值补回展示范围，保存后即可完成数据修复。
 */
export function normalizeCapabilitySpecForSources(value: CapabilitySpec | undefined, sourceSpecs: CapabilitySpec[]) {
    if (!value) return value;
    const source = mergeCapabilitySpecs(value.capability, sourceSpecs);
    const options = { ...(value.options || {}) };
    for (const [name, constraint] of Object.entries(options)) {
        const sourceConstraint = source.options?.[name];
        if (!sourceConstraint || !isWildcardConstraint(constraint) || !sourceConstraint.values) continue;
        options[name] = { values: uniqueScalars([...(sourceConstraint.values || []), ...(constraint.values || [])]) };
    }
    return { ...value, options };
}

export function capabilitySourceError(capability: CapabilityKind, sourceSpecs: CapabilitySpec[], value?: CapabilitySpec) {
    const matching = sourceSpecs.filter((item) => item.capability === capability);
    const current = value?.capability === capability ? value : emptyCapabilitySpec(capability);
    const currentOperations = current.operations || [];
    if (!matching.length) return "没有可用的渠道模型能力来源";
    if (!currentOperations.length && matching.every((item) => (item.operations || []).length > 0)) {
        return "请选择至少一种供应线路支持的生成方式";
    }
    if (currentOperations.some((operation) => !matching.some((item) => !(item.operations || []).length || item.operations?.includes(operation)))) {
        return "当前生成方式已不受供应线路支持";
    }
    for (const [name, constraint] of Object.entries(current.inputs || {})) {
        if (!inputConstraintCovered(constraint, name, matching)) return `当前${inputLabel(capability, name)}范围存在供应线路无法覆盖的数量`;
    }
    for (const [name, constraint] of Object.entries(current.options || {})) {
        if (!optionConstraintCovered(constraint, name, matching)) return `当前${optionLabel(capability, name)}范围存在供应线路无法覆盖的值`;
    }
    return undefined;
}

export function CapabilityScopeEditor({ capability, sourceSpecs, value, onChange }: CapabilityScopeEditorProps) {
    const source = mergeCapabilitySpecs(capability, sourceSpecs);
    const current = value?.capability === capability ? normalizeCapabilitySpecForSources(value, sourceSpecs)! : emptyCapabilitySpec(capability);
    const hasSource = sourceSpecs.some((item) => item.capability === capability);
    const sourceInputs = inputDefinitions[capability].filter((item) => source.inputs?.[item.name]);
    const sourceOptions = optionDefinitions[capability].filter((item) => source.options?.[item.name]);
    const sourceError = capabilitySourceError(capability, sourceSpecs, current);

    const update = (patch: Partial<CapabilitySpec>) => onChange?.({ ...current, ...patch, version: 1, capability });
    const reset = () => onChange?.(source);

    if (!hasSource) return null;

    return (
        <div className="space-y-5">
            <div className="flex justify-end">
                <Button size="small" type="text" icon={<RotateCcw className="size-3.5" />} onClick={reset}>
                    恢复全部可用范围
                </Button>
            </div>

            {sourceError ? <Alert type="warning" showIcon message="当前选择需要调整" description={`${sourceError}。可重新选择，或采用全部可用范围。`} /> : null}

            {source.operations?.length ? (
                <CapabilityBlock title="生成方式">
                    <Select
                        className="w-full"
                        mode="multiple"
                        value={current.operations || []}
                        options={source.operations.map((operation) => ({ value: operation, label: operationLabel(operation) }))}
                        placeholder="选择创作端可用的生成方式"
                        onChange={(operations) => update({ operations })}
                    />
                </CapabilityBlock>
            ) : null}

            {sourceInputs.length ? (
                <CapabilityBlock title="参考素材">
                    <div className="divide-y divide-border">
                        {sourceInputs.map((definition) => {
                            const limit = source.inputs![definition.name];
                            const selected = current.inputs?.[definition.name];
                            return (
                                <div key={definition.name} className="grid grid-cols-12 items-center gap-2 py-3 first:pt-0 last:pb-0">
                                    <div className="col-span-12 sm:col-span-5">
                                        <div className="text-sm font-medium">{definition.label}</div>
                                        <div className="text-xs text-foreground/45">
                                            线路支持 {limit.min}-{limit.max} {definition.unit}
                                        </div>
                                    </div>
                                    <div className="col-span-12 sm:col-span-1">
                                        <Switch size="small" checked={Boolean(selected)} onChange={(enabled) => updateInput(current, definition.name, enabled ? limit : undefined, update)} />
                                    </div>
                                    <div className="col-span-6 sm:col-span-3">
                                        <NumberInput
                                            label="最少"
                                            unit={definition.unit}
                                            value={selected?.min}
                                            min={limit.min}
                                            max={selected?.max ?? limit.max}
                                            disabled={!selected}
                                            onChange={(next) => updateInput(current, definition.name, { min: next ?? limit.min, max: selected?.max ?? limit.max }, update)}
                                        />
                                    </div>
                                    <div className="col-span-6 sm:col-span-3">
                                        <NumberInput
                                            label="最多"
                                            unit={definition.unit}
                                            value={selected?.max}
                                            min={selected?.min ?? limit.min}
                                            max={limit.max}
                                            disabled={!selected}
                                            onChange={(next) => updateInput(current, definition.name, { min: selected?.min ?? limit.min, max: next ?? limit.max }, update)}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </CapabilityBlock>
            ) : null}

            {sourceOptions.length ? (
                <CapabilityBlock title="生成参数">
                    <div className="divide-y divide-border">
                        {sourceOptions.map((definition) => (
                            <OptionRuleEditor
                                key={definition.name}
                                definition={definition}
                                source={source.options![definition.name]}
                                value={current.options?.[definition.name]}
                                onChange={(constraint) => updateOption(current, definition.name, constraint, update)}
                            />
                        ))}
                    </div>
                </CapabilityBlock>
            ) : null}

            {!sourceInputs.length && !sourceOptions.length && !source.operations?.length ? <Alert type="info" showIcon message="该类型暂无额外能力参数" description="线路仍可按优先级和权重参与路由。" /> : null}
        </div>
    );
}

export function DefaultOptionsEditor({ spec, value, onChange }: { spec?: CapabilitySpec; value?: Record<string, unknown>; onChange?: (value: Record<string, Scalar>) => void }) {
    const options = optionDefinitions[spec?.capability || "text"].filter((item) => spec?.options?.[item.name]);
    if (!options.length) return <div className="rounded-md bg-muted/20 px-3 py-2 text-xs text-foreground/50">当前能力没有需要设置的默认参数。</div>;
    return (
        <div className="divide-y divide-border">
            {options.map((definition) => {
                const constraint = spec!.options![definition.name];
                const selected = value?.[definition.name] as Scalar | undefined;
                return (
                    <div key={definition.name} className="grid grid-cols-12 items-center gap-2 py-3 first:pt-0 last:pb-0">
                        <div className="col-span-12 sm:col-span-5">
                            <div className="text-sm font-medium">{definition.label}</div>
                            <div className="text-xs text-foreground/45">留空时由创作端或线路默认值决定</div>
                        </div>
                        <div className="col-span-12 sm:col-span-7">
                            <ConstraintValueInput
                                constraint={constraint}
                                value={selected}
                                allowClear
                                onChange={(next) => {
                                    const defaults = { ...(value || {}) } as Record<string, Scalar>;
                                    if (next === undefined) delete defaults[definition.name];
                                    else defaults[definition.name] = next;
                                    onChange?.(defaults);
                                }}
                            />
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

export function CapabilityRequestEditor({
    spec,
    inputs,
    options,
    onInputsChange,
    onOptionsChange,
}: {
    spec: CapabilitySpec;
    inputs: Record<string, number>;
    options: Record<string, unknown>;
    onInputsChange: (value: Record<string, number>) => void;
    onOptionsChange: (value: Record<string, unknown>) => void;
}) {
    const inputItems = inputDefinitions[spec.capability].filter((item) => spec.inputs?.[item.name]);
    const optionItems = optionDefinitions[spec.capability].filter((item) => spec.options?.[item.name]);
    return (
        <div className="space-y-4">
            {inputItems.length ? (
                <CapabilityBlock title="实际输入数量">
                    <div className="grid gap-2 sm:grid-cols-2">
                        {inputItems.map((definition) => {
                            const constraint = spec.inputs![definition.name];
                            return (
                                <NumberInput
                                    key={definition.name}
                                    label={definition.label}
                                    unit={definition.unit}
                                    value={inputs[definition.name] ?? constraint.min}
                                    min={constraint.min}
                                    max={constraint.max}
                                    onChange={(next) => onInputsChange({ ...inputs, [definition.name]: next ?? constraint.min })}
                                />
                            );
                        })}
                    </div>
                </CapabilityBlock>
            ) : null}
            {optionItems.length ? (
                <CapabilityBlock title="请求参数">
                    <div className="grid gap-2 sm:grid-cols-2">
                        {optionItems.map((definition) => {
                            const constraint = spec.options![definition.name];
                            return (
                                <label key={definition.name} className="min-w-0">
                                    <span className="mb-1 block text-xs text-foreground/45">
                                        {definition.label}
                                        {definition.unit ? ` (${definition.unit})` : ""}
                                    </span>
                                    <ConstraintValueInput
                                        constraint={constraint}
                                        value={options[definition.name] as Scalar | undefined}
                                        allowClear
                                        onChange={(next) => {
                                            const result = { ...options };
                                            if (next === undefined) delete result[definition.name];
                                            else result[definition.name] = next;
                                            onOptionsChange(result);
                                        }}
                                    />
                                </label>
                            );
                        })}
                    </div>
                </CapabilityBlock>
            ) : null}
            {!inputItems.length && !optionItems.length ? <div className="rounded-md bg-muted/20 px-3 py-2 text-xs text-foreground/50">该模型没有额外请求参数。</div> : null}
        </div>
    );
}

export function CapabilitySummary({ spec }: { spec: CapabilitySpec }) {
    const labels: string[] = [];
    for (const definition of inputDefinitions[spec.capability]) {
        const input = spec.inputs?.[definition.name];
        if (input) {
            const minimum = Number.isFinite(input.min) ? input.min : 0;
            const maximum = Number.isFinite(input.max) ? input.max : minimum;
            labels.push(`${definition.label} ${minimum}-${maximum}${definition.unit}`);
        }
    }
    for (const definition of optionDefinitions[spec.capability]) {
        const option = spec.options?.[definition.name];
        if (!option) continue;
        labels.push(option.values ? `${definition.label} ${option.values.map(scalarLabel).join("/")}` : `${definition.label} ${option.min}-${option.max}${definition.unit || ""}`);
    }
    if (spec.operations?.length) labels.unshift(spec.operations.map(operationLabel).join("/"));
    if (!labels.length) return <span className="text-xs text-foreground/45">基础能力</span>;
    return (
        <div className="flex min-w-0 max-w-full flex-wrap gap-1">
            {labels.slice(0, 4).map((label) => (
                <Tag key={label} className="admin-capability-summary-tag max-w-full whitespace-normal break-all text-left leading-5">
                    {label}
                </Tag>
            ))}
            {labels.length > 4 ? <Tag className="admin-capability-summary-tag shrink-0">+{labels.length - 4}</Tag> : null}
        </div>
    );
}

export function sanitizeDefaults(spec: CapabilitySpec, defaults: Record<string, unknown> | undefined) {
    const result: Record<string, Scalar> = {};
    for (const [name, rawValue] of Object.entries(defaults || {})) {
        const constraint = spec.options?.[name];
        if (!constraint || !constraintIncludes(constraint, rawValue)) continue;
        // `*` 是能力匹配用的通配符，不是可发送给模型的默认参数。
        if (scalarKey(rawValue) === "*") {
            const concrete = constraint.values?.find((item) => scalarKey(item) !== "*");
            if (concrete !== undefined) result[name] = normalizeScalar(concrete) as Scalar;
            continue;
        }
        result[name] = normalizeScalar(rawValue) as Scalar;
    }
    return result;
}

function CapabilityBlock({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="space-y-2">
            <div className="text-xs font-semibold text-foreground/65">{title}</div>
            {children}
        </section>
    );
}

function OptionRuleEditor({ definition, source, value, onChange }: { definition: { name: string; label: string; unit?: string }; source: OptionConstraint; value?: OptionConstraint; onChange: (value?: OptionConstraint) => void }) {
    return (
        <div className="grid grid-cols-12 items-center gap-2 py-3 first:pt-0 last:pb-0">
            <div className="col-span-12 sm:col-span-5">
                <div className="text-sm font-medium">{definition.label}</div>
                <div className="text-xs text-foreground/45">{constraintSummary(source, definition.unit)}</div>
            </div>
            <div className="col-span-12 sm:col-span-1">
                <Switch size="small" checked={Boolean(value)} onChange={(enabled) => onChange(enabled ? source : undefined)} />
            </div>
            <div className="col-span-12 sm:col-span-6">
                {source.values ? (
                    <Select
                        className="w-full"
                        mode="multiple"
                        disabled={!value}
                        value={(value?.values || []).map(scalarKey)}
                        options={source.values.map((item) => ({ value: scalarKey(item), label: scalarLabel(item) }))}
                        onChange={(keys) => onChange({ values: keys.map((key) => normalizeScalar(source.values!.find((item) => scalarKey(item) === key)) as Scalar) })}
                    />
                ) : (
                    <div className="grid grid-cols-3 gap-2">
                        <label>
                            <span className="mb-1 block text-xs text-foreground/45">最小值</span>
                            <InputNumber
                                className="w-full"
                                disabled={!value}
                                min={source.min}
                                max={value?.max ?? source.max}
                                value={value?.min}
                                onChange={(next) => onChange({ ...value, min: next ?? source.min, max: value?.max ?? source.max, step: value?.step ?? source.step })}
                            />
                        </label>
                        <label>
                            <span className="mb-1 block text-xs text-foreground/45">最大值</span>
                            <InputNumber
                                className="w-full"
                                disabled={!value}
                                min={value?.min ?? source.min}
                                max={source.max}
                                value={value?.max}
                                onChange={(next) => onChange({ ...value, min: value?.min ?? source.min, max: next ?? source.max, step: value?.step ?? source.step })}
                            />
                        </label>
                        <label>
                            <span className="mb-1 block text-xs text-foreground/45">调整步长</span>
                            <InputNumber
                                className="w-full"
                                disabled={!value}
                                min={source.step || 0.000001}
                                max={source.max}
                                value={value?.step}
                                onChange={(next) => onChange({ ...value, min: value?.min ?? source.min, max: value?.max ?? source.max, step: next ?? source.step })}
                            />
                        </label>
                    </div>
                )}
            </div>
        </div>
    );
}

function ConstraintValueInput({ constraint, value, allowClear, onChange }: { constraint: OptionConstraint; value?: Scalar; allowClear?: boolean; onChange: (value?: Scalar) => void }) {
    if (constraint.values) {
        return (
            <Select
                className="w-full"
                allowClear={allowClear}
                value={value === undefined ? undefined : scalarKey(value)}
                options={constraint.values.map((item) => ({ value: scalarKey(item), label: scalarLabel(item) }))}
                onChange={(key) => onChange(key === undefined ? undefined : (normalizeScalar(constraint.values!.find((item) => scalarKey(item) === key)) as Scalar))}
            />
        );
    }
    return <InputNumber className="w-full" min={constraint.min} max={constraint.max} step={constraint.step} value={typeof value === "number" ? value : undefined} onChange={(next) => onChange(next ?? undefined)} />;
}

function NumberInput({ label, unit, value, min, max, disabled, onChange }: { label: string; unit: string; value?: number; min?: number; max?: number; disabled?: boolean; onChange: (value: number | null) => void }) {
    return (
        <label className="min-w-0">
            <span className="mb-1 block text-xs text-foreground/45">
                {label} ({unit})
            </span>
            <InputNumber className="w-full" precision={0} disabled={disabled} value={value} min={min} max={max} onChange={onChange} />
        </label>
    );
}

function updateInput(current: CapabilitySpec, name: string, constraint: { min: number; max: number } | undefined, update: (patch: Partial<CapabilitySpec>) => void) {
    const inputs = { ...(current.inputs || {}) };
    if (constraint) inputs[name] = constraint;
    else delete inputs[name];
    update({ inputs });
}

function updateOption(current: CapabilitySpec, name: string, constraint: OptionConstraint | undefined, update: (patch: Partial<CapabilitySpec>) => void) {
    const options = { ...(current.options || {}) };
    if (constraint) options[name] = constraint;
    else delete options[name];
    update({ options });
}

function compactInputs(values: Record<string, { min: number; max: number }>) {
    return Object.fromEntries(Object.entries(values).filter(([, constraint]) => constraint.max > 0 || constraint.min > 0));
}

function compactOptions(values: Record<string, OptionConstraint | undefined>) {
    return Object.fromEntries(Object.entries(values).filter((entry): entry is [string, OptionConstraint] => Boolean(entry[1])));
}

function uniqueScalars(values: unknown[]) {
    const byKey = new Map(values.map((value) => [scalarKey(value), value]));
    return Array.from(byKey.values());
}

function widestCoveredInputRange(constraints: Array<{ min: number; max: number }>) {
    const sorted = [...constraints].sort((left, right) => left.min - right.min || left.max - right.max);
    const merged: Array<{ min: number; max: number }> = [];
    for (const constraint of sorted) {
        const previous = merged.at(-1);
        if (previous && constraint.min <= previous.max + 1) previous.max = Math.max(previous.max, constraint.max);
        else merged.push({ ...constraint });
    }
    return merged.reduce((best, current) => {
        const bestSize = best.max - best.min;
        const currentSize = current.max - current.min;
        return currentSize > bestSize || (currentSize === bestSize && current.min < best.min) ? current : best;
    });
}

function preferredSourceConstraint(constraints: OptionConstraint[]) {
    return constraints.reduce((best, current) => (constraintBreadth(current) > constraintBreadth(best) ? current : best));
}

function constraintBreadth(constraint: OptionConstraint) {
    if (constraint.values) return constraint.values.length;
    if (constraint.min === undefined || constraint.max === undefined) return 0;
    if (!constraint.step) return constraint.max - constraint.min + 1;
    return Math.floor((constraint.max - constraint.min) / constraint.step + 1e-9) + 1;
}

function scalarKey(value: unknown) {
    const normalized = normalizeScalar(value);
    return `${typeof normalized}:${String(normalized)}`;
}

function scalarLabel(value: unknown) {
    const normalized = normalizeScalar(value);
    if (normalized === true) return "支持";
    if (normalized === false) return "不启用";
    if (normalized === "*") return "自定义";
    return String(normalized);
}

function normalizeScalar(value: unknown) {
    if (typeof value === "string" && value.startsWith("string:")) return value.slice("string:".length);
    return value;
}

export function operationLabel(value: string) {
    return (
        {
            text_to_video: "文生视频",
            image_to_video: "图生视频",
            reference_to_video: "全模态参考",
            extend: "视频续写",
            inpaint: "局部修改",
            replace_element: "元素替换",
            camera_motion: "运镜调整",
            style_transfer: "风格迁移",
            audio_to_video: "音频生视频",
        }[value] || value
    );
}

function inputLabel(capability: CapabilityKind, name: string) {
    return inputDefinitions[capability].find((item) => item.name === name)?.label || name;
}

function optionLabel(capability: CapabilityKind, name: string) {
    return optionDefinitions[capability].find((item) => item.name === name)?.label || name;
}

function constraintSummary(constraint: OptionConstraint, unit = "") {
    if (constraint.values) return `线路支持 ${constraint.values.map(scalarLabel).join("、")}`;
    return `线路支持 ${constraint.min}-${constraint.max}${unit}${constraint.step ? `，步进 ${constraint.step}` : ""}`;
}

function constraintIncludes(constraint: OptionConstraint, value: unknown) {
    if (isWildcardConstraint(constraint)) return true;
    if (constraint.values) return constraint.values.some((item) => scalarKey(item) === scalarKey(value));
    if (typeof value !== "number") return false;
    if ((constraint.min !== undefined && value < constraint.min - 1e-9) || (constraint.max !== undefined && value > constraint.max + 1e-9)) return false;
    if (!constraint.step || constraint.min === undefined) return true;
    return approximatelyInteger((value - constraint.min) / constraint.step);
}

function inputConstraintCovered(candidate: { min: number; max: number }, name: string, sourceSpecs: CapabilitySpec[]) {
    let next = candidate.min;
    while (next <= candidate.max) {
        let coveredUntil = next - 1;
        for (const spec of sourceSpecs) {
            const constraint = spec.inputs?.[name] || { min: 0, max: 0 };
            if (constraint.min <= next && constraint.max >= next && constraint.max > coveredUntil) coveredUntil = constraint.max;
        }
        if (coveredUntil < next) return false;
        next = coveredUntil + 1;
    }
    return true;
}

function optionConstraintCovered(candidate: OptionConstraint, name: string, sourceSpecs: CapabilitySpec[]) {
    const constraints = sourceSpecs.map((item) => item.options?.[name]).filter((item): item is OptionConstraint => Boolean(item));
    if (!constraints.length) return false;
    if (constraints.some(isWildcardConstraint)) return true;
    if (candidate.values) return candidate.values.every((value) => optionValueSupported(value, constraints));
    if (candidate.min === undefined || candidate.max === undefined) return false;
    if (Math.abs(candidate.max - candidate.min) < 1e-9) return optionValueSupported(candidate.min, constraints);
    if (candidate.step === undefined) return continuousOptionRangeCovered(candidate.min, candidate.max, constraints);
    if (candidate.step <= 0) return false;
    const count = Math.floor((candidate.max - candidate.min) / candidate.step + 1e-9) + 1;
    if (count <= 10_000) {
        for (let index = 0; index < count; index += 1) {
            if (!optionValueSupported(candidate.min + index * candidate.step, constraints)) return false;
        }
        return true;
    }
    const candidateMin = candidate.min;
    const candidateMax = candidate.max;
    const candidateStep = candidate.step;
    return constraints.some((constraint) => {
        if (constraint.min === undefined || constraint.max === undefined || constraint.min > candidateMin || constraint.max < candidateMax) return false;
        if (!constraint.step) return true;
        return approximatelyInteger((candidateMin - constraint.min) / constraint.step) && approximatelyInteger(candidateStep / constraint.step);
    });
}

function optionValueSupported(value: unknown, constraints: OptionConstraint[]) {
    return constraints.some((constraint) => constraintIncludes(constraint, value));
}

function continuousOptionRangeCovered(minimum: number, maximum: number, constraints: OptionConstraint[]) {
    const ranges = constraints
        .filter((constraint) => constraint.min !== undefined && constraint.max !== undefined && constraint.step === undefined)
        .map((constraint) => ({ min: constraint.min!, max: constraint.max! }))
        .sort((left, right) => left.min - right.min);
    let coveredUntil = minimum;
    let started = false;
    for (const range of ranges) {
        if (range.max < minimum - 1e-9) continue;
        if (!started) {
            if (range.min > minimum + 1e-9) return false;
            coveredUntil = Math.max(coveredUntil, range.max);
            started = true;
        } else if (range.min <= coveredUntil + 1e-9) {
            coveredUntil = Math.max(coveredUntil, range.max);
        } else {
            break;
        }
        if (coveredUntil >= maximum - 1e-9) return true;
    }
    return false;
}

function isWildcardConstraint(constraint: OptionConstraint) {
    return constraint.values?.some((value) => normalizeScalar(value) === "*") || false;
}

function approximatelyInteger(value: number) {
    return Math.abs(value - Math.round(value)) < 1e-9;
}
