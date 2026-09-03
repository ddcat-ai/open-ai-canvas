import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Check, ChevronDown, Coins } from "lucide-react";
import { Popover } from "antd";

import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { modelCapabilityConfigFor, videoDurationOptions } from "@/lib/model-capabilities";
import { formatPriceRange, modelQuoteRequest, normalizeTierResolution, priceTierSummaryLabel, priceTiersForCurrentSelection } from "@/lib/model-pricing";
import { compatibleModelInGroup, configuredModelDisplayName, groupModelsByDisplayName, modelCompatibilityError, resolveCompatibleModel, type ModelRequirements } from "@/lib/model-selection";
import { cn } from "@/lib/utils";
import { modelDisplayName, modelIcon, modelOptionName, PUBLIC_MODEL_CATALOG_ID, resolveModelChannel, selectableModelsByCapability, type AiConfig, type ModelCapability } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { ModelLogo } from "@/components/model-logo";
import { quoteLogicalModel, type LogicalModelQuote } from "@/services/api/logical-models";

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
    variant = "default",
    requirements,
    showConfiguredModelName = false,
}: ModelPickerProps) {
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const pickerId = useId();
    // 双保险：即使 store merge 写出非法 theme，这里也兜底到 dark，避免 "reading 'node'" 崩溃
    const rawTheme = useThemeStore((state) => state.theme);
    const theme = (canvasThemes[rawTheme as keyof typeof canvasThemes] ?? canvasThemes.dark) as CanvasTheme;
    const [open, setOpen] = useState(false);
    const [triggerWidth, setTriggerWidth] = useState<number | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const options = useMemo(() => Array.from(new Set(selectableModelsByCapability(config, capability).filter(Boolean))), [capability, config]);
    const optionGroups = useMemo(() => {
        const channelGroups = config.channels
            .map((channel) => ({
                key: channel.id,
                label: channel.name || "未命名渠道",
                scope: channel.id === PUBLIC_MODEL_CATALOG_ID ? "" : channel.scope === "system" ? "平台服务" : "我的模型",
                models: groupModelsByDisplayName(
                    config,
                    options.filter((model) => resolveModelChannel(config, model).id === channel.id),
                ),
            }))
            .filter((group) => group.models.length);
        // options 已由当前有效渠道重建；任何无法解析渠道的旧值都直接丢弃，
        // 不再显示“其他模型 / 未指定渠道”这种不可用入口。
        return channelGroups;
    }, [config, options]);
    const storedCurrent = value?.trim() || "";
    // 参数档位会在选中模型后由调用方归一到其能力配置，不能因为旧模型留下的参数而禁止切换。
    const selectionRequirements = requirements ? { ...requirements, videoSeconds: undefined, imageSize: undefined, options: undefined } : undefined;
    const resolvedCurrent = resolveCompatibleModel(config, storedCurrent, selectionRequirements) || storedCurrent;
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
        quoteLogicalModel(quoteRequest.logicalModelID, quoteRequest.intent, controller.signal)
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
            className={cn("canvas-model-picker-menu max-w-[calc(100vw-24px)]", creationVariant ? "creation-model-picker-menu w-[360px]" : "w-[var(--panel-width-compact)]")}
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
            {creationVariant ? (
                <div className="creation-model-picker-heading">
                    <span>选择模型</span>
                    {current ? <strong>{pickerModelDisplayName(config, current, showConfiguredModelName)}</strong> : null}
                </div>
            ) : null}
            {optionGroups.length ? (
                optionGroups.map((group) => (
                    <section key={group.key} className="canvas-model-picker-group min-w-0 overflow-hidden">
                        <div className="canvas-model-picker-group-label" style={{ color: theme.node.muted }}>
                            <span className="truncate">{group.label}</span>
                            {group.scope ? (
                                <span className="shrink-0" style={{ color: theme.node.muted }}>
                                    {group.scope}
                                </span>
                            ) : null}
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
                                        role="option"
                                        aria-selected={selected}
                                        aria-disabled={Boolean(disabledReason)}
                                        disabled={Boolean(disabledReason)}
                                        title={disabledReason || pickerModelOptionLabel(config, displayModel, showConfiguredModelName)}
                                        className="canvas-model-picker-option disabled:cursor-not-allowed disabled:opacity-45"
                                        style={{ background: selected ? theme.toolbar.activeBg : "transparent", color: theme.node.text }}
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
                                            creationVariant={creationVariant}
                                            showConfiguredModelName={showConfiguredModelName}
                                            showPrice={showOptionPrices && creditsEnabled}
                                            disabledReason={disabledReason}
                                        />
                                        {selected ? <Check className="canvas-model-picker-option-check" style={{ color: theme.node.activeStroke }} /> : null}
                                    </button>
                                );
                            })}
                        </div>
                    </section>
                ))
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
                    root: cn("canvas-model-picker-popover", creationVariant && "creation-model-picker-popover", popoverClassName),
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
                    title={current ? pickerModelOptionLabel(config, current, showConfiguredModelName) : placeholder}
                    onKeyDown={handleTriggerKeyDown}
                >
                    <span className="canvas-model-picker-label flex min-w-0 items-center gap-1.5">
                        <span className="canvas-model-picker-trigger-icon" style={{ background: theme.toolbar.itemHover }}>
                            <ModelIcon config={config} model={current} />
                        </span>
                        <span className="min-w-0 flex-1 truncate">{current ? (creationVariant ? pickerModelDisplayName(config, current, showConfiguredModelName) : pickerModelOptionLabel(config, current, showConfiguredModelName)) : placeholder}</span>
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
    showPrice,
    disabledReason,
}: {
    config: AiConfig;
    model: string;
    capability?: ModelCapability;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    creationVariant: boolean;
    showConfiguredModelName: boolean;
    showPrice: boolean;
    disabledReason?: string;
}) {
    const meta = modelMenuMeta(model, capability);
    const channel = resolveModelChannel(config, model);
    const logicalCost = channel.modelCosts?.find((item) => item.model === modelOptionName(model));
    const logicalSpec = logicalCost?.logicalCapabilitySpec;
    const videoProfile = capability === "video" ? modelCapabilityConfigFor(config, model).video : undefined;
    const capabilitySummary =
        disabledReason ||
        logicalCost?.description?.trim() ||
        (logicalSpec ? logicalCapabilitySummary(logicalSpec, logicalCost?.logicalCapabilityProfiles) : videoProfile ? videoCapabilitySummary(videoProfile) : meta.description);

    // 文本模型：在灰色描述位置显示价格
    const textPrice = (() => {
        if (capability !== "text" || !logicalCost || logicalCost.billingMode !== "token") return null;
        const input = logicalCost.inputTokenPriceMicrocredits || 0;
        const output = logicalCost.outputTokenPriceMicrocredits || 0;
        if (input <= 0 && output <= 0) return null;
        const format = (value: number) => "¥" + formatDecimalPrice(value);
        const parts = [];
        if (input > 0) parts.push(`入${format(input)}`);
        if (output > 0) parts.push(`出${format(output)}`);
        return parts.join(" ");
    })();
    const subtitle = textPrice || capabilitySummary;
    return (
        <span className="flex w-full min-w-0 items-center gap-1.5 overflow-hidden py-0">
            <span className="grid size-6 shrink-0 place-items-center rounded-md" style={{ background: theme.toolbar.itemHover }}>
                <ModelIcon config={config} model={model} />
            </span>
            <span className="min-w-0 flex-1 overflow-hidden">
                <span className="block min-w-0 truncate text-[var(--fs-label)] font-medium leading-none">{pickerModelDisplayName(config, model, showConfiguredModelName)}</span>
                <span className="mt-1 block truncate text-[var(--fs-tiny)]" style={{ color: textPrice ? "var(--color-amber-500)" : theme.node.muted }} title={subtitle}>
                    {subtitle}
                </span>
            </span>
            {showPrice && !textPrice ? <ModelPrice price={modelMenuPrice(config, model, capability, true)} /> : null}
            {!creationVariant && meta.time ? (
                <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[var(--fs-tiny)] tabular-nums" style={{ background: theme.toolbar.itemHover, color: theme.node.muted }}>
                    {meta.time}
                </span>
            ) : null}
        </span>
    );
}

function logicalCapabilitySummary(spec: NonNullable<NonNullable<AiConfig["channels"][number]["modelCosts"]>[number]["logicalCapabilitySpec"]>, profiles?: NonNullable<NonNullable<AiConfig["channels"][number]["modelCosts"]>[number]["logicalCapabilityProfiles"]>) {
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
    // 视频模型不显示操作模式（文生/图生/全模态），做视频的都懂；其他能力仍显示
    if (spec.capability !== "video") {
        values.push(...(spec.operations || []).map((operation) => operationLabels[operation] || operation));
    }
    for (const [name, constraint] of Object.entries(spec.inputs || {})) {
        const definition = inputLabels[name];
        if (!definition) continue;
        // 用渠道规格里最宽松的值（避免所有渠道交集导致显示偏小）
        let maxValue = constraint.max || 0;
        if (profiles?.length) {
            for (const profile of profiles) {
                const profileMax = profile.inputs?.[name]?.max;
                if (profileMax !== undefined && profileMax > maxValue) {
                    maxValue = profileMax;
                }
            }
        }
        if (maxValue <= 0) continue;
        values.push(spec.capability === "text" ? `支持${definition.label}` : `${definition.label}最多 ${maxValue}${definition.unit}`);
    }
    for (const [name, constraint] of Object.entries(spec.options || {})) {
        const label = optionLabels[name];
        if (!label) continue;
        // 视频时长不再列出所有秒数，改为显示最长时长
        if (name === "videoSeconds" || name === "duration") {
            if (constraint.values?.length) {
                const maxSeconds = Math.max(...constraint.values.map(Number).filter(Number.isFinite));
                values.push(`最长 ${maxSeconds} 秒`);
            } else if (constraint.max !== undefined) {
                values.push(`最长 ${constraint.max} 秒`);
            }
            continue;
        }
        if (constraint.values?.length) values.push(`${label} ${constraint.values.map(publicScalarLabel).join("/")}`);
        else if (constraint.min !== undefined && constraint.max !== undefined) values.push(`${label} ${constraint.min}-${constraint.max}`);
    }
    // 视频模型显示更多参数（操作模式 + 参考素材 + 时长 + 分辨率），不限制只取前2个
    const maxItems = spec.capability === "video" ? 6 : 2;
    return values.slice(0, maxItems).join(" · ") || "智能匹配当前输入";
}

// 渠道模型（无 logicalSpec）的视频能力说明，用 videoProfile 生成简洁格式
function videoCapabilitySummary(profile: NonNullable<ReturnType<typeof modelCapabilityConfigFor>["video"]>) {
    const values: string[] = [];
    // 参考素材
    const ref = profile.references || {};
    if (ref.maxImages > 0) values.push(`参考图最多 ${ref.maxImages} 张`);
    if (ref.maxVideos > 0) values.push(`参考视频最多 ${ref.maxVideos} 个`);
    if (ref.maxAudios > 0) values.push(`参考音频最多 ${ref.maxAudios} 个`);
    // 最长时长
    const dur = profile.duration || {};
    if (dur.max !== undefined) {
        values.push(`最长 ${dur.max} 秒`);
    } else if (dur.values?.length) {
        values.push(`最长 ${Math.max(...dur.values)} 秒`);
    }
    // 分辨率
    if (profile.resolutions?.length) {
        values.push(`分辨率 ${profile.resolutions.map((r) => r.toUpperCase()).join("/")}`);
    }
    return values.slice(0, 6).join(" · ") || "智能匹配当前输入";
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

type ModelMenuPrice = { kind: "tiers"; label: string; compactLabel: string; title: string } | { kind: "estimate" } | { kind: "fixed"; value: number; unit: "次" | "秒" | "百万 Token" };

function modelMenuPrice(config: AiConfig, model: string, capability?: ModelCapability, summary = false, requirements?: ModelRequirements): ModelMenuPrice | null | undefined {
    if (!model) return undefined;
    const channel = resolveModelChannel(config, model);
    const cost = channel.modelCosts?.find((item) => item.model === modelOptionName(model));
    if (!cost) return channel.scope === "system" ? null : undefined;
    if (cost.pricePolicy === "channel") {
        const tiers = cost.logicalPriceTiers || [];
        if (!tiers.length) return null;
        const matched = summary ? tiers : priceTiersForCurrentSelection(tiers, capability, config, requirements);
        return channelTierPriceSummary(matched.length ? matched : tiers, tiers);
    }
    if (cost.billingMode === "token") {
        const input = cost.inputTokenPriceMicrocredits || 0;
        const output = cost.outputTokenPriceMicrocredits || 0;
        if (input > 0 || output > 0) {
            const format = (value: number) => "¥" + formatDecimalPrice(value);
            const parts = [];
            if (input > 0) parts.push(`入${format(input)}`);
            if (output > 0) parts.push(`出${format(output)}`);
            const label = parts.join(" ");
            return { kind: "tiers", label, compactLabel: label, title: `输入 ${format(input)}/1M tokens，输出 ${format(output)}/1M tokens` };
        }
        return { kind: "estimate" };
    }
    return { kind: "fixed", value: cost.unitPriceMicrocredits / 1_000_000, unit: cost.billingMode === "per_second" ? "秒" : "次" };
}

function pickerModelDisplayName(config: AiConfig, model: string, showConfiguredModelName: boolean) {
    return showConfiguredModelName ? configuredModelDisplayName(config, model) : modelDisplayName(config, model);
}

function pickerModelOptionLabel(config: AiConfig, model: string, showConfiguredModelName: boolean) {
    const displayName = showConfiguredModelName ? configuredModelDisplayName(config, model) : modelDisplayName(config, model);
    const channel = resolveModelChannel(config, model);
    return channel.scope === "system" ? displayName : `${displayName}（${channel.name}）`;
}

function channelTierPriceSummary(
    visibleTiers: NonNullable<NonNullable<AiConfig["channels"][number]["modelCosts"]>[number]["logicalPriceTiers"]>,
    allTiers: NonNullable<NonNullable<AiConfig["channels"][number]["modelCosts"]>[number]["logicalPriceTiers"]>,
): Extract<ModelMenuPrice, { kind: "tiers" }> {
    const label = priceTierSummaryLabel(visibleTiers);
    return {
        kind: "tiers",
        label,
        compactLabel: label,
        title: `系统规格价格：${allTiers.map((tier) => `${tierSpecificationLabel(tier)} ${tierPriceLabel(tier)}`).join("；")}`,
    };
}

function formatTokenPriceRange(tiers: NonNullable<NonNullable<AiConfig["channels"][number]["modelCosts"]>[number]["logicalPriceTiers"]>) {
    // 价格单位：微积分/token，1 微积分 = ¥1/1M tokens，价格支持小数
    const inputValues = tiers
        .map((tier) => (tier as any).inputTokenPriceMicrocredits || 0)
        .filter((value) => value > 0);
    const outputValues = tiers
        .map((tier) => (tier as any).outputTokenPriceMicrocredits || 0)
        .filter((value) => value > 0);
    const format = (value: number) => "¥" + formatDecimalPrice(value);
    const inputStr = inputValues.length ? `入${format(inputValues[0])}` : "";
    const outputStr = outputValues.length ? `出${format(outputValues[0])}` : "";
    return [inputStr, outputStr].filter(Boolean).join(" ") || "按量预估";
}

// 格式化小数价格，保留所有有效小数位，去掉末尾多余的零
function formatDecimalPrice(value: number): string {
    if (value === 0) return "0";
    // 先转字符串，处理浮点数精度问题
    const str = value.toPrecision(10);
    // 去掉末尾的零和小数点
    return str.replace(/\.?0+$/, "");
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
    ].filter(Boolean);
    return details.length ? details.join(" / ") : "默认规格";
}

function tierPriceLabel(tier: NonNullable<NonNullable<AiConfig["channels"][number]["modelCosts"]>[number]["logicalPriceTiers"]>[number]) {
    if (tier.billingMode === "token") {
        const input = (tier as any).inputTokenPriceMicrocredits || 0;
        const output = (tier as any).outputTokenPriceMicrocredits || 0;
        const format = (value: number) => "¥" + formatDecimalPrice(value);
        const parts = [];
        if (input > 0) parts.push(`输入${format(input)}/1M`);
        if (output > 0) parts.push(`输出${format(output)}/1M`);
        return parts.length ? parts.join(" ") : "按量预估";
    }
    return `${formatPriceRange([tier.unitPriceMicrocredits / 1_000_000], tier.billingMode === "per_second" ? "/秒" : "")}`;
}

function ModelPrice({ price, quote, compact = false }: { price: ModelMenuPrice | null | undefined; quote?: LogicalModelQuote; compact?: boolean }) {
    if (quote) {
        const amount = "¥" + (quote.amountMicrocredits / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits: 3 });
        const label = quote.estimated ? `预计 ${amount}` : `${amount}`;
        return (
            <span className="inline-flex shrink-0 items-center gap-0.5 text-[var(--fs-tiny)] font-bold tabular-nums text-amber-600 dark:text-amber-300" title={`${quote.estimated ? "预计" : "本次"}消耗 ${amount}`}>
                <Coins className="size-3" />
                {label}
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
        return <span className="shrink-0 text-[var(--fs-tiny)] font-medium text-amber-600 dark:text-amber-300">按量预估</span>;
    }
    return (
        <span className="inline-flex shrink-0 items-center gap-0.5 text-[var(--fs-tiny)] font-bold tabular-nums text-amber-600 dark:text-amber-300" title={`每${price.unit}消耗 ¥${price.value.toLocaleString("zh-CN", { maximumFractionDigits: 6 })}`}>
            <Coins className="size-3" />
            ¥{price.value.toLocaleString("zh-CN", { maximumFractionDigits: compact ? 3 : 6 })}/{price.unit}
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
    return <ModelLogo icon={icon || (config && model ? modelIcon(config, model) : "")} size={14} className="opacity-80" />;
}
