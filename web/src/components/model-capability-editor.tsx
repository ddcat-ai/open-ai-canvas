import { Input, InputNumber, Segmented, Select, Switch } from "antd";
import type { ReactNode } from "react";

import { defaultImageCapabilityConfig, defaultModelCapabilityConfig, type ImageCapabilityConfig, type ModelCapabilityConfig, type VideoCapabilityConfig } from "@/lib/model-capabilities";
import type { ModelProtocol } from "@/lib/model-protocols";

const ratioOptions = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];
const resolutionOptions = ["480p", "720p", "1080p", "2160p"];
const operationOptions = [
    { label: "文生视频", value: "text_to_video" },
    { label: "图生视频", value: "image_to_video" },
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
    capability?: "image" | "video";
    model?: string;
    disabled?: boolean;
};

export function ModelCapabilityEditor({ value, onChange, protocol, capability = "video", model = "", disabled = false }: Props) {
    if (capability === "image") {
        return <ImageCapabilityEditor value={value} onChange={onChange} protocol={protocol} model={model} disabled={disabled} />;
    }
    const profile = value?.video || defaultModelCapabilityConfig(protocol).video!;
    const update = (patch: Partial<VideoCapabilityConfig>) => onChange?.({ version: 1, video: { ...profile, ...patch } });
    const updateReferences = (patch: Partial<VideoCapabilityConfig["references"]>) => update({ references: { ...profile.references, ...patch } });
    const updateDuration = (patch: Partial<VideoCapabilityConfig["duration"]>) => update({ duration: { ...profile.duration, ...patch } });
    const durationValues = (profile.duration.values || []).join(",");

    return (
        <div className="space-y-3 rounded-md border border-border/70 bg-muted/10 p-3">
            <div className="flex items-center justify-between gap-3">
                <div><div className="text-sm font-medium">视频能力参数</div><div className="mt-0.5 text-[var(--fs-tiny)] text-foreground/48">这些参数会同步到创造页、画布和生成校验</div></div>
                <span className="text-[var(--fs-tiny)] text-foreground/40">协议模板可继续调整</span>
            </div>

            <CapabilityGroup title="引用限制">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <NumberField label="提示词字符数" value={profile.references.promptMaxChars} min={1} disabled={disabled} onChange={(value) => updateReferences({ promptMaxChars: value || 1 })} />
                    <NumberField label="最大图片引用" value={profile.references.maxImages} min={0} disabled={disabled} onChange={(value) => updateReferences({ maxImages: value || 0 })} />
                    <NumberField label="图片上限 MB" value={bytesToMB(profile.references.maxImageBytes)} min={0} disabled={disabled} onChange={(value) => updateReferences({ maxImageBytes: mbToBytes(value) })} />
                    <NumberField label="最大视频引用" value={profile.references.maxVideos} min={0} disabled={disabled} onChange={(value) => updateReferences({ maxVideos: value || 0 })} />
                    <NumberField label="视频上限 MB" value={bytesToMB(profile.references.maxVideoBytes)} min={0} disabled={disabled} onChange={(value) => updateReferences({ maxVideoBytes: mbToBytes(value) })} />
                    <NumberField label="视频最长秒数" value={profile.references.maxVideoDurationSeconds} min={0} disabled={disabled} onChange={(value) => updateReferences({ maxVideoDurationSeconds: value || 0 })} />
                    <NumberField label="最大音频引用" value={profile.references.maxAudios} min={0} disabled={disabled} onChange={(value) => updateReferences({ maxAudios: value || 0 })} />
                    <NumberField label="音频上限 MB" value={bytesToMB(profile.references.maxAudioBytes)} min={0} disabled={disabled} onChange={(value) => updateReferences({ maxAudioBytes: mbToBytes(value) })} />
                    <NumberField label="音频最长秒数" value={profile.references.maxAudioDurationSeconds} min={0} disabled={disabled} onChange={(value) => updateReferences({ maxAudioDurationSeconds: value || 0 })} />
                </div>
            </CapabilityGroup>

            <CapabilityGroup title="视频时长">
                <Segmented block disabled={disabled} value={profile.duration.selection} options={[{ label: "范围", value: "range" }, { label: "固定值", value: "enum" }]} onChange={(value) => updateDuration(value === "enum" ? { selection: "enum", values: profile.duration.values?.length ? profile.duration.values : [profile.duration.default] } : { selection: "range", min: profile.duration.min || 1, max: profile.duration.max || 15, step: profile.duration.step || 1 })} />
                {profile.duration.selection === "enum" ? (
                    <Field label="固定时长（秒）"><Input disabled={disabled} value={durationValues} placeholder="例如：5,10" onChange={(event) => updateDuration({ values: parseIntegerList(event.target.value), default: parseIntegerList(event.target.value)[0] || profile.duration.default })} /></Field>
                ) : (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <NumberField label="最短" value={profile.duration.min} min={1} disabled={disabled} onChange={(value) => updateDuration({ min: value || 1 })} />
                        <NumberField label="最长" value={profile.duration.max} min={1} disabled={disabled} onChange={(value) => updateDuration({ max: value || 1 })} />
                        <NumberField label="步长" value={profile.duration.step} min={1} disabled={disabled} onChange={(value) => updateDuration({ step: value || 1 })} />
                        <NumberField label="默认" value={profile.duration.default} min={1} disabled={disabled} onChange={(value) => updateDuration({ default: value || 1 })} />
                    </div>
                )}
            </CapabilityGroup>

            <CapabilityGroup title="输出参数">
                <div className="grid gap-2 sm:grid-cols-2">
                    <Field label="画面比例"><Select mode="multiple" className="w-full" disabled={disabled} value={profile.ratios} options={ratioOptions.map((item) => ({ label: item, value: item }))} onChange={(ratios) => update({ ratios, defaultRatio: ratios.includes(profile.defaultRatio) ? profile.defaultRatio : ratios[0] || "16:9" })} /></Field>
                    <Field label="默认比例"><Select className="w-full" disabled={disabled} value={profile.defaultRatio} options={profile.ratios.map((item) => ({ label: item, value: item }))} onChange={(defaultRatio) => update({ defaultRatio })} /></Field>
                    <Field label="输出分辨率"><Select mode="multiple" className="w-full" disabled={disabled} value={profile.resolutions} options={resolutionOptions.map((item) => ({ label: item.toUpperCase(), value: item }))} onChange={(resolutions) => update({ resolutions, defaultResolution: resolutions.includes(profile.defaultResolution) ? profile.defaultResolution : resolutions[0] || "720p" })} /></Field>
                    <Field label="默认分辨率"><Select className="w-full" disabled={disabled} value={profile.defaultResolution} options={profile.resolutions.map((item) => ({ label: item.toUpperCase(), value: item }))} onChange={(defaultResolution) => update({ defaultResolution })} /></Field>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                    <BooleanField label="同步音频" value={profile.generateAudio} disabled={disabled} onChange={(generateAudio) => update({ generateAudio })} />
                    <BooleanField label="水印" value={profile.watermark} disabled={disabled} onChange={(watermark) => update({ watermark })} />
                </div>
            </CapabilityGroup>

            <CapabilityGroup title="生成模式">
                <div className="grid gap-2 sm:grid-cols-2">
                    <Field label="支持模式"><Select mode="multiple" className="w-full" disabled={disabled} value={profile.operations} options={operationOptions} onChange={(operations) => update({ operations, defaultOperation: operations.includes(profile.defaultOperation) ? profile.defaultOperation : operations[0] || "text_to_video" })} /></Field>
                    <Field label="默认模式"><Select className="w-full" disabled={disabled} value={profile.defaultOperation} options={operationOptions.filter((item) => profile.operations.includes(item.value))} onChange={(defaultOperation) => update({ defaultOperation })} /></Field>
                </div>
            </CapabilityGroup>
        </div>
    );
}

function ImageCapabilityEditor({ value, onChange, protocol, model, disabled }: Required<Pick<Props, "model" | "disabled">> & Pick<Props, "value" | "onChange" | "protocol">) {
    const profile = value?.image || defaultImageCapabilityConfig(protocol, model);
    const update = (patch: Partial<ImageCapabilityConfig>) => onChange?.({ version: 1, image: { ...profile, ...patch } });
    const updateReferences = (patch: Partial<ImageCapabilityConfig["references"]>) => update({ references: { ...profile.references, ...patch } });
    const updateSize = (patch: Partial<ImageCapabilityConfig["size"]>) => update({ size: { ...profile.size, ...patch } });
    const updateQuality = (patch: Partial<ImageCapabilityConfig["quality"]>) => update({ quality: { ...profile.quality, ...patch } });

    return (
        <div className="space-y-3 rounded-md border border-border/70 bg-muted/10 p-3">
            <div className="flex items-center justify-between gap-3">
                <div><div className="text-sm font-medium">图片能力参数</div><div className="mt-0.5 text-[var(--fs-tiny)] text-foreground/48">生成界面和后端请求都会按此处裁剪参数</div></div>
                <span className="text-[var(--fs-tiny)] text-foreground/40">当前模型独立生效</span>
            </div>

            <CapabilityGroup title="输入与输出限制">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <NumberField label="提示词字符数" value={profile.references.promptMaxChars} min={1} disabled={disabled} onChange={(promptMaxChars) => updateReferences({ promptMaxChars: promptMaxChars || 1 })} />
                    <NumberField label="最大参考图" value={profile.references.maxImages} min={0} disabled={disabled} onChange={(maxImages) => updateReferences({ maxImages: maxImages || 0 })} />
                    <NumberField label="单图上限 MB" value={bytesToMB(profile.references.maxImageBytes)} min={0} disabled={disabled} onChange={(maxImageBytes) => updateReferences({ maxImageBytes: mbToBytes(maxImageBytes) })} />
                    <NumberField label="单次生成张数" value={profile.maxOutputs} min={1} disabled={disabled} onChange={(maxOutputs) => update({ maxOutputs: maxOutputs || 1 })} />
                </div>
                <ParameterField label="蒙版编辑" description="允许调用图片编辑接口并提交 mask" supported={profile.references.maskSupported} disabled={disabled} onChange={(maskSupported) => updateReferences({ maskSupported })} />
            </CapabilityGroup>

            <CapabilityGroup title="尺寸参数">
                <Segmented
                    block
                    disabled={disabled}
                    value={profile.size.parameter}
                    options={[{ label: "不发送", value: "none" }, { label: "size", value: "size" }, { label: "aspect_ratio", value: "aspect_ratio" }]}
                    onChange={(value) => {
                        const parameter = value as ImageCapabilityConfig["size"]["parameter"];
                        updateSize(parameter === "none" ? { parameter, values: [], default: "auto", allowCustom: false } : { parameter, values: profile.size.values.length ? profile.size.values : ["1:1"], default: profile.size.default === "auto" ? "1:1" : profile.size.default });
                    }}
                />
                {profile.size.parameter !== "none" ? <>
                    <Field label="支持值"><Select mode="tags" className="w-full" disabled={disabled} value={profile.size.values} tokenSeparators={[","]} placeholder="例如 1:1、1024x1024" onChange={(values) => updateSize({ values, default: values.includes(profile.size.default) || profile.size.allowCustom ? profile.size.default : values[0] || "auto" })} /></Field>
                    <div className="grid gap-2 sm:grid-cols-2">
                        <Field label="默认值"><Select className="w-full" disabled={disabled} value={profile.size.default} options={profile.size.values.map((item) => ({ label: item, value: item }))} onChange={(defaultValue) => updateSize({ default: defaultValue })} /></Field>
                        <ParameterField label="允许自定义" description="允许用户输入支持值之外的尺寸" supported={profile.size.allowCustom} disabled={disabled} onChange={(allowCustom) => updateSize({ allowCustom })} />
                    </div>
                </> : null}
            </CapabilityGroup>

            <CapabilityGroup title="可选生成参数">
                <ParameterField label="图片质量" description="发送 quality 参数" supported={profile.quality.supported} disabled={disabled} onChange={(supported) => updateQuality({ supported })} />
                {profile.quality.supported ? <div className="grid gap-2 sm:grid-cols-2">
                    <Field label="质量支持值"><Select mode="tags" className="w-full" disabled={disabled} value={profile.quality.values} tokenSeparators={[","]} onChange={(values) => updateQuality({ values, default: values.includes(profile.quality.default) ? profile.quality.default : values[0] || "auto" })} /></Field>
                    <Field label="默认质量"><Select className="w-full" disabled={disabled} value={profile.quality.default} options={profile.quality.values.map((item) => ({ label: item, value: item }))} onChange={(defaultValue) => updateQuality({ default: defaultValue })} /></Field>
                </div> : null}
                <BooleanField label="透明背景" value={profile.transparentBackground} disabled={disabled} onChange={(transparentBackground) => update({ transparentBackground })} />
                <div className="grid gap-2 sm:grid-cols-2">
                    <ParameterField label="response_format" description="发送 b64_json 响应格式" supported={profile.responseFormat.supported} disabled={disabled} onChange={(supported) => update({ responseFormat: { supported } })} />
                    <ParameterField label="output_format" description="发送 PNG 输出格式" supported={profile.outputFormat.supported} disabled={disabled} onChange={(supported) => update({ outputFormat: { supported } })} />
                </div>
            </CapabilityGroup>
        </div>
    );
}

function CapabilityGroup({ title, children }: { title: string; children: ReactNode }) {
    return <section className="space-y-2"><div className="text-xs font-semibold text-foreground/65">{title}</div>{children}</section>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return <label className="block min-w-0"><span className="mb-1 block text-[var(--fs-tiny)] text-foreground/48">{label}</span>{children}</label>;
}

function NumberField({ label, value, min, disabled, onChange }: { label: string; value?: number; min: number; disabled: boolean; onChange: (value: number | null) => void }) {
    return <Field label={label}><InputNumber className="w-full" disabled={disabled} min={min} precision={0} value={value} onChange={onChange} /></Field>;
}

function BooleanField({ label, value, disabled, onChange }: { label: string; value: { supported: boolean; default: boolean }; disabled: boolean; onChange: (value: { supported: boolean; default: boolean }) => void }) {
    return <div className="flex items-center justify-between rounded-md border border-border/60 px-2.5 py-2"><div><div className="text-xs font-medium">{label}</div><div className="text-[var(--fs-tiny)] text-foreground/45">支持该参数</div></div><div className="flex items-center gap-2"><Switch size="small" disabled={disabled} checked={value.supported} onChange={(supported) => onChange({ ...value, supported })} /><Switch size="small" disabled={disabled || !value.supported} checked={value.default} onChange={(defaultValue) => onChange({ ...value, default: defaultValue })} /></div></div>;
}

function ParameterField({ label, description, supported, disabled, onChange }: { label: string; description: string; supported: boolean; disabled: boolean; onChange: (supported: boolean) => void }) {
    return <div className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-border/60 px-2.5 py-2"><div className="min-w-0"><div className="truncate text-xs font-medium">{label}</div><div className="mt-0.5 text-[var(--fs-tiny)] text-foreground/45">{description}</div></div><Switch size="small" disabled={disabled} checked={supported} onChange={onChange} /></div>;
}

function bytesToMB(value: number) {
    return value ? Math.round((value / (1024 * 1024)) * 10) / 10 : 0;
}

function mbToBytes(value: number | null) {
    return Math.max(0, Math.round(Number(value || 0) * 1024 * 1024));
}

function parseIntegerList(value: string) {
    return Array.from(new Set(value.split(",").map((item) => Number(item.trim())).filter((item) => Number.isInteger(item) && item > 0))).sort((left, right) => left - right);
}
