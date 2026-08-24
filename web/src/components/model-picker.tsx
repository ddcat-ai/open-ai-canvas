import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, Coins } from "lucide-react";
import { Popover } from "antd";

import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { modelCapabilityConfigFor, videoDurationOptions } from "@/lib/model-capabilities";
import { compatibleModelInGroup, configuredModelDisplayName, groupModelsByDisplayName, modelCompatibilityError, modelRequestOptions, resolveCompatibleModel, type ModelRequirements } from "@/lib/model-selection";
import { normalizeVideoResolution } from "@/lib/video-generation-options";
import { cn } from "@/lib/utils";
import { modelDisplayName, modelIcon, modelOptionName, PUBLIC_MODEL_CATALOG_ID, resolveModelChannel, selectableModelsByCapability, type AiConfig, type ModelCapability } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { ModelLogo } from "@/components/model-logo";
import { quoteLogicalModel, type LogicalModelQuote, type ModelRequestIntent } from "@/services/api/logical-models";
import { useTranslation } from "react-i18next";
import { t } from "@/i18n";
import { formatLocale } from "@/lib/format-locale";

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
    requirements?: ModelRequirements;
    showConfiguredModelName?: boolean;
};

export function ModelPicker({
    config,
    value,
    onChange,
    capability,
    className,
    fullWidth = false,
    placeholder = t("domain:select-model-2"),
    onMissingConfig,
    showSelectedPrice = true,
    variant = "default",
    requirements,
    showConfiguredModelName = false,
}: ModelPickerProps) {
    const { t } = useTranslation("canvas");
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const pickerId = useId();
    // 双保险：即使 store merge 写出非法 theme，这里也兜底到 dark，避免 "reading 'node'" 崩溃
    const rawTheme = useThemeStore((state) => state.theme);
    const theme = (canvasThemes[rawTheme as keyof typeof canvasThemes] ?? canvasThemes.dark) as CanvasTheme;
    const [open, setOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const options = useMemo(() => Array.from(new Set(selectableModelsByCapability(config, capability).filter(Boolean))), [capability, config]);
    const optionGroups = useMemo(() => {
        const channelGroups = config.channels
            .map((channel) => ({
                key: channel.id,
                label: channel.name || t("domain:untitled-channel"),
                scope: channel.id === PUBLIC_MODEL_CATALOG_ID ? "" : channel.scope === "system" ? t("domain:platform-services") : t("domain:my-models"),
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
            style={{ background: theme.node.panel, color: theme.node.text }}
            role="listbox"
            aria-label={placeholder}
            onKeyDown={handleMenuKeyDown}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            {creationVariant ? (
                <div className="creation-model-picker-heading">
                    <span>{t("domain:select-model-2")}</span>
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
                                const disabledReason = model ? "" : modelCompatibilityError(config, modelGroup.models[0], selectionRequirements) || t("domain:current-input-does-not-match-this-model-s-capabilities");
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
                                            showPrice={creditsEnabled}
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
    const { t } = useTranslation("canvas");
    const label = capability === "image" ? t("domain:image-gen") : capability === "video" ? t("domain:video") : capability === "text" ? t("domain:text") : capability === "audio" ? t("domain:audio") : "";
    if (capability && config.models.length) return t("domain:no-param-models-support-the-current-input", { label: label });
    return config.models.length ? t("domain:no-matching-param-models", { label: label }) : t("domain:no-models-available-contact-an-admin-or-check-model-configuration");
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
        (logicalSpec ? logicalCapabilitySummary(logicalSpec) : videoProfile ? `${formatDurationSummary(videoProfile)} · ${videoProfile.resolutions.map((item) => item.toUpperCase()).join("/")}` : meta.description);
    return (
        <span className="flex w-full min-w-0 items-center gap-1.5 overflow-hidden py-0">
            <span className="grid size-6 shrink-0 place-items-center rounded-md" style={{ background: theme.toolbar.itemHover }}>
                <ModelIcon config={config} model={model} />
            </span>
            <span className="min-w-0 flex-1 overflow-hidden">
                <span className="block min-w-0 truncate text-[var(--fs-label)] font-medium leading-none">{pickerModelDisplayName(config, model, showConfiguredModelName)}</span>
                <span className="mt-1 block truncate text-[var(--fs-tiny)]" style={{ color: theme.node.muted }} title={capabilitySummary}>
                    {capabilitySummary}
                </span>
            </span>
            {showPrice ? <ModelPrice price={modelMenuPrice(config, model, capability, true)} /> : null}
            {!creationVariant && meta.time ? (
                <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[var(--fs-tiny)] tabular-nums" style={{ background: theme.toolbar.itemHover, color: theme.node.muted }}>
                    {meta.time}
                </span>
            ) : null}
        </span>
    );
}

function logicalCapabilitySummary(spec: NonNullable<NonNullable<AiConfig["channels"][number]["modelCosts"]>[number]["logicalCapabilitySpec"]>) {
    const { t } = useTranslation("canvas");
    const operationLabels: Record<string, string> = {
        text_to_video: t("domain:text-to-video"),
        image_to_video: t("domain:image-to-video"),
        audio_to_video: t("domain:audio-to-video"),
        extend: t("domain:video-extend"),
        inpaint: t("domain:inpaint-edit-2"),
        replace_element: t("domain:element-replace"),
        camera_motion: t("domain:camera-adjust"),
        style_transfer: t("domain:style-transfer"),
    };
    const inputLabels: Record<string, { label: string; unit: string }> = {
        image: { label: spec.capability === "text" ? t("domain:image-understanding") : t("domain:reference-images"), unit: t("domain:item") },
        video: { label: spec.capability === "text" ? t("domain:video-understanding") : t("domain:reference-videos"), unit: t("domain:item-2") },
        audio: { label: t("domain:reference-audio"), unit: t("domain:item-2") },
        mask: { label: t("domain:mask"), unit: t("domain:item") },
    };
    const optionLabels: Record<string, string> = {
        size: t("domain:aspect-ratio"),
        aspectRatio: t("domain:aspect-ratio"),
        quality: t("domain:generation-quality"),
        count: t("domain:output-count-2"),
        videoSeconds: t("domain:video-duration"),
        duration: t("domain:video-duration"),
        vquality: t("domain:output-resolution"),
        resolution: t("domain:output-resolution"),
        audioVoice: t("domain:voice-2"),
        audioFormat: t("domain:audio-format"),
        audioSpeed: t("domain:speech-rate"),
    };
    const values: string[] = [];
    values.push(...(spec.operations || []).map((operation) => operationLabels[operation] || operation));
    for (const [name, constraint] of Object.entries(spec.inputs || {})) {
        if (constraint.max <= 0) continue;
        const definition = inputLabels[name];
        if (!definition) continue;
        values.push(spec.capability === "text" ? t("domain:supports-param", { label: definition.label }) : t("domain:param-up-to-param-param", { label: definition.label, max: constraint.max, unit: definition.unit }));
    }
    for (const [name, constraint] of Object.entries(spec.options || {})) {
        const label = optionLabels[name];
        if (!label) continue;
        if (constraint.values?.length) values.push(`${label} ${constraint.values.map(publicScalarLabel).join("/")}`);
        else if (constraint.min !== undefined && constraint.max !== undefined) values.push(`${label} ${constraint.min}-${constraint.max}`);
    }
    return values.slice(0, 2).join(" · ") || t("domain:smart-match-the-current-input");
}

function publicScalarLabel(value: unknown) {
    const { t } = useTranslation("canvas");
    if (value === true) return t("domain:supported");
    if (value === false) return t("domain:close");
    return String(value);
}

function formatDurationSummary(profile: NonNullable<ReturnType<typeof modelCapabilityConfigFor>["video"]>) {
    const values = videoDurationOptions(profile);
    if (profile.duration.selection === "enum") return values.map((item) => `${item}s`).join("/");
    return `${profile.duration.min || values[0]}-${profile.duration.max || values[values.length - 1]}s`;
}

type ModelMenuPrice = { kind: "tiers"; label: string; compactLabel: string; title: string } | { kind: "estimate" } | { kind: "fixed"; value: number; unit: string };

function modelMenuPrice(config: AiConfig, model: string, capability?: ModelCapability, summary = false, requirements?: ModelRequirements): ModelMenuPrice | null | undefined {
    const { t } = useTranslation("canvas");
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
    if (cost.billingMode === "token") return { kind: "estimate" };
    return { kind: "fixed", value: cost.unitPriceMicrocredits / 1_000_000, unit: cost.billingMode === "per_second" ? t("domain:s-2") : t("domain:requests") };
}

function pickerModelDisplayName(config: AiConfig, model: string, showConfiguredModelName: boolean) {
    return showConfiguredModelName ? configuredModelDisplayName(config, model) : modelDisplayName(config, model);
}

function pickerModelOptionLabel(config: AiConfig, model: string, showConfiguredModelName: boolean) {
    const displayName = showConfiguredModelName ? configuredModelDisplayName(config, model) : modelDisplayName(config, model);
    const channel = resolveModelChannel(config, model);
    return channel.scope === "system" ? displayName : `${displayName}（${channel.name}）`;
}

function priceTiersForCurrentSelection(tiers: NonNullable<NonNullable<AiConfig["channels"][number]["modelCosts"]>[number]["logicalPriceTiers"]>, capability: ModelCapability | undefined, config: AiConfig, requirements?: ModelRequirements) {
    const requested: Record<string, string> = {};
    if (capability === "video") {
        const imageCount = (requirements?.input?.imageCount || 0) + (requirements?.input?.characterCount || 0);
        if (imageCount > 0) requested.imageCount = String(imageCount);
        const resolution = normalizeTierResolution(config.vquality);
        if (resolution !== "*") requested.vquality = resolution;
        const seconds = Math.max(0, Math.floor(Number(config.videoSeconds) || 0));
        if (seconds > 0) requested.videoSeconds = String(seconds);
    }
    if (capability === "image") {
        if (config.quality && config.quality !== "auto") requested.quality = config.quality.toLowerCase();
        if (config.size && config.size !== "auto") requested.size = config.size.toLowerCase();
    }
    let bestScore = -1;
    let matched: typeof tiers = [];
    for (const tier of tiers) {
        const selector = tier.selector || {};
        const conditions = Object.entries(selector).filter(([, value]) => value && value !== "*");
        if (conditions.some(([key, value]) => requested[key] !== value)) continue;
        const score = conditions.length;
        if (score > bestScore) {
            bestScore = score;
            matched = [tier];
        } else if (score === bestScore) {
            matched.push(tier);
        }
    }
    return matched;
}

function normalizeTierResolution(value: string) {
    const raw = String(value || "").trim();
    if (!raw || raw === "*") return "*";
    return `${normalizeVideoResolution(raw)}p`;
}

function channelTierPriceSummary(
    visibleTiers: NonNullable<NonNullable<AiConfig["channels"][number]["modelCosts"]>[number]["logicalPriceTiers"]>,
    allTiers: NonNullable<NonNullable<AiConfig["channels"][number]["modelCosts"]>[number]["logicalPriceTiers"]>,
): Extract<ModelMenuPrice, { kind: "tiers" }> {
    const { t } = useTranslation("canvas");
    const fixedRequestValues = visibleTiers
        .filter((tier) => tier.billingMode === "fixed_request")
        .map((tier) => tier.unitPriceMicrocredits / 1_000_000)
        .filter((value) => value > 0);
    const perSecondValues = visibleTiers
        .filter((tier) => tier.billingMode === "per_second")
        .map((tier) => tier.unitPriceMicrocredits / 1_000_000)
        .filter((value) => value > 0);
    const hasTokenTier = visibleTiers.some((tier) => tier.billingMode === "token");
    const label = fixedRequestValues.length
        ? formatPriceRange(fixedRequestValues, t("domain:credits-3"))
        : perSecondValues.length
          ? formatPriceRange(perSecondValues, t("domain:credits-sec"))
          : hasTokenTier
            ? t("domain:usage-based-estimate-2")
            : t("domain:not-configured-2");
    return {
        kind: "tiers",
        label,
        compactLabel: label,
        title: `${t("admin:system-spec-pricing")}：${allTiers.map((tier) => `${tierSpecificationLabel(tier)} ${tierPriceLabel(tier)}`).join("；")}`,
    };
}

function formatPriceRange(values: number[], suffix: string) {
    const unique = Array.from(new Set(values)).sort((left, right) => left - right);
    const format = (value: number) => value.toLocaleString(formatLocale(), { maximumFractionDigits: 3 });
    return unique.length === 1 ? `${format(unique[0])} ${suffix}` : `${format(unique[0])}-${format(unique[unique.length - 1])} ${suffix}`;
}

function tierResolutionLabel(value: string) {
    const { t } = useTranslation("canvas");
    const normalized = normalizeTierResolution(value);
    return normalized === "*" ? t("domain:all-resolutions") : normalized.toUpperCase();
}

function tierDurationLabel(seconds: number) {
    const { t } = useTranslation("canvas");
    return seconds > 0 ? t("domain:params", { seconds: seconds }) : t("domain:all-durations");
}

function tierSpecificationLabel(tier: NonNullable<NonNullable<AiConfig["channels"][number]["modelCosts"]>[number]["logicalPriceTiers"]>[number]) {
    const { t } = useTranslation("canvas");
    const selector = tier.selector || {};
    const operationLabels: Record<string, string> = {
        text_to_image: t("domain:text-to-image"),
        image_to_image: t("domain:image-to-image"),
        text_to_video: t("domain:text-to-video"),
        image_to_video: t("domain:image-to-video"),
        video_to_video: t("domain:video-to-video"),
    };
    const operation = selector.operation && selector.operation !== "*" ? operationLabels[selector.operation] || selector.operation : "";
    const details = [
        operation,
        selector.quality && selector.quality !== "*" ? selector.quality.toUpperCase() : "",
        selector.size && selector.size !== "*" ? selector.size : "",
        tier.resolution !== "*" ? tierResolutionLabel(tier.resolution) : "",
        tier.videoSeconds ? tierDurationLabel(tier.videoSeconds) : "",
        selector.imageCount && selector.imageCount !== "*" ? t("domain:param-reference-images", { imageCount: selector.imageCount }) : "",
    ].filter(Boolean);
    return details.length ? details.join(" / ") : t("domain:default-spec");
}

function tierPriceLabel(tier: NonNullable<NonNullable<AiConfig["channels"][number]["modelCosts"]>[number]["logicalPriceTiers"]>[number]) {
    const { t } = useTranslation("canvas");
    if (tier.billingMode === "token") return t("domain:usage-based-estimate-2");
    return `${formatPriceRange([tier.unitPriceMicrocredits / 1_000_000], tier.billingMode === "per_second" ? t("domain:credits-sec") : t("domain:credits-3"))}`;
}

function ModelPrice({ price, quote, compact = false }: { price: ModelMenuPrice | null | undefined; quote?: LogicalModelQuote; compact?: boolean }) {
    const { t } = useTranslation("canvas");
    if (quote) {
        const amount = (quote.amountMicrocredits / 1_000_000).toLocaleString(formatLocale(), { maximumFractionDigits: 3 });
        const label = quote.estimated ? t("domain:est-param", { amount: amount }) : `${amount}`;
        return (
            <span className="inline-flex shrink-0 items-center gap-0.5 text-[var(--fs-tiny)] font-bold tabular-nums text-amber-600 dark:text-amber-300" title={t("domain:cost-title", { label: quote.estimated ? t("domain:est") : t("domain:this-run"), amount })}>
                <Coins className="size-3" />
                {compact ? label : t("domain:param-credits", { label: label })}
            </span>
        );
    }
    if (price === undefined) return null;
    if (price === null) return compact ? null : <span className="shrink-0 text-[var(--fs-tiny)] text-foreground/40">{t("domain:not-configured-2")}</span>;
    if (price.kind === "tiers") {
        return (
            <span className="inline-flex shrink-0 items-center gap-0.5 text-[var(--fs-tiny)] font-bold tabular-nums text-amber-600 dark:text-amber-300" title={price.title}>
                <Coins className="size-3" />
                {compact ? price.compactLabel : price.label}
            </span>
        );
    }
    if (price.kind === "estimate") {
        return <span className="shrink-0 text-[var(--fs-tiny)] font-medium text-amber-600 dark:text-amber-300">{t("domain:usage-based-estimate-2")}</span>;
    }
    return (
        <span
            className="inline-flex shrink-0 items-center gap-0.5 text-[var(--fs-tiny)] font-bold tabular-nums text-amber-600 dark:text-amber-300"
            title={t("domain:per-unit-cost-title", { unit: price.unit, value: price.value.toLocaleString(formatLocale(), { maximumFractionDigits: 6 }) })}
        >
            <Coins className="size-3" />
            {price.value.toLocaleString(formatLocale(), { maximumFractionDigits: compact ? 3 : 6 })}/{price.unit}
        </span>
    );
}

function modelQuoteRequest(config: AiConfig, value: string, capability?: ModelCapability, requirements?: ModelRequirements): { logicalModelID: string; intent: ModelRequestIntent } | undefined {
    if (!capability || !value) return undefined;
    const channel = resolveModelChannel(config, value);
    if (channel.scope !== "system") return undefined;
    const cost = channel.modelCosts?.find((item) => item.model === modelOptionName(value));
    if (!cost?.logicalModelId) return undefined;
    const input = requirements?.input;
    const intent: ModelRequestIntent = {
        capability,
        operation: requirements?.videoOperation,
        inputs: {
            image: (input?.imageCount || 0) + (input?.characterCount || 0),
            video: input?.videoCount || 0,
            audio: input?.audioCount || 0,
        },
        options: {
            ...modelRequestOptions(config, capability),
            ...(requirements?.options || {}),
            ...(requirements?.videoSeconds ? { videoSeconds: Number(requirements.videoSeconds) } : {}),
            ...(requirements?.imageSize ? { size: requirements.imageSize } : {}),
        },
    };
    return { logicalModelID: cost.logicalModelId, intent };
}

function modelMenuMeta(model: string, capability?: ModelCapability): { description: string; time?: string } {
    const { t } = useTranslation("canvas");
    const name = modelOptionName(model).toLowerCase();
    if (capability === "image") {
        if (name.includes("nano banana") || name.includes("nanobanana") || name.includes("imagen")) return { description: t("domain:gemini-high-quality-image-generation-for-characters-and-commercial-final") };
        if (name.includes("nano") || name.includes("pro")) return { description: t("domain:high-quality-image-generation-for-characters-and-commercial-finals") };
        if (name.includes("seedream")) return { description: t("domain:fast-image-generation-for-batch-style-exploration") };
        if (name.includes("gpt") || name.includes("image")) return { description: t("domain:general-purpose-image-model-with-reliable-prompt-understanding") };
        return { description: t("domain:image-generation-model") };
    }
    if (capability === "video") {
        if (name.includes("veo") || name.includes("omni flash") || name.includes("omni-flash")) return { description: t("domain:gemini-shot-generation-and-image-to-video-for-final-cut-workflows"), time: "3m" };
        if (name.includes("seedance") || name.includes("sora")) return { description: t("domain:shot-generation-and-image-to-video-for-final-cut-workflows"), time: "3m" };
        return { description: t("domain:video-generation-model"), time: "3m" };
    }
    if (capability === "audio") return { description: t("domain:voice-sound-effects-or-music-generation"), time: "20s" };
    if (name.includes("claude")) return { description: t("domain:long-form-text-reasoning-and-creative-writing"), time: "10s" };
    if (name.includes("gemini")) return { description: t("domain:multimodal-understanding-and-fast-text-generation"), time: "10s" };
    if (name.includes("deepseek")) return { description: t("domain:reasoning-code-and-structured-text"), time: "10s" };
    return { description: capability === "text" ? t("domain:text-generation-model") : t("domain:current-model"), time: "10s" };
}

export function ModelIcon({ config, model, icon }: { config?: AiConfig; model?: string; icon?: string }) {
    return <ModelLogo icon={icon || (config && model ? modelIcon(config, model) : "")} size={14} className="opacity-80" />;
}
