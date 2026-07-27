import { useEffect, useId, useMemo, useState } from "react";
import { Coins, Cpu } from "lucide-react";
import { Select } from "antd";

import { cn } from "@/lib/utils";
import { modelDisplayName, modelOptionLabel, modelOptionName, resolveModelChannel, selectableModelsByCapability, type AiConfig, type ModelCapability } from "@/stores/use-config-store";

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
};

export function ModelPicker({ config, value, onChange, capability, className, fullWidth = false, placeholder = "选择模型", onMissingConfig, showSelectedPrice = true }: ModelPickerProps) {
    const pickerId = useId();
    const [open, setOpen] = useState(false);
    const options = useMemo(
        () => Array.from(new Set([...(config.channelMode === "local" && !capability ? [value] : []), ...selectableModelsByCapability(config, capability)].filter((model): model is string => Boolean(model)))),
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
    const selectOptions = useMemo(() => optionGroups.map((group) => ({
        label: <span className="flex min-w-0 items-center gap-1.5"><span className="truncate">{group.label}</span><span className="shrink-0 text-[10px] font-normal text-foreground/38">{group.scope}</span></span>,
        options: group.models.map((model) => ({ value: model, label: modelOptionLabel(config, model) })),
    })), [config, optionGroups]);

    useEffect(() => {
        const closeOtherPicker = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== pickerId) setOpen(false);
        };
        window.addEventListener("model-picker-open", closeOtherPicker);
        return () => window.removeEventListener("model-picker-open", closeOtherPicker);
    }, [pickerId]);

    return (
        <div
            className={cn(fullWidth ? "w-full min-w-0" : "w-fit max-w-full", className)}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <Select<string>
                size="small"
                open={open}
                value={current || undefined}
                options={selectOptions}
                showSearch
                filterOption={(input, option) => String(option?.label || "").toLocaleLowerCase().includes(input.toLocaleLowerCase())}
                notFoundContent={<span className="block px-2 py-3 text-center text-xs text-foreground/48">{emptyModelLabel(config, capability)}</span>}
                popupMatchSelectWidth={capability === "image" || capability === "video" ? 320 : 280}
                placement="bottomLeft"
                className={cn("canvas-composer-model-picker", fullWidth ? "w-full" : "min-w-36 max-w-full")}
                classNames={{ popup: { root: "canvas-model-picker-popup" } }}
                onOpenChange={(nextOpen) => {
                    if (nextOpen && !options.length && config.channelMode === "local") onMissingConfig?.();
                    if (nextOpen) window.dispatchEvent(new CustomEvent("model-picker-open", { detail: pickerId }));
                    setOpen(nextOpen);
                }}
                onChange={onChange}
                optionRender={(option) => <ModelLabel config={config} model={String(option.value)} capability={capability} />}
                labelRender={() => (
                    <span className="canvas-model-picker-label flex min-w-0 items-center gap-1.5 text-[11px]">
                        <ModelIcon model={current} />
                        <span className="min-w-0 flex-1 truncate">{current ? modelOptionLabel(config, current) : placeholder}</span>
                        {showSelectedPrice ? <ModelPrice price={currentPrice} compact /> : null}
                    </span>
                )}
                aria-label={placeholder}
                title={current ? modelOptionLabel(config, current) : placeholder}
            />
        </div>
    );
}

function emptyModelLabel(config: AiConfig, capability?: ModelCapability) {
    const label = capability === "image" ? "生图" : capability === "video" ? "视频" : capability === "text" ? "文本" : capability === "audio" ? "音频" : "";
    if (capability && config.models.length) return `当前渠道没有匹配的${label}模型`;
    return config.models.length ? `暂无匹配的${label}模型` : "请先到配置里添加渠道和模型";
}

function ModelLabel({ config, model, capability }: { config: AiConfig; model: string; capability?: ModelCapability }) {
    const meta = modelMenuMeta(model, capability);
    return (
        <span className="flex min-w-0 items-center gap-1.5 py-0">
            <span className="grid size-6 shrink-0 place-items-center rounded-md bg-black/5 dark:bg-white/10">
                <ModelIcon model={model} />
            </span>
            <span className="min-w-0 flex-1">
                <span className="block min-w-0 truncate text-[11px] font-medium leading-none">{modelDisplayName(config, model)}</span>
                <span className="mt-0.5 block truncate text-[10px] opacity-55">{modelOptionName(model)} · {meta.description}</span>
            </span>
            <ModelPrice price={modelMenuPrice(config, model)} />
            {meta.time ? <span className="shrink-0 rounded-full bg-black/5 px-1 py-0.5 text-[10px] tabular-nums opacity-60 dark:bg-white/10">{meta.time}</span> : null}
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
    if (price === null) return compact ? null : <span className="shrink-0 text-[10px] text-foreground/40">未配置</span>;
    return (
        <span className="inline-flex shrink-0 items-center gap-0.5 rounded border border-foreground/10 bg-foreground/[.045] px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-foreground/55" title={`每${price.unit}消耗 ${price.value.toLocaleString("zh-CN", { maximumFractionDigits: 6 })} 积分`}>
            <Coins className="size-3" />
            {price.value.toLocaleString("zh-CN", { maximumFractionDigits: compact ? 3 : 6 })}/{price.unit}
        </span>
    );
}

function modelMenuMeta(model: string, capability?: ModelCapability): { description: string; time?: string } {
    const name = modelOptionName(model).toLowerCase();
    if (capability === "image") {
        if (name.includes("nano") || name.includes("pro")) return { description: "高质量图片生成，适合角色和商业成片" };
        if (name.includes("seedream")) return { description: "快速出图，适合批量探索风格" };
        if (name.includes("gpt") || name.includes("image")) return { description: "通用图片模型，提示词理解稳定" };
        return { description: "图片生成模型" };
    }
    if (capability === "video") {
        if (name.includes("seedance") || name.includes("veo") || name.includes("sora")) return { description: "镜头生成与图生视频，适合成片流程", time: "3m" };
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
    return icon ? <img src={icon} alt="" className="size-3.5 shrink-0 dark:invert" /> : <Cpu className="size-3.5 shrink-0 opacity-70" />;
}

function resolveModelIcon(model: string) {
    const name = model.toLowerCase();
    if (name.includes("claude") || name.includes("anthropic")) return "/icons/claude.svg";
    if (name.includes("gemini") || name.includes("google")) return "/icons/gemini.svg";
    if (name.includes("gpt") || name.includes("openai")) return "/icons/openai.svg";
    if (name.includes("grok") || name.includes("grok")) return "/icons/grok.svg";
    if (name.includes("deepseek") || name.includes("deepseek")) return "/icons/deepseek.svg";
    if (name.includes("glm") || name.includes("glm")) return "/icons/glm.svg";
    return "";
}
