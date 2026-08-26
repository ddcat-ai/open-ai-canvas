import { Input, InputNumber, Segmented, Select, Switch } from "antd";
import type { ReactNode } from "react";

import { defaultImageCapabilityConfig, defaultModelCapabilityConfig, normalizeModelCapabilityConfig, type ImageCapabilityConfig, type ModelCapabilityConfig, type TextCapabilityConfig, type VideoCapabilityConfig } from "@/lib/model-capabilities";
import type { ModelProtocol } from "@/lib/model-protocols";
import { VIDEO_RESOLUTION_CAPABILITY_OPTIONS } from "@/lib/video-generation-options";

const ratioOptions = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];
const operationOptions = [
    { label: "文生视频", value: "text_to_video" },
    { label: "图生视频", value: "image_to_video" },
    { label: "全模态参考", value: "reference_to_video" },
    { label: "视频续写", value: "extend" },
    { label: "局部修改", value: "inpaint" },
    { label: "元素替换", value: "replace_element" },
    { label: "运镜调整", value: "camera_motion" },
    { label: "风格迁移", value: "style_transfer" },
    { label: "音频生视频", value: "audio_to_video" },
];

type Props = {
    value?: ModelCapabilityConfig;
    onChange?: (value: ModelCapabilityConfig) => void;
    protocol?: ModelProtocol;
    capability?: "text" | "image" | "video";
    model?: string;
    disabled?: boolean;
    section?: "all" | "protocol" | "references";
};

export function ModelCapabilityEditor({ value, onChange, protocol, capability = "video", model = "", disabled = false, section = "all" }: Props) {
    if (capability === "text") {
        return <TextCapabilityEditor value={value} onChange={onChange} protocol={protocol} disabled={disabled} section={section} />;
    }
    if (capability === "image") {
        return <ImageCapabilityEditor value={value} onChange={onChange} protocol={protocol} model={model} disabled={disabled} section={section} />;
    }
    const profile = normalizeModelCapabilityConfig(value || defaultModelCapabilityConfig(protocol)).video!;
    const update = (patch: Partial<VideoCapabilityConfig>) => onChange?.({ version: 1, video: { ...profile, ...patch } });
    const updateReferences = (patch: Partial<VideoCapabilityConfig["references"]>) => update({ references: { ...profile.references, ...patch } });
    const updateDuration = (patch: Partial<VideoCapabilityConfig["duration"]>) => update({ duration: { ...profile.duration, ...patch } });
    const durationValues = (profile.duration.values || []).join(",");
    const resolutionOptions = Array.from(new Set([...VIDEO_RESOLUTION_CAPABILITY_OPTIONS, ...profile.resolutions]));

    if (section === "references") {
        return (
            <div className="admin-capability-reference-editor">
                <div className="admin-capability-reference-grid">
                    <ReferenceCard title="图片引用" description="首帧、参考图与多图输入限制">
                        <NumberField label="最少图片引用" value={profile.references.minImages} min={0} max={profile.references.maxImages} disabled={disabled} onChange={(value) => updateReferences({ minImages: value || 0 })} />
                        <NumberField
                            label="最大图片引用"
                            value={profile.references.maxImages}
                            min={0}
                            disabled={disabled}
                            onChange={(value) => {
                                const maxImages = value || 0;
                                updateReferences({ maxImages, minImages: Math.min(profile.references.minImages, maxImages) });
                            }}
                        />
                        <NumberField label="单张图片上限 MB" value={bytesToMB(profile.references.maxImageBytes)} min={0} disabled={disabled} onChange={(value) => updateReferences({ maxImageBytes: mbToBytes(value) })} />
                    </ReferenceCard>
                    <ReferenceCard title="音频引用" description="音频输入与同步输出限制">
                        <NumberField label="最大音频引用" value={profile.references.maxAudios} min={0} disabled={disabled} onChange={(value) => updateReferences({ maxAudios: value || 0 })} />
                        <NumberField label="单个音频上限 MB" value={bytesToMB(profile.references.maxAudioBytes)} min={0} disabled={disabled} onChange={(value) => updateReferences({ maxAudioBytes: mbToBytes(value) })} />
                        <NumberField label="单个音频最长秒数" value={profile.references.maxAudioDurationSeconds} min={0} disabled={disabled} onChange={(value) => updateReferences({ maxAudioDurationSeconds: value || 0 })} />
                        <BooleanField label="同步音频" value={profile.generateAudio} disabled={disabled} onChange={(generateAudio) => update({ generateAudio })} />
                    </ReferenceCard>
                    <ReferenceCard title="视频引用" description="视频数量、大小与时长限制">
                        <NumberField label="最大视频引用" value={profile.references.maxVideos} min={0} disabled={disabled} onChange={(value) => updateReferences({ maxVideos: value || 0 })} />
                        <NumberField label="单个视频上限 MB" value={bytesToMB(profile.references.maxVideoBytes)} min={0} disabled={disabled} onChange={(value) => updateReferences({ maxVideoBytes: mbToBytes(value) })} />
                        <NumberField label="单个视频最长秒数" value={profile.references.maxVideoDurationSeconds} min={0} disabled={disabled} onChange={(value) => updateReferences({ maxVideoDurationSeconds: value || 0 })} />
                    </ReferenceCard>
                    <ReferenceCard title="通用限制" description="所有视频请求共用的基础约束">
                        <NumberField label="提示词最大字符数" value={profile.references.promptMaxChars} min={1} disabled={disabled} onChange={(value) => updateReferences({ promptMaxChars: value || 1 })} />
                        <BooleanField label="水印" value={profile.watermark} disabled={disabled} onChange={(watermark) => update({ watermark })} />
                    </ReferenceCard>
                </div>
            </div>
        );
    }

    if (section === "protocol") {
        return (
            <div className="admin-capability-protocol-editor">
                <div className="admin-capability-protocol-grid">
                    <ProtocolParameterCard step="01" title="生成方式" description="允许的任务类型与默认任务">
                        <Field label="支持模式">
                            <Select
                                mode="multiple"
                                className="w-full"
                                disabled={disabled}
                                value={profile.operations}
                                options={operationOptions}
                                onChange={(operations) => update({ operations, defaultOperation: operations.includes(profile.defaultOperation) ? profile.defaultOperation : operations[0] || "text_to_video" })}
                            />
                        </Field>
                        <Field label="默认模式">
                            <Select
                                className="w-full"
                                disabled={disabled}
                                value={profile.defaultOperation}
                                options={operationOptions.filter((item) => profile.operations.includes(item.value))}
                                onChange={(defaultOperation) => update({ defaultOperation })}
                            />
                        </Field>
                    </ProtocolParameterCard>
                    <ProtocolParameterCard step="02" title="输出时长" description="定义可用秒数及默认时长">
                        <Segmented
                            block
                            disabled={disabled}
                            value={profile.duration.selection}
                            options={[
                                { label: "范围", value: "range" },
                                { label: "固定值", value: "enum" },
                            ]}
                            onChange={(value) =>
                                updateDuration(
                                    value === "enum"
                                        ? { selection: "enum", values: profile.duration.values?.length ? profile.duration.values : [profile.duration.default] }
                                        : { selection: "range", min: profile.duration.min || 1, max: profile.duration.max || 15, step: profile.duration.step || 1 },
                                )
                            }
                        />
                        {profile.duration.selection === "enum" ? (
                            <Field label="固定时长（秒）">
                                <Input
                                    disabled={disabled}
                                    value={durationValues}
                                    placeholder="例如：5,10"
                                    onChange={(event) => updateDuration({ values: parseIntegerList(event.target.value), default: parseIntegerList(event.target.value)[0] || profile.duration.default })}
                                />
                            </Field>
                        ) : (
                            <div className="admin-capability-duration-grid">
                                <NumberField label="最短" value={profile.duration.min} min={1} disabled={disabled} onChange={(value) => updateDuration({ min: value || 1 })} />
                                <NumberField label="最长" value={profile.duration.max} min={1} disabled={disabled} onChange={(value) => updateDuration({ max: value || 1 })} />
                                <NumberField label="步长" value={profile.duration.step} min={1} disabled={disabled} onChange={(value) => updateDuration({ step: value || 1 })} />
                                <NumberField label="默认" value={profile.duration.default} min={1} disabled={disabled} onChange={(value) => updateDuration({ default: value || 1 })} />
                            </div>
                        )}
                    </ProtocolParameterCard>
                    <ProtocolParameterCard step="03" title="画面规格" description="控制比例、分辨率及默认输出">
                        <div className="admin-capability-spec-grid">
                            <Field label="支持比例">
                                <Select
                                    mode="multiple"
                                    className="w-full"
                                    disabled={disabled}
                                    value={profile.ratios}
                                    options={ratioOptions.map((item) => ({ label: item, value: item }))}
                                    onChange={(ratios) => update({ ratios, defaultRatio: ratios.includes(profile.defaultRatio) ? profile.defaultRatio : ratios[0] || "16:9" })}
                                />
                            </Field>
                            <Field label="默认比例">
                                <Select className="w-full" disabled={disabled} value={profile.defaultRatio} options={profile.ratios.map((item) => ({ label: item, value: item }))} onChange={(defaultRatio) => update({ defaultRatio })} />
                            </Field>
                            <Field label="输出分辨率">
                                <Select
                                    mode="tags"
                                    className="admin-capability-tags w-full"
                                    disabled={disabled}
                                    value={profile.resolutions}
                                    tokenSeparators={[","]}
                                    placeholder="选择或输入模型档位"
                                    options={resolutionOptions.map((item) => ({ label: item.toUpperCase(), value: item }))}
                                    onChange={(resolutions) => update({ resolutions, defaultResolution: resolutions.includes(profile.defaultResolution) ? profile.defaultResolution : resolutions[0] || "" })}
                                />
                            </Field>
                            <Field label="默认分辨率">
                                <Select
                                    className="w-full"
                                    disabled={disabled}
                                    value={profile.defaultResolution}
                                    options={profile.resolutions.map((item) => ({ label: item.toUpperCase(), value: item }))}
                                    onChange={(defaultResolution) => update({ defaultResolution })}
                                />
                            </Field>
                        </div>
                    </ProtocolParameterCard>
                </div>
            </div>
        );
    }

    return (
        <div className="admin-capability-editor space-y-3 rounded-md bg-muted/10 p-3">
            <div className="admin-capability-editor-heading flex flex-wrap items-start justify-between gap-2">
                <div>
                    <div className="text-sm font-medium">视频能力参数</div>
                    <div className="mt-0.5 text-[var(--fs-tiny)] text-foreground/48">这些参数会同步到创造页、画布和生成校验</div>
                </div>
                <span className="text-[var(--fs-tiny)] text-foreground/40">协议模板可继续调整</span>
            </div>

            <CapabilityGroup title="视频" description="生成方式、输出规格与视频引用约束">
                <CapabilityBlock title="生成方式">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="支持模式">
                            <Select
                                mode="multiple"
                                className="w-full"
                                disabled={disabled}
                                value={profile.operations}
                                options={operationOptions}
                                onChange={(operations) => update({ operations, defaultOperation: operations.includes(profile.defaultOperation) ? profile.defaultOperation : operations[0] || "text_to_video" })}
                            />
                        </Field>
                        <Field label="默认模式">
                            <Select
                                className="w-full"
                                disabled={disabled}
                                value={profile.defaultOperation}
                                options={operationOptions.filter((item) => profile.operations.includes(item.value))}
                                onChange={(defaultOperation) => update({ defaultOperation })}
                            />
                        </Field>
                    </div>
                </CapabilityBlock>
                <CapabilityBlock title="输出时长">
                    <Segmented
                        block
                        disabled={disabled}
                        value={profile.duration.selection}
                        options={[
                            { label: "范围", value: "range" },
                            { label: "固定值", value: "enum" },
                        ]}
                        onChange={(value) =>
                            updateDuration(
                                value === "enum"
                                    ? { selection: "enum", values: profile.duration.values?.length ? profile.duration.values : [profile.duration.default] }
                                    : { selection: "range", min: profile.duration.min || 1, max: profile.duration.max || 15, step: profile.duration.step || 1 },
                            )
                        }
                    />
                    {profile.duration.selection === "enum" ? (
                        <Field label="固定时长（秒）">
                            <Input
                                disabled={disabled}
                                value={durationValues}
                                placeholder="例如：5,10"
                                onChange={(event) => updateDuration({ values: parseIntegerList(event.target.value), default: parseIntegerList(event.target.value)[0] || profile.duration.default })}
                            />
                        </Field>
                    ) : (
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            <NumberField label="最短" value={profile.duration.min} min={1} disabled={disabled} onChange={(value) => updateDuration({ min: value || 1 })} />
                            <NumberField label="最长" value={profile.duration.max} min={1} disabled={disabled} onChange={(value) => updateDuration({ max: value || 1 })} />
                            <NumberField label="步长" value={profile.duration.step} min={1} disabled={disabled} onChange={(value) => updateDuration({ step: value || 1 })} />
                            <NumberField label="默认" value={profile.duration.default} min={1} disabled={disabled} onChange={(value) => updateDuration({ default: value || 1 })} />
                        </div>
                    )}
                </CapabilityBlock>
                <CapabilityBlock title="画面规格">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="画面比例">
                            <Select
                                mode="multiple"
                                className="w-full"
                                disabled={disabled}
                                value={profile.ratios}
                                options={ratioOptions.map((item) => ({ label: item, value: item }))}
                                onChange={(ratios) => update({ ratios, defaultRatio: ratios.includes(profile.defaultRatio) ? profile.defaultRatio : ratios[0] || "16:9" })}
                            />
                        </Field>
                        <Field label="默认比例">
                            <Select className="w-full" disabled={disabled} value={profile.defaultRatio} options={profile.ratios.map((item) => ({ label: item, value: item }))} onChange={(defaultRatio) => update({ defaultRatio })} />
                        </Field>
                        <Field label="输出分辨率">
                            <Select
                                mode="tags"
                                className="admin-capability-tags w-full"
                                disabled={disabled}
                                value={profile.resolutions}
                                tokenSeparators={[","]}
                                placeholder="选择标准档位或输入 768p 等模型专属值"
                                options={resolutionOptions.map((item) => ({ label: item.toUpperCase(), value: item }))}
                                onChange={(resolutions) => update({ resolutions, defaultResolution: resolutions.includes(profile.defaultResolution) ? profile.defaultResolution : resolutions[0] || "" })}
                            />
                        </Field>
                        <Field label="默认分辨率">
                            <Select
                                className="w-full"
                                disabled={disabled}
                                value={profile.defaultResolution}
                                options={profile.resolutions.map((item) => ({ label: item.toUpperCase(), value: item }))}
                                onChange={(defaultResolution) => update({ defaultResolution })}
                            />
                        </Field>
                    </div>
                </CapabilityBlock>
                {section === "all" ? (
                    <CapabilityBlock title="视频引用">
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                            <NumberField label="最大视频引用" value={profile.references.maxVideos} min={0} disabled={disabled} onChange={(value) => updateReferences({ maxVideos: value || 0 })} />
                            <NumberField label="单个视频上限 MB" value={bytesToMB(profile.references.maxVideoBytes)} min={0} disabled={disabled} onChange={(value) => updateReferences({ maxVideoBytes: mbToBytes(value) })} />
                            <NumberField label="单个视频最长秒数" value={profile.references.maxVideoDurationSeconds} min={0} disabled={disabled} onChange={(value) => updateReferences({ maxVideoDurationSeconds: value || 0 })} />
                        </div>
                    </CapabilityBlock>
                ) : null}
            </CapabilityGroup>

            {section === "all" ? (
                <>
                    <CapabilityGroup title="图片" description="首帧、参考图与多图输入约束">
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                            <NumberField label="最少图片引用" value={profile.references.minImages} min={0} max={profile.references.maxImages} disabled={disabled} onChange={(value) => updateReferences({ minImages: value || 0 })} />
                            <NumberField
                                label="最大图片引用"
                                value={profile.references.maxImages}
                                min={0}
                                disabled={disabled}
                                onChange={(value) => {
                                    const maxImages = value || 0;
                                    updateReferences({ maxImages, minImages: Math.min(profile.references.minImages, maxImages) });
                                }}
                            />
                            <NumberField label="单张图片上限 MB" value={bytesToMB(profile.references.maxImageBytes)} min={0} disabled={disabled} onChange={(value) => updateReferences({ maxImageBytes: mbToBytes(value) })} />
                        </div>
                    </CapabilityGroup>

                    <CapabilityGroup title="音频" description="音频引用与视频同步音频输出">
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                            <NumberField label="最大音频引用" value={profile.references.maxAudios} min={0} disabled={disabled} onChange={(value) => updateReferences({ maxAudios: value || 0 })} />
                            <NumberField label="单个音频上限 MB" value={bytesToMB(profile.references.maxAudioBytes)} min={0} disabled={disabled} onChange={(value) => updateReferences({ maxAudioBytes: mbToBytes(value) })} />
                            <NumberField label="单个音频最长秒数" value={profile.references.maxAudioDurationSeconds} min={0} disabled={disabled} onChange={(value) => updateReferences({ maxAudioDurationSeconds: value || 0 })} />
                        </div>
                        <BooleanField label="同步音频" value={profile.generateAudio} disabled={disabled} onChange={(generateAudio) => update({ generateAudio })} />
                    </CapabilityGroup>

                    <CapabilityGroup title="通用限制" description="不属于单一媒体类型的请求与输出约束">
                        <div className="grid gap-3 sm:grid-cols-2">
                            <NumberField label="提示词最大字符数" value={profile.references.promptMaxChars} min={1} disabled={disabled} onChange={(value) => updateReferences({ promptMaxChars: value || 1 })} />
                            <BooleanField label="水印" value={profile.watermark} disabled={disabled} onChange={(watermark) => update({ watermark })} />
                        </div>
                    </CapabilityGroup>
                </>
            ) : null}
        </div>
    );
}

function TextCapabilityEditor({ value, onChange, protocol, disabled, section }: Pick<Props, "value" | "onChange" | "protocol" | "disabled" | "section">) {
    const profile = value?.text || defaultModelCapabilityConfig(protocol).text!;
    const updateReferences = (patch: Partial<TextCapabilityConfig["references"]>) => {
        onChange?.({ version: 1, text: { references: { ...profile.references, ...patch } } });
    };

    if (section === "references") {
        return (
            <div className="admin-capability-reference-editor">
                <div className="admin-capability-reference-grid is-three">
                    <ReferenceCard title="图片引用" description="文本模型可接收的图片范围">
                        <NumberField label="最大参考图片数" value={profile.references.maxImages} min={0} max={100} disabled={Boolean(disabled)} onChange={(next) => updateReferences({ maxImages: next || 0 })} />
                        <NumberField label="单张图片上限 MB" value={bytesToMB(profile.references.maxImageBytes)} min={0} disabled={Boolean(disabled)} onChange={(next) => updateReferences({ maxImageBytes: mbToBytes(next) })} />
                    </ReferenceCard>
                    <ReferenceCard title="视频引用" description="文本模型可接收的视频范围">
                        <NumberField label="最大参考视频数" value={profile.references.maxVideos} min={0} max={100} disabled={Boolean(disabled)} onChange={(next) => updateReferences({ maxVideos: next || 0 })} />
                        <NumberField label="单个视频上限 MB" value={bytesToMB(profile.references.maxVideoBytes)} min={0} disabled={Boolean(disabled)} onChange={(next) => updateReferences({ maxVideoBytes: mbToBytes(next) })} />
                    </ReferenceCard>
                    <ReferenceCard title="通用限制" description="所有文本请求共用的基础约束">
                        <NumberField label="提示词最大字符数" value={profile.references.promptMaxChars} min={1} max={1_000_000} disabled={Boolean(disabled)} onChange={(next) => updateReferences({ promptMaxChars: next || 1 })} />
                    </ReferenceCard>
                </div>
            </div>
        );
    }

    return (
        <div className="admin-capability-editor space-y-3 rounded-md bg-muted/20 p-3">
            <div>
                <div className="text-sm font-medium">文本理解能力</div>
                <div className="mt-0.5 text-[var(--fs-tiny)] text-foreground/48">默认不假设支持图片或视频，只有明确配置后相关请求才会进入该模型。</div>
            </div>
            <CapabilityGroup title="图片" description="文本模型可接收的图片参考范围">
                <div className="grid gap-3 sm:grid-cols-2">
                    <NumberField label="最大参考图片数" value={profile.references.maxImages} min={0} max={100} disabled={Boolean(disabled)} onChange={(next) => updateReferences({ maxImages: next || 0 })} />
                    <NumberField label="单张图片上限 MB" value={bytesToMB(profile.references.maxImageBytes)} min={0} disabled={Boolean(disabled)} onChange={(next) => updateReferences({ maxImageBytes: mbToBytes(next) })} />
                </div>
            </CapabilityGroup>
            <CapabilityGroup title="视频" description="文本模型可接收的视频参考范围">
                <div className="grid gap-3 sm:grid-cols-2">
                    <NumberField label="最大参考视频数" value={profile.references.maxVideos} min={0} max={100} disabled={Boolean(disabled)} onChange={(next) => updateReferences({ maxVideos: next || 0 })} />
                    <NumberField label="单个视频上限 MB" value={bytesToMB(profile.references.maxVideoBytes)} min={0} disabled={Boolean(disabled)} onChange={(next) => updateReferences({ maxVideoBytes: mbToBytes(next) })} />
                </div>
            </CapabilityGroup>
            <CapabilityGroup title="通用限制" description="所有文本请求共用的基础约束">
                <NumberField label="提示词最大字符数" value={profile.references.promptMaxChars} min={1} max={1_000_000} disabled={Boolean(disabled)} onChange={(next) => updateReferences({ promptMaxChars: next || 1 })} />
            </CapabilityGroup>
        </div>
    );
}

function ImageCapabilityEditor({ value, onChange, protocol, model, disabled, section }: Required<Pick<Props, "model" | "disabled">> & Pick<Props, "value" | "onChange" | "protocol" | "section">) {
    const profile = normalizeModelCapabilityConfig(value || { version: 1, image: defaultImageCapabilityConfig(protocol, model) }).image!;
    const update = (patch: Partial<ImageCapabilityConfig>) => onChange?.({ version: 1, image: { ...profile, ...patch } });
    const updateReferences = (patch: Partial<ImageCapabilityConfig["references"]>) => update({ references: { ...profile.references, ...patch } });
    const updateSize = (patch: Partial<ImageCapabilityConfig["size"]>) => update({ size: { ...profile.size, ...patch } });
    const updateQuality = (patch: Partial<ImageCapabilityConfig["quality"]>) => update({ quality: { ...profile.quality, ...patch } });

    if (section === "references") {
        return (
            <div className="admin-capability-reference-editor">
                <div className="admin-capability-reference-grid is-two">
                    <ReferenceCard title="图片引用" description="参考图、文件大小与蒙版能力">
                        <NumberField label="最大参考图" value={profile.references.maxImages} min={0} disabled={disabled} onChange={(maxImages) => updateReferences({ maxImages: maxImages || 0 })} />
                        <NumberField label="单图上限 MB" value={bytesToMB(profile.references.maxImageBytes)} min={0} disabled={disabled} onChange={(maxImageBytes) => updateReferences({ maxImageBytes: mbToBytes(maxImageBytes) })} />
                        <ParameterField label="蒙版编辑" description="允许图片编辑接口提交 mask" supported={profile.references.maskSupported} disabled={disabled} onChange={(maskSupported) => updateReferences({ maskSupported })} />
                    </ReferenceCard>
                    <ReferenceCard title="通用限制" description="所有图片请求共用的基础约束">
                        <NumberField label="提示词最大字符数" value={profile.references.promptMaxChars} min={1} disabled={disabled} onChange={(promptMaxChars) => updateReferences({ promptMaxChars: promptMaxChars || 1 })} />
                    </ReferenceCard>
                </div>
            </div>
        );
    }

    if (section === "protocol") {
        return (
            <div className="admin-capability-protocol-editor">
                <div className="admin-capability-protocol-grid">
                    <ProtocolParameterCard step="01" title="输出数量" description="设置单次生成图片数量">
                        <NumberField label="单次生成张数" value={profile.maxOutputs} min={1} disabled={disabled} onChange={(maxOutputs) => update({ maxOutputs: maxOutputs || 1 })} />
                    </ProtocolParameterCard>
                    <ProtocolParameterCard step="02" title="尺寸参数" description="定义尺寸字段、支持值与默认值">
                        <Segmented
                            block
                            disabled={disabled}
                            value={profile.size.parameter}
                            options={[
                                { label: "不发送", value: "none" },
                                { label: "size", value: "size" },
                                { label: "aspect_ratio", value: "aspect_ratio" },
                            ]}
                            onChange={(value) => {
                                const parameter = value as ImageCapabilityConfig["size"]["parameter"];
                                updateSize(
                                    parameter === "none"
                                        ? { parameter, values: [], default: "auto", allowCustom: false }
                                        : { parameter, values: profile.size.values.length ? profile.size.values : ["1:1"], default: profile.size.default === "auto" ? "1:1" : profile.size.default },
                                );
                            }}
                        />
                        {profile.size.parameter !== "none" ? (
                            <>
                                <Field label="支持值">
                                    <Select
                                        mode="tags"
                                        className="admin-capability-tags w-full"
                                        disabled={disabled}
                                        value={profile.size.values}
                                        tokenSeparators={[","]}
                                        placeholder="例如 1:1、1024x1024"
                                        onChange={(values) => updateSize({ values, default: values.includes(profile.size.default) || profile.size.allowCustom ? profile.size.default : values[0] || "auto" })}
                                    />
                                </Field>
                                <Field label="默认值">
                                    <Select
                                        className="w-full"
                                        disabled={disabled}
                                        value={profile.size.default}
                                        options={profile.size.values.map((item) => ({ label: item, value: item }))}
                                        onChange={(defaultValue) => updateSize({ default: defaultValue })}
                                    />
                                </Field>
                                <ParameterField label="允许自定义" description="允许支持值之外的尺寸" supported={profile.size.allowCustom} disabled={disabled} onChange={(allowCustom) => updateSize({ allowCustom })} />
                            </>
                        ) : null}
                    </ProtocolParameterCard>
                    <ProtocolParameterCard step="03" title="可选参数" description="控制质量、背景与响应格式">
                        <ParameterField label="图片质量" description="发送 quality 参数" supported={profile.quality.supported} disabled={disabled} onChange={(supported) => updateQuality({ supported })} />
                        {profile.quality.supported ? (
                            <div className="admin-capability-spec-grid">
                                <Field label="质量支持值">
                                    <Select
                                        mode="tags"
                                        className="admin-capability-tags w-full"
                                        disabled={disabled}
                                        value={profile.quality.values}
                                        tokenSeparators={[","]}
                                        onChange={(values) => updateQuality({ values, default: values.includes(profile.quality.default) ? profile.quality.default : values[0] || "auto" })}
                                    />
                                </Field>
                                <Field label="默认质量">
                                    <Select
                                        className="w-full"
                                        disabled={disabled}
                                        value={profile.quality.default}
                                        options={profile.quality.values.map((item) => ({ label: item, value: item }))}
                                        onChange={(defaultValue) => updateQuality({ default: defaultValue })}
                                    />
                                </Field>
                            </div>
                        ) : null}
                        <BooleanField label="透明背景" value={profile.transparentBackground} disabled={disabled} onChange={(transparentBackground) => update({ transparentBackground })} />
                        <ParameterField label="response_format" description="发送 b64_json 响应格式" supported={profile.responseFormat.supported} disabled={disabled} onChange={(supported) => update({ responseFormat: { supported } })} />
                        <ParameterField label="output_format" description="发送 PNG 输出格式" supported={profile.outputFormat.supported} disabled={disabled} onChange={(supported) => update({ outputFormat: { supported } })} />
                    </ProtocolParameterCard>
                </div>
            </div>
        );
    }

    return (
        <div className="admin-capability-editor space-y-3 rounded-md bg-muted/10 p-3">
            <div className="admin-capability-editor-heading flex flex-wrap items-start justify-between gap-2">
                <div>
                    <div className="text-sm font-medium">图片能力参数</div>
                    <div className="mt-0.5 text-[var(--fs-tiny)] text-foreground/48">生成界面和后端请求都会按此处裁剪参数</div>
                </div>
                <span className="text-[var(--fs-tiny)] text-foreground/40">当前模型独立生效</span>
            </div>

            <CapabilityGroup title="图片" description="参考图、蒙版与图片输入约束">
                <div className="grid gap-3 sm:grid-cols-2">
                    <NumberField label="最大参考图" value={profile.references.maxImages} min={0} disabled={disabled} onChange={(maxImages) => updateReferences({ maxImages: maxImages || 0 })} />
                    <NumberField label="单图上限 MB" value={bytesToMB(profile.references.maxImageBytes)} min={0} disabled={disabled} onChange={(maxImageBytes) => updateReferences({ maxImageBytes: mbToBytes(maxImageBytes) })} />
                </div>
                <ParameterField label="蒙版编辑" description="允许调用图片编辑接口并提交 mask" supported={profile.references.maskSupported} disabled={disabled} onChange={(maskSupported) => updateReferences({ maskSupported })} />
            </CapabilityGroup>

            <CapabilityGroup title="输出规格" description="单次生成数量、尺寸参数与默认值">
                <CapabilityBlock title="生成数量">
                    <NumberField label="单次生成张数" value={profile.maxOutputs} min={1} disabled={disabled} onChange={(maxOutputs) => update({ maxOutputs: maxOutputs || 1 })} />
                </CapabilityBlock>
                <CapabilityBlock title="尺寸参数">
                    <Segmented
                        block
                        disabled={disabled}
                        value={profile.size.parameter}
                        options={[
                            { label: "不发送", value: "none" },
                            { label: "size", value: "size" },
                            { label: "aspect_ratio", value: "aspect_ratio" },
                        ]}
                        onChange={(value) => {
                            const parameter = value as ImageCapabilityConfig["size"]["parameter"];
                            updateSize(
                                parameter === "none"
                                    ? { parameter, values: [], default: "auto", allowCustom: false }
                                    : { parameter, values: profile.size.values.length ? profile.size.values : ["1:1"], default: profile.size.default === "auto" ? "1:1" : profile.size.default },
                            );
                        }}
                    />
                    {profile.size.parameter !== "none" ? (
                        <>
                            <Field label="支持值">
                                <Select
                                    mode="tags"
                                    className="admin-capability-tags w-full"
                                    disabled={disabled}
                                    value={profile.size.values}
                                    tokenSeparators={[","]}
                                    placeholder="例如 1:1、1024x1024"
                                    onChange={(values) => updateSize({ values, default: values.includes(profile.size.default) || profile.size.allowCustom ? profile.size.default : values[0] || "auto" })}
                                />
                            </Field>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <Field label="默认值">
                                    <Select
                                        className="w-full"
                                        disabled={disabled}
                                        value={profile.size.default}
                                        options={profile.size.values.map((item) => ({ label: item, value: item }))}
                                        onChange={(defaultValue) => updateSize({ default: defaultValue })}
                                    />
                                </Field>
                                <ParameterField label="允许自定义" description="允许用户输入支持值之外的尺寸" supported={profile.size.allowCustom} disabled={disabled} onChange={(allowCustom) => updateSize({ allowCustom })} />
                            </div>
                        </>
                    ) : null}
                </CapabilityBlock>
            </CapabilityGroup>

            <CapabilityGroup title="可选参数" description="质量、背景与响应格式等非必填能力">
                <ParameterField label="图片质量" description="发送 quality 参数" supported={profile.quality.supported} disabled={disabled} onChange={(supported) => updateQuality({ supported })} />
                {profile.quality.supported ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="质量支持值">
                            <Select
                                mode="tags"
                                className="admin-capability-tags w-full"
                                disabled={disabled}
                                value={profile.quality.values}
                                tokenSeparators={[","]}
                                onChange={(values) => updateQuality({ values, default: values.includes(profile.quality.default) ? profile.quality.default : values[0] || "auto" })}
                            />
                        </Field>
                        <Field label="默认质量">
                            <Select
                                className="w-full"
                                disabled={disabled}
                                value={profile.quality.default}
                                options={profile.quality.values.map((item) => ({ label: item, value: item }))}
                                onChange={(defaultValue) => updateQuality({ default: defaultValue })}
                            />
                        </Field>
                    </div>
                ) : null}
                <BooleanField label="透明背景" value={profile.transparentBackground} disabled={disabled} onChange={(transparentBackground) => update({ transparentBackground })} />
                <div className="grid gap-3 sm:grid-cols-2">
                    <ParameterField label="response_format" description="发送 b64_json 响应格式" supported={profile.responseFormat.supported} disabled={disabled} onChange={(supported) => update({ responseFormat: { supported } })} />
                    <ParameterField label="output_format" description="发送 PNG 输出格式" supported={profile.outputFormat.supported} disabled={disabled} onChange={(supported) => update({ outputFormat: { supported } })} />
                </div>
            </CapabilityGroup>

            <CapabilityGroup title="通用限制" description="所有图片请求共用的基础约束">
                <NumberField label="提示词最大字符数" value={profile.references.promptMaxChars} min={1} disabled={disabled} onChange={(promptMaxChars) => updateReferences({ promptMaxChars: promptMaxChars || 1 })} />
            </CapabilityGroup>
        </div>
    );
}

function CapabilityGroup({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
    return (
        <details open className="admin-capability-group rounded-lg bg-muted/10 p-3">
            <summary className="cursor-pointer list-none pr-5">
                <span className="admin-capability-group-title block text-xs font-semibold text-foreground/70">{title}</span>
                {description ? <span className="admin-capability-group-description mt-0.5 block text-[var(--fs-tiny)] font-normal text-foreground/45">{description}</span> : null}
            </summary>
            <div className="mt-3 space-y-2">{children}</div>
        </details>
    );
}

function CapabilityBlock({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="admin-capability-block">
            <div className="admin-capability-block-title">{title}</div>
            <div className="space-y-2">{children}</div>
        </section>
    );
}

function ReferenceCard({ title, description, children }: { title: string; description: string; children: ReactNode }) {
    return (
        <section className="admin-capability-reference-card">
            <header className="admin-capability-reference-card-heading">
                <h3>{title}</h3>
                <p>{description}</p>
            </header>
            <div className="admin-capability-reference-fields">{children}</div>
        </section>
    );
}

function ProtocolParameterCard({ step, title, description, children }: { step: string; title: string; description: string; children: ReactNode }) {
    return (
        <section className="admin-capability-protocol-card">
            <header className="admin-capability-protocol-card-heading">
                <span>{step}</span>
                <div>
                    <h3>{title}</h3>
                    <p>{description}</p>
                </div>
            </header>
            <div className="admin-capability-protocol-fields">{children}</div>
        </section>
    );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="block min-w-0">
            <span className="mb-1 block text-[var(--fs-tiny)] text-foreground/48">{label}</span>
            {children}
        </label>
    );
}

function NumberField({ label, value, min, max, disabled, onChange }: { label: string; value?: number; min: number; max?: number; disabled: boolean; onChange: (value: number | null) => void }) {
    return (
        <label className="admin-capability-number-field block min-w-0">
            <span className="admin-capability-field-label mb-1.5 block text-xs text-foreground/62">{label}</span>
            <InputNumber className="w-full" disabled={disabled} min={min} max={max} precision={0} value={value} onChange={onChange} />
        </label>
    );
}

function BooleanField({ label, value, disabled, onChange }: { label: string; value: { supported: boolean; default: boolean }; disabled: boolean; onChange: (value: { supported: boolean; default: boolean }) => void }) {
    return (
        <div className="admin-capability-boolean-field flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2.5">
            <div className="min-w-0">
                <div className="text-xs font-medium">{label}</div>
                <div className="text-[var(--fs-tiny)] text-foreground/45">可发送参数与默认值</div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
                <label className="grid justify-items-center gap-1 text-[var(--fs-tiny)] text-foreground/45">
                    <span>支持</span>
                    <Switch aria-label={`${label}支持`} size="small" disabled={disabled} checked={value.supported} onChange={(supported) => onChange({ ...value, supported })} />
                </label>
                <label className="grid justify-items-center gap-1 text-[var(--fs-tiny)] text-foreground/45">
                    <span>默认</span>
                    <Switch aria-label={`${label}默认值`} size="small" disabled={disabled || !value.supported} checked={value.default} onChange={(defaultValue) => onChange({ ...value, default: defaultValue })} />
                </label>
            </div>
        </div>
    );
}

function ParameterField({ label, description, supported, disabled, onChange }: { label: string; description: string; supported: boolean; disabled: boolean; onChange: (supported: boolean) => void }) {
    return (
        <div className="admin-capability-parameter-field flex min-h-12 items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2.5">
            <div className="min-w-0">
                <div className="break-all text-xs font-medium">{label}</div>
                <div className="mt-0.5 text-[var(--fs-tiny)] leading-5 text-foreground/45">{description}</div>
            </div>
            <label className="grid shrink-0 justify-items-center gap-1 text-[var(--fs-tiny)] text-foreground/45">
                <span>支持</span>
                <Switch aria-label={`${label}支持`} size="small" disabled={disabled} checked={supported} onChange={onChange} />
            </label>
        </div>
    );
}

function bytesToMB(value: number) {
    return value ? Math.round((value / (1024 * 1024)) * 10) / 10 : 0;
}

function mbToBytes(value: number | null) {
    return Math.max(0, Math.round(Number(value || 0) * 1024 * 1024));
}

function parseIntegerList(value: string) {
    return Array.from(
        new Set(
            value
                .split(",")
                .map((item) => Number(item.trim()))
                .filter((item) => Number.isInteger(item) && item > 0),
        ),
    ).sort((left, right) => left - right);
}
