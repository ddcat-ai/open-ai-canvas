import { useEffect, useState, type ReactNode } from "react";
import { Button, ColorPicker, Input, Segmented, Slider } from "antd";
import { CircleDot, Grid2x2, Moon, Paintbrush, RotateCcw, Save, Square, Sun } from "lucide-react";

import {
    canvasAppearanceForTheme,
    customCanvasAppearanceFromTheme,
    enterCustomCanvasAppearance,
    normalizeHexColor,
    type CanvasAppearance,
    type CanvasCustomAppearance,
} from "@/lib/canvas/canvas-appearance";
import type { CanvasBackgroundMode, CanvasColorTheme, CanvasTheme } from "@/lib/canvas-theme";

const LIGHT_PRESETS = ["#EDEEEE", "#F3DCE5", "#EEE5D8", "#DFE9E6"];
const DARK_PRESETS = ["#262626", "#30272B", "#302D26", "#25302E"];

export function CanvasAppearanceControls({
    appearance,
    backgroundMode,
    colorTheme,
    theme,
    onAppearanceChange,
    onSaveAppearanceDefault,
    onBackgroundModeChange,
}: {
    appearance: CanvasAppearance;
    backgroundMode: CanvasBackgroundMode;
    colorTheme: CanvasColorTheme;
    theme: CanvasTheme;
    onAppearanceChange: (appearance: CanvasAppearance) => void;
    onSaveAppearanceDefault: (appearance: CanvasAppearance) => void;
    onBackgroundModeChange: (mode: CanvasBackgroundMode) => void;
}) {
    const [draft, setDraft] = useState(appearance);

    useEffect(() => setDraft(appearance), [appearance]);

    const selectFixedTheme = (target: CanvasColorTheme) => {
        const next = canvasAppearanceForTheme(target, draft);
        setDraft(next);
        onAppearanceChange(next);
    };
    const selectCustomTheme = () => {
        const next = enterCustomCanvasAppearance(draft, colorTheme);
        setDraft(next);
        onAppearanceChange(next);
    };
    const updateCustom = (patch: Partial<CanvasCustomAppearance>) => {
        const current = draft.mode === "custom" && draft.custom
            ? draft
            : enterCustomCanvasAppearance(draft, colorTheme);
        const next: CanvasAppearance = { mode: "custom", custom: { ...current.custom!, ...patch } };
        setDraft(next);
        onAppearanceChange(next);
    };
    const resetCustom = () => {
        const baseTheme = draft.custom?.baseTheme || colorTheme;
        const next = customCanvasAppearanceFromTheme(baseTheme);
        setDraft(next);
        onAppearanceChange(next);
    };
    const saveAsDefault = () => {
        onAppearanceChange(draft);
        onSaveAppearanceDefault(draft);
    };
    const presets = draft.custom?.baseTheme === "dark" ? DARK_PRESETS : LIGHT_PRESETS;

    return (
        <>
            <div className="mt-3 text-[var(--fs-micro)] font-semibold uppercase opacity-45">主题模式</div>
            <div className="mt-1 grid grid-cols-3 gap-1 rounded-[var(--dock-item-radius-labeled)] border p-1" style={{ background: theme.spatial.surface, borderColor: theme.toolbar.border }}>
                <ThemeButton active={draft.mode === "light"} label="浅色" theme={theme} onClick={() => selectFixedTheme("light")}><Sun className="size-3.5" /></ThemeButton>
                <ThemeButton active={draft.mode === "dark"} label="深色" theme={theme} onClick={() => selectFixedTheme("dark")}><Moon className="size-3.5" /></ThemeButton>
                <ThemeButton active={draft.mode === "custom"} label="自定义" theme={theme} onClick={selectCustomTheme}><Paintbrush className="size-3.5" /></ThemeButton>
            </div>

            {draft.mode === "custom" && draft.custom ? (
                <div className="mt-2.5 space-y-2.5 rounded-[var(--dock-item-radius-labeled)] border p-2.5" style={{ background: theme.spatial.surface, borderColor: theme.toolbar.border }}>
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-[var(--fs-tiny)] font-semibold">背景预设</span>
                        <span className="text-[var(--fs-micro)] opacity-50">{draft.custom.baseTheme === "dark" ? "深色" : "浅色"}界面</span>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                        {presets.map((color) => (
                            <button key={color} type="button" className="h-7 rounded-md border transition-transform hover:scale-[1.04] focus-visible:outline focus-visible:outline-2 motion-reduce:transition-none motion-reduce:hover:scale-100" style={{ background: color, borderColor: draft.custom?.backgroundColor === color ? theme.node.activeStroke : theme.toolbar.border }} aria-label={`使用背景颜色 ${color}`} title={color} onClick={() => updateCustom({ backgroundColor: color, backgroundBrightness: 0 })} />
                        ))}
                    </div>
                    <Segmented
                        block
                        size="small"
                        aria-label="界面样式"
                        value={draft.custom.baseTheme}
                        onChange={(value) => updateCustom({ baseTheme: value as CanvasColorTheme })}
                        options={[
                            { value: "light", label: <span className="inline-flex items-center gap-1"><Sun className="size-3.5" />浅色界面</span> },
                            { value: "dark", label: <span className="inline-flex items-center gap-1"><Moon className="size-3.5" />深色界面</span> },
                        ]}
                    />
                    <ColorField label="画布背景" value={draft.custom.backgroundColor} theme={theme} onChange={(backgroundColor) => updateCustom({ backgroundColor, backgroundBrightness: 0 })} />
                    <SliderField label="明亮度" value={draft.custom.backgroundBrightness} min={-30} max={30} suffix="%" onChange={(backgroundBrightness) => updateCustom({ backgroundBrightness })} />
                    <ColorField label="网格颜色" value={draft.custom.gridColor} theme={theme} onChange={(gridColor) => updateCustom({ gridColor })} />
                    <SliderField label="网格强度" value={draft.custom.gridOpacity} min={0} max={100} suffix="%" onChange={(gridOpacity) => updateCustom({ gridOpacity })} />
                    <Button block size="small" type="text" icon={<RotateCcw className="size-3.5" />} onClick={resetCustom}>从继承主题重新开始</Button>
                    <Button block size="small" type="primary" icon={<Save className="size-3.5" />} onClick={saveAsDefault}>保存为默认</Button>
                </div>
            ) : null}

            <div className="mt-3 text-[var(--fs-micro)] font-semibold uppercase opacity-45">空间网格</div>
            <Segmented
                className="mt-1 w-full !rounded-[var(--dock-item-radius-labeled)] !p-0.5 [&_.ant-segmented-group]:!flex [&_.ant-segmented-item]:!min-h-7 [&_.ant-segmented-item]:!flex-1 [&_.ant-segmented-item-label]:!min-h-7 [&_.ant-segmented-item-label]:!text-[var(--fs-tiny)] [&_.ant-segmented-item-label]:!leading-7"
                value={backgroundMode}
                onChange={(value) => onBackgroundModeChange(value as CanvasBackgroundMode)}
                options={[
                    { value: "dots", label: <span className="inline-flex items-center gap-1.5"><CircleDot className="size-3.5" />点</span> },
                    { value: "lines", label: <span className="inline-flex items-center gap-1.5"><Grid2x2 className="size-3.5" />线</span> },
                    { value: "blank", label: <span className="inline-flex items-center gap-1.5"><Square className="size-3.5" />空白</span> },
                ]}
            />
        </>
    );
}

function ThemeButton({ active, label, theme, onClick, children }: { active: boolean; label: string; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" className="inline-flex h-8 min-w-0 items-center justify-center gap-1 rounded-[var(--dock-item-radius)] px-1 text-[var(--fs-tiny)] font-semibold transition-colors" style={active ? { background: theme.node.text, color: theme.node.panel } : { color: theme.toolbar.item }} aria-label={`切换到${label}主题`} aria-pressed={active} title={`切换到${label}主题`} onClick={onClick}>
            {children}<span className="truncate">{label}</span>
        </button>
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
        <label className="grid grid-cols-[72px_28px_minmax(0,1fr)] items-center gap-1.5 text-[var(--fs-tiny)] font-medium">
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

function SliderField({ label, value, min, max, suffix, onChange }: { label: string; value: number; min: number; max: number; suffix: string; onChange: (value: number) => void }) {
    return (
        <div className="grid grid-cols-[72px_minmax(0,1fr)_38px] items-center gap-1.5 text-[var(--fs-tiny)] font-medium">
            <span>{label}</span>
            <Slider className="m-0" min={min} max={max} value={value} tooltip={{ open: false }} onChange={onChange} />
            <span className="text-right tabular-nums opacity-60">{value > 0 && min < 0 ? "+" : ""}{value}{suffix}</span>
        </div>
    );
}
