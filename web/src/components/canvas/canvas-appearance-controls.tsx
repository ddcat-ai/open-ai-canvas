import { useEffect, useId, useState } from "react";
import { Button, ColorPicker, Input, Segmented, Slider } from "antd";
import { ChevronDown, CircleDot, Grid2x2, Moon, Paintbrush, RotateCcw, Square, Sun } from "lucide-react";

import {
    CANVAS_APPEARANCE_PRESETS,
    canvasAppearanceForPreset,
    canvasAppearanceValues,
    normalizeHexColor,
    switchCanvasAppearanceTheme,
    updateCustomCanvasAppearance,
    type CanvasAppearance,
    type CanvasAppearancePresetId,
    type CanvasCustomAppearance,
} from "@/lib/canvas/canvas-appearance";
import { canvasThemes, type CanvasBackgroundMode, type CanvasColorTheme, type CanvasTheme } from "@/lib/canvas-theme";

export function CanvasAppearanceControls({ appearance, backgroundMode, colorTheme, theme, onAppearanceChange, onSaveAppearanceDefault, onBackgroundModeChange }: {
    appearance: CanvasAppearance;
    backgroundMode: CanvasBackgroundMode;
    colorTheme: CanvasColorTheme;
    theme: CanvasTheme;
    onAppearanceChange: (appearance: CanvasAppearance) => void;
    onSaveAppearanceDefault: (appearance: CanvasAppearance) => void;
    onBackgroundModeChange: (mode: CanvasBackgroundMode) => void;
}) {
    const [draft, setDraft] = useState(appearance);
    const [customExpanded, setCustomExpanded] = useState(false);
    const [colorsExpanded, setColorsExpanded] = useState(false);
    const customId = useId();
    const colorsId = useId();
    useEffect(() => setDraft(appearance), [appearance]);
    const values = canvasAppearanceValues(draft, colorTheme);
    const presets = CANVAS_APPEARANCE_PRESETS.filter((preset) => preset.values.baseTheme === values.baseTheme);
    const activePreset = draft.mode === "preset" ? draft.preset?.id : draft.mode === "custom" ? undefined : draft.mode;
    const apply = (next: CanvasAppearance) => {
        if (next === draft) return;
        setDraft(next);
        onAppearanceChange(next);
    };
    const selectPreset = (id: CanvasAppearancePresetId) => apply(canvasAppearanceForPreset(id, draft));
    const updateCustom = (patch: Partial<CanvasCustomAppearance>) => apply(updateCustomCanvasAppearance(draft, patch, colorTheme));
    const resetCustom = () => selectPreset(draft.preset?.values.baseTheme === values.baseTheme ? draft.preset.id : values.baseTheme);

    return (
        <div className="mt-2.5 space-y-2.5 text-[var(--fs-caption)]">
            <div className="grid grid-cols-3 gap-1 rounded-[var(--dock-item-radius)] border p-1" role="group" aria-label="画布主题模式" style={{ background: theme.spatial.surface, borderColor: theme.toolbar.border }}>
                {([
                    { id: "light", label: "浅色", icon: Sun },
                    { id: "dark", label: "深色", icon: Moon },
                ] as const).map(({ id, label, icon: Icon }) => {
                    const active = values.baseTheme === id;
                    return <button key={id} type="button" aria-label={`切换到${label}主题`} aria-pressed={active}
                        className="inline-flex min-h-8 items-center justify-center gap-1 rounded-[var(--dock-item-radius)] px-1 font-medium focus-visible:outline focus-visible:outline-2"
                        style={{ background: active ? theme.toolbar.itemHover : undefined, color: active ? theme.node.text : theme.toolbar.item }}
                        onClick={() => apply(switchCanvasAppearanceTheme(draft, id))}>
                        <Icon className="size-3.5" />{label}
                    </button>;
                })}
                <button type="button" aria-label="自定义配色" aria-expanded={customExpanded} aria-controls={customId}
                    className="inline-flex min-h-8 items-center justify-center gap-1 rounded-[var(--dock-item-radius)] px-1 font-medium focus-visible:outline focus-visible:outline-2"
                    style={{ color: theme.toolbar.item }} onClick={() => setCustomExpanded(!customExpanded)}>
                    <Paintbrush className="size-3.5" />自定义<ChevronDown className={`size-3 ${customExpanded ? "rotate-180" : ""}`} />
                </button>
            </div>
            {customExpanded ? <div id={customId} className="space-y-2.5 rounded-[var(--dock-item-radius)] border p-2" role="region" aria-label="自定义配色" style={{ borderColor: theme.toolbar.border }}>
                <div className="grid grid-cols-4 gap-1.5" role="group" aria-label={`${values.baseTheme === "light" ? "浅色" : "深色"}配色预设`}>
                {presets.map((preset) => {
                    const palette = canvasThemes[preset.values.baseTheme];
                    return (
                        <button key={preset.id} type="button" aria-label={`使用${preset.label}预设`} aria-pressed={activePreset === preset.id}
                            className="flex min-w-0 flex-col items-center gap-1 rounded-[var(--dock-item-radius)] border px-1 py-1.5 transition-colors motion-reduce:transition-none focus-visible:outline focus-visible:outline-2"
                            style={{ background: theme.spatial.surface, borderColor: activePreset === preset.id ? theme.node.activeStroke : theme.toolbar.border, color: theme.node.text }}
                            onClick={() => selectPreset(preset.id)}>
                            <span aria-hidden="true" className="relative h-7 w-9 shrink-0 overflow-hidden rounded border" style={{ background: preset.values.backgroundColor, borderColor: palette.toolbar.border }}>
                                <span className="absolute inset-0" style={{ backgroundImage: `linear-gradient(${preset.values.gridColor} 1px, transparent 1px), linear-gradient(90deg, ${preset.values.gridColor} 1px, transparent 1px)`, backgroundSize: "10px 10px", opacity: preset.values.gridOpacity / 100 * 0.46 }} />
                                <span className="absolute bottom-1 right-1 h-3 w-4 rounded-sm border" style={{ background: palette.node.fill, borderColor: palette.node.stroke }} />
                            </span>
                            <span className="truncate font-medium">{preset.label}</span>
                        </button>
                    );
                })}
                </div>
            <div className="flex h-6 min-w-0 items-center justify-between gap-2">
                <span className="truncate" style={{ color: theme.node.muted }}>{draft.mode === "custom" ? "自定义 · 已调整" : presets.find((preset) => preset.id === activePreset)?.label}</span>
                {draft.mode === "custom" ? (
                    <button type="button" className="inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 focus-visible:outline focus-visible:outline-2" onClick={resetCustom}>
                        <RotateCcw className="size-3" />恢复预设
                    </button>
                ) : draft.custom?.baseTheme === values.baseTheme ? (
                    <button type="button" className="inline-flex shrink-0 items-center gap-1 rounded py-0.5 focus-visible:outline focus-visible:outline-2" onClick={() => updateCustom(draft.custom!)}>
                        <Paintbrush className="size-3" />恢复自定义
                    </button>
                ) : null}
            </div>
            <SliderField label="明亮度" value={values.backgroundBrightness} min={-30} max={30} onChange={(backgroundBrightness) => updateCustom({ backgroundBrightness })} />
            <SliderField label="网格强度" value={values.gridOpacity} min={0} max={100} onChange={(gridOpacity) => updateCustom({ gridOpacity })} />
            <div className="rounded-[var(--dock-item-radius)] border" style={{ borderColor: theme.toolbar.border }}>
                <button type="button" className="flex w-full items-center justify-between rounded-[inherit] px-2 py-1.5 font-medium focus-visible:outline focus-visible:outline-2" aria-expanded={colorsExpanded} aria-controls={colorsId} onClick={() => setColorsExpanded(!colorsExpanded)}>
                    <span className="inline-flex items-center gap-1.5"><Paintbrush className="size-3.5" />更多颜色</span>
                    <ChevronDown className={`size-3.5 ${colorsExpanded ? "rotate-180" : ""}`} />
                </button>
                {colorsExpanded ? (
                    <div id={colorsId} className="space-y-2 px-2 pb-2">
                        <ColorField label="背景颜色" value={values.backgroundColor} theme={theme} onChange={(backgroundColor) => updateCustom({ backgroundColor, backgroundBrightness: 0 })} />
                        <ColorField label="网格颜色" value={values.gridColor} theme={theme} onChange={(gridColor) => updateCustom({ gridColor })} />
                    </div>
                ) : null}
            </div>
            </div> : null}
            <div className="flex items-center gap-2">
                <span className="w-[60px] shrink-0">网格样式</span>
                <Segmented block size="small" className="min-w-0 flex-1" aria-label="网格样式" value={backgroundMode} onChange={(value) => onBackgroundModeChange(value as CanvasBackgroundMode)} options={[
                    { value: "dots", label: <span className="inline-flex items-center gap-1"><CircleDot className="size-3" />点</span> },
                    { value: "lines", label: <span className="inline-flex items-center gap-1"><Grid2x2 className="size-3" />线</span> },
                    { value: "blank", label: <span className="inline-flex items-center gap-1"><Square className="size-3" />空白</span> },
                ]} />
            </div>
            <div className="space-y-1.5">
                <p className="m-0" style={{ color: theme.node.muted }}>修改自动保存到当前画布</p>
                <Button block size="small" onClick={() => onSaveAppearanceDefault(draft)}>设为新画布默认</Button>
                <p className="m-0" style={{ color: theme.node.muted }}>默认设置仅用于当前账号在本机新建的画布</p>
            </div>
        </div>
    );
}

function ColorField({ label, value, theme, onChange }: { label: string; value: string; theme: CanvasTheme; onChange: (value: string) => void }) {
    const [textValue, setTextValue] = useState(value);
    const [editing, setEditing] = useState(false);
    useEffect(() => {
        if (!editing) setTextValue(value);
    }, [editing, value]);
    const commit = () => {
        const normalized = normalizeHexColor(textValue);
        setEditing(false);
        if (normalized) {
            setTextValue(normalized);
            onChange(normalized);
        } else {
            setTextValue(value);
        }
    };
    return (
        <label className="grid grid-cols-[60px_24px_minmax(0,1fr)] items-center gap-1.5">
            <span>{label}</span>
            <ColorPicker disabledAlpha size="small" value={value} onChange={(color) => onChange(color.toHexString().toUpperCase())} />
            <Input size="small" value={textValue} aria-label={`${label}色码`} style={{ color: theme.node.text }} onFocus={() => setEditing(true)} onChange={(event) => {
                const next = event.target.value;
                setTextValue(next);
                const normalized = normalizeHexColor(next);
                if (normalized) onChange(normalized);
            }} onBlur={commit} onPressEnter={commit} />
        </label>
    );
}

function SliderField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
    return (
        <div className="grid grid-cols-[60px_minmax(0,1fr)_34px] items-center gap-2">
            <span>{label}</span>
            <Slider style={{ margin: 0 }} ariaLabelForHandle={label} min={min} max={max} value={value} tooltip={{ open: false }} onChange={onChange} />
            <span className="text-right tabular-nums">{value > 0 && min < 0 ? "+" : ""}{value}%</span>
        </div>
    );
}
