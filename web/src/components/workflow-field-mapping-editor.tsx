import { useMemo, useState } from "react";
import { Button, Collapse, Empty, Input, InputNumber, Select, Switch, Tag, Tooltip } from "antd";
import { ListFilter, ListPlus, Power, PowerOff } from "lucide-react";

import type { WorkflowFieldMapping } from "@/stores/use-config-store";
import { workflowFieldChoiceValues, workflowFieldConfigurationError, workflowFieldNumberBounds, workflowFieldPresetOptions } from "@/lib/model-capabilities";

const sourceOptions = [
    { label: "保留工作流默认值", value: "" },
    { label: "任务提示词", value: "prompt" },
    { label: "系统提示词", value: "systemPrompt" },
    { label: "参考图片", value: "referenceImage" },
    { label: "参考视频", value: "referenceVideo" },
    { label: "参考音频", value: "referenceAudio" },
    { label: "蒙版", value: "mask" },
    { label: "画面尺寸", value: "size" },
    { label: "画面宽高比", value: "aspectRatio" },
    { label: "画面宽度", value: "width" },
    { label: "画面高度", value: "height" },
    { label: "生成数量", value: "count" },
    { label: "生成质量", value: "quality" },
    { label: "透明背景", value: "transparentBackground" },
    { label: "视频时长", value: "videoSeconds" },
    { label: "视频质量", value: "vquality" },
    { label: "视频生成音频", value: "videoGenerateAudio" },
    { label: "视频水印", value: "videoWatermark" },
    { label: "音色", value: "audioVoice" },
    { label: "音频格式", value: "audioFormat" },
    { label: "音频语速", value: "audioSpeed" },
    { label: "音频指令", value: "audioInstructions" },
] as const;

const fieldTypeOptions = [
    { label: "文本", value: "TEXT" },
    { label: "数字", value: "NUMBER" },
    { label: "滑块", value: "SLIDER" },
    { label: "开关", value: "BOOLEAN" },
    { label: "下拉", value: "SELECT" },
    { label: "图片", value: "IMAGE" },
    { label: "视频", value: "VIDEO" },
    { label: "音频", value: "AUDIO" },
] as const;

type WorkflowFieldMappingEditorProps = {
    fields: WorkflowFieldMapping[];
    onChange: (fields: WorkflowFieldMapping[]) => void;
    disabled?: boolean;
};

export function WorkflowFieldMappingEditor({ fields, onChange, disabled = false }: WorkflowFieldMappingEditorProps) {
    const [showOnlyEnabled, setShowOnlyEnabled] = useState(false);
    const enabledCount = useMemo(() => fields.filter((field) => field.enabled !== false).length, [fields]);
    const controllableFields = useMemo(() => fields.filter((field) => field.safeToOverride !== false), [fields]);
    const enabledControllableCount = useMemo(() => controllableFields.filter((field) => field.enabled !== false).length, [controllableFields]);
    const visibleFields = useMemo(() => fields.flatMap((field, index) => (showOnlyEnabled && field.enabled === false ? [] : [{ field, index }])), [fields, showOnlyEnabled]);
    const updateField = (index: number, patch: Partial<WorkflowFieldMapping>) => {
        onChange(fields.map((field, fieldIndex) => (fieldIndex === index ? { ...field, ...patch } : field)));
    };
    const updateAllFields = (enabled: boolean) => {
        onChange(fields.map((field) => (field.safeToOverride === false ? field : { ...field, enabled })));
    };

    if (!fields.length) {
        return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未发现可配置字段，请先拉取工作流参数" />;
    }

    return (
        <div className="workflow-field-mapping-editor space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-foreground/60">
                    共 {fields.length} 个字段，已开启 {enabledCount} 个。字段调整会立即保存到当前工作流。
                </p>
                <div className="flex flex-wrap items-center gap-1">
                    <Button type="text" size="small" icon={<Power className="size-3.5" />} disabled={disabled || enabledControllableCount === controllableFields.length} onClick={() => updateAllFields(true)}>
                        开启全部
                    </Button>
                    <Button type="text" size="small" danger icon={<PowerOff className="size-3.5" />} disabled={disabled || enabledControllableCount === 0} onClick={() => updateAllFields(false)}>
                        关闭全部
                    </Button>
                    <Button type={showOnlyEnabled ? "default" : "text"} size="small" icon={<ListFilter className="size-3.5" />} aria-pressed={showOnlyEnabled} onClick={() => setShowOnlyEnabled((current) => !current)}>
                        {showOnlyEnabled ? "显示全部" : "仅显示已开启"}
                    </Button>
                </div>
            </div>
            <Collapse
                size="small"
                items={visibleFields.map(({ field, index }) => {
                    const source = String(field.source || "");
                    const sourceLabel = sourceOptions.find((item) => item.value === source)?.label || source || "保留工作流默认值";
                    const enabled = field.enabled !== false;
                    const fieldType = workflowEditorFieldType(field);
                    const numeric = fieldType === "NUMBER" || fieldType === "SLIDER";
                    const choices = workflowFieldChoiceValues(field);
                    const presetOptions = workflowFieldPresetOptions(field);
                    const safeToOverride = field.safeToOverride !== false;
                    const fieldDisabled = disabled || !enabled || !safeToOverride;
                    const configurationError = workflowFieldConfigurationError(field);
                    const roleLabel = field.role === "prompt" ? "提示词" : field.role === "media" ? "素材" : field.role === "internal" ? "内部参数" : "业务参数";
                    return {
                        key: field.id || `${field.nodeId}::${field.fieldName}::${index}`,
                        label: (
                            <div className="flex min-w-0 items-center gap-2">
                                <span className="truncate font-medium">{field.label || field.fieldName}</span>
                                <Tooltip title={`${field.nodeId}.${field.fieldName}`}>
                                    <span className="truncate text-xs text-foreground/50">
                                        {field.nodeId}.{field.fieldName}
                                    </span>
                                </Tooltip>
                                <Tag className="ml-auto shrink-0">{sourceLabel}</Tag>
                                <Tag color={safeToOverride ? undefined : "error"} className="shrink-0">
                                    {safeToOverride ? roleLabel : "禁止覆盖"}
                                </Tag>
                            </div>
                        ),
                        extra: (
                            <span onClick={(event) => event.stopPropagation()}>
                                <Switch size="small" checked={enabled} disabled={disabled || !safeToOverride} aria-label={`启用字段 ${field.label || field.fieldName}`} onChange={(checked) => updateField(index, { enabled: checked })} />
                            </span>
                        ),
                        children: (
                            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                                <label className="grid gap-1 text-xs text-foreground/60">
                                    显示名称
                                    <Input value={field.label || ""} disabled={fieldDisabled} placeholder={field.fieldName} onChange={(event) => updateField(index, { label: event.target.value })} />
                                </label>
                                <label className="grid gap-1 text-xs text-foreground/60">
                                    参数类型
                                    <Select value={fieldType} disabled={fieldDisabled} options={fieldTypeOptions.map((item) => ({ ...item }))} onChange={(value) => updateField(index, { fieldType: value })} />
                                </label>
                                <label className="grid gap-1 text-xs text-foreground/60">
                                    输入来源
                                    <Select showSearch value={source} disabled={fieldDisabled} options={sourceOptions.map((item) => ({ ...item }))} optionFilterProp="label" onChange={(value) => updateField(index, sourcePatch(field, value))} />
                                </label>
                                {fieldType === "SELECT" || choices.length || presetOptions.length ? (
                                    <label className="grid gap-1 text-xs text-foreground/60 md:col-span-2 lg:col-span-3">
                                        <span className="flex items-center justify-between gap-2">
                                            <span>下拉选项（每行一个）</span>
                                            {presetOptions.length ? (
                                                <Button
                                                    type="text"
                                                    size="small"
                                                    icon={<ListPlus className="size-3.5" />}
                                                    disabled={fieldDisabled}
                                                    onClick={() => updateField(index, { fieldType: "SELECT", options: presetOptions, optionsSource: "preset" })}
                                                >
                                                    常用模板
                                                </Button>
                                            ) : null}
                                        </span>
                                        <Input.TextArea
                                            autoSize={{ minRows: 2, maxRows: 6 }}
                                            value={choices.map(workflowOptionText).join("\n")}
                                            disabled={fieldDisabled}
                                            placeholder={"1:1\n16:9\n9:16"}
                                            onChange={(event) => updateField(index, { options: parseWorkflowOptions(event.target.value), optionsSource: "manual" })}
                                        />
                                    </label>
                                ) : null}
                                {numeric ? (
                                    <>
                                        <label className="grid gap-1 text-xs text-foreground/60">
                                            最小值
                                            <InputNumber className="w-full" value={numberOrUndefined(field.min)} max={numberOrUndefined(field.max)} disabled={fieldDisabled} onChange={(value) => updateField(index, { min: value ?? undefined })} />
                                        </label>
                                        <label className="grid gap-1 text-xs text-foreground/60">
                                            最大值
                                            <InputNumber className="w-full" value={numberOrUndefined(field.max)} min={numberOrUndefined(field.min)} disabled={fieldDisabled} onChange={(value) => updateField(index, { max: value ?? undefined })} />
                                        </label>
                                        <label className="grid gap-1 text-xs text-foreground/60">
                                            步长
                                            <InputNumber className="w-full" min={0.000001} value={numberOrUndefined(field.step)} disabled={fieldDisabled} onChange={(value) => updateField(index, { step: value ?? undefined })} />
                                        </label>
                                        {configurationError ? <div className="text-xs text-error md:col-span-2 lg:col-span-3">{configurationError}</div> : null}
                                    </>
                                ) : null}
                                {sourceUsesIndex(source) ? (
                                    <label className="grid gap-1 text-xs text-foreground/60">
                                        {source === "referenceImage" ? "图片槽位" : source === "referenceVideo" ? "视频槽位" : "音频槽位"}
                                        <InputNumber
                                            className="w-full"
                                            min={1}
                                            precision={0}
                                            value={source === "referenceImage" ? Math.max(1, Number(field.imageOrder) || 1) : Math.max(1, (Number(field.sourceIndex) || 0) + 1)}
                                            disabled={fieldDisabled}
                                            onChange={(value) => updateField(index, source === "referenceImage" ? { imageOrder: Number(value) || 1 } : { sourceIndex: Math.max(0, (Number(value) || 1) - 1) })}
                                        />
                                    </label>
                                ) : null}
                                <label className="flex items-center justify-between gap-3 text-xs text-foreground/60">
                                    缺失时阻止生成
                                    <Switch checked={field.required === true} disabled={fieldDisabled || !source} onChange={(required) => updateField(index, { required })} />
                                </label>
                                {fieldType === "NUMBER" ? (
                                    <label className="flex items-center justify-between gap-3 text-xs text-foreground/60">
                                        每次随机数字
                                        <Switch checked={field.randomEnabled === true} disabled={fieldDisabled || Boolean(source)} onChange={(randomEnabled) => updateField(index, { randomEnabled })} />
                                    </label>
                                ) : null}
                                {!source ? (
                                    <label className="grid gap-1 text-xs text-foreground/60 md:col-span-2 lg:col-span-3">
                                        工作流默认值
                                        <DefaultValueInput field={field} disabled={fieldDisabled || field.randomEnabled === true} onChange={(fieldValue) => updateField(index, { fieldValue })} />
                                    </label>
                                ) : null}
                            </div>
                        ),
                    };
                })}
            />
            {showOnlyEnabled && !visibleFields.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无已开启字段" /> : null}
        </div>
    );
}

function DefaultValueInput({ field, disabled, onChange }: { field: WorkflowFieldMapping; disabled: boolean; onChange: (value: unknown) => void }) {
    const fieldType = String(field.fieldType || "").toUpperCase();
    const value = field.fieldValue ?? field.value ?? field.default;
    const bounds = workflowFieldNumberBounds(field);
    const choices = workflowFieldChoiceValues(field);
    if (fieldType === "BOOLEAN" || typeof value === "boolean") {
        return (
            <Select
                value={Boolean(value)}
                disabled={disabled}
                options={[
                    { label: "true", value: true },
                    { label: "false", value: false },
                ]}
                onChange={onChange}
            />
        );
    }
    if (choices.length) {
        return <Select showSearch value={value} disabled={disabled} options={choices.map((option) => ({ label: workflowOptionText(option), value: workflowOptionValue(option) }))} onChange={onChange} />;
    }
    if (fieldType === "NUMBER" || typeof value === "number" || bounds.min !== undefined || bounds.max !== undefined || bounds.step !== undefined) {
        return <InputNumber className="w-full" value={numberOrUndefined(value)} disabled={disabled} min={bounds.min} max={bounds.max} step={bounds.step} onChange={onChange} />;
    }
    return <Input.TextArea autoSize={{ minRows: 1, maxRows: 4 }} value={displayValue(value)} disabled={disabled} onChange={(event) => onChange(event.target.value)} />;
}

function sourcePatch(field: WorkflowFieldMapping, source: string): Partial<WorkflowFieldMapping> {
    if (source === "referenceImage") return { source, bindPrompt: false, sourceAutomatic: false, imageOrder: Math.max(1, Number(field.imageOrder) || 1), sourceIndex: undefined };
    if (source === "referenceVideo" || source === "referenceAudio") return { source, bindPrompt: false, sourceAutomatic: false, sourceIndex: Math.max(0, Number(field.sourceIndex) || 0), imageOrder: undefined };
    return { source, bindPrompt: false, sourceAutomatic: false, sourceIndex: undefined, imageOrder: undefined, required: source ? field.required : false };
}

function sourceUsesIndex(source: string) {
    return source === "referenceImage" || source === "referenceVideo" || source === "referenceAudio";
}

function workflowEditorFieldType(field: WorkflowFieldMapping) {
    const configured = String(field.fieldType || "")
        .trim()
        .toUpperCase();
    if (["FLOAT", "INT", "INTEGER"].includes(configured)) return "NUMBER";
    if (fieldTypeOptions.some((item) => item.value === configured)) return configured;
    const value = field.fieldValue ?? field.value ?? field.default;
    if (typeof value === "boolean") return "BOOLEAN";
    if (typeof value === "number") return "NUMBER";
    return "TEXT";
}

function parseWorkflowOptions(value: string) {
    return value
        .split(/\r?\n|,/)
        .map((item) => item.trim())
        .filter(Boolean);
}

function workflowOptionValue(value: unknown): string | number {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        const option = value as Record<string, unknown>;
        for (const key of ["value", "id", "key", "name", "label"]) {
            if (option[key] !== undefined && option[key] !== null) return typeof option[key] === "number" ? option[key] : String(option[key]);
        }
    }
    return typeof value === "number" ? value : String(value ?? "");
}

function workflowOptionText(value: unknown) {
    return String(workflowOptionValue(value));
}

function numberOrUndefined(value: unknown) {
    if (value === undefined || value === null || String(value).trim() === "") return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function displayValue(value: unknown) {
    if (value === undefined || value === null) return "";
    if (typeof value === "string") return value;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}
