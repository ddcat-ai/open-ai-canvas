import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, Coins, Cpu } from "lucide-react";
import { Popover } from "antd";

import { canvasThemes } from "@/lib/canvas-theme";
import { cn } from "@/lib/utils";
import { modelDisplayName, modelOptionLabel, modelOptionName, resolveModelChannel, selectableModelsByCapability, type AiConfig, type ModelCapability } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";

type ModelPickerProps = {
    config: AiConfig;
    value?: string;
    onChange: (model: string) => void;
    capability?: ModelCapability;
    className?: string;
    fullWidth?: boolean;
    placeholder?: string;
    onMissingConfig?: () => void;
    showSelectedPrice?: boolean;
    variant?: "default" | "creation";
};

export function ModelPicker({ config, value, onChange, capability, className, fullWidth = false, placeholder = "选择模型", onMissingConfig, showSelectedPrice = true, variant = "default" }: ModelPickerProps) {
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const pickerId = useId();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [open, setOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const options = useMemo(
        () => {
            const filtered = selectableModelsByCapability(config, capability);
            const current = value?.trim();
            const currentIncluded = current ? filtered.includes(current) : true;
            return Array.from(new Set([...filtered, ...(!currentIncluded && current ? [current] : [])].filter((model): model is string => Boolean(model))));
        },
        [capability, config, value],
    );
    const optionGroups = useMemo(() => {
        const channelGroups = config.channels
            .map((channel) => ({
                key: channel.id,
                label: channel.name || "未命名渠道",
                scope: channel.scope === "system" ? "系统渠道" : "自定义渠道",
                models: options.filter((model) => resolveModelChannel(config, model).id === channel.id),
            }))
            .filter((group) => group.models.length);
        const groupedModels = new Set(channelGroups.flatMap((group) => group.models));
        const ungroupedModels = options.filter((model) => !groupedModels.has(model));
        return ungroupedModels.length ? [...channelGroups, { key: "ungrouped", label: "其他模型", scope: "未指定渠道", models: ungroupedModels }] : channelGroups;
    }, [config, options]);
    const current = value || "";
    const currentPrice = modelMenuPrice(config, current);
    const creationVariant = variant === "creation";

    useEffect(() => {
        const closeOtherPicker = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== pickerId) setOpen(false);
        };
        window.addEventListener("model-picker-open", closeOtherPicker);
        return () => window.removeEventListener("model-picker-open", closeOtherPicker);
    }, [pickerId]);

    useEffect(() => {
        if (!open) return;
        // 画布拖拽从 pointerdown 开始，须在捕获阶段关闭 Portal 菜单，避免菜单与触发器分离。
        const closeOnOutsidePointer = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
            setOpen(false);
        };
        window.addEventListener("pointerdown", closeOnOutsidePointer, true);
        return () => window.removeEventListener("pointerdown", closeOnOutsidePointer, true);
    }, [open]);

    const setPickerOpen = (nextOpen: boolean) => {
        if (nextOpen && !options.length && config.channelMode === "local") onMissingConfig?.();
        if (nextOpen) window.dispatchEvent(new CustomEvent("model-picker-open", { detail: pickerId }));
        setOpen(nextOpen);
    };
    const focusMenuOption = (last = false) => {
        window.requestAnimationFrame(() => {
            const buttons = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]');
            const target = last ? buttons?.item((buttons?.length || 1) - 1) : buttons?.item(0);
            target?.focus();
        });
    };
    const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        setPickerOpen(true);
        focusMenuOption(event.key === "ArrowUp");
    };
    const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
            triggerRef.current?.focus();
            return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'));
        if (!buttons.length) return;
        event.preventDefault();
        const activeIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : event.key === "ArrowUp" ? Math.max(0, activeIndex - 1) : Math.min(buttons.length - 1, activeIndex + 1);
        buttons[nextIndex]?.focus();
    };
    const content = (
        <div
            ref={menuRef}
            data-canvas-no-zoom
            className={cn("canvas-model-picker-menu max-w-[calc(100vw-24px)]", creationVariant ? "creation-model-picker-menu w-[360px]" : "w-[320px]")}
            style={{ background: theme.node.panel, color: theme.node.text }}
            role="listbox"
            aria-label={placeholder}
            onKeyDown={handleMenuKeyDown}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            {creationVariant ? <div className="creation-model-picker-heading"><span>选择模型</span>{current ? <strong>{modelDisplayName(config, current)}</strong> : null}</div> : null}
            {optionGroups.length ? optionGroups.map((group) => (
                <section key={group.key} className="canvas-model-picker-group min-w-0 overflow-hidden">
                    <div className="canvas-model-picker-group-label" style={{ color: theme.node.muted }}>
                        <span className="truncate">{group.label}</span>
                        <span className="shrink-0" style={{ color: theme.node.muted }}>{group.scope}</span>
                    </div>
                    <div className="grid min-w-0 gap-1">
                        {group.models.map((model) => {
                            const selected = model === current;
                            return (
                                <button
                                    key={model}
                                    type="button"
                                    role="option"
                                    aria-selected={selected}
                                    className="canvas-model-picker-option"
                                    style={{ background: selected ? theme.toolbar.activeBg : "transparent", color: theme.node.text }}
                                    onClick={() => {
                                        onChange(model);
                                        setOpen(false);
                                        window.requestAnimationFrame(() => triggerRef.current?.focus());
                                    }}
                                >
                                    <ModelLabel config={config} model={model} capability={capability} theme={theme} creationVariant={creationVariant} showPrice={creditsEnabled} />
                                    {selected ? <Check className="canvas-model-picker-option-check" style={{ color: theme.node.activeStroke }} /> : null}
                                </button>
                            );
                        })}
                    </div>
                </section>
            )) : <div className="canvas-model-picker-empty" style={{ color: theme.node.muted }}>{emptyModelLabel(config, capability)}</div>}
        </div>
    );

    return (
        <div
            className={cn(fullWidth ? "w-full min-w-0" : "w-fit max-w-full")}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <Popover
                open={open}
                onOpenChange={setPickerOpen}
                trigger="click"
                placement="bottomLeft"
                arrow={false}
                content={content}
                classNames={{
                    root: cn("canvas-model-picker-popover", creationVariant && "creation-model-picker-popover"),
                    container: cn("canvas-composer-popover-surface", creationVariant && "creation-model-picker-surface"),
                    content: "canvas-composer-popover-content",
                }}
            >
                <button
                    ref={triggerRef}
                    type="button"
                    className={cn("canvas-composer-model-picker", fullWidth ? "w-full" : "min-w-36 max-w-full", className)}
                    aria-haspopup="listbox"
                    aria-expanded={open}
                    aria-label={placeholder}
                    title={current ? modelOptionLabel(config, current) : placeholder}
                    onKeyDown={handleTriggerKeyDown}
                >
                    <span className="canvas-model-picker-label flex min-w-0 items-center gap-1.5">
                        <span className="canvas-model-picker-trigger-icon" style={{ background: theme.toolbar.itemHover }}><ModelIcon model={current} /></span>
                        <span className="min-w-0 flex-1 truncate">{current ? creationVariant ? modelDisplayName(config, current) : modelOptionLabel(config, current) : placeholder}</span>
                        {showSelectedPrice && creditsEnabled ? <ModelPrice price={currentPrice} compact /> : null}
                    </span>
                    <ChevronDown className={cn("canvas-model-picker-chevron", open && "is-open")} aria-hidden="true" />
                </button>
            </Popover>
        </div>
    );
}

function emptyModelLabel(config: AiConfig, capability?: ModelCapability) {
    const label = capability === "image" ? "生图" : capability === "video" ? "视频" : capability === "text" ? "文本" : capability === "audio" ? "音频" : "";
    if (capability && config.models.length) return `当前渠道没有匹配的${label}模型`;
    return config.models.length ? `暂无匹配的${label}模型` : "请先到配置里添加渠道和模型";
}

function ModelLabel({ config, model, capability, theme, creationVariant, showPrice }: { config: AiConfig; model: string; capability?: ModelCapability; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; creationVariant: boolean; showPrice: boolean }) {
    const meta = modelMenuMeta(model, capability);
    return (
        <span className="flex w-full min-w-0 items-center gap-1.5 overflow-hidden py-0">
            <span className="grid size-6 shrink-0 place-items-center rounded-md" style={{ background: theme.toolbar.itemHover }}>
                <ModelIcon model={model} />
            </span>
            <span className="min-w-0 flex-1 overflow-hidden">
                <span className="block min-w-0 truncate text-[var(--fs-label)] font-medium leading-none">{modelDisplayName(config, model)}</span>
                <span className="mt-1 block truncate text-[var(--fs-tiny)]" style={{ color: theme.node.muted }} title={meta.description}>{meta.description}</span>
            </span>
            {showPrice ? <ModelPrice price={modelMenuPrice(config, model)} /> : null}
            {!creationVariant && meta.time ? <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[var(--fs-tiny)] tabular-nums" style={{ background: theme.toolbar.itemHover, color: theme.node.muted }}>{meta.time}</span> : null}
        </span>
    );
}

function modelMenuPrice(config: AiConfig, model: string): { value: number; unit: "次" | "秒" } | null | undefined {
    if (!model) return undefined;
    const channel = resolveModelChannel(config, model);
    const cost = channel.modelCosts?.find((item) => item.model === modelOptionName(model));
    if (!cost) return channel.scope === "system" ? null : undefined;
    return { value: cost.unitPriceMicrocredits / 1_000_000, unit: cost.billingMode === "per_second" ? "秒" : "次" };
}

function ModelPrice({ price, compact = false }: { price: { value: number; unit: "次" | "秒" } | null | undefined; compact?: boolean }) {
    if (price === undefined) return null;
    if (price === null) return compact ? null : <span className="shrink-0 text-[var(--fs-tiny)] text-foreground/40">未配置</span>;
    return (
        <span className="inline-flex shrink-0 items-center gap-0.5 text-[var(--fs-tiny)] font-bold tabular-nums text-amber-600 dark:text-amber-300" title={`每${price.unit}消耗 ${price.value.toLocaleString("zh-CN", { maximumFractionDigits: 6 })} 积分`}>
            <Coins className="size-3" />
            {price.value.toLocaleString("zh-CN", { maximumFractionDigits: compact ? 3 : 6 })}/{price.unit}
        </span>
    );
}

function modelMenuMeta(model: string, capability?: ModelCapability): { description: string; time?: string } {
    const name = modelOptionName(model).toLowerCase();
    if (capability === "image") {
        if (name.includes("nano banana") || name.includes("nanobanana") || name.includes("imagen")) return { description: "Gemini 高质量图片生成，适合角色和商业成片" };
        if (name.includes("nano") || name.includes("pro")) return { description: "高质量图片生成，适合角色和商业成片" };
        if (name.includes("seedream")) return { description: "快速出图，适合批量探索风格" };
        if (name.includes("gpt") || name.includes("image")) return { description: "通用图片模型，提示词理解稳定" };
        return { description: "图片生成模型" };
    }
    if (capability === "video") {
        if (name.includes("veo") || name.includes("omni flash") || name.includes("omni-flash")) return { description: "Gemini 镜头生成与图生视频，适合成片流程", time: "3m" };
        if (name.includes("seedance") || name.includes("sora")) return { description: "镜头生成与图生视频，适合成片流程", time: "3m" };
        return { description: "视频生成模型", time: "3m" };
    }
    if (capability === "audio") return { description: "语音、音效或音乐生成", time: "20s" };
    if (name.includes("claude")) return { description: "长文本、推理与创意写作", time: "10s" };
    if (name.includes("gemini")) return { description: "多模态理解与快速文本生成", time: "10s" };
    if (name.includes("deepseek")) return { description: "推理、代码和结构化文本", time: "10s" };
    return { description: capability === "text" ? "文本生成模型" : "当前渠道模型", time: "10s" };
}

export function ModelIcon({ model }: { model: string }) {
    const icon = resolveModelIcon(modelOptionName(model));
    const monochrome = icon === "/icons/openai.svg" || icon === "/icons/grok.svg";
    return icon ? <img src={icon} alt="" className={cn("size-3.5 shrink-0", monochrome && "dark:invert")} /> : <Cpu className="size-3.5 shrink-0 opacity-70" />;
}

export function resolveModelIcon(model: string) {
    const name = model.toLowerCase();
    if (name.includes("claude") || name.includes("anthropic")) return "/icons/claude.svg";
    // Flow2API 短名：Nano Banana / Imagen / Veo / Omni 均属 Google Gemini 系。
    if (
        name.includes("gemini") ||
        name.includes("google") ||
        name.includes("nano banana") ||
        name.includes("nanobanana") ||
        name.includes("imagen") ||
        name.includes("veo") ||
        name.includes("omni flash") ||
        name.includes("omni-flash")
    ) {
        return "/icons/gemini.svg";
    }
    if (name.includes("gpt") || name.includes("openai") || name.includes("dall-e") || name.includes("dalle")) return "/icons/openai.svg";
    if (name.includes("grok")) return "/icons/grok.svg";
    if (name.includes("deepseek")) return "/icons/deepseek.svg";
    if (name.includes("glm") || name.includes("chatglm")) return "/icons/glm.svg";
    return "";
}
