import { useEffect, useId, useMemo, useState } from "react";
import { Coins, Cpu } from "lucide-react";

import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { modelOptionLabel, modelOptionName, resolveModelChannel, selectableModelsByCapability, type AiConfig, type ModelCapability } from "@/stores/use-config-store";

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

    useEffect(() => {
        const closeOtherPicker = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== pickerId) setOpen(false);
        };
        window.addEventListener("model-picker-open", closeOtherPicker);
        return () => window.removeEventListener("model-picker-open", closeOtherPicker);
    }, [pickerId]);

    return (
        <Select
            open={open}
            value={current}
            onOpenChange={(nextOpen) => {
                if (nextOpen && !options.length && config.channelMode === "local") onMissingConfig?.();
                if (nextOpen) window.dispatchEvent(new CustomEvent("model-picker-open", { detail: pickerId }));
                setOpen(nextOpen);
            }}
            onValueChange={onChange}
        >
            <SelectTrigger
                className={cn(
                    "canvas-composer-model-picker h-7 w-fit max-w-full gap-1 rounded-lg border border-input bg-transparent px-2 text-[11px] font-normal leading-none shadow-none transition-colors [&_.canvas-select-chevron]:size-3",
                    fullWidth ? "w-full min-w-0 justify-start" : "min-w-[9rem] justify-start",
                    "data-[state=open]:border-ring data-[state=open]:ring-1 data-[state=open]:ring-ring/15",
                    className,
                )}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                title={current ? modelOptionLabel(config, current) : placeholder}
            >
                <ModelIcon model={current} />
                <span className="canvas-model-picker-text min-w-0 flex-1 truncate text-left">{current ? modelOptionLabel(config, current) : placeholder}</span>
                {showSelectedPrice ? <ModelPrice price={currentPrice} compact /> : null}
            </SelectTrigger>
            <SelectContent
                data-canvas-no-zoom
                className="z-[1200] w-[270px] max-w-[calc(100vw-24px)] rounded-lg border border-border/50 bg-popover p-1 text-[11px] font-normal shadow-md"
                position="popper"
                align="start"
                side="bottom"
                sideOffset={4}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
            >
                {optionGroups.length ? (
                    optionGroups.map((group, index) => (
                        <SelectGroup key={group.key} className="p-0">
                            <SelectLabel className="flex min-w-0 items-center gap-1.5 px-1.5 py-1 text-[10px] font-medium">
                                <span className="min-w-0 truncate opacity-75">{group.label}</span>
                                <span className="shrink-0 font-normal opacity-40">{group.scope}</span>
                            </SelectLabel>
                            {group.models.map((model) => (
                                <SelectItem key={model} value={model} textValue={modelOptionLabel(config, model)} className="py-0.5 pl-1 pr-7">
                                    <ModelLabel config={config} model={model} capability={capability} />
                                </SelectItem>
                            ))}
                            {index < optionGroups.length - 1 ? <SelectSeparator /> : null}
                        </SelectGroup>
                    ))
                ) : (
                    <SelectItem value="__empty__" disabled>
                        {emptyModelLabel(config, capability)}
                    </SelectItem>
                )}
            </SelectContent>
        </Select>
    );
}

function emptyModelLabel(config: AiConfig, capability?: ModelCapability) {
    const label = capability === "image" ? "生图" : capability === "video" ? "视频" : capability === "text" ? "文本" : capability === "audio" ? "音频" : "";
    if (capability && config.models.length) return "请先在上方配置可选模型";
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
                <span className="block min-w-0 truncate text-[11px] font-medium leading-none">{modelOptionName(model)}</span>
                <span className="block truncate text-[10px] opacity-55">{meta.description}</span>
            </span>
            <ModelPrice price={modelMenuPrice(config, model)} />
            {meta.time ? <span className="shrink-0 rounded-full bg-black/5 px-1 py-0.5 text-[10px] tabular-nums opacity-60 dark:bg-white/10">{meta.time}</span> : null}
        </span>
    );
}

function modelMenuPrice(config: AiConfig, model: string): number | null | undefined {
    if (!model) return undefined;
    const channel = resolveModelChannel(config, model);
    if (channel.scope !== "system") return undefined;
    const microcredits = channel.modelCosts?.find((item) => item.model === modelOptionName(model))?.unitPriceMicrocredits;
    return microcredits === undefined ? null : microcredits / 1_000_000;
}

function ModelPrice({ price, compact = false }: { price: number | null | undefined; compact?: boolean }) {
    if (price === undefined) return null;
    if (price === null) return compact ? null : <span className="shrink-0 text-[10px] text-amber-600 dark:text-amber-300">未配置</span>;
    return (
        <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-amber-700 dark:text-amber-300" title={`每次消耗 ${price.toLocaleString("zh-CN", { maximumFractionDigits: 6 })} 积分`}>
            <Coins className="size-3" />
            {price.toLocaleString("zh-CN", { maximumFractionDigits: compact ? 3 : 6 })}
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
