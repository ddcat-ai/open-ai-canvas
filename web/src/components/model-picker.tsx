import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Check, ChevronDown, ChevronLeft, Coins } from "lucide-react";
import { Popover } from "antd";

import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { modelCapabilityConfigFor, videoDurationOptions } from "@/lib/model-capabilities";
import { formatPriceRange, modelQuoteDescription, modelQuoteRequest, normalizeTierResolution, priceTierSummaryLabel, priceTiersForCurrentSelection } from "@/lib/model-pricing";
import { compatibleModelInGroup, configuredModelDisplayName, modelCompatibilityError, resolveCompatibleModel, type ModelRequirements } from "@/lib/model-selection";
import { groupModelsForPicker, isDirectSystemModel, modelChannelLabel } from "@/lib/model-picker-groups";
import { cn } from "@/lib/utils";
import { modelDisplayName, modelIcon, modelOptionName, resolveModelChannel, selectableModelsByCapability, type AiConfig, type ModelCapability } from "@/stores/use-config-store";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { ModelLogo } from "@/components/model-logo";
import { quoteModel, type LogicalModelQuote } from "@/services/api/logical-models";

type ModelPickerProps = {
    config: AiConfig;
    value?: string;
    onChange: (model: string) => void;
    capability?: ModelCapability;
    className?: string;
    popoverClassName?: string;
    fullWidth?: boolean;
    placeholder?: string;
    onMissingConfig?: () => void;
    showSelectedPrice?: boolean;
    showOptionPrices?: boolean;
    variant?: "default" | "creation";
    requirements?: ModelRequirements;
    showConfiguredModelName?: boolean;
};

export function ModelPicker({
    config,
    value,
    onChange,
    capability,
    className,
    popoverClassName,
    fullWidth = false,
    placeholder = "选择模型",
    onMissingConfig,
    showSelectedPrice = true,
    showOptionPrices = showSelectedPrice,
    variant = "creation",
    requirements,
    showConfiguredModelName = false,
}: ModelPickerProps) {
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const pickerId = useId();
    // 双保险：即使 store merge 写出非法 theme，这里也兜底到 dark，避免 "reading 'node'" 崩溃
    const rawTheme = useActiveTheme();
    const theme = (canvasThemes[rawTheme as keyof typeof canvasThemes] ?? canvasThemes.dark) as CanvasTheme;
    const [open, setOpen] = useState(false);
    const [activeGroupKey, setActiveGroupKey] = useState<string | null>(null);
    const [previewedModel, setPreviewedModel] = useState("");
    const [triggerWidth, setTriggerWidth] = useState<number | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const options = useMemo(() => Array.from(new Set(selectableModelsByCapability(config, capability).filter(Boolean))), [capability, config]);
    const optionGroups = useMemo(() => groupModelsForPicker(config, options), [config, options]);
    const storedCurrent = value?.trim() || "";
    // 参数档位会在选中模型后由调用方归一到其能力配置，不能因为旧模型留下的参数而禁止切换。
    const selectionRequirements = requirements ? { ...requirements, videoSeconds: undefined, imageSize: undefined, options: undefined } : undefined;
    const resolvedCurrent = isDirectSystemModel(config, storedCurrent) ? storedCurrent : resolveCompatibleModel(config, storedCurrent, selectionRequirements) || storedCurrent;
    // 旧画布可能保存过已下架或前端历史内置模型；它们不能重新进入当前可选目录。
    const current = options.includes(resolvedCurrent) ? resolvedCurrent : "";
    const currentPrice = modelMenuPrice(config, current, capability, false, requirements);
    const quoteRequest = useMemo(() => modelQuoteRequest(config, current, capability, requirements), [capability, config, current, requirements]);
    const [routeQuote, setRouteQuote] = useState<LogicalModelQuote | undefined>();
    const creationVariant = variant === "creation";

    useLayoutEffect(() => {
        const trigger = triggerRef.current;
        if (!trigger) return;
        const updateTriggerWidth = () => setTriggerWidth(Math.ceil(trigger.getBoundingClientRect().width));
        updateTriggerWidth();
        const observer = new ResizeObserver(updateTriggerWidth);
        observer.observe(trigger);
        return () => observer.disconnect();
    }, [className, fullWidth, showSelectedPrice, variant, value]);

    useEffect(() => {
        if (!showSelectedPrice || !creditsEnabled || !quoteRequest) {
            setRouteQuote(undefined);
            return;
        }
        const controller = new AbortController();
        setRouteQuote(undefined);
        quoteModel(quoteRequest, controller.signal)
            .then((payload) => setRouteQuote(payload.quote))
            .catch(() => {
                if (!controller.signal.aborted) setRouteQuote(undefined);
            });
        return () => controller.abort();
    }, [creditsEnabled, quoteRequest, showSelectedPrice]);

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
        if (nextOpen && !options.length) onMissingConfig?.();
        if (nextOpen) window.dispatchEvent(new CustomEvent("model-picker-open", { detail: pickerId }));
        if (nextOpen) {
            setPreviewedModel(current || options[0] || "");
            setActiveGroupKey(null);
        }
        setOpen(nextOpen);
    };
    const focusMenuOption = (last = false) => {
        window.requestAnimationFrame(() => {
            const buttons = menuRef.current?.querySelectorAll<HTMLButtonElement>('[data-model-picker-item]:not(:disabled)');
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
        if (event.key === "ArrowLeft" && activeGroupKey !== null) {
            event.preventDefault();
            setActiveGroupKey(null);
            focusMenuOption();
            return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-model-picker-item]:not(:disabled)'));
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
            className={cn(
                "canvas-model-picker-menu creation-model-picker-menu max-w-[calc(100vw-24px)]",
                activeGroupKey === null ? "is-brand-list" : "is-model-list",
            )}
            style={
                {
                    background: theme.node.panel,
                    color: theme.node.text,
                    "--canvas-model-picker-trigger-width": triggerWidth ? String(triggerWidth) + "px" : undefined,
                } as CSSProperties
            }
            role="listbox"
            aria-label={placeholder}
            onKeyDown={handleMenuKeyDown}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            {optionGroups.length ? (
                activeGroupKey === null ? (
                    <div className="canvas-model-picker-brands" aria-label="选择产品模型">
                        {optionGroups.map((group) => {
                            const groupCurrent = group.models.find((item) => item.models.includes(current));
                            const firstModel = groupCurrent?.models[0] || group.models[0]?.models[0] || "";
                            return <button key={group.key} type="button" data-model-picker-item className="canvas-model-picker-brand" onClick={() => { setActiveGroupKey(group.key); setPreviewedModel(firstModel); focusMenuOption(); }}>
                                <span className="canvas-model-picker-brand-icon"><ModelLogo icon={group.icon} size={22} /></span>
                                <span className="canvas-model-picker-brand-copy"><strong>{group.label}</strong><small>{group.models.length} 个{group.kind === "product" ? "渠道" : "模型"}{group.scope ? ` · ${group.scope}` : ""}</small></span>
                                <ChevronDown className="canvas-model-picker-brand-arrow" aria-hidden="true" />
                            </button>;
                        })}
                    </div>
                ) : <div className="canvas-model-picker-two-pane">
                    <div className="canvas-model-picker-brand-rail" aria-label="产品模型">
                        {optionGroups.map((group) => {
                            const groupCurrent = group.models.find((item) => item.models.includes(current));
                            const firstModel = groupCurrent?.models[0] || group.models[0]?.models[0] || "";
                            return <button key={group.key} type="button" className={cn("canvas-model-picker-brand", activeGroupKey === group.key && "is-active")} aria-pressed={activeGroupKey === group.key} onClick={() => { setActiveGroupKey(group.key); setPreviewedModel(firstModel); }}>
                                <span className="canvas-model-picker-brand-icon"><ModelLogo icon={group.icon} size={22} /></span>
                                <span className="canvas-model-picker-brand-copy"><strong>{group.label}</strong><small>{group.models.length} 个{group.kind === "product" ? "渠道" : "模型"}{group.scope ? ` · ${group.scope}` : ""}</small></span>
                                <ChevronDown className="canvas-model-picker-brand-arrow" aria-hidden="true" />
                            </button>;
                        })}
                    </div>
                    {optionGroups.filter((group) => group.key === activeGroupKey).map((group) => <section key={group.key} className="canvas-model-picker-group canvas-model-picker-model-pane min-w-0 overflow-hidden">
                        <div className="canvas-model-picker-secondary-head">
                            <button type="button" className="canvas-model-picker-back" onClick={() => { setActiveGroupKey(null); focusMenuOption(); }} aria-label="返回模型列表"><ChevronLeft /></button>
                            <span><strong>{group.label}</strong>{group.scope ? <small>{group.scope}</small> : null}</span>
                        </div>
                        <div className="grid min-w-0 gap-1">
                            {group.models.map((modelGroup) => {
                                const selected = modelGroup.models.includes(current);
                                const model = compatibleModelInGroup(config, modelGroup.models, selectionRequirements, selected ? current : undefined);
                                const displayModel = model || (selected ? current : modelGroup.models[0]);
                                const disabledReason = model ? "" : modelCompatibilityError(config, modelGroup.models[0], selectionRequirements) || "当前输入不符合该模型能力";
                                return (
                                    <button
                                        key={modelGroup.key}
                                        type="button"
                                        data-model-picker-item
                                        role="option"
                                        aria-selected={selected}
                                        aria-disabled={Boolean(disabledReason)}
                                        disabled={Boolean(disabledReason)}
                                        title={disabledReason || pickerModelOptionLabel(config, displayModel, showConfiguredModelName)}
                                        className={cn("canvas-model-picker-option disabled:cursor-not-allowed disabled:opacity-45", previewedModel === displayModel && "is-previewed")}
                                        style={{ background: selected ? theme.toolbar.activeBg : "transparent", color: theme.node.text }}
                                        onMouseEnter={() => setPreviewedModel(displayModel)}
                                        onFocus={() => setPreviewedModel(displayModel)}
                                        onClick={() => {
                                            if (!model) return;
                                            onChange(model);
                                            setOpen(false);
                                            window.requestAnimationFrame(() => triggerRef.current?.focus());
                                        }}
                                    >
                                        <ModelLabel
                                            config={config}
                                            model={displayModel}
                                            capability={capability}
                                            theme={theme}
                                            creationVariant
                                            showConfiguredModelName={showConfiguredModelName}
                                            label={group.kind === "product" ? modelGroup.label : undefined}
                                            requirements={requirements}
                                            showPrice={showOptionPrices && creditsEnabled}
                                            disabledReason={disabledReason}
                                            showDescription={selected || previewedModel === displayModel}
                                        />
                                        {selected ? <Check className="canvas-model-picker-option-check ml-1 shrink-0" style={{ color: theme.node.activeStroke }} /> : null}
                                    </button>
                                );
                            })}
                        </div>
                    </section>)}
                </div>
            ) : (
                <div className="canvas-model-picker-empty" style={{ color: theme.node.muted }}>
                    {emptyModelLabel(config, capability)}
                </div>
            )}
        </div>
    );

    return (
        <div className={cn(fullWidth ? "w-full min-w-0" : "w-fit max-w-full")} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <Popover
                open={open}
                onOpenChange={setPickerOpen}
                trigger="click"
                placement="bottomLeft"
                arrow={false}
                content={content}
                classNames={{
                    root: cn("canvas-model-picker-popover", "creation-model-picker-popover", popoverClassName),
                    container: cn("canvas-composer-popover-surface", "creation-model-picker-surface"),
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
                    title={current ? pickerModelOptionLabel(config, current, showConfiguredModelName) : placeholder}
                    onKeyDown={handleTriggerKeyDown}
                >
                    <span className="canvas-model-picker-label flex min-w-0 items-center gap-1.5">
                        <span className="canvas-model-picker-trigger-icon" style={{ background: theme.toolbar.itemHover }}>
                            <ModelIcon config={config} model={current} />
                        </span>
                        <span className="min-w-0 flex-1 truncate">{current ? (creationVariant ? pickerModelDisplayName(config, current, showConfiguredModelName) : pickerModelOptionLabel(config, current, showConfiguredModelName)) : placeholder}</span>
                        {showSelectedPrice && creditsEnabled ? <ModelPrice price={currentPrice} quote={routeQuote} compact /> : null}
                    </span>
                    <ChevronDown className={cn("canvas-model-picker-chevron", open && "is-open")} aria-hidden="true" />
                </button>
            </Popover>
        </div>
    );
}

function emptyModelLabel(config: AiConfig, capability?: ModelCapability) {
    const label = capability === "image" ? "生图" : capability === "video" ? "视频" : capability === "text" ? "文本" : capability === "audio" ? "音频" : "";
    if (capability && config.models.length) return `暂无支持当前输入的${label}模型`;
    return config.models.length ? `暂无匹配的${label}模型` : "当前没有可用模型，请联系管理员或检查模型配置";
}

function ModelLabel({
    config,
    model,
    capability,
    theme,
    creationVariant,
    showConfiguredModelName,
    label,
    requirements,
    showPrice,
    disabledReason,
    showDescription,
}: {
    config: AiConfig;
    model: string;
    capability?: ModelCapability;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    creationVariant: boolean;
    showConfiguredModelName: boolean;
    label?: string;
    requirements?: ModelRequirements;
    showPrice: boolean;
    disabledReason?: string;
    showDescription: boolean;
}) {
    const meta = modelMenuMeta(model, capability);
    const channel = resolveModelChannel(config, model);
    const logicalCost = channel.modelCosts?.find((item) => item.model === modelOptionName(model));
    const logicalSpec = logicalCost?.logicalCapabilitySpec;
    const videoProfile = capability === "video" ? modelCapabilityConfigFor(config, model).video : undefined;
    const capabilitySummary =
        disabledReason ||
        logicalCost?.description?.trim() ||
        (isDirectSystemModel(config, model) ? "" : logicalSpec ? logicalCapabilitySummary(logicalSpec) : videoProfile ? `${formatDurationSummary(videoProfile)} · ${videoProfile.resolutions.map((item) => item.toUpperCase()).join("/")}` : meta.description);
    return (
        <span className="flex w-full min-w-0 items-center gap-1.5 overflow-hidden py-0">
            <span className="grid size-6 shrink-0 place-items-center rounded-md" style={{ background: theme.toolbar.itemHover }}>
                <ModelIcon config={config} model={model} />
            </span>
            <span className="min-w-44 flex-1 overflow-hidden">
                <span className="block min-w-0 truncate text-[var(--fs-label)] font-medium leading-none">{label || pickerModelDisplayName(config, model, showConfiguredModelName)}</span>
                <span className={cn("canvas-model-picker-description mt-1 block truncate text-[var(--fs-tiny)]", showDescription && "is-visible")} style={{ color: theme.node.muted }} title={capabilitySummary}>
                    {capabilitySummary}
                </span>
            </span>
            {showPrice ? (
                <span className="ml-auto shrink-0 pl-2">
                    <ModelPrice price={modelMenuPrice(config, model, capability, !requirements, requirements)} />
                </span>
            ) : null}
            {!creationVariant && meta.time ? (
                <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[var(--fs-tiny)] tabular-nums" style={{ background: theme.toolbar.itemHover, color: theme.node.muted }}>
                    {meta.time}
                </span>
            ) : null}
        </span>
    );
}

function logicalCapabilitySummary(spec: NonNullable<NonNullable<AiConfig["channels"][number]["modelCosts"]>[number]["logicalCapabilitySpec"]>) {
    const operationLabels: Record<string, string> = {
        text_to_video: "文生视频",
        image_to_video: "图生视频",
        reference_to_video: "全模态参考",
        audio_to_video: "音频生视频",
        extend: "视频续写",
        inpaint: "局部修改",
        replace_element: "元素替换",
        camera_motion: "运镜调整",
        style_transfer: "风格迁移",
    };
    const inputLabels: Record<string, { label: string; unit: string }> = {
        image: { label: spec.capability === "text" ? "图片理解" : "参考图片", unit: "张" },
        video: { label: spec.capability === "text" ? "视频理解" : "参考视频", unit: "个" },
        audio: { label: "参考音频", unit: "个" },
        mask: { label: "蒙版", unit: "张" },
    };
    const optionLabels: Record<string, string> = {
        size: "画面比例",
        aspectRatio: "画面比例",
        quality: "生成质量",
        count: "输出数量",
        videoSeconds: "视频时长",
        duration: "视频时长",
        vquality: "输出分辨率",
        resolution: "输出分辨率",
        audioVoice: "音色",
        audioFormat: "音频格式",
        audioSpeed: "语速",
    };
    const values: string[] = [];
    values.push(...(spec.operations || []).map((operation) => operationLabels[operation] || operation));
    for (const [name, constraint] of Object.entries(spec.inputs || {})) {
        if (constraint.max <= 0) continue;
        const definition = inputLabels[name];
        if (!definition) continue;
        values.push(spec.capability === "text" ? `支持${definition.label}` : `${definition.label}最多 ${constraint.max}${definition.unit}`);
    }
    for (const [name, constraint] of Object.entries(spec.options || {})) {
        const label = optionLabels[name];
        if (!label) continue;
        if (constraint.values?.length) values.push(`${label} ${constraint.values.map(publicScalarLabel).join("/")}`);
        else if (constraint.min !== undefined && constraint.max !== undefined) values.push(`${label} ${constraint.min}-${constraint.max}`);
    }
    return values.slice(0, 2).join(" · ") || "智能匹配当前输入";
}

function publicScalarLabel(value: unknown) {
    if (value === true) return "支持";
    if (value === false) return "关闭";
    return String(value);
}

function formatDurationSummary(profile: NonNullable<ReturnType<typeof modelCapabilityConfigFor>["video"]>) {
    const values = videoDurationOptions(profile);
    if (profile.duration.selection === "enum") return values.map((item) => `${item}s`).join("/");
    return `${profile.duration.min || values[0]}-${profile.duration.max || values[values.length - 1]}s`;
}

type ModelMenuPrice = { kind: "tiers"; label: string; compactLabel: string; title: string } | { kind: "estimate"; label?: string; title?: string } | { kind: "fixed"; value: number; unit: "次" | "秒" };

function modelMenuPrice(config: AiConfig, model: string, capability?: ModelCapability, summary = false, requirements?: ModelRequirements): ModelMenuPrice | null | undefined {
    if (!model) return undefined;
    const channel = resolveModelChannel(config, model);
    const cost = channel.modelCosts?.find((item) => item.model === modelOptionName(model));
    if (!cost) return channel.scope === "system" ? null : undefined;
    if (cost.pricePolicy === "channel") {
        const tiers = cost.logicalPriceTiers || [];
        if (!tiers.length) return null;
        const matched = summary ? tiers : priceTiersForCurrentSelection(tiers, capability, config, requirements);
        if (!summary && !matched.length) return { kind: "tiers", label: "当前规格无报价", compactLabel: "当前规格无报价", title: "请调整参数，或选择支持当前规格的渠道" };
        return channelTierPriceSummary(matched.length ? matched : tiers, tiers, capability);
    }
    if (cost.billingMode === "token") {
        const rate = cost.outputTokenPriceMicrocredits;
        return capability === "video" && typeof rate === "number" && Number.isFinite(rate) && rate >= 0
            ? { kind: "estimate", label: formatPriceRange([rate / 1_000_000], "积分/百万视频 Token"), title: "按视频 Token 单价预估，优先按有效上游用量结算；未返回用量时按视频公式结算" }
            : { kind: "estimate" };
    }
    return { kind: "fixed", value: cost.unitPriceMicrocredits / 1_000_000, unit: cost.billingMode === "per_second" ? "秒" : "次" };
}

function pickerModelDisplayName(config: AiConfig, model: string, showConfiguredModelName: boolean) {
    const name = showConfiguredModelName ? configuredModelDisplayName(config, model) : modelDisplayName(config, model);
    return isDirectSystemModel(config, model) ? `${name} · ${modelChannelLabel(config, model)}` : name;
}

function pickerModelOptionLabel(config: AiConfig, model: string, showConfiguredModelName: boolean) {
    const displayName = showConfiguredModelName ? configuredModelDisplayName(config, model) : modelDisplayName(config, model);
    const channel = resolveModelChannel(config, model);
    return channel.scope === "system" ? pickerModelDisplayName(config, model, showConfiguredModelName) : `${displayName}（${channel.name}）`;
}

function channelTierPriceSummary(
    visibleTiers: NonNullable<NonNullable<AiConfig["channels"][number]["modelCosts"]>[number]["logicalPriceTiers"]>,
    allTiers: NonNullable<NonNullable<AiConfig["channels"][number]["modelCosts"]>[number]["logicalPriceTiers"]>,
    capability?: ModelCapability,
): Extract<ModelMenuPrice, { kind: "tiers" }> {
    const label = priceTierSummaryLabel(visibleTiers, capability);
    return {
        kind: "tiers",
        label,
        compactLabel: label,
        title: `系统规格价格：${allTiers.map((tier) => `${tierSpecificationLabel(tier)} ${priceTierSummaryLabel([tier], capability)}`).join("；")}${allTiers.some((tier) => tier.billingMode === "token") ? (capability === "video" ? "；优先按有效上游用量结算，未返回用量时按视频公式结算" : "；Token 费用为预估，最终按成功任务的实际用量结算") : ""}`,
    };
}

function tierResolutionLabel(value: string) {
    const normalized = normalizeTierResolution(value);
    return normalized === "*" ? "全部分辨率" : normalized.toUpperCase();
}

function tierDurationLabel(seconds: number) {
    return seconds > 0 ? `${seconds} 秒` : "全部时长";
}

function tierSpecificationLabel(tier: NonNullable<NonNullable<AiConfig["channels"][number]["modelCosts"]>[number]["logicalPriceTiers"]>[number]) {
    const selector = tier.selector || {};
    const operationLabels: Record<string, string> = { text_to_image: "文生图", image_to_image: "图生图", text_to_video: "文生视频", image_to_video: "图生视频", video_to_video: "视频生视频" };
    const operation = selector.operation && selector.operation !== "*" ? operationLabels[selector.operation] || selector.operation : "";
    const details = [
        operation,
        selector.quality && selector.quality !== "*" ? selector.quality.toUpperCase() : "",
        selector.size && selector.size !== "*" ? selector.size : "",
        tier.resolution !== "*" ? tierResolutionLabel(tier.resolution) : "",
        tier.videoSeconds ? tierDurationLabel(tier.videoSeconds) : "",
        selector.imageCount && selector.imageCount !== "*" ? `${selector.imageCount} 张参考图` : "",
        selector.videoGenerateAudio === "true" ? "有声" : selector.videoGenerateAudio === "false" ? "无声" : "",
    ].filter(Boolean);
    return details.length ? details.join(" / ") : "默认规格";
}

function ModelPrice({ price, quote, compact = false }: { price: ModelMenuPrice | null | undefined; quote?: LogicalModelQuote; compact?: boolean }) {
    if (quote) {
        const amount = (quote.amountMicrocredits / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits: 6 });
        const label = quote.estimated ? `预估:${amount}` : `${amount}`;
        return (
            <span className="inline-flex shrink-0 items-center gap-0.5 text-[var(--fs-tiny)] font-bold tabular-nums text-amber-600 dark:text-amber-300" title={modelQuoteDescription(quote)}>
                <Coins className="size-3" />
                {compact ? label : `${label} 积分`}
            </span>
        );
    }
    if (price === undefined) return null;
    if (price === null) return compact ? null : <span className="shrink-0 text-[var(--fs-tiny)] text-foreground/40">未配置</span>;
    if (price.kind === "tiers") {
        return (
            <span className="inline-flex shrink-0 items-center gap-0.5 text-[var(--fs-tiny)] font-bold tabular-nums text-amber-600 dark:text-amber-300" title={price.title}>
                <Coins className="size-3" />
                {compact ? price.compactLabel : price.label}
            </span>
        );
    }
    if (price.kind === "estimate") {
        return <span className="shrink-0 text-[var(--fs-tiny)] font-medium text-amber-600 dark:text-amber-300" title={price.title}>{price.label || "按量预估"}</span>;
    }
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
    return { description: capability === "text" ? "文本生成模型" : "当前模型", time: "10s" };
}

export function ModelIcon({ config, model, icon }: { config?: AiConfig; model?: string; icon?: string }) {
    return <ModelLogo icon={icon || (config && model ? modelIcon(config, model) : "")} size={14} />;
}
