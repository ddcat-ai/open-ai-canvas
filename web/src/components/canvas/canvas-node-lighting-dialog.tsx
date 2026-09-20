import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Slider } from "antd";

import { motion, useReducedMotion } from "motion/react";
import { RotateCcw, Send, Sun, X } from "lucide-react";

import { SpotlightSurface } from "@/components/ui/aceternity/spotlight-surface";
import { Tooltip } from "@/components/ui/base/tooltip";
import { aceternityMotion } from "@/lib/aceternity-motion";
import { canvasThemes } from "@/lib/canvas-theme";
import { useCopyText } from "@/hooks/use-copy-text";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";

export type CanvasImageLightingOptions = {
    azimuth: number;
    elevation: number;
    brightness: number;
    rimLight: boolean;
    stylePreset: string;
    smartMode: boolean;
    lightColor: string;
};

const defaultLightingOptions: CanvasImageLightingOptions = { azimuth: 0, elevation: 0, brightness: 50, rimLight: false, stylePreset: "", smartMode: true, lightColor: "#ffffff" };

const LIGHT_POSITIONS = [
    { label: "左侧", azimuth: 270, elevation: 0 },
    { label: "顶部", azimuth: 0, elevation: 80 },
    { label: "右侧", azimuth: 90, elevation: 0 },
    { label: "前方", azimuth: 0, elevation: 0 },
    { label: "底部", azimuth: 0, elevation: -80 },
    { label: "后方", azimuth: 180, elevation: 0 },
];

const LIGHTING_PREVIEW_COLUMN_WIDTH = 300;
const LIGHTING_SPHERE_SIZE = 220;

const STYLE_PRESETS = [
    { id: "overexposed", name: "过曝胶片", color: "#d4b896", image: "/lighting-presets/overexposed.png", prompt: "overexposed film aesthetic, high-key lighting, washed out highlights, soft diffused light, vintage film look" },
    { id: "blueBacklight", name: "蓝色逆光", color: "#1a3a5c", image: "/lighting-presets/blue-backlight.png", prompt: "dramatic backlighting, blue rim light, cool color temperature, silhouette with colored edges, ethereal atmosphere" },
    { id: "rembrandt", name: "伦勃朗光", color: "#5a3a1a", image: "/lighting-presets/rembrandt.png", prompt: "Rembrandt lighting, 45-degree angle key light, dramatic chiaroscuro, painterly shadows, classical portraiture" },
    { id: "cyberpunk", name: "赛博朋克", color: "#2a0a2a", image: "/lighting-presets/cyberpunk.png", prompt: "cyberpunk neon lighting, synthetic glow, futuristic atmosphere, vibrant cyan and magenta neon" },
    { id: "sunset", name: "落日迷幻", color: "#7a3010", image: "/lighting-presets/sunset.png", prompt: "golden hour lighting, warm sunset tones, long shadow, romantic atmosphere, Kodachrome colors" },
    { id: "mysterious", name: "神秘暗调", color: "#0a0a14", image: "/lighting-presets/mysterious.png", prompt: "low-key noir lighting, deep shadows, mysterious mood, film noir style, high contrast cinematic" },
    { id: "goldenHour", name: "黄金时刻", color: "#7a5a00", image: "/lighting-presets/golden-hour.png", prompt: "golden hour photography, warm soft light, beautiful catchlights, lens flare, magical golden glow" },
    { id: "nolanGrey", name: "诺兰冷灰", color: "#1a2a2a", image: "/lighting-presets/nolan-grey.png", prompt: "Christopher Nolan cinematography, IMAX quality, desaturated cold palette, teal and grey grading" },
];

const DEFAULT_LIGHTING_PROMPT_TEMPLATE = [
    "{{consistencyPrompt}}",
    "{{presetPrompt}}",
    "{{smartDesc}}",
    "{{lightDirectionPrompt}}",
    "{{brightnessPrompt}}",
    "{{rimLightPrompt}}",
    "{{lightColorPrompt}}",
    "{{lightingMeta}}",
].join(", ");

const LIGHTING_PROMPT_PLACEHOLDERS = [
    "{{consistencyPrompt}}",
    "{{presetPrompt}}",
    "{{smartDesc}}",
    "{{lightDirectionPrompt}}",
    "{{brightnessPrompt}}",
    "{{rimLightPrompt}}",
    "{{lightColorPrompt}}",
    "{{lightingMeta}}",
];

export function buildLightingLabel(options: CanvasImageLightingOptions) {
    const preset = STYLE_PRESETS.find((item) => item.id === options.stylePreset);
    const position = LIGHT_POSITIONS.find((item) => item.azimuth === options.azimuth && item.elevation === options.elevation);
    const parts: string[] = [];
    parts.push(preset?.name || (position ? `主光${position.label}` : `主光 ${options.azimuth}°/${options.elevation}°`));
    if (options.brightness !== 50) parts.push(`亮度 ${options.brightness}%`);
    if (options.rimLight) parts.push("轮廓光");
    if (options.lightColor && options.lightColor.toLowerCase() !== "#ffffff") parts.push(`光色 ${options.lightColor}`);
    return `AI 打光：${parts.join("，")}`;
}

function applyPromptTemplate(template: string, values: Record<string, string>) {
    return template
        .replace(/\{\{(\w+)\}\}/g, (_match, key: string) => values[key] ?? "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .join(", ");
}

// 将方位角与俯仰角转换成模型更稳定的自然语言；禁止描述实体灯具，避免模型把摄影设备画进画面。
function buildLightDirectionPrompt(azimuth: number, elevation: number) {
    const azimuthDegrees = ((azimuth % 360) + 360) % 360;
    if (elevation >= 60) return "strong top-down key light from directly above";
    if (elevation <= -60) return "strong upward uplight from directly below the subject";
    const azimuthName = azimuthDegrees >= 345 || azimuthDegrees <= 15
        ? "coming from the front"
        : azimuthDegrees > 15 && azimuthDegrees < 75
            ? "coming from the front-right at 45 degrees"
            : azimuthDegrees >= 75 && azimuthDegrees <= 105
                ? "coming from the right side, pure side-light"
                : azimuthDegrees > 105 && azimuthDegrees < 165
                    ? "coming from the back-right, creating rim and edge light"
                    : azimuthDegrees >= 165 && azimuthDegrees <= 195
                        ? "coming from directly behind the subject, strong backlight and silhouette"
                        : azimuthDegrees > 195 && azimuthDegrees < 255
                            ? "coming from the back-left, creating rim and edge light"
                            : azimuthDegrees >= 255 && azimuthDegrees <= 285
                                ? "coming from the left side, pure side-light"
                                : "coming from the front-left at 45 degrees";
    const elevationName = elevation >= 30
        ? ", tilted downward from above"
        : elevation <= -30
            ? ", tilted upward from below"
            : "";
    return `main key light ${azimuthName}${elevationName}`;
}

function buildLightingPrompt(input: {
    template: string;
    consistencyPrompt: string;
    presetPrompt: string;
    smartDesc: string;
    lightDirectionPrompt: string;
    brightnessPrompt: string;
    rimLightPrompt: string;
    lightColorPrompt: string;
    lightingMeta: string;
}) {
    const template = input.template.includes("{{consistencyPrompt}}") ? input.template : `{{consistencyPrompt}}, ${input.template}`;
    return applyPromptTemplate(template, {
        consistencyPrompt: input.consistencyPrompt,
        presetPrompt: input.presetPrompt,
        smartDesc: input.smartDesc,
        lightDirectionPrompt: input.lightDirectionPrompt,
        brightnessPrompt: input.brightnessPrompt,
        rimLightPrompt: input.rimLightPrompt,
        lightColorPrompt: input.lightColorPrompt,
        lightingMeta: input.lightingMeta,
    });
}

export function CanvasNodeLightingPanel({ dataUrl, onClose, onConfirm }: { dataUrl: string; onClose: () => void; onConfirm: (options: CanvasImageLightingOptions, prompt: string) => void }) {
    const theme = canvasThemes[useActiveTheme()];
    const reducedMotion = useReducedMotion();
    const copyText = useCopyText();
    const [options, setOptions] = useState(defaultLightingOptions);
    const [smartDesc, setSmartDesc] = useState("");
    const [viewMode, setViewMode] = useState<"perspective" | "front">("perspective");
    const [isTemplateDialogOpen, setIsTemplateDialogOpen] = useState(false);
    const [promptTemplate, setPromptTemplate] = useState(DEFAULT_LIGHTING_PROMPT_TEMPLATE);

    const updateOption = <Key extends keyof CanvasImageLightingOptions>(key: Key, value: CanvasImageLightingOptions[Key]) => setOptions((current) => ({ ...current, [key]: value }));

    const buildPrompt = useCallback(() => {
        const presetPrompt = options.stylePreset ? STYLE_PRESETS.find((preset) => preset.id === options.stylePreset)?.prompt ?? "" : "";
        const smartDescPrompt = options.smartMode ? smartDesc.trim() : "";
        const brightnessPrompt = options.brightness >= 75
            ? "high-key, bright and well-lit scene, lifted exposure"
            : options.brightness <= 25
                ? "low-key, dim and moody scene, deep shadows, reduced exposure"
                : options.brightness === 50
                    ? ""
                    : options.brightness > 50
                        ? "slightly brighter exposure"
                        : "slightly darker exposure";
        const rimLightPrompt = options.rimLight ? "add clear rim light and edge highlight along the silhouette" : "";
        const lightColorPrompt = options.lightColor && options.lightColor.toLowerCase() !== "#ffffff" ? `key light color temperature tinted toward ${options.lightColor}` : "";
        const lightingMeta = `[lighting azimuth:${options.azimuth}° elevation:${options.elevation}° brightness:${options.brightness}%${options.rimLight ? " rim:on" : ""}]`;
        const consistencyPrompt = [
            "this is a lighting-only edit of the reference image: same scene, same people, same action, same clothing, same background, only the lighting changes",
            "the following instructions describe how light falls on the subject, they are not new objects to add to the scene",
            "do not add any lamp, spotlight, light fixture, reflector, softbox, torch, candle, or photography equipment into the image",
            "preserve identity, face, outfit, hairstyle, body pose, and the background layout from the input image",
            "if multiple people are present, preserve the same number of people and their spatial relationship",
            "only change lighting direction, light color, brightness, shadows, contrast, and mood",
        ].join(", ");
        return buildLightingPrompt({
            template: promptTemplate,
            consistencyPrompt,
            presetPrompt,
            smartDesc: smartDescPrompt,
            lightDirectionPrompt: buildLightDirectionPrompt(options.azimuth, options.elevation),
            brightnessPrompt,
            rimLightPrompt,
            lightColorPrompt,
            lightingMeta,
        });
    }, [options, promptTemplate, smartDesc]);

    const handleApply = () => onConfirm(options, buildPrompt());
    const handleReset = () => {
        setOptions(defaultLightingOptions);
        setSmartDesc("");
        setViewMode("perspective");
    };
    const isPositionActive = (position: { azimuth: number; elevation: number }) => position.azimuth === options.azimuth && position.elevation === options.elevation;

    const secondaryButtonClass = "flex h-8 items-center gap-1.5 rounded-[var(--dock-item-radius)] px-3 text-[var(--fs-label)] font-medium transition hover:bg-black/5 dark:hover:bg-white/10";

    return (
        <SpotlightSurface
            data-canvas-no-zoom
            spotlightColor={theme.toolbar.itemHover}
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={reducedMotion ? { duration: 0 } : aceternityMotion.spring.panel}
            className="w-full max-w-full overflow-hidden rounded-[var(--r-2xl)] border backdrop-blur-2xl"
            style={{ background: theme.spatial.elevated, borderColor: theme.toolbar.border, color: theme.node.text, boxShadow: `0 28px 80px ${theme.spatial.shadow}` }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className="flex h-14 items-center justify-between border-b px-5" style={{ borderColor: theme.toolbar.border }}>
                <h2 className="text-[var(--fs-title)] font-semibold leading-none">打光效果</h2>
                <button
                    type="button"
                    aria-label="关闭打光效果"
                    className="grid size-8 place-items-center rounded-[var(--r-md)] transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                    style={{ color: theme.node.muted }}
                    onClick={onClose}
                >
                    <X className="size-5" />
                </button>
            </div>
            <div className="grid items-stretch" style={{ gridTemplateColumns: `${LIGHTING_PREVIEW_COLUMN_WIDTH}px minmax(0, 1fr)` }}>
                <div className="flex shrink-0 flex-col items-center gap-2 border-r px-3 py-3" style={{ width: LIGHTING_PREVIEW_COLUMN_WIDTH, borderColor: theme.toolbar.border }}>
                    <div className="flex w-full gap-1 rounded-[var(--r-md)] p-1" style={{ background: theme.toolbar.itemHover }}>
                        {(["perspective", "front"] as const).map((mode) => (
                            <button
                                key={mode}
                                type="button"
                                aria-pressed={viewMode === mode}
                                onClick={() => setViewMode(mode)}
                                className="flex-1 rounded-[var(--r-md)] py-1 text-[11px] font-medium transition-colors"
                                style={viewMode === mode ? { background: theme.toolbar.activeBg, color: theme.toolbar.activeText } : { color: theme.node.muted }}
                            >
                                {mode === "perspective" ? "透视" : "正面"}
                            </button>
                        ))}
                    </div>
                    <LightingSphereControl
                        azimuth={options.azimuth}
                        elevation={options.elevation}
                        onAngleChange={(azimuthValue, elevationValue) => setOptions((current) => ({ ...current, azimuth: azimuthValue, elevation: elevationValue }))}
                        previewImageUrl={dataUrl}
                        viewMode={viewMode}
                    />
                </div>

                <div className="flex min-w-0 flex-1 flex-col justify-between gap-2.5 px-4 py-3">
                    <div className="flex items-center justify-between">
                        <span className="text-[var(--fs-tiny)] font-medium" style={{ color: theme.node.muted }}>全局</span>
                        <PanelToggle label="智能模式" checked={options.smartMode} onChange={(checked) => updateOption("smartMode", checked)} theme={theme} />
                    </div>

                    <div className="flex items-center gap-2">
                        <span className="w-8 shrink-0 text-[var(--fs-tiny)]" style={{ color: theme.node.muted }}>亮度</span>
                        <div className="min-w-0 flex-1"><Slider min={0} max={100} value={options.brightness} onChange={(value) => updateOption("brightness", value)} tooltip={{ formatter: (value) => `${value}%` }} /></div>
                        <div className="flex h-6 items-center gap-1 rounded-[var(--r-md)] border px-1.5 text-[11px]" style={{ borderColor: theme.toolbar.border, background: theme.toolbar.itemHover, color: theme.node.muted }}>
                            <Sun className="size-3" />
                            <span className="w-7 text-right tabular-nums">{options.brightness}%</span>
                        </div>
                    </div>

                    <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                            <span className="w-8 shrink-0 text-[var(--fs-tiny)]" style={{ color: theme.node.muted }}>颜色</span>
                            <LightColorSwatch value={options.lightColor} theme={theme} onChange={(value) => updateOption("lightColor", value)} />
                        </div>
                        <PanelToggle label="轮廓光" checked={options.rimLight} onChange={(checked) => updateOption("rimLight", checked)} theme={theme} />
                    </div>

                    <div className="space-y-1.5">
                        <span className="text-[var(--fs-tiny)] font-medium" style={{ color: theme.node.muted }}>主光源</span>
                        <div className="grid grid-cols-3 gap-1">
                            {LIGHT_POSITIONS.map((position) => (
                                <button
                                    key={position.label}
                                    type="button"
                                    aria-pressed={isPositionActive(position)}
                                    onClick={() => setOptions((current) => ({ ...current, azimuth: position.azimuth, elevation: position.elevation }))}
                                    className="rounded-[var(--r-md)] py-1.5 text-xs font-medium transition-colors"
                                    style={isPositionActive(position) ? { background: theme.node.activeStroke, color: theme.node.panel } : { background: theme.toolbar.itemHover, color: theme.node.text }}
                                >
                                    {position.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex flex-col gap-3 border-t px-4 py-3" style={{ borderColor: theme.toolbar.border }}>
                <span className="text-[var(--fs-tiny)] font-medium" style={{ color: theme.node.muted }}>智能模式</span>
                <textarea
                    value={smartDesc}
                    onChange={(event) => setSmartDesc(event.target.value)}
                    placeholder="简单描述你想要实现的打光效果，或者情绪风格"
                    disabled={!options.smartMode}
                    className="h-16 w-full resize-none rounded-[var(--r-lg)] border px-3 py-2 text-xs outline-none transition-colors"
                    style={{ borderColor: theme.toolbar.border, background: theme.toolbar.itemHover, color: theme.node.text, opacity: options.smartMode ? 1 : 0.55 }}
                />
                <span className="text-[var(--fs-tiny)] font-medium" style={{ color: theme.node.muted }}>预设</span>
                <div className="grid shrink-0 auto-rows-[60px] grid-cols-4 gap-1.5">
                    {STYLE_PRESETS.map((preset) => (
                        <button
                            key={preset.id}
                            type="button"
                            aria-pressed={options.stylePreset === preset.id}
                            onClick={() => updateOption("stylePreset", options.stylePreset === preset.id ? "" : preset.id)}
                            className={`relative h-full min-h-0 overflow-hidden rounded-[var(--r-lg)] text-left transition-[box-shadow,filter,border-color,background-color] duration-150 ${options.stylePreset === preset.id ? "ring-2 ring-white/60 shadow-[0_0_0_1px_rgba(255,255,255,0.15)]" : "hover:ring-1 hover:ring-white/30"}`}
                            style={{
                                backgroundImage: `linear-gradient(to top, rgba(0,0,0,0.78), rgba(0,0,0,0.08)), url(${preset.image})`,
                                backgroundSize: "cover",
                                backgroundPosition: "center",
                                backgroundColor: preset.color,
                            }}
                        >
                            <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(255,255,255,0.22),transparent_36%)]" />
                            <span className="absolute bottom-1.5 left-2 right-2 text-[11px] font-medium leading-tight text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]">{preset.name}</span>
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex h-12 items-center gap-2 border-t px-3" style={{ borderColor: theme.toolbar.border }}>
                <button type="button" className={secondaryButtonClass} style={{ color: theme.node.muted }} onClick={handleReset}><RotateCcw className="size-3.5" />重置参数</button>
                <span className="flex-1" />
                <Tooltip title="复制当前生成的打光提示词">
                    <button type="button" className={secondaryButtonClass} onClick={() => copyText(buildPrompt(), "打光提示词已复制")}>复制提示词</button>
                </Tooltip>
                <button type="button" className={secondaryButtonClass} onClick={() => setIsTemplateDialogOpen(true)}>设置提示词</button>
                <motion.button
                    type="button"
                    whileHover={reducedMotion ? undefined : { y: -1 }}
                    whileTap={reducedMotion ? undefined : { scale: 0.97 }}
                    className="flex h-8 items-center gap-1.5 rounded-[var(--dock-item-radius)] border px-3 text-[var(--fs-label)] font-semibold transition-colors"
                    style={{ borderColor: theme.node.activeStroke, color: theme.node.activeStroke, background: "transparent" }}
                    onClick={handleApply}
                >
                    <Send className="size-3.5" />生成打光效果
                </motion.button>
            </div>

            <PromptTemplateDialog
                isOpen={isTemplateDialogOpen}
                title="设置打光默认提示词"
                description="这里修改的是系统自动附加的默认打光描述骨架，不包含你当前选择的亮度、方向、颜色等参数值。面板参数会自动替换进去；智能模式里输入的文字会单独叠加。"
                value={promptTemplate}
                defaultValue={DEFAULT_LIGHTING_PROMPT_TEMPLATE}
                placeholders={LIGHTING_PROMPT_PLACEHOLDERS}
                theme={theme}
                onClose={() => setIsTemplateDialogOpen(false)}
                onChange={setPromptTemplate}
            />
        </SpotlightSurface>
    );
}

function LightColorSwatch({ value, theme, onChange }: { value: string; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onChange: (value: string) => void }) {
    const isWhite = value.toLowerCase() === "#ffffff";
    return (
        <label
            className="relative h-6 w-10 shrink-0 cursor-pointer overflow-hidden rounded border"
            style={{
                borderColor: theme.toolbar.border,
                background: isWhite
                    ? "linear-gradient(45deg, #cfcfcf 25%, transparent 25%, transparent 75%, #cfcfcf 75%), linear-gradient(45deg, #cfcfcf 25%, #ffffff 25%, #ffffff 75%, #cfcfcf 75%)"
                    : value,
                backgroundSize: isWhite ? "8px 8px, 8px 8px" : undefined,
                backgroundPosition: isWhite ? "0 0, 4px 4px" : undefined,
            }}
        >
            <input
                type="color"
                aria-label="光线颜色"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                className="absolute inset-0 cursor-pointer opacity-0"
            />
            {isWhite ? <span className="pointer-events-none absolute inset-[-20%] m-auto h-px w-[140%] rotate-45 bg-red-500" /> : null}
        </label>
    );
}

function PanelToggle({ label, checked, onChange, theme }: { label: string; checked: boolean; onChange: (checked: boolean) => void; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    return (
        <div className="flex items-center gap-2">
            <span className="text-[var(--fs-tiny)]" style={{ color: theme.node.muted }}>{label}</span>
            <button
                type="button"
                role="switch"
                aria-checked={checked}
                aria-label={label}
                onClick={() => onChange(!checked)}
                className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors"
                style={{ background: checked ? theme.node.activeStroke : theme.toolbar.itemHover }}
            >
                <span className={`inline-block size-3.5 transform rounded-full shadow transition-transform ${checked ? "translate-x-4" : "translate-x-0.5"}`} style={{ background: checked ? theme.node.panel : theme.node.muted }} />
            </button>
        </div>
    );
}

function PromptTemplateDialog({ isOpen, title, description, value, defaultValue, placeholders, theme, onClose, onChange }: { isOpen: boolean; title: string; description?: string; value: string; defaultValue: string; placeholders: string[]; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onClose: () => void; onChange: (value: string) => void }) {
    const [draft, setDraft] = useState(value);

    useEffect(() => {
        if (isOpen) setDraft(value);
    }, [isOpen, value]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/55 backdrop-blur-[2px]" data-canvas-no-zoom onClick={onClose}>
            <div
                className="w-[560px] max-w-[calc(100vw-32px)] rounded-[var(--r-xl)] border shadow-2xl"
                style={{ background: theme.spatial.elevated, borderColor: theme.toolbar.border, color: theme.node.text }}
                onClick={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
            >
                <div className="flex items-center justify-between border-b px-5 py-3.5" style={{ borderColor: theme.toolbar.border }}>
                    <span className="text-sm font-semibold">{title}</span>
                    <button type="button" aria-label="关闭提示词设置" className="grid size-6 place-items-center rounded-[var(--r-md)] transition hover:bg-black/5 dark:hover:bg-white/10" onClick={onClose}><X className="size-4" /></button>
                </div>
                <div className="space-y-3 px-5 py-4">
                    {description ? (
                        <div className="rounded-[var(--r-lg)] border px-3 py-2 text-xs leading-5" style={{ borderColor: theme.toolbar.border, background: theme.toolbar.itemHover, color: theme.node.muted }}>{description}</div>
                    ) : null}
                    <div className="rounded-[var(--r-lg)] border px-3 py-2" style={{ borderColor: theme.toolbar.border, background: theme.toolbar.itemHover }}>
                        <div className="text-[11px] font-medium" style={{ color: theme.node.muted }}>可用占位符</div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {placeholders.map((placeholder) => (
                                <span key={placeholder} className="rounded-[var(--r-md)] px-2 py-1 text-[11px]" style={{ background: theme.toolbar.activeBg, color: theme.node.text }}>{placeholder}</span>
                            ))}
                        </div>
                    </div>
                    <textarea
                        value={draft}
                        onChange={(event) => {
                            const nextValue = event.target.value;
                            setDraft(nextValue);
                            onChange(nextValue);
                        }}
                        className="h-48 w-full resize-none rounded-[var(--r-lg)] border px-3 py-2 text-sm leading-6 outline-none transition-colors"
                        style={{ borderColor: theme.toolbar.border, background: theme.toolbar.itemHover, color: theme.node.text }}
                    />
                    <div className="rounded-[var(--r-lg)] border px-3 py-2 text-[11px] leading-5" style={{ borderColor: theme.toolbar.border, background: theme.toolbar.itemHover, color: theme.node.muted }}>
                        默认模板：<span style={{ color: theme.node.text }}>{defaultValue}</span>
                    </div>
                </div>
                <div className="flex items-center justify-between border-t px-5 py-3" style={{ borderColor: theme.toolbar.border }}>
                    <button
                        type="button"
                        className="flex items-center gap-1.5 text-xs transition-colors hover:opacity-80"
                        style={{ color: theme.node.muted }}
                        onClick={() => {
                            setDraft(defaultValue);
                            onChange(defaultValue);
                        }}
                    >
                        <RotateCcw className="size-3" />
                        恢复默认
                    </button>
                    <div className="flex items-center gap-2">
                        <button type="button" className="rounded-[var(--r-md)] px-3 py-1.5 text-xs transition hover:opacity-80" style={{ background: theme.toolbar.itemHover }} onClick={onClose}>关闭</button>
                        <button type="button" className="rounded-[var(--r-md)] px-3 py-1.5 text-xs font-medium transition hover:opacity-90" style={{ background: theme.node.activeStroke, color: theme.node.panel }} onClick={() => { onChange(draft); onClose(); }}>保存</button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function drawLightSphere(ctx: CanvasRenderingContext2D, width: number, height: number, azimuth: number, elevation: number, previewImageUrl: string | null | undefined, viewMode: "perspective" | "front") {
    ctx.clearRect(0, 0, width, height);

    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) / 2 - 4;

    // Dark sphere background
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fillStyle = "#111";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.clip();

    const azimuthRadians = (azimuth * Math.PI) / 180;
    const elevationRadians = (elevation * Math.PI) / 180;
    const lightX = viewMode === "front" ? centerX + radius * Math.sin(azimuthRadians) * 0.85 : centerX + radius * Math.sin(azimuthRadians) * Math.cos(elevationRadians);
    const lightY = viewMode === "front" ? centerY - radius * Math.sin(elevationRadians) * 0.85 : centerY - radius * Math.sin(elevationRadians);

    // Light glow around the light source
    const gradientRadius = radius * 1.4;
    const gradient = ctx.createRadialGradient(lightX, lightY, 0, lightX, lightY, gradientRadius);
    gradient.addColorStop(0, "rgba(255,255,240,0.55)");
    gradient.addColorStop(0.35, "rgba(255,230,180,0.18)");
    gradient.addColorStop(0.7, "rgba(255,200,100,0.05)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Grid lines on sphere
    if (viewMode === "front") {
        for (let index = -2; index <= 2; index++) {
            const x = centerX + index * (radius / 3);
            ctx.beginPath();
            ctx.moveTo(x, centerY - radius);
            ctx.lineTo(x, centerY + radius);
            ctx.strokeStyle = "rgba(255,255,255,0.07)";
            ctx.lineWidth = 0.7;
            ctx.stroke();
        }
        for (let index = -2; index <= 2; index++) {
            const y = centerY + index * (radius / 3);
            ctx.beginPath();
            ctx.moveTo(centerX - radius, y);
            ctx.lineTo(centerX + radius, y);
            ctx.strokeStyle = "rgba(255,255,255,0.07)";
            ctx.lineWidth = 0.7;
            ctx.stroke();
        }
    } else {
        for (let latitude = -75; latitude <= 75; latitude += 15) {
            const latitudeRadians = (latitude * Math.PI) / 180;
            const ellipseRadius = radius * Math.cos(latitudeRadians);
            const baseY = centerY - radius * Math.sin(latitudeRadians);
            ctx.beginPath();
            ctx.ellipse(centerX, baseY, ellipseRadius, ellipseRadius * 0.22, 0, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(255,255,255,0.07)";
            ctx.lineWidth = 0.7;
            ctx.stroke();
        }
        for (let index = 0; index < 8; index++) {
            const angle = (index * Math.PI) / 4;
            ctx.beginPath();
            ctx.ellipse(centerX, centerY, radius * Math.abs(Math.cos(angle)), radius, 0, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(255,255,255,0.07)";
            ctx.lineWidth = 0.7;
            ctx.stroke();
        }
    }

    // Draw preview image as a rectangular subject in center
    if (previewImageUrl) {
        const image = new Image();
        image.onload = () => {
            const sourceWidth = image.naturalWidth || image.width;
            const sourceHeight = image.naturalHeight || image.height;
            const aspectRatio = sourceWidth > 0 && sourceHeight > 0 ? sourceWidth / sourceHeight : 2 / 3;
            const maxImageWidth = radius * 0.92;
            const maxImageHeight = radius * 0.96;
            const imageWidth = Math.min(maxImageWidth, maxImageHeight * aspectRatio);
            const imageHeight = Math.min(maxImageHeight, maxImageWidth / aspectRatio);
            ctx.save();
            ctx.shadowColor = "rgba(0,0,0,0.8)";
            ctx.shadowBlur = 12;
            ctx.drawImage(image, centerX - imageWidth / 2, centerY - imageHeight / 2, imageWidth, imageHeight);
            ctx.shadowBlur = 0;
            ctx.strokeStyle = "rgba(255,255,255,0.2)";
            ctx.lineWidth = 1;
            ctx.strokeRect(centerX - imageWidth / 2, centerY - imageHeight / 2, imageWidth, imageHeight);
            ctx.restore();
        };
        image.src = previewImageUrl;
    } else {
        const placeholderWidth = radius * 0.42;
        const placeholderHeight = radius * 0.65;
        ctx.fillStyle = "rgba(255,255,255,0.04)";
        ctx.strokeStyle = "rgba(255,255,255,0.15)";
        ctx.lineWidth = 1;
        ctx.fillRect(centerX - placeholderWidth / 2, centerY - placeholderHeight / 2, placeholderWidth, placeholderHeight);
        ctx.strokeRect(centerX - placeholderWidth / 2, centerY - placeholderHeight / 2, placeholderWidth, placeholderHeight);

        ctx.fillStyle = "rgba(255,255,255,0.2)";
        const headRadius = placeholderWidth * 0.18;
        ctx.beginPath();
        ctx.arc(centerX, centerY - placeholderHeight / 2 + headRadius + 4, headRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(centerX - placeholderWidth * 0.15, centerY - placeholderHeight / 2 + headRadius * 2 + 6, placeholderWidth * 0.3, placeholderHeight * 0.35);
    }

    ctx.restore();

    // Light source dot + glow
    const glowGradient = ctx.createRadialGradient(lightX, lightY, 0, lightX, lightY, 14);
    glowGradient.addColorStop(0, "rgba(255,245,200,0.95)");
    glowGradient.addColorStop(0.4, "rgba(255,220,120,0.5)");
    glowGradient.addColorStop(1, "rgba(255,200,50,0)");
    ctx.beginPath();
    ctx.fillStyle = glowGradient;
    ctx.arc(lightX, lightY, 14, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(lightX, lightY, 5, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fill();
}

function LightingSphereControl({ azimuth, elevation, onAngleChange, previewImageUrl, viewMode = "perspective" }: { azimuth: number; elevation: number; onAngleChange: (azimuth: number, elevation: number) => void; previewImageUrl?: string | null; viewMode?: "perspective" | "front" }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const isDraggingRef = useRef(false);
    const dragStartRef = useRef<{ x: number; y: number; azimuth: number; elevation: number } | null>(null);
    const size = LIGHTING_SPHERE_SIZE;

    const redraw = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        drawLightSphere(ctx, size, size, azimuth, elevation, previewImageUrl, viewMode);
    }, [azimuth, elevation, previewImageUrl, viewMode]);

    useEffect(() => {
        redraw();
    }, [redraw]);

    const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
        event.preventDefault();
        event.stopPropagation();
        isDraggingRef.current = true;
        dragStartRef.current = { x: event.clientX, y: event.clientY, azimuth, elevation };
        event.currentTarget.setPointerCapture(event.pointerId);
    }, [azimuth, elevation]);

    const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
        if (!isDraggingRef.current || !dragStartRef.current) return;
        const deltaX = event.clientX - dragStartRef.current.x;
        const deltaY = event.clientY - dragStartRef.current.y;
        let nextAzimuth = (dragStartRef.current.azimuth + deltaX * 1.5) % 360;
        if (nextAzimuth < 0) nextAzimuth += 360;
        const nextElevation = Math.max(-90, Math.min(90, dragStartRef.current.elevation - deltaY));
        onAngleChange(Math.round(nextAzimuth), Math.round(nextElevation));
    }, [onAngleChange]);

    const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
        isDraggingRef.current = false;
        dragStartRef.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
    }, []);

    return (
        <canvas
            ref={canvasRef}
            width={size}
            height={size}
            aria-label="拖动调整主光源方向"
            className="cursor-grab touch-none rounded-[var(--r-lg)] active:cursor-grabbing"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
        />
    );
}
