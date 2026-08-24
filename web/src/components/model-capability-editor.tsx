import { Input, InputNumber, Segmented, Select, Switch } from "antd";
import type { ReactNode } from "react";

import { defaultImageCapabilityConfig, defaultModelCapabilityConfig, normalizeModelCapabilityConfig, type ImageCapabilityConfig, type ModelCapabilityConfig, type TextCapabilityConfig, type VideoCapabilityConfig } from "@/lib/model-capabilities";
import type { ModelProtocol } from "@/lib/model-protocols";
import { VIDEO_RESOLUTION_CAPABILITY_OPTIONS } from "@/lib/video-generation-options";
import { useTranslation } from "react-i18next";
import { t } from "@/i18n";

const ratioOptions = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];
const operationOptions = [
    { label: t("domain:text-to-video"), value: "text_to_video" },
    { label: t("domain:image-to-video"), value: "image_to_video" },
    { label: t("domain:video-extend"), value: "extend" },
    { label: t("domain:inpaint-edit-2"), value: "inpaint" },
    { label: t("domain:element-replace"), value: "replace_element" },
    { label: t("domain:camera-adjust"), value: "camera_motion" },
    { label: t("domain:style-transfer"), value: "style_transfer" },
    { label: t("domain:audio-to-video"), value: "audio_to_video" },
];

type Props = {
    value?: ModelCapabilityConfig;
    onChange?: (value: ModelCapabilityConfig) => void;
    protocol?: ModelProtocol;
    capability?: "text" | "image" | "video";
    model?: string;
    disabled?: boolean;
};

export function ModelCapabilityEditor({ value, onChange, protocol, capability = "video", model = "", disabled = false }: Props) {
    const { t } = useTranslation("canvas");
    if (capability === "text") {
        return <TextCapabilityEditor value={value} onChange={onChange} protocol={protocol} disabled={disabled} />;
    }
    if (capability === "image") {
        return <ImageCapabilityEditor value={value} onChange={onChange} protocol={protocol} model={model} disabled={disabled} />;
    }
    const profile = normalizeModelCapabilityConfig(value || defaultModelCapabilityConfig(protocol)).video!;
    const update = (patch: Partial<VideoCapabilityConfig>) => onChange?.({ version: 1, video: { ...profile, ...patch } });
    const updateReferences = (patch: Partial<VideoCapabilityConfig["references"]>) => update({ references: { ...profile.references, ...patch } });
    const updateDuration = (patch: Partial<VideoCapabilityConfig["duration"]>) => update({ duration: { ...profile.duration, ...patch } });
    const durationValues = (profile.duration.values || []).join(",");
    const resolutionOptions = Array.from(new Set([...VIDEO_RESOLUTION_CAPABILITY_OPTIONS, ...profile.resolutions]));

    return (
        <div className="admin-capability-editor space-y-3 rounded-md bg-muted/10 p-3">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <div className="text-sm font-medium">{t("domain:video-capability-parameters")}</div>
                    <div className="mt-0.5 text-[var(--fs-tiny)] text-foreground/48">{t("domain:these-parameters-sync-to-the-create-page-canvas-and-generation-validatio")}</div>
                </div>
                <span className="text-[var(--fs-tiny)] text-foreground/40">{t("domain:protocol-templates-remain-adjustable")}</span>
            </div>

            <CapabilityGroup title={t("domain:reference-limits")}>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <NumberField label={t("domain:prompt-character-count")} value={profile.references.promptMaxChars} min={1} disabled={disabled} onChange={(value) => updateReferences({ promptMaxChars: value || 1 })} />
                    <NumberField label={t("domain:min-image-references")} value={profile.references.minImages} min={0} max={profile.references.maxImages} disabled={disabled} onChange={(value) => updateReferences({ minImages: value || 0 })} />
                    <NumberField
                        label={t("domain:max-image-references")}
                        value={profile.references.maxImages}
                        min={0}
                        disabled={disabled}
                        onChange={(value) => {
                            const maxImages = value || 0;
                            updateReferences({ maxImages, minImages: Math.min(profile.references.minImages, maxImages) });
                        }}
                    />
                    <NumberField label={t("domain:image-size-limit-mb")} value={bytesToMB(profile.references.maxImageBytes)} min={0} disabled={disabled} onChange={(value) => updateReferences({ maxImageBytes: mbToBytes(value) })} />
                    <NumberField label={t("domain:max-video-references")} value={profile.references.maxVideos} min={0} disabled={disabled} onChange={(value) => updateReferences({ maxVideos: value || 0 })} />
                    <NumberField label={t("domain:video-size-limit-mb")} value={bytesToMB(profile.references.maxVideoBytes)} min={0} disabled={disabled} onChange={(value) => updateReferences({ maxVideoBytes: mbToBytes(value) })} />
                    <NumberField label={t("domain:max-video-duration-seconds")} value={profile.references.maxVideoDurationSeconds} min={0} disabled={disabled} onChange={(value) => updateReferences({ maxVideoDurationSeconds: value || 0 })} />
                    <NumberField label={t("domain:max-audio-references")} value={profile.references.maxAudios} min={0} disabled={disabled} onChange={(value) => updateReferences({ maxAudios: value || 0 })} />
                    <NumberField label={t("domain:audio-size-limit-mb")} value={bytesToMB(profile.references.maxAudioBytes)} min={0} disabled={disabled} onChange={(value) => updateReferences({ maxAudioBytes: mbToBytes(value) })} />
                    <NumberField label={t("domain:max-audio-duration-seconds")} value={profile.references.maxAudioDurationSeconds} min={0} disabled={disabled} onChange={(value) => updateReferences({ maxAudioDurationSeconds: value || 0 })} />
                </div>
            </CapabilityGroup>

            <CapabilityGroup title={t("domain:video-duration")}>
                <Segmented
                    block
                    disabled={disabled}
                    value={profile.duration.selection}
                    options={[
                        { label: t("domain:range"), value: "range" },
                        { label: t("domain:fixed-value"), value: "enum" },
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
                    <Field label={t("domain:fixed-duration-seconds")}>
                        <Input
                            disabled={disabled}
                            value={durationValues}
                            placeholder={t("domain:e-g-5-10")}
                            onChange={(event) => updateDuration({ values: parseIntegerList(event.target.value), default: parseIntegerList(event.target.value)[0] || profile.duration.default })}
                        />
                    </Field>
                ) : (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <NumberField label={t("domain:min")} value={profile.duration.min} min={1} disabled={disabled} onChange={(value) => updateDuration({ min: value || 1 })} />
                        <NumberField label={t("domain:max")} value={profile.duration.max} min={1} disabled={disabled} onChange={(value) => updateDuration({ max: value || 1 })} />
                        <NumberField label={t("domain:step")} value={profile.duration.step} min={1} disabled={disabled} onChange={(value) => updateDuration({ step: value || 1 })} />
                        <NumberField label={t("domain:default")} value={profile.duration.default} min={1} disabled={disabled} onChange={(value) => updateDuration({ default: value || 1 })} />
                    </div>
                )}
            </CapabilityGroup>

            <CapabilityGroup title={t("domain:output-parameters")}>
                <div className="grid gap-2 sm:grid-cols-2">
                    <Field label={t("domain:aspect-ratio")}>
                        <Select
                            mode="multiple"
                            className="w-full"
                            disabled={disabled}
                            value={profile.ratios}
                            options={ratioOptions.map((item) => ({ label: item, value: item }))}
                            onChange={(ratios) => update({ ratios, defaultRatio: ratios.includes(profile.defaultRatio) ? profile.defaultRatio : ratios[0] || "16:9" })}
                        />
                    </Field>
                    <Field label={t("domain:default-ratio")}>
                        <Select className="w-full" disabled={disabled} value={profile.defaultRatio} options={profile.ratios.map((item) => ({ label: item, value: item }))} onChange={(defaultRatio) => update({ defaultRatio })} />
                    </Field>
                    <Field label={t("domain:output-resolution")}>
                        <Select
                            mode="tags"
                            className="admin-capability-tags w-full"
                            disabled={disabled}
                            value={profile.resolutions}
                            tokenSeparators={[","]}
                            placeholder={t("domain:pick-a-standard-tier-or-enter-a-model-specific-value-like-768p")}
                            options={resolutionOptions.map((item) => ({ label: item.toUpperCase(), value: item }))}
                            onChange={(resolutions) => update({ resolutions, defaultResolution: resolutions.includes(profile.defaultResolution) ? profile.defaultResolution : resolutions[0] || "" })}
                        />
                    </Field>
                    <Field label={t("domain:default-resolution")}>
                        <Select
                            className="w-full"
                            disabled={disabled}
                            value={profile.defaultResolution}
                            options={profile.resolutions.map((item) => ({ label: item.toUpperCase(), value: item }))}
                            onChange={(defaultResolution) => update({ defaultResolution })}
                        />
                    </Field>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                    <BooleanField label={t("domain:sync-audio")} value={profile.generateAudio} disabled={disabled} onChange={(generateAudio) => update({ generateAudio })} />
                    <BooleanField label={t("domain:watermark")} value={profile.watermark} disabled={disabled} onChange={(watermark) => update({ watermark })} />
                </div>
            </CapabilityGroup>

            <CapabilityGroup title={t("domain:generation-modes")}>
                <div className="grid gap-2 sm:grid-cols-2">
                    <Field label={t("domain:supported-modes")}>
                        <Select
                            mode="multiple"
                            className="w-full"
                            disabled={disabled}
                            value={profile.operations}
                            options={operationOptions}
                            onChange={(operations) => update({ operations, defaultOperation: operations.includes(profile.defaultOperation) ? profile.defaultOperation : operations[0] || "text_to_video" })}
                        />
                    </Field>
                    <Field label={t("domain:default-mode")}>
                        <Select className="w-full" disabled={disabled} value={profile.defaultOperation} options={operationOptions.filter((item) => profile.operations.includes(item.value))} onChange={(defaultOperation) => update({ defaultOperation })} />
                    </Field>
                </div>
            </CapabilityGroup>
        </div>
    );
}

function TextCapabilityEditor({ value, onChange, protocol, disabled }: Pick<Props, "value" | "onChange" | "protocol" | "disabled">) {
    const { t } = useTranslation("canvas");
    const profile = value?.text || defaultModelCapabilityConfig(protocol).text!;
    const updateReferences = (patch: Partial<TextCapabilityConfig["references"]>) => {
        onChange?.({ version: 1, text: { references: { ...profile.references, ...patch } } });
    };

    return (
        <div className="admin-capability-editor space-y-3 rounded-md bg-muted/20 p-3">
            <div>
                <div className="text-sm font-medium">{t("domain:text-understanding")}</div>
                <div className="mt-0.5 text-[var(--fs-tiny)] text-foreground/48">{t("domain:image-video-support-is-not-assumed-by-default-only-explicitly-configured")}</div>
            </div>
            <CapabilityGroup title={t("domain:input-limits")}>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <NumberField label={t("domain:max-prompt-characters")} value={profile.references.promptMaxChars} min={1} max={1_000_000} disabled={Boolean(disabled)} onChange={(next) => updateReferences({ promptMaxChars: next || 1 })} />
                    <NumberField label={t("domain:max-reference-images")} value={profile.references.maxImages} min={0} max={100} disabled={Boolean(disabled)} onChange={(next) => updateReferences({ maxImages: next || 0 })} />
                    <NumberField label={t("domain:per-image-size-limit-mb")} value={bytesToMB(profile.references.maxImageBytes)} min={0} disabled={Boolean(disabled)} onChange={(next) => updateReferences({ maxImageBytes: mbToBytes(next) })} />
                    <NumberField label={t("domain:max-reference-videos")} value={profile.references.maxVideos} min={0} max={100} disabled={Boolean(disabled)} onChange={(next) => updateReferences({ maxVideos: next || 0 })} />
                    <NumberField label={t("domain:per-video-size-limit-mb")} value={bytesToMB(profile.references.maxVideoBytes)} min={0} disabled={Boolean(disabled)} onChange={(next) => updateReferences({ maxVideoBytes: mbToBytes(next) })} />
                </div>
            </CapabilityGroup>
        </div>
    );
}

function ImageCapabilityEditor({ value, onChange, protocol, model, disabled }: Required<Pick<Props, "model" | "disabled">> & Pick<Props, "value" | "onChange" | "protocol">) {
    const { t } = useTranslation("canvas");
    const profile = normalizeModelCapabilityConfig(value || { version: 1, image: defaultImageCapabilityConfig(protocol, model) }).image!;
    const update = (patch: Partial<ImageCapabilityConfig>) => onChange?.({ version: 1, image: { ...profile, ...patch } });
    const updateReferences = (patch: Partial<ImageCapabilityConfig["references"]>) => update({ references: { ...profile.references, ...patch } });
    const updateSize = (patch: Partial<ImageCapabilityConfig["size"]>) => update({ size: { ...profile.size, ...patch } });
    const updateQuality = (patch: Partial<ImageCapabilityConfig["quality"]>) => update({ quality: { ...profile.quality, ...patch } });

    return (
        <div className="admin-capability-editor space-y-3 rounded-md bg-muted/10 p-3">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <div className="text-sm font-medium">{t("domain:image-capability-parameters")}</div>
                    <div className="mt-0.5 text-[var(--fs-tiny)] text-foreground/48">{t("domain:both-the-generation-ui-and-backend-requests-are-trimmed-to-these-setting")}</div>
                </div>
                <span className="text-[var(--fs-tiny)] text-foreground/40">{t("domain:applies-to-this-model-only")}</span>
            </div>

            <CapabilityGroup title={t("domain:input-and-output-limits")}>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <NumberField label={t("domain:prompt-character-count")} value={profile.references.promptMaxChars} min={1} disabled={disabled} onChange={(promptMaxChars) => updateReferences({ promptMaxChars: promptMaxChars || 1 })} />
                    <NumberField label={t("domain:max-reference-images-2")} value={profile.references.maxImages} min={0} disabled={disabled} onChange={(maxImages) => updateReferences({ maxImages: maxImages || 0 })} />
                    <NumberField label={t("domain:per-image-limit-mb")} value={bytesToMB(profile.references.maxImageBytes)} min={0} disabled={disabled} onChange={(maxImageBytes) => updateReferences({ maxImageBytes: mbToBytes(maxImageBytes) })} />
                    <NumberField label={t("domain:images-per-run")} value={profile.maxOutputs} min={1} disabled={disabled} onChange={(maxOutputs) => update({ maxOutputs: maxOutputs || 1 })} />
                </div>
                <ParameterField
                    label={t("domain:mask-editing")}
                    description={t("domain:allow-calling-the-image-edit-api-with-a-mask")}
                    supported={profile.references.maskSupported}
                    disabled={disabled}
                    onChange={(maskSupported) => updateReferences({ maskSupported })}
                />
            </CapabilityGroup>

            <CapabilityGroup title={t("domain:size-parameters")}>
                <Segmented
                    block
                    disabled={disabled}
                    value={profile.size.parameter}
                    options={[
                        { label: t("domain:do-not-send"), value: "none" },
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
                        <Field label={t("domain:supported-values")}>
                            <Select
                                mode="tags"
                                className="admin-capability-tags w-full"
                                disabled={disabled}
                                value={profile.size.values}
                                tokenSeparators={[","]}
                                placeholder={t("domain:e-g-1-1-1024x1024")}
                                onChange={(values) => updateSize({ values, default: values.includes(profile.size.default) || profile.size.allowCustom ? profile.size.default : values[0] || "auto" })}
                            />
                        </Field>
                        <div className="grid gap-2 sm:grid-cols-2">
                            <Field label={t("domain:default-value")}>
                                <Select className="w-full" disabled={disabled} value={profile.size.default} options={profile.size.values.map((item) => ({ label: item, value: item }))} onChange={(defaultValue) => updateSize({ default: defaultValue })} />
                            </Field>
                            <ParameterField
                                label={t("domain:allow-custom-values")}
                                description={t("domain:let-users-enter-sizes-beyond-the-supported-values")}
                                supported={profile.size.allowCustom}
                                disabled={disabled}
                                onChange={(allowCustom) => updateSize({ allowCustom })}
                            />
                        </div>
                    </>
                ) : null}
            </CapabilityGroup>

            <CapabilityGroup title={t("domain:optional-generation-parameters")}>
                <ParameterField label={t("domain:image-quality")} description={t("domain:send-quality-parameter")} supported={profile.quality.supported} disabled={disabled} onChange={(supported) => updateQuality({ supported })} />
                {profile.quality.supported ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                        <Field label={t("domain:supported-quality-values")}>
                            <Select
                                mode="tags"
                                className="admin-capability-tags w-full"
                                disabled={disabled}
                                value={profile.quality.values}
                                tokenSeparators={[","]}
                                onChange={(values) => updateQuality({ values, default: values.includes(profile.quality.default) ? profile.quality.default : values[0] || "auto" })}
                            />
                        </Field>
                        <Field label={t("domain:default-quality")}>
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
                <BooleanField label={t("domain:transparent-background-2")} value={profile.transparentBackground} disabled={disabled} onChange={(transparentBackground) => update({ transparentBackground })} />
                <div className="grid gap-2 sm:grid-cols-2">
                    <ParameterField label="response_format" description={t("domain:send-b64-json-response-format")} supported={profile.responseFormat.supported} disabled={disabled} onChange={(supported) => update({ responseFormat: { supported } })} />
                    <ParameterField label="output_format" description={t("domain:send-png-output-format")} supported={profile.outputFormat.supported} disabled={disabled} onChange={(supported) => update({ outputFormat: { supported } })} />
                </div>
            </CapabilityGroup>
        </div>
    );
}

function CapabilityGroup({ title, children }: { title: string; children: ReactNode }) {
    return (
        <details open className="admin-capability-group rounded-lg bg-muted/10 p-3">
            <summary className="cursor-pointer list-none text-xs font-semibold text-foreground/70">{title}</summary>
            <div className="mt-3 space-y-2">{children}</div>
        </details>
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
        <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 text-xs text-foreground/62">{label}</span>
            <InputNumber className="w-32 shrink-0" disabled={disabled} min={min} max={max} precision={0} value={value} onChange={onChange} />
        </div>
    );
}

function BooleanField({ label, value, disabled, onChange }: { label: string; value: { supported: boolean; default: boolean }; disabled: boolean; onChange: (value: { supported: boolean; default: boolean }) => void }) {
    const { t } = useTranslation("canvas");
    return (
        <div className="flex items-center justify-between rounded-md border border-border/60 px-2.5 py-2">
            <div>
                <div className="text-xs font-medium">{label}</div>
                <div className="text-[var(--fs-tiny)] text-foreground/45">{t("domain:parameter-supported")}</div>
            </div>
            <div className="flex items-center gap-2">
                <Switch size="small" disabled={disabled} checked={value.supported} onChange={(supported) => onChange({ ...value, supported })} />
                <Switch size="small" disabled={disabled || !value.supported} checked={value.default} onChange={(defaultValue) => onChange({ ...value, default: defaultValue })} />
            </div>
        </div>
    );
}

function ParameterField({ label, description, supported, disabled, onChange }: { label: string; description: string; supported: boolean; disabled: boolean; onChange: (supported: boolean) => void }) {
    return (
        <div className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-border/60 px-2.5 py-2">
            <div className="min-w-0">
                <div className="truncate text-xs font-medium">{label}</div>
                <div className="mt-0.5 text-[var(--fs-tiny)] text-foreground/45">{description}</div>
            </div>
            <Switch size="small" disabled={disabled} checked={supported} onChange={onChange} />
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
