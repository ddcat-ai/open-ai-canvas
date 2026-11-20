import { useState } from "react";
import { Checkbox, Input } from "antd";
import { Plus, Star, X } from "lucide-react";
import { videoProfileForOperation, type VideoCapabilityConfig } from "@/lib/model-capabilities";
import type { VideoOutputLimit } from "@/lib/model-protocols";
import { formatVideoResolutionLabel, VIDEO_RESOLUTION_CAPABILITY_OPTIONS } from "@/lib/video-generation-options";
import { ModelCapabilityPreview } from "./model-capability-preview";
import { VideoProfileControls } from "./video-settings-panel";

const ratios = ["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16", "21:9"];

const inputRoleLabels: Record<string, string> = {
    first_frame: "首帧",
    middle_frame: "中间帧",
    last_frame: "尾帧",
    refer_image: "参考图",
    feature_video: "特征参考视频",
    base_video: "待编辑视频",
    element: "主体",
    voice: "音色 ID",
    reference_audio: "参考音频",
};

const operationLabels = new Map([
    ["text_to_video", "文生视频"],
    ["image_to_video", "图生视频"],
    ["reference_to_video", "全模态参考"],
    ["audio_to_video", "音频生视频"],
    ["extend", "视频续写"],
    ["inpaint", "局部修改"],
    ["replace_element", "元素替换"],
    ["camera_motion", "运镜调整"],
    ["style_transfer", "风格迁移"],
    ["enhance", "画质增强"],
    ["depth", "相对深度"],
]);

export function VideoOperationOptions({ profile, suggested, disabled, update }: { profile: VideoCapabilityConfig; suggested?: string[]; disabled: boolean; update: (patch: Partial<VideoCapabilityConfig>) => void }) {
    const [expanded, setExpanded] = useState(false);
    const offered = profile.modeLimits ? Object.keys(profile.modeLimits) : suggested && !expanded ? suggested : operationLabels.keys();
    const options = new Set([...offered, ...profile.operations]);
    return (
        <fieldset disabled={disabled} className="min-w-0">
            <legend className="mb-2 text-sm font-semibold">支持模式</legend>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-1.5">
                {Array.from(options, (operation) => {
                    const label = operationLabels.get(operation) ?? operation;
                    const checked = profile.operations.includes(operation);
                    const unsupported = Boolean(profile.modeLimits && !Object.hasOwn(profile.modeLimits, operation));
                    const mode = profile.modeLimits?.[operation];
                    const isDefault = profile.defaultOperation === operation;
                    const last = checked && profile.operations.length === 1;
                    return (
                        <div key={operation} className={`flex min-w-0 flex-wrap content-start items-center gap-x-1 rounded-md border px-2 ${checked ? "border-foreground/25 bg-muted/40" : "border-border"}`}>
                            <Checkbox
                                className="min-h-8 min-w-0 flex-1 text-sm"
                                checked={checked}
                                disabled={disabled || last}
                                title={last ? "至少保留一种支持模式" : undefined}
                                onChange={(event) => {
                                    const operations = event.target.checked ? [...profile.operations, operation] : profile.operations.filter((item) => item !== operation);
                                    update({ operations, defaultOperation: operations.includes(profile.defaultOperation) ? profile.defaultOperation : operations[0] });
                                }}
                            >
                                <span className="break-words">
                                    {label}
                                    {unsupported && "（当前版本不支持）"}
                                </span>
                            </Checkbox>
                            {checked && !unsupported && (
                                <button
                                    type="button"
                                    className="shrink-0 rounded-sm p-1 focus-visible:ring-2"
                                    aria-label={`设${label}为默认模式`}
                                    aria-pressed={isDefault}
                                    title={isDefault ? `默认模式：${label}` : `设${label}为默认模式`}
                                    onClick={() => !isDefault && update({ defaultOperation: operation })}
                                >
                                    <Star size={14} className={isDefault ? "fill-current text-[var(--control-selected-fg)]" : "text-muted-foreground"} />
                                </button>
                            )}
                            {mode?.inputRoles && (
                                <span className="w-full pb-2 text-xs leading-relaxed text-muted-foreground">
                                    {mode.inputRoles.length ? mode.inputRoles.map((role) => inputRoleLabels[role] ?? role).join("、") : "仅提示词"}
                                    {mode.maxImages === 1 ? "（1 张）" : ""}
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>
            {suggested && !profile.modeLimits && (
                <button type="button" className="mt-2 text-xs text-muted-foreground underline underline-offset-2 focus-visible:ring-2" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
                    {expanded ? "收起其他模式" : "查看预设以外的模式"}
                </button>
            )}
        </fieldset>
    );
}

function OptionSet({
    label,
    name,
    values,
    selected,
    suggestions,
    choices,
    allowedSeconds,
    disabled,
    onChange,
}: {
    label: string;
    name: string;
    values: string[];
    selected: string;
    suggestions: string[];
    choices?: string[];
    allowedSeconds?: VideoOutputLimit;
    disabled: boolean;
    onChange: (values: string[], selected: string) => void;
}) {
    const [draft, setDraft] = useState("");
    const format = (value: string) => (name === "resolution" ? formatVideoResolutionLabel(value) : value === "adaptive" ? "自适应" : value);
    const supported = (value: string) => (!choices || choices.includes(value)) && (!allowedSeconds || (Number(value) >= allowedSeconds.minSeconds && Number(value) <= allowedSeconds.maxSeconds));
    const canAdd = (value: string) => Boolean(value && supported(value) && !values.some((item) => item.toLowerCase() === value.toLowerCase()) && (name !== "duration" || (/^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)))));
    const add = (value: string) => {
        value = value.trim();
        if (!canAdd(value)) return;
        onChange([...values, value], selected || value);
        setDraft("");
    };
    return (
        <fieldset className="min-w-0 space-y-2" disabled={disabled}>
            <legend className="text-sm font-medium">
                {label} <code className="text-xs text-muted-foreground">{name}</code>
            </legend>
            <div className="flex flex-wrap gap-1.5">
                {values.map((value) => (
                    <span key={value} className={`inline-flex items-center rounded-md border ${selected === value ? "border-foreground/50 bg-muted" : "border-border"}`}>
                        <button
                            type="button"
                            className="flex min-h-7 items-center gap-1 px-2 text-sm focus-visible:ring-2"
                            aria-label={`设 ${label} ${value} 为默认`}
                            title={`设 ${value} 为默认`}
                            aria-pressed={selected === value}
                            disabled={!supported(value)}
                            onClick={() => onChange(values, value)}
                        >
                            <Star size={14} className={selected === value ? "fill-current text-[var(--control-selected-fg)]" : "text-muted-foreground"} />
                            {format(value)}
                            {!supported(value) && "（当前版本不支持）"}
                        </button>
                        <button
                            type="button"
                            className="px-1 py-1 text-muted-foreground focus-visible:ring-2"
                            aria-label={`移除 ${label} ${value}`}
                            title={`移除 ${value}`}
                            onClick={() => {
                                const remaining = values.filter((item) => item !== value);
                                onChange(remaining, selected === value ? remaining[0] || "" : selected);
                            }}
                        >
                            <X size={14} />
                        </button>
                    </span>
                ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
                {!choices && (
                    <>
                        <Input
                            size="small"
                            className="max-w-36"
                            aria-label={`新增${label}`}
                            placeholder="新增可选值"
                            value={draft}
                            disabled={disabled}
                            onChange={(event) => setDraft(event.target.value)}
                            onPressEnter={(event) => {
                                event.preventDefault();
                                if (!event.nativeEvent.isComposing) add(draft);
                            }}
                        />
                        <button type="button" className="p-1 focus-visible:ring-2" aria-label={`添加${label}`} title={`添加${label}`} disabled={disabled || !canAdd(draft.trim())} onClick={() => add(draft)}>
                            <Plus size={15} />
                        </button>
                    </>
                )}
                {(choices ?? suggestions).filter(canAdd).map((value) => (
                    <button key={value} type="button" className="flex items-center gap-0.5 px-1 py-0.5 text-xs text-muted-foreground focus-visible:ring-2" aria-label={`添加 ${label} ${value}`} onClick={() => add(value)}>
                        <Plus size={12} />
                        {format(value)}
                    </button>
                ))}
            </div>
        </fieldset>
    );
}

export function VideoDurationOptions({ duration, output, disabled, update }: { duration: VideoCapabilityConfig["duration"]; output?: VideoOutputLimit; disabled: boolean; update: (patch: Partial<VideoCapabilityConfig["duration"]>) => void }) {
    return (
        <OptionSet
            label="固定时长（秒）"
            name="duration"
            values={duration.values?.map(String) ?? []}
            selected={duration.values?.length ? String(duration.default) : ""}
            suggestions={[]}
            allowedSeconds={output}
            disabled={disabled}
            onChange={(values, selected) => update({ values: values.map(Number), default: Number(selected) })}
        />
    );
}

export function VideoCapabilityOptions({
    profile,
    preset,
    output,
    disabled,
    update,
}: {
    profile: VideoCapabilityConfig;
    preset?: VideoCapabilityConfig;
    output?: VideoOutputLimit;
    disabled: boolean;
    update: (patch: Partial<VideoCapabilityConfig>) => void;
}) {
    const allowedRatios = profile.modeLimits && [...new Set(Object.values(profile.modeLimits).flatMap((limit) => limit.ratios))];
    return (
        <div className="grid gap-4 divide-y divide-border rounded-lg border border-border p-4 [&>fieldset+fieldset]:pt-4">
            <OptionSet
                label="支持比例"
                name="aspect_ratio"
                values={profile.ratios}
                selected={profile.defaultRatio}
                suggestions={preset?.ratios ?? ratios}
                choices={allowedRatios}
                disabled={disabled}
                onChange={(ratios, defaultRatio) => update({ ratios, defaultRatio })}
            />
            <OptionSet
                label="输出分辨率"
                name="resolution"
                values={profile.resolutions}
                selected={profile.defaultResolution}
                suggestions={preset?.resolutions ?? VIDEO_RESOLUTION_CAPABILITY_OPTIONS}
                choices={output?.resolutions}
                disabled={disabled}
                onChange={(resolutions, defaultResolution) => update({ resolutions, defaultResolution })}
            />
        </div>
    );
}

export function VideoCapabilityPreview({ profile, model, protocol }: { profile: VideoCapabilityConfig; model: string; protocol?: string }) {
    const preview = videoProfileForOperation(profile);
    return (
        <ModelCapabilityPreview capability="video" model={model} detail={profile.defaultOperation ? `默认模式 · ${operationLabels.get(profile.defaultOperation) ?? profile.defaultOperation}` : undefined}>
            {(theme) => (
                <VideoProfileControls
                    profile={preview}
                    protocol={protocol}
                    config={{ size: preview.defaultRatio, vquality: preview.defaultResolution, videoSeconds: String(preview.duration.default) }}
                    theme={theme}
                    className="space-y-3"
                    onConfigChange={() => {}}
                />
            )}
        </ModelCapabilityPreview>
    );
}
